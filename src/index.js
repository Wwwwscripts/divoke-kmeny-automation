import DatabaseManager from './database.js';
import BrowserManager from './browserManager.js';
import AccountInfoModule from './modules/accountInfo.js';
import RecruitModule from './modules/recruit.js';
import BuildingModule from './modules/building.js';
import ResearchModule from './modules/research.js';
import NotificationsModule from './modules/notifications.js'; 

class Automator {
  constructor() {
    this.db = new DatabaseManager();
    this.browserManager = new BrowserManager();
    this.isRunning = false;
    this.checkInterval = 2 * 60 * 1000; // 2 minuty
    this.accountWaitTimes = {}; // Uchovává časy pro další kontrolu každého modulu
    this.maxConcurrentAccounts = 25; // Maximálně 25 účtů najednou
  }

  /**
   * 🆕 Získá doménu pro daný svět (CZ nebo SK)
   */
  getWorldDomain(world) {
    if (!world) return 'divokekmeny.cz';
    
    // SK světy (sk1, sk2, sk97, atd.)
    if (world.toLowerCase().startsWith('sk')) {
      return 'divoke-kmene.sk';
    }
    
    // CZ světy (cs1, cs107, atd.)
    return 'divokekmeny.cz';
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

    console.log(`📊 Celkem účtů: ${accounts.length}`);
    console.log(`⚡ Zpracovávám po ${this.maxConcurrentAccounts} účtech najednou`);

    // Zpracuj účty po dávkách (max 25 najednou)
    for (let i = 0; i < accounts.length; i += this.maxConcurrentAccounts) {
      const batch = accounts.slice(i, i + this.maxConcurrentAccounts);
      console.log(`\n🔸 Dávka ${Math.floor(i / this.maxConcurrentAccounts) + 1}/${Math.ceil(accounts.length / this.maxConcurrentAccounts)}: Zpracovávám ${batch.length} účtů`);

      // Zpracuj všechny účty v dávce paralelně
      await Promise.all(
        batch.map(account =>
          this.processAccount(account).catch(error => {
            console.error(`❌ Chyba při zpracování účtu ${account.username}:`, error.message);
          })
        )
      );

      console.log(`✅ Dávka ${Math.floor(i / this.maxConcurrentAccounts) + 1} dokončena`);
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
        console.log(`❌ Přihlášení se nezdařilo - otevírám viditelný prohlížeč`);

        // Zavřeme headless browser
        await this.browserManager.close(browser, context);

        // Otevřeme viditelný prohlížeč pro manuální přihlášení
        await this.browserManager.testConnection(account.id);
        console.log(`🖥️  Viditelný prohlížeč otevřen - vyřešte problém ručně`);
        return;
      }

      // Aktualizujeme statistiky
      const infoModule = new AccountInfoModule(page, this.db, account.id);
      await infoModule.collectInfo();

      // Zkontrolujeme útoky a CAPTCHA
      const notificationsModule = new NotificationsModule(page, this.db, account.id);
      await notificationsModule.detectAttacks();
      const hasCaptcha = await notificationsModule.detectCaptcha();

      // Pokud je CAPTCHA, otevřeme viditelný prohlížeč
      if (hasCaptcha) {
        console.log(`⚠️  CAPTCHA detekována - otevírám viditelný prohlížeč`);

        // Zavřeme headless browser
        await this.browserManager.close(browser, context);

        // Otevřeme viditelný prohlížeč pro vyřešení CAPTCHA
        await this.browserManager.testConnection(account.id);
        console.log(`🖥️  Viditelný prohlížeč otevřen - vyřešte CAPTCHA ručně`);
        return;
      }

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
      
      if (account.world) {
        const domain = this.getWorldDomain(account.world);
        console.log(`🌍 Jdu na svět: ${account.world} (${domain})`);
        
        await page.goto(`https://${account.world}.${domain}/game.php`, { 
          waitUntil: 'domcontentloaded',
          timeout: 30000 
        });
      } else {
        await page.goto('https://www.divokekmeny.cz/', { 
          waitUntil: 'domcontentloaded',
          timeout: 30000 
        });
      }

      // Zkontrolujeme, zda jsme přihlášeni
      const url = page.url();
      const domain = this.getWorldDomain(account.world);
      
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

  async stop() {
    console.log('\n');
    console.log('='.repeat(60));
    console.log('🛑  UKONČOVÁNÍ APLIKACE');
    console.log('='.repeat(60));

    this.isRunning = false;

    if (this.intervalId) {
      clearInterval(this.intervalId);
      console.log('✅ Interval zastaven');
    }

    // Zavřít všechny prohlížeče
    try {
      await this.browserManager.closeAll();
      console.log('✅ Všechny prohlížeče zavřeny');
    } catch (error) {
      console.error('⚠️  Chyba při zavírání prohlížečů:', error.message);
    }

    // Zavřít databázi
    try {
      this.db.close();
      console.log('✅ Databáze uzavřena');
    } catch (error) {
      console.error('⚠️  Chyba při zavírání databáze:', error.message);
    }

    console.log('='.repeat(60));
    console.log('✅  APLIKACE ÚSPĚŠNĚ UKONČENA');
    console.log('='.repeat(60));
    console.log('\n');
  }
}

// Spuštění
const automator = new Automator();
automator.start();

// Graceful shutdown - Ctrl+C
process.on('SIGINT', async () => {
  console.log('\n⚠️  Zachycen Ctrl+C, ukončuji...');
  await automator.stop();
  process.exit(0);
});

// Graceful shutdown - kill
process.on('SIGTERM', async () => {
  console.log('\n⚠️  Zachycen SIGTERM, ukončuji...');
  await automator.stop();
  process.exit(0);
});