import { chromium } from 'playwright';
import DatabaseManager from './database.js';
import { generateFingerprint, createStealthScript } from './utils/fingerprint.js';
import { setupWebSocketInterceptor } from './utils/webSocketBehavior.js';

class BrowserManager {
  constructor(db = null, persistentContextPool = null) {
    this.db = db || new DatabaseManager();
    this.persistentContextPool = persistentContextPool;
  }

  async createContext(accountId) {
    const account = this.db.getAccount(accountId);

    if (!account) {
      throw new Error(`Účet s ID ${accountId} nebyl nalezen`);
    }

    console.log(`🖥️  Spouštím viditelný prohlížeč pro účet: ${account.username}`);

    // Získej nebo vygeneruj fingerprint pro účet
    let fingerprint = this.db.getFingerprint(accountId);
    if (!fingerprint) {
      fingerprint = generateFingerprint();
      this.db.saveFingerprint(accountId, fingerprint);
      console.log(`🎨 Vygenerován nový fingerprint pro účet ${account.username}`);
    }

    // 🆕 Použij STEJNÝ userDataDir jako hidden browser!
    const userDataDir = this.persistentContextPool
      ? this.persistentContextPool.getUserDataDir(accountId)
      : null;

    // Launch options pro visible browser
    const launchOptions = {
      headless: false,  // VŽDY visible
      viewport: fingerprint.viewport,
      userAgent: fingerprint.userAgent,
      locale: 'cs-CZ',
      timezoneId: 'Europe/Prague',
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--no-sandbox'
      ]
    };

    if (account.proxy) {
      const proxy = this.parseProxy(account.proxy);
      launchOptions.proxy = proxy;
      console.log(`🔐 Používám proxy: ${proxy.server}`);
    }

