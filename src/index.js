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
    this.browserPool = new SharedBrowserPool(this.db);
    this.workerPool = new WorkerPool(100); // Max 100 procesů
    this.isRunning = false;
    this.accountWaitTimes = {}; // Per-account per-module timing
    this.captchaDetected = new Set(); // Účty s detekovanou CAPTCHA (aby se nespamovalo)
    this.openBrowsers = new Map(); // Tracking otevřených visible browserů (accountId => browser)
    this.openingBrowsers = new Set(); // Tracking účtů pro které se právě otevírá browser (race condition protection)

    // Intervaly pro smyčky - ZVÝŠENO pro snížení captcha rizika
    this.intervals = {
      checks: 0,        // Kontroly běží neustále (žádný wait)
      recruit: 180 * 60 * 1000,   // 180 minut (3 hodiny) - SNÍŽENO PROTI CAPTCHA
      building: 30 * 1000,        // 30 sekund - COOLDOWN režim (zvýšeno z 5s)
      research: 120 * 60 * 1000,  // 120 minut (2 hodiny)
      paladin: 60 * 60 * 1000,    // 60 minut (1 hodina)
      units: 15 * 60 * 1000,      // 15 minut (zvýšeno z 10min)
      accountInfo: 25 * 60 * 1000, // 25 minut (zvýšeno z 20min)
      dailyRewards: 24 * 60 * 60 * 1000, // Nepoužívá se - denní odměny běží 2x denně (4:00 a 16:00)
      scavenge: 3 * 60 * 1000,    // 3 minuty (zvýšeno z 1min)
      // balance: 120 * 60 * 1000    // VYPNUTO - způsobovalo bany
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
    console.log('🤖 Spouštím Event-Driven automatizaci - TESTOVACÍ REŽIM');
    console.log('⚡ Worker Pool: Max 100 procesů');
    console.log('🛡️  Aktivní ochrana: Human behavior, WebSocket timing, Fingerprinting');
    console.log('🔄 Aktivní smyčky (ANTI-CAPTCHA režim):');
    console.log('   [P1] Kontroly útoků: po 10 účtech (10s pauzy), cyklus každých 5 min');
    console.log('   [P1] Build: každých 30s po 5 účtech (±15s random, 10min fallback)');
    console.log('   [P3] Rekrut: každé 3 HODINY po 10 účtech (delší delays 5-8s)');
    console.log('   [P6] Jednotky: každých 15 min po 2 účtech (±2 min random)');
    console.log('   ⏸️  CAPTCHA kontrola: při každém přihlášení (ne v loopu)');
    console.log('');
    console.log('   ❌ VYPNUTO: Sběr, Výzkum, Paladin, Denní odměny');
    console.log('='.repeat(70));

    this.isRunning = true;

    // Spusť všechny smyčky paralelně
    await Promise.all([
      this.checksLoop(),       // P1: Kontroly útoků
      this.buildingLoop(),     // P1: Výstavba
      this.unitsLoop(),        // P6: Kontrola jednotek
      // this.scavengeLoop(),     // P2: VYPNUTO - testování
      this.recruitLoop(),      // P3: ZAPNUTO
      // this.researchLoop(),     // P4: VYPNUTO - testování
      // this.paladinLoop(),      // P5: VYPNUTO - testování
      // this.dailyRewardsLoop(), // P6: VYPNUTO - testování
      // this.balanceLoop(),      // P7: VYPNUTO - způsobovalo bany
      this.statsMonitor()      // Monitoring
    ]);
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
      console.log('\n' + '='.repeat(70));
      console.log(`🔍 KONTROLY - Nový cyklus začíná (${new Date().toLocaleTimeString('cs-CZ')})`);
      console.log('='.repeat(70));

      // Zkontroluj shutdown flag
      await this.checkShutdownFlag();

      const allAccounts = this.db.getAllActiveAccounts();

      // Filtruj účty s CAPTCHA - ty se zpracovávají pouze ve visible browseru
      const accounts = allAccounts.filter(account => !this.captchaDetected.has(account.id));

      console.log(`📊 Načteno: ${accounts.length} účtů k zpracování (${allAccounts.length - accounts.length} má CAPTCHA)`);

      if (accounts.length === 0) {
        console.log('⚠️  Žádné aktivní účty k zpracování');
        await new Promise(resolve => setTimeout(resolve, 30000));
        continue;
      }

      const totalBatches = Math.ceil(accounts.length / 10);
      console.log(`📦 Rozděleno do ${totalBatches} skupin po max 10 účtech\n`);

      // Zpracuj po 10 účtech
      for (let i = 0; i < accounts.length; i += 10) {
        const batchStartTime = Date.now();
        const batch = accounts.slice(i, i + 10);
        const batchNum = Math.floor(i / 10) + 1;

        console.log(`\n📋 Skupina ${batchNum}/${totalBatches}: Zpracovávám účty ${i + 1}-${Math.min(i + 10, accounts.length)}`);
        console.log(`   Účty: ${batch.map(a => a.username).join(', ')}`);

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

        // Loguj výsledky zpracování
        const successful = results.filter(r => r.status === 'fulfilled').length;
        const failed = results.filter(r => r.status === 'rejected').length;
        const batchElapsed = ((Date.now() - batchStartTime) / 1000).toFixed(1);

        console.log(`   ✅ Úspěšně: ${successful} | ❌ Chyby: ${failed} | ⏱️  Čas: ${batchElapsed}s`);

        // Loguj chyby pokud nějaké byly
        results.forEach((result, idx) => {
          if (result.status === 'rejected') {
            console.log(`   ⚠️  [${batch[idx].username}] Chyba: ${result.reason?.message || result.reason}`);
          }
        });

        // Pauza mezi skupinami (10 sekund)
        if (i + 10 < accounts.length) {
          console.log(`   ⏸️  Pauza 10s před další skupinou...`);
          await new Promise(resolve => setTimeout(resolve, 10000));
        }
      }

      // Celý cyklus hotový, počkej 5 minut od začátku cyklu
      const cycleElapsed = Date.now() - cycleStartTime;
      const waitTime = Math.max(0, 5 * 60 * 1000 - cycleElapsed);
      const cycleElapsedSec = (cycleElapsed / 1000).toFixed(1);

      console.log('\n' + '-'.repeat(70));
      console.log(`✅ Cyklus dokončen za ${cycleElapsedSec}s`);

      if (waitTime > 0) {
        const waitMin = Math.floor(waitTime / 60000);
        const waitSec = Math.floor((waitTime % 60000) / 1000);
        console.log(`⏰ Čekám ${waitMin}m ${waitSec}s do dalšího cyklu (5min od začátku)...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      } else {
        console.log(`⚠️  Cyklus trval déle než 5 minut, spouštím další okamžitě`);
      }
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
    let loopCount = 0;

    while (this.isRunning) {
      loopCount++;
      const loopStartTime = Date.now();

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
        console.log(`\n🏗️  BUILD Cyklus #${loopCount} (${new Date().toLocaleTimeString('cs-CZ')})`);
        console.log(`   📊 K zpracování: ${accountsToProcess.length} účtů s enabled build a vypršelým timerem`);
        console.log(`   📋 Účty: ${accountsToProcess.map(a => a.username).join(', ')}`);

        const totalBatches = Math.ceil(accountsToProcess.length / 5);

        // Zpracuj po 5 účtech paralelně
        for (let i = 0; i < accountsToProcess.length; i += 5) {
          const batchStartTime = Date.now();
          const batch = accountsToProcess.slice(i, i + 5);
          const batchNum = Math.floor(i / 5) + 1;

          console.log(`\n   📦 Skupina ${batchNum}/${totalBatches}: ${batch.map(a => a.username).join(', ')}`);

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

          // Loguj výsledky
          const successful = results.filter(r => r.status === 'fulfilled').length;
          const failed = results.filter(r => r.status === 'rejected').length;
          const batchElapsed = ((Date.now() - batchStartTime) / 1000).toFixed(1);

          console.log(`      ✅ Úspěšně: ${successful} | ❌ Chyby: ${failed} | ⏱️  ${batchElapsed}s`);

          // Loguj chyby
          results.forEach((result, idx) => {
            if (result.status === 'rejected') {
              console.log(`      ⚠️  [${batch[idx].username}] ${result.reason?.message || result.reason}`);
            }
          });

          // Pauza mezi dávkami (1-3s)
          if (i + 5 < accountsToProcess.length) {
            const pause = 1000 + Math.random() * 2000;
            console.log(`      ⏸️  Pauza ${(pause / 1000).toFixed(1)}s...`);
            await new Promise(resolve => setTimeout(resolve, pause));
          }
        }

        const loopElapsed = ((Date.now() - loopStartTime) / 1000).toFixed(1);
        console.log(`   ✅ Zpracováno za ${loopElapsed}s`);
      } else {
        // Tichý log pouze každých 10 cyklů
        if (loopCount % 10 === 0) {
          console.log(`🏗️  BUILD: Žádné účty k zpracování (cyklus #${loopCount})`);
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

        // Pauza mezi dávkami (1-3s)
        if (i + 5 < accountsToProcess.length) {
          await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));
        }
      }

      // Počkej 3 minuty - s randomizací ±30s
      await new Promise(resolve => setTimeout(resolve, randomizeInterval(this.intervals.scavenge, 30000)));
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
      console.log('\n' + '='.repeat(70));
      console.log(`🎯 REKRUT - Nový cyklus začíná (${new Date().toLocaleTimeString('cs-CZ')})`);
      console.log('='.repeat(70));

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

      console.log(`📊 Načteno: ${accountsToProcess.length} účtů s povoleným rekrutem (z ${allAccounts.length} celkem)`);

      if (accountsToProcess.length === 0) {
        console.log('⚠️  Žádné účty s povoleným rekrutem');
        await new Promise(resolve => setTimeout(resolve, this.intervals.recruit));
        continue;
      }

      const totalBatches = Math.ceil(accountsToProcess.length / 10);
      console.log(`📦 Rozděleno do ${totalBatches} skupin po max 10 účtech\n`);

      // Zpracuj po 10 účtech paralelně
      for (let i = 0; i < accountsToProcess.length; i += 10) {
        const batchStartTime = Date.now();
        const batch = accountsToProcess.slice(i, i + 10);
        const batchNum = Math.floor(i / 10) + 1;

        console.log(`\n📋 Skupina ${batchNum}/${totalBatches}: Zpracovávám účty ${i + 1}-${Math.min(i + 10, accountsToProcess.length)}`);
        console.log(`   Účty: ${batch.map(a => a.username).join(', ')}`);

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

        // Loguj výsledky
        const successful = results.filter(r => r.status === 'fulfilled').length;
        const failed = results.filter(r => r.status === 'rejected').length;
        const batchElapsed = ((Date.now() - batchStartTime) / 1000).toFixed(1);

        console.log(`   ✅ Úspěšně: ${successful} | ❌ Chyby: ${failed} | ⏱️  Čas: ${batchElapsed}s`);

        // Loguj chyby
        results.forEach((result, idx) => {
          if (result.status === 'rejected') {
            console.log(`   ⚠️  [${batch[idx].username}] Chyba: ${result.reason?.message || result.reason}`);
          }
        });

        // Pauza mezi skupinami (10 sekund)
        if (i + 10 < accountsToProcess.length) {
          console.log(`   ⏸️  Pauza 10s před další skupinou...`);
          await new Promise(resolve => setTimeout(resolve, 10000));
        }
      }

      // Celý cyklus hotový, počkej 3 hodiny od začátku cyklu
      const cycleElapsed = Date.now() - cycleStartTime;
      const waitTime = Math.max(0, this.intervals.recruit - cycleElapsed);
      const cycleElapsedSec = (cycleElapsed / 1000).toFixed(1);

      console.log('\n' + '-'.repeat(70));
      console.log(`✅ Cyklus dokončen za ${cycleElapsedSec}s`);

      if (waitTime > 0) {
        const waitMin = Math.floor(waitTime / 60000);
        const waitSec = Math.floor((waitTime % 60000) / 1000);
        console.log(`⏰ Čekám ${waitMin}m ${waitSec}s do dalšího cyklu (3h od začátku)...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      } else {
        console.log(`⚠️  Cyklus trval déle než 3 hodiny, spouštím další okamžitě`);
      }
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

        // Pauza mezi dávkami (2-5s)
        if (i + 5 < accountsToProcess.length) {
          await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 3000));
        }
      }

      // Počkej 2 hodiny - s randomizací ±5 minut
      await new Promise(resolve => setTimeout(resolve, randomizeInterval(this.intervals.research, 5 * 60 * 1000)));
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

        // Pauza mezi dávkami (2-5s)
        if (i + 5 < accountsToProcess.length) {
          await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 3000));
        }
      }

      // Počkej 1 hodinu - s randomizací ±3 minuty
      await new Promise(resolve => setTimeout(resolve, randomizeInterval(this.intervals.paladin, 3 * 60 * 1000)));
    }
  }

  /**
   * SMYČKA 6: Kontrola jednotek
   * Každých 10 minut projde účty a zkontroluje jednotky (po 2 účtech)
   * Priorita: 6
   */
  async unitsLoop() {
    console.log('🔄 [P6] Smyčka JEDNOTKY spuštěna');
    let loopCount = 0;

    while (this.isRunning) {
      loopCount++;
      const loopStartTime = Date.now();

      // Zkontroluj shutdown flag
      await this.checkShutdownFlag();

      const allAccounts = this.db.getAllActiveAccounts();

      // Filtruj účty s CAPTCHA - ty se zpracovávají pouze ve visible browseru
      const accounts = allAccounts.filter(account => !this.captchaDetected.has(account.id));

      let errorCount = 0;

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

        // Počítej jen chyby
        const failed = results.filter(r => r.status === 'rejected').length;
        errorCount += failed;

        // Loguj chyby
        results.forEach((result, idx) => {
          if (result.status === 'rejected') {
            console.log(`      ⚠️  [${batch[idx].username}] ${result.reason?.message || result.reason}`);
          }
        });

        // Pauza mezi dávkami (1-3s)
        if (i + 2 < accounts.length) {
          const pause = 1000 + Math.random() * 2000;
          await new Promise(resolve => setTimeout(resolve, pause));
        }
      }

      // Log jen pokud byly chyby
      if (errorCount > 0) {
        console.log(`⚠️  JEDNOTKY Cyklus #${loopCount}: ${errorCount} chyb`);
      }

      // Počkej 15 minut - s randomizací ±2 minuty
      const interval = randomizeInterval(this.intervals.units, 2 * 60 * 1000);
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
        console.log(`   ❌ [${account.username}] Přihlášení selhalo`);
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

      // Kontrola útoků - VOLAT NEJDŘÍV pro aktualizaci incoming_attacks
      const notificationsModule = new NotificationsModule(page, this.db, account.id);
      await notificationsModule.detectAttacks();

      // Kontrola dobytí vesnice
      const isConquered = await notificationsModule.detectConqueredVillage();

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

      // Zavři context (browser zůstane běžet)
      await this.browserPool.closeContext(context, browserKey);

    } catch (error) {
      console.error(`   ❌ [${account.username}] Chyba při kontrole: ${error.message}`);
      if (context && browserKey) {
        await this.browserPool.closeContext(context, browserKey);
      }
      throw error; // Re-throw pro správné logování v Promise.allSettled
    }
  }

  /**
   * Zpracuj výstavbu
   */
  async processBuilding(account, settings) {
    let context, browserKey;

    try {
      console.log(`      🏗️  [${account.username}] Zahajuji build (šablona: ${settings.template})...`);

      ({ context, browserKey } = await this.browserPool.createContext(account.id));
      const page = await context.newPage();

      const loginSuccess = await this.loginToGame(page, account);
      if (!loginSuccess) {
        console.log(`      ❌ [${account.username}] Přihlášení selhalo`);
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
        const waitMin = Math.ceil(buildResult.waitTime / 60000);
        console.log(`      ⏰ [${account.username}] Build dokončen, další za ${waitMin} min`);
      } else {
        this.accountWaitTimes[`building_${account.id}`] = Date.now() + 10 * 60 * 1000; // 10 min fallback
        console.log(`      ✅ [${account.username}] Build zkontrolován (fallback 10min)`);
      }

      await this.browserPool.closeContext(context, browserKey);

    } catch (error) {
      console.error(`      ❌ [${account.username}] Chyba při buildění: ${error.message}`);
      if (context && browserKey) await this.browserPool.closeContext(context, browserKey);
      throw error; // Re-throw pro správné logování v Promise.allSettled
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
        console.log(`      ❌ [${account.username}] Přihlášení selhalo`);
        await this.browserPool.closeContext(context, browserKey);
        await this.handleFailedLogin(account);
        return;
      }

      // Ulož cookies po úspěšném přihlášení (server může obnovit session)
      await this.browserPool.saveCookies(context, account.id);

      const supportModule = new SupportModule(page, this.db, account.id);
      await supportModule.getAllUnitsInfo();

      await this.browserPool.closeContext(context, browserKey);

    } catch (error) {
      console.error(`      ❌ [${account.username}] Chyba při kontrole jednotek: ${error.message}`);
      if (context && browserKey) await this.browserPool.closeContext(context, browserKey);
      throw error; // Re-throw pro správné logování v Promise.allSettled
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

      // Zkontroluj CAPTCHA (in-game CAPTCHA kontrola)
      try {
        const NotificationsModule = (await import('./modules/notifications.js')).default;
        const notificationsModule = new NotificationsModule(page, this.db, account.id);
        const hasCaptcha = await notificationsModule.detectCaptcha();

        if (hasCaptcha) {
          // Loguj pouze pokud ještě není zaznamenaná CAPTCHA pro tento účet
          const isNewCaptcha = !this.captchaDetected.has(account.id);

          if (isNewCaptcha) {
            console.log(`⚠️  [${account.username}] CAPTCHA detekována při přihlášení!`);
            this.captchaDetected.add(account.id);

            // Otevři viditelný prohlížeč POUZE pokud už není otevřený nebo se neotvírá
            if (!this.isBrowserActive(account.id) && !this.openingBrowsers.has(account.id)) {
              console.log(`🖥️  Otevírám viditelný prohlížeč pro vyřešení CAPTCHA`);

              // Označ že se browser otevírá
              this.openingBrowsers.add(account.id);

              try {
                const browserInfo = await this.browserManager.testConnection(account.id, false);

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
                this.openingBrowsers.delete(account.id);
              }
            }
          }

          return false; // CAPTCHA = failed login
        }
      } catch (captchaError) {
        // Ignore CAPTCHA check errors
        console.log(`⚠️  [${account.username}] Nepodařilo se zkontrolovat CAPTCHA: ${captchaError.message}`);
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
