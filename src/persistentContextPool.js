import { chromium } from 'playwright';
import { generateFingerprint, createStealthScript } from './utils/fingerprint.js';
import { mkdirSync } from 'fs';
import { join } from 'path';

/**
 * 🚀 PERSISTENT CONTEXT POOL - Visible browsery pro každý účet
 *
 * Každý účet má vlastní VISIBLE persistent browser s userDataDir:
 * - VŽDY visible (headless: false)
 * - Persistent session (userDataDir na disku)
 * - Automatické ukládání cookies a localStorage
 *
 * Výhody:
 * ✅ ŽÁDNÉ ukládání cookies do DB!
 * ✅ Každý účet má vlastní okno prohlížeče
 * ✅ Můžete přepínat mezi účty kliknutím na okno
 * ✅ Session přežije restart aplikace
 * ✅ Anti-ban (jednoduchý browser fingerprint, realistické chování)
 */
class PersistentContextPool {
  constructor(db) {
    this.db = db;

    // accountId => { context (browser instance), page, accountId, userDataDir }
    this.contexts = new Map();

    // Vytvoř base directory pro user data
    this.baseDataDir = process.env.USER_DATA_DIR || '/tmp/divoke-kmeny';
    try {
      mkdirSync(this.baseDataDir, { recursive: true });
    } catch (error) {
      // Directory už existuje, ok
    }
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
   * Vytvoří nový persistent context pro účet (s userDataDir)
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

    // UserDataDir pro tento účet (sdílený mezi hidden & visible)
    const userDataDir = join(this.baseDataDir, `account-${accountId}`);

    // Launch options pro persistent context - VŽDY VISIBLE
    const launchOptions = {
      headless: false,  // 🆕 VŽDY VISIBLE - každý účet má svůj viditelný prohlížeč
      viewport: null,    // 🆕 Fullscreen mode
      userAgent: fingerprint.userAgent,
      locale: 'cs-CZ',
      timezoneId: 'Europe/Prague',
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--no-sandbox',
        '--start-maximized'  // 🆕 Maximalizované okno
      ]
    };

    // Přidej proxy, pokud existuje
    if (account.proxy) {
      const proxy = this.parseProxy(account.proxy);
      launchOptions.proxy = proxy;
    }

    // 🆕 Launch persistent context (browser s trvalým úložištěm) - VISIBLE!
    const context = await chromium.launchPersistentContext(userDataDir, launchOptions);

    // 🆕 ŽÁDNÉ blokování resources - visible browsery potřebují zobrazit vše

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

    // 🆕 ŽÁDNÉ cookies! UserDataDir si pamatuje session automaticky

    // Získej nebo vytvoř page (persistent context může mít default page)
    let pages = context.pages();
    let page = pages.length > 0 ? pages[0] : await context.newPage();

    // Uložit do poolu
    const ctxData = {
      context,  // BrowserContext instance (má vlastní browser)
      page,
      accountId,
      userDataDir,
      createdAt: Date.now()
    };

    this.contexts.set(accountId, ctxData);

    return ctxData;
  }

  /**
   * Vrátí userDataDir pro účet (pro sdílení s visible browserem)
   */
  getUserDataDir(accountId) {
    return join(this.baseDataDir, `account-${accountId}`);
  }

  /**
   * Zkontroluje jestli je context stále živý
   */
  async isContextAlive(ctx) {
    try {
      if (!ctx.context || ctx.context._closed) {
        return false;
      }

      const browser = ctx.context.browser();
      if (!browser || !browser.isConnected()) {
        return false;
      }

      if (!ctx.page || ctx.page.isClosed()) {
        return false;
      }

      // Zkus získat pages (force check)
      await ctx.context.pages();

      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Vrátí context zpět do poolu a ZAVŘE ho (session zůstane v userDataDir)
   */
  async releaseContext(accountId) {
    // 🆕 ZAVŘI browser po dokončení - session zůstává v userDataDir
    const ctx = this.contexts.get(accountId);

    if (ctx && ctx.context && !ctx.context._closed) {
      try {
        await ctx.context.close();
        this.contexts.delete(accountId);
        console.log(`✅ [ID:${accountId}] Browser zavřen (session uložena v userDataDir)`);
      } catch (error) {
        console.error(`❌ [ID:${accountId}] Chyba při zavírání browseru:`, error.message);
      }
    }
  }

  /**
   * Parse proxy string (podpora pro username:password@host:port)
   */
  parseProxy(proxyString) {
    if (!proxyString) return null;

    let proxy = {};

    // Pokud nemá protokol, přidej http://
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

      return proxy;
    } catch (error) {
      throw new Error(`Neplatný formát proxy: ${proxyString}`);
    }
  }

  /**
   * Získá statistiky poolu
   */
  getStats() {
    return {
      contexts: this.contexts.size
    };
  }

  /**
   * Zavře všechny contexty (při shutdown)
   */
  async closeAll() {
    console.log(`🧹 Zavírám ${this.contexts.size} persistent contexts (s userDataDir)...`);

    // Zavři všechny contexts (každý má vlastní browser)
    for (const [accountId, ctx] of this.contexts.entries()) {
      try {
        if (ctx.context && !ctx.context._closed) {
          await ctx.context.close();  // Zavře i browser
        }
      } catch (error) {
        console.error(`❌ Chyba při zavírání contextu pro účet ${accountId}:`, error.message);
      }
    }

    this.contexts.clear();
    console.log('✅ Persistent context pool vyčištěn (userDataDir zůstávají na disku)');
  }
}

export default PersistentContextPool;
