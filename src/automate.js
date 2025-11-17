import DatabaseManager from './database.js';
import BrowserManager from './browserManager.js';
import AccountInfoModule from './modules/accountInfo.js';
import RecruitModule from './modules/recruit.js';
import BuildingModule from './modules/building.js';
import ResearchModule from './modules/research.js'; 

class Automator {
  constructor() {
    this.db = new DatabaseManager();
    this.browserManager = new BrowserManager();
    this.isRunning = false;
    this.checkInterval = 2 * 60 * 1000; // 2 minuty
    this.accountWaitTimes = {}; // Uchovává časy pro další kontrolu každého modulu
  }

  async start() {
    console.log('='.repeat(60));
    console.log('🤖 Spouštím automatizaci');
    console.log('⏱️  Kontrola každé 2 minuty');
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
    console.log('\n' + '='.repeat(60));
    console.log(`🔄 Nový cyklus: ${new Date().toLocaleString('cs-CZ')}`);
    console.log('='.repeat(60));

    const accounts = this.db.getAllActiveAccounts();

    if (accounts.length === 0) {
      console.log('❌ Žádné aktivní účty');
      return;
    }

    for (const account of accounts) {
      try {
        await this.processAccount(account);
      } catch (error) {
        console.error(`❌ Chyba při zpracování účtu ${account.username}:`, error.message);
      }
    }

    console.log('\n✅ Cyklus dokončen');
    console.log(`⏰ Další kontrola za 2 minuty...\n`);
  }

  async processAccount(account) {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`📝 Zpracovávám účet: ${account.username} (ID: ${account.id})`);

    let browser, context;

