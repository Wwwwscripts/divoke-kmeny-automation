import express from 'express';
import { chromium } from 'playwright';
import { writeFileSync, existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import DatabaseManager from './database.js';
import BrowserManager from './browserManager.js';
import SharedBrowserPool from './sharedBrowserPool.js';
import { generateFingerprint, createStealthScript } from './utils/fingerprint.js';
import { setupWebSocketInterceptor } from './utils/webSocketBehavior.js';

const app = express();
const db = new DatabaseManager();
const browserManager = new BrowserManager(db);
const browserPool = new SharedBrowserPool(db);

// Mapa aktivních visible browserů (accountId => { browser, context, page })
const visibleBrowsers = new Map();

app.use(express.json());
app.use(express.static('public'));

// ============ ZÁKLADNÍ ENDPOINTY ============
app.get('/api/accounts', (req, res) => {
  try {
    const accounts = db.getAllAccountsWithStats();
    res.json(accounts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/accounts/add', async (req, res) => {
  try {
    const { username, password, proxy, world } = req.body;

    console.log('📝 Přidávám účet:', { username, hasPassword: !!password, proxy: proxy || 'žádná', world: world || 'neurčen' });

    if (!username || !password) {
      console.error('❌ Chybí username nebo heslo');
      return res.status(400).json({
        success: false,
        error: 'Username a heslo jsou povinné'
      });
    }

    // Zkontroluj jestli účet už existuje (pro lepší chybovou hlášku)
    const existingAccount = db.getAccountByUsername(username);
    if (existingAccount) {
      console.error(`❌ Účet ${username} již existuje (ID: ${existingAccount.id})`);
      return res.status(400).json({
        success: false,
        error: `Účet '${username}' již existuje`
      });
    }

    const accountId = db.addAccount(
      username,
      password,
      proxy || null,
      world || null
    );

    if (accountId) {
      console.log(`✅ Účet ${username} úspěšně přidán (ID: ${accountId})`);
      res.json({
        success: true,
        accountId,
        message: `Účet ${username} přidán`
      });
    } else {
      console.error(`❌ Nepodařilo se přidat účet ${username} (addAccount vrátil null)`);
      res.status(400).json({
        success: false,
        error: 'Nepodařilo se přidat účet - zkontrolujte logy serveru'
      });
    }
  } catch (error) {
    console.error('❌ Chyba při přidávání účtu:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.delete('/api/accounts/:id', async (req, res) => {
  try {
    const accountId = parseInt(req.params.id);
    db.deactivateAccount(accountId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Pozastavit/obnovit účet
app.put('/api/accounts/:id/pause', async (req, res) => {
  try {
    const accountId = parseInt(req.params.id);
    const { paused } = req.body;

    db.updateAccountPause(accountId, paused);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 🆕 Aktualizovat poznámku k pausnutému účtu
app.put('/api/accounts/:id/pause-note', async (req, res) => {
  try {
    const accountId = parseInt(req.params.id);
    const { note } = req.body;

    db.updatePauseNote(accountId, note);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/accounts/:id/recruit', async (req, res) => {
  try {
    const accountId = parseInt(req.params.id);
    const { enabled, template } = req.body;
    
    db.updateRecruitSettings(accountId, {
      recruitEnabled: enabled,
      recruitTemplate: template
    });
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/accounts/:id/building', async (req, res) => {
  try {
    const accountId = parseInt(req.params.id);
    const { enabled, template } = req.body;
    
    db.updateBuildingSettings(accountId, {
      buildingEnabled: enabled,
      buildingTemplate: template
    });
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 🆕 RESEARCH - Aktualizovat nastavení výzkumu
app.put('/api/accounts/:id/research', async (req, res) => {
  try {
    const accountId = parseInt(req.params.id);
    const { enabled, template } = req.body;

    db.updateResearchSettings(accountId, {
      researchEnabled: enabled,
      researchTemplate: template
    });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 🆕 SCAVENGE - Aktualizovat nastavení sběru
app.put('/api/accounts/:id/scavenge', async (req, res) => {
  try {
    const accountId = parseInt(req.params.id);
    const { enabled } = req.body;

    db.updateScavengeSettings(accountId, {
      scavengeEnabled: enabled
    });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/accounts/:id/open-browser', async (req, res) => {
  try {
    const accountId = parseInt(req.params.id);
    const account = db.getAccount(accountId);
    const { url } = req.body || {}; // Získej URL z body (pro navigaci na specifickou stránku)

    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }

    // Vyčisti odpojené browsery
    for (const [id, browserInfo] of visibleBrowsers.entries()) {
      const isConnected = browserInfo.browser && browserInfo.browser.isConnected();
      const pageValid = browserInfo.page && !browserInfo.page.isClosed();

      if (!isConnected || !pageValid) {
        visibleBrowsers.delete(id);
        console.log(`🧹 [Control Panel] Vyčištěn odpojený browser pro účet ${id} (connected: ${isConnected}, pageValid: ${pageValid})`);
      }
    }

    // Zkontroluj zda už není browser aktivní
    const existingBrowser = visibleBrowsers.get(accountId);
    if (existingBrowser && existingBrowser.browser && existingBrowser.browser.isConnected() &&
        existingBrowser.page && !existingBrowser.page.isClosed()) {
      // Pokud je browser už otevřený a máme URL, naviguj na ni
      if (url) {
        try {
          const domain = db.getDomainForAccount(account);
          const fullUrl = `https://${account.world}.${domain}${url}`;
          console.log(`🔄 [Control Panel] Navigace na ${fullUrl}`);
          await existingBrowser.page.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

          return res.json({
            success: true,
            message: 'Browser is already open - navigated to URL'
          });
        } catch (error) {
          console.log(`⚠️  [Control Panel] Chyba při navigaci (browser pravděpodobně zavřen): ${error.message}`);
          // Browser byl zavřen - smaž z mapy a otevři nový níže
          visibleBrowsers.delete(accountId);
        }
      } else {
        return res.json({
          success: true,
          message: 'Browser is already open'
        });
      }
    }

    // Otevři browser přímo
    console.log(`🖥️  [Control Panel] Otevírám visible browser pro účet ${accountId}`);

    const browserInfo = await browserManager.testConnection(accountId, false, url); // false = manuální kontrola, url = navigace

    if (browserInfo) {
      const { browser } = browserInfo;
      visibleBrowsers.set(accountId, browserInfo);

      // Sleduj zavření browseru
      browser.on('disconnected', () => {
        visibleBrowsers.delete(accountId);
        console.log(`🔒 [Control Panel] Browser pro účet ${accountId} zavřen`);
      });

      res.json({
        success: true,
        message: 'Browser opened successfully'
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Failed to open browser'
      });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Endpoint pro smazání dokončeného útoku
app.post('/api/accounts/:id/delete-attack', async (req, res) => {
  try {
    const accountId = parseInt(req.params.id);
    const { timestamp } = req.body;

    if (!timestamp) {
      return res.status(400).json({ error: 'Missing timestamp' });
    }

    const account = db.getAccount(accountId);
    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }

    // Načteme aktuální útoky
    let attacks = [];
    if (account.attacks_info) {
      try {
        attacks = JSON.parse(account.attacks_info);
      } catch (e) {
        attacks = [];
      }
    }

    // Odfiltrujeme útok s daným timestampem
    const filteredAttacks = attacks.filter(attack => attack.arrival_timestamp !== timestamp);

    // Aktualizujeme databázi
    const data = db._loadAccounts();
    const acc = data.accounts.find(a => a.id === accountId);
    if (acc) {
      acc.attacks_info = JSON.stringify(filteredAttacks);
      acc.last_attack_count = filteredAttacks.length;
      db._saveAccounts(data);
    }

    res.json({ success: true, removed: attacks.length - filteredAttacks.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Endpoint pro reset dobytí vesnice
app.post('/api/accounts/:id/reset-conquered', async (req, res) => {
  try {
    const accountId = parseInt(req.params.id);
    const account = db.getAccount(accountId);

    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }

    // Resetujeme příznaky dobytí vesnice
    db.updateAccountInfo(accountId, {
      village_conquered: false,
      village_conquered_at: null
    });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Endpoint pro získání účtů pod útokem
app.get('/api/accounts/under-attack', (req, res) => {
  try {
    const allAccounts = db.getAllAccountsWithStats();

    // Filtrujeme pouze účty které mají příchozí útoky (last_attack_count > 0)
    const accountsUnderAttack = allAccounts.filter(acc => {
      return acc.last_attack_count && acc.last_attack_count > 0;
    }).map(acc => ({
      ...acc,
      attack_count: acc.last_attack_count
    }));

    res.json({
      success: true,
      accounts: accountsUnderAttack,
      total: accountsUnderAttack.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============ NASTAVENÍ SVĚTŮ ============

// Získat nastavení světa
app.get('/api/world-settings/:world', (req, res) => {
  try {
    const world = req.params.world;
    const settings = db.getWorldSettings(world);
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Získat všechna nastavení světů
app.get('/api/world-settings', (req, res) => {
  try {
    const settings = db.getAllWorldSettings();
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Uložit/aktualizovat nastavení světa
app.put('/api/world-settings/:world', (req, res) => {
  try {
    const world = req.params.world;
    const { speed, unitSpeedModifier, dailyRewardsEnabled, scavengeEnabled } = req.body;

    if (!speed || speed <= 0) {
      return res.status(400).json({ error: 'Neplatná rychlost světa' });
    }

    if (unitSpeedModifier !== undefined && unitSpeedModifier <= 0) {
      return res.status(400).json({ error: 'Neplatný modifikátor rychlosti jednotek' });
    }

    db.saveWorldSettings(world, {
      speed,
      unitSpeedModifier: unitSpeedModifier || 1,
      dailyRewardsEnabled: dailyRewardsEnabled || false,
      scavengeEnabled: scavengeEnabled || false
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Smazat nastavení světa
app.delete('/api/world-settings/:world', (req, res) => {
  try {
    const world = req.params.world;
    db.deleteWorldSettings(world);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ PODPORA ============

// Otevřít ruční odeslání podpory (vyplní formulář v browseru)
app.post('/api/support/open-manual', async (req, res) => {
  try {
    const { accountId, unitTypes, targetX, targetY } = req.body;

    if (!accountId || !unitTypes || !targetX || !targetY) {
      return res.status(400).json({ error: 'Chybí povinné parametry' });
    }

    // Získat účet z databáze
    const account = db.getAccount(accountId);
    if (!account) {
      return res.status(404).json({ error: 'Účet nenalezen' });
    }

    // Automaticky získat nebo otevřít browser (VIDITELNÝ pokud není aktivní)
    let browserData = getBrowser(accountId);

    // Ověř že browser je opravdu ještě připojený
    if (browserData) {
      const isConnected = browserData.browser && browserData.browser.isConnected();
      if (!isConnected) {
        console.log(`🔌 Browser pro účet ${accountId} již není aktivní - otevírám nový`);
        removeBrowser(accountId);
        browserData = null;
      }
    }

    if (!browserData) {
      // Otevřít VIDITELNÝ browser pro ruční odeslání
      console.log(`🔧 Otevírám VIDITELNÝ browser pro ruční odeslání (účet ${accountId})`);

      const domain = db.getDomainForAccount(account);
      const locale = domain.includes('divoke-kmene.sk') ? 'sk-SK' : 'cs-CZ';
      const timezoneId = domain.includes('divoke-kmene.sk') ? 'Europe/Bratislava' : 'Europe/Prague';

      const browser = await chromium.launch({
        headless: false,  // VIDITELNÝ pro ruční kontrolu
        args: [
          '--disable-blink-features=AutomationControlled',
          '--disable-features=IsolateOrigins,site-per-process'
        ]
      });

      // Získej nebo vygeneruj unikátní fingerprint pro tento účet
      let fingerprint = db.getFingerprint(account.id);
      if (!fingerprint) {
        fingerprint = generateFingerprint();
        db.saveFingerprint(account.id, fingerprint);
        console.log(`[${account.world}] Vygenerován nový fingerprint pro účet ID ${account.id}`);
      }

      const contextOptions = {
        viewport: fingerprint.viewport,
        userAgent: fingerprint.userAgent,
        locale,
        timezoneId,
        ignoreHTTPSErrors: true,
      };

      if (account.proxy) {
        const proxy = browserManager.parseProxy(account.proxy);
        contextOptions.proxy = proxy;
      }

      const context = await browser.newContext(contextOptions);

      // Přidej stealth script s unikátním fingerprintem
      const stealthScript = createStealthScript(fingerprint);
      await context.addInitScript(stealthScript);

      // Zkontrolovat a načíst cookies
      if (!account.cookies || account.cookies === 'null') {
        await browser.close();
        return res.status(400).json({
          error: 'Účet nemá uložené cookies. Nejprve se přihlaste přes "Otevřít browser" v hlavním menu.'
        });
      }

      const cookies = JSON.parse(account.cookies);
      await context.addCookies(cookies);
      // Cookies načteny - tichý log

      const page = await context.newPage();

      // Setup WebSocket interceptor pro human-like timing
      await setupWebSocketInterceptor(page, {
        autoHumanize: true,
        minDelay: 300,
        maxDelay: 1200,
        enableIdleBehavior: false,
        logActions: false
      });

      // Jít přímo na game.php s cookies
      await page.goto(`https://${account.world}.${domain}/game.php`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      // Počkat chvíli na načtení
      await page.waitForTimeout(1500);

      // Zkontrolovat jestli jsme přihlášení (detekovat #menu_row)
      const isLoggedIn = await page.evaluate(() => {
        return document.querySelector('#menu_row') !== null;
      });

      if (!isLoggedIn) {
        await browser.close();
        return res.status(400).json({
          error: 'Cookies jsou neplatné nebo vypršely. Přihlaste se znovu přes "Otevřít browser" v hlavním menu.'
        });
      }

      console.log(`✅ Účet ${account.username} je přihlášen`);

      // Ulož browser do mapy
      browserData = { browser, context, page, account };
      setBrowser(accountId, browserData);

      // Při zavření browseru ho odstraň z mapy
      browser.on('disconnected', () => {
        console.log(`🔌 Viditelný browser pro účet ${accountId} (${account.username}) byl zavřen`);
        removeBrowser(accountId);
      });
    }

    // Dynamicky importovat SupportSender
    const { default: SupportSender } = await import('./modules/supportSender.js');
    const supportSender = new SupportSender(browserData.page, db, accountId);

    // Otevřít a vyplnit formulář (ale NEodeslat)
    await supportSender.openManualSupport(
      unitTypes,
      parseInt(targetX),
      parseInt(targetY)
    );

    res.json({ success: true, message: 'Formulář vyplněn' });
  } catch (error) {
    console.error('Error in /api/support/open-manual:', error);
    res.status(500).json({ error: error.message });
  }
});

// Odeslat podporu do vesnice
app.post('/api/support/send', async (req, res) => {
  const startTime = Date.now();
  let attempt = 0;
  const maxAttempts = 2; // Max 2 pokusy

  try {
    const { accountId, unitTypes, targetX, targetY } = req.body;

    if (!accountId || !unitTypes || !targetX || !targetY) {
      return res.status(400).json({ error: 'Chybí povinné parametry' });
    }

    const account = db.getAccount(accountId);
    if (!account) {
      return res.status(404).json({ error: 'Účet nenalezen' });
    }

    // Kontrola cookies před pokusem
    if (!account.cookies || account.cookies === 'null') {
      return res.status(400).json({
        error: `Účet ${account.username} nemá uložené cookies`,
        details: 'Přihlaste se přes "Otevřít browser" v hlavním menu',
        accountId,
        username: account.username
      });
    }

    let lastError = null;

    // Retry loop
    while (attempt < maxAttempts) {
      attempt++;
      let context = null;
      let browserKey = null;

      try {
        console.log(`[${account.username}] Pokus ${attempt}/${maxAttempts} - odesílám podporu`);

        // Použij sdílený browser pool (jako hlavní moduly)
        ({ context, browserKey } = await browserPool.createContext(accountId));
        const page = await context.newPage();

        // Naviguj na hru
        const domain = db.getDomainForAccount(account);
        await page.goto(`https://${account.world}.${domain}/game.php`, {
          waitUntil: 'domcontentloaded',
          timeout: 30000
        });
        await page.waitForTimeout(1500);

        // Zkontroluj přihlášení
        const isLoggedIn = await page.evaluate(() => {
          return document.querySelector('#menu_row') !== null;
        });

        if (!isLoggedIn) {
          await browserPool.closeContext(context, browserKey);
          throw new Error('Cookies jsou neplatné nebo vypršely');
        }

        // Dynamicky importovat SupportSender
        const { default: SupportSender } = await import('./modules/supportSender.js');
        const supportSender = new SupportSender(page, db, accountId);

        // Odeslat podporu (více jednotek najednou)
        const result = await supportSender.sendMultipleUnits(
          unitTypes,  // Pole jednotek ['knight', 'spear', 'sword', ...]
          parseInt(targetX),
          parseInt(targetY)
        );

        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`✅ [${account.username}] Podpora odeslána za ${duration}s (pokus ${attempt}/${maxAttempts})`);

        // Zavřít context (browser zůstane sdílený)
        await browserPool.closeContext(context, browserKey);

        return res.json({
          success: true,
          result,
          duration: parseFloat(duration),
          attempt
        });

      } catch (error) {
        lastError = error;
        console.error(`❌ [${account.username}] Pokus ${attempt}/${maxAttempts} selhal:`, error.message);

        // Zavřít context i při chybě
        if (context && browserKey) {
          await browserPool.closeContext(context, browserKey);
        }

        // Pokud je to chyba cookies, nepokračuj v retry
        if (error.message.includes('cookies') || error.message.includes('Cookie')) {
          break;
        }

        // Pokud to není poslední pokus, počkej před dalším pokusem
        if (attempt < maxAttempts) {
          const waitTime = attempt * 1000; // 1s, 2s, ...
          console.log(`⏳ [${account.username}] Čekám ${waitTime}ms před dalším pokusem...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      }
    }

    // Všechny pokusy selhaly
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.error(`❌ [${account.username}] Všechny pokusy selhaly po ${duration}s`);

    res.status(500).json({
      error: lastError.message,
      details: `Selhalo po ${attempt} pokusech`,
      accountId,
      username: account.username,
      duration: parseFloat(duration),
      attempts: attempt
    });

  } catch (error) {
    console.error('Error in /api/support/send:', error);
    res.status(500).json({ error: error.message, stack: error.stack });
  }
});

// Endpoint pro hromadnou kontrolu jednotek (pro kalkulátor podpor)
app.post('/api/units/refresh', async (req, res) => {
  try {
    const { accountIds } = req.body;

    if (!accountIds || !Array.isArray(accountIds) || accountIds.length === 0) {
      return res.status(400).json({ error: 'Chybí seznam účtů (accountIds)' });
    }

    console.log(`🔄 Začínám kontrolu jednotek pro ${accountIds.length} účtů...`);

    const results = {
      total: accountIds.length,
      processed: 0,
      success: 0,
      failed: 0,
      accounts: []
    };

    // Zpracuj po skupinách 2 účtů
    const batchSize = 2;
    for (let i = 0; i < accountIds.length; i += batchSize) {
      const batch = accountIds.slice(i, i + batchSize);

      console.log(`   Skupina ${Math.floor(i / batchSize) + 1}/${Math.ceil(accountIds.length / batchSize)}: Kontroluji ${batch.length} účtů...`);

      // Zpracuj skupinu paralelně
      const batchPromises = batch.map(async (accountId) => {
        let context = null;
        let browserKey = null;
        try {
          const account = db.getAccount(accountId);
          if (!account) {
            return { accountId, success: false, error: 'Účet nenalezen' };
          }

          // Použij sdílený browser pool (jako hlavní moduly)
          ({ context, browserKey } = await browserPool.createContext(accountId));
          const page = await context.newPage();

          // Naviguj na hru
          const domain = db.getDomainForAccount(account);
          await page.goto(`https://${account.world}.${domain}/game.php`, {
            waitUntil: 'domcontentloaded',
            timeout: 30000
          });
          await page.waitForTimeout(1500);

          // Dynamicky importovat SupportModule
          const { default: SupportModule } = await import('./modules/support.js');
          const supportModule = new SupportModule(page, db, accountId);

          // Získat jednotky
          await supportModule.getAllUnitsInfo();

          // Zavřít context (browser zůstane sdílený)
          await browserPool.closeContext(context, browserKey);

          return {
            accountId,
            username: account.username,
            success: true
          };

        } catch (error) {
          console.error(`   ❌ [Účet ${accountId}] Chyba: ${error.message}`);

          // Zavřít context i při chybě
          if (context && browserKey) {
            await browserPool.closeContext(context, browserKey);
          }

          return {
            accountId,
            success: false,
            error: error.message
          };
        }
      });

      // Počkej na dokončení celé skupiny
      const batchResults = await Promise.allSettled(batchPromises);

      // Zpracuj výsledky
      batchResults.forEach((result) => {
        results.processed++;

        if (result.status === 'fulfilled') {
          const accountResult = result.value;
          results.accounts.push(accountResult);

          if (accountResult.success) {
            results.success++;
          } else {
            results.failed++;
          }
        } else {
          results.failed++;
          results.accounts.push({
            success: false,
            error: result.reason?.message || 'Neznámá chyba'
          });
        }
      });

      console.log(`   ✓ Skupina dokončena (${results.success} úspěšných, ${results.failed} chyb)`);
    }

    console.log(`✅ Kontrola jednotek dokončena: ${results.success}/${results.total} úspěšných`);

    res.json({
      success: true,
      results
    });

  } catch (error) {
    console.error('Error in /api/units/refresh:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ ŠABLONY ============

// Získat všechny šablony pro daný typ
app.get('/api/templates/:type', (req, res) => {
  try {
    const type = req.params.type;
    const templates = db.getTemplates(type);
    res.json(templates);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Uložit/aktualizovat šablonu
app.put('/api/templates/:type/:id', (req, res) => {
  try {
    const type = req.params.type;
    const id = req.params.id;
    const template = { id, ...req.body };

    db.saveTemplate(type, template);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Smazat šablonu
app.delete('/api/templates/:type/:id', (req, res) => {
  try {
    const type = req.params.type;
    const id = req.params.id;

    db.deleteTemplate(type, id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Graceful shutdown endpoint
app.post('/api/shutdown', (req, res) => {
  try {
    const shutdownFile = join(process.cwd(), '.shutdown');

    // Vytvoř shutdown flag soubor
    writeFileSync(shutdownFile, new Date().toISOString(), 'utf8');

    console.log('🛑 Shutdown požadavek přijat z webového panelu');
    console.log(`📝 Vytvořen shutdown flag: ${shutdownFile}`);

    res.json({
      success: true,
      message: 'Shutdown zahájen - sledujte konzoli automatizace pro progress'
    });
  } catch (error) {
    console.error('❌ Chyba při vytváření shutdown flag:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🌐 Control Panel běží na http://localhost:${PORT}`);
});