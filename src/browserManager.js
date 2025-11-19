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
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--no-sandbox'
      ]
    });

    const context = await browser.newContext(contextOptions);

    if (account.cookies && account.cookies !== 'null') {
      try {
        let cookies = JSON.parse(account.cookies);
        // Zajistit že cookies jsou pole (Playwright vyžaduje array)
        if (!Array.isArray(cookies)) {
          // Pokud jsou cookies null nebo undefined, přeskoč
          if (cookies === null || cookies === undefined) {
            console.warn(`⚠️  Cookies pro ${account.username} jsou null/undefined - přeskakuji`);
          } else {
            console.warn(`⚠️  Cookies pro ${account.username} nejsou pole, konvertuji...`);
            cookies = Object.values(cookies);
            await context.addCookies(cookies);
            console.log(`🍪 Cookies načteny pro účet: ${account.username}`);
          }
        } else {
          await context.addCookies(cookies);
          console.log(`🍪 Cookies načteny pro účet: ${account.username}`);
        }
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

  async testConnection(accountId, autoSaveAndClose = false, targetUrl = null) {
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
      viewport: null, // Fullscreen mode
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
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--no-sandbox',
        '--start-maximized'
      ]
    });

    const context = await browser.newContext(contextOptions);

    if (account.cookies && account.cookies !== 'null') {
      try {
        let cookies = JSON.parse(account.cookies);
        // Zajistit že cookies jsou pole (Playwright vyžaduje array)
        if (!Array.isArray(cookies)) {
          // Pokud jsou cookies null nebo undefined, přeskoč
          if (cookies === null || cookies === undefined) {
            console.warn(`⚠️  Cookies pro ${account.username} jsou null/undefined - přeskakuji`);
          } else {
            console.warn(`⚠️  Cookies pro ${account.username} nejsou pole, konvertuji...`);
            cookies = Object.values(cookies);
            await context.addCookies(cookies);
            console.log(`🍪 Cookies načteny pro účet: ${account.username}`);
          }
        } else {
          await context.addCookies(cookies);
          console.log(`🍪 Cookies načteny pro účet: ${account.username}`);
        }
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

        // Použij targetUrl pokud je zadaná, jinak game.php
        const finalUrl = targetUrl || '/game.php';
        console.log(`🌐 Načítám svět: ${account.world} (${domain}, ${locale}) - URL: ${finalUrl}`);
        await page.goto(`https://${account.world}.${domain}${finalUrl}`, {
          waitUntil: 'domcontentloaded',
          timeout: 30000
        });

        // Vyplň username a heslo pokud je přihlašovací formulář
        await page.waitForTimeout(2000); // Počkej 2 sekundy na načtení

        const loginFormFilled = await page.evaluate(({ username, password }) => {
          // Hledej username input (různé varianty)
          const usernameInput =
            document.querySelector('input[name="username"]') ||
            document.querySelector('input[name="user"]') ||
            document.querySelector('input[type="text"]');

          // Hledej password input
          const passwordInput =
            document.querySelector('input[name="password"]') ||
            document.querySelector('input[type="password"]');

          if (!usernameInput || !passwordInput) {
            return { success: false, reason: 'inputs_not_found' };
          }

          // Vyplň údaje
          usernameInput.value = username;
          passwordInput.value = password;

          // Trigger input events pro případné validace
          usernameInput.dispatchEvent(new Event('input', { bubbles: true }));
          passwordInput.dispatchEvent(new Event('input', { bubbles: true }));
          usernameInput.dispatchEvent(new Event('change', { bubbles: true }));
          passwordInput.dispatchEvent(new Event('change', { bubbles: true }));

          return { success: true, reason: 'filled' };
        }, { username: account.username, password: account.password });

        if (loginFormFilled.success) {
          console.log(`✅ [${account.username}] Přihlašovací údaje vyplněny`);
          console.log(`⚠️  Klikněte na tlačítko "Přihlásit se" nebo stiskněte Enter`);
        } else {
          console.log(`⚠️  [${account.username}] Přihlašovací formulář nenalezen - vyplňte ručně`);
        }
      } else {
        console.log(`🌐 Načítám hlavní stránku (${domain})...`);
        await page.goto(`https://www.${domain}/`, {
          waitUntil: 'domcontentloaded',
          timeout: 30000
        });
      }

      // Spusť sledování přihlášení POUZE pokud je autoSaveAndClose = true
      if (autoSaveAndClose) {
        console.log('🖥️  Prohlížeč otevřen - přihlaste se');
        console.log('💾 Systém automaticky uloží cookies a zavře okno po přihlášení');
        this.startLoginWatcher(browser, context, page, account);
      } else {
        console.log('🖥️  Prohlížeč otevřen pro manuální kontrolu');
        console.log('⚠️  Browser se NEZAVŘE automaticky - zavřete ho ručně');
        console.log('⚠️  Cookies se NEULOŽÍ automaticky - pouze po úspěšném přihlášení');
      }

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
    const saveInterval = 120000; // 2 minuty - periodické ukládání cookies
    const maxWaitTime = 600000; // 10 minut timeout
    let shouldStop = false;
    let lastSaveTime = Date.now();
    const startTime = Date.now();

    // Funkce pro bezpečné uložení cookies
    const safeSaveCookies = async (reason = '') => {
      try {
        const cookies = await context.cookies();
        if (cookies && cookies.length > 0) {
          this.db.updateCookies(account.id, cookies);
          console.log(`💾 [${account.username}] Cookies uloženy (${cookies.length} cookies)${reason ? ` - ${reason}` : ''}`);
          return true;
        }
      } catch (error) {
        console.error(`⚠️  [${account.username}] Nepodařilo se uložit cookies:`, error.message);
      }
      return false;
    };

    // Funkce pro bezpečné zavření browseru
    const safeCloseBrowser = async (reason = '') => {
      try {
        if (!shouldStop) {
          shouldStop = true;
          console.log(`🔒 [${account.username}] Zavírám browser${reason ? ` - ${reason}` : ''}`);
          await browser.close();
        }
      } catch (error) {
        console.error(`⚠️  [${account.username}] Chyba při zavírání browseru:`, error.message);
      }
    };

    // Sleduj zavření browseru uživatelem
    browser.on('disconnected', async () => {
      if (!shouldStop) {
        console.log(`🔒 [${account.username}] Browser zavřen uživatelem - ukládám cookies`);
        await safeSaveCookies('browser zavřen uživatelem');
        shouldStop = true;
      }
    });

    // Spusť watch loop na pozadí
    (async () => {
      while (!shouldStop) {
        await new Promise(resolve => setTimeout(resolve, checkInterval));

        if (shouldStop) break;

        // Kontrola timeoutu (10 minut)
        const elapsed = Date.now() - startTime;
        if (elapsed > maxWaitTime) {
          console.log(`⏱️  [${account.username}] Timeout (10 min) - ukládám cookies a zavírám`);
          await safeSaveCookies('timeout');
          await safeCloseBrowser('timeout');
          break;
        }

        // Periodické ukládání cookies (každé 2 minuty)
        const timeSinceLastSave = Date.now() - lastSaveTime;
        if (timeSinceLastSave > saveInterval) {
          await safeSaveCookies('periodické ukládání');
          lastSaveTime = Date.now();
        }

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
            console.log(`✅ [${account.username}] Přihlášení detekováno!`);
            await safeSaveCookies('přihlášení úspěšné');
            await safeCloseBrowser('přihlášení dokončeno');
            break;
          }
        } catch (error) {
          // Browser byl pravděpodobně zavřen nebo page neexistuje
          console.log(`⚠️  [${account.username}] Chyba při kontrole přihlášení - ukládám cookies a zavírám`);
          await safeSaveCookies('chyba při kontrole');
          await safeCloseBrowser('chyba');
          break;
        }
      }
    })().catch(async (err) => {
      console.error(`❌ [${account.username}] Kritická chyba v login watcher:`, err.message);
      await safeSaveCookies('kritická chyba');
      await safeCloseBrowser('kritická chyba');
    });
  }
}

export default BrowserManager;