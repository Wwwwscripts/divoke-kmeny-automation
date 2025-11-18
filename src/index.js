import 'dotenv/config';
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

/**
 * 🚀 Event-Driven Automator s nezávislými smyčkami
 *
 * Architektura:
 * - Globální WorkerPool (max 50 procesů)
 * - 5 nezávislých smyček:
 *   1. Kontroly (útoky/CAPTCHA) - neustále dokola po 2 účtech [P1]
 *   2. Build - dynamicky podle timingu [P2]
 *   3. Rekrut - každé 4 minuty [P3]
 *   4. Výzkum - každých 60 minut [P4]
 *   5. Paladin - každých 60 minut [P5]
 */
class Automator {
  constructor() {
    this.db = new DatabaseManager();
    this.browserManager = new BrowserManager(this.db);
    this.browserPool = new SharedBrowserPool(this.db);
    this.workerPool = new WorkerPool(50); // Max 50 procesů
    this.isRunning = false;
    this.accountWaitTimes = {}; // Per-account per-module timing
    this.openBrowserWindows = new Set(); // Účty s otevřeným viditelným oknem

    // Intervaly pro smyčky
    this.intervals = {
      checks: 0,        // Kontroly běží neustále (žádný wait)
      recruit: 4 * 60 * 1000,     // 4 minuty
      building: 2 * 60 * 1000,    // 2 minuty (kontrola dynamického timingu)
      research: 60 * 60 * 1000,   // 60 minut
      paladin: 60 * 60 * 1000,    // 60 minut
      accountInfo: 20 * 60 * 1000 // 20 minut (sběr statistik)
    };

    // Priority (nižší = vyšší priorita)
    this.priorities = {
      checks: 1,    // Útoky/CAPTCHA - nejvyšší
      building: 2,  // Výstavba
      recruit: 3,   // Rekrutování
      research: 4,  // Výzkum
      paladin: 5,   // Paladin
      stats: 6      // Statistiky
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
   * Spustí všechny smyčky
   */
  async start() {
    console.log('='.repeat(70));
    console.log('🤖 Spouštím Event-Driven automatizaci');
    console.log('⚡ Worker Pool: Max 50 procesů');
    console.log('🔄 5 nezávislých smyček:');
    console.log('   [P1] Kontroly: neustále po 2 účtech (~10 min/cyklus pro 100 účtů)');
    console.log('   [P2] Build: dynamicky');
    console.log('   [P3] Rekrut: každé 4 min');
    console.log('   [P4] Výzkum: každých 60 min');
    console.log('   [P5] Paladin: každých 60 min');
    console.log('   [P6] Statistiky: každých 20 min');
    console.log('='.repeat(70));

    this.isRunning = true;

    // Spusť všechny smyčky paralelně
    await Promise.all([
      this.checksLoop(),      // P1: Neustále
      this.buildingLoop(),    // P2: Každé 2 min (kontrola dynamického timingu)
      this.recruitLoop(),     // P3: Každé 4 min
      this.researchLoop(),    // P4: Každých 60 min
      this.paladinLoop(),     // P5: Každých 60 min
      this.statsMonitor()     // Monitoring
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
   * Každé 2 minuty projde účty a zkontroluje dynamický timing
   * Priorita: 2
   */
  async buildingLoop() {
    console.log('🔄 [P2] Smyčka BUILD spuštěna');

    while (this.isRunning) {
      const accounts = this.db.getAllActiveAccounts();

      for (const account of accounts) {
        const buildingSettings = this.db.getBuildingSettings(account.id);

        if (buildingSettings && buildingSettings.enabled) {
          const buildingKey = `building_${account.id}`;
          const buildingWaitUntil = this.accountWaitTimes[buildingKey];

          // Pokud je čas, spusť
          if (!buildingWaitUntil || Date.now() >= buildingWaitUntil) {
            await this.workerPool.run(
              () => this.processBuilding(account, buildingSettings),
              this.priorities.building,
              `Build: ${account.username}`
            );
          }
        }
      }

      // Počkej 2 minuty před další kontrolou
      await new Promise(resolve => setTimeout(resolve, this.intervals.building));
    }
  }

  /**
   * SMYČKA 3: Rekrutování
   * Každé 4 minuty projde účty a zkontroluje timing
   * Priorita: 3
   */
  async recruitLoop() {
    console.log('🔄 [P3] Smyčka REKRUT spuštěna');

    while (this.isRunning) {
      const accounts = this.db.getAllActiveAccounts();

      for (const account of accounts) {
        const recruitSettings = this.db.getRecruitSettings(account.id);

        if (recruitSettings && recruitSettings.enabled) {
          const recruitKey = `recruit_${account.id}`;
          const recruitWaitUntil = this.accountWaitTimes[recruitKey];

          if (!recruitWaitUntil || Date.now() >= recruitWaitUntil) {
            await this.workerPool.run(
              () => this.processRecruit(account, recruitSettings),
              this.priorities.recruit,
              `Rekrut: ${account.username}`
            );
          }
        }
      }

      // Počkej 4 minuty
      await new Promise(resolve => setTimeout(resolve, this.intervals.recruit));
    }
  }

  /**
   * SMYČKA 4: Výzkum
   * Každých 60 minut projde účty a zkontroluje timing
   * Priorita: 4
   */
  async researchLoop() {
    console.log('🔄 [P4] Smyčka VÝZKUM spuštěna');

    while (this.isRunning) {
      const accounts = this.db.getAllActiveAccounts();

      for (const account of accounts) {
        const researchSettings = this.db.getResearchSettings(account.id);

        if (researchSettings && researchSettings.enabled) {
          const researchKey = `research_${account.id}`;
          const researchWaitUntil = this.accountWaitTimes[researchKey];

          if (!researchWaitUntil || Date.now() >= researchWaitUntil) {
            await this.workerPool.run(
              () => this.processResearch(account, researchSettings),
              this.priorities.research,
              `Výzkum: ${account.username}`
            );
          }
        }
      }

      // Počkej 60 minut
      await new Promise(resolve => setTimeout(resolve, this.intervals.research));
    }
  }

  /**
   * SMYČKA 5: Paladin
   * Každých 60 minut projde účty a zkontroluje paladina
   * Priorita: 5
   */
  async paladinLoop() {
    console.log('🔄 [P5] Smyčka PALADIN spuštěna');

    while (this.isRunning) {
      const accounts = this.db.getAllActiveAccounts();

      for (const account of accounts) {
        // Paladin modul je vždy aktivní (není třeba kontrolovat settings)
        const paladinKey = `paladin_${account.id}`;
        const paladinWaitUntil = this.accountWaitTimes[paladinKey];

        if (!paladinWaitUntil || Date.now() >= paladinWaitUntil) {
          await this.workerPool.run(
            () => this.processPaladin(account),
            this.priorities.paladin,
            `Paladin: ${account.username}`
          );
        }
      }

      // Počkej 60 minut
      await new Promise(resolve => setTimeout(resolve, this.intervals.paladin));
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
        console.log(`❌ [${account.username}] Přihlášení selhalo`);
        await this.browserPool.closeContext(context, browserKey);
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

      // Kontrola útoků a CAPTCHA (VŽDY)
      const notificationsModule = new NotificationsModule(page, this.db, account.id);
      await notificationsModule.detectAttacks();
      const hasCaptcha = await notificationsModule.detectCaptcha();
      const isConquered = await notificationsModule.detectConqueredVillage();

      if (hasCaptcha) {
        console.log(`⚠️  [${account.username}] CAPTCHA detekována!`);

        // Zavři headless browser
        await this.browserPool.closeContext(context, browserKey);

        // Otevři viditelný prohlížeč POUZE pokud už není otevřený
        if (!this.openBrowserWindows.has(account.id)) {
          console.log(`🖥️  Otevírám viditelný prohlížeč pro vyřešení CAPTCHA`);
          this.openBrowserWindows.add(account.id);
          await this.browserManager.testConnection(account.id);
          console.log(`⚠️  Viditelný prohlížeč otevřen - vyřešte CAPTCHA a zavřete okno`);
        } else {
          console.log(`⏭️  Viditelný prohlížeč už je otevřený - přeskakuji`);
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

        // Otevři viditelný prohlížeč POUZE pokud už není otevřený
        if (!this.openBrowserWindows.has(account.id)) {
          console.log(`🖥️  Otevírám viditelný prohlížeč pro vytvoření nové vesnice`);
          this.openBrowserWindows.add(account.id);
          await this.browserManager.testConnection(account.id);
          console.log(`⚠️  Viditelný prohlížeč otevřen - vytvořte novou vesnici a zavřete okno`);
        } else {
          console.log(`⏭️  Viditelný prohlížeč už je otevřený - přeskakuji`);
        }
        return;
      }

      // Zavři context (browser zůstane běžet)
      await this.browserPool.closeContext(context, browserKey);

      // Odstraň z otevřených oken (pokud tam byl) - úspěšné zpracování = CAPTCHA vyřešena
      if (this.openBrowserWindows.has(account.id)) {
        this.openBrowserWindows.delete(account.id);
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
        return;
      }

      const buildingModule = new BuildingModule(page, this.db, account.id);
      const buildResult = await buildingModule.startBuilding(settings.template);

      if (buildResult && buildResult.waitTime) {
        this.accountWaitTimes[`building_${account.id}`] = Date.now() + buildResult.waitTime;
        console.log(`⏰ [${account.username}] Build: Další za ${Math.ceil(buildResult.waitTime / 60000)} min`);
      } else {
        this.accountWaitTimes[`building_${account.id}`] = Date.now() + 5 * 60 * 1000; // 5 min fallback
      }

      await this.browserPool.closeContext(context, browserKey);

    } catch (error) {
      console.error(`❌ [${account.username}] Chyba při buildění:`, error.message);
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
        return;
      }

      const recruitModule = new RecruitModule(page, this.db, account.id);
      await recruitModule.collectUnitsInfo();

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
        return;
      }

      const researchModule = new ResearchModule(page, this.db, account.id);
      const researchResult = await researchModule.autoResearch();

      if (researchResult && researchResult.waitTime) {
        this.accountWaitTimes[`research_${account.id}`] = Date.now() + researchResult.waitTime;
        console.log(`⏰ [${account.username}] Výzkum: Další za ${Math.ceil(researchResult.waitTime / 60000)} min`);
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
        return;
      }

      const paladinModule = new PaladinModule(page, this.db, account.id);
      const paladinResult = await paladinModule.execute();

      if (paladinResult && paladinResult.waitTime) {
        this.accountWaitTimes[`paladin_${account.id}`] = Date.now() + paladinResult.waitTime;
        console.log(`⏰ [${account.username}] Paladin: Další za ${Math.ceil(paladinResult.waitTime / 60000)} min`);
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

      await page.waitForTimeout(2000);

      // Zkontroluj, jestli není přesměrováno na create_village.php (dobytí vesnice)
      const currentUrl = page.url();
      if (currentUrl.includes('create_village.php')) {
        console.log('⚠️  Detekováno přesměrování na create_village.php - vesnice dobyta, ale uživatel je přihlášen');
        return true; // Technicky je přihlášen, jen má dobyto vesnici
      }

      const isLoggedIn = await page.evaluate(() => {
        return document.querySelector('#menu_row') !== null;
      });

      return isLoggedIn;
    } catch (error) {
      console.error('❌ Chyba při přihlašování:', error.message);
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
