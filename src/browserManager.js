import { chromium } from 'playwright';
import DatabaseManager from './database.js';

class BrowserManager {
  constructor(db = null) {
    this.db = db || new DatabaseManager();
  }

  async createContext(accountId) {
    const account = this.db.getAccount(accountId);
    
    if (!account) {
      throw new Error(`Účet s ID ${accountId} nebyl nalezen`);
    }

    console.log(`🚀 Spouštím prohlížeč pro účet: ${account.username}`);

    const contextOptions = {
      viewport: { width: 1280, height: 720 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      locale: 'cs-CZ',
      timezoneId: 'Europe/Prague',
    };

    if (account.proxy) {
      const proxy = this.parseProxy(account.proxy);
      contextOptions.proxy = proxy;
      console.log(`🔐 Používám proxy: ${proxy.server}`);
    }

    const needsManualLogin = !account.cookies || account.cookies === 'null';
    const headless = !needsManualLogin;

    if (needsManualLogin) {
      console.log('🖥️  Otevírám viditelný prohlížeč (první přihlášení)');
    } else {
      console.log('👻 Spouštím v tichém režimu (headless)');
    }

    const browser = await chromium.launch({
      headless: headless,
      args: ['--disable-blink-features=AutomationControlled']
    });

    const context = await browser.newContext(contextOptions);

    if (account.cookies) {
      try {
        const cookies = JSON.parse(account.cookies);
        await context.addCookies(cookies);
        console.log(`🍪 Cookies načteny pro účet: ${account.username}`);
      } catch (error) {
        console.error('❌ Chyba při načítání cookies:', error.message);
      }
    }

    return { browser, context, account };
  }

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

  async saveCookies(context, accountId) {
    try {
      const cookies = await context.cookies();
      this.db.updateCookies(accountId, cookies);
      console.log(`✅ Cookies uloženy pro účet ID: ${accountId}`);
    } catch (error) {
      console.error('❌ Chyba při ukládání cookies:', error.message);
    }
  }

  async close(browser, context) {
    try {
      if (context) await context.close();
      if (browser) await browser.close();
    } catch (error) {
      console.error('❌ Chyba při zavírání prohlížeče:', error.message);
    }
  }

  async closeAll() {
    // BrowserManager nesleduje otevřené prohlížeče globálně
    // Prohlížeče se zavírají individuálně v processAccount()
    // Tato metoda je zde pro kompatibilitu s graceful shutdown
    console.log('ℹ️  Prohlížeče se zavírají automaticky po zpracování každého účtu');
  }

  async testConnection(accountId) {
    const account = this.db.getAccount(accountId);

    if (!account) {
      throw new Error(`Účet s ID ${accountId} nebyl nalezen`);
    }

    console.log(`🖥️  Otevírám VIDITELNÝ prohlížeč pro: ${account.username}`);

    // Zjisti locale podle světa
    const domain = this.db.getDomainForAccount(account);
    const locale = domain.includes('divoke-kmene.sk') ? 'sk-SK' : 'cs-CZ';
    const timezoneId = domain.includes('divoke-kmene.sk') ? 'Europe/Bratislava' : 'Europe/Prague';

    const contextOptions = {
      viewport: { width: 1280, height: 720 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      locale,
      timezoneId,
      ignoreHTTPSErrors: true,
    };

    if (account.proxy) {
      const proxy = this.parseProxy(account.proxy);
      contextOptions.proxy = proxy;
      console.log(`🔐 Používám proxy: ${proxy.server}`);
    }

    const browser = await chromium.launch({
      headless: false,
      args: ['--disable-blink-features=AutomationControlled']
    });

    const context = await browser.newContext(contextOptions);

    // Vyčisti vše před načtením cookies
    await context.clearCookies();

    if (account.cookies) {
      try {
        const cookies = JSON.parse(account.cookies);
        await context.addCookies(cookies);
        console.log(`🍪 Cookies načteny pro účet: ${account.username}`);
      } catch (error) {
        console.error('❌ Chyba při načítání cookies:', error.message);
      }
    }

    try {
      const page = await context.newPage();

      if (account.world) {
        // Vyčisti localStorage/sessionStorage před načtením
        console.log(`🧹 Čistím storage pro: ${account.username}`);
        await page.goto(`https://${account.world}.${domain}/`, {
          waitUntil: 'domcontentloaded',
          timeout: 30000
        });
        await page.evaluate(() => {
          localStorage.clear();
          sessionStorage.clear();
        });

        console.log(`🌐 Načítám svět: ${account.world} (${domain}, ${locale})`);
        await page.goto(`https://${account.world}.${domain}/game.php`, {
          waitUntil: 'domcontentloaded',
          timeout: 30000
        });
      } else {
        console.log(`🌐 Načítám hlavní stránku (${domain})...`);
        await page.goto(`https://www.${domain}/`, {
          waitUntil: 'domcontentloaded',
          timeout: 30000
        });
      }

      console.log('🖥️  Prohlížeč otevřen - zavřete ho ručně');
      console.log('💾 Cookies se uloží automaticky při dalším zpracování účtu');

    } catch (error) {
      console.error('❌ Chyba při otevírání prohlížeče:', error.message);
      await this.close(browser, context);
    }
  }
}

export default BrowserManager;