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

  async testConnection(accountId, autoSaveAndClose = false) {
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

        // Vyplň username a heslo pokud je přihlašovací formulář
        await page.waitForTimeout(1000);
        const loginFormExists = await page.evaluate(() => {
          return document.querySelector('input[name="username"]') !== null;
        });

        if (loginFormExists) {
          console.log(`📝 Vyplňuji přihlašovací údaje pro: ${account.username}`);
          await page.evaluate(({ username, password }) => {
            const usernameInput = document.querySelector('input[name="username"]');
            const passwordInput = document.querySelector('input[name="password"]');
            if (usernameInput) usernameInput.value = username;
            if (passwordInput) passwordInput.value = password;
          }, { username: account.username, password: account.password });
          console.log(`✅ Údaje vyplněny - stiskněte tlačítko přihlásit`);
        }
      } else {
        console.log(`🌐 Načítám hlavní stránku (${domain})...`);
        await page.goto(`https://www.${domain}/`, {
          waitUntil: 'domcontentloaded',
          timeout: 30000
        });
      }

      // VŽDY spusť sledování přihlášení - automaticky uloží cookies a zavře browser
      console.log('🖥️  Prohlížeč otevřen - přihlaste se');
      console.log('💾 Systém automaticky uloží cookies a zavře okno po přihlášení');

      this.startLoginWatcher(browser, context, page, account);

      // Vrať browser, context, page pro sledování zavření
      return { browser, context, page, accountId: account.id };

    } catch (error) {
      console.error('❌ Chyba při otevírání prohlížeče:', error.message);
      console.error('🔍 Stack trace:', error.stack);
      await this.close(browser, context);
      return null;
    }
  }

  /**
   * Sleduje přihlášení uživatele a automaticky ukládá cookies
   */
  async startLoginWatcher(browser, context, page, account) {
    const checkInterval = 5000; // 5 sekund
    let shouldStop = false;

    // Sleduj zavření browseru uživatelem
    browser.on('disconnected', () => {
      shouldStop = true;
    });

    // Spusť watch loop na pozadí
    (async () => {
      while (!shouldStop) {
        await new Promise(resolve => setTimeout(resolve, checkInterval));

        if (shouldStop) break;

        try {
          // Robustnější detekce přihlášení - kontroluj více elementů
          const loginStatus = await page.evaluate(() => {
            // Detekce PŘIHLÁŠENÍ - hledej více elementů
            const loggedInIndicators = [
              document.querySelector('#menu_row'),           // Hlavní menu
              document.querySelector('#topContainer'),       // Top kontejner
              document.querySelector('.village-name'),       // Název vesnice
              document.querySelector('#header_info'),        // Header info
              document.querySelector('.quickbar')            // Quickbar
            ];
            const hasLoggedInElement = loggedInIndicators.some(el => el !== null);

            // Detekce NEPŘIHLÁŠENÍ - hledej login formulář
            const loginIndicators = [
              document.querySelector('input[name="user"]'),      // Login input
              document.querySelector('input[name="username"]'),  // Username input
              document.querySelector('input[name="password"]'),  // Password input
              document.querySelector('#login_form')              // Login formulář
            ];
            const hasLoginForm = loginIndicators.some(el => el !== null);

            return {
              isLoggedIn: hasLoggedInElement && !hasLoginForm,
              hasLoginForm: hasLoginForm
            };
          });

          if (loginStatus.isLoggedIn) {
            console.log(`✅ [${account.username}] Přihlášení detekováno - ukládám cookies`);

            // Ulož cookies
            const cookies = await context.cookies();
            this.db.updateCookies(account.id, cookies);

            console.log(`💾 [${account.username}] Cookies uloženy (${cookies.length} cookies) - zavírám browser`);

            // Zavři browser (vyvolá 'disconnected' event)
            await browser.close();
            break;
          }
        } catch (error) {
          // Browser byl pravděpodobně zavřen nebo page neexistuje
          console.log(`🔒 [${account.username}] Login watcher ukončen (browser zavřen)`);
          break;
        }
      }
    })().catch(err => {
      console.error(`❌ [${account.username}] Chyba v login watcher:`, err.message);
    });
  }
}

export default BrowserManager;