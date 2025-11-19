import 'dotenv/config';
import DatabaseManager from './database.js';
import BrowserManager from './browserManager.js';
import BrowserQueue from './browserQueue.js';
import SharedBrowserPool from './sharedBrowserPool.js';
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
    this.browserManager = new BrowserManager(this.db);
    this.browserQueue = new BrowserQueue(this.browserManager, 5); // Max 5 visible browserů najednou
    this.browserPool = new SharedBrowserPool(this.db);
    this.workerPool = new WorkerPool(100); // Max 100 procesů
    this.isRunning = false;
    this.accountWaitTimes = {}; // Per-account per-module timing
    this.openBrowserWindows = new Map(); // DEPRECATED - používá se browserQueue.activeBrowsers
    this.captchaDetected = new Set(); // Účty s detekovanou CAPTCHA (aby se nespamovalo)

    // Nastav callback pro zavření browseru - vyčisti captchaDetected
    this.browserQueue.setOnCloseCallback((accountId, reason) => {
      if (reason === 'captcha') {
        this.captchaDetected.delete(accountId);
        const account = this.db.getAccount(accountId);
        console.log(`✅ [${account?.username || accountId}] CAPTCHA vyřešena - odebrán z CAPTCHA tracku`);
      }
    });

    // Intervaly pro smyčky
    this.intervals = {
      checks: 0,        // Kontroly běží neustále (žádný wait)
      recruit: 2 * 60 * 1000,     // 2 minuty
      building: 5 * 1000,         // 5 sekund - COOLDOWN režim (kontroluje hned jak vyprší)
      research: 120 * 60 * 1000,  // 120 minut (2 hodiny)
      paladin: 60 * 60 * 1000,    // 60 minut (1 hodina) - ZMĚNĚNO z 2 hodin
      units: 10 * 60 * 1000,      // 10 minut (kontrola jednotek) - ZMĚNĚNO z 20 minut
      accountInfo: 20 * 60 * 1000, // 20 minut (sběr statistik)
      dailyRewards: 24 * 60 * 60 * 1000, // Nepoužívá se - denní odměny běží 2x denně (4:00 a 16:00)
      scavenge: 1 * 60 * 1000     // 1 minuta (sběr surovin) - ZMĚNĚNO z 5 minut (kvůli per-account timing)
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
   * Zkontroluje jestli je browser pro daný účet opravdu ještě otevřený a připojený
   * Používá browserQueue místo openBrowserWindows
   * @returns {boolean} true pokud je browser aktivní, false pokud ne
   */
  isBrowserActive(accountId) {
    return this.browserQueue.isBrowserActive(accountId);
  }

  /**
   * Zpracuj selhání přihlášení - smaž cookies a otevři browser
   */
  async handleFailedLogin(account) {
    // Zkontroluj jestli už není browser otevřený NEBO ve frontě
    const isActive = this.isBrowserActive(account.id);
    const isQueued = this.browserQueue.isInQueue(account.id);

    if (isActive) {
      console.log(`⏭️  [${account.username}] Viditelný prohlížeč už je otevřený - přeskakuji`);
      return;
    }

    if (isQueued) {
      console.log(`⏭️  [${account.username}] Browser už je ve frontě - přeskakuji`);
      return;
    }

    console.log(`❌ [${account.username}] Přihlášení selhalo - otevírám viditelný browser`);

    // Smaž neplatné cookies (pokud existují)
    const accountData = this.db.getAccount(account.id);
    if (accountData && accountData.cookies && accountData.cookies !== 'null') {
      console.log(`🗑️  [${account.username}] Mažu neplatné cookies`);
      this.db.updateCookies(account.id, null);
    }

    // Otevři viditelný prohlížeč pro manuální přihlášení - přidej do fronty
    console.log(`🖥️  Přidávám do fronty viditelný prohlížeč pro přihlášení: ${account.username}`);
    await this.browserQueue.enqueue(account.id, 'bad_cookies', false); // false = browser se NEZAVŘE automaticky
  }

  /**
   * Spustí všechny smyčky
   */
  async start() {
    console.log('='.repeat(70));
    console.log('🤖 Spouštím Event-Driven automatizaci');
    console.log('⚡ Worker Pool: Max 100 procesů');
    console.log('🔄 8 nezávislých smyček:');
    console.log('   [P1] Kontroly: neustále po 2 účtech (~10 min/cyklus pro 100 účtů)');
    console.log('   [P1] Build: každých 5s po 5 účtech - COOLDOWN režim (VYSOKÁ PRIORITA)');
    console.log('   [P2] Sběr: každou 1 min po 5 účtech (per-account timing)');
    console.log('   [P3] Rekrut: každé 2 min po 5 účtech (per-account timing)');
    console.log('   [P4] Výzkum: každých 120 min po 5 účtech (2 hod, per-account timing)');
    console.log('   [P5] Paladin: každých 60 min po 5 účtech (1 hod, per-account timing)');
    console.log('   [P6] Jednotky: každých 10 min po 2 účtech');
    console.log('   [P6] Denní odměny: 2x denně ve 4:00 a 16:00 + při startu');
    console.log('   [P7] Statistiky: každých 20 min');
    console.log('='.repeat(70));

    this.isRunning = true;

    // Spusť všechny smyčky paralelně
    await Promise.all([
      this.checksLoop(),       // P1: Neustále po 2 účtech
      this.buildingLoop(),     // P1: Každých 5s po 5 účtech (COOLDOWN režim)
      this.scavengeLoop(),     // P2: Každých 5 min po 5 účtech
      this.recruitLoop(),      // P3: Každé 2 min po 5 účtech
      this.researchLoop(),     // P4: Každých 120 min po 5 účtech
      this.paladinLoop(),      // P5: Každých 120 min po 5 účtech
      this.unitsLoop(),        // P6: Každých 20 min po 2 účtech
      this.dailyRewardsLoop(), // P6: Jednou denně ve 4:00 nebo při startu
      this.statsMonitor()      // Monitoring
    ]);
  }

  /**
   * SMYČKA 1: Kontroly (útoky/CAPTCHA)
   * Běží neustále dokola po 2 účtech
   * Priorita: 1 (nejvyšší)
   */
  async checksLoop() {
    console.log('🔄 [P1] Smyčka KONTROLY spuštěna');

    while (this.isRunning) {
      const accounts = this.db.getAllActiveAccounts();

      // Zpracuj po 2 účtech
      for (let i = 0; i < accounts.length; i += 2) {
        const batch = accounts.slice(i, i + 2);

        // Zpracuj každý účet v dávce paralelně (přes WorkerPool)
        await Promise.all(
          batch.map(account =>
            this.workerPool.run(
              () => this.processChecks(account),
              this.priorities.checks,
              `Kontroly: ${account.username}`
            )
          )
        );

        // Malá pauza mezi dávkami (100ms)
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Celý cyklus hotový, krátká pauza před dalším kolem
      await new Promise(resolve => setTimeout(resolve, 1000));
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
      const accounts = this.db.getAllActiveAccounts();

      // Filtruj pouze účty, které mají build enabled a vypršelý timer
      const accountsToProcess = accounts.filter(account => {
        const buildingSettings = this.db.getBuildingSettings(account.id);
        if (!buildingSettings || !buildingSettings.enabled) {
          return false;
        }

        const buildingKey = `building_${account.id}`;
        const buildingWaitUntil = this.accountWaitTimes[buildingKey];
        return !buildingWaitUntil || Date.now() >= buildingWaitUntil;
      });

      // Zpracuj po 5 účtech paralelně
      for (let i = 0; i < accountsToProcess.length; i += 5) {
        const batch = accountsToProcess.slice(i, i + 5);

        await Promise.all(
          batch.map(account => {
            const buildingSettings = this.db.getBuildingSettings(account.id);
            return this.workerPool.run(
              () => this.processBuilding(account, buildingSettings),
              this.priorities.building,
              `Build: ${account.username}`
            );
          })
        );

        // Malá pauza mezi dávkami (50ms)
        if (i + 5 < accountsToProcess.length) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }

      // Počkej 5 sekund před další kontrolou (COOLDOWN režim)
      await new Promise(resolve => setTimeout(resolve, this.intervals.building));
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
      const accounts = this.db.getAllActiveAccounts();

      // Filtruj pouze účty, které mají scavenge enabled a vypršelý timer
      const accountsToProcess = accounts.filter(account => {
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

      // Zpracuj po 5 účtech paralelně
      for (let i = 0; i < accountsToProcess.length; i += 5) {
        const batch = accountsToProcess.slice(i, i + 5);

        await Promise.all(
          batch.map(account => {
            return this.workerPool.run(
              () => this.processScavenge(account),
              this.priorities.scavenge,
              `Sběr: ${account.username}`
            );
          })
        );

        // Malá pauza mezi dávkami (50ms)
        if (i + 5 < accountsToProcess.length) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }

      // Počkej 1 minutu
      await new Promise(resolve => setTimeout(resolve, this.intervals.scavenge));
    }
  }

  /**
   * SMYČKA 3: Rekrutování
   * Každé 2 minuty projde účty a zkontroluje timing
   * Zpracovává po 5 účtech paralelně
   * Priorita: 3
   */
  async recruitLoop() {
    console.log('🔄 [P3] Smyčka REKRUT spuštěna');

    while (this.isRunning) {
      const accounts = this.db.getAllActiveAccounts();

      // Filtruj pouze účty, které mají recruit enabled a vypršelý timer
      const accountsToProcess = accounts.filter(account => {
        const recruitSettings = this.db.getRecruitSettings(account.id);
        if (!recruitSettings || !recruitSettings.enabled) {
          return false;
        }

        const recruitKey = `recruit_${account.id}`;
        const recruitWaitUntil = this.accountWaitTimes[recruitKey];
        return !recruitWaitUntil || Date.now() >= recruitWaitUntil;
      });

      // Zpracuj po 5 účtech paralelně
      for (let i = 0; i < accountsToProcess.length; i += 5) {
        const batch = accountsToProcess.slice(i, i + 5);

        await Promise.all(
          batch.map(account => {
            const recruitSettings = this.db.getRecruitSettings(account.id);
            return this.workerPool.run(
              () => this.processRecruit(account, recruitSettings),
              this.priorities.recruit,
              `Rekrut: ${account.username}`
            );
          })
        );

        // Malá pauza mezi dávkami (50ms)
        if (i + 5 < accountsToProcess.length) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }

      // Počkej 2 minuty
      await new Promise(resolve => setTimeout(resolve, this.intervals.recruit));
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
      const accounts = this.db.getAllActiveAccounts();

      // Filtruj pouze účty, které mají research enabled a vypršelý timer
      const accountsToProcess = accounts.filter(account => {
        const researchSettings = this.db.getResearchSettings(account.id);
        if (!researchSettings || !researchSettings.enabled) {
          return false;
        }

        const researchKey = `research_${account.id}`;
        const researchWaitUntil = this.accountWaitTimes[researchKey];
        return !researchWaitUntil || Date.now() >= researchWaitUntil;
      });

      // Zpracuj po 5 účtech paralelně
      for (let i = 0; i < accountsToProcess.length; i += 5) {
        const batch = accountsToProcess.slice(i, i + 5);

        await Promise.all(
          batch.map(account => {
            const researchSettings = this.db.getResearchSettings(account.id);
            return this.workerPool.run(
              () => this.processResearch(account, researchSettings),
              this.priorities.research,
              `Výzkum: ${account.username}`
            );
          })
        );

        // Malá pauza mezi dávkami (50ms)
        if (i + 5 < accountsToProcess.length) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }

      // Počkej 2 hodiny
      await new Promise(resolve => setTimeout(resolve, this.intervals.research));
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
      const accounts = this.db.getAllActiveAccounts();

      // Filtruj pouze účty s vypršelým timerem
      const accountsToProcess = accounts.filter(account => {
        const paladinKey = `paladin_${account.id}`;
        const paladinWaitUntil = this.accountWaitTimes[paladinKey];
        return !paladinWaitUntil || Date.now() >= paladinWaitUntil;
      });

      // Zpracuj po 5 účtech paralelně
      for (let i = 0; i < accountsToProcess.length; i += 5) {
        const batch = accountsToProcess.slice(i, i + 5);

        await Promise.all(
          batch.map(account =>
            this.workerPool.run(
              () => this.processPaladin(account),
              this.priorities.paladin,
              `Paladin: ${account.username}`
            )
          )
        );

        // Malá pauza mezi dávkami (50ms)
        if (i + 5 < accountsToProcess.length) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }

      // Počkej 1 hodinu
      await new Promise(resolve => setTimeout(resolve, this.intervals.paladin));
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
      const accounts = this.db.getAllActiveAccounts();

      // Zpracuj po 2 účtech
      for (let i = 0; i < accounts.length; i += 2) {
        const batch = accounts.slice(i, i + 2);

        // Zpracuj každý účet v dávce paralelně (přes WorkerPool)
        await Promise.all(
          batch.map(account =>
            this.workerPool.run(
              () => this.processUnits(account),
              this.priorities.units,
              `Jednotky: ${account.username}`
            )
          )
        );

        // Malá pauza mezi dávkami (100ms)
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Počkej 10 minut
      await new Promise(resolve => setTimeout(resolve, this.intervals.units));
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
   * Monitoring - vypíše statistiky každých 30 sekund
   */
  async statsMonitor() {
    while (this.isRunning) {
      await new Promise(resolve => setTimeout(resolve, 30000)); // 30 sekund
      this.workerPool.logStats();

      const browserStats = this.browserPool.getStats();
      console.log(`🌐 Browsers: ${browserStats.browsers} | Contexts: ${browserStats.contexts}`);
    }
  }

  /**
   * Zpracuj kontroly (útoky/CAPTCHA)
   */
  async processChecks(account) {
    let browser, context, browserKey;

    try {
      // Vytvoř context (sdílený browser)
      ({ browser, context, browserKey } = await this.browserPool.createContext(account.id));
      const page = await context.newPage();

      // Přihlásit se
      const loginSuccess = await this.loginToGame(page, account);
      if (!loginSuccess) {
        // Zavři headless browser
        await this.browserPool.closeContext(context, browserKey);
        // Zpracuj selhání přihlášení
        await this.handleFailedLogin(account);
        return;
      }

      // Sbírej statistiky s vlastním intervalem
      const infoKey = `accountInfo_${account.id}`;
      const infoWaitUntil = this.accountWaitTimes[infoKey];

      if (!infoWaitUntil || Date.now() >= infoWaitUntil) {
        const infoModule = new AccountInfoModule(page, this.db, account.id);
        await infoModule.collectInfo();
        this.accountWaitTimes[infoKey] = Date.now() + this.intervals.accountInfo;
      }

      // Kontrola útoků a CAPTCHA (VŽDY) - VOLAT NEJDŘÍV pro aktualizaci incoming_attacks
      const notificationsModule = new NotificationsModule(page, this.db, account.id);
      await notificationsModule.detectAttacks();

      const hasCaptcha = await notificationsModule.detectCaptcha();
      const isConquered = await notificationsModule.detectConqueredVillage();

      if (hasCaptcha) {
        // Zavři headless browser
        await this.browserPool.closeContext(context, browserKey);

        // Loguj pouze pokud ještě není zaznamenaná CAPTCHA pro tento účet
        const isNewCaptcha = !this.captchaDetected.has(account.id);

        if (isNewCaptcha) {
          console.log(`⚠️  [${account.username}] CAPTCHA detekována!`);
          this.captchaDetected.add(account.id);
        }

        // Otevři viditelný prohlížeč POUZE pokud už není otevřený (CAPTCHA) - přidej do fronty
        if (!this.isBrowserActive(account.id)) {
          if (isNewCaptcha) {
            console.log(`🖥️  Přidávám do fronty viditelný prohlížeč pro vyřešení CAPTCHA`);
          }
          await this.browserQueue.enqueue(account.id, 'captcha', false);
        }
        return;
      }

      if (isConquered) {
        console.log(`⚠️  [${account.username}] VESNICE DOBYTA!`);

        // Zavři headless browser
        await this.browserPool.closeContext(context, browserKey);

        // Označ účet jako dobytý v databázi
        this.db.updateAccountInfo(account.id, {
          village_conquered: true,
          village_conquered_at: new Date().toISOString()
        });

        // Otevři viditelný prohlížeč POUZE pokud už není otevřený (DOBYTÁ VESNICE) - přidej do fronty
        if (!this.isBrowserActive(account.id)) {
          console.log(`🖥️  Přidávám do fronty viditelný prohlížeč pro vytvoření nové vesnice`);
          await this.browserQueue.enqueue(account.id, 'conquered', false);
        } else {
          console.log(`⏭️  Viditelný prohlížeč už je otevřený - přeskakuji`);
        }
        return;
      }

      // Zavři context (browser zůstane běžet)
      await this.browserPool.closeContext(context, browserKey);

      // Pokud byl browser otevřený, byl vyřešen CAPTCHA/login (browser se zavře automaticky pomocí startLoginWatcher)
      if (this.isBrowserActive(account.id)) {
        console.log(`✅ [${account.username}] Browser stále aktivní - CAPTCHA/login se řeší`);
      }

    } catch (error) {
      console.error(`❌ [${account.username}] Chyba při kontrole:`, error.message);
      if (context && browserKey) {
        await this.browserPool.closeContext(context, browserKey);
      }
    }
  }

  /**
   * Zpracuj výstavbu
   */
  async processBuilding(account, settings) {
    let context, browserKey;

    try {
      ({ context, browserKey } = await this.browserPool.createContext(account.id));
      const page = await context.newPage();

      const loginSuccess = await this.loginToGame(page, account);
      if (!loginSuccess) {
        await this.browserPool.closeContext(context, browserKey);
        await this.handleFailedLogin(account);
        return;
      }

      const buildingModule = new BuildingModule(page, this.db, account.id);
      const buildResult = await buildingModule.startBuilding(settings.template);

      if (buildResult && buildResult.waitTime) {
        this.accountWaitTimes[`building_${account.id}`] = Date.now() + buildResult.waitTime;
        console.log(`⏰ [${account.username}] Build: Další za ${Math.ceil(buildResult.waitTime / 60000)} min`);
      } else {
        this.accountWaitTimes[`building_${account.id}`] = Date.now() + 1 * 60 * 1000; // 1 min fallback
      }

      await this.browserPool.closeContext(context, browserKey);

    } catch (error) {
      console.error(`❌ [${account.username}] Chyba při buildění:`, error.message);
      if (context && browserKey) await this.browserPool.closeContext(context, browserKey);
    }
  }

  /**
   * Zpracuj sběr (scavenge)
   */
  async processScavenge(account) {
    let context, browserKey;

    try {
      ({ context, browserKey } = await this.browserPool.createContext(account.id));
      const page = await context.newPage();

      const loginSuccess = await this.loginToGame(page, account);
      if (!loginSuccess) {
        await this.browserPool.closeContext(context, browserKey);
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

      await this.browserPool.closeContext(context, browserKey);

    } catch (error) {
      console.error(`❌ [${account.username}] Chyba při sběru:`, error.message);
      if (context && browserKey) await this.browserPool.closeContext(context, browserKey);
    }
  }

  /**
   * Zpracuj rekrutování
   */
  async processRecruit(account, settings) {
    let context, browserKey;

    try {
      ({ context, browserKey } = await this.browserPool.createContext(account.id));
      const page = await context.newPage();

      const loginSuccess = await this.loginToGame(page, account);
      if (!loginSuccess) {
        await this.browserPool.closeContext(context, browserKey);
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

      await this.browserPool.closeContext(context, browserKey);

    } catch (error) {
      console.error(`❌ [${account.username}] Chyba při rekrutování:`, error.message);
      if (context && browserKey) await this.browserPool.closeContext(context, browserKey);
    }
  }

  /**
   * Zpracuj výzkum
   */
  async processResearch(account, settings) {
    let context, browserKey;

    try {
      ({ context, browserKey } = await this.browserPool.createContext(account.id));
      const page = await context.newPage();

      const loginSuccess = await this.loginToGame(page, account);
      if (!loginSuccess) {
        await this.browserPool.closeContext(context, browserKey);
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

      await this.browserPool.closeContext(context, browserKey);

    } catch (error) {
      console.error(`❌ [${account.username}] Chyba při výzkumu:`, error.message);
      if (context && browserKey) await this.browserPool.closeContext(context, browserKey);
    }
  }

  /**
   * Zpracuj kontrolu jednotek
   */
  async processUnits(account) {
    let context, browserKey;

    try {
      ({ context, browserKey } = await this.browserPool.createContext(account.id));
      const page = await context.newPage();

      const loginSuccess = await this.loginToGame(page, account);
      if (!loginSuccess) {
        await this.browserPool.closeContext(context, browserKey);
        await this.handleFailedLogin(account);
        return;
      }

      const supportModule = new SupportModule(page, this.db, account.id);
      await supportModule.getAllUnitsInfo();

      await this.browserPool.closeContext(context, browserKey);

    } catch (error) {
      logger.error(`Chyba při kontrole jednotek: ${error.message}`, account.username);
      if (context && browserKey) await this.browserPool.closeContext(context, browserKey);
    }
  }

  /**
   * Zpracuj denní odměny
   */
  async processDailyRewards(account) {
    let context, browserKey;

    try {
      ({ context, browserKey } = await this.browserPool.createContext(account.id));
      const page = await context.newPage();

      const loginSuccess = await this.loginToGame(page, account);
      if (!loginSuccess) {
        await this.browserPool.closeContext(context, browserKey);
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

      await this.browserPool.closeContext(context, browserKey);

    } catch (error) {
      logger.error(`Chyba při výběru denních odměn: ${error.message}`, account.username);
      if (context && browserKey) await this.browserPool.closeContext(context, browserKey);
    }
  }

  /**
   * Zpracuj paladina
   */
  async processPaladin(account) {
    let context, browserKey;

    try {
      ({ context, browserKey } = await this.browserPool.createContext(account.id));
      const page = await context.newPage();

      const loginSuccess = await this.loginToGame(page, account);
      if (!loginSuccess) {
        await this.browserPool.closeContext(context, browserKey);
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

      await this.browserPool.closeContext(context, browserKey);

    } catch (error) {
      console.error(`❌ [${account.username}] Chyba při zpracování paladina:`, error.message);
      if (context && browserKey) await this.browserPool.closeContext(context, browserKey);
    }
  }

  /**
   * Přihlášení do hry
   */
  async loginToGame(page, account) {
    try {
      const domain = this.getWorldDomain(account.world);
      await page.goto(`https://${account.world}.${domain}/game.php`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      // Počkej delší dobu na načtení stránky
      await page.waitForTimeout(3000);

      // Zkontroluj, jestli není přesměrováno na create_village.php (dobytí vesnice)
      const currentUrl = page.url();
      if (currentUrl.includes('create_village.php')) {
        console.log('⚠️  Detekováno přesměrování na create_village.php - vesnice dobyta, ale uživatel je přihlášen');
        return true; // Technicky je přihlášen, jen má dobyto vesnici
      }

      // Robustnější detekce přihlášení
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
          document.querySelector('input[name="password"]'),  // Password input
          document.querySelector('#login_form'),             // Login formulář
          document.querySelector('.login-container')         // Login kontejner
        ];
        const hasLoginForm = loginIndicators.some(el => el !== null);

        return {
          isLoggedIn: hasLoggedInElement && !hasLoginForm,
          hasLoginForm: hasLoginForm,
          hasGameElements: hasLoggedInElement
        };
      });

      if (loginStatus.hasLoginForm) {
        console.log(`🔒 [${account.username}] Detekován přihlašovací formulář - cookies neplatné nebo vypršené`);
        return false;
      }

      if (!loginStatus.isLoggedIn) {
        console.log(`❌ [${account.username}] Přihlášení se nezdařilo - nenalezeny herní elementy`);
        return false;
      }

      console.log(`✅ [${account.username}] Úspěšně přihlášen`);
      return true;

    } catch (error) {
      console.error(`❌ [${account.username}] Chyba při přihlašování:`, error.message);
      return false;
    }
  }

  /**
   * Zastaví všechny smyčky
   */
  async stop() {
    console.log('🛑 Zastavuji automatizaci...');
    this.isRunning = false;
    await this.browserPool.closeAll();
    console.log('✅ Automatizace zastavena');
  }
}

// Spuštění
const automator = new Automator();

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n⚠️  Přijat SIGINT - zavírám...');
  await automator.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n⚠️  Přijat SIGTERM - zavírám...');
  await automator.stop();
  process.exit(0);
});

automator.start().catch(error => {
  console.error('❌ Kritická chyba:', error);
  process.exit(1);
});

export default Automator;
