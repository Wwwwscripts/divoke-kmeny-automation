/**
 * Modul pro automatickou výstavbu budov
 * S inteligentní detekcí skladu a farmy + ochranou proti opakování
 */

import logger from '../logger.js';

class BuildingModule {
  constructor(page, db, accountId) {
    this.page = page;
    this.db = db;
    this.accountId = accountId;
    this.accountName = null;

    // 🆕 Paměť pro zamezení opakovaného stavění
    this.lastWarehouseAttempt = 0;
    this.lastFarmAttempt = 0;
    this.attemptCooldown = 10 * 60 * 1000; // 10 minut cooldown
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
   * Dostupné šablony výstavby
   */
  getTemplates() {
    return {
      FULL_VILLAGE: [
        { building: 'Headquarters', level: 1 },
        { building: 'Timber camp', level: 1 },
        { building: 'Clay pit', level: 1 },
        { building: 'Iron mine', level: 1 },
        { building: 'Timber camp', level: 2 },
        { building: 'Hiding place', level: 2 },
        { building: 'Clay pit', level: 2 },
        { building: 'Iron mine', level: 2 },
        { building: 'Timber camp', level: 3 },
        { building: 'Clay pit', level: 3 },
        { building: 'Iron mine', level: 3 },
        { building: 'Timber camp', level: 4 },
        { building: 'Clay pit', level: 4 },
        { building: 'Iron mine', level: 4 },
        { building: 'Timber camp', level: 5 },
        { building: 'Clay pit', level: 5 },
        { building: 'Iron mine', level: 5 },
        { building: 'Timber camp', level: 6 },
        { building: 'Clay pit', level: 6 },
        { building: 'Iron mine', level: 6 },
        { building: 'Timber camp', level: 7 },
        { building: 'Clay pit', level: 7 },
        { building: 'Iron mine', level: 7 },
        { building: 'Timber camp', level: 8 },
        { building: 'Clay pit', level: 8 },
        { building: 'Iron mine', level: 8 },
        { building: 'Timber camp', level: 9 },
        { building: 'Clay pit', level: 9 },
        { building: 'Iron mine', level: 9 },
        { building: 'Timber camp', level: 10 },
        { building: 'Clay pit', level: 10 },
        { building: 'Iron mine', level: 10 },
        { building: 'Timber camp', level: 11 },
        { building: 'Clay pit', level: 11 },
        { building: 'Timber camp', level: 12 },
        { building: 'Clay pit', level: 12 },
        { building: 'Iron mine', level: 11 },
        { building: 'Timber camp', level: 13 },
        { building: 'Clay pit', level: 13 },
        { building: 'Timber camp', level: 14 },
        { building: 'Clay pit', level: 14 },
        { building: 'Iron mine', level: 12 },
        { building: 'Timber camp', level: 15 },
        { building: 'Clay pit', level: 15 },
        { building: 'Timber camp', level: 16 },
        { building: 'Clay pit', level: 16 },
        { building: 'Iron mine', level: 13 },
        { building: 'Timber camp', level: 17 },
        { building: 'Clay pit', level: 17 },
        { building: 'Headquarters', level: 2 },
        { building: 'Headquarters', level: 3 },
        { building: 'Headquarters', level: 4 },
        { building: 'Headquarters', level: 5 },
        { building: 'Headquarters', level: 6 },
        { building: 'Headquarters', level: 7 },
        { building: 'Headquarters', level: 8 },
        { building: 'Headquarters', level: 9 },
        { building: 'Headquarters', level: 10 },
        { building: 'Farm', level: 1 },
        { building: 'Farm', level: 2 },
        { building: 'Farm', level: 3 },
        { building: 'Farm', level: 4 },
        { building: 'Farm', level: 5 },
        { building: 'Farm', level: 6 },
        { building: 'Farm', level: 7 },
        { building: 'Farm', level: 8 },
        { building: 'Farm', level: 9 },
        { building: 'Farm', level: 10 },
        { building: 'Barracks', level: 1 },
        { building: 'Barracks', level: 2 },
        { building: 'Barracks', level: 3 },
        { building: 'Barracks', level: 4 },
        { building: 'Barracks', level: 5 },
        { building: 'Smithy', level: 1 },
        { building: 'Smithy', level: 2 },
        { building: 'Smithy', level: 3 },
        { building: 'Smithy', level: 4 },
        { building: 'Smithy', level: 5 },
        { building: 'Wall', level: 1 },
        { building: 'Wall', level: 2 },
        { building: 'Wall', level: 3 },
        { building: 'Wall', level: 4 },
        { building: 'Wall', level: 5 },
        { building: 'Wall', level: 6 },
        { building: 'Stable', level: 1 },
        { building: 'Wall', level: 7 },
        { building: 'Wall', level: 8 },
        { building: 'Wall', level: 9 },
        { building: 'Wall', level: 10 },
        { building: 'Timber camp', level: 18 },
        { building: 'Clay pit', level: 18 },
        { building: 'Iron mine', level: 14 },
        { building: 'Timber camp', level: 19 },
        { building: 'Clay pit', level: 19 },
        { building: 'Iron mine', level: 15 },
        { building: 'Timber camp', level: 20 },
        { building: 'Clay pit', level: 20 },
        { building: 'Iron mine', level: 16 },
        { building: 'Timber camp', level: 21 },
        { building: 'Clay pit', level: 21 },
        { building: 'Iron mine', level: 17 },
        { building: 'Timber camp', level: 22 },
        { building: 'Clay pit', level: 22 },
        { building: 'Iron mine', level: 18 },
        { building: 'Timber camp', level: 23 },
        { building: 'Clay pit', level: 23 },
        { building: 'Iron mine', level: 19 },
        { building: 'Timber camp', level: 24 },
        { building: 'Clay pit', level: 24 },
        { building: 'Iron mine', level: 20 },
        { building: 'Timber camp', level: 25 },
        { building: 'Barracks', level: 6 },
        { building: 'Barracks', level: 7 },
        { building: 'Barracks', level: 8 },
        { building: 'Barracks', level: 9 },
        { building: 'Barracks', level: 10 },
        { building: 'Barracks', level: 11 },
        { building: 'Barracks', level: 12 },
        { building: 'Barracks', level: 13 },
        { building: 'Barracks', level: 14 },
        { building: 'Barracks', level: 15 },
        { building: 'Headquarters', level: 11 },
        { building: 'Headquarters', level: 12 },
        { building: 'Headquarters', level: 13 },
        { building: 'Headquarters', level: 14 },
        { building: 'Headquarters', level: 15 },
        { building: 'Headquarters', level: 16 },
        { building: 'Headquarters', level: 17 },
        { building: 'Wall', level: 11 },
        { building: 'Wall', level: 12 },
        { building: 'Wall', level: 13 },
        { building: 'Wall', level: 14 },
        { building: 'Wall', level: 15 },
        { building: 'Clay pit', level: 25 },
        { building: 'Iron mine', level: 21 },
        { building: 'Timber camp', level: 26 },
        { building: 'Clay pit', level: 26 },
        { building: 'Iron mine', level: 22 },
        { building: 'Timber camp', level: 27 },
        { building: 'Clay pit', level: 27 },
        { building: 'Iron mine', level: 23 },
        { building: 'Timber camp', level: 28 },
        { building: 'Clay pit', level: 28 },
        { building: 'Iron mine', level: 24 },
        { building: 'Timber camp', level: 29 },
        { building: 'Clay pit', level: 29 },
        { building: 'Iron mine', level: 25 },
        { building: 'Timber camp', level: 30 },
        { building: 'Clay pit', level: 30 },
        { building: 'Iron mine', level: 26 },
        { building: 'Iron mine', level: 27 },
        { building: 'Iron mine', level: 28 },
        { building: 'Iron mine', level: 29 },
        { building: 'Iron mine', level: 30 }
      ],
      WAREHOUSE: [
        { building: 'Warehouse', level: 1 },
        { building: 'Warehouse', level: 2 },
        { building: 'Warehouse', level: 3 },
        { building: 'Warehouse', level: 4 },
        { building: 'Warehouse', level: 5 },
        { building: 'Warehouse', level: 6 },
        { building: 'Warehouse', level: 7 },
        { building: 'Warehouse', level: 8 },
        { building: 'Warehouse', level: 9 },
        { building: 'Warehouse', level: 10 },
        { building: 'Warehouse', level: 11 },
        { building: 'Warehouse', level: 12 },
        { building: 'Warehouse', level: 13 },
        { building: 'Warehouse', level: 14 },
        { building: 'Warehouse', level: 15 },
        { building: 'Warehouse', level: 16 },
        { building: 'Warehouse', level: 17 },
        { building: 'Warehouse', level: 18 },
        { building: 'Warehouse', level: 19 },
        { building: 'Warehouse', level: 20 },
        { building: 'Warehouse', level: 21 },
        { building: 'Warehouse', level: 22 },
        { building: 'Warehouse', level: 23 },
        { building: 'Warehouse', level: 24 },
        { building: 'Warehouse', level: 25 },
        { building: 'Warehouse', level: 26 },
        { building: 'Warehouse', level: 27 },
        { building: 'Warehouse', level: 28 },
        { building: 'Warehouse', level: 29 },
        { building: 'Warehouse', level: 30 }
      ],
      RESOURCES: [
        { building: 'Timber camp', level: 1 },
        { building: 'Clay pit', level: 1 },
        { building: 'Iron mine', level: 1 },
        { building: 'Timber camp', level: 2 },
        { building: 'Clay pit', level: 2 },
        { building: 'Iron mine', level: 2 },
        { building: 'Timber camp', level: 3 },
        { building: 'Clay pit', level: 3 },
        { building: 'Iron mine', level: 3 },
        { building: 'Timber camp', level: 4 },
        { building: 'Clay pit', level: 4 },
        { building: 'Iron mine', level: 4 },
        { building: 'Timber camp', level: 5 },
        { building: 'Clay pit', level: 5 },
        { building: 'Iron mine', level: 5 },
        { building: 'Timber camp', level: 6 },
        { building: 'Clay pit', level: 6 },
        { building: 'Iron mine', level: 6 },
        { building: 'Timber camp', level: 7 },
        { building: 'Clay pit', level: 7 },
        { building: 'Iron mine', level: 7 },
        { building: 'Timber camp', level: 8 },
        { building: 'Clay pit', level: 8 },
        { building: 'Iron mine', level: 8 },
        { building: 'Timber camp', level: 9 },
        { building: 'Clay pit', level: 9 },
        { building: 'Iron mine', level: 9 },
        { building: 'Timber camp', level: 10 },
        { building: 'Clay pit', level: 10 },
        { building: 'Iron mine', level: 10 }
      ],
      NOBLE: [
        { building: 'Headquarters', level: 1 },
        { building: 'Headquarters', level: 2 },
        { building: 'Headquarters', level: 3 },
        { building: 'Headquarters', level: 4 },
        { building: 'Headquarters', level: 5 },
        { building: 'Headquarters', level: 6 },
        { building: 'Headquarters', level: 7 },
        { building: 'Headquarters', level: 8 },
        { building: 'Headquarters', level: 9 },
        { building: 'Headquarters', level: 10 },
        { building: 'Headquarters', level: 11 },
        { building: 'Headquarters', level: 12 },
        { building: 'Headquarters', level: 13 },
        { building: 'Headquarters', level: 14 },
        { building: 'Headquarters', level: 15 },
        { building: 'Headquarters', level: 16 },
        { building: 'Headquarters', level: 17 },
        { building: 'Headquarters', level: 18 },
        { building: 'Headquarters', level: 19 },
        { building: 'Headquarters', level: 20 },
        { building: 'Smithy', level: 1 },
        { building: 'Smithy', level: 2 },
        { building: 'Smithy', level: 3 },
        { building: 'Smithy', level: 4 },
        { building: 'Smithy', level: 5 },
        { building: 'Smithy', level: 6 },
        { building: 'Smithy', level: 7 },
        { building: 'Smithy', level: 8 },
        { building: 'Smithy', level: 9 },
        { building: 'Smithy', level: 10 },
        { building: 'Smithy', level: 11 },
        { building: 'Smithy', level: 12 },
        { building: 'Smithy', level: 13 },
        { building: 'Smithy', level: 14 },
        { building: 'Smithy', level: 15 },
        { building: 'Smithy', level: 16 },
        { building: 'Smithy', level: 17 },
        { building: 'Smithy', level: 18 },
        { building: 'Smithy', level: 19 },
        { building: 'Smithy', level: 20 },
        { building: 'Academy', level: 1 }
      ]
    };
  }

  /**
   * Mapování názvů budov na interní názvy
   */
  getBuildingInternalName(buildingName) {
    const mapping = {
      'Headquarters': 'main',
      'Barracks': 'barracks',
      'Stable': 'stable',
      'Workshop': 'garage',
      'Academy': 'snob',
      'Smithy': 'smith',
      'Rally point': 'place',
      'Statue': 'statue',
      'Market': 'market',
      'Timber camp': 'wood',
      'Clay pit': 'stone',
      'Iron mine': 'iron',
      'Farm': 'farm',
      'Warehouse': 'storage',
      'Hiding place': 'hide',
      'Wall': 'wall'
    };
    return mapping[buildingName] || buildingName.toLowerCase();
  }

  /**
   * Získá aktuální úrovně budov VČETNĚ těch ve frontě
   */
  async getCurrentBuildings() {
    try {
      const currentUrl = this.page.url();
      
      // Zjisti svět (CZ nebo SK)
      let worldMatch = currentUrl.match(/\/\/([^.]+)\.divokekmeny\.cz/);
      let worldUrl = worldMatch ? `https://${worldMatch[1]}.divokekmeny.cz` : null;
      
      if (!worldUrl) {
        worldMatch = currentUrl.match(/\/\/([^.]+)\.divoke-kmene\.sk/);
        worldUrl = worldMatch ? `https://${worldMatch[1]}.divoke-kmene.sk` : null;
      }
      
      if (!worldUrl) return null;

      if (!currentUrl.includes('screen=main')) {
        await this.page.goto(`${worldUrl}/game.php?screen=main`, {
          waitUntil: 'domcontentloaded'
        });
        await this.page.waitForTimeout(1500); // Sníženo z 3000ms
      }

      await this.page.waitForSelector('#buildings', { timeout: 10000 });
      await this.page.waitForTimeout(1000); // Sníženo z 2000ms

      const buildings = await this.page.evaluate(() => {
        const buildingsList = [];
        
        const czechToEnglish = {
          'Hlavní budova': 'Headquarters',
          'Kasárna': 'Barracks',
          'Stáj': 'Stable',
          'Dílna': 'Workshop',
          'Panský dvůr': 'Academy',
          'Kovárna': 'Smithy',
          'Nádvoří': 'Rally point',
          'Socha': 'Statue',
          'Tržiště': 'Market',
          'Dřevorubec': 'Timber camp',
          'Lom na těžbu hlíny': 'Clay pit',
          'Železný důl': 'Iron mine',
          'Selský dvůr': 'Farm',
          'Skladiště': 'Warehouse',
          'Skrýš': 'Hiding place',
          'Hradby': 'Wall',
          'Headquarters': 'Headquarters',
          'Barracks': 'Barracks',
          'Stable': 'Stable',
          'Workshop': 'Workshop',
          'Academy': 'Academy',
          'Smithy': 'Smithy',
          'Rally point': 'Rally point',
          'Statue': 'Statue',
          'Market': 'Market',
          'Timber camp': 'Timber camp',
          'Clay pit': 'Clay pit',
          'Iron mine': 'Iron mine',
          'Farm': 'Farm',
          'Warehouse': 'Warehouse',
          'Hiding place': 'Hiding place',
          'Wall': 'Wall'
        };

        let rows = document.querySelectorAll('[id^="main_buildrow_"]');
        
        if (rows.length === 0) {
          const buildingsTable = document.getElementById('buildings');
          if (buildingsTable) {
            rows = buildingsTable.querySelectorAll('tr[id^="main_buildrow_"]');
          }
        }

        rows.forEach(row => {
          try {
            let nameElement = row.querySelector('.b_title');
            if (!nameElement) {
              nameElement = row.querySelector('td:first-child');
            }
            
            if (nameElement) {
              let fullText = nameElement.textContent.trim();
              fullText = fullText.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
              
              const levelMatch = fullText.match(/Stupeň\s+(\d+)/i) || 
                                fullText.match(/Úroveň\s+(\d+)/i) ||
                                fullText.match(/Level\s+(\d+)/i);
              
              let level = 0;
              if (levelMatch) {
                level = parseInt(levelMatch[1]);
              }
              
              let buildingName = fullText.split(/Stupeň|Úroveň|Level/i)[0].trim();
              buildingName = czechToEnglish[buildingName] || buildingName;

              buildingsList.push({
                name: buildingName,
                level: level
              });
            }
          } catch (e) {
            console.error('Chyba při zpracování řádku:', e);
          }
        });

        const buildQueue = document.getElementById('buildqueue');
        if (buildQueue) {
          const queueRows = buildQueue.querySelectorAll('tr');
          
          queueRows.forEach((row, index) => {
            if (index < 1) return;
            
            try {
              const firstTd = row.querySelector('td:first-child');
              if (!firstTd) return;
              
              let text = firstTd.textContent.trim();
              if (!text) return;
              
              text = text.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
              
              const patterns = [
                /^(.+?)\s+Stupeň\s+(\d+)$/i,
                /^(.+?)\s+Úroveň\s+(\d+)$/i,
                /^(.+?)\s+Level\s+(\d+)$/i,
                /^(.+?)\s+(\d+)$/
              ];
              
              let buildingName = null;
              let level = null;
              
              for (const pattern of patterns) {
                const match = text.match(pattern);
                if (match) {
                  buildingName = match[1].trim();
                  level = parseInt(match[2]);
                  break;
                }
              }
              
              if (!buildingName || !level) return;
              
              buildingName = czechToEnglish[buildingName] || buildingName;
              
              const existing = buildingsList.find(b => b.name === buildingName);
              if (existing && existing.level < level) {
                existing.level = level;
              } else if (!existing) {
                buildingsList.push({
                  name: buildingName,
                  level: level
                });
              }
            } catch (e) {
              console.error('Chyba při zpracování fronty:', e);
            }
          });
        }

        return buildingsList;
      });

      return buildings;
    } catch (error) {
      logger.error('Chyba při zjišťování budov', this.getAccountName(), error);
      return null;
    }
  }

  /**
   * Zkontroluje frontu výstavby
   */
  async checkBuildQueue() {
    try {
      await this.page.waitForTimeout(1000);
      
      const queueInfo = await this.page.evaluate(() => {
        const buildQueue = document.getElementById('buildqueue');
        
        if (!buildQueue) {
          return { hasQueue: false, buildings: [] };
        }

        const rows = buildQueue.querySelectorAll('tr');
        const buildings = [];

        rows.forEach((row, index) => {
          if (index < 2) return;

          try {
            const firstTd = row.querySelector('td:first-child');
            const secondTd = row.querySelectorAll('td')[1];
            
            if (firstTd && secondTd) {
              const name = firstTd.textContent.trim();
              const timeSpan = secondTd.querySelector('span');
              const time = timeSpan ? timeSpan.textContent.trim() : secondTd.textContent.trim();
              
              if (name && time) {
                buildings.push({
                  name: name,
                  time: time
                });
              }
            }
          } catch (e) {
            console.error('Chyba při čtení fronty:', e);
          }
        });

        return {
          hasQueue: buildings.length > 0,
          buildings: buildings
        };
      });

      return queueInfo;
    } catch (error) {
      logger.error('Chyba při kontrole fronty', this.getAccountName(), error);
      return { hasQueue: false, buildings: [] };
    }
  }

  /**
   * Parsuje čas do milisekund
   */
  parseTimeToMs(timeString) {
    const parts = timeString.split(':');
    if (parts.length !== 3) return 5 * 60 * 1000;

    const hours = parseInt(parts[0]) || 0;
    const minutes = parseInt(parts[1]) || 0;
    const seconds = parseInt(parts[2]) || 0;

    return (hours * 3600 + minutes * 60 + seconds) * 1000;
  }

  /**
   * Odebere všechny odměny
   */
  async collectAllRewards() {
    try {
      const hasQuests = await this.page.evaluate(() => {
        const questBtn = document.querySelector('#new_quest');
        return questBtn !== null;
      });

      if (!hasQuests) {
        return 0;
      }

      await this.page.click('#new_quest');
      await this.page.waitForTimeout(1500); // Sníženo z 2000ms

      await this.page.evaluate(() => {
        const rewardTab = document.querySelector('a[data-tab="reward-tab"]');
        if (rewardTab) rewardTab.click();
      });

      await this.page.waitForTimeout(1000);

      let collected = 0;
      const maxRewards = 50; // Limit to prevent infinite loop
      while (collected < maxRewards) {
        const claimed = await this.page.evaluate(() => {
          const claimBtn = document.querySelector('a.reward-system-claim-button');
          if (claimBtn) {
            claimBtn.click();
            return true;
          }
          return false;
        });

        if (!claimed) break;

        collected++;
        await this.page.waitForTimeout(1000); // Reduced from 1500ms
      }

      await this.page.evaluate(() => {
        const closeBtn = document.querySelector('a.popup_box_close');
        if (closeBtn) closeBtn.click();
      });

      await this.page.waitForTimeout(1000);

      return collected;
    } catch (error) {
      logger.error('Chyba při odebírání odměn', this.getAccountName(), error);
      return 0;
    }
  }

  /**
   * 🆕 Zkontroluje populaci (globálně)
   */
  async checkPopulation() {
    try {
      const checks = await this.page.evaluate(() => {
        const result = {
          needsFarm: false,
          farmPercent: 100
        };

        // Kontrola populace - méně než 10%
        const popCurrent = document.querySelector('#pop_current_label');
        const popMax = document.querySelector('#pop_max_label');
        
        if (popCurrent && popMax) {
          const current = parseInt(popCurrent.textContent.trim()) || 0;
          const max = parseInt(popMax.textContent.trim()) || 0;
          
          if (max > 0) {
            const free = max - current;
            const freePercent = (free / max) * 100;
            result.farmPercent = freePercent;
            
            if (freePercent < 10) {
              result.needsFarm = true;
            }
          }
        }

        return result;
      });

      return checks;
    } catch (error) {
      logger.error('Chyba při kontrole populace', this.getAccountName(), error);
      return { needsFarm: false, farmPercent: 100 };
    }
  }

  /**
   * 🆕 Zkontroluje, jestli konkrétní budova potřebuje větší sklad
   */
  async checkWarehouseForBuilding(internalName) {
    try {
      const needsWarehouse = await this.page.evaluate((internalName) => {
        const buildRow = document.getElementById(`main_buildrow_${internalName}`);
        if (!buildRow) return false;
        
        // Hledej text "příliš malé" PŘÍMO V ŘÁDKU této budovy
        const allElements = buildRow.querySelectorAll('.inactive, span, td');
        
        for (const el of allElements) {
          const text = el.textContent?.toLowerCase() || '';
          const className = el.className?.toLowerCase() || '';
          
          // Pokud je element inactive A obsahuje text o skladu
          if (className.includes('inactive')) {
            if (text.includes('příliš mal') || 
                text.includes('príliš mal') ||
                text.includes('too small') ||
                text.includes('zu klein') ||
                (text.includes('skladi') && text.includes('mal')) ||
                (text.includes('warehouse') && text.includes('small'))) {
              return true;
            }
          }
        }
        
        return false;
      }, internalName);

      return needsWarehouse;
    } catch (error) {
      logger.error('Chyba při kontrole skladu', this.getAccountName(), error);
      return false;
    }
  }

  /**
   * Postaví budovu
   */
  async buildBuilding(buildingName, level) {
    try {
      const internalName = this.getBuildingInternalName(buildingName);

      const canBuild = await this.page.evaluate((internalName) => {
        const buildRow = document.getElementById(`main_buildrow_${internalName}`);
        if (!buildRow) return { canBuild: false, reason: 'Budova nenalezena' };

        const woodElement = buildRow.querySelector('.cost_wood');
        const stoneElement = buildRow.querySelector('.cost_stone');
        const ironElement = buildRow.querySelector('.cost_iron');

        if (!woodElement || !stoneElement || !ironElement) {
          return { canBuild: false, reason: 'Nelze zjistit cenu' };
        }

        const woodCost = parseInt(woodElement.getAttribute('data-cost')) || 0;
        const stoneCost = parseInt(stoneElement.getAttribute('data-cost')) || 0;
        const ironCost = parseInt(ironElement.getAttribute('data-cost')) || 0;

        const currentWood = parseInt(document.getElementById('wood').textContent.replace(/\./g, '')) || 0;
        const currentStone = parseInt(document.getElementById('stone').textContent.replace(/\./g, '')) || 0;
        const currentIron = parseInt(document.getElementById('iron').textContent.replace(/\./g, '')) || 0;

        if (currentWood < woodCost || currentStone < stoneCost || currentIron < ironCost) {
          return {
            canBuild: false,
            reason: 'Nedostatek surovin',
            needed: {
              wood: Math.max(0, woodCost - currentWood),
              stone: Math.max(0, stoneCost - currentStone),
              iron: Math.max(0, ironCost - currentIron)
            }
          };
        }

        return { canBuild: true };
      }, internalName);

      if (!canBuild.canBuild) {
        // Tichý fail - nedostatek surovin je normální
        return { success: false, reason: canBuild.reason, waitTime: 5 * 60 * 1000 };
      }

      const gameData = await this.page.evaluate(() => {
        return {
          villageId: game_data.village.id,
          csrf: game_data.csrf
        };
      });

      const result = await this.page.evaluate(async (params) => {
        const { internalName, villageId, csrf } = params;
        try {
          const response = await fetch(`/game.php?village=${villageId}&screen=main&ajaxaction=upgrade_building&type=main&`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'TribalWars-Ajax': '1'
            },
            body: `id=${internalName}&force=1&destroy=0&source=${villageId}&h=${csrf}`
          });

          const data = await response.json();
          return data;
        } catch (error) {
          return { error: [error.message] };
        }
      }, { internalName, villageId: gameData.villageId, csrf: gameData.csrf });

      if (result.error) {
        logger.error(`Chyba při stavbě ${buildingName}`, this.getAccountName());
        return { success: false, reason: result.error[0], waitTime: 5 * 60 * 1000 };
      }

      if (result.response && result.response.success) {
        // LOGUJ AKCI - skutečná výstavba
        await this.page.waitForTimeout(1500);
        const queueInfo = await this.checkBuildQueue();

        let buildTime = '?';
        let waitTimeMs = 5 * 60 * 1000;

        if (queueInfo.hasQueue && queueInfo.buildings.length > 0) {
          const lastBuilding = queueInfo.buildings[queueInfo.buildings.length - 1];
          buildTime = lastBuilding.time;
          waitTimeMs = this.parseTimeToMs(lastBuilding.time);
        }

        logger.building(this.getAccountName(), buildingName, level, buildTime);

        return { success: true, waitTime: waitTimeMs };
      }

      return { success: false, reason: 'Neznámá chyba', waitTime: 5 * 60 * 1000 };

    } catch (error) {
      logger.error(`Chyba při stavbě ${buildingName}`, this.getAccountName(), error);
      return { success: false, reason: error.message, waitTime: 5 * 60 * 1000 };
    }
  }

  /**
   * Hlavní funkce - spustí výstavbu podle šablony
   */
  async startBuilding(templateName) {
    try {
      const templates = this.getTemplates();
      const template = templates[templateName];

      if (!template) {
        logger.error(`Šablona ${templateName} neexistuje`, this.getAccountName());
        return { success: false, waitTime: 5 * 60 * 1000 };
      }

      await this.collectAllRewards();

      const currentBuildings = await this.getCurrentBuildings();
      if (!currentBuildings) {
        logger.error(`Nepodařilo se získat aktuální budovy`, this.getAccountName());
        return { success: false, waitTime: 5 * 60 * 1000 };
      }

      const queueInfo = await this.checkBuildQueue();

      if (queueInfo.hasQueue && queueInfo.buildings.length > 0) {
        const firstBuilding = queueInfo.buildings[0];
        const waitTime = this.parseTimeToMs(firstBuilding.time);
        return { success: true, waitTime: waitTime };
      }

      // 🆕 KONTROLA POPULACE (GLOBÁLNÍ)
      const popCheck = await this.checkPopulation();
      const now = Date.now();

      // Priorita 1: Populace < 10%
      if (popCheck.needsFarm) {
        if (now - this.lastFarmAttempt < this.attemptCooldown) {
          // Cooldown - skip for now
        } else {
          const farm = currentBuildings.find(b =>
            b.name.includes('Farm') ||
            b.name.includes('Selský dvůr') ||
            b.name.includes('Sedliacky dvor')
          );
          const nextLevel = (farm?.level || 0) + 1;

          this.lastFarmAttempt = now;

          const buildResult = await this.buildBuilding('Farm', nextLevel);

          if (buildResult.success) {
            this.lastFarmAttempt = 0;
          }

          return buildResult;
        }
      }

      // Normální šablona - ZKONTROLUJ SKLAD PRO KAŽDOU BUDOVU
      for (const item of template) {
        const existing = currentBuildings.find(b =>
          b.name.includes(item.building) || item.building.includes(b.name)
        );

        if (!existing || existing.level < item.level) {
          // 🆕 KONTROLA SKLADU PRO TUTO KONKRÉTNÍ BUDOVU
          const internalName = this.getBuildingInternalName(item.building);
          const needsWarehouse = await this.checkWarehouseForBuilding(internalName);

          if (needsWarehouse) {
            // Zkontroluj cooldown
            if (now - this.lastWarehouseAttempt < this.attemptCooldown) {
              continue; // Přeskoč tuto budovu a zkus další
            } else {
              const warehouse = currentBuildings.find(b =>
                b.name.includes('Warehouse') ||
                b.name.includes('Skladiště') ||
                b.name.includes('Sklad')
              );
              const nextLevel = (warehouse?.level || 0) + 1;

              this.lastWarehouseAttempt = now;

              const buildResult = await this.buildBuilding('Warehouse', nextLevel);

              if (buildResult.success) {
                this.lastWarehouseAttempt = 0;
              }

              return buildResult;
            }
          }

          // Pokud sklad není problém, zkus postavit budovu
          const buildResult = await this.buildBuilding(item.building, item.level);
          return buildResult;
        }
      }

      return { success: true, waitTime: 30 * 60 * 1000 };

    } catch (error) {
      logger.error(`Chyba při výstavbě`, this.getAccountName(), error);
      return { success: false, waitTime: 5 * 60 * 1000 };
    }
  }
}

export default BuildingModule;