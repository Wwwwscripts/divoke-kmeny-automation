/**
 * Modul pro automatické rekrutování jednotek
 * S podporou CZ i SK světů
 */

import logger from '../logger.js';

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
        const currentCount = unitsData[unitType]?.total || 0;
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
   * Zkontroluje, zda právě probíhá rekrutování v budově
   */
  async checkBuildingQueue(building) {
    try {
      const queueId = building === 'workshop' ? 'trainqueue_garage' : `trainqueue_${building}`;

      const hasQueue = await this.page.evaluate((queueId) => {
        const queueElement = document.getElementById(queueId);
        if (!queueElement) return false;

        const rows = queueElement.querySelectorAll('tr.sortable_row, tr.lit');
        return rows.length > 0;
      }, queueId);

      return hasQueue;
    } catch (error) {
      return false;
    }
  }

  /**
   * Narekrutuje jednu jednotku
   */
  async recruitUnit(unitType) {
    try {
      const worldUrl = this.getWorldUrl();

      // Přejdeme na stránku s rekrutováním
      const building = this.getBuildingForUnit(unitType);
      let buildingParam = building;
      if (building === 'workshop') buildingParam = 'garage';

      await this.page.goto(`${worldUrl}/game.php?screen=${buildingParam}`, {
        waitUntil: 'domcontentloaded'
      });

      await this.page.waitForTimeout(1500);

      // Najdeme input pro jednotku a nastavíme hodnotu 1
      const recruited = await this.page.evaluate((unitType) => {
        const input = document.querySelector(`input[name="${unitType}"]`);
        if (!input) return false;

        // Nastavíme hodnotu
        input.value = '1';
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
      }, unitType);

      if (recruited) {
        await this.page.waitForTimeout(1500);

        // LOGUJ AKCI
        logger.recruit(this.getAccountName(), unitType, 1);

        return true;
      }

      return false;
    } catch (error) {
      logger.error(`Chyba při rekrutování ${unitType}`, this.getAccountName(), error);
      return false;
    }
  }

  /**
   * Hlavní funkce - spustí rekrutování podle šablony
   */
  async startRecruiting(templateName) {
    try {
      const template = this.getTemplate(templateName);

      if (!template) {
        return false;
      }

      // Zkontrolujeme, co je potřeba narekrutovat
      const toRecruit = await this.checkWhatToRecruit(template);

      if (!toRecruit || Object.keys(toRecruit).length === 0) {
        // Tichý návrat - nic není potřeba rekrutovat
        return true;
      }

      // Projdeme všechny jednotky a zkusíme je narekrutovat
      for (const unitType of Object.keys(toRecruit)) {
        const building = this.getBuildingForUnit(unitType);

        // Zkontrolujeme, zda právě něco neběží v této budově
        const hasQueue = await this.checkBuildingQueue(building);
        if (hasQueue) {
          // Tichý skip - již běží rekrutování
          continue;
        }

        // Narekrutujeme jednu jednotku
        await this.recruitUnit(unitType);
        await this.page.waitForTimeout(1000);
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
