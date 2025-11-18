/**
 * Modul pro automatický výzkum jednotek
 * S podporou CZ i SK světů
 */

import logger from '../logger.js';

class ResearchModule {
  constructor(page, db, accountId) {
    this.page = page;
    this.db = db;
    this.accountId = accountId;
    this.accountName = null;

    // Aktuální šablona
    this.activeTemplate = this.loadTemplate();

    // Priorita výzkumu
    this.priority = [
      'spear', 'sword', 'axe', 'archer',
      'spy', 'light', 'marcher', 'heavy',
      'ram', 'catapult'
    ];
  }

  /**
   * Získá username pro logging
   */
  getAccountName() {
    if (!this.accountName) {
      const account = this.db.getAccountById(this.accountId);
      this.accountName = account?.username || `ID:${this.accountId}`;
    }
    return this.accountName;
  }

  /**
   * Načte šablonu z databáze
   */
  loadTemplate() {
    try {
      const account = this.db.getAccount(this.accountId);

      if (account?.research_template) {
        const templateName = typeof account.research_template === 'string'
          ? account.research_template
          : 'FARM';

        // Načteme šablonu z databáze
        const template = this.db.getTemplate('research', templateName);

        if (template) {
          return {
            name: template.name,
            levels: template.levels
          };
        }
      }

      // Výchozí FARM - načteme z databáze
      const defaultTemplate = this.db.getTemplate('research', 'FARM');
      if (defaultTemplate) {
        return {
          name: defaultTemplate.name,
          levels: defaultTemplate.levels
        };
      }

      // Fallback pokud databáze nemá šablony
      return {
        name: 'FARM',
        levels: {
          spear: 0, sword: 0, axe: 3, archer: 0, spy: 0,
          light: 0, marcher: 0, heavy: 0, ram: 0, catapult: 0, knight: 0, snob: 0
        }
      };
    } catch (error) {
      logger.error('Chyba při načítání šablony výzkumu', this.getAccountName(), error);
      return {
        name: 'FARM',
        levels: {
          spear: 0, sword: 0, axe: 3, archer: 0, spy: 0,
          light: 0, marcher: 0, heavy: 0, ram: 0, catapult: 0, knight: 0, snob: 0
        }
      };
    }
  }

  /**
   * Uloží šablonu do databáze (JSON kompatibilní)
   */
  saveTemplate(template) {
    try {
      this.db.updateResearchSettings(this.accountId, {
        researchTemplate: template.name || 'CUSTOM'
      });

      this.activeTemplate = template;
      return true;
    } catch (error) {
      logger.error('Chyba při ukládání šablony výzkumu', this.getAccountName(), error);
      return false;
    }
  }

  /**
   * Nastaví šablonu podle názvu
   */
  setTemplateByName(templateName) {
    const template = this.db.getTemplate('research', templateName);
    if (!template) {
      logger.error(`Šablona ${templateName} neexistuje v databázi`, this.getAccountName());
      return false;
    }
    return this.saveTemplate({
      name: template.name,
      levels: template.levels
    });
  }

  /**
   * 🆕 Získá URL světa (podporuje CZ i SK)
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
   * Přejde do kovárny
   */
  async goToSmith() {
    try {
      const worldUrl = this.getWorldUrl();
      await this.page.goto(`${worldUrl}/game.php?screen=smith`, {
        waitUntil: 'domcontentloaded'
      });
      await this.page.waitForTimeout(1500) // Sníženo z 2000ms;
      return true;
    } catch (error) {
      logger.error('Chyba při přechodu do kovárny', this.getAccountName(), error);
      return false;
    }
  }

  /**
   * Zkontroluje frontu výzkumu
   */
  async checkQueue() {
    try {
      return await this.page.evaluate(() => {
        const queue = document.getElementById('current_research');
        if (!queue) return { isResearching: false, units: [] };

        const rows = queue.querySelectorAll('tbody tr');
        const units = [];

        rows.forEach(row => {
          const sprite = row.querySelector('.unit_sprite');
          if (sprite) {
            const classes = sprite.className.split(' ');
            const unitType = classes.find(c => 
              ['spear', 'sword', 'axe', 'archer', 'spy', 'light', 
               'marcher', 'heavy', 'ram', 'catapult'].includes(c)
            );
            if (unitType) units.push(unitType);
          }
        });

        return {
          isResearching: units.length > 0,
          units: units
        };
      });
    } catch (error) {
      logger.error('Chyba při kontrole fronty výzkumu', this.getAccountName(), error);
      return { isResearching: false, units: [] };
    }
  }

