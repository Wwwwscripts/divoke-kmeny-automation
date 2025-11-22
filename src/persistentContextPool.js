import { chromium } from 'playwright';
import { generateFingerprint, createStealthScript } from './utils/fingerprint.js';

/**
 * 🚀 PERSISTENT CONTEXT POOL - Anti-CAPTCHA Architecture
 *
 * Každý účet má 1 živý context po celou dobu běhu aplikace.
 * Sessions žijí v browseru, NE v databázi → žádné "zastaralé cookies".
 *
 * Výhody:
 * ✅ Session nikdy nevyprší (browser si ji drží)
 * ✅ ŽÁDNÉ cookies DB → žádný risk špatných cookies
 * ✅ Rychlejší (context se recykluje, ne vytváří)
 * ✅ Anti-ban (méně přihlašování = méně CAPTCHA)
 */
class PersistentContextPool {
  constructor(db) {
    this.db = db;

    // accountId => { browser, context, page, accountId, browserKey }
    this.contexts = new Map();

    // browserKey (proxy) => browser instance
    this.browsers = new Map();
  }

  /**
   * Získá nebo vytvoří persistent context pro účet
   */
  async getContext(accountId) {
    // Pokud existuje a je živý, vrať ho
    if (this.contexts.has(accountId)) {
      const ctx = this.contexts.get(accountId);

      // Health check
      if (await this.isContextAlive(ctx)) {
        return ctx;
      }

      // Context umřel, odstranit a vytvoř nový
      console.log(`⚠️  [ID:${accountId}] Context umřel, vytvářím nový...`);
      this.contexts.delete(accountId);
    }

    // Vytvoř nový persistent context
    return await this.createPersistentContext(accountId);
  }

  /**
   * Vytvoří nový persistent context pro účet
   */
  async createPersistentContext(accountId) {
    const account = this.db.getAccount(accountId);

    if (!account) {
      throw new Error(`Účet s ID ${accountId} nebyl nalezen`);
    }

    // Získej nebo vygeneruj fingerprint pro účet
    let fingerprint = this.db.getFingerprint(accountId);
    if (!fingerprint) {
      fingerprint = generateFingerprint();
      this.db.saveFingerprint(accountId, fingerprint);
      console.log(`🎨 [${account.username}] Vygenerován nový fingerprint`);
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

    // 🚀 ÚSPORA DAT: Blokuj nepotřebné resources
    const blockResources = process.env.BLOCK_RESOURCES !== 'false';
    if (blockResources) {
      await context.route('**/*', (route) => {
        const request = route.request();
        const resourceType = request.resourceType();
        const blockedTypes = ['image', 'media', 'font'];

        if (blockedTypes.includes(resourceType)) {
          route.abort();
        } else {
          route.continue();
        }
      });
    }

    // Přidej stealth script
    const stealthScript = createStealthScript(fingerprint);
    await context.addInitScript(stealthScript);

    // Přidej WebSocket interceptor (anti-bot timing)
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

            // Realistické zpoždění (500-2000ms)
            const delay = Math.random() * 1500 + 500;
            const extraDelay = Math.random() < 0.20 ? Math.random() * 3000 + 1500 : 0;
            const totalDelay = Math.max(0, delay + extraDelay - timeSinceLastAction);

            if (totalDelay > 0) {
              await new Promise(r => setTimeout(r, totalDelay));
            }

            try {
              if (action.ws.readyState === 1) {
                OriginalWebSocket.prototype.send.call(action.ws, action.data);
                lastActionTime = Date.now();
              }
            } catch (error) {
              console.error('WS send error:', error);
            }

            await new Promise(r => setTimeout(r, Math.random() * 50 + 30));
          }

          isProcessing = false;
        };

        window.WebSocket = function(...args) {
          const ws = new OriginalWebSocket(...args);
          const originalSend = ws.send.bind(ws);

          ws.send = function(data) {
            actionQueue.push({ ws, data });
            processQueue();
          };

          return ws;
        };

        window.WebSocket.prototype = OriginalWebSocket.prototype;
      })();
    `);

    // 🆕 PERSISTENT MODE: NEPOUŽÍVEJ cookies z DB!
    // Browser si session pamatuje sám → žádné "zastaralé cookies"
    console.log(`🔐 [${account.username}] Persistent context vytvořen (session žije v browseru)`);

    // Vytvoř page
    const page = await context.newPage();

    // Uložit do poolu
    const ctxData = {
      browser,
      context,
      page,
      accountId,
      browserKey,
      createdAt: Date.now()
    };

    this.contexts.set(accountId, ctxData);

    return ctxData;
  }

  /**
   * Zkontroluje jestli je context stále živý
   */
  async isContextAlive(ctx) {
    try {
      if (!ctx.browser || !ctx.browser.isConnected()) {
        return false;
      }

      if (!ctx.context || ctx.context._closed) {
        return false;
      }

      if (!ctx.page || ctx.page.isClosed()) {
        return false;
      }

      // Zkus získat pages (force check)
      await ctx.browser.pages();

      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Vrátí context zpět do poolu (NEDĚLÁ NIC - context zůstává živý)
   */
  releaseContext(accountId) {
    // Context zůstává živý pro další použití
    // ŽÁDNÉ close(), ŽÁDNÉ saveCookies()
  }

  /**
   * Získá nebo vytvoří browser instanci
   */
  async getBrowser(proxy) {
    const key = proxy || 'default';

    if (this.browsers.has(key)) {
      const browser = this.browsers.get(key);
      if (browser.isConnected()) {
        return browser;
      }
      this.browsers.delete(key);
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

    const browser = await chromium.launch(launchOptions);
    this.browsers.set(key, browser);

    console.log(`🚀 Browser vytvořen pro proxy: ${key}`);

    return browser;
  }

  /**
   * Parse proxy string
   */
  parseProxy(proxyString) {
    if (!proxyString) return null;

    const match = proxyString.match(/^(https?):\/\/([^:]+):(\d+)$/);
    if (!match) {
      throw new Error(`Neplatný formát proxy: ${proxyString}`);
    }

    return {
      server: proxyString
    };
  }

  /**
   * Získá statistiky poolu
   */
  getStats() {
    return {
      contexts: this.contexts.size,
      browsers: this.browsers.size
    };
  }

  /**
   * Zavře všechny contexty a browsery (při shutdown)
   */
  async closeAll() {
    console.log(`🧹 Zavírám ${this.contexts.size} persistent contexts...`);

    // Zavři všechny contexts
    for (const [accountId, ctx] of this.contexts.entries()) {
      try {
        if (ctx.page && !ctx.page.isClosed()) {
          await ctx.page.close();
        }
        if (ctx.context && !ctx.context._closed) {
          await ctx.context.close();
        }
      } catch (error) {
        console.error(`❌ Chyba při zavírání contextu pro účet ${accountId}:`, error.message);
      }
    }

    this.contexts.clear();

    // Zavři všechny browsery
    console.log(`🧹 Zavírám ${this.browsers.size} browserů...`);
    for (const [key, browser] of this.browsers.entries()) {
      try {
        if (browser.isConnected()) {
          await browser.close();
        }
      } catch (error) {
        console.error(`❌ Chyba při zavírání browseru ${key}:`, error.message);
      }
    }

    this.browsers.clear();
    console.log('✅ Persistent context pool vyčištěn');
  }
}

export default PersistentContextPool;
