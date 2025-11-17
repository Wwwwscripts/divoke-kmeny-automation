/**
 * Modul pro automatický výzkum jednotek
 * S podporou CZ i SK světů
 */

class ResearchModule {
  constructor(page, db, accountId) {
    this.page = page;
    this.db = db;
    this.accountId = accountId;
    
    // Předpřipravené šablony
    this.templates = {
      FARM: {
        name: 'Farm',
        description: 'Optimalizováno pro farmění',
        levels: {
          spear: 1, sword: 1, axe: 0, archer: 1,
          spy: 1, light: 0, marcher: 0, heavy: 0,
          ram: 0, catapult: 1
        }
      },
      DEF: {
        name: 'Obrana',
        description: 'Obranná vesnice',
        levels: {
          spear: 3, sword: 3, axe: 0, archer: 0,
          spy: 1, light: 0, marcher: 0, heavy: 0,
          ram: 0, catapult: 0
        }
      },
      OFF: {
        name: 'Útok',
        description: 'Útočná vesnice',
        levels: {
          spear: 0, sword: 0, axe: 3, archer: 0,
          spy: 0, light: 3, marcher: 0, heavy: 0,
          ram: 1, catapult: 1
        }
      },
      FULL: {
        name: 'Plný výzkum',
        description: 'Vše na maximum',
        levels: {
          spear: 3, sword: 3, axe: 3, archer: 3,
          spy: 1, light: 3, marcher: 3, heavy: 3,
          ram: 1, catapult: 1
        }
      }
    };

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
   * Načte šablonu z databáze (JSON kompatibilní)
   */
  loadTemplate() {
    try {
      const account = this.db.getAccount(this.accountId);
      
      if (account?.research_template) {
        // Pokud je to název šablony, vrátíme šablonu
        if (typeof account.research_template === 'string') {
          const templateName = account.research_template;
          if (this.templates[templateName]) {
            return { ...this.templates[templateName] };
          }
        }
        
        // Pokud je to celý JSON objekt
        if (typeof account.research_template === 'object') {
          return account.research_template;
        }
      }

      // Výchozí FARM
      return { ...this.templates.FARM };
    } catch (error) {
      console.error('❌ Chyba při načítání šablony:', error.message);
      return { ...this.templates.FARM };
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
      console.log('✅ Šablona výzkumu uložena');
      return true;
    } catch (error) {
      console.error('❌ Chyba při ukládání šablony:', error.message);
      return false;
    }
  }

  /**
   * Nastaví šablonu podle názvu
   */
  setTemplateByName(templateName) {
    const template = this.templates[templateName];
    if (!template) {
      console.error(`❌ Šablona ${templateName} neexistuje`);
      return false;
    }
    return this.saveTemplate(template);
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
      await this.page.waitForTimeout(2000);
      return true;
    } catch (error) {
      console.error('❌ Chyba při přechodu do kovárny:', error.message);
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
      console.error('❌ Chyba při kontrole fronty:', error.message);
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
      console.error('❌ Chyba při získávání stavu:', error.message);
      return {};
    }
  }

  /**
   * Spustí výzkum jednotky
   */
  async research(unitType) {
    try {
      console.log(`🔬 Spouštím výzkum: ${unitType}`);

      const success = await this.page.evaluate((unit) => {
        try {
          if (typeof BuildingSmith !== 'undefined' && 
              typeof BuildingSmith.research === 'function') {
            return BuildingSmith.research(unit);
          }
          return false;
        } catch (e) {
          console.error('Chyba při volání BuildingSmith.research:', e);
          return false;
        }
      }, unitType);

      if (success) {
        await this.page.waitForTimeout(2000);
        console.log(`✅ Výzkum ${unitType} spuštěn`);
        return true;
      }

      console.log(`❌ Nepodařilo se spustit výzkum ${unitType}`);
      return false;
    } catch (error) {
      console.error(`❌ Chyba při spouštění výzkumu:`, error.message);
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
      console.error('❌ Chyba při ukládání stavu:', error.message);
    }
  }

  /**
   * Zobrazí přehled výzkumů
   */
  displayStatus(status) {
    console.log('\n' + '='.repeat(70));
    console.log(`🔬 PŘEHLED VÝZKUMŮ - Šablona: ${this.activeTemplate.name}`);
    console.log('='.repeat(70));

    Object.keys(status).forEach(unitType => {
      const unit = status[unitType];
      const target = this.activeTemplate.levels[unitType] || 0;
      
      if (target === 0) return; // Přeskočit jednotky s cílem 0

      let emoji = '❓';
      let statusText = '';

      if (unit.maxReached) {
        emoji = '🏁';
        statusText = 'Max úroveň';
      } else if (unit.isResearching) {
        emoji = '⏳';
        statusText = 'Zkoumá se';
      } else if (unit.requirementsNotMet) {
        emoji = '🔒';
        statusText = 'Nesplněné požadavky';
      } else if (unit.currentLevel >= target) {
        emoji = '✅';
        statusText = 'Hotovo';
      } else if (unit.canResearch) {
        emoji = '🔨';
        statusText = 'Připraveno';
      } else {
        emoji = '❌';
        statusText = 'Nelze zkoumat';
      }

      console.log(
        `${emoji} ${unitType.padEnd(10)} | ` +
        `${unit.currentLevel}/${target} | ` +
        `${statusText}`
      );
    });

    console.log('='.repeat(70));
  }

  /**
   * Hlavní funkce - automatický výzkum
   */
  async autoResearch() {
    try {
      console.log('🚀 Spouštím automatický výzkum...');

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
        console.log(`⏳ Právě probíhá výzkum: ${queue.units.join(', ')}`);
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
      this.displayStatus(status);

      // Najdi, co zkoumat
      const next = this.findNextToResearch(status);
      
      if (!next) {
        console.log('✅ Všechny jednotky jsou na cílové úrovni');
        return { 
          success: true, 
          message: 'Vše hotovo', 
          status: 'completed', 
          data: status,
          waitTime: 30 * 60 * 1000 // 30 minut
        };
      }

      console.log(
        `📋 Další k výzkumu: ${next.unitType} ` +
        `(${next.currentLevel} → ${next.targetLevel})`
      );

      // Spusť výzkum
      const success = await this.research(next.unitType);
      
      if (success) {
        await this.page.waitForTimeout(2000);
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
      console.error('❌ Chyba při automatickém výzkumu:', error.message);
      return { 
        success: false, 
        message: error.message,
        waitTime: 5 * 60 * 1000 // 5 minut
      };
    }
  }
}

export default ResearchModule;