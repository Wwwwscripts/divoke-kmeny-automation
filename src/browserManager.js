import { chromium } from 'playwright';
import DatabaseManager from './database.js';
import { generateFingerprint, createStealthScript } from './utils/fingerprint.js';
import { setupWebSocketInterceptor } from './utils/webSocketBehavior.js';

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

    // Získej nebo vygeneruj fingerprint pro účet
    let fingerprint = this.db.getFingerprint(accountId);
    if (!fingerprint) {
      fingerprint = generateFingerprint();
      this.db.saveFingerprint(accountId, fingerprint);
      console.log(`🎨 Vygenerován nový fingerprint pro účet ${account.username}`);
    }

    // Použij fingerprint pro context options
    const contextOptions = {
      viewport: fingerprint.viewport,
      userAgent: fingerprint.userAgent,
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

    // Přidej stealth script s konkrétním fingerprintem
    const stealthScript = createStealthScript(fingerprint);
    await context.addInitScript(stealthScript);

    // DŮLEŽITÉ: Přidej human-like behavior pro každou novou page
    context.on('page', async (page) => {
      try {
        const { setupWebSocketInterceptor } = await import('./utils/webSocketBehavior.js');
        await setupWebSocketInterceptor(page, {
          autoHumanize: true,
          minDelay: 500,
          maxDelay: 2000,
          enableIdleBehavior: false, // Vypnuto pro headless (zbytečné)
          logActions: false
        });
      } catch (error) {
        // Tichá chyba - WebSocket behavior je optional enhancement
      }
    });

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
            // Cookies načteny - tichý log
          }
        } else {
          await context.addCookies(cookies);
          // Cookies načteny - tichý log
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
      // Cookies uloženy - tichý log (příliš časté)

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

    // Získej nebo vygeneruj fingerprint pro účet
    let fingerprint = this.db.getFingerprint(accountId);
    if (!fingerprint) {
      fingerprint = generateFingerprint();
      this.db.saveFingerprint(accountId, fingerprint);
      console.log(`🎨 Vygenerován nový fingerprint pro účet ${account.username}`);
    }

    // Zjisti locale podle světa
    const domain = this.db.getDomainForAccount(account);
    const locale = domain.includes('divoke-kmene.sk') ? 'sk-SK' : 'cs-CZ';
    const timezoneId = domain.includes('divoke-kmene.sk') ? 'Europe/Bratislava' : 'Europe/Prague';

    const contextOptions = {
      viewport: null, // Fullscreen mode pro viditelný browser
      userAgent: fingerprint.userAgent,
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

    // Přidej stealth script s unikátním fingerprintem
    const stealthScript = createStealthScript(fingerprint);
    await context.addInitScript(stealthScript);

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
            // Cookies načteny - tichý log
          }
        } else {
          await context.addCookies(cookies);
          // Cookies načteny - tichý log
        }
      } catch (error) {
        console.error('❌ Chyba při načítání cookies:', error.message);
      }
    }

    try {
      const page = await context.newPage();

      // Setup WebSocket interceptor pro human-like timing
      await setupWebSocketInterceptor(page, {
        autoHumanize: true,
        minDelay: 300,
        maxDelay: 1200,
        enableIdleBehavior: false, // Vypnuto pro visible browser (uživatel ovládá)
        logActions: false
      });

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
          waitUntil: 'networkidle',
          timeout: 45000
        });

        // Počkej na stabilizaci stránky
        await page.waitForTimeout(1000);

        // Vyplň username a heslo pokud je přihlašovací formulář
        try {
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
        } catch (evalError) {
          console.log(`⚠️  [${account.username}] Nepodařilo se vyplnit formulář automaticky - vyplňte ručně`);
          console.log(`    Důvod: ${evalError.message}`);
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
    const maxWaitTime = 600000; // 10 minut timeout
    let shouldStop = false;
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
        console.log(`🔒 [${account.username}] Browser zavřen uživatelem`);
        // NEUKLÁDÁME cookies - nevíme jestli se přihlásil!
        shouldStop = true;
      }
    });

    // Spusť watch loop na pozadí
    (async () => {
      while (!shouldStop) {
        // Kontrola timeoutu (10 minut)
        const elapsed = Date.now() - startTime;
        if (elapsed > maxWaitTime) {
          await safeCloseBrowser('timeout');
          break;
        }

        try {
          // Kontrola jestli page ještě existuje
          if (page.isClosed()) {
            shouldStop = true;
            break;
          }

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
              hasLoginForm: hasLoginForm,
              url: window.location.href
            };
          });

          if (loginStatus.isLoggedIn) {
            console.log(`✅ [${account.username}] Přihlášení detekováno!`);
            await safeSaveCookies('přihlášení úspěšné');
            await safeCloseBrowser('přihlášení dokončeno');
            break;
          }
        } catch (error) {
          // Zachyť specifické chyby
          const errorMsg = error.message || '';

          // Pokud je to navigace nebo context destroyed, NEPŘERUŠUJ sledování
          // (stránka se možná jen načítá po přihlášení)
          if (errorMsg.includes('navigation') ||
              errorMsg.includes('Execution context') ||
              errorMsg.includes('detached')) {
            // Počkej 2s a pokračuj
            await new Promise(resolve => setTimeout(resolve, 2000));
            continue;
          }

          // Jiná kritická chyba - zastav sledování
          shouldStop = true;
          break;
        }

        // Pauza mezi kontrolami (POUZE pokud loop pokračuje)
        if (!shouldStop) {
          await new Promise(resolve => setTimeout(resolve, checkInterval));
        }
      }
    })().catch(async (err) => {
      shouldStop = true;
    });
  }
}

export default BrowserManager;