  /**
   * Získá aktuální stav všech jednotek
   */
  async getStatus() {
    try {
      return await this.page.evaluate(() => {
        const result = {};
        const unitLinks = document.querySelectorAll('a.unit_link[data-unit]');

        unitLinks.forEach(link => {
          const unitType = link.getAttribute('data-unit');
          const row = link.closest('tr');
          if (!row) return;

          // Aktuální úroveň z textu
          const linkText = link.textContent.trim();
          const levelMatch = linkText.match(/\((\d+)\)/);
          const currentLevel = levelMatch ? parseInt(levelMatch[1]) : 0;

          // Detekce stavu
          const sprite = row.querySelector('.unit_sprite');
          const hasResearchButton = !!row.querySelector('a.btn-research');
          const hasCancelButton = !!row.querySelector('a.btn-cancel');
          const isGrey = sprite?.className.includes('_grey');
          const hasCross = sprite?.className.includes('_cross');
          const hasMaxText = row.innerText.includes('Maximální počet výzkumů dosažen');

          let canResearch = false;
          let isResearching = false;
          let maxReached = false;

          if (hasMaxText) {
            maxReached = true;
          } else if (hasCancelButton) {
            isResearching = true;
          } else if (hasResearchButton && !hasCross) {
            canResearch = true;
          } else if (isGrey && !hasCancelButton) {
            isResearching = true;
          }

          result[unitType] = {
            currentLevel: currentLevel,
            canResearch: canResearch,
            isResearching: isResearching,
            maxReached: maxReached,
            requirementsNotMet: hasCross
          };
        });

        return result;
      });
    } catch (error) {
      logger.error('Chyba při získávání stavu výzkumu', this.getAccountName(), error);
      return {};
    }
  }

  /**
   * Spustí výzkum jednotky
   */
  async research(unitType) {
    try {
      const success = await this.page.evaluate((unit) => {
        try {
          if (typeof BuildingSmith !== 'undefined' &&
              typeof BuildingSmith.research === 'function') {
            return BuildingSmith.research(unit);
          }
          return false;
        } catch (e) {
          return false;
        }
      }, unitType);

      if (success) {
        await this.page.waitForTimeout(1500);

        // Zjistíme cílovou úroveň z šablony
        const targetLevel = this.activeTemplate.levels[unitType] || 0;

        // LOGUJ AKCI
        logger.research(this.getAccountName(), unitType, targetLevel);
        return true;
      }

      return false;
    } catch (error) {
      logger.error(`Chyba při spouštění výzkumu ${unitType}`, this.getAccountName(), error);
      return false;
    }
  }

  /**
   * Najde jednotku k výzkumu podle priority a šablony
   */
  findNextToResearch(status) {
    const targetLevels = this.activeTemplate.levels;

    for (const unitType of this.priority) {
      const targetLevel = targetLevels[unitType] || 0;
      const unit = status[unitType];

      if (!unit || targetLevel === 0) continue;

      // Pokud jsme nedosáhli cíle a můžeme zkoumat
      if (unit.currentLevel < targetLevel && unit.canResearch && !unit.isResearching) {
        return {
          unitType: unitType,
          currentLevel: unit.currentLevel,
          targetLevel: targetLevel
        };
      }
    }
    return null;
  }

  /**
   * Uloží stav do databáze (JSON kompatibilní)
   */
  saveStatus(status) {
    try {
      this.db.updateAccountInfo(this.accountId, {
        research_status: JSON.stringify(status)
      });
    } catch (error) {
      // Silent error
    }
  }

  /**
   * Zobrazí přehled výzkumů (DEPRECATED - nepoužívá se)
   */
  displayStatus(status) {
    // Silent - no output
  }

  /**
   * Hlavní funkce - automatický výzkum
   */
  async autoResearch() {
    try {
      // Načti šablonu
      this.activeTemplate = this.loadTemplate();

      // Přejdi do kovárny
      if (!await this.goToSmith()) {
        return {
          success: false,
          message: 'Nepodařilo se přejít do kovárny',
          waitTime: 5 * 60 * 1000 // 5 minut
        };
      }

      // Zkontroluj frontu
      const queue = await this.checkQueue();
      if (queue.isResearching) {
        return {
          success: true,
          message: `Probíhá: ${queue.units.join(', ')}`,
          status: 'researching',
          waitTime: 10 * 60 * 1000 // 10 minut
        };
      }

      // Získej stav
      const status = await this.getStatus();
      this.saveStatus(status);

      // Najdi, co zkoumat
      const next = this.findNextToResearch(status);

      if (!next) {
        return {
          success: true,
          message: 'Vše hotovo',
          status: 'completed',
          data: status,
          waitTime: 30 * 60 * 1000 // 30 minut
        };
      }

      // Spusť výzkum (logger.research() je volán uvnitř research())
      const success = await this.research(next.unitType);

      if (success) {
        await this.page.waitForTimeout(1500);
        const updatedStatus = await this.getStatus();
        this.saveStatus(updatedStatus);

        return {
          success: true,
          message: `Spuštěn výzkum: ${next.unitType}`,
          status: 'started',
          unit: next.unitType,
          data: updatedStatus,
          waitTime: 15 * 60 * 1000 // 15 minut
        };
      }

      return {
        success: false,
        message: 'Nepodařilo se spustit výzkum',
        waitTime: 5 * 60 * 1000 // 5 minut
      };

    } catch (error) {
      logger.error('Chyba při automatickém výzkumu', this.getAccountName(), error);
      return {
        success: false,
        message: error.message,
        waitTime: 5 * 60 * 1000 // 5 minut
      };
    }
  }
}

export default ResearchModule;