import 'dotenv/config';
import DatabaseManager from './database.js';
import BrowserManager from './browserManager.js';
import AccountInfoModule from './modules/accountInfo.js';
import RecruitModule from './modules/recruit.js';
import BuildingModule from './modules/building.js';
import ResearchModule from './modules/research.js';
import NotificationsModule from './modules/notifications.js';
import IncomingAttacksModule from './modules/incomingAttacks.js';
import SupportModule from './modules/support.js';
import logger from './logger.js';

class Automator {
  constructor() {
    this.db = new DatabaseManager();
    this.browserManager = new BrowserManager();
    this.isRunning = false;
    this.checkInterval = 2 * 60 * 1000; // 2 minuty (rychlý polling, skutečné timing je per-module)
    this.accountWaitTimes = {}; // Uchovává časy pro další kontrolu každého modulu
    this.openBrowserWindows = new Set(); // Účty s otevřeným viditelným oknem

    // Defaultní intervaly pro moduly (pokud modul nevrátí vlastní waitTime)
    this.defaultIntervals = {
      research: 60 * 60 * 1000,  // 60 minut pro výzkum
      recruit: 4 * 60 * 1000,     // 4 minuty pro rekrutování
      building: 5 * 60 * 1000,    // 5 minut pro výstavbu (fallback)
      accountInfo: 20 * 60 * 1000 // 20 minut pro sběr statistik (resources, population, body)
    };
  }

  async start() {
    console.log('='.repeat(60));
    console.log('🤖 Automatizace spuštěna');
    console.log('⏱️  Interval: 2 min | Logování: ACTION (jen akce + chyby)');
    console.log('💡 Pro více detailů: logger.setLevel("INFO") nebo "DEBUG"');
    console.log('='.repeat(60));

    this.isRunning = true;

    // První běh okamžitě
    await this.processAllAccounts();

    // Pak každé 2 minuty
    this.intervalId = setInterval(async () => {
      if (this.isRunning) {
        await this.processAllAccounts();
      }
    }, this.checkInterval);
  }

  async processAllAccounts() {
    logger.cycleStart();

    const accounts = this.db.getAllActiveAccounts();

    if (accounts.length === 0) {
      logger.error('Žádné aktivní účty');
      return;
    }

    for (const account of accounts) {
      try {
        await this.processAccount(account);
      } catch (error) {
        logger.error(`Chyba při zpracování účtu`, account.username, error);
      }
    }

    logger.cycleEnd(2);
  }

