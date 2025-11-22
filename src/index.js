import 'dotenv/config';
import { existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import DatabaseManager from './database.js';
import BrowserManager from './browserManager.js';
import PersistentContextPool from './persistentContextPool.js';
import WorkerPool from './workerPool.js';
import AccountInfoModule from './modules/accountInfo.js';
import RecruitModule from './modules/recruit.js';
import BuildingModule from './modules/building.js';
import ResearchModule from './modules/research.js';
import NotificationsModule from './modules/notifications.js';
import PaladinModule from './modules/paladin.js';
import SupportModule from './modules/support.js';
import DailyRewardsModule from './modules/dailyRewards.js';
import ScavengeModule from './modules/scavenge.js';
import logger from './logger.js';
import { randomizeInterval } from './utils/randomize.js';
import { detectAnyChallenge, detectBan } from './utils/antiBot.js';

/**
 * 🚀 Event-Driven Automator s nezávislými smyčkami
 *
 * Architektura:
 * - Globální WorkerPool (max 100 procesů)
 * - 8 nezávislých smyček:
 *   1. Kontroly (útoky/CAPTCHA) - neustále dokola po 2 účtech [P1]
 *   2. Build - každých 5s po 5 účtech (COOLDOWN režim) [P1]
 *   3. Rekrut - každé 2 minuty po 5 účtech [P3]
 *   4. Výzkum - každých 120 minut po 5 účtech [P4]
 *   5. Paladin - každých 120 minut po 5 účtech [P5]
 *   6. Jednotky - každých 20 minut po 2 účtech [P6]
 *   7. Denní odměny - jednou denně ve 4:00 nebo při startu [P6]
 *   8. Sběr - každých 5 minut po 5 účtech [P2]
 */
class Automator {
  constructor() {
    this.db = new DatabaseManager();
    this.browserPool = new PersistentContextPool(this.db); // 🆕 Persistent contexts
    this.browserManager = new BrowserManager(this.db, this.browserPool); // 🆕 Sdílený userDataDir
    this.workerPool = new WorkerPool(100); // Max 100 procesů
    this.isRunning = false;
    this.accountWaitTimes = {}; // Per-account per-module timing
    this.captchaDetected = new Set(); // Účty s detekovanou CAPTCHA (aby se nespamovalo)
    this.openBrowsers = new Map(); // Tracking otevřených visible browserů (accountId => browser)
    this.openingBrowsers = new Set(); // Tracking účtů pro které se právě otevírá browser (race condition protection)

    // 🆕 ANTI-BAN: Fronta pro přihlášení + limit visible browserů
    this.loginQueue = []; // Fronta účtů čekajících na přihlášení
    this.maxVisibleBrowsers = 5; // Max 5 visible browserů najednou
    this.activeVisibleBrowsers = 0; // Počítadlo aktivních visible browserů
    this.isProcessingQueue = false; // Mutex pro zpracování fronty (prevence duplicit)

    // Intervaly pro smyčky - ZVÝŠENO pro snížení captcha rizika
    this.intervals = {
      checks: 0,        // Kontroly běží neustále (žádný wait)
      recruit: 180 * 60 * 1000,   // 180 minut (3 hodiny) - ANTI-CAPTCHA
      building: 30 * 1000,        // 30 sekund - COOLDOWN režim (zvýšeno z 5s)
      research: 6 * 60 * 60 * 1000,  // 6 hodin - ANTI-CAPTCHA
      paladin: 6 * 60 * 60 * 1000,    // 6 hodin - ANTI-CAPTCHA
      units: 60 * 60 * 1000,      // 60 minut (1 hodina) - ANTI-CAPTCHA
      accountInfo: 25 * 60 * 1000, // 25 minut (zvýšeno z 20min)
      dailyRewards: 24 * 60 * 60 * 1000, // Nepoužívá se - denní odměny běží 2x denně (4:00 a 16:00)
      scavenge: 30 * 60 * 1000,    // 30 minut - ANTI-CAPTCHA
    };

    // Priority (nižší = vyšší priorita)
    this.priorities = {
      checks: 1,        // Útoky/CAPTCHA
      building: 1,      // Výstavba - STEJNÁ PRIORITA jako kontroly
      scavenge: 2,      // Sběr - vyšší priorita než rekrut
      recruit: 3,       // Rekrutování
      research: 4,      // Výzkum
      paladin: 5,       // Paladin
      units: 6,         // Kontrola jednotek
      dailyRewards: 6,  // Denní odměny - stejná priorita jako jednotky
      stats: 7          // Statistiky
    };
  }

  /**
   * 🆕 Získá doménu pro daný svět (CZ nebo SK)
   */
  getWorldDomain(world) {
    if (!world) return 'divokekmeny.cz';

    if (world.toLowerCase().startsWith('sk')) {
      return 'divoke-kmene.sk';
    }

    return 'divokekmeny.cz';
  }

  /**
   * Zkontroluje jestli existuje .shutdown flag soubor
   * Pokud ano, zahájí graceful shutdown a vrátí true
   */
  async checkShutdownFlag() {
    const shutdownFile = join(process.cwd(), '.shutdown');

    if (existsSync(shutdownFile)) {
      console.log('\n🛑 Detekován shutdown flag - zahajuji graceful shutdown...');

      // Smaž flag soubor
      try {
        unlinkSync(shutdownFile);
        console.log('🗑️  Shutdown flag smazán');
      } catch (error) {
        console.error('⚠️  Nepodařilo se smazat shutdown flag:', error.message);
      }

      // Zavolej stop()
      await this.stop();

      // Exit proces
      process.exit(0);
    }

    return false;
  }

  /**
   * Zkontroluje jestli je browser pro daný účet opravdu ještě otevřený a připojený
   * @returns {boolean} true pokud je browser aktivní, false pokud ne
   */
  isBrowserActive(accountId) {
    const browserInfo = this.openBrowsers.get(accountId);
    if (!browserInfo) return false;

    // Zkontroluj jestli je browser stále připojený a page není zavřený
    const isConnected = browserInfo.browser && browserInfo.browser.isConnected();
    const pageValid = browserInfo.page && !browserInfo.page.isClosed();

    if (!isConnected || !pageValid) {
      this.openBrowsers.delete(accountId);
      return false;
    }

    return true;
  }

  /**
   * 🆕 ANTI-BAN: Zpracuje frontu přihlášení (max 5 visible browserů najednou)
   */
  async processLoginQueue() {
    // 🛡️ MUTEX: Pokud už fronta běží, nepouštěj další instance
    if (this.isProcessingQueue) {
      console.log('⏸️  Fronta již běží - přeskakuji duplicitní volání');
      return;
    }

    // 🔒 Zamkni frontu
    this.isProcessingQueue = true;

    try {
      // Zpracuj všechny účty co můžeš (dokud je místo)
      while (this.activeVisibleBrowsers < this.maxVisibleBrowsers && this.loginQueue.length > 0) {
        // Vezmi další účet z fronty
        const account = this.loginQueue.shift();

        // Zkontroluj jestli už není browser otevřený
        if (this.isBrowserActive(account.id) || this.openingBrowsers.has(account.id)) {
          console.log(`⏭️  [${account.username}] Přeskakuji - browser již otevřen/otevírá se`);
          continue; // Zkus další z fronty
        }

        console.log(`🔑 [${account.username}] Otevírám browser pro přihlášení (${this.activeVisibleBrowsers + 1}/${this.maxVisibleBrowsers})`);

        // Označ že se browser otevírá
        this.openingBrowsers.add(account.id);
        this.activeVisibleBrowsers++;

        // Otevři browser asynchronně (nepočkej na dokončení, pokračuj další)
        this.openBrowserForAccount(account).catch(err => {
          console.error(`❌ [${account.username}] Chyba při otevírání browseru:`, err.message);

          // Cleanup při chybě
          this.openBrowsers.delete(account.id);
          this.openingBrowsers.delete(account.id);
          this.activeVisibleBrowsers = Math.max(0, this.activeVisibleBrowsers - 1);

          // Zkus zpracovat další z fronty
          this.isProcessingQueue = false;
          this.processLoginQueue().catch(e => console.error('❌ Chyba při retry fronty:', e));
        });
      }
    } finally {
      // 🔓 Odemkni frontu
      this.isProcessingQueue = false;
    }
  }

  /**
   * 🆕 Otevře browser pro konkrétní účet
   */
  async openBrowserForAccount(account) {
    // 🆕 Cleanup funkce která se zavolá při jakémkoliv zavření
    const cleanup = () => {
      // Kontrola jestli už nebyl vyčištěn
      if (!this.openBrowsers.has(account.id) && !this.openingBrowsers.has(account.id)) {
        console.log(`⚠️  [${account.username}] Cleanup již byl zavolán - přeskakuji`);
        return; // Už byl vyčištěn
      }

      this.openBrowsers.delete(account.id);
      this.openingBrowsers.delete(account.id);
      this.captchaDetected.delete(account.id);

      // Sníž počítadlo (ale nikdy ne pod 0)
      const oldCount = this.activeVisibleBrowsers;
      this.activeVisibleBrowsers = Math.max(0, this.activeVisibleBrowsers - 1);

      console.log(`✅ [${account.username}] Browser zavřen (${oldCount} → ${this.activeVisibleBrowsers}/${this.maxVisibleBrowsers})`);

      // 🆕 AUTO-UNPAUSE: Účet se automaticky unpausne po zavření browseru
      this.db.updateAccountPause(account.id, false);
      console.log(`▶️  [${account.username}] Účet automaticky aktivován`);

      // Zpracuj další z fronty
      console.log(`🔄 [${account.username}] Zpracovávám frontu (čeká: ${this.loginQueue.length} účtů)`);
      this.processLoginQueue().catch(err => {
        console.error(`❌ Chyba při zpracování fronty po cleanup:`, err);
      });
    };

    try {
      // Smaž neplatné cookies
      const accountData = this.db.getAccount(account.id);
      if (accountData && accountData.cookies && accountData.cookies !== 'null') {
        this.db.updateCookies(account.id, null);
      }

      const browserInfo = await this.browserManager.testConnection(account.id, true); // true = auto-close po přihlášení

      if (browserInfo) {
        const { browser, page } = browserInfo;
        this.openBrowsers.set(account.id, browserInfo);

        // Sleduj zavření browseru (event)
        browser.on('disconnected', () => {
          console.log(`📡 [${account.username}] Browser disconnected event fired`);
          cleanup();
        });

        // Sleduj zavření page (pro případ že browser zůstane ale page se zavře)
        if (page) {
          page.on('close', () => {
            console.log(`📄 [${account.username}] Page closed event fired`);
            cleanup();
          });
        }

        // 🆕 FAILSAFE: Kontroluj každých 500ms jestli je browser stále připojený (AGRESIVNÍ detekce)
        let checkCounter = 0;
        const checkInterval = setInterval(async () => {
          checkCounter++;
          let isAlive = true;

          try {
            // Check 1: Browser connected?
            if (!browser.isConnected()) {
              console.log(`🔍 [${account.username}] Check ${checkCounter}: browser.isConnected() = false`);
              isAlive = false;
            }

            // Check 2: Page closed?
            if (isAlive && page && page.isClosed()) {
              console.log(`🔍 [${account.username}] Check ${checkCounter}: page.isClosed() = true`);
              isAlive = false;
            }

            // Check 3: Can we get pages? (force detection)
            if (isAlive) {
              try {
                await browser.pages();
              } catch (pagesError) {
                console.log(`🔍 [${account.username}] Check ${checkCounter}: browser.pages() failed - ${pagesError.message}`);
                isAlive = false;
              }
            }

            // Check 4: Can we get targets?
            if (isAlive) {
              try {
                const targets = await browser.targets();
                if (targets.length === 0) {
                  console.log(`🔍 [${account.username}] Check ${checkCounter}: No targets found`);
                  isAlive = false;
                }
              } catch (targetsError) {
                console.log(`🔍 [${account.username}] Check ${checkCounter}: browser.targets() failed - ${targetsError.message}`);
                isAlive = false;
              }
            }
          } catch (error) {
            console.log(`🔍 [${account.username}] Check ${checkCounter}: Unexpected error - ${error.message}`);
            isAlive = false;
          }

          if (!isAlive) {
            clearInterval(checkInterval);

            // Pokud není v openBrowsers, už byl zpracován
            if (this.openBrowsers.has(account.id)) {
              console.log(`🔍 [${account.username}] Browser zavřen ručně (detekováno intervalem po ${checkCounter} checks)`);
              cleanup();
            }
          }
        }, 500); // Každých 500ms!

        // Vyčisti interval když se browser zavře normálně
        browser.once('disconnected', () => {
          clearInterval(checkInterval);
        });

        if (page) {
          page.once('close', () => {
            clearInterval(checkInterval);
          });
        }
      }
    } catch (error) {
      console.error(`❌ [${account.username}] Chyba při otevírání browseru:`, error.message);
      cleanup(); // Zavolej cleanup i při chybě
    }
  }

  /**
   * 🆕 ANTI-BAN: Zpracuj selhání přihlášení - pausni účet a otevři browser
   * Browser zůstane otevřený dokud se uživatel ručně nepřihlásí
   */
  async handleFailedLogin(account) {
    // Zkontroluj jestli už není browser otevřený nebo se otevírá
    if (this.isBrowserActive(account.id) || this.openingBrowsers.has(account.id)) {
      console.log(`⏭️  [${account.username}] Browser již otevřen/otevírá se - přeskakuji`);
      return;
    }

    console.log(`⏸️  [${account.username}] Přihlášení selhalo - pausuji účet a otevírám browser`);

    // 🆕 AUTO-PAUSE: Pausni účet (smyčky ho přeskočí)
    this.db.updateAccountPause(account.id, true);

    // Označ že se browser otevírá (zabráníme duplicitním otevíráním)
    this.openingBrowsers.add(account.id);
    this.activeVisibleBrowsers++;

    try {
      // Otevři browser BEZ auto-close (zůstane otevřený dokud uživatel nepřihlásí)
      const browserInfo = await this.browserManager.testConnection(account.id, false);

      if (browserInfo) {
        const { browser, page } = browserInfo;
        this.openBrowsers.set(account.id, browserInfo);

        console.log(`🖥️  [${account.username}] Browser otevřen - čeká na přihlášení`);

        // Cleanup funkce při zavření
        const cleanup = async () => {
          if (!this.openBrowsers.has(account.id)) {
            return; // Už byl vyčištěn
          }

          // 💾 Ulož cookies PŘED zavřením visible browseru!
          try {
            const browserInfo = this.openBrowsers.get(account.id);
            if (browserInfo && browserInfo.context) {
              const cookies = await browserInfo.context.cookies();
              const czAuthCookie = cookies.find(c => c.name === 'cz_auth');

              if (czAuthCookie) {
                // 💾 ULOŽ cookies do JSON souboru pro hidden browser!
                const { writeFileSync } = await import('fs');
                const { join: pathJoin } = await import('path');
                const cookiesPath = pathJoin(this.browserPool.getUserDataDir(account.id), 'playwright-cookies.json');
                writeFileSync(cookiesPath, JSON.stringify(cookies, null, 2));
                console.log(`💾 [${account.username}] Session uložena (${cookies.length} cookies)`);
              } else {
                console.log(`⚠️  [${account.username}] cz_auth cookie nenalezen - možná nebyl přihlášen`);
              }
            }
          } catch (cookieError) {
            console.log(`⚠️  [${account.username}] Nelze uložit session: ${cookieError.message}`);
          }

          this.openBrowsers.delete(account.id);
          this.openingBrowsers.delete(account.id);
          this.captchaDetected.delete(account.id);
          this.activeVisibleBrowsers = Math.max(0, this.activeVisibleBrowsers - 1);

          // Restart hidden persistent context aby načetl nové cookies
          if (this.browserPool && this.browserPool.contexts && this.browserPool.contexts.has(account.id)) {
            const ctx = this.browserPool.contexts.get(account.id);
            if (ctx && ctx.context && !ctx.context._closed) {
              await ctx.context.close().catch(() => {});
            }
            this.browserPool.contexts.delete(account.id);
          }

          // Počkej 10s aby se cookies uložily na disk
          await new Promise(resolve => setTimeout(resolve, 10000));

          // AUTO-UNPAUSE po zavření
          this.db.updateAccountPause(account.id, false);
          console.log(`✅ [${account.username}] Browser zavřen - účet pokračuje`);
        };

        // Sleduj zavření browseru
        browser.on('disconnected', () => {
          console.log(`📡 [${account.username}] Browser disconnected`);
          cleanup();
        });

        // Sleduj zavření page
        if (page) {
          page.on('close', () => {
            console.log(`📄 [${account.username}] Page closed`);
            cleanup();
          });
        }
      } else {
        throw new Error('Nepodařilo se otevřít browser');
      }
    } catch (error) {
      console.error(`❌ [${account.username}] Chyba při otevírání browseru:`, error.message);
      // Cleanup při chybě
      this.openingBrowsers.delete(account.id);
      this.activeVisibleBrowsers = Math.max(0, this.activeVisibleBrowsers - 1);
    } finally {
      // Odstraň z openingBrowsers po úspěšném otevření
      if (this.openBrowsers.has(account.id)) {
        this.openingBrowsers.delete(account.id);
      }
    }
  }

  /**
   * Spustí všechny smyčky
   */
  async start() {
    console.log('='.repeat(70));
    console.log('🤖 Spouštím Event-Driven automatizaci - ANTI-CAPTCHA & ANTI-BAN REŽIM');
    console.log('⚡ Worker Pool: Max 100 procesů');
    console.log('🛡️  Aktivní ochrana: Human behavior, WebSocket timing, Fingerprinting');
    console.log('🚫 ANTI-BAN: Max 5 visible browserů, auto-pause při selhání přihlášení');
    console.log('🆕 PERSISTENT MODE: Sessions žijí v browseru, žádné cookies v DB!');
    console.log('🔄 Aktivní smyčky (ANTI-CAPTCHA režim):');
    console.log('   [P1] Kontroly útoků: po 10 účtech (10s pauzy), cyklus každých 5 min');
    console.log('   [P1] Build: každých 30s po 5 účtech (±15s random, 12-18min při chybě)');
    console.log('   [P2] Sběr: každých 30 MINUT po 5 účtech (±5 min random)');
    console.log('   [P3] Rekrut: každé 3 HODINY po 10 účtech (delší delays 5-8s)');
    console.log('   [P4] Výzkum: každých 6 HODIN (±30 min random)');
    console.log('   [P5] Paladin: každých 6 HODIN (±30 min random)');
    console.log('   [P6] Jednotky: každou 1 HODINU po 2 účtech (±10 min random)');
    console.log('   [P6] Denní odměny: 2x denně (4:00 a 16:00)');
    console.log('   ⏸️  CAPTCHA kontrola: při každém přihlášení (ne v loopu)');
    console.log('='.repeat(70));

    this.isRunning = true;

    // 🆕 WATCHDOG: Kontroluj každých 5s jestli fronta má běžet ale neběží
    const queueWatchdog = setInterval(() => {
      if (!this.isRunning) {
        clearInterval(queueWatchdog);
        return;
      }

      // Pokud jsou účty ve frontě ale žádný browser se neotevírá
      if (this.loginQueue.length > 0 && this.activeVisibleBrowsers < this.maxVisibleBrowsers) {
        console.log(`🔍 [WATCHDOG] Fronta má ${this.loginQueue.length} účtů, ale pouze ${this.activeVisibleBrowsers}/${this.maxVisibleBrowsers} browserů - spouštím frontu`);
        this.processLoginQueue().catch(err => {
          console.error('❌ [WATCHDOG] Chyba při zpracování fronty:', err);
        });
      }
    }, 5000);

    // Spusť všechny smyčky paralelně
    await Promise.all([
      this.checksLoop(),       // P1: Kontroly útoků
      this.buildingLoop(),     // P1: Výstavba
      this.unitsLoop(),        // P6: Kontrola jednotek
      this.scavengeLoop(),     // P2: ZAPNUTO - každých 30 min
      this.recruitLoop(),      // P3: ZAPNUTO
      // this.researchLoop(),     // P4: VYPNUTO - test přihlašování
      // this.paladinLoop(),      // P5: VYPNUTO - test přihlašování
      this.dailyRewardsLoop(), // P6: ZAPNUTO - 2x denně
      this.statsMonitor()      // Monitoring
    ]);

    // Zastaví watchdog když se aplikace vypne
    clearInterval(queueWatchdog);
  }

  /**
   * SMYČKA 1: Kontroly (útoky/CAPTCHA)
   * Běží po 10 účtech s 10s pauzami, celý cyklus každé 3 minuty
   * Priorita: 1 (nejvyšší)
   */
  async checksLoop() {
    console.log('🔄 [P1] Smyčka KONTROLY spuštěna');

    while (this.isRunning) {
      const cycleStartTime = Date.now();

      // Zkontroluj shutdown flag
      await this.checkShutdownFlag();

      const allAccounts = this.db.getAllActiveAccounts();

      // Filtruj účty s CAPTCHA - ty se zpracovávají pouze ve visible browseru
      const accounts = allAccounts.filter(account => !this.captchaDetected.has(account.id));

      if (accounts.length === 0) {
        await new Promise(resolve => setTimeout(resolve, 30000));
        continue;
      }

      // Zpracuj po 10 účtech
      for (let i = 0; i < accounts.length; i += 10) {
        const batch = accounts.slice(i, i + 10);

        // Zpracuj každý účet v dávce paralelně (přes WorkerPool)
        const results = await Promise.allSettled(
          batch.map(account =>
            this.workerPool.run(
              () => this.processChecks(account),
              this.priorities.checks,
              `Kontroly: ${account.username}`
            )
          )
        );

        // Loguj pouze chyby
        results.forEach((result, idx) => {
          if (result.status === 'rejected') {
            console.log(`⚠️  [${batch[idx].username}] Kontroly: ${result.reason?.message || result.reason}`);
          }
        });

        // Pauza mezi skupinami (10 sekund)
        if (i + 10 < accounts.length) {
          await new Promise(resolve => setTimeout(resolve, 10000));
        }
      }

      // Celý cyklus hotový, počkej 5 minut ± 1 minuta od začátku cyklu (randomizace)
      const cycleElapsed = Date.now() - cycleStartTime;
      const targetInterval = randomizeInterval(5 * 60 * 1000, 60 * 1000); // 5 min ± 1 min
      const waitTime = Math.max(0, targetInterval - cycleElapsed);

      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }

  /**
   * SMYČKA 2: Výstavba
   * Každých 5 sekund projde účty - COOLDOWN režim (kontroluje hned jak vyprší čas)
   * Zpracovává po 5 účtech paralelně
   * Priorita: 1
   */
  async buildingLoop() {
    console.log('🔄 [P2] Smyčka BUILD spuštěna');

    while (this.isRunning) {
      // Zkontroluj shutdown flag
      await this.checkShutdownFlag();

      const accounts = this.db.getAllActiveAccounts();

      // Filtruj pouze účty, které mají build enabled a vypršelý timer
      const accountsToProcess = accounts.filter(account => {
        // Skip účty s CAPTCHA
        if (this.captchaDetected.has(account.id)) {
          return false;
        }

        const buildingSettings = this.db.getBuildingSettings(account.id);
        if (!buildingSettings || !buildingSettings.enabled) {
          return false;
        }

        const buildingKey = `building_${account.id}`;
        const buildingWaitUntil = this.accountWaitTimes[buildingKey];
        return !buildingWaitUntil || Date.now() >= buildingWaitUntil;
      });

      if (accountsToProcess.length > 0) {
        // Zpracuj po 5 účtech paralelně
        for (let i = 0; i < accountsToProcess.length; i += 5) {
          const batch = accountsToProcess.slice(i, i + 5);

          const results = await Promise.allSettled(
            batch.map(account => {
              const buildingSettings = this.db.getBuildingSettings(account.id);
              return this.workerPool.run(
                () => this.processBuilding(account, buildingSettings),
                this.priorities.building,
                `Build: ${account.username}`
              );
            })
          );

          // Loguj pouze chyby
          results.forEach((result, idx) => {
            if (result.status === 'rejected') {
              console.log(`⚠️  [${batch[idx].username}] Build: ${result.reason?.message || result.reason}`);
            }
          });

          // Pauza mezi dávkami (1-3s)
          if (i + 5 < accountsToProcess.length) {
            const pause = 1000 + Math.random() * 2000;
            await new Promise(resolve => setTimeout(resolve, pause));
          }
        }
      }

      // Počkej 30s před další kontrolou (COOLDOWN režim) - s randomizací ±15s
      const interval = randomizeInterval(this.intervals.building, 15000);
      await new Promise(resolve => setTimeout(resolve, interval));
    }
  }

  /**
   * SMYČKA 2.5: Sběr (Scavenge)
   * Každou 1 minutu projde účty a zkontroluje per-account timing
   * Zpracovává po 5 účtech paralelně
   * Priorita: 2
   */
  async scavengeLoop() {
    console.log('🔄 [P2] Smyčka SBĚR spuštěna');

    while (this.isRunning) {
      // Zkontroluj shutdown flag
      await this.checkShutdownFlag();

      const accounts = this.db.getAllActiveAccounts();

      // Filtruj pouze účty, které mají scavenge enabled a vypršelý timer
      const accountsToProcess = accounts.filter(account => {
        // Skip účty s CAPTCHA
        if (this.captchaDetected.has(account.id)) {
          return false;
        }

        // Kontrola scavenge_enabled v účtu
        if (!account.scavenge_enabled) {
          return false;
        }

        // Kontrola zda má svět scavenge povolený
        const worldSettings = this.db.getWorldSettings(account.world);
        if (!worldSettings.scavengeEnabled) {
          return false;
        }

        const scavengeKey = `scavenge_${account.id}`;
        const scavengeWaitUntil = this.accountWaitTimes[scavengeKey];
        return !scavengeWaitUntil || Date.now() >= scavengeWaitUntil;
      });

      if (accountsToProcess.length > 0) {
        console.log(`🪙 SBĚR: Zpracovávám ${accountsToProcess.length} účtů`);
      }

      // Zpracuj po 5 účtech paralelně
      for (let i = 0; i < accountsToProcess.length; i += 5) {
        const batch = accountsToProcess.slice(i, i + 5);

        const results = await Promise.allSettled(
          batch.map(account => {
            return this.workerPool.run(
              () => this.processScavenge(account),
              this.priorities.scavenge,
              `Sběr: ${account.username}`
            );
          })
        );

        // Loguj pouze chyby
        results.forEach((result, idx) => {
          if (result.status === 'rejected') {
            console.log(`⚠️  [${batch[idx].username}] Sběr: ${result.reason?.message || result.reason}`);
          }
        });

        // Pauza mezi dávkami (1-3s)
        if (i + 5 < accountsToProcess.length) {
          await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));
        }
      }

      // Počkej 30 minut - s randomizací ±5 minut
      await new Promise(resolve => setTimeout(resolve, randomizeInterval(this.intervals.scavenge, 5 * 60 * 1000)));
    }
  }

  /**
   * SMYČKA 3: Rekrutování
   * Každou 1 hodinu projde všechny účty po skupinách 10ti
   * Priorita: 3
   */
  async recruitLoop() {
    console.log('🔄 [P3] Smyčka REKRUT spuštěna');

    while (this.isRunning) {
      const cycleStartTime = Date.now();

      // Zkontroluj shutdown flag
      await this.checkShutdownFlag();

      const allAccounts = this.db.getAllActiveAccounts();

      // Filtruj pouze účty, které mají recruit enabled
      const accountsToProcess = allAccounts.filter(account => {
        // Skip účty s CAPTCHA
        if (this.captchaDetected.has(account.id)) {
          return false;
        }

        const recruitSettings = this.db.getRecruitSettings(account.id);
        return recruitSettings && recruitSettings.enabled;
      });

      if (accountsToProcess.length === 0) {
        await new Promise(resolve => setTimeout(resolve, this.intervals.recruit));
        continue;
      }

      console.log(`🎯 REKRUT: Zpracovávám ${accountsToProcess.length} účtů`);

      // Zpracuj po 10 účtech paralelně
      for (let i = 0; i < accountsToProcess.length; i += 10) {
        const batch = accountsToProcess.slice(i, i + 10);

        const results = await Promise.allSettled(
          batch.map(account => {
            const recruitSettings = this.db.getRecruitSettings(account.id);
            return this.workerPool.run(
              () => this.processRecruit(account, recruitSettings),
              this.priorities.recruit,
              `Rekrut: ${account.username}`
            );
          })
        );

        // Loguj pouze chyby
        results.forEach((result, idx) => {
          if (result.status === 'rejected') {
            console.log(`⚠️  [${batch[idx].username}] Rekrut: ${result.reason?.message || result.reason}`);
          }
        });

        // Pauza mezi skupinami (10 sekund)
        if (i + 10 < accountsToProcess.length) {
          await new Promise(resolve => setTimeout(resolve, 10000));
        }
      }

      // Celý cyklus hotový, počkej 3 hodiny ± 15 min od začátku cyklu (randomizace)
      const cycleElapsed = Date.now() - cycleStartTime;
      const targetInterval = randomizeInterval(this.intervals.recruit, 15 * 60 * 1000); // 3h ± 15min
      const waitTime = Math.max(0, targetInterval - cycleElapsed);

      const waitMin = Math.floor(waitTime / 60000);
      console.log(`✅ REKRUT dokončen, další za ~${waitMin} minut`);

      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }

  /**
   * SMYČKA 4: Výzkum
   * Každé 2 hodiny projde účty a zkontroluje timing
   * Zpracovává po 5 účtech paralelně
   * Priorita: 4
   */
  async researchLoop() {
    console.log('🔄 [P4] Smyčka VÝZKUM spuštěna');

    while (this.isRunning) {
      // Zkontroluj shutdown flag
      await this.checkShutdownFlag();

      const accounts = this.db.getAllActiveAccounts();

      // Filtruj pouze účty, které mají research enabled a vypršelý timer
      const accountsToProcess = accounts.filter(account => {
        // Skip účty s CAPTCHA
        if (this.captchaDetected.has(account.id)) {
          return false;
        }

        const researchSettings = this.db.getResearchSettings(account.id);
        if (!researchSettings || !researchSettings.enabled) {
          return false;
        }

        const researchKey = `research_${account.id}`;
        const researchWaitUntil = this.accountWaitTimes[researchKey];
        return !researchWaitUntil || Date.now() >= researchWaitUntil;
      });

      if (accountsToProcess.length > 0) {
        console.log(`🔬 VÝZKUM: Zpracovávám ${accountsToProcess.length} účtů`);
      }

      // Zpracuj po 5 účtech paralelně
      for (let i = 0; i < accountsToProcess.length; i += 5) {
        const batch = accountsToProcess.slice(i, i + 5);

        const results = await Promise.allSettled(
          batch.map(account => {
            const researchSettings = this.db.getResearchSettings(account.id);
            return this.workerPool.run(
              () => this.processResearch(account, researchSettings),
              this.priorities.research,
              `Výzkum: ${account.username}`
            );
          })
        );

        // Loguj pouze chyby
        results.forEach((result, idx) => {
          if (result.status === 'rejected') {
            console.log(`⚠️  [${batch[idx].username}] Výzkum: ${result.reason?.message || result.reason}`);
          }
        });

        // Pauza mezi dávkami (2-5s)
        if (i + 5 < accountsToProcess.length) {
          await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 3000));
        }
      }

      // Počkej 6 hodin - s randomizací ±30 minut
      await new Promise(resolve => setTimeout(resolve, randomizeInterval(this.intervals.research, 30 * 60 * 1000)));
    }
  }

  /**
   * SMYČKA 5: Paladin
   * Každou 1 hodinu projde účty a zkontroluje per-account timing
   * Zpracovává po 5 účtech paralelně
   * Priorita: 5
   */
  async paladinLoop() {
    console.log('🔄 [P5] Smyčka PALADIN spuštěna');

    while (this.isRunning) {
      // Zkontroluj shutdown flag
      await this.checkShutdownFlag();

      const accounts = this.db.getAllActiveAccounts();

      // Filtruj pouze účty s vypršelým timerem
      const accountsToProcess = accounts.filter(account => {
        // Skip účty s CAPTCHA
        if (this.captchaDetected.has(account.id)) {
          return false;
        }

        const paladinKey = `paladin_${account.id}`;
        const paladinWaitUntil = this.accountWaitTimes[paladinKey];
        return !paladinWaitUntil || Date.now() >= paladinWaitUntil;
      });

      if (accountsToProcess.length > 0) {
        console.log(`⚔️  PALADIN: Zpracovávám ${accountsToProcess.length} účtů`);
      }

      // Zpracuj po 5 účtech paralelně
      for (let i = 0; i < accountsToProcess.length; i += 5) {
        const batch = accountsToProcess.slice(i, i + 5);

        const results = await Promise.allSettled(
          batch.map(account =>
            this.workerPool.run(
              () => this.processPaladin(account),
              this.priorities.paladin,
              `Paladin: ${account.username}`
            )
          )
        );

        // Loguj pouze chyby
        results.forEach((result, idx) => {
          if (result.status === 'rejected') {
            console.log(`⚠️  [${batch[idx].username}] Paladin: ${result.reason?.message || result.reason}`);
          }
        });

        // Pauza mezi dávkami (2-5s)
        if (i + 5 < accountsToProcess.length) {
          await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 3000));
        }
      }

      // Počkej 6 hodin - s randomizací ±30 minut
      await new Promise(resolve => setTimeout(resolve, randomizeInterval(this.intervals.paladin, 30 * 60 * 1000)));
    }
  }

  /**
   * SMYČKA 6: Kontrola jednotek
   * Každých 10 minut projde účty a zkontroluje jednotky (po 2 účtech)
   * Priorita: 6
   */
  async unitsLoop() {
    console.log('🔄 [P6] Smyčka JEDNOTKY spuštěna');

    while (this.isRunning) {
      // Zkontroluj shutdown flag
      await this.checkShutdownFlag();

      const allAccounts = this.db.getAllActiveAccounts();

      // Filtruj účty s CAPTCHA - ty se zpracovávají pouze ve visible browseru
      const accounts = allAccounts.filter(account => !this.captchaDetected.has(account.id));

      // Zpracuj po 2 účtech
      for (let i = 0; i < accounts.length; i += 2) {
        const batch = accounts.slice(i, i + 2);

        // Zpracuj každý účet v dávce paralelně (přes WorkerPool)
        const results = await Promise.allSettled(
          batch.map(account =>
            this.workerPool.run(
              () => this.processUnits(account),
              this.priorities.units,
              `Jednotky: ${account.username}`
            )
          )
        );

        // Loguj pouze chyby
        results.forEach((result, idx) => {
          if (result.status === 'rejected') {
            console.log(`⚠️  [${batch[idx].username}] Jednotky: ${result.reason?.message || result.reason}`);
          }
        });

        // Pauza mezi dávkami (1-3s)
        if (i + 2 < accounts.length) {
          const pause = 1000 + Math.random() * 2000;
          await new Promise(resolve => setTimeout(resolve, pause));
        }
      }

      // Počkej 1 hodinu - s randomizací ±10 minut
      const interval = randomizeInterval(this.intervals.units, 10 * 60 * 1000);
      await new Promise(resolve => setTimeout(resolve, interval));
    }
  }

  /**
   * SMYČKA 7: Denní odměny
   * Běží 2x denně: ve 4:00 a 16:00 + při prvním spuštění
   * Priorita: 6
   */
  async dailyRewardsLoop() {
    console.log('🔄 [P6] Smyčka DENNÍ ODMĚNY spuštěna');

    // Při startu zpracuj denní odměny pro všechny účty (pokud ještě nebyly dnes zpracovány)
    await this.processDailyRewardsForAllAccounts(true);

    while (this.isRunning) {
      // Zkontroluj shutdown flag
      await this.checkShutdownFlag();

      // Čekej až do dalšího času: 4:00 nebo 16:00
      const now = new Date();
      const currentHour = now.getHours();

      let nextRunTime = new Date();

      // Určit další čas spuštění
      if (currentHour < 4) {
        // Před 4:00 ráno - spustit dnes ve 4:00
        nextRunTime.setHours(4, 0, 0, 0);
      } else if (currentHour < 16) {
        // Mezi 4:00 a 16:00 - spustit dnes v 16:00
        nextRunTime.setHours(16, 0, 0, 0);
      } else {
        // Po 16:00 - spustit zítra ve 4:00
        nextRunTime.setDate(nextRunTime.getDate() + 1);
        nextRunTime.setHours(4, 0, 0, 0);
      }

      const timeUntilNext = nextRunTime.getTime() - now.getTime();
      const hoursUntil = Math.floor(timeUntilNext / 1000 / 60 / 60);
      const minutesUntil = Math.floor((timeUntilNext / 1000 / 60) % 60);
      console.log(`⏰ Denní odměny: další spuštění za ${hoursUntil}h ${minutesUntil}min (ve ${nextRunTime.toLocaleString('cs-CZ')})`);

      // Počkej do dalšího času
      await new Promise(resolve => setTimeout(resolve, timeUntilNext));

      // Zpracuj denní odměny pro všechny účty
      await this.processDailyRewardsForAllAccounts(false);
    }
  }

  /**
   * Zpracuj denní odměny pro všechny účty
   * @param {boolean} isStartup - true pokud je to první spuštění programu
   */
  async processDailyRewardsForAllAccounts(isStartup = false) {
    try {
      const accounts = this.db.getAllActiveAccounts();

      // Filtruj pouze účty, které mají denní odměny povoleny na jejich světě
      const accountsToProcess = accounts.filter(account => {
        // Skip účty s CAPTCHA
        if (this.captchaDetected.has(account.id)) {
          return false;
        }

        const worldSettings = this.db.getWorldSettings(account.world);
        if (!worldSettings || !worldSettings.dailyRewardsEnabled) {
          return false;
        }

        // Při startu zkontroluj, zda už nebyly dnes zpracovány
        if (isStartup) {
          const dailyRewardsKey = `dailyRewards_${account.id}`;
          const lastRun = this.accountWaitTimes[dailyRewardsKey];

          // Pokud bylo spuštěno dnes (méně než 12 hodin od poslední), přeskoč
          if (lastRun && (Date.now() - lastRun < 12 * 60 * 60 * 1000)) {
            return false;
          }
        }

        return true;
      });

      if (accountsToProcess.length === 0) {
        console.log('⏭️  Žádné účty s povolenými denními odměnami k zpracování');
        return;
      }

      console.log(`🎁 Zpracovávám denní odměny pro ${accountsToProcess.length} účtů...`);

      // Zpracuj po 2 účtech paralelně (jako unitsLoop)
      for (let i = 0; i < accountsToProcess.length; i += 2) {
        const batch = accountsToProcess.slice(i, i + 2);

        await Promise.all(
          batch.map(account =>
            this.workerPool.run(
              () => this.processDailyRewards(account),
              this.priorities.dailyRewards,
              `Denní odměny: ${account.username}`
            )
          )
        );

        // Malá pauza mezi dávkami (500ms)
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      console.log(`✅ Denní odměny zpracovány pro všechny účty`);
    } catch (error) {
      console.error('❌ Chyba při zpracování denních odměn:', error.message);
    }
  }

  /**
   * Monitoring - vypíše statistiky každých 5 minut + health check
   */
  async statsMonitor() {
    while (this.isRunning) {
      // Zkontroluj shutdown flag
      await this.checkShutdownFlag();

      await new Promise(resolve => setTimeout(resolve, 5 * 60 * 1000)); // 5 minut

      const poolStats = this.browserPool.getStats();
      const workerStats = this.workerPool.getStats();

      // 🆕 PERSISTENT MODE: Loguj persistent contexts (každý context = vlastní browser s userDataDir)
      if (workerStats.active > 0 || workerStats.queued > 0 || poolStats.contexts > 0) {
        console.log(`📊 Stats | Workers: ${workerStats.active}/${workerStats.total} | Queue: ${workerStats.queued} | Persistent: ${poolStats.contexts} contexts (userDataDir)`);
      }
    }
  }

  /**
   * Zpracuj kontroly (útoky/CAPTCHA)
   */
  async processChecks(account) {
    // 🆕 Skip pokud je visible browser otevřený (čeká na manuální přihlášení)
    if (this.isBrowserActive(account.id)) {
      return; // Tiše skipni - uživatel se přihlašuje
    }

    try {
      // 🆕 Získej persistent context (zůstává živý mezi tasky)
      const { page } = await this.browserPool.getContext(account.id);

      // Přihlásit se
      const loginSuccess = await this.loginToGame(page, account);
      if (!loginSuccess) {
        // 🆕 NEPOUŠTĚJ context - zůstane živý pro retry
        this.browserPool.releaseContext(account.id);
        // Zpracuj selhání přihlášení
        await this.handleFailedLogin(account);
        return;
      }

      // 🆕 ŽÁDNÉ saveCookies - browser si session pamatuje sám!

      // Sbírej statistiky s vlastním intervalem
      const infoKey = `accountInfo_${account.id}`;
      const infoWaitUntil = this.accountWaitTimes[infoKey];

      if (!infoWaitUntil || Date.now() >= infoWaitUntil) {
        const infoModule = new AccountInfoModule(page, this.db, account.id);
        await infoModule.collectInfo();
        this.accountWaitTimes[infoKey] = Date.now() + this.intervals.accountInfo;
      }

      // Kontrola útoků - LEHKÁ OPERACE (jen zjištění počtu)
      const notificationsModule = new NotificationsModule(page, this.db, account.id);
      const attacksDetected = await notificationsModule.detectAttacks();

      // OKAMŽITĚ ZASTAVIT pokud byla detekována captcha
      if (attacksDetected && attacksDetected.captchaDetected) {
        console.log(`⚠️  [${account.username}] CAPTCHA detekována - pausuji účet`);
        this.browserPool.releaseContext(account.id);
        await this.handleFailedLogin(account);
        return;
      }

      // Loguj pouze pokud byly detekovány útoky
      if (attacksDetected && attacksDetected.count > 0) {
        if (attacksDetected.isTrain) {
          console.log(`🚂 [${account.username}] ŠLECHTICKÝ VLAK! (${attacksDetected.count} útoků)`);
        } else {
          console.log(`⚔️  [${account.username}] Detekováno ${attacksDetected.count} příchozích útoků!`);
        }

        // CHECK: Jsou NOVÉ útoky k fetchování?
        if (attacksDetected.commandIds && attacksDetected.commandIds.length > 0) {
          const existingAttacks = attacksDetected.attacks || [];
          const existingCommandIds = new Set(existingAttacks.map(a => a.commandId));
          const newCommandIds = attacksDetected.commandIds.filter(item => !existingCommandIds.has(item.commandId));

          // TĚŽKÁ OPERACE: Fetchuj detaily POUZE pokud jsou NOVÉ útoky
          if (newCommandIds.length > 0) {
            console.log(`📥 [${account.username}] Fetchuji detaily ${newCommandIds.length} nových útoků...`);
            const fetchResult = await notificationsModule.fetchAttackDetails(attacksDetected.commandIds);

            // Pokud byla detekována captcha během fetchování
            if (fetchResult && fetchResult.captchaDetected) {
              console.log(`⚠️  [${account.username}] CAPTCHA detekována během fetchování - pausuji účet`);
              this.browserPool.releaseContext(account.id);
              await this.handleFailedLogin(account);
              return;
            }
          }
        }
      }

      // Kontrola dobytí vesnice
      const isConquered = await notificationsModule.detectConqueredVillage();

      if (isConquered) {
        console.log(`🚨 [${account.username}] VESNICE DOBYTA!`);

        // 🆕 Pušť context (zůstane živý)
        this.browserPool.releaseContext(account.id);

        // Označ účet jako dobytý v databázi
        this.db.updateAccountInfo(account.id, {
          village_conquered: true,
          village_conquered_at: new Date().toISOString()
        });

        // Otevři viditelný prohlížeč POUZE pokud už není otevřený nebo se neotvírá (DOBYTÁ VESNICE)
        if (!this.isBrowserActive(account.id) && !this.openingBrowsers.has(account.id)) {
          console.log(`🖥️  [${account.username}] Otevírám viditelný prohlížeč pro vytvoření nové vesnice`);

          // Označ že se browser otevírá
          this.openingBrowsers.add(account.id);

          try {
            const browserInfo = await this.browserManager.testConnection(account.id, false); // false = nezavře se auto

            if (browserInfo) {
              const { browser } = browserInfo;
              this.openBrowsers.set(account.id, browserInfo);

              // Sleduj zavření browseru
              browser.on('disconnected', () => {
                this.openBrowsers.delete(account.id);
                this.openingBrowsers.delete(account.id);
                console.log(`🔒 [${account.username}] Browser zavřen - vesnice vyřešena`);
              });
            }
          } catch (error) {
            console.error(`❌ [${account.username}] Chyba při otevírání browseru:`, error.message);
          } finally {
            // Vždy odstraň z openingBrowsers
            this.openingBrowsers.delete(account.id);
          }
        }
        return;
      }

      // 🆕 Pušť context zpět do poolu (zůstane živý)
      this.browserPool.releaseContext(account.id);

    } catch (error) {
      // 🆕 I při chybě context zůstává živý
      this.browserPool.releaseContext(account.id);
      throw error; // Re-throw pro správné logování v Promise.allSettled
    }
  }

  /**
   * Zpracuj výstavbu
   */
  async processBuilding(account, settings) {
    // 🆕 Skip pokud je visible browser otevřený (čeká na manuální přihlášení)
    if (this.isBrowserActive(account.id)) {
      return; // Tiše skipni - uživatel se přihlašuje
    }

    try {
      const { page } = await this.browserPool.getContext(account.id);

      const loginSuccess = await this.loginToGame(page, account);
      if (!loginSuccess) {
        this.browserPool.releaseContext(account.id);
        await this.handleFailedLogin(account);
        return;
      }

      const buildingModule = new BuildingModule(page, this.db, account.id);
      const buildResult = await buildingModule.startBuilding(settings.template);

      if (buildResult && buildResult.waitTime) {
        this.accountWaitTimes[`building_${account.id}`] = Date.now() + buildResult.waitTime;
        const waitMin = Math.ceil(buildResult.waitTime / 60000);

        // Loguj pouze pokud se skutečně stavělo (waitTime < 20 min znamená že se stavělo)
        if (buildResult.success && buildResult.waitTime < 20 * 60 * 1000) {
          console.log(`🏗️  [${account.username}] Stavba zadána, další kontrola za ${waitMin} min`);
        }
      } else {
        this.accountWaitTimes[`building_${account.id}`] = Date.now() + 10 * 60 * 1000; // 10 min fallback
      }

      this.browserPool.releaseContext(account.id);

    } catch (error) {
      this.browserPool.releaseContext(account.id);
      throw error; // Re-throw pro správné logování v Promise.allSettled
    }
  }

  /**
   * Zpracuj sběr (scavenge)
   */
  async processScavenge(account) {
    // 🆕 Skip pokud je visible browser otevřený (čeká na manuální přihlášení)
    if (this.isBrowserActive(account.id)) {
      return; // Tiše skipni - uživatel se přihlašuje
    }

    try {
      const { page } = await this.browserPool.getContext(account.id);

      const loginSuccess = await this.loginToGame(page, account);
      if (!loginSuccess) {
        this.browserPool.releaseContext(account.id);
        await this.handleFailedLogin(account);
        return;
      }

      const scavengeModule = new ScavengeModule(page, this.db, account.id);
      const scavengeResult = await scavengeModule.execute();

      if (scavengeResult && scavengeResult.waitTime) {
        this.accountWaitTimes[`scavenge_${account.id}`] = Date.now() + scavengeResult.waitTime;
        console.log(`⏰ [${account.username}] Sběr: Další za ${Math.ceil(scavengeResult.waitTime / 60000)} min`);
      } else {
        this.accountWaitTimes[`scavenge_${account.id}`] = Date.now() + this.intervals.scavenge;
      }

      this.browserPool.releaseContext(account.id);

    } catch (error) {
      console.error(`❌ [${account.username}] Chyba při sběru:`, error.message);
      this.browserPool.releaseContext(account.id);
    }
  }

  /**
   * Zpracuj rekrutování
   */
  async processRecruit(account, settings) {
    // 🆕 Skip pokud je visible browser otevřený (čeká na manuální přihlášení)
    if (this.isBrowserActive(account.id)) {
      return; // Tiše skipni - uživatel se přihlašuje
    }

    try {
      const { page } = await this.browserPool.getContext(account.id);

      const loginSuccess = await this.loginToGame(page, account);
      if (!loginSuccess) {
        this.browserPool.releaseContext(account.id);
        await this.handleFailedLogin(account);
        return;
      }

      const recruitModule = new RecruitModule(page, this.db, account.id);
      // collectUnitsInfo() již není potřeba - jednotky sbírá SupportModule v checksLoop()

      const recruitResult = await recruitModule.startRecruiting(settings.template);

      if (recruitResult && recruitResult.waitTime) {
        this.accountWaitTimes[`recruit_${account.id}`] = Date.now() + recruitResult.waitTime;
        console.log(`⏰ [${account.username}] Rekrut: Další za ${Math.ceil(recruitResult.waitTime / 60000)} min`);
      } else {
        this.accountWaitTimes[`recruit_${account.id}`] = Date.now() + this.intervals.recruit;
      }

      this.browserPool.releaseContext(account.id);

    } catch (error) {
      console.error(`❌ [${account.username}] Chyba při rekrutování:`, error.message);
      this.browserPool.releaseContext(account.id);
    }
  }

  /**
   * Zpracuj výzkum
   */
  async processResearch(account, settings) {
    // 🆕 Skip pokud je visible browser otevřený (čeká na manuální přihlášení)
    if (this.isBrowserActive(account.id)) {
      return; // Tiše skipni - uživatel se přihlašuje
    }

    try {
      const { page } = await this.browserPool.getContext(account.id);

      const loginSuccess = await this.loginToGame(page, account);
      if (!loginSuccess) {
        this.browserPool.releaseContext(account.id);
        await this.handleFailedLogin(account);
        return;
      }

      const researchModule = new ResearchModule(page, this.db, account.id);
      const researchResult = await researchModule.autoResearch();

      if (researchResult && researchResult.waitTime) {
        // Použij minimálně interval smyčky (120 min)
        const actualWaitTime = Math.max(researchResult.waitTime, this.intervals.research);
        this.accountWaitTimes[`research_${account.id}`] = Date.now() + actualWaitTime;
        console.log(`⏰ [${account.username}] Výzkum: Další za ${Math.ceil(actualWaitTime / 60000)} min`);
      } else {
        this.accountWaitTimes[`research_${account.id}`] = Date.now() + this.intervals.research;
      }

      this.browserPool.releaseContext(account.id);

    } catch (error) {
      console.error(`❌ [${account.username}] Chyba při výzkumu:`, error.message);
      this.browserPool.releaseContext(account.id);
    }
  }

  /**
   * Zpracuj kontrolu jednotek
   */
  async processUnits(account) {
    // 🆕 Skip pokud je visible browser otevřený (čeká na manuální přihlášení)
    if (this.isBrowserActive(account.id)) {
      return; // Tiše skipni - uživatel se přihlašuje
    }

    try {
      const { page } = await this.browserPool.getContext(account.id);

      const loginSuccess = await this.loginToGame(page, account);
      if (!loginSuccess) {
        console.log(`      ❌ [${account.username}] Přihlášení selhalo`);
        this.browserPool.releaseContext(account.id);
        await this.handleFailedLogin(account);
        return;
      }

      const supportModule = new SupportModule(page, this.db, account.id);
      await supportModule.getAllUnitsInfo();

      this.browserPool.releaseContext(account.id);

    } catch (error) {
      console.error(`      ❌ [${account.username}] Chyba při kontrole jednotek: ${error.message}`);
      this.browserPool.releaseContext(account.id);
      throw error; // Re-throw pro správné logování v Promise.allSettled
    }
  }

  /**
   * Zpracuj denní odměny
   */
  async processDailyRewards(account) {
    // 🆕 Skip pokud je visible browser otevřený (čeká na manuální přihlášení)
    if (this.isBrowserActive(account.id)) {
      return; // Tiše skipni - uživatel se přihlašuje
    }

    try {
      const { page } = await this.browserPool.getContext(account.id);

      const loginSuccess = await this.loginToGame(page, account);
      if (!loginSuccess) {
        this.browserPool.releaseContext(account.id);
        await this.handleFailedLogin(account);
        return;
      }

      const dailyRewardsModule = new DailyRewardsModule(page, this.db, account.id);
      const result = await dailyRewardsModule.execute();

      if (result && result.success) {
        console.log(`✅ [${account.username}] Denní odměny: ${result.message || 'Dokončeno'}`);
      }

      // Nastav wait time na další den (24 hodin)
      this.accountWaitTimes[`dailyRewards_${account.id}`] = Date.now();

      this.browserPool.releaseContext(account.id);

    } catch (error) {
      logger.error(`Chyba při výběru denních odměn: ${error.message}`, account.username);
      this.browserPool.releaseContext(account.id);
    }
  }

  /**
   * Zpracuj paladina
   */
  async processPaladin(account) {
    // 🆕 Skip pokud je visible browser otevřený (čeká na manuální přihlášení)
    if (this.isBrowserActive(account.id)) {
      return; // Tiše skipni - uživatel se přihlašuje
    }

    try {
      const { page } = await this.browserPool.getContext(account.id);

      const loginSuccess = await this.loginToGame(page, account);
      if (!loginSuccess) {
        this.browserPool.releaseContext(account.id);
        await this.handleFailedLogin(account);
        return;
      }

      const paladinModule = new PaladinModule(page, this.db, account.id);
      const paladinResult = await paladinModule.execute();

      if (paladinResult && paladinResult.waitTime) {
        // Použij minimálně interval smyčky (120 min)
        const actualWaitTime = Math.max(paladinResult.waitTime, this.intervals.paladin);
        this.accountWaitTimes[`paladin_${account.id}`] = Date.now() + actualWaitTime;
        console.log(`⏰ [${account.username}] Paladin: Další za ${Math.ceil(actualWaitTime / 60000)} min`);
      } else {
        this.accountWaitTimes[`paladin_${account.id}`] = Date.now() + this.intervals.paladin;
      }

      this.browserPool.releaseContext(account.id);

    } catch (error) {
      console.error(`❌ [${account.username}] Chyba při zpracování paladina:`, error.message);
      this.browserPool.releaseContext(account.id);
    }
  }

  /**
   * Přihlášení do hry
   */
  async loginToGame(page, account) {
    try {
      const domain = this.getWorldDomain(account.world);
      await page.goto(`https://${account.world}.${domain}/game.php`, {
        waitUntil: 'networkidle', // Čeká na kompletní načtení včetně network requestů
        timeout: 45000
      });

      // Počkej na stabilizaci stránky (2-4s random)
      const { humanDelay } = await import('./utils/randomize.js');
      await humanDelay(2000, 4000);

      // Zkontroluj, jestli není přesměrováno na create_village.php (dobytí vesnice)
      const currentUrl = page.url();
      if (currentUrl.includes('create_village.php')) {
        console.log('⚠️  Detekováno přesměrování na create_village.php - vesnice dobyta, ale uživatel je přihlášen');
        return true; // Technicky je přihlášen, jen má dobyto vesnici
      }

      // Robustnější detekce přihlášení
      const loginStatus = await page.evaluate(() => {
        // Detekce PŘIHLÁŠENÍ - hledej více elementů
        const loggedInIndicators = {
          menu_row: document.querySelector('#menu_row'),
          topContainer: document.querySelector('#topContainer'),
          villageName: document.querySelector('.village-name'),
          headerInfo: document.querySelector('#header_info'),
          quickbar: document.querySelector('.quickbar')
        };
        const hasLoggedInElement = Object.values(loggedInIndicators).some(el => el !== null);

        // Detekce NEPŘIHLÁŠENÍ - hledej login formulář
        const loginIndicators = {
          userInput: document.querySelector('input[name="user"]'),
          passwordInput: document.querySelector('input[name="password"]'),
          loginForm: document.querySelector('#login_form'),
          loginContainer: document.querySelector('.login-container')
        };
        const hasLoginForm = Object.values(loginIndicators).some(el => el !== null);

        return {
          isLoggedIn: hasLoggedInElement && !hasLoginForm,
          hasLoginForm: hasLoginForm,
          hasGameElements: hasLoggedInElement,
          // 🆕 DEBUG: Které elementy byly nalezeny
          foundLoggedInElements: Object.keys(loggedInIndicators).filter(k => loggedInIndicators[k] !== null),
          foundLoginElements: Object.keys(loginIndicators).filter(k => loginIndicators[k] !== null)
        };
      });

      // 🆕 DEBUG: Loguj detekční detaily pokud není jasné
      if (!loginStatus.isLoggedIn && !loginStatus.hasLoginForm) {
        console.log(`🔍 [${account.username}] Login detekce:`, JSON.stringify({
          hasGameElements: loginStatus.hasGameElements,
          hasLoginForm: loginStatus.hasLoginForm,
          foundLoggedIn: loginStatus.foundLoggedInElements,
          foundLogin: loginStatus.foundLoginElements
        }));
      }

      if (loginStatus.hasLoginForm) {
        return false;
      }

      if (!loginStatus.isLoggedIn) {
        // Anti-bot detection - zkontroluj captcha/ban
        try {
          const challenges = await detectAnyChallenge(page);
          const ban = await detectBan(page);

          if (challenges.cloudflare.detected) {
            console.log(`⚠️  [${account.username}] Cloudflare challenge`);
          }
          if (challenges.hcaptcha.detected) {
            console.log(`⚠️  [${account.username}] hCaptcha detekována`);
          }
          if (challenges.recaptcha.detected) {
            console.log(`⚠️  [${account.username}] reCaptcha detekována`);
          }
          if (ban.detected) {
            console.log(`🚫 [${account.username}] BAN detekován!${ban.ipBan ? ' (IP ban)' : ''}`);
          }
        } catch (detectionError) {
          // Ignore detection errors
        }

        return false;
      }

      // Zkontroluj CAPTCHA (in-game CAPTCHA kontrola)
      try {
        const NotificationsModule = (await import('./modules/notifications.js')).default;
        const notificationsModule = new NotificationsModule(page, this.db, account.id);
        const hasCaptcha = await notificationsModule.detectCaptcha();

        if (hasCaptcha) {
          return false; // CAPTCHA = failed login (vrátí se z loginToGame jako false)
        }
      } catch (captchaError) {
        // Ignore CAPTCHA check errors
      }

      return true;

    } catch (error) {
      console.error(`❌ [${account.username}] Chyba při přihlašování:`, error.message);
      return false;
    }
  }

  /**
   * Zastaví všechny smyčky (GRACEFUL SHUTDOWN)
   */
  async stop() {
    console.log('\n' + '='.repeat(70));
    console.log('🛑 GRACEFUL SHUTDOWN - Zastavuji automatizaci...');
    console.log('='.repeat(70));

    // 1. Zastaví smyčky (nebudou spouštět nové úlohy)
    console.log('\n📍 Krok 1/4: Zastavuji smyčky...');
    this.isRunning = false;
    console.log('✅ Smyčky zastaveny (nebudou spouštět nové úlohy)');

    // 2. Počkej na dokončení běžících úloh (max 30s)
    console.log('\n📍 Krok 2/4: Čekám na dokončení běžících úloh...');
    const completed = await this.workerPool.waitForCompletion(30000);

    if (!completed) {
      console.log('⚠️  Timeout! Některé úlohy nebyly dokončeny - force shutdown');
      const clearedCount = this.workerPool.clearQueue();
      console.log(`   Vymazáno ${clearedCount} čekajících úloh`);
    }

    // 3. Zavři všechny persistent contexts a browsery
    console.log('\n📍 Krok 3/4: Zavírám persistent contexts...');
    console.log('ℹ️  🆕 PERSISTENT MODE: Sessions žijí v browseru, ne v DB');
    try {
      await this.browserPool.closeAll();
    } catch (error) {
      console.error('❌ Chyba při zavírání browserů:', error.message);
    }

    // 4. Zavři všechny visible browsery
    console.log('\n📍 Krok 4/4: Zavírám visible browsery...');
    let closedVisible = 0;
    for (const [accountId, browserInfo] of this.openBrowsers.entries()) {
      try {
        if (browserInfo.browser && browserInfo.browser.isConnected()) {
          await browserInfo.browser.close();
          closedVisible++;
        }
      } catch (error) {
        console.error(`❌ Chyba při zavírání visible browseru pro účet ${accountId}:`, error.message);
      }
    }
    this.openBrowsers.clear();
    console.log(`✅ Zavřeno ${closedVisible} visible browserů`);

    console.log('\n' + '='.repeat(70));
    console.log('✅ GRACEFUL SHUTDOWN DOKONČEN');
    console.log('='.repeat(70) + '\n');
  }
}

// Spuštění
const automator = new Automator();

// Graceful shutdown s podporou pro dvakrát Ctrl+C = force quit
let shutdownInProgress = false;

async function handleShutdown(signal) {
  if (shutdownInProgress) {
    console.log('\n⚠️  Druhý signál detekován - FORCE QUIT!');
    console.log('💀 Ukončuji okamžitě bez cleanup...');
    process.exit(1);
  }

  shutdownInProgress = true;
  console.log(`\n⚠️  Přijat ${signal} - spouštím graceful shutdown...`);
  console.log('💡 TIP: Stiskněte Ctrl+C znovu pro okamžité ukončení (force quit)');

  try {
    await automator.stop();
    process.exit(0);
  } catch (error) {
    console.error('❌ Chyba při shutdown:', error);
    process.exit(1);
  }
}

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

automator.start().catch(error => {
  console.error('❌ Kritická chyba:', error);
  process.exit(1);
});

export default Automator;
