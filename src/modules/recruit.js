/**
 * Modul pro automatické rekrutování jednotek
 * S podporou CZ i SK světů
 */

class RecruitModule {
  constructor(page, db, accountId) {
    this.page = page;
    this.db = db;
    this.accountId = accountId;
    this.buildingPositions = {
      barracks: 0,
      stable: 0,
      workshop: 0
    };
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
        console.error(`❌ Šablona ${templateName} neexistuje v databázi`);
        return null;
      }

      // Vrátíme units z šablony
      return template.units || {};
    } catch (error) {
      console.error('❌ Chyba při načítání šablony:', error.message);
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
   */
  async getVillageUnits() {
    try {
      console.log('📊 Zjišťuji jednotky ve vesnici...');

      const worldUrl = this.getWorldUrl();

      await this.page.goto(`${worldUrl}/game.php?screen=train`, {
        waitUntil: 'domcontentloaded'
      });

      await this.page.waitForTimeout(2000);

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

      console.log('✅ Informace o jednotkách získány');
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
      this.db.updateAccountInfo(this.accountId, {
        units_info: JSON.stringify(unitsData)
      });

      console.log('✅ Informace o jednotkách uloženy do databáze');
    } catch (error) {
      console.error('❌ Chyba při ukládání jednotek:', error.message);
    }
  }

  /**
   * Získá a uloží kompletní informace o jednotkách
   */
  async collectUnitsInfo() {
    const unitsData = await this.getVillageUnits();
    if (unitsData) {
      await this.saveUnitsToDatabase(unitsData);
      
      console.log('\n' + '='.repeat(60));
      console.log('⚔️  PŘEHLED JEDNOTEK');
      console.log('='.repeat(60));
      
      Object.keys(unitsData).forEach(unitType => {
        const unit = unitsData[unitType];
        console.log(`${unitType}: ${unit.inVillage} ve vesnici / ${unit.total} celkem`);
      });
      
      console.log('='.repeat(60));
    }

    return unitsData;
  }

  /**
   * Zkontroluje, co je potřeba narekrutovat podle šablony
   */
  async checkWhatToRecruit(template) {
    try {
      const unitsData = await this.getVillageUnits();
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
      console.error('❌ Chyba při kontrole:', error.message);
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
      console.log(`🔨 Rekrutuji: ${unitType}`);

      const worldUrl = this.getWorldUrl();

      // Přejdeme na stránku s rekrutováním
      const building = this.getBuildingForUnit(unitType);
      let buildingParam = building;
      if (building === 'workshop') buildingParam = 'garage';

      await this.page.goto(`${worldUrl}/game.php?screen=${buildingParam}`, {
        waitUntil: 'domcontentloaded'
      });

      await this.page.waitForTimeout(2000);

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
        await this.page.waitForTimeout(2000);
        console.log(`✅ ${unitType} narekrutováno`);
        return true;
      }

      return false;
    } catch (error) {
      console.error(`❌ Chyba při rekrutování ${unitType}:`, error.message);
      return false;
    }
  }

  /**
   * Hlavní funkce - spustí rekrutování podle šablony
   */
  async startRecruiting(templateName) {
    try {
      console.log(`🚀 Spouštím rekrutování podle šablony: ${templateName}`);

      const template = this.getTemplate(templateName);

      if (!template) {
        console.error(`❌ Šablona ${templateName} neexistuje v databázi`);
        return false;
      }

      // Zkontrolujeme, co je potřeba narekrutovat
      const toRecruit = await this.checkWhatToRecruit(template);

      if (!toRecruit || Object.keys(toRecruit).length === 0) {
        console.log('✅ Všechny jednotky jsou na cílovém počtu');
        return true;
      }

      console.log('\n📋 Potřeba narekrutovat:');
      Object.keys(toRecruit).forEach(unitType => {
        const data = toRecruit[unitType];
        console.log(`   ${unitType}: ${data.current}/${data.target} (chybí: ${data.needed})`);
      });

      // Projdeme všechny jednotky a zkusíme je narekrutovat
      for (const unitType of Object.keys(toRecruit)) {
        const building = this.getBuildingForUnit(unitType);
        
        // Zkontrolujeme, zda právě něco neběží v této budově
        const hasQueue = await this.checkBuildingQueue(building);
        if (hasQueue) {
          console.log(`⏳ ${building}: Již běží rekrutování, přeskakuji`);
          continue;
        }

        // Narekrutujeme jednu jednotku
        await this.recruitUnit(unitType);
        await this.page.waitForTimeout(1000);
      }

      console.log('✅ Rekrutování dokončeno');
      return true;

    } catch (error) {
      console.error(`❌ Chyba při rekrutování:`, error.message);
      return false;
    }
  }

  /**
   * Alias pro zpětnou kompatibilitu
   */
  async setTemplate(templateName) {
    // Už se nepoužívá, ale necháme pro kompatibilitu
    console.log(`📋 Šablona nastavena: ${templateName}`);
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