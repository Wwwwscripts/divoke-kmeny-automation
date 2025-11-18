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
   * Zjišťování jednotek pomocí place&mode=units (funguje i bez premium účtu)
   * Tato metoda je nezávislá na jazyce - používá data-unit-count atributy
   */
  async getUnitsFromOverview() {
    try {
      const worldUrl = this.getWorldUrl();
      const villageId = await this.getVillageId();

      // URL pro shromaždiště - funguje pro všechny účty
      const url = `${worldUrl}/game.php?village=${villageId}&screen=place&mode=units`;

      await this.page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 45000
      });

      await this.page.waitForTimeout(3000);

      // Zkontroluj jestli existuje tabulka před parsováním
      const tableExists = await this.page.evaluate(() => {
        return document.querySelector('#units_home') !== null;
      });

      if (!tableExists) {
        console.log(`⚠️  [Support] Tabulka #units_home nenalezena pro účet ID ${this.accountId}`);
        return null;
      }

      // Zjistíme jednotky z tabulky (nezávislé na jazyce)
      const unitsData = await this.page.evaluate(() => {
        // Funkce pro parsování jednotek z řádku pomocí data-unit-count
        const parseUnitsFromRow = (row) => {
          const units = {};
          const unitTypes = ['spear', 'sword', 'axe', 'archer', 'spy', 'light', 'marcher', 'heavy', 'ram', 'catapult', 'knight', 'snob'];

          unitTypes.forEach(unitType => {
            // Najdeme buňku s data-unit-count pro tento typ jednotky
            const cell = row.querySelector(`.unit-item-${unitType}`);
            if (cell) {
              const count = parseInt(cell.getAttribute('data-unit-count')) || 0;
              units[unitType] = count;
            } else {
              units[unitType] = 0;
            }
          });

          return units;
        };

        // Inicializace
        const unitTypes = ['spear', 'sword', 'axe', 'archer', 'spy', 'light', 'marcher', 'heavy', 'ram', 'catapult', 'knight', 'snob'];
        let unitsHome = {};      // Jednotky doma
        let unitsTotal = {};     // Celkem (doma + cizí podpora)
        let unitsTraveling = {}; // Na cestě
        let unitsSupporting = {}; // Podporují jiné vesnice

        unitTypes.forEach(ut => {
          unitsHome[ut] = 0;
          unitsTotal[ut] = 0;
          unitsTraveling[ut] = 0;
          unitsSupporting[ut] = 0;
        });

        // ==== TABULKA 1: #units_home - jednotky v obraně ====
        const homeTable = document.querySelector('#units_home');
        if (homeTable && homeTable.rows.length >= 2) {
          // Řádek 1 = jednotky doma (první datový řádek po hlavičce)
          const homeRow = homeTable.rows[1];
          if (homeRow) {
            unitsHome = parseUnitsFromRow(homeRow);
          }

          // Najdeme řádek "Dohromady" (total) - má class "units_total" nebo je předposlední řádek
          for (let i = 1; i < homeTable.rows.length; i++) {
            const row = homeTable.rows[i];
            // Identifikuj "Dohromady" řádek pomocí třídy nebo pozice
            if (row.className && row.className.includes('units_total')) {
              unitsTotal = parseUnitsFromRow(row);
              break;
            }
          }

          // Pokud jsme nenašli "Dohromady" pomocí třídy, zkusíme poslední řádek s daty
          if (Object.values(unitsTotal).every(v => v === 0)) {
            const lastDataRow = homeTable.rows[homeTable.rows.length - 1];
            if (lastDataRow && lastDataRow.querySelector('.unit-item')) {
              unitsTotal = parseUnitsFromRow(lastDataRow);
            }
          }
        }

        // ==== TABULKA 2: Jednotky na cestě ====
        // Hledáme tabulku s traveling units (má mnoho řádků, každý příkaz = řádek)
        const allTables = document.querySelectorAll('table.vis');
        let travelingTable = null;

        // Tabulka s cestujícími jednotkami je obvykle druhá nebo třetí table.vis
        for (let i = 1; i < allTables.length; i++) {
          const table = allTables[i];
          // Traveling table má obvykle mnoho řádků a obsahuje unit-item buňky
          if (table.rows.length > 5 && table.querySelector('.unit-item')) {
            // Není to #units_home
            if (table.id !== 'units_home') {
              travelingTable = table;
              break;
            }
          }
        }

        if (travelingTable) {
          // Sečteme všechny jednotky na cestě (každý řádek = jeden příkaz)
          for (let i = 1; i < travelingTable.rows.length; i++) {
            const row = travelingTable.rows[i];
            if (row.querySelector('.unit-item')) {
              const rowUnits = parseUnitsFromRow(row);
              unitTypes.forEach(ut => {
                unitsTraveling[ut] += rowUnits[ut] || 0;
              });
            }
          }
        }

        // ==== TABULKA 3: Jednotky podporující jiné vesnice ====
        // Hledáme tabulku s supporting units (menší tabulka)
        let supportingTable = null;

        for (let i = 1; i < allTables.length; i++) {
          const table = allTables[i];
          // Supporting table je menší než traveling, ale má unit-item buňky
          if (table.id !== 'units_home' && table !== travelingTable && table.querySelector('.unit-item')) {
            supportingTable = table;
            break;
          }
        }

        if (supportingTable) {
          // Sečteme jednotky podporující jiné vesnice
          for (let i = 1; i < supportingTable.rows.length; i++) {
            const row = supportingTable.rows[i];
            if (row.querySelector('.unit-item')) {
              const rowUnits = parseUnitsFromRow(row);
              unitTypes.forEach(ut => {
                unitsSupporting[ut] += rowUnits[ut] || 0;
              });
            }
          }
        }

        // ==== VÝPOČET FINÁLNÍCH HODNOT ====
        const units = {};
        unitTypes.forEach(unitType => {
          const inVillages = unitsHome[unitType] || 0;
          const traveling = unitsTraveling[unitType] || 0;
          const supporting = unitsSupporting[unitType] || 0;
          const totalInVillage = unitsTotal[unitType] || inVillages; // fallback pokud "Dohromady" nenalezen

          // totalOwn = jednotky doma + na cestě + podporující
          const totalOwn = inVillages + traveling + supporting;

          // foreignSupport = rozdíl mezi total a vlastními doma
          const foreignSupport = Math.max(0, totalInVillage - inVillages);

          units[unitType] = {
            inVillages,          // Vlastní jednotky doma
            totalOwn,            // Celkem vlastní (doma + cestou + podpory)
            foreignSupport,      // Cizí podpory
            totalInVillage,      // Celkem ve vesnici (vlastní + cizí)
            breakdown: {
              home: inVillages,
              traveling: traveling,
              supporting: supporting,
              foreign: foreignSupport
            }
          };
        });

        return units;
      });

      return unitsData;

    } catch (error) {
      if (error.name === 'TimeoutError') {
        console.log(`⏱️  [Support] Timeout při načítání place&mode=units pro účet ID ${this.accountId}`);
      } else {
        console.log(`⚠️  [Support] Chyba při parsování jednotek pro účet ID ${this.accountId}: ${error.message}`);
      }
      return null;
    }
  }

  /**
   * getForeignSupport() již není potřeba - cizí podpory se zjišťují přímo v getUnitsFromOverview()
   * Metoda ponechána pro zpětnou kompatibilitu, ale nepoužívá se
   */
  async getForeignSupport() {
    // Deprecated - foreign support is now handled in getUnitsFromOverview()
    return null;
  }

  /**
   * Vytiskne tabulku jednotek (pouze v DEBUG módu)
   */
  printUnitsTable(units, source) {
    // Vypnuto - verbose logging
    return;
  }

  /**
   * Získá kompletní informace o jednotkách
   */
  async getAllUnitsInfo() {
    try {
      // Získej všechna data jednotek (včetně cizích podpor) z place&mode=units
      const unitsData = await this.getUnitsFromOverview();
      if (!unitsData) {
        // Chyba už byla zalogována v getUnitsFromOverview()
        return null;
      }

      // Data jsou už kompletní z getUnitsFromOverview()
      // Obsahují: inVillages, totalOwn, foreignSupport, totalInVillage, breakdown

      await this.saveUnitsToDatabase(unitsData);
      console.log(`💾 [Support] Jednotky uloženy do DB pro účet ID ${this.accountId}`);

      return unitsData;

    } catch (error) {
      console.error(`❌ [Support] Chyba při zjišťování jednotek pro účet ID ${this.accountId}:`, error.message);
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
          inVillages: unitsData[unitType].inVillages,          // Vlastní ve vesnici
          totalOwn: unitsData[unitType].totalOwn,              // Celkem vlastní
          foreignSupport: unitsData[unitType].foreignSupport,  // Cizí podpory
          totalInVillage: unitsData[unitType].totalInVillage   // Celkem ve vesnici
        };
      });

      this.db.updateAccountInfo(this.accountId, {
        units_info: JSON.stringify(cleanData)
      });

      // Tichý úspěch
    } catch (error) {
      // Tichá chyba
    }
  }

  /**
   * Hlavní execute funkce pro modul
   */
  async execute(params = {}) {
    try {
      const unitsData = await this.getAllUnitsInfo();
      return { success: true, data: unitsData };

    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

export default SupportModule;
