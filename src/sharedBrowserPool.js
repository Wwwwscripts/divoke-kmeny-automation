/**
 * Shared Browser Pool - Sdílení browser instancí podle proxy
 * Pro účty se stejnou proxy sdílí browser (šetří RAM)
 */
import { chromium } from 'playwright';

class SharedBrowserPool {
  constructor(db) {
    this.db = db;
    this.browsers = new Map(); // key: proxy string, value: { browser, contexts: Set }
    this.defaultBrowser = null; // Browser pro účty bez proxy
  }

  /**
   * Získá nebo vytvoří browser pro danou proxy
   */
  async getBrowser(proxy = null) {
    const key = proxy || 'default';

    if (this.browsers.has(key)) {
      return this.browsers.get(key).browser;
    }

    // Vytvoř nový browser
    const launchOptions = {
      headless: true,
      args: ['--disable-blink-features=AutomationControlled']
    };

    // Proxy se nastavuje až na context level
    const browser = await chromium.launch(launchOptions);

    this.browsers.set(key, {
      browser,
      contexts: new Set(),
      proxy
    });

    return browser;
  }

  /**
   * Vytvoří context pro účet (s proxy supportem)
   */
  async createContext(accountId) {
    const account = this.db.getAccount(accountId);

    if (!account) {
      throw new Error(`Účet s ID ${accountId} nebyl nalezen`);
    }

    const contextOptions = {
      viewport: { width: 1280, height: 720 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      locale: 'cs-CZ',
      timezoneId: 'Europe/Prague',
    };

    // Přidej proxy, pokud existuje
    if (account.proxy) {
      const proxy = this.parseProxy(account.proxy);
      contextOptions.proxy = proxy;
    }

    // Získej sdílený browser (podle proxy)
    const browserKey = account.proxy || 'default';
    const browser = await this.getBrowser(account.proxy);

    // Vytvoř nový context
    const context = await browser.newContext(contextOptions);

    // Přidej cookies
    if (account.cookies) {
      try {
        const cookies = JSON.parse(account.cookies);
        await context.addCookies(cookies);
      } catch (error) {
        console.error('❌ Chyba při načítání cookies:', error.message);
      }
    }

    // Zaznamenej context
    const browserData = this.browsers.get(browserKey);
    browserData.contexts.add(context);

    return { browser, context, account, browserKey };
  }

  /**
   * Uzavře context (ale nechá browser běžet)
   */
  async closeContext(context, browserKey) {
    try {
      if (context) {
        await context.close();

        // Odstraň z registru
        if (this.browsers.has(browserKey)) {
          const browserData = this.browsers.get(browserKey);
          browserData.contexts.delete(context);
        }
      }
    } catch (error) {
      console.error('❌ Chyba při zavírání contextu:', error.message);
    }
  }

  /**
   * Uloží cookies pro účet (volá se pouze při manuálním přihlášení)
   */
  async saveCookies(context, accountId) {
    try {
      const cookies = await context.cookies();

      if (!cookies || cookies.length === 0) {
        console.log(`⚠️  [ID:${accountId}] Žádné cookies k uložení`);
        return;
      }

      this.db.updateCookies(accountId, cookies);
      console.log(`✅ Cookies uloženy pro účet ID: ${accountId}`);

    } catch (error) {
      console.error(`❌ [ID:${accountId}] Chyba při ukládání cookies:`, error.message);
    }
  }

  /**
   * Parsuje proxy string
   */
  parseProxy(proxyString) {
    let proxy = {};

    if (!proxyString.startsWith('http://') && !proxyString.startsWith('https://')) {
      proxyString = 'http://' + proxyString;
    }

    try {
      const url = new URL(proxyString);

      proxy.server = `${url.protocol}//${url.hostname}:${url.port}`;

      if (url.username && url.password) {
        proxy.username = url.username;
        proxy.password = url.password;
      }
    } catch (error) {
      console.error('❌ Chyba při parsování proxy:', error.message);
      throw new Error('Neplatný formát proxy');
    }

    return proxy;
  }

  /**
   * Získá statistiky
   */
  getStats() {
    let totalContexts = 0;
    this.browsers.forEach(data => {
      totalContexts += data.contexts.size;
    });

    return {
      browsers: this.browsers.size,
      contexts: totalContexts
    };
  }

  /**
   * Uzavře všechny browsery (cleanup)
   */
  async closeAll() {
    console.log('🧹 Zavírám všechny sdílené browsery...');

    for (const [key, data] of this.browsers.entries()) {
      try {
        // Zavři všechny contexts
        for (const context of data.contexts) {
          await context.close();
        }

        // Zavři browser
        await data.browser.close();
        console.log(`✅ Browser pro ${key} zavřen`);
      } catch (error) {
        console.error(`❌ Chyba při zavírání browseru ${key}:`, error.message);
      }
    }

    this.browsers.clear();
  }
}

export default SharedBrowserPool;
