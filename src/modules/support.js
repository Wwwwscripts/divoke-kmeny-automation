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
        timeout: 45000  // Zvýšeno z 30s na 45s
      });

      await this.page.waitForTimeout(3000);  // Zvýšeno z 2s na 3s

      // Zkontroluj jestli existuje tabulka před parsováním
      const tableExists = await this.page.evaluate(() => {
        return document.querySelector('#units_table') !== null;
      });

      if (!tableExists) {
        console.log(`⚠️  [Support] Tabulka #units_table nenalezena pro účet ID ${this.accountId}`);
        return null;
      }

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
          // inVillages = jen jednotky přímo ve vesnicích (BEZ vlastní podpory v jiných vesnicích)
          // totalOwn = všechny naše jednotky (ve vesnicích + podpory + sent + on way)
          const inVillages = unitsInVillages[unitType];
          const totalOwn = totalUnits[unitType];

          units[unitType] = {
            inVillages,     // Jen ve vesnicích (bez podpory)
            totalOwn,       // Celkem vlastní
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
      // Timeout je normální pro pomalá spojení nebo CAPTCHA
      if (error.name === 'TimeoutError') {
        console.log(`⏱️  [Support] Timeout při načítání overview pro účet ID ${this.accountId} (${error.message})`);
      } else {
        console.log(`⚠️  [Support] Chyba při parsování jednotek pro účet ID ${this.accountId}: ${error.message}`);
      }
      return null;
    }
  }

  /**
   * Získá cizí podpory (jednotky od jiných hráčů) ze shromaždiště
   */
  async getForeignSupport() {
    try {
      const worldUrl = this.getWorldUrl();
      const villageId = await this.getVillageId();

      const url = `${worldUrl}/game.php?village=${villageId}&screen=place&mode=units`;

      await this.page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      await this.page.waitForTimeout(2000);

      const foreignUnits = await this.page.evaluate(() => {
        const unitTypes = ['spear', 'sword', 'axe', 'archer', 'spy', 'light', 'marcher', 'heavy', 'ram', 'catapult', 'knight', 'snob'];
        const foreignSupport = {};

        unitTypes.forEach(unitType => {
          foreignSupport[unitType] = 0;
        });

        // Najdeme tabulku s cizími podporami
        const tables = document.querySelectorAll('table.vis');

        for (const table of tables) {
          // Hledáme tabulku s cizími podporami (má nadpis "Jednotky jiných hráčů" nebo podobný)
          const headerRow = table.querySelector('th');
          if (!headerRow) continue;

          const headerText = headerRow.textContent.toLowerCase();

          // Pokud je to tabulka s cizími jednotkami
          if (headerText.includes('podpora') || headerText.includes('support') || headerText.includes('jednotky jiných')) {
            const rows = table.querySelectorAll('tr');

            rows.forEach(row => {
              const cells = row.querySelectorAll('td');
              if (cells.length < 2) return;

              // Každý řádek reprezentuje podporu od jednoho hráče
              unitTypes.forEach((unitType, index) => {
                // Data-count atributy nebo textContent
                const cell = cells[index + 1]; // +1 protože první sloupec je jméno hráče
                if (cell) {
                  const count = parseInt(cell.textContent.trim()) || 0;
                  foreignSupport[unitType] += count;
                }
              });
            });
          }
        }

        return foreignSupport;
      });

      return foreignUnits;

    } catch (error) {
      // Tichá chyba
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
      // Získej vlastní jednotky z overview
      const ownUnits = await this.getUnitsFromOverview();
      if (!ownUnits) {
        // Chyba už byla zalogována v getUnitsFromOverview()
        return null;
      }

      // Získej cizí podpory z place
      const foreignSupport = await this.getForeignSupport();

      // Zkombinuj data
      const combinedData = {};
      Object.keys(ownUnits).forEach(unitType => {
        const own = ownUnits[unitType];
        const foreign = foreignSupport ? (foreignSupport[unitType] || 0) : 0;

        combinedData[unitType] = {
          inVillages: own.inVillages,           // Vlastní jednotky ve vesnici
          totalOwn: own.totalOwn,               // Celkem vlastní (všude)
          foreignSupport: foreign,              // Cizí podpory
          totalInVillage: own.inVillages + foreign,  // Celkem ve vesnici (vlastní + cizí)
          breakdown: own.breakdown
        };
      });

      await this.saveUnitsToDatabase(combinedData);
      console.log(`💾 [Support] Jednotky uloženy do DB pro účet ID ${this.accountId}`);

      return combinedData;

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
