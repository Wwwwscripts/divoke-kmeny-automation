/**
 * Modul pro správu podpory (jednotky v obraně, podpora jiných vesnic, atd.)
 * Obsahuje vylepšené zjišťování jednotek
 */

class SupportModule {
  constructor(page, db, accountId) {
    this.page = page;
    this.db = db;
    this.accountId = accountId;
  }

  /**
   * Získá URL světa (podporuje CZ i SK)
   */
  getWorldUrl() {
    const currentUrl = this.page.url();

    // Zkus najít CZ svět
    let match = currentUrl.match(/\/\/([^.]+)\.divokekmeny\.cz/);
    if (match) {
      return `https://${match[1]}.divokekmeny.cz`;
    }

    // Zkus najít SK svět
    match = currentUrl.match(/\/\/([^.]+)\.divoke-kmene\.sk/);
    if (match) {
      return `https://${match[1]}.divoke-kmene.sk`;
    }

    throw new Error('Nepodařilo se zjistit svět (ani CZ ani SK)');
  }

  /**
   * Vylepšené zjišťování jednotek - více metod zjišťování
   * Zjišťuje z obrazovky place (rally point)
   */
  async getUnitsFromPlace() {
    try {
      console.log('📊 Zjišťuji jednotky z rally point...');

      const worldUrl = this.getWorldUrl();
      await this.page.goto(`${worldUrl}/game.php?screen=place`, {
        waitUntil: 'domcontentloaded'
      });

      await this.page.waitForTimeout(1500);

      const unitsData = await this.page.evaluate(() => {
        const units = {};
        const unitTypes = ['spear', 'sword', 'axe', 'archer', 'spy', 'light', 'marcher', 'heavy', 'ram', 'catapult', 'knight', 'snob'];

        unitTypes.forEach(unitType => {
          // Najdeme input pro jednotku
          const input = document.querySelector(`input[name="${unitType}"]`);

          if (!input) {
            units[unitType] = { inVillage: 0, total: 0, away: 0 };
            return;
          }

          // Zjistíme hodnotu v závorce (počet jednotek ve vesnici)
          const row = input.closest('tr');
          if (!row) {
            units[unitType] = { inVillage: 0, total: 0, away: 0 };
            return;
          }

          // Hledáme element s class "unit-item" nebo "units-entry"
          const unitElement = row.querySelector('.unit-item, .units-entry, a');

          if (unitElement) {
            const text = unitElement.textContent || '';
            console.log(`${unitType}: text="${text}"`);

            // Pattern 1: "(123)" - jednotky ve vesnici
            const inVillageMatch = text.match(/\((\d+)\)/);
            const inVillage = inVillageMatch ? parseInt(inVillageMatch[1]) : 0;

            // Pattern 2: Celkový počet může být před závorkou nebo v data atributu
            let total = inVillage;

            // Zkusíme najít data-count attribute
            const dataCount = input.getAttribute('data-count');
            if (dataCount) {
              total = parseInt(dataCount);
            }

            // Nebo hledáme pattern "123 (456)" kde 123 je total a 456 je inVillage
            const totalMatch = text.match(/(\d+)\s*\(/);
            if (totalMatch) {
              total = parseInt(totalMatch[1]);
            }

            const away = Math.max(0, total - inVillage);

            units[unitType] = {
              inVillage,
              total,
              away
            };
          } else {
            units[unitType] = { inVillage: 0, total: 0, away: 0 };
          }
        });

        return units;
      });

      console.log('✅ Jednotky z rally point získány');
      return unitsData;

    } catch (error) {
      console.error('❌ Chyba při zjišťování jednotek z rally point:', error.message);
      return null;
    }
  }

  /**
   * Zjišťování jednotek z obrazovky overview
   */
  async getUnitsFromOverview() {
    try {
      console.log('📊 Zjišťuji jednotky z overview...');

      const worldUrl = this.getWorldUrl();
      await this.page.goto(`${worldUrl}/game.php?screen=overview_villages&mode=units`, {
        waitUntil: 'domcontentloaded'
      });

      await this.page.waitForTimeout(2000);

      const unitsData = await this.page.evaluate(() => {
        const units = {};
        const unitTypes = ['spear', 'sword', 'axe', 'archer', 'spy', 'light', 'marcher', 'heavy', 'ram', 'catapult', 'knight', 'snob'];

        // Najdeme první řádek s jednotkami (vlastní vesnice)
        const firstRow = document.querySelector('#units_table tbody tr:first-child');

        if (!firstRow) {
          console.log('Nenalezen žádný řádek s jednotkami');
          return null;
        }

        unitTypes.forEach(unitType => {
          // Najdeme buňku s ikonou jednotky
          const unitCell = firstRow.querySelector(`.unit-item-${unitType}`);

          if (unitCell) {
            const count = parseInt(unitCell.textContent.trim()) || 0;
            units[unitType] = {
              inVillage: count,
              total: count,
              away: 0
            };
          } else {
            units[unitType] = { inVillage: 0, total: 0, away: 0 };
          }
        });

        return units;
      });

      if (!unitsData) {
        console.log('⚠️ Nepodařilo se zjistit jednotky z overview');
        return null;
      }

      console.log('✅ Jednotky z overview získány');
      return unitsData;

    } catch (error) {
      console.error('❌ Chyba při zjišťování jednotek z overview:', error.message);
      return null;
    }
  }

  /**
   * Zjišťování jednotek z obrazovky train (kasárna/stáje/dílna)
   * Toto je původní metoda z recruit modulu, vylepšená
   */
  async getUnitsFromTrain() {
    try {
      console.log('📊 Zjišťuji jednotky z train screen...');

      const worldUrl = this.getWorldUrl();
      await this.page.goto(`${worldUrl}/game.php?screen=train`, {
        waitUntil: 'domcontentloaded'
      });

      await this.page.waitForTimeout(1500);

      const unitsData = await this.page.evaluate(() => {
        const units = {};
        const unitTypes = ['spear', 'sword', 'axe', 'archer', 'spy', 'light', 'marcher', 'heavy', 'ram', 'catapult'];

        unitTypes.forEach(unitType => {
          const input = document.querySelector(`input[name="${unitType}"]`);
          if (!input) {
            units[unitType] = { inVillage: 0, total: 0, away: 0 };
            return;
          }

          const row = input.closest('tr');
          if (!row) {
            units[unitType] = { inVillage: 0, total: 0, away: 0 };
            return;
          }

          // Hledáme buňku s počtem jednotek
          // Formát: "X / Y" kde X = ve vesnici, Y = celkem
          const cells = Array.from(row.querySelectorAll('td'));

          for (let cell of cells) {
            const text = cell.textContent.trim();

            // Přesný pattern pro jednotky: "číslo / číslo"
            const match = text.match(/^(\d+)\s*\/\s*(\d+)$/);

            if (match) {
              const inVillage = parseInt(match[1]) || 0;
              const total = parseInt(match[2]) || 0;
              const away = Math.max(0, total - inVillage);

              units[unitType] = { inVillage, total, away };
              console.log(`${unitType}: ${inVillage}/${total} (away: ${away})`);
              return;
            }
          }

          // Pokud nenajdeme pattern, nastavíme 0
          units[unitType] = { inVillage: 0, total: 0, away: 0 };
        });

        return units;
      });

      console.log('✅ Jednotky z train screen získány');
      return unitsData;

    } catch (error) {
      console.error('❌ Chyba při zjišťování jednotek z train screen:', error.message);
      return null;
    }
  }

  /**
   * Získá kompletní informace o jednotkách - kombinuje všechny metody
   */
  async getAllUnitsInfo() {
    try {
      console.log('\n' + '='.repeat(60));
      console.log('📊 ZJIŠŤOVÁNÍ JEDNOTEK - VŠECHNY METODY');
      console.log('='.repeat(60));

      // Metoda 1: Train screen
      console.log('\n1️⃣ Metoda: Train Screen');
      const trainUnits = await this.getUnitsFromTrain();
      if (trainUnits) {
        this.printUnitsTable(trainUnits, 'Train Screen');
      }

      // Metoda 2: Rally point (place)
      console.log('\n2️⃣ Metoda: Rally Point (Place)');
      const placeUnits = await this.getUnitsFromPlace();
      if (placeUnits) {
        this.printUnitsTable(placeUnits, 'Rally Point');
      }

      // Metoda 3: Overview
      console.log('\n3️⃣ Metoda: Overview');
      const overviewUnits = await this.getUnitsFromOverview();
      if (overviewUnits) {
        this.printUnitsTable(overviewUnits, 'Overview');
      }

      // Vybereme nejlepší data (ta, která mají nejvíce jednotek)
      const bestData = this.selectBestUnitsData([trainUnits, placeUnits, overviewUnits]);

      if (bestData) {
        console.log('\n✅ VYBRÁNA NEJLEPŠÍ DATA:');
        this.printUnitsTable(bestData, 'Final');

        // Uložíme do databáze
        await this.saveUnitsToDatabase(bestData);
      }

      console.log('='.repeat(60));

      return bestData;

    } catch (error) {
      console.error('❌ Chyba při zjišťování jednotek:', error.message);
      return null;
    }
  }

  /**
   * Vybere nejlepší data z více metod
   */
  selectBestUnitsData(dataSets) {
    const validSets = dataSets.filter(set => set !== null);

    if (validSets.length === 0) return null;
    if (validSets.length === 1) return validSets[0];

    // Spočítáme celkový počet jednotek pro každou metodu
    const scores = validSets.map(set => {
      return Object.values(set).reduce((sum, unit) => sum + (unit.total || 0), 0);
    });

    // Vybereme tu s nejvyšším počtem jednotek
    const maxIndex = scores.indexOf(Math.max(...scores));
    return validSets[maxIndex];
  }

  /**
   * Vytiskne tabulku jednotek
   */
  printUnitsTable(units, source) {
    console.log(`\n📋 Zdroj: ${source}`);
    console.log('-'.repeat(60));
    console.log('Jednotka    | Ve vesnici | Celkem | Mimo vesnici');
    console.log('-'.repeat(60));

    Object.keys(units).forEach(unitType => {
      const unit = units[unitType];
      const name = unitType.padEnd(11);
      const inVillage = String(unit.inVillage).padStart(10);
      const total = String(unit.total).padStart(6);
      const away = String(unit.away).padStart(12);

      console.log(`${name} | ${inVillage} | ${total} | ${away}`);
    });

    console.log('-'.repeat(60));
  }

  /**
   * Uloží informace o jednotkách do databáze
   */
  async saveUnitsToDatabase(unitsData) {
    if (!unitsData) return;

    try {
      this.db.updateAccountInfo(this.accountId, {
        units_info: JSON.stringify(unitsData)
      });

      console.log('✅ Informace o jednotkách uloženy do databáze');
    } catch (error) {
      console.error('❌ Chyba při ukládání jednotek:', error.message);
    }
  }

  /**
   * Hlavní execute funkce pro modul
   */
  async execute(params = {}) {
    try {
      console.log('🚀 Spouštím modul: Support');

      const unitsData = await this.getAllUnitsInfo();

      console.log('✅ Modul Support dokončen');
      return { success: true, data: unitsData };

    } catch (error) {
      console.error('❌ Chyba v modulu Support:', error.message);
      return { success: false, error: error.message };
    }
  }
}

export default SupportModule;
