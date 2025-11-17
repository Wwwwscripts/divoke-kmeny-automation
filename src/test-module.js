import DatabaseManager from './database.js';
import BrowserManager from './browserManager.js';
import AccountInfoModule from './modules/accountInfo.js';
import RecruitModule from './modules/recruit.js';

async function testAccountInfo() {
  console.log('='.repeat(60));
  console.log('🧪 Test modulu pro získání informací o účtu');
  console.log('='.repeat(60));

  const db = new DatabaseManager();
  const browserManager = new BrowserManager();

  // Získáme první aktivní účet
  const accounts = db.getAllActiveAccounts();
  
  if (accounts.length === 0) {
    console.error('❌ Žádný účet v databázi! Nejprve spusť npm start');
    db.close();
    return;
  }

  const account = accounts[0];
  console.log(`\n📝 Testuji účet: ${account.username} (ID: ${account.id})`);

  let browser, context;

  try {
    // Vytvoříme browser context
    ({ browser, context } = await browserManager.createContext(account.id));
    const page = await context.newPage();

    // Přejdeme do hry
    console.log('\n🌐 Načítám hru...');
    const domain = db.getDomainForAccount(account);
    const server = db.getServerFromWorld(account.world);

    if (account.world) {
      console.log(`🌍 Jdu rovnou na svět: ${account.world} (Server: ${server}, ${domain})`);
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

    // Pokud nejsme přihlášeni nebo je session expired
    const url = page.url();
    if (!url.includes(`/game.php`)) {
      
      // Zkontrolujeme, jestli je session_expired
      if (url.includes('session_expired=1') && account.world) {
        console.log('\n⚠️  Session vypršela - automaticky vybírám svět...');
        
        try {
          // Najdeme odkaz na správný svět a klikneme pomocí JavaScript
          console.log(`🌍 Klikám na svět: ${account.world}`);
          
          const clicked = await page.evaluate((world) => {
            const link = document.querySelector(`a.world-select[href="/page/play/${world}"]`);
            if (link) {
              link.click();
              return true;
            }
            return false;
          }, account.world);

          if (clicked) {
            await page.waitForTimeout(5000); // Počkáme 5 sekund na načtení
            
            // Uložíme cookies
            await browserManager.saveCookies(context, account.id);
            console.log('✅ Svět vybrán! Cookies uloženy.');
          } else {
            console.error('❌ Nepodařilo se najít odkaz na svět');
            console.log('📝 Prosím, vyber svět ručně v prohlížeči...');
            console.log('⏳ Čekám 60 sekund...');
            await page.waitForTimeout(60000);
          }
        } catch (error) {
          console.error('❌ Chyba při výběru světa:', error.message);
          console.log('📝 Prosím, vyber svět ručně v prohlížeči...');
          console.log('⏳ Čekám 60 sekund...');
          await page.waitForTimeout(60000);
        }
      } else {
        console.log('\n⚠️  VAROVÁNÍ: Nejsi přihlášen!');
        console.log('📝 Prosím, přihlas se ručně v prohlížeči...');
        console.log('⏳ Čekám 180 sekund na přihlášení...');
        
        await page.waitForTimeout(180000);

        // Zkusíme znovu
        const newUrl = page.url();
        if (!newUrl.includes('/game.php')) {
          console.error('❌ Stále nejsi přihlášen. Ukončuji test.');
          return;
        }
        
        // Uložíme cookies po přihlášení
        await browserManager.saveCookies(context, account.id);
        console.log('✅ Přihlášení úspěšné! Cookies uloženy.');
      }
    }

    // Spustíme modul pro sběr informací
    const infoModule = new AccountInfoModule(page, db, account.id);
    const info = await infoModule.collectAllInfo();

    // Získáme informace o jednotkách
    const recruitModule = new RecruitModule(page, db, account.id);
    const unitsData = await recruitModule.collectUnitsInfo();

    if (info) {
      console.log('\n' + '='.repeat(60));
      console.log('📊 KOMPLETNÍ PŘEHLED ÚČTU');
      console.log('='.repeat(60));
      console.log(`🌍 Svět: ${info.world || 'Neznámý'}`);
      console.log(`👑 Premium: ${info.premium ? 'Ano' : 'Ne'}`);
      console.log(`🏰 Hradby: Úroveň ${info.wallLevel || 0}`);
      console.log(`📦 Suroviny:`);
      console.log(`   🪵 Dřevo: ${info.resources.wood.toLocaleString('cs-CZ')}`);
      console.log(`   🧱 Hlína: ${info.resources.clay.toLocaleString('cs-CZ')}`);
      console.log(`   ⛏️  Železo: ${info.resources.iron.toLocaleString('cs-CZ')}`);
      console.log(`👥 Populace: ${info.population.current}/${info.population.max}`);
      console.log(`⭐ Body: ${info.points.toLocaleString('cs-CZ')}`);
      console.log('='.repeat(60));
    }

    // Necháme prohlížeč otevřený chvíli pro kontrolu
    console.log('\n⏳ Prohlížeč zůstane otevřený 120 sekund...');
    await page.waitForTimeout(120000);

  } catch (error) {
    console.error('❌ Chyba při testu:', error.message);
    console.error(error.stack);
  } finally {
    await browserManager.close(browser, context);
    db.close();
  }

  console.log('\n✅ Test dokončen!');
}

testAccountInfo().catch(console.error);