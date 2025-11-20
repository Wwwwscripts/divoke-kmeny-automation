/**
 * WebSocket Behavior Masking
 * Přidává lidské chování do WebSocket komunikace
 *
 * Hra monitoruje:
 * - Timing mezi akcemi (instant = bot)
 * - Pattern akcí (stejný pattern = bot)
 * - Reakce na eventy (instant = bot)
 * - Idle time (nikdy AFK = bot)
 */

import { randomDelay, randomRange } from './randomize.js';

/**
 * WebSocket Action Manager
 * Spravuje frontu akcí a posílá je s realistickým timingem
 */
export class WebSocketActionManager {
  constructor(wsConnection) {
    this.ws = wsConnection;
    this.actionQueue = [];
    this.isProcessing = false;
    this.lastActionTime = Date.now();
    this.actionHistory = []; // Pro pattern detection
    this.idleMode = false;
    this.stats = {
      totalActions: 0,
      averageDelay: 0,
      minDelay: Infinity,
      maxDelay: 0
    };
  }

  /**
   * Přidej akci do fronty s realistickým zpožděním
   */
  async queueAction(actionData, options = {}) {
    const {
      minDelay = 200,      // Min. zpoždění mezi akcemi (ms)
      maxDelay = 1500,     // Max. zpoždění
      priority = 'normal', // 'urgent', 'normal', 'low'
      actionType = 'generic'
    } = options;

    const action = {
      data: actionData,
      minDelay,
      maxDelay,
      priority,
      actionType,
      queuedAt: Date.now()
    };

    // Priority queue
    if (priority === 'urgent') {
      this.actionQueue.unshift(action);
    } else {
      this.actionQueue.push(action);
    }

    // Spusť processing pokud ještě neběží
    if (!this.isProcessing) {
      this.processQueue();
    }
  }

  /**
   * Zpracuj frontu akcí s lidským timingem
   */
  async processQueue() {
    this.isProcessing = true;

    while (this.actionQueue.length > 0) {
      // Kontrola idle mode
      if (this.idleMode) {
        await randomDelay(5000, 2000);
        continue;
      }

      const action = this.actionQueue.shift();

      // Vypočítej realistické zpoždění od poslední akce
      const timeSinceLastAction = Date.now() - this.lastActionTime;
      let delay = randomRange(action.minDelay, action.maxDelay);

      // Lidé mají různé timing patterns podle typu akce
      if (action.actionType === 'click') {
        // Klikání je obvykle rychlejší
        delay = randomRange(150, 800);
      } else if (action.actionType === 'form_submit') {
        // Formuláře vyžadují přemýšlení
        delay = randomRange(1000, 3000);
      } else if (action.actionType === 'navigation') {
        // Navigace s čtením stránky
        delay = randomRange(2000, 5000);
      }

      // Pattern breaking - občas udělej delší pauzu (jako když člověk přemýšlí)
      if (Math.random() < 0.15) {
        delay += randomRange(1000, 3000);
      }

      // Pokud byla poslední akce moc rychle, přidej extra delay
      if (timeSinceLastAction < 100) {
        delay += randomRange(200, 500);
      }

      // Čekej pokud je potřeba
      if (timeSinceLastAction < delay) {
        await new Promise(r => setTimeout(r, delay - timeSinceLastAction));
      }

      // Pošli akci
      try {
        if (this.ws && this.ws.readyState === 1) { // OPEN
          this.ws.send(JSON.stringify(action.data));

          // Update stats
          this.lastActionTime = Date.now();
          this.stats.totalActions++;

          const actualDelay = Date.now() - action.queuedAt;
          this.stats.averageDelay = (this.stats.averageDelay * (this.stats.totalActions - 1) + actualDelay) / this.stats.totalActions;
          this.stats.minDelay = Math.min(this.stats.minDelay, actualDelay);
          this.stats.maxDelay = Math.max(this.stats.maxDelay, actualDelay);

          // Ulož do historie (max 100 akcí)
          this.actionHistory.push({
            type: action.actionType,
            timestamp: Date.now(),
            delay: actualDelay
          });

          if (this.actionHistory.length > 100) {
            this.actionHistory.shift();
          }
        }
      } catch (error) {
        console.error('WebSocket action error:', error);
      }

      // Micro delay mezi akcemi (jako když uživatel pohybuje myší mezi kliky)
      await randomDelay(50, 30);
    }

    this.isProcessing = false;
  }

  /**
   * Simuluj idle period (AFK behavior)
   * Lidé nejsou 100% aktivní, občas odejdou
   */
  async simulateIdlePeriod(durationMs = null) {
    const duration = durationMs || randomRange(5000, 30000);

    console.log(`💤 Simuluji AFK na ${Math.round(duration / 1000)}s`);
    this.idleMode = true;

    await new Promise(r => setTimeout(r, duration));

    this.idleMode = false;
    console.log('✅ Zpět z AFK');
  }