    try {
      // Vytvoříme browser context
      ({ browser, context } = await this.browserManager.createContext(account.id));
      const page = await context.newPage();

      // Přihlásíme se
      const loginSuccess = await this.loginToGame(page, account);
      if (!loginSuccess) {
        console.log(`❌ Přihlášení se nezdařilo`);
        await this.browserManager.close(browser, context);
        return;
      }

      // Aktualizujeme statistiky
      const infoModule = new AccountInfoModule(page, this.db, account.id);
      await infoModule.collectInfo();

      // Získáme informace o jednotkách
      const recruitModule = new RecruitModule(page, this.db, account.id);
      await recruitModule.collectUnitsInfo();
	  
	  // Zpracujeme VÝZKUM (před výstavbou a rekrutováním!)
		const researchSettings = this.db.getResearchSettings(account.id);

		if (researchSettings && researchSettings.enabled) {
		  const researchKey = `research_${account.id}`;
		  const researchWaitUntil = this.accountWaitTimes[researchKey];

		  if (!researchWaitUntil || Date.now() >= researchWaitUntil) {
			console.log(`🔬 Výzkum zapnut - šablona: ${researchSettings.template}`);
			
			const researchModule = new ResearchModule(page, this.db, account.id);
			const researchResult = await researchModule.autoResearch();

			if (researchResult && researchResult.waitTime) {
			  this.accountWaitTimes[researchKey] = Date.now() + researchResult.waitTime;
			  console.log(`⏰ Výzkum: Další kontrola za ${Math.ceil(researchResult.waitTime / 60000)} minut`);
			} else {
			  this.accountWaitTimes[researchKey] = Date.now() + this.checkInterval;
			}
		  } else {
			const remainingMinutes = Math.ceil((researchWaitUntil - Date.now()) / 60000);
			console.log(`⏭️  Výzkum: Přeskakuji (další kontrola za ${remainingMinutes} minut)`);
		  }
		} else {
		  console.log(`⏸️  Výzkum vypnut`);
		}

      // Zpracujeme VÝSTAVBU
      const buildingSettings = this.db.getBuildingSettings(account.id);

      if (buildingSettings && buildingSettings.enabled) {
        // Zkontrolujeme, zda už není čas na výstavbu
        const buildingKey = `building_${account.id}`;
        const buildingWaitUntil = this.accountWaitTimes[buildingKey];

        if (!buildingWaitUntil || Date.now() >= buildingWaitUntil) {
          console.log(`🏗️  Výstavba zapnuta - šablona: ${buildingSettings.template}`);
          
          const buildingModule = new BuildingModule(page, this.db, account.id);
          const buildResult = await buildingModule.startBuilding(buildingSettings.template);

          if (buildResult && buildResult.waitTime) {
            this.accountWaitTimes[buildingKey] = Date.now() + buildResult.waitTime;
            console.log(`⏰ Výstavba: Další kontrola za ${Math.ceil(buildResult.waitTime / 60000)} minut`);
          } else {
            this.accountWaitTimes[buildingKey] = Date.now() + this.checkInterval;
          }
        } else {
          const remainingMinutes = Math.ceil((buildingWaitUntil - Date.now()) / 60000);
          console.log(`⏭️  Výstavba: Přeskakuji (další kontrola za ${remainingMinutes} minut)`);
        }
      } else {
        console.log(`⏸️  Výstavba vypnuta`);
      }

      // Zpracujeme REKRUTOVÁNÍ
      const recruitSettings = this.db.getRecruitSettings(account.id);

      if (recruitSettings && recruitSettings.enabled) {
        // Zkontrolujeme, zda už není čas na rekrutování
        const recruitKey = `recruit_${account.id}`;
        const recruitWaitUntil = this.accountWaitTimes[recruitKey];

        if (!recruitWaitUntil || Date.now() >= recruitWaitUntil) {
          console.log(`🎯 Rekrutování zapnuto - šablona: ${recruitSettings.template}`);
          
          const recruitResult = await recruitModule.startRecruiting(recruitSettings.template);

          if (recruitResult && recruitResult.waitTime) {
            this.accountWaitTimes[recruitKey] = Date.now() + recruitResult.waitTime;
            console.log(`⏰ Rekrutování: Další kontrola za ${Math.ceil(recruitResult.waitTime / 60000)} minut`);
          } else {
            this.accountWaitTimes[recruitKey] = Date.now() + this.checkInterval;
          }
        } else {
          const remainingMinutes = Math.ceil((recruitWaitUntil - Date.now()) / 60000);
          console.log(`⏭️  Rekrutování: Přeskakuji (další kontrola za ${remainingMinutes} minut)`);
        }
      } else {
        console.log(`⏸️  Rekrutování vypnuto`);
      }

      console.log(`✅ Účet ${account.username} zpracován`);

      // Zavřeme prohlížeč
      await this.browserManager.close(browser, context);
      console.log('✅ Prohlížeč uzavřen');

    } catch (error) {
      console.error(`❌ Chyba:`, error.message);
      if (browser) {
        await this.browserManager.close(browser, context);
      }
    }
  }

  async loginToGame(page, account) {
    try {
      console.log(`🌐 Načítám hru...`);

      const domain = this.db.getDomainForAccount(account);
      const server = this.db.getServerFromWorld(account.world);

      if (account.world) {
        console.log(`🌍 Jdu na svět: ${account.world} (Server: ${server}, ${domain})`);
        await page.goto(`https://${account.world}.${domain}/game.php`, {
          waitUntil: 'domcontentloaded',
          timeout: 30000
        });
      } else {
        console.log(`🌍 Jdu na hlavní stránku (${domain})`);
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
          console.log(`⚠️  Session vypršela - vybírám svět...`);

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
            console.log(`✅ Svět vybrán`);
            return true;
          } else {
            console.log(`❌ Nepodařilo se vybrat svět`);
            return false;
          }
        }

        console.log(`❌ Není přihlášen`);
        return false;
      }

      console.log(`✅ Přihlášen`);
      return true;

    } catch (error) {
      console.error(`❌ Chyba při přihlašování:`, error.message);
      return false;
    }
  }

  stop() {
    console.log('\n🛑 Zastavuji automatizaci...');
    this.isRunning = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
    this.db.close();
    console.log('✅ Automatizace zastavena');
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