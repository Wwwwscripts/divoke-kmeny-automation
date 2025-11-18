import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class DatabaseManager {
  constructor(dataPath = join(__dirname, '../data')) {
    this.dataPath = dataPath;
    this.accountsFile = join(dataPath, 'accounts.json');
    this.statsFile = join(dataPath, 'stats.json');
    this.templatesFile = join(dataPath, 'templates.json');
    // In-memory cache pro templates (CPU optimalizace)
    this._templatesCache = null;
    this.initDatabase();
  }

  initDatabase() {
    // Vytvoř složku data, pokud neexistuje
    if (!existsSync(this.dataPath)) {
      mkdirSync(this.dataPath, { recursive: true });
    }

    // Vytvoř accounts.json, pokud neexistuje
    if (!existsSync(this.accountsFile)) {
      writeFileSync(this.accountsFile, JSON.stringify({ accounts: [], nextId: 1 }, null, 2));
    }

    // Vytvoř stats.json, pokud neexistuje
    if (!existsSync(this.statsFile)) {
      writeFileSync(this.statsFile, JSON.stringify({ stats: [] }, null, 2));
    }

    // Vytvoř templates.json, pokud neexistuje
    if (!existsSync(this.templatesFile)) {
      const defaultTemplates = {
        recruit: [
          { id: 'FARM', name: 'FARM', units: { spear: 0, sword: 0, axe: 300, light: 0, marcher: 0, heavy: 0 } },
          { id: 'DEF', name: 'DEF', units: { spear: 300, sword: 300, archer: 100, heavy: 50 } },
          { id: 'OFF', name: 'OFF', units: { axe: 0, light: 500, marcher: 0, ram: 50, catapult: 20 } }
        ],
        research: [
          {
            id: 'FARM',
            name: 'FARM',
            levels: {
              spear: 0, sword: 0, axe: 3, archer: 0, spy: 0,
              light: 0, marcher: 0, heavy: 0, ram: 0, catapult: 0, knight: 0, snob: 0
            }
          },
          {
            id: 'DEF',
            name: 'DEF',
            levels: {
              spear: 3, sword: 3, archer: 3, spy: 2,
              light: 0, marcher: 0, heavy: 3, ram: 0, catapult: 0, knight: 0, snob: 0
            }
          },
          {
            id: 'OFF',
            name: 'OFF',
            levels: {
              spear: 0, sword: 0, axe: 3, spy: 2,
              light: 3, marcher: 3, heavy: 0, ram: 3, catapult: 3, knight: 0, snob: 0
            }
          }
        ],
        building: [
          {
            id: 'FULL_VILLAGE',
            name: 'FULL VILLAGE',
            levels: {
              main: 30, barracks: 25, stable: 20, garage: 15, smith: 20,
              place: 1, market: 25, wood: 30, stone: 30, iron: 30,
              farm: 30, storage: 30, hide: 10, wall: 20
            }
          },
          {
            id: 'WAREHOUSE',
            name: 'WAREHOUSE',
            levels: {
              main: 20, barracks: 1, stable: 1, garage: 1, smith: 1,
              market: 20, wood: 30, stone: 30, iron: 30,
              farm: 30, storage: 30, hide: 10, wall: 1
            }
          },
          {
            id: 'RESOURCES',
            name: 'RESOURCES',
            levels: {
              main: 15, wood: 30, stone: 30, iron: 30,
              farm: 30, storage: 30, hide: 5, wall: 5
            }
          }
        ]
      };
      writeFileSync(this.templatesFile, JSON.stringify(defaultTemplates, null, 2));
    }

    console.log('✅ Databáze inicializována');
  }

  // Načíst účty ze souboru
  _loadAccounts() {
    const data = readFileSync(this.accountsFile, 'utf-8');
    return JSON.parse(data);
  }

  // Uložit účty do souboru
  _saveAccounts(data) {
    writeFileSync(this.accountsFile, JSON.stringify(data, null, 2));
  }

  // Načíst statistiky ze souboru
  _loadStats() {
    const data = readFileSync(this.statsFile, 'utf-8');
    return JSON.parse(data);
  }

  // Uložit statistiky do souboru
  _saveStats(data) {
    writeFileSync(this.statsFile, JSON.stringify(data, null, 2));
  }

  // Přidat nový účet
  addAccount(username, password, proxy = null, world = null) {
    try {
      const data = this._loadAccounts();

      // Kontrola, jestli účet už existuje
      const exists = data.accounts.find(a => a.username === username);
      if (exists) {
        console.error(`❌ Účet ${username} již existuje`);
        return null;
      }

      // Bezpečné určení ID - najdi max ID + 1 (ochrana proti corrupted nextId)
      const maxId = data.accounts.length > 0
        ? Math.max(...data.accounts.map(a => a.id))
        : 0;
      const newId = Math.max(maxId + 1, data.nextId);

      const newAccount = {
        id: newId,
        username,
        password,
        world,
        proxy,
        cookies: null,
        premium: 0,
        units_info: null,
        wall_level: null,
        // 🆕 COORDINATES - Souřadnice vesnice
        village_id: null,
        village_name: null,
        coord_x: null,
        coord_y: null,
        continent: null,
        // 🆕 TRIBE - Informace o kmeni
        tribe_name: null,
        // 🆕 PREMIUM - Premium informace
        premium_active: false,
        premium_points: 0,
        recruit_enabled: 0,
        recruit_template: 'FARM',
        building_enabled: 0,
        building_template: 'FULL_VILLAGE',
        // 🆕 RESEARCH - Nové pole pro výzkum
        research_enabled: 0,
        research_template: 'FARM',
        research_status: null,
        last_login: null,
        active: 1,
        created_at: new Date().toISOString()
      };

      data.accounts.push(newAccount);
      data.nextId = newId + 1; // Nastav nextId na další volné číslo
      this._saveAccounts(data);

      const server = this.getServerFromWorld(world);
      console.log(`✅ Účet ${username} přidán (ID: ${newAccount.id}, Server: ${server})`);
      return newAccount.id;
    } catch (error) {
      console.error(`❌ Chyba při přidávání účtu ${username}:`, error.message);
      return null;
    }
  }

  // Zjistit server ze světa (sk97 = SK, cs107 = CS)
  getServerFromWorld(world) {
    if (!world) return 'CS';
    return world.toLowerCase().startsWith('sk') ? 'SK' : 'CS';
  }

  // Získat doménu pro účet
  getDomainForAccount(account) {
    const server = this.getServerFromWorld(account.world);
    return server === 'SK' ? 'divoke-kmene.sk' : 'divokekmeny.cz';
  }

  // Získat účet podle ID
  getAccount(id) {
    const data = this._loadAccounts();
    return data.accounts.find(a => a.id === id);
  }

  // Získat účet podle jména
  getAccountByUsername(username) {
    const data = this._loadAccounts();
    return data.accounts.find(a => a.username === username);
  }

  // Získat všechny aktivní účty
  getAllActiveAccounts() {
    const data = this._loadAccounts();
    return data.accounts.filter(a => a.active === 1);
  }

  // Aktualizovat cookies pro účet
  updateCookies(accountId, cookies) {
    const data = this._loadAccounts();
    const account = data.accounts.find(a => a.id === accountId);

    if (account) {
      account.cookies = JSON.stringify(cookies);
      account.last_login = new Date().toISOString();
      this._saveAccounts(data);
      // Cookies se ukládají potichu (po každé operaci)
    }
  }

  // Aktualizovat informace o účtu
  updateAccountInfo(accountId, info) {
    const data = this._loadAccounts();
    const account = data.accounts.find(a => a.id === accountId);

    if (account) {
      if (info.world !== undefined) account.world = info.world;
      if (info.premium !== undefined) account.premium = info.premium;
      if (info.units_info !== undefined) account.units_info = info.units_info;
      if (info.wall_level !== undefined) account.wall_level = info.wall_level;
      // 🆕 RESEARCH - Ukládání research_status
      if (info.research_status !== undefined) account.research_status = info.research_status;
      // 🆕 COORDINATES - Ukládání souřadnic
      if (info.village_id !== undefined) account.village_id = info.village_id;
      if (info.village_name !== undefined) account.village_name = info.village_name;
      if (info.coord_x !== undefined) account.coord_x = info.coord_x;
      if (info.coord_y !== undefined) account.coord_y = info.coord_y;
      if (info.continent !== undefined) account.continent = info.continent;
      // 🆕 TRIBE - Ukládání tribe_name
      if (info.tribe_name !== undefined) account.tribe_name = info.tribe_name;
      // 🆕 PREMIUM - Ukládání premium informací
      if (info.premium_active !== undefined) account.premium_active = info.premium_active;
      if (info.premium_points !== undefined) account.premium_points = info.premium_points;
      this._saveAccounts(data);
    }
  }

  // Aktualizovat statistiky účtu
  updateAccountStats(accountId, stats) {
    const data = this._loadStats();
    const existingIndex = data.stats.findIndex(s => s.account_id === accountId);

    const newStats = {
      account_id: accountId,
      wood: stats.wood || 0,
      clay: stats.clay || 0,
      iron: stats.iron || 0,
      population_current: stats.populationCurrent || 0,
      population_max: stats.populationMax || 0,
      points: stats.points || 0,
      updated_at: new Date().toISOString()
    };

    if (existingIndex >= 0) {
      data.stats[existingIndex] = newStats;
    } else {
      data.stats.push(newStats);
    }

    this._saveStats(data);
  }

  // Aktualizovat informace o rekrutování
  updateRecruitSettings(accountId, settings) {
    const data = this._loadAccounts();
    const account = data.accounts.find(a => a.id === accountId);
    
    if (account) {
      if (settings.recruitEnabled !== undefined) account.recruit_enabled = settings.recruitEnabled ? 1 : 0;
      if (settings.recruitTemplate !== undefined) account.recruit_template = settings.recruitTemplate;
      this._saveAccounts(data);
      console.log(`✅ Nastavení rekrutování aktualizováno pro účet ID: ${accountId}`);
    }
  }

  // Získat nastavení rekrutování
  getRecruitSettings(accountId) {
    const account = this.getAccount(accountId);
    if (!account) return null;
    
    return {
      enabled: account.recruit_enabled === 1,
      template: account.recruit_template || 'FARM'
    };
  }

  // Aktualizovat informace o výstavbě
  updateBuildingSettings(accountId, settings) {
    const data = this._loadAccounts();
    const account = data.accounts.find(a => a.id === accountId);
    
    if (account) {
      if (settings.buildingEnabled !== undefined) account.building_enabled = settings.buildingEnabled ? 1 : 0;
      if (settings.buildingTemplate !== undefined) account.building_template = settings.buildingTemplate;
      this._saveAccounts(data);
      console.log(`✅ Nastavení výstavby aktualizováno pro účet ID: ${accountId}`);
    }
  }

  // Získat nastavení výstavby
  getBuildingSettings(accountId) {
    const account = this.getAccount(accountId);
    if (!account) return null;
    
    return {
      enabled: account.building_enabled === 1,
      template: account.building_template || 'FULL_VILLAGE'
    };
  }

  // 🆕 RESEARCH - Aktualizovat informace o výzkumu
  updateResearchSettings(accountId, settings) {
    const data = this._loadAccounts();
    const account = data.accounts.find(a => a.id === accountId);
    
    if (account) {
      if (settings.researchEnabled !== undefined) account.research_enabled = settings.researchEnabled ? 1 : 0;
      if (settings.researchTemplate !== undefined) account.research_template = settings.researchTemplate;
      if (settings.researchStatus !== undefined) account.research_status = settings.researchStatus;
      this._saveAccounts(data);
      console.log(`✅ Nastavení výzkumu aktualizováno pro účet ID: ${accountId}`);
    }
  }

  // 🆕 RESEARCH - Získat nastavení výzkumu
  getResearchSettings(accountId) {
    const account = this.getAccount(accountId);
    if (!account) return null;
    
    return {
      enabled: account.research_enabled === 1,
      template: account.research_template || 'FARM',
      status: account.research_status ? JSON.parse(account.research_status) : null
    };
  }

  // Získat kompletní informace o účtu včetně statistik
  getAccountWithStats(accountId) {
    const account = this.getAccount(accountId);
    if (!account) return null;

    const statsData = this._loadStats();
    const stats = statsData.stats.find(s => s.account_id === accountId);

    return {
      ...account,
      wood: stats?.wood || null,
      clay: stats?.clay || null,
      iron: stats?.iron || null,
      population_current: stats?.population_current || null,
      population_max: stats?.population_max || null,
      points: stats?.points || null,
      stats_updated_at: stats?.updated_at || null
    };
  }

  // Získat všechny účty s jejich statistikami
  getAllAccountsWithStats() {
    const data = this._loadAccounts();
    const statsData = this._loadStats();

    return data.accounts
      .filter(a => a.active === 1)
      .map(account => {
        const stats = statsData.stats.find(s => s.account_id === account.id);
        return {
          ...account,
          wood: stats?.wood || null,
          clay: stats?.clay || null,
          iron: stats?.iron || null,
          population_current: stats?.population_current || null,
          population_max: stats?.population_max || null,
          points: stats?.points || null,
          stats_updated_at: stats?.updated_at || null,
          // 🆕 RESEARCH - Přidáno do response
          research_enabled: account.research_enabled,
          research_template: account.research_template
        };
      });
  }

  // Deaktivovat účet
  deactivateAccount(accountId) {
    const data = this._loadAccounts();
    const account = data.accounts.find(a => a.id === accountId);
    
    if (account) {
      account.active = 0;
      this._saveAccounts(data);
      console.log(`✅ Účet ID ${accountId} deaktivován`);
    }
  }

  // Zavřít databázi (pro kompatibilitu s SQLite verzí)
  close() {
    // JSON soubory nepotřebují zavírat
  }

  // ============ ŠABLONY ============

  // Načíst šablony ze souboru (s in-memory cache)
  _loadTemplates() {
    if (this._templatesCache !== null) {
      return this._templatesCache;
    }
    const data = readFileSync(this.templatesFile, 'utf-8');
    this._templatesCache = JSON.parse(data);
    return this._templatesCache;
  }

  // Uložit šablony do souboru (invaliduje cache)
  _saveTemplates(data) {
    this._templatesCache = null; // Invalidate cache
    writeFileSync(this.templatesFile, JSON.stringify(data, null, 2));
  }

  // Získat všechny šablony pro daný typ (recruit, research, building)
  getTemplates(type) {
    const templates = this._loadTemplates();
    return templates[type] || [];
  }

  // Získat konkrétní šablonu
  getTemplate(type, id) {
    const templates = this._loadTemplates();
    return templates[type]?.find(t => t.id === id);
  }

  // Uložit/aktualizovat šablonu
  saveTemplate(type, template) {
    const templates = this._loadTemplates();
    if (!templates[type]) templates[type] = [];

    const index = templates[type].findIndex(t => t.id === template.id);
    if (index >= 0) {
      templates[type][index] = template;
    } else {
      templates[type].push(template);
    }

    this._saveTemplates(templates);
    return true;
  }

  // Smazat šablonu
  deleteTemplate(type, id) {
    const templates = this._loadTemplates();
    if (!templates[type]) return false;

    templates[type] = templates[type].filter(t => t.id !== id);
    this._saveTemplates(templates);
    return true;
  }
}

export default DatabaseManager;