  /**
   * Náhodné idle periody (volej pravidelně v pozadí)
   */
  startRandomIdleBehavior() {
    const scheduleNextIdle = () => {
      // Náhodně každých 5-15 minut jdi AFK
      const nextIdleIn = randomRange(300000, 900000); // 5-15 min

      setTimeout(async () => {
        // 30% šance že opravdu půjdeš AFK
        if (Math.random() < 0.3) {
          await this.simulateIdlePeriod();
        }
        scheduleNextIdle();
      }, nextIdleIn);
    };

    scheduleNextIdle();
  }

  /**
   * Získej statistiky (pro debugging)
   */
  getStats() {
    return {
      ...this.stats,
      queueLength: this.actionQueue.length,
      isProcessing: this.isProcessing,
      idleMode: this.idleMode,
      recentActions: this.actionHistory.slice(-10)
    };
  }
}

/**
 * WebSocket Interceptor pro automatické přidání human behavior
 */
export function setupWebSocketInterceptor(page, options = {}) {
  const {
    autoHumanize = true,
    minDelay = 200,
    maxDelay = 1500,
    enableIdleBehavior = true,
    logActions = false
  } = options;

  return page.evaluateOnNewDocument((opts) => {
    const OriginalWebSocket = window.WebSocket;
    const actionManagers = new Map();

    window.WebSocket = function(url, protocols) {
      const ws = new OriginalWebSocket(url, protocols);

      // Vytvoř action manager pro tuto connection
      const managerId = Math.random().toString(36).substr(2, 9);

      // Simulace action manageru v browseru
      const actionQueue = [];
      let isProcessing = false;
      let lastActionTime = Date.now();

      const processQueue = async () => {
        if (isProcessing || actionQueue.length === 0) return;
        isProcessing = true;

        while (actionQueue.length > 0) {
          const action = actionQueue.shift();
          const timeSinceLastAction = Date.now() - lastActionTime;

          // Realistické zpoždění
          const delay = Math.random() * (opts.maxDelay - opts.minDelay) + opts.minDelay;

          // Pattern breaking
          const extraDelay = Math.random() < 0.15 ? Math.random() * 2000 + 1000 : 0;

          const totalDelay = Math.max(0, delay + extraDelay - timeSinceLastAction);

          if (totalDelay > 0) {
            await new Promise(r => setTimeout(r, totalDelay));
          }

          // Pošli akci
          try {
            if (ws.readyState === 1) {
              OriginalWebSocket.prototype.send.call(ws, action.data);
              lastActionTime = Date.now();

              if (opts.logActions) {
                console.log('📤 WS humanized send:', action.data);
              }
            }
          } catch (error) {
            console.error('WS send error:', error);
          }

          // Micro delay
          await new Promise(r => setTimeout(r, Math.random() * 50 + 30));
        }

        isProcessing = false;
      };

      // Přepsat send metodu
      if (opts.autoHumanize) {
        ws.send = function(data) {
          // Přidej do fronty místo okamžitého odeslání
          actionQueue.push({ data, queuedAt: Date.now() });
          processQueue();
        };
      }

      // Log received messages
      if (opts.logActions) {
        ws.addEventListener('message', (event) => {
          console.log('📥 WS receive:', event.data);
        });
      }

      return ws;
    };

    // Zkopíruj properties
    window.WebSocket.prototype = OriginalWebSocket.prototype;
    window.WebSocket.CONNECTING = OriginalWebSocket.CONNECTING;
    window.WebSocket.OPEN = OriginalWebSocket.OPEN;
    window.WebSocket.CLOSING = OriginalWebSocket.CLOSING;
    window.WebSocket.CLOSED = OriginalWebSocket.CLOSED;

  }, options);
}

/**
 * Helper: Detekuj aktivní WebSocket connections
 */
export async function getActiveWebSockets(page) {
  return await page.evaluate(() => {
    // Není standardní způsob jak získat aktivní WS connections
    // Ale můžeme zkusit z performance API
    const wsResources = window.performance
      ?.getEntriesByType?.('resource')
      ?.filter(r => r.name?.includes('ws://') || r.name?.includes('wss://'))
      || [];

    return wsResources.map(r => ({
      url: r.name,
      duration: r.duration,
      startTime: r.startTime
    }));
  });
}

/**
 * Helper: Monitor WebSocket traffic (pro debugging)
 */
export async function monitorWebSocketTraffic(page, durationMs = 10000) {
  const messages = {
    sent: [],
    received: []
  };

  // Setup interceptor s logováním
  await setupWebSocketInterceptor(page, {
    autoHumanize: false,
    logActions: true
  });

  // Sbírej zprávy
  await page.exposeFunction('__wsLogSent', (data) => {
    messages.sent.push({ timestamp: Date.now(), data });
  });

  await page.exposeFunction('__wsLogReceived', (data) => {
    messages.received.push({ timestamp: Date.now(), data });
  });

  // Čekej
  await new Promise(r => setTimeout(r, durationMs));

  return messages;
}

export default {
  WebSocketActionManager,
  setupWebSocketInterceptor,
  getActiveWebSockets,
  monitorWebSocketTraffic
};
