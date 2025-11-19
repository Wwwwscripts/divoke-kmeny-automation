import logger from './logger.js';

/**
 * Správa fronty pro visible browsery s limitem současně otevřených browserů
 */
class BrowserQueue {
  constructor(browserManager, maxConcurrent = 5) {
    this.browserManager = browserManager;
    this.maxConcurrent = maxConcurrent;
    this.queue = []; // Fronta čekajících požadavků
    this.activeBrowsers = new Map(); // accountId => { browser, context, page, reason }
    this.processing = false;
    this.onCloseCallback = null; // Callback volaný při zavření browseru

    // Spusť periodický cleanup každých 30 sekund
    this.cleanupInterval = setInterval(() => {
      this.cleanupDisconnectedBrowsers();
    }, 30000);
  }

  /**
   * Nastaví callback volaný při zavření browseru
   * @param {Function} callback - Funkce volaná s (accountId, reason)
   */
  setOnCloseCallback(callback) {
    this.onCloseCallback = callback;
  }

  /**
   * Přidá účet do fronty pro otevření visible browseru
   * @param {number} accountId - ID účtu
   * @param {string} reason - Důvod otevření (captcha, new_account, conquered, manual)
   * @param {boolean} autoClose - Zda automaticky zavřít po přihlášení
   */
  async enqueue(accountId, reason = 'manual', autoClose = false) {
    // Nejdřív vyčisti odpojené browsery
    this.cleanupDisconnectedBrowsers();

    // Zkontroluj zda už není v aktivních browserech
    if (this.activeBrowsers.has(accountId)) {
      logger.info(`[BrowserQueue] Browser pro účet ${accountId} je již otevřený, ignoruji`);
      return null;
    }

    // Zkontroluj zda už není ve frontě
    const alreadyQueued = this.queue.some(item => item.accountId === accountId);
    if (alreadyQueued) {
      logger.info(`[BrowserQueue] Browser pro účet ${accountId} je již ve frontě, ignoruji`);
      return null;
    }

    // Přidej do fronty
    this.queue.push({ accountId, reason, autoClose, timestamp: Date.now() });
    logger.info(`[BrowserQueue] Přidán do fronty: účet ${accountId}, důvod: ${reason}, fronta: ${this.queue.length}, aktivní: ${this.activeBrowsers.size}/${this.maxConcurrent}`);

    // Spusť zpracování
    this.processQueue();

    return true;
  }

  /**
   * Zpracuje frontu - otevře další browsery pokud je místo
   */
  async processQueue() {
    // Prevence paralelního zpracování
    if (this.processing) {
      return;
    }

    this.processing = true;

    try {
      // Nejdřív vyčisti odpojené browsery
      this.cleanupDisconnectedBrowsers();

      while (this.queue.length > 0 && this.activeBrowsers.size < this.maxConcurrent) {
        const item = this.queue.shift();
        await this.openBrowser(item);
      }
    } catch (error) {
      logger.error('[BrowserQueue] Chyba při zpracování fronty:', error);
    } finally {
      this.processing = false;
    }

    // Loguj stav fronty
    if (this.queue.length > 0) {
      logger.info(`[BrowserQueue] Ve frontě čeká ${this.queue.length} browserů, aktivní: ${this.activeBrowsers.size}/${this.maxConcurrent}`);
    }
  }

  /**
   * Otevře visible browser pro účet
   */
  async openBrowser(item) {
    const { accountId, reason, autoClose } = item;

    try {
      logger.info(`[BrowserQueue] Otevírám browser pro účet ${accountId}, důvod: ${reason}, autoClose: ${autoClose}`);

      // Otevři browser pomocí browserManager
      const browserInfo = await this.browserManager.testConnection(accountId, autoClose);

      if (!browserInfo) {
        logger.error(`[BrowserQueue] Nepodařilo se otevřít browser pro účet ${accountId}`);
        return;
      }

      const { browser, context, page } = browserInfo;

      // Nastav listener na zavření browseru HNED (před přidáním do aktivních)
      browser.on('disconnected', () => {
        logger.info(`[BrowserQueue] 🔔 Disconnected event pro účet ${accountId}`);
        this.onBrowserClosed(accountId);
      });

      // Přidej do aktivních browserů
      this.activeBrowsers.set(accountId, {
        browser,
        context,
        page,
        reason,
        autoClose,
        openedAt: Date.now()
      });

      logger.info(`[BrowserQueue] Browser otevřen pro účet ${accountId}, aktivní: ${this.activeBrowsers.size}/${this.maxConcurrent}`);

    } catch (error) {
      logger.error(`[BrowserQueue] Chyba při otevírání browseru pro účet ${accountId}:`, error);
      // Pokud nastala chyba, zkus odstranit z aktivních browserů
      this.activeBrowsers.delete(accountId);
    }
  }

