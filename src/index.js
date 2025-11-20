import 'dotenv/config';
import { existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import DatabaseManager from './database.js';
import BrowserManager from './browserManager.js';
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
// import BalancModule from './modules/balanc.js'; // VYPNUTO - způsobovalo bany
import logger from './logger.js';
import { randomizeInterval } from './utils/randomize.js';
import { detectAnyChallenge, detectBan } from './utils/antiBot.js';

/**
 * 🚀 Event-Driven Automator s nezávislými smyčkami
 *
 * Architektura:
 * - Globální WorkerPool (max 100 procesů)
 * - 7 nezávislých smyček (optimalizováno pro minimalizaci CAPTCHA):
 *   1. Kontroly (CAPTCHA/útoky/jednotky) - po 20 účtech, každá skupina každé 3 min [P1]
 *      └─ Sloučené: captcha + útoky + kontrola jednotek (dříve samostatné unitsLoop)
 *   2. Build - každých 5s po 5 účtech (COOLDOWN režim, per-account timing) [P1]
 *   3. Sběr - každých 10 min po 5 účtech (per-account timing) [P2]
 *   4. Rekrut - každé 2 min po 5 účtech (per-account timing) [P3]
 *   5. Výzkum - každých 120 min po 5 účtech (per-account timing, s DB cache) [P4]
 *   6. Paladin - každé 3 hod po 5 účtech (per-account timing) [P5]
 *   7. Denní odměny - 2x denně ve 4:00 a 16:00 + při startu [P6]
 *
 * Optimalizace:
 * - Randomizace ±20% všech intervalů (místo ±10s)
 * - Skupinová kontrola po 20 účtech s 3min intervalem mezi skupinami
 * - Research cache - ukládá do DB když je vše vyzkoumáno
 */
class Automator {
  constructor() {
    this.db = new DatabaseManager();
    this.browserManager = new BrowserManager(this.db);
    this.browserPool = new SharedBrowserPool(this.db);
    this.workerPool = new WorkerPool(100); // Max 100 procesů
    this.isRunning = false;
    this.accountWaitTimes = {}; // Per-account per-module timing
    this.captchaDetected = new Set(); // Účty s detekovanou CAPTCHA (aby se nespamovalo)
    this.openBrowsers = new Map(); // Tracking otevřených visible browserů (accountId => browser)
    this.openingBrowsers = new Set(); // Tracking účtů pro které se právě otevírá browser (race condition protection)
    this.checksGroupTimings = {}; // Sledování časů pro skupiny v checksLoop (groupIndex => lastRunTime)

    // Intervaly pro smyčky
    this.intervals = {
      checks: 3 * 60 * 1000,      // 3 minuty - minimální mezera mezi kontrolami stejné skupiny
      checksGroupDelay: 10 * 1000, // 10 sekund mezi zpracováním skupin
      recruit: 2 * 60 * 1000,     // 2 minuty
      building: 5 * 1000,         // 5 sekund - COOLDOWN režim (kontroluje hned jak vyprší)
      research: 120 * 60 * 1000,  // 120 minut (2 hodiny)
      paladin: 3 * 60 * 60 * 1000, // 3 hodiny (180 minut)
      accountInfo: 20 * 60 * 1000, // 20 minut (sběr statistik)
      dailyRewards: 24 * 60 * 60 * 1000, // Nepoužívá se - denní odměny běží 2x denně (4:00 a 16:00)
      scavenge: 10 * 60 * 1000,   // 10 minut
      // balance: 120 * 60 * 1000    // VYPNUTO - způsobovalo bany
    };

    // Priority (nižší = vyšší priorita)
    this.priorities = {
      checks: 1,        // Útoky/CAPTCHA/Jednotky
      building: 1,      // Výstavba - STEJNÁ PRIORITA jako kontroly
      scavenge: 2,      // Sběr - vyšší priorita než rekrut
      recruit: 3,       // Rekrutování
      research: 4,      // Výzkum
      paladin: 5,       // Paladin
      dailyRewards: 6,  // Denní odměny
      stats: 7,         // Statistiky
      // balance: 7        // VYPNUTO - způsobovalo bany
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
   * Zpracuj selhání přihlášení - smaž cookies a otevři browser
   */
  async handleFailedLogin(account) {
    // Zkontroluj jestli už není browser otevřený nebo se právě otevírá
    if (this.isBrowserActive(account.id)) {
      console.log(`⏭️  [${account.username}] Viditelný prohlížeč už je otevřený - přeskakuji`);
      return;
    }

    if (this.openingBrowsers.has(account.id)) {
      console.log(`⏭️  [${account.username}] Viditelný prohlížeč se právě otevírá - přeskakuji`);
      return;
    }

    console.log(`❌ [${account.username}] Přihlášení selhalo - otevírám viditelný browser`);

    // Označ že se browser otevírá (race condition protection)
    this.openingBrowsers.add(account.id);

    try {
      // Smaž neplatné cookies (pokud existují)
      const accountData = this.db.getAccount(account.id);
      if (accountData && accountData.cookies && accountData.cookies !== 'null') {
        console.log(`🗑️  [${account.username}] Mažu neplatné cookies`);
        this.db.updateCookies(account.id, null);
      }

      // Otevři viditelný prohlížeč přímo
      console.log(`🖥️  Otevírám viditelný prohlížeč pro přihlášení: ${account.username}`);

      const browserInfo = await this.browserManager.testConnection(account.id, true); // true = auto-close po přihlášení

      if (browserInfo) {
        const { browser } = browserInfo;
        this.openBrowsers.set(account.id, browserInfo);

        // Sleduj zavření browseru
        browser.on('disconnected', () => {
          this.openBrowsers.delete(account.id);
          this.openingBrowsers.delete(account.id);
          this.captchaDetected.delete(account.id);
          console.log(`🔒 [${account.username}] Browser zavřen`);
        });
      }
    } catch (error) {
      console.error(`❌ [${account.username}] Chyba při otevírání browseru:`, error.message);
    } finally {
      // Vždy odstraň z openingBrowsers (i při chybě)
      this.openingBrowsers.delete(account.id);
    }
  }

  /**
   * Spustí všechny smyčky
   */
  async start() {
    console.log('='.repeat(70));
    console.log('🤖 Spouštím Event-Driven automatizaci');
    console.log('⚡ Worker Pool: Max 100 procesů');
    console.log('🔄 7 nezávislých smyček:');
    console.log('   [P1] Kontroly: po 20 účtech, každá skupina každé 3 min (s randomizací)');
    console.log('        └─ Kontroluje: CAPTCHA + útoky + jednotky');
    console.log('   [P1] Build: každých 5s po 5 účtech - COOLDOWN režim');
    console.log('   [P2] Sběr: každých 10 min po 5 účtech (per-account timing)');
    console.log('   [P3] Rekrut: každé 2 min po 5 účtech (per-account timing)');
    console.log('   [P4] Výzkum: každých 120 min po 5 účtech (2 hod, per-account timing)');
    console.log('   [P5] Paladin: každé 3 hod po 5 účtech (per-account timing)');
    console.log('   [P6] Denní odměny: 2x denně ve 4:00 a 16:00 + při startu');
    console.log('='.repeat(70));

    this.isRunning = true;

    // Spusť všechny smyčky paralelně
    await Promise.all([
      this.checksLoop(),       // P1: Po 20 účtech, každá skupina každé 3 min
      this.buildingLoop(),     // P1: Každých 5s po 5 účtech (COOLDOWN režim)
      this.scavengeLoop(),     // P2: Každých 10 min po 5 účtech
      this.recruitLoop(),      // P3: Každé 2 min po 5 účtech
      this.researchLoop(),     // P4: Každých 120 min po 5 účtech
      this.paladinLoop(),      // P5: Každé 3 hod po 5 účtech
      this.dailyRewardsLoop(), // P6: 2x denně ve 4:00 a 16:00 + při startu
      // this.balanceLoop(),      // VYPNUTO - způsobovalo bany
      this.statsMonitor()      // Monitoring
    ]);
  }

  /**
   * SMYČKA 1: Kontroly (útoky/CAPTCHA/jednotky)
   * Běží po 20 účtech v každé skupině
   * Každá skupina se kontroluje každé 3 minuty (s randomizací)
   * Mezi skupinami: 10 sekund
   * Priorita: 1 (nejvyšší)
   */
  async checksLoop() {
    console.log('🔄 [P1] Smyčka KONTROLY spuštěna');

    const GROUP_SIZE = 20;

    while (this.isRunning) {
      // Zkontroluj shutdown flag
      await this.checkShutdownFlag();

      const accounts = this.db.getAllActiveAccounts();
      const numGroups = Math.ceil(accounts.length / GROUP_SIZE);

      // Zpracuj všechny skupiny
      for (let groupIndex = 0; groupIndex < numGroups; groupIndex++) {
        // Zkontroluj jestli už může tato skupina běžet (minimálně 3 min od posledního běhu)
        const groupKey = `group_${groupIndex}`;
        const lastRunTime = this.checksGroupTimings[groupKey] || 0;
        const timeSinceLastRun = Date.now() - lastRunTime;
        const minInterval = randomizeInterval(this.intervals.checks); // 3 min ±20%

        if (timeSinceLastRun < minInterval) {
          // Skupina ještě nemůže běžet, přeskoč
          continue;
        }

        // Označ čas spuštění této skupiny
        this.checksGroupTimings[groupKey] = Date.now();

        // Vytvoř skupinu účtů
        const groupStart = groupIndex * GROUP_SIZE;
        const groupEnd = Math.min(groupStart + GROUP_SIZE, accounts.length);
        const group = accounts.slice(groupStart, groupEnd);

        console.log(`🔄 [Kontroly] Zpracovávám skupinu ${groupIndex + 1}/${numGroups} (${group.length} účtů)`);

        // Zpracuj všechny účty ve skupině paralelně
        await Promise.all(
          group.map(account =>
            this.workerPool.run(
              () => this.processChecks(account),
              this.priorities.checks,
              `Kontroly: ${account.username}`
            )
          )
        );

        // Pauza mezi skupinami (10 sekund s randomizací)
        if (groupIndex < numGroups - 1) {
          await new Promise(resolve =>
            setTimeout(resolve, randomizeInterval(this.intervals.checksGroupDelay))
          );
        }
      }

      // Krátká pauza před dalším kolem všech skupin (1 sekunda)
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
      // Zkontroluj shutdown flag
      await this.checkShutdownFlag();

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

      // Počkej 5 sekund před další kontrolou (COOLDOWN režim) - s randomizací ±10s
      await new Promise(resolve => setTimeout(resolve, randomizeInterval(this.intervals.building)));
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

      // Počkej 1 minutu - s randomizací ±10s
      await new Promise(resolve => setTimeout(resolve, randomizeInterval(this.intervals.scavenge)));
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
      // Zkontroluj shutdown flag
      await this.checkShutdownFlag();

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

      // Počkej 2 minuty - s randomizací ±10s
      await new Promise(resolve => setTimeout(resolve, randomizeInterval(this.intervals.recruit)));
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
      await new Promise(resolve => setTimeout(resolve, randomizeInterval(this.intervals.research)));
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
      await new Promise(resolve => setTimeout(resolve, randomizeInterval(this.intervals.paladin)));
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
   * SMYČKA 8: Balance (balancování surovin na trhu)
   * VYPNUTO - způsobovalo bany
   */
  /*
  async balanceLoop() {
    console.log('🔄 [P7] Smyčka BALANCE spuštěna');

    while (this.isRunning) {
      // Zkontroluj shutdown flag
      await this.checkShutdownFlag();

      const accounts = this.db.getAllActiveAccounts();

      // Filtruj pouze účty, které mají balance enabled a vypršelý timer
      const accountsToProcess = accounts.filter(account => {
        // Kontrola balance_enabled v účtu (default true pro nové účty)
        const balanceEnabled = account.balance_enabled === 1 || account.balance_enabled === undefined;
        if (!balanceEnabled) {
          return false;
        }

        const balanceKey = `balance_${account.id}`;
        const balanceWaitUntil = this.accountWaitTimes[balanceKey];
        return !balanceWaitUntil || Date.now() >= balanceWaitUntil;
      });

      // Zpracuj po 5 účtech paralelně
      for (let i = 0; i < accountsToProcess.length; i += 5) {
        const batch = accountsToProcess.slice(i, i + 5);

        await Promise.all(
          batch.map(account => {
            return this.workerPool.run(
              () => this.processBalance(account),
              this.priorities.balance,
              `Balance: ${account.username}`
            );
          })
        );

        // Malá pauza mezi dávkami (50ms)
        if (i + 5 < accountsToProcess.length) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }

      // Počkej 120 minut
      await new Promise(resolve => setTimeout(resolve, randomizeInterval(this.intervals.balance)));
    }
  }
  */

  /**
   * Monitoring - vypíše statistiky každých 30 sekund
   */
  async statsMonitor() {
    while (this.isRunning) {
      // Zkontroluj shutdown flag
      await this.checkShutdownFlag();

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

      // Ulož cookies po úspěšném přihlášení (server může obnovit session)
      await this.browserPool.saveCookies(context, account.id);

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

        // Otevři viditelný prohlížeč POUZE pokud už není otevřený nebo se neotvírá (CAPTCHA)
        if (!this.isBrowserActive(account.id) && !this.openingBrowsers.has(account.id)) {
          if (isNewCaptcha) {
            console.log(`🖥️  Otevírám viditelný prohlížeč pro vyřešení CAPTCHA`);

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
                  this.captchaDetected.delete(account.id);
                  console.log(`✅ [${account.username}] CAPTCHA vyřešena - browser zavřen`);
                });
              }
            } catch (error) {
              console.error(`❌ [${account.username}] Chyba při otevírání browseru pro CAPTCHA:`, error.message);
            } finally {
              // Vždy odstraň z openingBrowsers
              this.openingBrowsers.delete(account.id);
            }
          }
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

        // Otevři viditelný prohlížeč POUZE pokud už není otevřený nebo se neotvírá (DOBYTÁ VESNICE)
        if (!this.isBrowserActive(account.id) && !this.openingBrowsers.has(account.id)) {
          console.log(`🖥️  Otevírám viditelný prohlížeč pro vytvoření nové vesnice`);

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
            console.error(`❌ [${account.username}] Chyba při otevírání browseru pro conquered:`, error.message);
          } finally {
            // Vždy odstraň z openingBrowsers
            this.openingBrowsers.delete(account.id);
          }
        } else {
          console.log(`⏭️  Viditelný prohlížeč už je otevřený nebo se otevírá - přeskakuji`);
        }
        return;
      }

      // NOVÉ: Kontrola jednotek (sloučení unitsLoop do checksLoop)
      try {
        const supportModule = new SupportModule(page, this.db, account.id);
        await supportModule.getAllUnitsInfo();
      } catch (unitsError) {
        // Tichá chyba - neukončujeme kvůli chybě v kontrole jednotek
        console.error(`⚠️  [${account.username}] Chyba při kontrole jednotek:`, unitsError.message);
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

      // Ulož cookies po úspěšném přihlášení (server může obnovit session)
      await this.browserPool.saveCookies(context, account.id);

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

      // Ulož cookies po úspěšném přihlášení (server může obnovit session)
      await this.browserPool.saveCookies(context, account.id);

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

      // Ulož cookies po úspěšném přihlášení (server může obnovit session)
      await this.browserPool.saveCookies(context, account.id);

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
      // OPTIMALIZACE: Zkontroluj jestli už není vše vyzkoumáno (uloženo v DB)
      const researchSettings = this.db.getResearchSettings(account.id);
      if (researchSettings && researchSettings.research_completed) {
        console.log(`✅ [${account.username}] Výzkum již dokončen - přeskakuji`);
        // Nastav dlouhý wait time (24 hodin) protože už není co dělat
        this.accountWaitTimes[`research_${account.id}`] = Date.now() + (24 * 60 * 60 * 1000);
        return;
      }

      ({ context, browserKey } = await this.browserPool.createContext(account.id));
      const page = await context.newPage();

      const loginSuccess = await this.loginToGame(page, account);
      if (!loginSuccess) {
        await this.browserPool.closeContext(context, browserKey);
        await this.handleFailedLogin(account);
        return;
      }

      // Ulož cookies po úspěšném přihlášení (server může obnovit session)
      await this.browserPool.saveCookies(context, account.id);

      const researchModule = new ResearchModule(page, this.db, account.id);
      const researchResult = await researchModule.autoResearch();

      // OPTIMALIZACE: Pokud je vše hotovo, ulož do DB
      if (researchResult && researchResult.status === 'completed') {
        console.log(`✅ [${account.username}] Výzkum dokončen - ukládám do DB`);
        this.db.updateResearchSettings(account.id, {
          research_completed: true
        });
        // Nastav dlouhý wait time (24 hodin)
        this.accountWaitTimes[`research_${account.id}`] = Date.now() + (24 * 60 * 60 * 1000);
      } else if (researchResult && researchResult.waitTime) {
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

      // Ulož cookies po úspěšném přihlášení (server může obnovit session)
      await this.browserPool.saveCookies(context, account.id);

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

      // Ulož cookies po úspěšném přihlášení (server může obnovit session)
      await this.browserPool.saveCookies(context, account.id);

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
   * Zpracuj balancování surovin na trhu
   * VYPNUTO - způsobovalo bany
   */
  /*
  async processBalance(account) {
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

      // Ulož cookies po úspěšném přihlášení (server může obnovit session)
      await this.browserPool.saveCookies(context, account.id);

      const balancModule = new BalancModule(page, this.db, account.id);
      const balanceResult = await balancModule.execute();

      if (balanceResult && balanceResult.waitTime) {
        // Použij minimálně interval smyčky (120 min)
        const actualWaitTime = Math.max(balanceResult.waitTime, this.intervals.balance);
        this.accountWaitTimes[`balance_${account.id}`] = Date.now() + actualWaitTime;
        console.log(`⏰ [${account.username}] Balance: Další za ${Math.ceil(actualWaitTime / 60000)} min`);
      } else {
        this.accountWaitTimes[`balance_${account.id}`] = Date.now() + this.intervals.balance;
      }

      await this.browserPool.closeContext(context, browserKey);

    } catch (error) {
      console.error(`❌ [${account.username}] Chyba při balancování surovin:`, error.message);
      if (context && browserKey) await this.browserPool.closeContext(context, browserKey);
    }
  }
  */

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

        // Anti-bot detection - zkontroluj captcha/ban
        try {
          const challenges = await detectAnyChallenge(page);
          const ban = await detectBan(page);

          if (challenges.cloudflare.detected) {
            console.log(`⚠️  [${account.username}] Detekována Cloudflare challenge`);
          }
          if (challenges.hcaptcha.detected) {
            console.log(`⚠️  [${account.username}] Detekována hCaptcha (sitekey: ${challenges.hcaptcha.sitekey})`);
          }
          if (challenges.recaptcha.detected) {
            console.log(`⚠️  [${account.username}] Detekována reCaptcha (sitekey: ${challenges.recaptcha.sitekey})`);
          }
          if (ban.detected) {
            console.log(`🚫 [${account.username}] Detekován BAN!`);
            if (ban.ipBan) {
              console.log(`   └─ IP ban detekován - zkontroluj proxy`);
            }
          }
        } catch (detectionError) {
          // Ignore detection errors
        }

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

    // 3. Zavři všechny headless browsery (bez ukládání cookies!)
    console.log('\n📍 Krok 3/4: Zavírám headless browsery...');
    console.log('ℹ️  Cookies se NEUKLÁDAJÍ - ukládá se pouze při manuálním přihlášení');
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
