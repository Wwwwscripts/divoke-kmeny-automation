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

        // Najdi všechny řádky s časem
        const allRows = parentTable.querySelectorAll('tr.lit, tr.sortable_row');

        allRows.forEach(row => {
          const timeSpan = row.querySelector('span.timer, span[data-timestamp]');
          if (timeSpan) {
            const timeText = timeSpan.textContent.trim();
            // Parse formát HH:MM:SS nebo MM:SS
            const parts = timeText.split(':').map(p => parseInt(p) || 0);
            if (parts.length === 3) {
              total += parts[0] * 3600 + parts[1] * 60 + parts[2];
            } else if (parts.length === 2) {
              total += parts[0] * 60 + parts[1];
            }
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
      const recruited = await this.page.evaluate((unitType, count) => {
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
      }, unitType, count);

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
   * Hlavní funkce - naplní frontu na 8 hodin podle poměru surovin
   */
  async startRecruiting(templateName) {
    try {
      console.log(`\n${'='.repeat(60)}`);
      console.log(`[${this.getAccountName()}] 🎯 START REKRUTOVÁNÍ`);
      console.log('='.repeat(60));

      const worldUrl = this.getWorldUrl();

      // Přejdeme na kasárna pro zjištění fronty
      await humanDelay(2000, 4000);
      await this.page.goto(`${worldUrl}/game.php?screen=barracks`, {
        waitUntil: 'networkidle',
        timeout: 30000
      });
      await simulateReading(this.page, 2000);

      // Zjisti celkový čas ve frontě (barracks + stable + workshop)
      const barracksQueue = await this.checkBuildingQueue('barracks');
      const stableQueue = await this.checkBuildingQueue('stable');
      const workshopQueue = await this.checkBuildingQueue('workshop');

      const totalQueueTime = barracksQueue + stableQueue + workshopQueue;
      const totalQueueHours = (totalQueueTime / 3600).toFixed(1);

      console.log(`[${this.getAccountName()}] 📊 Fronta:`);
      console.log(`  - Kasárna: ${(barracksQueue / 3600).toFixed(1)}h`);
      console.log(`  - Stáj: ${(stableQueue / 3600).toFixed(1)}h`);
      console.log(`  - Dílna: ${(workshopQueue / 3600).toFixed(1)}h`);
      console.log(`  - CELKEM: ${totalQueueHours}h`);

      // Pokud fronta >= 7h, nic nedělej
      if (totalQueueTime >= 7 * 3600) {
        console.log(`[${this.getAccountName()}] ✅ Fronta plná (>= 7h), přeskakuji`);
        return true;
      }

      // Vypočítej kolik chybí do 8h
      const missingTime = this.targetQueueTime - totalQueueTime;
      const missingHours = (missingTime / 3600).toFixed(1);
      console.log(`[${this.getAccountName()}] 📉 Chybí: ${missingHours}h do cíle (8h)`);

      // Získej aktuální suroviny
      const resources = await this.getCurrentResources();
      console.log(`[${this.getAccountName()}] 💰 Suroviny:`);
      console.log(`  - Dřevo: ${resources.wood}`);
      console.log(`  - Hlína: ${resources.stone}`);
      console.log(`  - Železo: ${resources.iron}`);

      // Zjisti časy jednotek ze stránky
      const spearTime = await this.getUnitTime('spear');
      const swordTime = await this.getUnitTime('sword');

      console.log(`[${this.getAccountName()}] ⏱️  Časy jednotek:`);
      console.log(`  - Kopí: ${spearTime}s (${(spearTime / 60).toFixed(1)}min)`);
      console.log(`  - Sermíř: ${swordTime}s (${(swordTime / 60).toFixed(1)}min)`);

      if (spearTime === 0 || swordTime === 0) {
        logger.error('Nepodařilo se zjistit časy jednotek', this.getAccountName());
        return false;
      }

      // Vypočítej poměr dřeva vs železa
      const woodRatio = resources.wood / (resources.wood + resources.iron);
      const ironRatio = resources.iron / (resources.wood + resources.iron);

      console.log(`[${this.getAccountName()}] 📊 Poměr surovin:`);
      console.log(`  - Dřevo: ${(woodRatio * 100).toFixed(1)}%`);
      console.log(`  - Železo: ${(ironRatio * 100).toFixed(1)}%`);

      // Rozhodnutí: pokud rozdíl > 30%, upřednostni jednu jednotku
      let spearRatio = 0.5;
      let swordRatio = 0.5;

      if (woodRatio > ironRatio * 1.3) {
        // Hodně dřeva - upřednostni kopí
        spearRatio = 0.5 + (woodRatio - ironRatio);
        swordRatio = 1 - spearRatio;
        console.log(`[${this.getAccountName()}] 🌲 Hodně dřeva -> upřednostňuji kopí`);
      } else if (ironRatio > woodRatio * 1.3) {
        // Hodně železa - upřednostni sermíře
        swordRatio = 0.5 + (ironRatio - woodRatio);
        spearRatio = 1 - swordRatio;
        console.log(`[${this.getAccountName()}] ⚙️  Hodně železa -> upřednostňuji sermíře`);
      } else {
        console.log(`[${this.getAccountName()}] ⚖️  Podobný poměr -> 50/50`);
      }

      console.log(`[${this.getAccountName()}] 🎲 Rozložení:`);
      console.log(`  - Kopí: ${(spearRatio * 100).toFixed(1)}%`);
      console.log(`  - Sermíř: ${(swordRatio * 100).toFixed(1)}%`);

      // Vypočítej kolik jednotek se vejde do času
      const spearCount = Math.floor((missingTime * spearRatio) / spearTime);
      const swordCount = Math.floor((missingTime * swordRatio) / swordTime);

      // Omezení podle rozpočtu
      const spearAffordable = Math.floor(Math.min(
        resources.wood / this.unitData.spear.wood,
        resources.stone / this.unitData.spear.stone,
        resources.iron / this.unitData.spear.iron
      ));
      const swordAffordable = Math.floor(Math.min(
        resources.wood / this.unitData.sword.wood,
        resources.stone / this.unitData.sword.stone,
        resources.iron / this.unitData.sword.iron
      ));

      console.log(`[${this.getAccountName()}] 🧮 Výpočet:`);
      console.log(`  - Kopí (čas): ${spearCount}`);
      console.log(`  - Kopí (rozpočet): ${spearAffordable}`);
      console.log(`  - Sermíř (čas): ${swordCount}`);
      console.log(`  - Sermíř (rozpočet): ${swordAffordable}`);

      const finalSpearCount = Math.min(spearCount, spearAffordable);
      const finalSwordCount = Math.min(swordCount, swordAffordable);

      console.log(`[${this.getAccountName()}] ✅ FINÁLNÍ POČTY:`);
      console.log(`  - Kopí: ${finalSpearCount}`);
      console.log(`  - Sermíř: ${finalSwordCount}`);

      // Rekrutuj kopí (pokud nějaké)
      if (finalSpearCount > 0) {
        console.log(`[${this.getAccountName()}] 🎯 Rekrutuji ${finalSpearCount}x kopí...`);
        await this.recruitUnits('spear', finalSpearCount);
      }

      // Rekrutuj sermíře (pokud nějaké)
      if (finalSwordCount > 0) {
        console.log(`[${this.getAccountName()}] 🎯 Rekrutuji ${finalSwordCount}x sermíř...`);
        await this.recruitUnits('sword', finalSwordCount);
      }

      console.log(`[${this.getAccountName()}] ✅ HOTOVO`);
      console.log('='.repeat(60) + '\n');

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
