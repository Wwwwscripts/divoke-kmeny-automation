/**
 * Modul pro automatické rekrutování jednotek
 * S podporou CZ i SK světů
 */

import logger from '../logger.js';
import { randomDelay, humanDelay } from '../utils/randomize.js';
import { simulateReading, humanWait } from '../utils/humanBehavior.js';

class RecruitModule {
  constructor(page, db, accountId) {
    this.page = page;
    this.db = db;
    this.accountId = accountId;
    this.accountName = null;
    this.buildingPositions = {
      barracks: 0,
      stable: 0,
      workshop: 0
    };

    // Konstanty jednotek (POUZE CENY - čas se zjišťuje ze stránky)
    this.unitData = {
      spear: { wood: 50, stone: 30, iron: 10 },
      sword: { wood: 30, stone: 30, iron: 70 },
      axe: { wood: 60, stone: 30, iron: 40 },
      archer: { wood: 50, stone: 30, iron: 20 },
      spy: { wood: 50, stone: 50, iron: 20 },
      light: { wood: 125, stone: 100, iron: 250 },
      marcher: { wood: 250, stone: 100, iron: 150 },
      heavy: { wood: 200, stone: 150, iron: 600 },
      ram: { wood: 300, stone: 200, iron: 200 },
      catapult: { wood: 320, stone: 400, iron: 100 }
    };

    // Cíl: fronta na 8 hodin
    this.targetQueueTime = 8 * 3600; // 8 hodin v sekundách
  }

  /**
   * Získá username pro logging
   */
  getAccountName() {
    if (!this.accountName) {
      const account = this.db.getAccount(this.accountId);
      this.accountName = account?.username || `ID:${this.accountId}`;
    }
    return this.accountName;
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
   * Načte šablonu z databáze
   */
  getTemplate(templateName) {
    try {
      const template = this.db.getTemplate('recruit', templateName);

      if (!template) {
        logger.error(`Šablona ${templateName} neexistuje`, this.getAccountName());
        return null;
      }

      // Vrátíme units z šablony
      return template.units || {};
    } catch (error) {
      logger.error(`Chyba při načítání šablony`, this.getAccountName(), error);
      return null;
    }
  }

  /**
   * Mapování jednotek na budovy
   */
  getBuildingForUnit(unitType) {
    const buildings = {
      barracks: ['spear', 'sword', 'axe', 'archer'],
      stable: ['spy', 'light', 'marcher', 'heavy'],
      workshop: ['ram', 'catapult']
    };

    for (const [building, units] of Object.entries(buildings)) {
      if (units.includes(unitType)) {
        return building;
      }
    }
    return null;
  }

  /**
   * Získá informace o jednotkách ve vesnici
   * DEPRECATED - používá se support modul místo toho
   */
  async getVillageUnits() {
    try {
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
            units[unitType] = { inVillage: 0, total: 0 };
            return;
          }

          const row = input.closest('tr');
          if (!row) {
            units[unitType] = { inVillage: 0, total: 0 };
            return;
          }

          const cells = row.querySelectorAll('td');
          for (let cell of cells) {
            const text = cell.textContent.trim();
            if (text.includes('/')) {
              const parts = text.split('/');
              const inVillage = parseInt(parts[0]) || 0;
              const total = parseInt(parts[1]) || 0;
              units[unitType] = { inVillage, total };
              return;
            }
          }

          units[unitType] = { inVillage: 0, total: 0 };
        });