  /**
   * Callback když se browser zavře (uživatel zavřel nebo automaticky)
   */
  async onBrowserClosed(accountId) {
    const browserInfo = this.activeBrowsers.get(accountId);

    if (!browserInfo) {
      return;
    }

    const duration = Math.round((Date.now() - browserInfo.openedAt) / 1000);
    logger.info(`[BrowserQueue] Browser pro účet ${accountId} byl zavřen po ${duration}s, důvod: ${browserInfo.reason}`);

    // Ulož cookies (pokud browser ještě existuje a je připojený)
    try {
      if (browserInfo.context && browserInfo.browser && browserInfo.browser.isConnected()) {
        await this.browserManager.saveCookies(browserInfo.context, accountId);
        logger.info(`[BrowserQueue] Cookies uloženy pro účet ${accountId} po zavření browseru`);
      }
    } catch (error) {
      logger.error(`[BrowserQueue] Chyba při ukládání cookies po zavření pro účet ${accountId}:`, error);
    }

    // Odstraň z aktivních browserů
    this.activeBrowsers.delete(accountId);
    logger.info(`[BrowserQueue] Odebrán z aktivních browserů: účet ${accountId}, aktivní: ${this.activeBrowsers.size}/${this.maxConcurrent}`);

    // Zavolej callback pokud je nastaven
    if (this.onCloseCallback) {
      try {
        this.onCloseCallback(accountId, browserInfo.reason);
      } catch (error) {
        logger.error(`[BrowserQueue] Chyba v onCloseCallback pro účet ${accountId}:`, error);
      }
    }

    // Zpracuj další položky z fronty
    if (this.queue.length > 0) {
      logger.info(`[BrowserQueue] Zpracovávám další položku z fronty (${this.queue.length} čeká)`);
      this.processQueue();
    }
  }

  /**
   * Vyčistí odpojené browsery z activeBrowsers
   */
  cleanupDisconnectedBrowsers() {
    let cleaned = 0;
    for (const [accountId, browserInfo] of this.activeBrowsers.entries()) {
      // Zkontroluj jestli je browser stále připojený
      if (!browserInfo.browser || !browserInfo.browser.isConnected()) {
        logger.info(`[BrowserQueue] 🧹 Čistím odpojený browser pro účet ${accountId}`);
        this.activeBrowsers.delete(accountId);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      logger.info(`[BrowserQueue] 🧹 Vyčištěno ${cleaned} odpojených browserů, aktivní: ${this.activeBrowsers.size}/${this.maxConcurrent}`);
    }
    return cleaned;
  }

  /**
   * Zkontroluje zda je browser ve frontě
   */
  isInQueue(accountId) {
    return this.queue.some(item => item.accountId === accountId);
  }

  /**
   * Zkontroluje zda je browser aktivní pro daný účet
   */
  isBrowserActive(accountId) {
    // Nejdřív vyčisti odpojené browsery
    this.cleanupDisconnectedBrowsers();

    const browserInfo = this.activeBrowsers.get(accountId);

    if (!browserInfo) {
      return false;
    }

    // Ověř že browser je stále připojený
    if (!browserInfo.browser || !browserInfo.browser.isConnected()) {
      this.activeBrowsers.delete(accountId);
      return false;
    }

    return true;
  }

  /**
   * Vrátí informace o stavu fronty
   */
  getStatus() {
    return {
      active: this.activeBrowsers.size,
      maxConcurrent: this.maxConcurrent,
      queued: this.queue.length,
      total: this.activeBrowsers.size + this.queue.length,
      activeBrowsers: Array.from(this.activeBrowsers.keys()),
      queuedAccounts: this.queue.map(item => ({
        accountId: item.accountId,
        reason: item.reason,
        waitingTime: Math.round((Date.now() - item.timestamp) / 1000)
      }))
    };
  }

  /**
   * Zavře všechny aktivní browsery
   */
  async closeAll() {
    logger.info(`[BrowserQueue] Zavírám všechny aktivní browsery (${this.activeBrowsers.size})`);

    // Zastaví periodický cleanup
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    const closePromises = [];
    for (const [accountId, browserInfo] of this.activeBrowsers) {
      if (browserInfo.browser && browserInfo.browser.isConnected()) {
        closePromises.push(browserInfo.browser.close().catch(err => {
          logger.error(`[BrowserQueue] Chyba při zavírání browseru pro účet ${accountId}:`, err);
        }));
      }
    }

    await Promise.all(closePromises);
    this.activeBrowsers.clear();
    this.queue = [];

    logger.info('[BrowserQueue] Všechny browsery zavřeny a fronta vyčištěna');
  }
}

export default BrowserQueue;
