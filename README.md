# Divoké kmeny - Multi-účet automatizace

Systém pro automatizaci více účtů v Divoké kmeny pomocí Playwright.

## 🚀 Instalace

```bash
npm install
```

## 📁 Struktura projektu

```
divoke-kmeny-automation/
├── src/
│   ├── database.js          # Správa databáze účtů
│   ├── browserManager.js    # Správa Playwright s proxy a cookies
│   ├── index.js            # Hlavní vstupní bod (test)
│   └── modules/            # Budoucí moduly pro jednotlivé akce
├── data/
│   └── accounts.db         # SQLite databáze (vytvoří se automaticky)
└── package.json
```

## 🎯 Funkce

### ✅ Hotové
- SQLite databáze pro ukládání účtů
- Podpora proxy pro každý účet
- Ukládání a načítání cookies
- Základní správa účtů
- Test připojení přes proxy

### 🔄 V přípravě
- Moduly pro jednotlivé akce (stavby, nábor jednotek, atd.)
- Control panel s přehledem účtů
- Automatické aktualizace statistik

## 📝 Použití

### 1. Přidání účtu

Uprav soubor `src/index.js` a nastav údaje účtu:

```javascript
const testAccount = {
  username: 'tvuj_ucet',
  password: 'tvoje_heslo',
  proxy: 'http://user:pass@host:port', // nebo null
  world: 'cs120'  // nebo null
};
```

### 2. První spuštění - Základní test

```bash
npm start
```

Program:
1. Vytvoří databázi (pokud neexistuje)
2. Přidá účet do databáze
3. Otevře prohlížeč s nastavenou proxy
4. Načte cookies (pokud jsou uložené)
5. Otevře Divoké kmeny

**DŮLEŽITÉ:** Pokud nemáš uložené cookies, budeš muset při prvním spuštění ručně přihlásit účet. Cookies se pak automaticky uloží do databáze.

### 3. Spuštění Control Panelu

```bash
npm run panel
```

Pak otevři v prohlížeči: **http://localhost:3000**

Control panel zobrazuje:
- Celkové statistiky všech účtů
- Detailní přehled každého účtu
- Suroviny, populaci, vesnice, body
- Premium status
- Poslední aktualizace
- Auto-refresh každých 30 sekund

### 4. Formáty proxy

Podporované formáty:
- `host:port` (např. `123.45.67.89:8080`)
- `http://host:port`
- `http://username:password@host:port`
- `https://host:port`

## 🗃️ Databázová struktura

### Tabulka `accounts`
- `id` - Unikátní ID účtu
- `username` - Uživatelské jméno
- `password` - Heslo
- `world` - Herní svět (např. cs120)
- `proxy` - Proxy server
- `cookies` - Uložené cookies (JSON)
- `premium` - Má premium? (0/1)
- `units_info` - Informace o jednotkách (JSON)
- `last_login` - Poslední přihlášení
- `active` - Je účet aktivní? (0/1)

### Tabulka `account_stats`
- `account_id` - ID účtu
- `wood`, `clay`, `iron` - Suroviny
- `population_current`, `population_max` - Populace
- `villages_count` - Počet vesnic
- `points` - Body
- `updated_at` - Poslední aktualizace

## 🔧 Funkce DatabaseManager

```javascript
// Přidat účet
db.addAccount(username, password, proxy, world)

// Získat účet
db.getAccount(id)
db.getAccountByUsername(username)
db.getAllActiveAccounts()

// Aktualizovat cookies
db.updateCookies(accountId, cookies)

// Aktualizovat informace
db.updateAccountInfo(accountId, { world, premium, units_info })
db.updateAccountStats(accountId, { wood, clay, iron, ... })

// Získat kompletní info
db.getAccountWithStats(accountId)
db.getAllAccountsWithStats()
```

## 🔧 Funkce BrowserManager

```javascript
// Vytvořit browser context s proxy a cookies
const { browser, context, account } = await browserManager.createContext(accountId)

// Uložit cookies
await browserManager.saveCookies(context, accountId)

// Zavřít browser
await browserManager.close(browser, context)

// Test připojení
await browserManager.testConnection(accountId)
```

## 📝 Další kroky

1. **Moduly pro akce** - Vytvoříme samostatné moduly pro:
   - Stavby
   - Nábor jednotek
   - Obchod
   - Útoky/Obrany
   - atd.

2. **Control panel** - Web rozhraní pro správu účtů

3. **Automatizace** - Plánovač úkolů

## ⚠️ Poznámky

- Pro první přihlášení je potřeba ručně vyřešit captchu
- Cookies se po prvním přihlášení uloží a další spuštění už bude automatické
- Každý účet může mít vlastní proxy
- Databáze se vytvoří automaticky při prvním spuštění