        return units;
      });

      return unitsData;

    } catch (error) {
      return null;
    }
  }

  /**
   * Uloží informace o jednotkách do databáze
   * DEPRECATED - používá se support modul místo toho
   */
  async saveUnitsToDatabase(unitsData) {
    if (!unitsData) return;

    try {
      this.db.updateAccountInfo(this.accountId, {
        units_info: JSON.stringify(unitsData)
      });
    } catch (error) {
      // Tichá chyba
    }
  }

  /**
   * Získá a uloží kompletní informace o jednotkách
   * DEPRECATED - používá se support modul místo toho
   */
  async collectUnitsInfo() {
    const unitsData = await this.getVillageUnits();
    if (unitsData) {
      await this.saveUnitsToDatabase(unitsData);
    }
    return unitsData;
  }

  /**
   * Zkontroluje, co je potřeba narekrutovat podle šablony
   */
  async checkWhatToRecruit(template) {
    try {
      // Načteme units_info z databáze (nastavené support modulem)
      const account = this.db.getAccount(this.accountId);
      let unitsData = null;

      if (account?.units_info) {
        try {
          unitsData = typeof account.units_info === 'string'
            ? JSON.parse(account.units_info)
            : account.units_info;
        } catch (e) {
          // Pokud se nepodaří parsovat, zkusíme fallback
          unitsData = await this.getVillageUnits();
        }
      } else {
        // Fallback pokud support modul ještě neběžel
        unitsData = await this.getVillageUnits();
      }

      if (!unitsData) return null;

      const toRecruit = {};

      Object.keys(template).forEach(unitType => {
        const targetCount = template[unitType];
        // Použij totalOwn (ze support modulu) nebo total (z fallback metody)
        const currentCount = unitsData[unitType]?.totalOwn || unitsData[unitType]?.total || 0;
        const needed = Math.max(0, targetCount - currentCount);

        if (needed > 0) {
          toRecruit[unitType] = {
            target: targetCount,
            current: currentCount,
            needed: needed
          };
        }
      });

      return toRecruit;
    } catch (error) {
      logger.error(`Chyba při kontrole jednotek`, this.getAccountName(), error);
      return null;
    }
  }

  /**
   * Zkontroluje celkový čas fronty v budově (v sekundách)
   * @returns {number} Celkový čas ve frontě v sekundách
   */
  async checkBuildingQueue(building) {
    try {
      const queueId = building === 'workshop' ? 'trainqueue_garage' : `trainqueue_${building}`;

      const totalTime = await this.page.evaluate((queueId) => {
        const queueElement = document.getElementById(queueId);
        if (!queueElement) return 0;

        const parentTable = queueElement.closest('table');
        if (!parentTable) return 0;

        let total = 0;

        // Najdi všechny řádky s časem (tr.lit + tr.sortable_row)
        const allRows = parentTable.querySelectorAll('tr.lit, tr.sortable_row');

        allRows.forEach(row => {
          // Čas je v druhém <td> (index 1)
          const cells = row.querySelectorAll('td');
          if (cells.length < 2) return;

          const timeCell = cells[1];
          const timeText = timeCell.textContent.trim();

          // Parse formát H:MM:SS nebo HH:MM:SS
          const match = timeText.match(/(\d{1,2}):(\d{2}):(\d{2})/);
          if (match) {
            const hours = parseInt(match[1]) || 0;
            const minutes = parseInt(match[2]) || 0;
            const seconds = parseInt(match[3]) || 0;
            total += hours * 3600 + minutes * 60 + seconds;
          }
        });

        return total;
      }, queueId);

      return totalTime;
    } catch (error) {
      return 0;
    }
  }

  /**
   * Získá aktuální suroviny
   * @returns {object} { wood, stone, iron }
   */
  async getCurrentResources() {
    try {
      const resources = await this.page.evaluate(() => {
        const wood = parseInt(document.getElementById('wood')?.textContent.replace(/\./g, '')) || 0;
        const stone = parseInt(document.getElementById('stone')?.textContent.replace(/\./g, '')) || 0;
        const iron = parseInt(document.getElementById('iron')?.textContent.replace(/\./g, '')) || 0;
        return { wood, stone, iron };
      });
      return resources;
    } catch (error) {
      return { wood: 0, stone: 0, iron: 0 };
    }
  }

  /**
   * Zjistí čas rekrutování jednotky ze stránky (v sekundách)
   * @returns {number} Čas v sekundách
   */
  async getUnitTime(unitType) {
    try {
      const timeSeconds = await this.page.evaluate((unitType) => {
        // Najdi span s id "{unit}_0_cost_time"
        const timeSpan = document.getElementById(`${unitType}_0_cost_time`);
        if (!timeSpan) return 0;

        const timeText = timeSpan.textContent.trim();
        // Formát H:MM:SS nebo MM:SS
        const parts = timeText.split(':').map(p => parseInt(p) || 0);

        if (parts.length === 3) {
          return parts[0] * 3600 + parts[1] * 60 + parts[2];
        } else if (parts.length === 2) {
          return parts[0] * 60 + parts[1];
        }

        return 0;
      }, unitType);

      return timeSeconds;
    } catch (error) {
      return 0;
    }
  }

  /**
   * Narekrutuje jednotky (může být více najednou)
   */
  async recruitUnits(unitType, count) {
    try {
      const worldUrl = this.getWorldUrl();

      // Přejdeme na stránku s rekrutováním
      const building = this.getBuildingForUnit(unitType);
      let buildingParam = building;
      if (building === 'workshop') buildingParam = 'garage';

      // Human-like delay před navigací (2-4s)
      await humanDelay(2000, 4000);

      await this.page.goto(`${worldUrl}/game.php?screen=${buildingParam}`, {
        waitUntil: 'networkidle',
        timeout: 30000
      });

      // Simuluj čtení stránky (2-4s scrollování a pohyby myši)
      await simulateReading(this.page, 3000);

      // Najdeme input pro jednotku a nastavíme hodnotu
      const recruited = await this.page.evaluate(({ unitType, count }) => {
        const input = document.querySelector(`input[name="${unitType}"]`);
        if (!input) return false;

        // Nastavíme hodnotu
        input.value = count.toString();
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));

        // Počkáme chvíli
        setTimeout(() => {
          // Klikneme na tlačítko pro rekrutování
          const recruitBtn = document.querySelector('input[type="submit"]');
          if (recruitBtn && !recruitBtn.disabled) {
            recruitBtn.click();
            return true;
          }
        }, 500);

        return true;
      }, { unitType, count });

      if (recruited) {
        // Počkej na odezvu serveru + human-like delay (1.5-3s)
        await humanDelay(1500, 3000);

        return true;
      }

      return false;
    } catch (error) {
      logger.error(`Chyba při rekrutování ${unitType} x${count}`, this.getAccountName(), error);
      return false;
    }
  }

  /**
   * Hlavní funkce - naplní frontu na 8 hodin V KAŽDÉ BUDOVĚ ZVLÁŠŤ podle šablony
   */
  async startRecruiting(templateName) {
    try {
      // Načti šablonu
      const template = this.getTemplate(templateName);
      if (!template) {
        return false;
      }

      // Zjisti co je potřeba narekrutovat
      const toRecruit = await this.checkWhatToRecruit(template);
      if (!toRecruit || Object.keys(toRecruit).length === 0) {
        return true;
      }

      const worldUrl = this.getWorldUrl();

      // Přejdeme na kasárna pro zjištění fronty
      await humanDelay(2000, 4000);
      await this.page.goto(`${worldUrl}/game.php?screen=barracks`, {
        waitUntil: 'networkidle',
        timeout: 30000
      });
      await simulateReading(this.page, 2000);

      // Zjisti čas ve frontě kasáren
      const barracksQueue = await this.checkBuildingQueue('barracks');

      // Pokud kasárna >= 7h, přeskoč
      if (barracksQueue >= 7 * 3600) {
        return true;
      }

      // Filtruj pouze jednotky z kasáren co jsou v deficitu a jsou v šabloně
      const barracksUnits = ['spear', 'sword', 'axe', 'archer'];
      const barracksDeficit = {};

      barracksUnits.forEach(unitType => {
        if (toRecruit[unitType] && toRecruit[unitType].needed > 0) {
          barracksDeficit[unitType] = toRecruit[unitType];
        }
      });

      if (Object.keys(barracksDeficit).length === 0) {
        return true;
      }

      // Vypočítej kolik chybí do 8h v kasárnách
      const missingTime = this.targetQueueTime - barracksQueue;

      // Získej aktuální suroviny
      const resources = await this.getCurrentResources();

      // Odečti rezervu 1000 od každé suroviny
      resources.wood -= 1000;
      resources.stone -= 1000;
      resources.iron -= 1000;

      // Vypočítej poměr podle SUROVIN (ne podle šablony!)
      const woodRatio = resources.wood / (resources.wood + resources.iron);
      const ironRatio = resources.iron / (resources.wood + resources.iron);

      // Rozhodni které jednotky upřednostnit podle surovin
      const woodUnits = [];
      const ironUnits = [];

      Object.keys(barracksDeficit).forEach(unitType => {
        const costs = this.unitData[unitType];
        if (costs.wood > costs.iron * 1.5) {
          woodUnits.push(unitType);
        } else if (costs.iron > costs.wood * 1.5) {
          ironUnits.push(unitType);
        } else {
          if (woodRatio > ironRatio) {
            woodUnits.push(unitType);
          } else {
            ironUnits.push(unitType);
          }
        }
      });

      // Vypočítej poměr času pro jednotky
      let woodTimeRatio = woodUnits.length > 0 ? woodRatio : 0;
      let ironTimeRatio = ironUnits.length > 0 ? ironRatio : 0;

      const totalRatio = woodTimeRatio + ironTimeRatio;
      if (totalRatio > 0) {
        woodTimeRatio = woodTimeRatio / totalRatio;
        ironTimeRatio = ironTimeRatio / totalRatio;
      }

      // Pro každou jednotku v deficitu vypočítej kolik jich narekrutovat
      const toRecruitCounts = {};

      for (const unitType of Object.keys(barracksDeficit)) {
        const unitTime = await this.getUnitTime(unitType);
        if (unitTime === 0) {
          continue;
        }

        const isWoodUnit = woodUnits.includes(unitType);
        const timeForUnit = isWoodUnit
          ? (missingTime * woodTimeRatio) / woodUnits.length
          : (missingTime * ironTimeRatio) / ironUnits.length;

        const countByTime = Math.floor(timeForUnit / unitTime);

        const costs = this.unitData[unitType];
        const countByBudget = Math.floor(Math.min(
          resources.wood / costs.wood,
          resources.stone / costs.stone,
          resources.iron / costs.iron
        ));

        const deficit = barracksDeficit[unitType].needed;
        const finalCount = Math.min(countByTime, countByBudget, deficit);

        if (finalCount > 0) {
          toRecruitCounts[unitType] = finalCount;
          resources.wood -= finalCount * costs.wood;
          resources.stone -= finalCount * costs.stone;
          resources.iron -= finalCount * costs.iron;
        }
      }

      // Rekrutuj jednotky SEKVENČNĚ: nejdřív kopí, pak meče, pak ostatní
      if (toRecruitCounts['spear'] && toRecruitCounts['spear'] > 0) {
        await this.recruitUnits('spear', toRecruitCounts['spear']);
      }

      if (toRecruitCounts['sword'] && toRecruitCounts['sword'] > 0) {
        await this.recruitUnits('sword', toRecruitCounts['sword']);
      }

      for (const [unitType, count] of Object.entries(toRecruitCounts)) {
        if (unitType !== 'spear' && unitType !== 'sword' && count > 0) {
          await this.recruitUnits(unitType, count);
        }
      }

      return true;

    } catch (error) {
      logger.error(`Chyba při rekrutování`, this.getAccountName(), error);
      return false;
    }
  }

  /**
   * Alias pro zpětnou kompatibilitu
   */
  async setTemplate(templateName) {
    return true;
  }

  /**
   * Alias pro zpětnou kompatibilitu
   */
  async getRecruitStatus() {
    return {
      status: 'Running',
      message: 'Rekrutování běží'
    };
  }
}

export default RecruitModule;
