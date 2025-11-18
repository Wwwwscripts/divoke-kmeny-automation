/**
 * Modul pro správu podpory (jednotky v obraně, podpora jiných vesnic, atd.)
 * Používá metodu overview_villages pro zjišťování jednotek
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
   * Získá村ID z page objektu
   */
  async getVillageId() {
    return await this.page.evaluate(() => {
      return game_data.village.id;
    });
  }

  /**
   * Zjišťování jednotek pomocí overview_villages
   * Toto je NEJLEPŠÍ metoda - používá stejný způsob jako script "Přehled armády"
   */
  async getUnitsFromOverview() {
    try {
      console.log('📊 Zjišťuji jednotky přes overview_villages...');

      const worldUrl = this.getWorldUrl();
      const villageId = await this.getVillageId();

      // Sestavíme URL (stejně jako script "Přehled armády")
      const url = `${worldUrl}/game.php?village=${villageId}&type=complete&mode=units&group=0&page=-1&screen=overview_villages`;

      console.log(`🌐 Načítám: ${url}`);

      await this.page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      await this.page.waitForTimeout(2000);

      // Zjistíme jednotky z tabulky
      const unitsData = await this.page.evaluate(() => {
        // Najdeme tabulku
        const table = document.querySelector('#units_table');

        if (!table || table.rows.length < 2) {
          console.log('Tabulka #units_table nenalezena nebo je prázdná');
          return null;
        }

        console.log(`Tabulka nalezena, počet řádků: ${table.rows.length}`);

        const firstRow = table.rows[0];
        const dataRow = table.rows[1];

        // Zjistíme offset (někdy je první buňka název vesnice)
        const offset = (firstRow.cells.length == dataRow.cells.length) ? 2 : 1;
        console.log(`Offset: ${offset}`);

        // Typy jednotek
        let unitTypes = ['spear', 'sword', 'axe', 'archer', 'spy', 'light', 'marcher', 'heavy', 'ram', 'catapult', 'knight', 'snob'];

        // Kontrola jestli má archer (některá světa nemají lukostřelce)
        if (!firstRow.innerHTML.match("archer")) {
          console.log('Svět nemá lukostřelce - odstraňuji archer a marcher');
          unitTypes.splice(unitTypes.indexOf("archer"), 1);
          unitTypes.splice(unitTypes.indexOf("marcher"), 1);
        }

        // Kontrola jestli má rytíře
        if (!firstRow.innerHTML.match("knight")) {
          console.log('Svět nemá rytíře - odstraňuji knight');
          unitTypes.splice(unitTypes.indexOf("knight"), 1);
        }

        // Inicializace součtů
        const totalUnits = {};
        const unitsInVillages = {};
        const unitsSupport = {};
        const unitsSent = {};
        const unitsOnWay = {};

        unitTypes.forEach(unitType => {
          totalUnits[unitType] = 0;
          unitsInVillages[unitType] = 0;
          unitsSupport[unitType] = 0;
          unitsSent[unitType] = 0;
          unitsOnWay[unitType] = 0;
        });

        // Projdeme všechny řádky
        // Každá vesnice má 5 řádků (0-4):
        // 0 = ve vesnici (available)
        // 1 = vlastní podpora v jiných vesnicích
        // 2 = odeslaná podpora
        // 3 = na cestě
        // 4 = prázdný řádek / oddělovač

        for (let i = 1; i < table.rows.length; i++) {
          const row = table.rows[i];
          const rowType = (i - 1) % 5;

          // Přeskočíme prázdné řádky
          if (row.cells.length < offset + unitTypes.length) {
            continue;
          }

          for (let j = 0; j < unitTypes.length; j++) {
            const cellIndex = offset + j;
            const count = parseInt(row.cells[cellIndex].textContent.trim()) || 0;

            totalUnits[unitTypes[j]] += count;

            if (rowType === 0) {
              unitsInVillages[unitTypes[j]] += count;
            } else if (rowType === 1) {
              unitsSupport[unitTypes[j]] += count;
            } else if (rowType === 2) {
              unitsSent[unitTypes[j]] += count;
            } else if (rowType === 3) {
              unitsOnWay[unitTypes[j]] += count;
            }
          }
        }

        // Vytvoříme finální formát
        const units = {};
        unitTypes.forEach(unitType => {
          // inVillage = jednotky ve vesnicích + vlastní podpora v jiných vesnicích
          // (protože obojí je "naše" a máme k nim přístup)
          const inVillage = unitsInVillages[unitType] + unitsSupport[unitType];
          const total = totalUnits[unitType];
          const away = Math.max(0, total - inVillage);

          units[unitType] = {
            inVillage,
            total,
            away,
            // Extra info pro debugging
            breakdown: {
              inVillages: unitsInVillages[unitType],
              support: unitsSupport[unitType],
              sent: unitsSent[unitType],
              onWay: unitsOnWay[unitType]
            }
          };

          console.log(`${unitType}: ve vesnicích=${unitsInVillages[unitType]}, podpora=${unitsSupport[unitType]}, odesláno=${unitsSent[unitType]}, na cestě=${unitsOnWay[unitType]}, TOTAL=${total}`);
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
   * Vytiskne tabulku jednotek
   */
  printUnitsTable(units, source) {
    console.log(`\n📋 Zdroj: ${source}`);
    console.log('-'.repeat(80));
    console.log('Jednotka    | Ve vesnici | Celkem | Mimo | Breakdown (V/S/O/C)');
    console.log('-'.repeat(80));

    Object.keys(units).forEach(unitType => {
      const unit = units[unitType];
      const name = unitType.padEnd(11);
      const inVillage = String(unit.inVillage).padStart(10);
      const total = String(unit.total).padStart(6);
      const away = String(unit.away).padStart(5);

      const breakdown = unit.breakdown
        ? `${unit.breakdown.inVillages}/${unit.breakdown.support}/${unit.breakdown.sent}/${unit.breakdown.onWay}`
        : 'N/A';

      console.log(`${name} | ${inVillage} | ${total} | ${away} | ${breakdown}`);
    });

    console.log('-'.repeat(80));
    console.log('V = ve vesnicích, S = vlastní podpora, O = odesláno, C = na cestě');
  }

  /**
   * Získá kompletní informace o jednotkách
   */
  async getAllUnitsInfo() {
    try {
      console.log('\n' + '='.repeat(60));
      console.log('📊 ZJIŠŤOVÁNÍ JEDNOTEK - OVERVIEW METHOD');
      console.log('='.repeat(60));

      const unitsData = await this.getUnitsFromOverview();

      if (unitsData) {
        this.printUnitsTable(unitsData, 'Overview Villages');
        await this.saveUnitsToDatabase(unitsData);
      }

      console.log('='.repeat(60));

      return unitsData;

    } catch (error) {
      console.error('❌ Chyba při zjišťování jednotek:', error.message);
      return null;
    }
  }

  /**
   * Uloží informace o jednotkách do databáze
   */
  async saveUnitsToDatabase(unitsData) {
    if (!unitsData) return;

    try {
      // Odebereme breakdown info před uložením do DB (není potřeba)
      const cleanData = {};
      Object.keys(unitsData).forEach(unitType => {
        cleanData[unitType] = {
          inVillage: unitsData[unitType].inVillage,
          total: unitsData[unitType].total,
          away: unitsData[unitType].away
        };
      });

      this.db.updateAccountInfo(this.accountId, {
        units_info: JSON.stringify(cleanData)
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