    // 🆕 Launch s userDataDir (sdílený s hidden browserem)
    const context = userDataDir
      ? await chromium.launchPersistentContext(userDataDir, launchOptions)
      : await chromium.launch(launchOptions).then(b => b.newContext());

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
          enableIdleBehavior: false,
          logActions: false
        });
      } catch (error) {
        // Tichá chyba - WebSocket behavior je optional enhancement
      }
    });

    // 🆕 ŽÁDNÉ cookies z DB! Cookies jsou v userDataDir (sdílené s hidden)
    if (userDataDir) {
      console.log(`🔗 Sdílený userDataDir: ${userDataDir.split('/').pop()} (hidden ↔️ visible)`);
    }

    // Context je BrowserContext (launchPersistentContext) - nemá .browser
    return { browser: context.browser(), context, account };
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
   * 🆕 DEPRECATED: Cookies se ukládají automaticky do userDataDir
   */
  async saveCookies(context, accountId) {
    // No-op: Cookies jsou automaticky v userDataDir (sdílené mezi hidden/visible)
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

    // 🆕 Použij STEJNÝ userDataDir jako hidden browser!
    const userDataDir = this.persistentContextPool
      ? this.persistentContextPool.getUserDataDir(accountId)
      : null;

    // Launch options pro visible browser
    const launchOptions = {
      headless: false,  // VŽDY visible
      viewport: null, // Fullscreen mode
      userAgent: fingerprint.userAgent,
      locale,
      timezoneId,
      ignoreHTTPSErrors: true,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--no-sandbox',
        '--start-maximized'
      ]
    };

    if (account.proxy) {
      const proxy = this.parseProxy(account.proxy);
      launchOptions.proxy = proxy;
      console.log(`🔐 Používám proxy: ${proxy.server}`);
    }

    // 🆕 Launch s userDataDir (sdílený s hidden browserem)
    const context = userDataDir
      ? await chromium.launchPersistentContext(userDataDir, launchOptions)
      : await chromium.launch({ headless: false, args: launchOptions.args }).then(b => b.newContext());

    const browser = context.browser();

    // Přidej stealth script s unikátním fingerprintem
    const stealthScript = createStealthScript(fingerprint);
    await context.addInitScript(stealthScript);

    // 🆕 ŽÁDNÉ cookies z DB! Cookies jsou v userDataDir (sdílené s hidden)
    if (userDataDir) {
      console.log(`🔗 Sdílený userDataDir: ${userDataDir.split('/').pop()} (hidden ↔️ visible)`);
    }

    try {
      // Získej nebo vytvoř page (persistent context může mít default page)
      let pages = context.pages();
      let page = pages.length > 0 ? pages[0] : await context.newPage();

      // Setup WebSocket interceptor pro human-like timing
      await setupWebSocketInterceptor(page, {
        autoHumanize: true,
        minDelay: 300,
        maxDelay: 1200,
        enableIdleBehavior: false, // Vypnuto pro visible browser (uživatel ovládá)
        logActions: false
      });

      if (account.world) {
        // 🆕 NEČISTÍME storage! userDataDir má správné cookies a localStorage
        // Použij targetUrl pokud je zadaná, jinak game.php
        const finalUrl = targetUrl || '/game.php';
        console.log(`🌐 Načítám svět: ${account.world} (${domain}, ${locale}) - URL: ${finalUrl}`);
        await page.goto(`https://${account.world}.${domain}${finalUrl}`, {
          waitUntil: 'networkidle',
          timeout: 45000
        });

        // Počkej na stabilizaci stránky
        await page.waitForTimeout(1000);

        // 🆕 Nejdřív zkontroluj jestli není už přihlášený!
        const alreadyLoggedIn = await page.evaluate(() => {
          // Detekce přihlášení
          const loggedInIndicators = [
            document.querySelector('#menu_row'),
            document.querySelector('#topContainer'),
            document.querySelector('.village-name'),
            document.querySelector('#header_info'),
            document.querySelector('.quickbar')
          ];
          const hasLoggedInElement = loggedInIndicators.some(el => el !== null);

          // Detekce login formuláře
          const loginIndicators = [
            document.querySelector('input[name="user"]'),
            document.querySelector('input[name="password"]'),
            document.querySelector('#login_form')
          ];
          const hasLoginForm = loginIndicators.some(el => el !== null);

          return hasLoggedInElement && !hasLoginForm;
        });

        if (alreadyLoggedIn) {
          console.log(`✅ [${account.username}] Účet je už přihlášený! (sdílený userDataDir funguje)`);
          console.log(`🎉 Můžete prohlížeč zavřít nebo pokračovat v ovládání`);
        } else {
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
        }
      } else {
        console.log(`🌐 Načítám hlavní stránku (${domain})...`);
        await page.goto(`https://www.${domain}/`, {
          waitUntil: 'domcontentloaded',
          timeout: 30000
        });
      }

      // 🆕 Cookies se ukládají automaticky do userDataDir!
      if (autoSaveAndClose) {
        console.log('🖥️  Prohlížeč otevřen - přihlaste se');
        console.log('💾 Cookies se ukládají automaticky do userDataDir (sdílené s hidden)');
        this.startLoginWatcher(browser, context, page, account);
      } else {
        console.log('🖥️  Prohlížeč otevřen pro manuální kontrolu');
        console.log('⚠️  Browser se NEZAVŘE automaticky - zavřete ho ručně');
        console.log('💾 Cookies se ukládají automaticky do userDataDir');
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

    // 🆕 Cookies se ukládají automaticky do userDataDir - tato funkce je deprecated
    const safeSaveCookies = async (reason = '') => {
      // No-op: Cookies jsou automaticky v userDataDir (sdílené mezi hidden/visible)
      console.log(`💾 [${account.username}] Cookies automaticky v userDataDir${reason ? ` - ${reason}` : ''}`);
      return true;
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
        await new Promise(resolve => setTimeout(resolve, checkInterval));

        if (shouldStop) break;

        // Kontrola timeoutu (10 minut)
        const elapsed = Date.now() - startTime;
        if (elapsed > maxWaitTime) {
          console.log(`⏱️  [${account.username}] Timeout (10 min) - zavírám browser`);
          // NEUKLÁDÁME cookies - nevíme jestli se přihlásil!
          await safeCloseBrowser('timeout');
          break;
        }

        // Periodické ukládání cookies ODSTRANĚNO - ukládá se POUZE při úspěšném přihlášení

        try {
          // Kontrola jestli page ještě existuje
          if (page.isClosed()) {
            console.log(`⚠️  [${account.username}] Page zavřen - zastavuji sledování`);
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

          // Debug log každých 30s (každých 6 iterací po 5s)
          const iterationCount = Math.floor((Date.now() - startTime) / checkInterval);
          if (iterationCount % 6 === 0) {
            console.log(`🔍 [${account.username}] Kontrola přihlášení (${Math.floor((Date.now() - startTime) / 1000)}s): přihlášen=${loginStatus.isLoggedIn}, form=${loginStatus.hasLoginForm}, url=${loginStatus.url}`);
          }

          if (loginStatus.isLoggedIn) {
            console.log(`✅ [${account.username}] Přihlášení detekováno! (URL: ${loginStatus.url})`);
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
            console.log(`⏳ [${account.username}] Navigace detekována, pokračuji ve sledování...`);
            // Počkej 2s a pokračuj
            await new Promise(resolve => setTimeout(resolve, 2000));
            continue;
          }

          // Jiná kritická chyba - zastav sledování
          console.log(`⚠️  [${account.username}] Chyba při kontrole přihlášení - zastavuji sledování`);
          console.log(`    Důvod: ${error.message}`);
          shouldStop = true;
          break;
        }
      }
    })().catch(async (err) => {
      console.error(`❌ [${account.username}] Kritická chyba v login watcher:`, err.message);
      // NEUKLÁDÁME cookies při chybě - nevíme jestli se přihlásil!
      // Cookies se uloží jen při úspěšném přihlášení nebo zavření browseru uživatelem
      shouldStop = true;
    });
  }
}

export default BrowserManager;