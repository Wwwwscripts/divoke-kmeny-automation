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
      const worldUrl = this.getWorldUrl();
      const villageId = await this.getVillageId();

      // Sestavíme URL (stejně jako script "Přehled armády")
      const url = `${worldUrl}/game.php?village=${villageId}&type=complete&mode=units&group=0&page=-1&screen=overview_villages`;

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
          return null;
        }

        const firstRow = table.rows[0];
        const dataRow = table.rows[1];

        // Zjistíme offset (někdy je první buňka název vesnice)
        const offset = (firstRow.cells.length == dataRow.cells.length) ? 2 : 1;

        // Typy jednotek
        let unitTypes = ['spear', 'sword', 'axe', 'archer', 'spy', 'light', 'marcher', 'heavy', 'ram', 'catapult', 'knight', 'snob'];

        // Kontrola jestli má archer (některá světa nemají lukostřelce)
        if (!firstRow.innerHTML.match("archer")) {
          unitTypes.splice(unitTypes.indexOf("archer"), 1);
          unitTypes.splice(unitTypes.indexOf("marcher"), 1);
        }

        // Kontrola jestli má rytíře
        if (!firstRow.innerHTML.match("knight")) {
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
        });

        return units;
      });

      return unitsData;

    } catch (error) {
      // Tichá chyba - nezobrazujeme
      return null;
    }
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
      const unitsData = await this.getUnitsFromOverview();

      if (unitsData) {
        await this.saveUnitsToDatabase(unitsData);
      }

      return unitsData;

    } catch (error) {
      // Tichá chyba
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
