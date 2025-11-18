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
import SupportModule from './modules/support.js';
import logger from './logger.js';

/**
 * 🚀 Event-Driven Automator s nezávislými smyčkami
 *
 * Architektura:
 * - Globální WorkerPool (max 100 procesů)
 * - 6 nezávislých smyček:
 *   1. Kontroly (útoky/CAPTCHA) - neustále dokola po 2 účtech [P1]
 *   2. Build - každých 5s po 5 účtech (COOLDOWN režim) [P1]
 *   3. Rekrut - každé 4 minuty po 5 účtech [P3]
 *   4. Výzkum - každých 120 minut po 5 účtech [P4]
 *   5. Paladin - každých 120 minut po 5 účtech [P5]
 *   6. Jednotky - každých 20 minut po 2 účtech [P6]
 */
class Automator {
  constructor() {
    this.db = new DatabaseManager();
    this.browserManager = new BrowserManager(this.db);
    this.browserPool = new SharedBrowserPool(this.db);
    this.workerPool = new WorkerPool(100); // Max 100 procesů
    this.isRunning = false;
    this.accountWaitTimes = {}; // Per-account per-module timing
    this.openBrowserWindows = new Map(); // Účty s otevřeným viditelným oknem (accountId => browserInfo)

    // Intervaly pro smyčky
    this.intervals = {
      checks: 0,        // Kontroly běží neustále (žádný wait)
      recruit: 4 * 60 * 1000,     // 4 minuty
      building: 5 * 1000,         // 5 sekund - COOLDOWN režim (kontroluje hned jak vyprší)
      research: 120 * 60 * 1000,  // 120 minut (2 hodiny)
      paladin: 120 * 60 * 1000,   // 120 minut (2 hodiny)
      units: 20 * 60 * 1000,      // 20 minut (kontrola jednotek)
      accountInfo: 20 * 60 * 1000 // 20 minut (sběr statistik)
    };

    // Priority (nižší = vyšší priorita)
    this.priorities = {
      checks: 1,    // Útoky/CAPTCHA
      building: 1,  // Výstavba - STEJNÁ PRIORITA jako kontroly
      recruit: 3,   // Rekrutování
      research: 4,  // Výzkum
      paladin: 5,   // Paladin
      units: 6,     // Kontrola jednotek
      stats: 7      // Statistiky
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
   * Pokud ne, odstraní ho z mapy
   * @returns {boolean} true pokud je browser aktivní, false pokud ne
   */
  isBrowserActive(accountId) {
    const browserInfo = this.openBrowserWindows.get(accountId);

    if (!browserInfo) {
      return false;
    }

    // Zkontroluj jestli je browser opravdu ještě připojený
    const isConnected = browserInfo.browser && browserInfo.browser.isConnected();

    if (!isConnected) {
      // Browser byl zavřen ale nebyl odstraněn z mapy - odstraň ho teď
      this.openBrowserWindows.delete(accountId);
      const account = this.db.getAccount(accountId);
      console.log(`🔌 Browser pro ${account?.username || accountId} již není aktivní - odstraněn z mapy`);
      return false;
    }

    return true;
  }

  /**
   * Spustí všechny smyčky
   */
  async start() {
    console.log('='.repeat(70));
    console.log('🤖 Spouštím Event-Driven automatizaci');
    console.log('⚡ Worker Pool: Max 100 procesů');
    console.log('🔄 6 nezávislých smyček:');
    console.log('   [P1] Kontroly: neustále po 2 účtech (~10 min/cyklus pro 100 účtů)');
    console.log('   [P1] Build: každých 5s po 5 účtech - COOLDOWN režim (VYSOKÁ PRIORITA)');
    console.log('   [P3] Rekrut: každé 4 min po 5 účtech');
    console.log('   [P4] Výzkum: každých 120 min po 5 účtech (2 hod)');
    console.log('   [P5] Paladin: každých 120 min po 5 účtech (2 hod)');
    console.log('   [P6] Jednotky: každých 20 min po 2 účtech (~10 min/cyklus pro 100 účtů)');
    console.log('   [P7] Statistiky: každých 20 min');
    console.log('='.repeat(70));

    this.isRunning = true;

    // Spusť všechny smyčky paralelně
    await Promise.all([
      this.checksLoop(),      // P1: Neustále po 2 účtech
      this.buildingLoop(),    // P1: Každých 5s po 5 účtech (COOLDOWN režim)
      this.recruitLoop(),     // P3: Každé 4 min po 5 účtech
      this.researchLoop(),    // P4: Každých 120 min po 5 účtech
      this.paladinLoop(),     // P5: Každých 120 min po 5 účtech
      this.unitsLoop(),       // P6: Každých 20 min po 2 účtech
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
   * SMYČKA 3: Rekrutování
   * Každé 4 minuty projde účty a zkontroluje timing
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

      // Počkej 4 minuty
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
   * Každé 2 hodiny projde účty a zkontroluje paladina
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

      // Počkej 2 hodiny
      await new Promise(resolve => setTimeout(resolve, this.intervals.paladin));
    }
  }

  /**
   * SMYČKA 6: Kontrola jednotek
   * Každých 20 minut projde účty a zkontroluje jednotky (po 2 účtech)
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

      // Počkej 20 minut
      await new Promise(resolve => setTimeout(resolve, this.intervals.units));
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
        console.log(`❌ [${account.username}] Přihlášení selhalo - otevírám viditelný browser`);

        // Zavři headless browser
        await this.browserPool.closeContext(context, browserKey);

        // Otevři viditelný prohlížeč pro manuální přihlášení (NOVÝ ÚČET)
        if (!this.isBrowserActive(account.id)) {
          console.log(`🖥️  Otevírám viditelný prohlížeč pro přihlášení: ${account.username}`);

          // autoSaveAndClose = true (automaticky zavře po přihlášení)
          const browserInfo = await this.browserManager.testConnection(account.id, true);
          if (browserInfo) {
            // Ulož do mapy
            this.openBrowserWindows.set(account.id, browserInfo);

            // Sleduj zavření browseru
            browserInfo.browser.on('disconnected', () => {
              console.log(`🔒 Browser zavřen pro: ${account.username}`);
              this.openBrowserWindows.delete(account.id);
              console.log(`✅ Účet ${account.username} odebrán z otevřených oken`);
            });
          }
        } else {
          console.log(`⏭️  Viditelný prohlížeč už je otevřený pro ${account.username} - přeskakuji`);
        }
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
        console.log(`⚠️  [${account.username}] CAPTCHA detekována!`);

        // Zavři headless browser
        await this.browserPool.closeContext(context, browserKey);

        // Otevři viditelný prohlížeč POUZE pokud už není otevřený (CAPTCHA)
        if (!this.isBrowserActive(account.id)) {
          console.log(`🖥️  Otevírám viditelný prohlížeč pro vyřešení CAPTCHA`);

          // autoSaveAndClose = false (uživatel musí ručně zavřít)
          const browserInfo = await this.browserManager.testConnection(account.id, false);
          if (browserInfo) {
            // Ulož do mapy
            this.openBrowserWindows.set(account.id, browserInfo);

            // Sleduj zavření browseru
            browserInfo.browser.on('disconnected', () => {
              console.log(`🔒 Browser zavřen pro: ${account.username}`);
              this.openBrowserWindows.delete(account.id);
              console.log(`✅ Účet ${account.username} odebrán z otevřených oken`);
            });
          }

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

        // Otevři viditelný prohlížeč POUZE pokud už není otevřený (DOBYTÁ VESNICE)
        if (!this.isBrowserActive(account.id)) {
          console.log(`🖥️  Otevírám viditelný prohlížeč pro vytvoření nové vesnice`);

          // autoSaveAndClose = false (uživatel musí ručně zavřít)
          const browserInfo = await this.browserManager.testConnection(account.id, false);
          if (browserInfo) {
            // Ulož do mapy
            this.openBrowserWindows.set(account.id, browserInfo);

            // Sleduj zavření browseru
            browserInfo.browser.on('disconnected', () => {
              console.log(`🔒 Browser zavřen pro: ${account.username}`);
              this.openBrowserWindows.delete(account.id);
              console.log(`✅ Účet ${account.username} odebrán z otevřených oken`);
            });
          }

          console.log(`⚠️  Viditelný prohlížeč otevřen - vytvořte novou vesnici a zavřete okno`);
        } else {
          console.log(`⏭️  Viditelný prohlížeč už je otevřený - přeskakuji`);
        }
        return;
      }

      // Ulož cookies po úspěšném zpracování (důležité pro nové účty)
      await this.browserPool.saveCookies(context, account.id);

      // Zavři context (browser zůstane běžet)
      await this.browserPool.closeContext(context, browserKey);

      // Odstraň z otevřených oken (pokud tam byl) - úspěšné zpracování = CAPTCHA/login vyřešen
      if (this.openBrowserWindows.has(account.id)) {
        this.openBrowserWindows.delete(account.id);
        console.log(`✅ [${account.username}] Úspěšně přihlášen/vyřešeno - cookies uloženy`);
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
        this.accountWaitTimes[`building_${account.id}`] = Date.now() + 1 * 60 * 1000; // 1 min fallback
      }

      // Ulož cookies
      await this.browserPool.saveCookies(context, account.id);
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
      // collectUnitsInfo() již není potřeba - jednotky sbírá SupportModule v checksLoop()

      const recruitResult = await recruitModule.startRecruiting(settings.template);

      if (recruitResult && recruitResult.waitTime) {
        this.accountWaitTimes[`recruit_${account.id}`] = Date.now() + recruitResult.waitTime;
        console.log(`⏰ [${account.username}] Rekrut: Další za ${Math.ceil(recruitResult.waitTime / 60000)} min`);
      } else {
        this.accountWaitTimes[`recruit_${account.id}`] = Date.now() + this.intervals.recruit;
      }

      // Ulož cookies
      await this.browserPool.saveCookies(context, account.id);
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
        // Použij minimálně interval smyčky (120 min)
        const actualWaitTime = Math.max(researchResult.waitTime, this.intervals.research);
        this.accountWaitTimes[`research_${account.id}`] = Date.now() + actualWaitTime;
        console.log(`⏰ [${account.username}] Výzkum: Další za ${Math.ceil(actualWaitTime / 60000)} min`);
      } else {
        this.accountWaitTimes[`research_${account.id}`] = Date.now() + this.intervals.research;
      }

      // Ulož cookies
      await this.browserPool.saveCookies(context, account.id);
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
        return;
      }

      const supportModule = new SupportModule(page, this.db, account.id);
      await supportModule.getAllUnitsInfo();

      // Ulož cookies
      await this.browserPool.saveCookies(context, account.id);
      await this.browserPool.closeContext(context, browserKey);

    } catch (error) {
      logger.error(`Chyba při kontrole jednotek: ${error.message}`, account.username);
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
        // Použij minimálně interval smyčky (120 min)
        const actualWaitTime = Math.max(paladinResult.waitTime, this.intervals.paladin);
        this.accountWaitTimes[`paladin_${account.id}`] = Date.now() + actualWaitTime;
        console.log(`⏰ [${account.username}] Paladin: Další za ${Math.ceil(actualWaitTime / 60000)} min`);
      } else {
        this.accountWaitTimes[`paladin_${account.id}`] = Date.now() + this.intervals.paladin;
      }

      // Ulož cookies
      await this.browserPool.saveCookies(context, account.id);
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
