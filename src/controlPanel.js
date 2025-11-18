import express from 'express';
import { chromium } from 'playwright';
import DatabaseManager from './database.js';
import BrowserManager from './browserManager.js';

const app = express();
const db = new DatabaseManager();
const browserManager = new BrowserManager(db);

// Mapa aktivních browserů (accountId => { browser, context, page })
const activeBrowsers = new Map();

// Pomocná funkce pro získání aktivního browseru
function getBrowser(accountId) {
  return activeBrowsers.get(accountId);
}

// Pomocná funkce pro uložení browseru
function setBrowser(accountId, browserData) {
  activeBrowsers.set(accountId, browserData);
}

// Pomocná funkce pro odstranění browseru
function removeBrowser(accountId) {
  activeBrowsers.delete(accountId);
}

// Pomocná funkce pro získání nebo automatické otevření browseru (headless)
async function getOrOpenBrowser(accountId) {
  // Zkontroluj jestli už je browser aktivní
  let browserData = getBrowser(accountId);
  if (browserData) {
    return browserData;
  }

  // Pokud ne, otevři ho headless
  console.log(`🔧 Automaticky otevírám headless browser pro účet ${accountId}`);

  const account = db.getAccount(accountId);
  if (!account) {
    throw new Error(`Účet s ID ${accountId} nebyl nalezen`);
  }

  const domain = db.getDomainForAccount(account);
  const locale = domain.includes('divoke-kmene.sk') ? 'sk-SK' : 'cs-CZ';
  const timezoneId = domain.includes('divoke-kmene.sk') ? 'Europe/Bratislava' : 'Europe/Prague';

  const browser = await chromium.launch({
    headless: true,  // Headless pro automatické operace
    args: ['--disable-blink-features=AutomationControlled']
  });

  const contextOptions = {
    viewport: { width: 1280, height: 720 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    locale,
    timezoneId,
    ignoreHTTPSErrors: true,
  };

  if (account.proxy) {
    const proxy = browserManager.parseProxy(account.proxy);
    contextOptions.proxy = proxy;
  }

  const context = await browser.newContext(contextOptions);

  if (account.cookies) {
    const cookies = JSON.parse(account.cookies);
    await context.addCookies(cookies);
  }

  const page = await context.newPage();

  // Vyčisti localStorage/sessionStorage před načtením stránky
  await page.goto(`https://${account.world}.${domain}/`);
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  // Teď načti game.php
  await page.goto(`https://${account.world}.${domain}/game.php`);

  // Ulož browser do mapy
  browserData = { browser, context, page, account };
  setBrowser(accountId, browserData);

  // Při zavření browseru ho odstraň z mapy
  browser.on('disconnected', () => {
    console.log(`🔌 Headless browser pro účet ${accountId} (${account.username}) byl zavrén`);
    removeBrowser(accountId);
  });

  return browserData;
}

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

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        error: 'Username a heslo jsou povinné'
      });
    }

    const accountId = db.addAccount(
      username,
      password,
      proxy || null,
      world || null
    );

    if (accountId) {
      res.json({
        success: true,
        accountId,
        message: `Účet ${username} přidán`
      });
    } else {
      res.status(400).json({
        success: false,
        error: 'Účet již existuje nebo nastala chyba'
      });
    }
  } catch (error) {
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

app.post('/api/accounts/:id/open-browser', async (req, res) => {
  try {
    const accountId = parseInt(req.params.id);
    const account = db.getAccount(accountId);

    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }

    // Zjisti locale podle světa
    const domain = db.getDomainForAccount(account);
    const locale = domain.includes('divoke-kmene.sk') ? 'sk-SK' : 'cs-CZ';
    const timezoneId = domain.includes('divoke-kmene.sk') ? 'Europe/Bratislava' : 'Europe/Prague';

    const browser = await chromium.launch({
      headless: false,
      args: ['--disable-blink-features=AutomationControlled']
    });

    const contextOptions = {
      viewport: { width: 1280, height: 720 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      locale,
      timezoneId,
      // Vypni cache a lokální úložiště z předchozích session
      ignoreHTTPSErrors: true,
    };

    if (account.proxy) {
      const proxy = browserManager.parseProxy(account.proxy);
      contextOptions.proxy = proxy;
    }

    const context = await browser.newContext(contextOptions);

    if (account.cookies) {
      const cookies = JSON.parse(account.cookies);
      await context.addCookies(cookies);
    }

    const page = await context.newPage();

    // Vyčisti localStorage/sessionStorage před načtením stránky
    await page.goto(`https://${account.world}.${domain}/`);
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });

    // Teď načti game.php
    await page.goto(`https://${account.world}.${domain}/game.php`);

    // Ulož browser do mapy aktivních browserů
    setBrowser(accountId, { browser, context, page, account });

    // Při zavření browseru ho odstraň z mapy
    browser.on('disconnected', () => {
      console.log(`🔌 Browser pro účet ${accountId} (${account.username}) byl zavrén`);
      removeBrowser(accountId);
    });

    res.json({ success: true });
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
    const { speed, unitSpeedModifier } = req.body;

    if (!speed || speed <= 0) {
      return res.status(400).json({ error: 'Neplatná rychlost světa' });
    }

    if (unitSpeedModifier !== undefined && unitSpeedModifier <= 0) {
      return res.status(400).json({ error: 'Neplatný modifikátor rychlosti jednotek' });
    }

    db.saveWorldSettings(world, { speed, unitSpeedModifier: unitSpeedModifier || 1 });
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

    if (!browserData) {
      // Otevřít VIDITELNÝ browser pro ruční odeslání
      console.log(`🔧 Otevírám VIDITELNÝ browser pro ruční odeslání (účet ${accountId})`);

      const domain = db.getDomainForAccount(account);
      const locale = domain.includes('divoke-kmene.sk') ? 'sk-SK' : 'cs-CZ';
      const timezoneId = domain.includes('divoke-kmene.sk') ? 'Europe/Bratislava' : 'Europe/Prague';

      const browser = await chromium.launch({
        headless: false,  // VIDITELNÝ pro ruční kontrolu
        args: ['--disable-blink-features=AutomationControlled']
      });

      const contextOptions = {
        viewport: { width: 1280, height: 720 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        locale,
        timezoneId,
        ignoreHTTPSErrors: true,
      };

      if (account.proxy) {
        const proxy = browserManager.parseProxy(account.proxy);
        contextOptions.proxy = proxy;
      }

      const context = await browser.newContext(contextOptions);

      if (account.cookies) {
        const cookies = JSON.parse(account.cookies);
        await context.addCookies(cookies);
      }

      const page = await context.newPage();

      // Vyčisti localStorage/sessionStorage
      await page.goto(`https://${account.world}.${domain}/`);
      await page.evaluate(() => {
        localStorage.clear();
        sessionStorage.clear();
      });

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
  try {
    const { accountId, unitTypes, targetX, targetY } = req.body;

    if (!accountId || !unitTypes || !targetX || !targetY) {
      return res.status(400).json({ error: 'Chybí povinné parametry' });
    }

    // Automaticky získat nebo otevřít browser (headless pokud není aktivní)
    const browserData = await getOrOpenBrowser(accountId);

    // Dynamicky importovat SupportSender
    const { default: SupportSender } = await import('./modules/supportSender.js');
    const supportSender = new SupportSender(browserData.page, db, accountId);

    // Odeslat podporu (více jednotek najednou)
    const result = await supportSender.sendMultipleUnits(
      unitTypes,  // Pole jednotek ['knight', 'spear', 'sword', ...]
      parseInt(targetX),
      parseInt(targetY)
    );

    res.json({ success: true, result });
  } catch (error) {
    console.error('Error in /api/support/send:', error);
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🌐 Control Panel běží na http://localhost:${PORT}`);
});