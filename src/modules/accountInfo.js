/**
 * Modul pro zjišťování informací o účtu
 */

class AccountInfoModule {
  constructor(page, db, accountId) {
    this.page = page;
    this.db = db;
    this.accountId = accountId;
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
      console.error('❌ Chyba při zjišťování surovin:', error.message);
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
      console.error('❌ Chyba při zjišťování populace:', error.message);
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
          console.log('Text parent elementu žebříčku:', text);
          
          // Pattern: "Žebříček (pozice|body P)"
          // Příklad: "Žebříček (26.|21.909 P)"
          const match = text.match(/Žebříček\s*\([^|]*\|([0-9.]+)\s*P\)/);
          if (match) {
            // Odstraníme tečky (tisícové oddělovače) a převedeme na číslo
            const pointsStr = match[1].replace(/\./g, '');
            const points = parseInt(pointsStr);
            console.log('Nalezeny body:', points);
            return points;
          }
        }

        console.log('⚠️ Body nebyly nalezeny');
        return 0;
      });

      console.log('⭐ Body:', points);
      return points;
    } catch (error) {
      console.error('❌ Chyba při zjišťování bodů:', error.message);
      return 0;
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
        console.log('🌐 Přecházím na hlavní obrazovku pro zjištění hradeb...');
        await this.page.goto(`https://${world}.${domain}/game.php?screen=main`, {
          waitUntil: 'domcontentloaded'
        });
        await this.page.waitForTimeout(2000);
      }

      await this.page.waitForSelector('#buildings', { timeout: 10000 });
      await this.page.waitForTimeout(1000);

      const wallLevel = await this.page.evaluate(() => {
        const wallRow = document.querySelector('[id*="main_buildrow_wall"]');
        if (!wallRow) {
          console.log('Hradby nenalezeny v buildings');
          return 0;
        }

        const text = wallRow.textContent;
        console.log('Text řádku hradeb:', text);
        
        // Pattern: "Stupeň 20" nebo "Úroveň 20" nebo "Level 20"
        const match = text.match(/Stupeň\s+(\d+)/i) || 
                      text.match(/Úroveň\s+(\d+)/i) ||
                      text.match(/Level\s+(\d+)/i);
        
        if (match) {
          const level = parseInt(match[1]);
          console.log('Nalezena úroveň hradeb:', level);
          return level;
        }

        console.log('Nepodařilo se parsovat úroveň hradeb');
        return 0;
      });

      console.log('🏰 Úroveň hradeb:', wallLevel);
      return wallLevel;
    } catch (error) {
      console.error('❌ Chyba při zjišťování hradeb:', error.message);
      return 0;
    }
  }

  /**
   * Shromáždí všechny informace o účtu
   */
  async collectInfo() {
    try {
      console.log('📊 Sbírám informace o účtu...');

      const resources = await this.getResources();
      console.log('📦 Suroviny:', resources);

      const population = await this.getPopulation();
      console.log('👥 Populace:', population);

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
        wall_level: wallLevel
      });

      console.log('✅ Statistiky aktualizovány pro účet ID:', this.accountId);

      return {
        resources,
        population,
        points,
        wallLevel
      };
    } catch (error) {
      console.error('❌ Chyba při sbírání informací:', error.message);
      return null;
    }
  }
}

export default AccountInfoModule;