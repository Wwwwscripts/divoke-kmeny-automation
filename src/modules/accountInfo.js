/**
 * Modul pro zjišťování informací o účtu
 */

import logger from '../logger.js';

class AccountInfoModule {
  constructor(page, db, accountId) {
    this.page = page;
    this.db = db;
    this.accountId = accountId;
    this.accountName = null;
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
   * Získá suroviny
   */
  async getResources() {
    try {
      const resources = await this.page.evaluate(() => {
        const wood = parseInt(document.getElementById('wood').textContent.replace(/\./g, '')) || 0;
        const clay = parseInt(document.getElementById('stone').textContent.replace(/\./g, '')) || 0;
        const iron = parseInt(document.getElementById('iron').textContent.replace(/\./g, '')) || 0;
        
        return { wood, clay, iron };
      });

      return resources;
    } catch (error) {
      logger.error('Chyba při zjišťování surovin', this.getAccountName(), error);
      return { wood: 0, clay: 0, iron: 0 };
    }
  }

  /**
   * Získá populaci
   */
  async getPopulation() {
    try {
      const population = await this.page.evaluate(() => {
        const popElement = document.getElementById('pop_current_label');
        const maxPopElement = document.getElementById('pop_max_label');
        
        if (!popElement || !maxPopElement) return '0/0';
        
        const current = popElement.textContent.trim();
        const max = maxPopElement.textContent.trim();
        
        return `${current}/${max}`;
      });

      return population;
    } catch (error) {
      logger.error('Chyba při zjišťování populace', this.getAccountName(), error);
      return '0/0';
    }
  }

  /**
   * Získá body
   */
  async getPoints() {
    try {
      const points = await this.page.evaluate(() => {
        // Najdeme link na žebříček a jeho parent element
        const rankingLink = document.querySelector('a[href*="screen=ranking"]');
        if (rankingLink && rankingLink.parentElement) {
          const text = rankingLink.parentElement.textContent;

          // Pattern: "Žebříček (pozice|body P)"
          // Příklad: "Žebříček (26.|21.909 P)"
          const match = text.match(/Žebříček\s*\([^|]*\|([0-9.]+)\s*P\)/);
          if (match) {
            // Odstraníme tečky (tisícové oddělovače) a převedeme na číslo
            const pointsStr = match[1].replace(/\./g, '');
            const points = parseInt(pointsStr);
            return points;
          }
        }

        return 0;
      });

      return points;
    } catch (error) {
      logger.error('Chyba při zjišťování bodů', this.getAccountName(), error);
      return 0;
    }
  }

  /**
   * Získá souřadnice vesnice a další detaily
   */
  async getVillageCoordinates() {
    try {
      const villageInfo = await this.page.evaluate(() => {
        const v = game_data.village;
        return {
          id: v.id,
          name: v.name,
          x: v.x,
          y: v.y,
          coord: `${v.x}|${v.y}`,
          continent: v.display_name.match(/K\d+/) ? v.display_name.match(/K\d+/)[0] : 'K??'
        };
      });

      return villageInfo;
    } catch (error) {
      logger.error('Chyba při zjišťování souřadnic', this.getAccountName(), error);
      return null;
    }
  }

  /**
   * Získá úroveň hradeb z hlavní obrazovky
   */
  async getWallLevel() {
    try {
      const currentUrl = this.page.url();
      // Podporuje CS i SK domény
      const worldMatch = currentUrl.match(/\/\/([^.]+)\.(divokekmeny\.cz|divoke-kmene\.sk)/);
      if (!worldMatch) return 0;

      const world = worldMatch[1];
      const domain = worldMatch[2];

      if (!currentUrl.includes('screen=main')) {
        await this.page.goto(`https://${world}.${domain}/game.php?screen=main`, {
          waitUntil: 'domcontentloaded'
        });
        await this.page.waitForTimeout(1500); // Sníženo z 2000ms
      }

      await this.page.waitForSelector('#buildings', { timeout: 10000 });
      await this.page.waitForTimeout(500); // Sníženo z 1000ms

      const wallLevel = await this.page.evaluate(() => {
        const wallRow = document.querySelector('[id*="main_buildrow_wall"]');
        if (!wallRow) {
          return 0;
        }

        const text = wallRow.textContent;

        // Pattern: "Stupeň 20" nebo "Úroveň 20" nebo "Level 20"
        const match = text.match(/Stupeň\s+(\d+)/i) ||
                      text.match(/Úroveň\s+(\d+)/i) ||
                      text.match(/Level\s+(\d+)/i);

        if (match) {
          const level = parseInt(match[1]);
          return level;
        }

        return 0;
      });

      return wallLevel;
    } catch (error) {
      logger.error('Chyba při zjišťování hradeb', this.getAccountName(), error);
      return 0;
    }
  }

  /**
   * Shromáždí všechny informace o účtu
   */
  async collectInfo() {
    try {
      const villageInfo = await this.getVillageCoordinates();
      const resources = await this.getResources();
      const population = await this.getPopulation();
      const points = await this.getPoints();
      const wallLevel = await this.getWallLevel();

      const [popCurrent, popMax] = population.split('/').map(p => parseInt(p.trim()) || 0);

      this.db.updateAccountStats(this.accountId, {
        wood: resources.wood,
        clay: resources.clay,
        iron: resources.iron,
        populationCurrent: popCurrent,
        populationMax: popMax,
        points: points
      });

      this.db.updateAccountInfo(this.accountId, {
        wall_level: wallLevel,
        village_id: villageInfo?.id,
        village_name: villageInfo?.name,
        coord_x: villageInfo?.x,
        coord_y: villageInfo?.y,
        continent: villageInfo?.continent
      });

      return {
        resources,
        population,
        points,
        wallLevel,
        villageInfo
      };
    } catch (error) {
      logger.error('Chyba při sbírání informací', this.getAccountName(), error);
      return null;
    }
  }
}

export default AccountInfoModule;