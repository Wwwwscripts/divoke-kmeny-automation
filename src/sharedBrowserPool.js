/**
 * Shared Browser Pool - Sdílení browser instancí podle proxy
 * Pro účty se stejnou proxy sdílí browser (šetří RAM)
 */
import { chromium } from 'playwright';
import { generateFingerprint, createStealthScript } from './utils/fingerprint.js';
import { setupWebSocketInterceptor } from './utils/webSocketBehavior.js';

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
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--no-sandbox'
      ]
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
   * Vytvoří context pro účet (s proxy supportem a unikátním fingerprintem)
   */
  async createContext(accountId) {
    const account = this.db.getAccount(accountId);

    if (!account) {
      throw new Error(`Účet s ID ${accountId} nebyl nalezen`);
    }

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

    // Přidej stealth script s konkrétním fingerprintem
    const stealthScript = createStealthScript(fingerprint);
    await context.addInitScript(stealthScript);

    // Přidej WebSocket interceptor script
    await context.addInitScript(`
      (() => {
        const OriginalWebSocket = window.WebSocket;
        const actionQueue = [];
        let isProcessing = false;
        let lastActionTime = Date.now();

        const processQueue = async () => {
          if (isProcessing || actionQueue.length === 0) return;
          isProcessing = true;

          while (actionQueue.length > 0) {
            const action = actionQueue.shift();
            const timeSinceLastAction = Date.now() - lastActionTime;

            // Realistické zpoždění (300-1200ms)
            const delay = Math.random() * 900 + 300;

            // Pattern breaking (15% šance)
            const extraDelay = Math.random() < 0.15 ? Math.random() * 2000 + 1000 : 0;

            const totalDelay = Math.max(0, delay + extraDelay - timeSinceLastAction);

            if (totalDelay > 0) {
              await new Promise(r => setTimeout(r, totalDelay));
            }

            // Pošli akci
            try {
              if (action.ws.readyState === 1) {
                OriginalWebSocket.prototype.send.call(action.ws, action.data);
                lastActionTime = Date.now();
              }
            } catch (error) {
              console.error('WS send error:', error);
            }

            // Micro delay
            await new Promise(r => setTimeout(r, Math.random() * 50 + 30));
          }

          isProcessing = false;
        };

        window.WebSocket = function(url, protocols) {
          const ws = new OriginalWebSocket(url, protocols);

          // Přepsat send metodu pro human-like timing
          const originalSend = ws.send.bind(ws);
          ws.send = function(data) {
            // Přidej do fronty místo okamžitého odeslání
            actionQueue.push({ ws: this, data, queuedAt: Date.now() });
            processQueue();
          };

          return ws;
        };

        // Zkopíruj properties
        window.WebSocket.prototype = OriginalWebSocket.prototype;
        window.WebSocket.CONNECTING = OriginalWebSocket.CONNECTING;
        window.WebSocket.OPEN = OriginalWebSocket.OPEN;
        window.WebSocket.CLOSING = OriginalWebSocket.CLOSING;
        window.WebSocket.CLOSED = OriginalWebSocket.CLOSED;
      })();
    `);

    // Přidej cookies
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
          }
        } else {
          await context.addCookies(cookies);
        }
      } catch (error) {
        console.error('❌ Chyba při načítání cookies:', error.message);
      }
    }

    // Zaznamenej context (s accountId pro pozdější ukládání cookies)
    const browserData = this.browsers.get(browserKey);
    browserData.contexts.add(context);

    // Ulož accountId přímo na context (pro saveAllCookies)
    context._accountId = accountId;

    return { browser, context, account, browserKey };
  }

  /**
   * Uzavře context (ale nechá browser běžet)
   * NEUKLÁDÁ cookies - ty se ukládají po každém úspěšném loginToGame
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
   * Uloží cookies pro účet
   * Volá se po každém úspěšném loginToGame (server může obnovit session cookies)
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
   * Uloží cookies pro všechny otevřené contexty
   * Volá se před shutdown aby se neuložily cookies
   */
  async saveAllCookies() {
    console.log('💾 Ukládám cookies pro všechny otevřené contexty...');

    let savedCount = 0;
    let errorCount = 0;

    for (const [key, data] of this.browsers.entries()) {
      for (const context of data.contexts) {
        try {
          // AccountId bylo uloženo při vytváření contextu
          const accountId = context._accountId;

          if (!accountId) {
            console.warn(`⚠️  Context nemá přiřazený accountId - přeskakuji`);
            continue;
          }

          const cookies = await context.cookies();

          if (cookies && cookies.length > 0) {
            this.db.updateCookies(accountId, cookies);
            savedCount++;
          }
        } catch (error) {
          console.error(`❌ Chyba při ukládání cookies:`, error.message);
          errorCount++;
        }
      }
    }

    console.log(`✅ Cookies uloženy pro ${savedCount} účtů (${errorCount} chyb)`);
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
