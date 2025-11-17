import express from 'express';
import { chromium } from 'playwright';
import DatabaseManager from './database.js';
import BrowserManager from './browserManager.js';

const app = express();
const db = new DatabaseManager();
const browserManager = new BrowserManager(db);

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

    const browser = await chromium.launch({
      headless: false,
      args: ['--disable-blink-features=AutomationControlled']
    });

    const contextOptions = {
      viewport: { width: 1280, height: 720 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      locale: 'cs-CZ',
      timezoneId: 'Europe/Prague',
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
    await page.goto(`https://${account.world}.divokekmeny.cz/game.php`);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🌐 Control Panel běží na http://localhost:${PORT}`);
});