/**
 * Pomocné funkce pro práci s Divoké kmeny
 */

export class GameHelpers {
  constructor(page) {
    this.page = page;
  }

  /**
   * Čeká na načtení hry
   */
  async waitForGame(timeout = 30000) {
    try {
      await this.page.waitForSelector('#game_frame', { timeout });
      return true;
    } catch (error) {
      console.error('❌ Hra se nenačetla:', error.message);
      return false;
    }
  }

  /**
   * Zjistí aktuální URL hry (může být v iframe)
   */
  async getCurrentGameUrl() {
    return this.page.url();
  }

  /**
   * Naviguje na konkrétní stránku ve hře
   * @param {string} screen - název obrazovky (např. 'main', 'barracks', 'market')
   * @param {object} params - další parametry (village, mode, atd.)
   */
  async navigateToScreen(screen, params = {}) {
    try {
      const url = new URL(this.page.url());
      url.searchParams.set('screen', screen);
      
      Object.keys(params).forEach(key => {
        url.searchParams.set(key, params[key]);
      });

      await this.page.goto(url.toString(), { waitUntil: 'domcontentloaded' });
      console.log(`✅ Navigace na: ${screen}`);
      return true;
    } catch (error) {
      console.error(`❌ Chyba při navigaci na ${screen}:`, error.message);
      return false;
    }
  }

  /**
   * Čeká náhodnou dobu (lidské chování)
   */
  async randomWait(minMs = 1000, maxMs = 3000) {
    const wait = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
    await this.page.waitForTimeout(wait);
  }

  /**
   * Klikne na element s náhodným čekáním
   */
  async humanClick(selector) {
    await this.randomWait(500, 1500);
    await this.page.click(selector);
    await this.randomWait(500, 1500);
  }

  /**
   * Napíše text s náhodným čekáním mezi znaky
   */
  async humanType(selector, text) {
    await this.page.click(selector);
    await this.randomWait(300, 800);
    
    for (const char of text) {
      await this.page.type(selector, char);
      await this.page.waitForTimeout(Math.random() * 100 + 50);
    }
  }

  /**
   * Extrahuje číslo z textu (odstraní tečky, čárky)
   */
  parseNumber(text) {
    if (!text) return 0;
    return parseInt(text.replace(/[.,\s]/g, '')) || 0;
  }

  /**
   * Zkontroluje, jestli je element viditelný
   */
  async isVisible(selector) {
    try {
      const element = await this.page.$(selector);
      if (!element) return false;
      return await element.isVisible();
    } catch {
      return false;
    }
  }

  /**
   * Získá text z elementu
   */
  async getText(selector) {
    try {
      return await this.page.textContent(selector);
    } catch {
      return null;
    }
  }

  /**
   * Počká na element
   */
  async waitForElement(selector, timeout = 10000) {
    try {
      await this.page.waitForSelector(selector, { timeout });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Screenshot pro debugování
   */
  async takeDebugScreenshot(name) {
    const timestamp = Date.now();
    const path = `./debug_${name}_${timestamp}.png`;
    await this.page.screenshot({ path });
    console.log(`📸 Screenshot uložen: ${path}`);
  }

  /**
   * Zjistí aktuální vesnici
   */
  async getCurrentVillage() {
    try {
      return await this.page.evaluate(() => {
        const villageElement = document.querySelector('#village_switch_link');
        return villageElement ? villageElement.textContent.trim() : null;
      });
    } catch {
      return null;
    }
  }

  /**
   * Přepne na konkrétní vesnici podle ID
   */
  async switchVillage(villageId) {
    try {
      await this.navigateToScreen('overview', { village: villageId });
      await this.randomWait();
      console.log(`✅ Přepnuto na vesnici ID: ${villageId}`);
      return true;
    } catch (error) {
      console.error(`❌ Chyba při přepínání vesnice:`, error.message);
      return false;
    }
  }

  /**
   * Zjistí, jestli je uživatel přihlášen
   */
  async isLoggedIn() {
    const url = this.page.url();
    // Podporuje jak CS (divokekmeny.cz) tak SK (divoke-kmene.sk)
    return url.includes('/game.php') && (url.includes('divokekmeny.cz') || url.includes('divoke-kmene.sk'));
  }

  /**
   * Čeká, dokud se nenačte konkrétní obsah
   */
  async waitForContent(selector, expectedContent, timeout = 10000) {
    try {
      await this.page.waitForFunction(
        ({ sel, content }) => {
          const element = document.querySelector(sel);
          return element && element.textContent.includes(content);
        },
        { sel: selector, content: expectedContent },
        { timeout }
      );
      return true;
    } catch {
      return false;
    }
  }
}

export default GameHelpers;