  async processAccount(account) {
    logger.debug(`Kontroluji účet`, account.username);

    let browser, context;

    try {
      // Vytvoříme browser context
      ({ browser, context } = await this.browserManager.createContext(account.id));
      const page = await context.newPage();

      // Přihlásíme se
      const loginSuccess = await this.loginToGame(page, account);
      if (!loginSuccess) {
        logger.error(`Přihlášení se nezdařilo`, account.username);
        await this.browserManager.close(browser, context);
        return;
      }

      // Sbíráme statistiky účtu (resources, population, body, hradby) - s vlastním intervalem
      const infoKey = `accountInfo_${account.id}`;
      const infoWaitUntil = this.accountWaitTimes[infoKey];

      if (!infoWaitUntil || Date.now() >= infoWaitUntil) {
        const infoModule = new AccountInfoModule(page, this.db, account.id);
        await infoModule.collectInfo();
        this.accountWaitTimes[infoKey] = Date.now() + this.defaultIntervals.accountInfo;
        logger.debug(`Statistiky aktualizovány`, account.username);
      }

      // Příprava pro detekci změn v útocích
      const notificationsModule = new NotificationsModule(page, this.db, account.id);
      const lastAttackCount = notificationsModule.getLastAttackCount(); // Starý počet PŘED detekcí

      // Zjistíme příchozí útoky (nový modul)
      // Tento modul automaticky uloží last_attack_count a attacks_info do databáze
      const incomingAttacksModule = new IncomingAttacksModule(page, this.db, account.id);
      const attacksResult = await incomingAttacksModule.execute();

      // Discord notifikace - pouze pokud počet útoků VZROSTL
      if (attacksResult.success && attacksResult.count > lastAttackCount && attacksResult.count > 0) {
        logger.attack(account.username, attacksResult.count);
        await notificationsModule.sendDiscordNotification('attack', {
          count: attacksResult.count,
          attacks: attacksResult.attacks
        });
      }

      const hasCaptcha = await notificationsModule.detectCaptcha();

      // Pokud je CAPTCHA, otevřeme viditelný prohlížeč
      if (hasCaptcha) {
        logger.captcha(account.username);

        // Zavřeme headless browser
        await this.browserManager.close(browser, context);

        // Otevřeme viditelný prohlížeč POUZE pokud už není otevřený
        if (!this.openBrowserWindows.has(account.id)) {
          this.openBrowserWindows.add(account.id);
          await this.browserManager.testConnection(account.id);
          logger.info(`Viditelný prohlížeč otevřen - vyřešte CAPTCHA`, account.username);
        }
        return;
      }

      // Zpracujeme VÝZKUM (před výstavbou a rekrutováním!)
      const researchSettings = this.db.getResearchSettings(account.id);

      if (researchSettings && researchSettings.enabled) {
        const researchKey = `research_${account.id}`;
        const researchWaitUntil = this.accountWaitTimes[researchKey];

        if (!researchWaitUntil || Date.now() >= researchWaitUntil) {
          logger.debug(`Kontrola výzkumu`, account.username);

          const researchModule = new ResearchModule(page, this.db, account.id);
          const researchResult = await researchModule.autoResearch();

          if (researchResult && researchResult.waitTime) {
            this.accountWaitTimes[researchKey] = Date.now() + researchResult.waitTime;
          } else {
            this.accountWaitTimes[researchKey] = Date.now() + this.defaultIntervals.research;
          }
        }
      }

      // Zpracujeme VÝSTAVBU
      const buildingSettings = this.db.getBuildingSettings(account.id);

      if (buildingSettings && buildingSettings.enabled) {
        // Zkontrolujeme, zda už není čas na výstavbu
        const buildingKey = `building_${account.id}`;
        const buildingWaitUntil = this.accountWaitTimes[buildingKey];

        if (!buildingWaitUntil || Date.now() >= buildingWaitUntil) {
          logger.debug(`Kontrola výstavby`, account.username);

          const buildingModule = new BuildingModule(page, this.db, account.id);
          const buildResult = await buildingModule.startBuilding(buildingSettings.template);

          if (buildResult && buildResult.waitTime) {
            this.accountWaitTimes[buildingKey] = Date.now() + buildResult.waitTime;
          } else {
            this.accountWaitTimes[buildingKey] = Date.now() + this.defaultIntervals.building;
          }
        }
      }

      // Zpracujeme REKRUTOVÁNÍ
      const recruitSettings = this.db.getRecruitSettings(account.id);

      if (recruitSettings && recruitSettings.enabled) {
        // Zkontrolujeme, zda už není čas na rekrutování
        const recruitKey = `recruit_${account.id}`;
        const recruitWaitUntil = this.accountWaitTimes[recruitKey];

        if (!recruitWaitUntil || Date.now() >= recruitWaitUntil) {
          logger.debug(`Kontrola rekrutování`, account.username);

          // Nejdřív získáme aktuální stav jednotek (pomocí vylepšeného support modulu)
          const supportModule = new SupportModule(page, this.db, account.id);
          await supportModule.execute();

          const recruitModule = new RecruitModule(page, this.db, account.id);

          const recruitResult = await recruitModule.startRecruiting(recruitSettings.template);

          if (recruitResult && recruitResult.waitTime) {
            this.accountWaitTimes[recruitKey] = Date.now() + recruitResult.waitTime;
          } else {
            this.accountWaitTimes[recruitKey] = Date.now() + this.defaultIntervals.recruit;
          }
        }
      }

      logger.debug(`Účet zpracován`, account.username);

      // Odstraníme z otevřených oken (pokud tam byl)
      if (this.openBrowserWindows.has(account.id)) {
        this.openBrowserWindows.delete(account.id);
        logger.info(`CAPTCHA vyřešena`, account.username);
      }

      // Zavřeme prohlížeč
      await this.browserManager.close(browser, context);

    } catch (error) {
      logger.error(`Chyba při zpracování`, account.username, error);
      if (browser) {
        await this.browserManager.close(browser, context);
      }
    }
  }

  async loginToGame(page, account) {
    try {
      logger.debug(`Načítám hru...`, account.username);

      const domain = this.db.getDomainForAccount(account);
      const server = this.db.getServerFromWorld(account.world);

      if (account.world) {
        await page.goto(`https://${account.world}.${domain}/game.php`, {
          waitUntil: 'domcontentloaded',
          timeout: 30000
        });
      } else {
        await page.goto(`https://www.${domain}/`, {
          waitUntil: 'domcontentloaded',
          timeout: 30000
        });
      }

      // Zkontrolujeme, zda jsme přihlášeni
      const url = page.url();
      if (!url.includes(`.${domain}/game.php`)) {

        // Pokud je session expired, vybereme svět
        if (url.includes('session_expired=1') && account.world) {
          logger.debug(`Session vypršela - vybírám svět`, account.username);

          const clicked = await page.evaluate((world) => {
            const link = document.querySelector(`a.world-select[href="/page/play/${world}"]`);
            if (link) {
              link.click();
              return true;
            }
            return false;
          }, account.world);

          if (clicked) {
            await page.waitForTimeout(5000);
            await this.browserManager.saveCookies(context, account.id);
            logger.info(`Svět vybrán`, account.username);
            return true;
          } else {
            logger.error(`Nepodařilo se vybrat svět`, account.username);
            return false;
          }
        }

        logger.error(`Není přihlášen`, account.username);
        return false;
      }

      logger.debug(`Přihlášen`, account.username);
      return true;

    } catch (error) {
      logger.error(`Chyba při přihlašování`, account.username, error);
      return false;
    }
  }

  stop() {
    logger.info('Zastavuji automatizaci...');
    this.isRunning = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
    this.db.close();
    logger.info('Automatizace zastavena');
  }
}

// Spuštění
const automator = new Automator();
automator.start();

// Graceful shutdown
process.on('SIGINT', () => {
  automator.stop();
  process.exit(0);
});
