# 📁 Struktura projektu

```
divoke-kmeny-automation/
│
├── package.json                 # Node.js dependencies a skripty
├── README.md                    # Kompletní dokumentace
├── QUICKSTART.md                # Rychlý start
├── .gitignore                   # Git ignore soubor
│
├── data/                        # Databáze (vytvoří se automaticky)
│   └── accounts.db             # SQLite databáze s účty
│
├── public/                      # Web interface
│   └── index.html              # Control panel HTML
│
└── src/                         # Zdrojové kódy
    ├── index.js                # Hlavní vstupní bod (test)
    ├── test-module.js          # Test modulu accountInfo
    ├── database.js             # Správa databáze
    ├── browserManager.js       # Správa Playwright + proxy
    ├── controlPanel.js         # Express server pro web panel
    ├── helpers.js              # Pomocné funkce
    │
    └── modules/                # Jednotlivé moduly
        ├── README.md           # Dokumentace modulů
        ├── _template.js        # Šablona pro nové moduly
        └── accountInfo.js      # Modul pro sběr informací
```

## 📦 Co je již hotové?

### ✅ Databázový systém (database.js)
- SQLite databáze pro ukládání účtů
- Tabulky: `accounts` a `account_stats`
- Metody pro správu účtů
- Ukládání cookies, proxy, hesel
- Statistiky účtů

### ✅ Browser Manager (browserManager.js)
- Spuštění Playwright s podporou proxy
- Načítání a ukládání cookies
- Parsování různých formátů proxy
- Automatické testování připojení

### ✅ Modul pro sběr informací (accountInfo.js)
- Zjišťuje svět
- Kontroluje premium status
- Načítá suroviny (dřevo, hlína, železo)
- Získává populaci
- Počítá vesnice
- Získává body hráče

### ✅ Control Panel (controlPanel.js + index.html)
- Web interface na http://localhost:3000
- Přehled všech účtů
- Celkové statistiky
- Auto-refresh každých 30 sekund
- Vizualizace dat

### ✅ Pomocné funkce (helpers.js)
- Čekání na načtení hry
- Navigace mezi stránkami
- Simulace lidského chování
- Screenshot pro debug
- Parsování čísel
- Přepínání vesnic

## 🚀 Jak to použít?

### 1. Instalace
```bash
npm install
```

### 2. Přidání účtu
Uprav `src/index.js`:
```javascript
const testAccount = {
  username: 'tvuj_ucet',
  password: 'tvoje_heslo',
  proxy: null, // nebo 'http://user:pass@host:port'
  world: null  // automaticky se zjistí
};
```

### 3. První spuštění
```bash
npm start
```
- Otevře prohlížeč
- Ručně se přihlas (kvůli captcha)
- Cookies se uloží automaticky

### 4. Test modulu pro sběr informací
```bash
npm run test-module
```
- Načte informace o účtu
- Uloží do databáze

### 5. Control Panel
```bash
npm run panel
```
- Otevři http://localhost:3000
- Zobrazí přehled všech účtů

## 🎯 Co dělat dál?

### Přidat další moduly podle potřeby:

1. **buildings.js** - Správa staveb
   - Seznam budov
   - Automatická stavba
   - Fronta staveb

2. **recruiting.js** - Nábor jednotek
   - Automatický nábor
   - Plánování jednotek
   - Fronta náboru

3. **market.js** - Obchod
   - Posílání surovin
   - Vyvažování mezi vesnicemi
   - Obchod s hráči

4. **attacks.js** - Útoky
   - Farmení
   - Automatické útoky
   - Obrana

5. **reports.js** - Reporty
   - Čtení reportů
   - Analýza
   - Statistiky

### Vytvořit automatizační systém:
- Plánovač úkolů
- Běh na pozadí
- Notifikace

### Rozšířit control panel:
- Ovládání modulů přes web
- Live monitoring
- Grafy a statistiky
- Logy aktivit

## 💡 Příklad použití modulu

```javascript
import BrowserManager from './browserManager.js';
import DatabaseManager from './database.js';
import AccountInfoModule from './modules/accountInfo.js';

const db = new DatabaseManager();
const browserManager = new BrowserManager();

// Vytvoř browser context
const { browser, context } = await browserManager.createContext(accountId);
const page = await context.newPage();

// Načti hru
await page.goto('https://www.divokekmeny.cz/');

// Použij modul
const infoModule = new AccountInfoModule(page, db, accountId);
const info = await infoModule.collectAllInfo();

console.log(info);

// Zavři browser
await browserManager.close(browser, context);
db.close();
```

## 🔐 Bezpečnost

- Hesla jsou uložena v lokální databázi
- Databáze není verzována (v .gitignore)
- Cookies jsou šifrované v databázi
- Každý účet má vlastní proxy

## ⚠️ Důležité poznámky

1. **První přihlášení je vždy manuální** kvůli captcha
2. **Cookies se ukládají automaticky** pro další spuštění
3. **Každý účet může mít vlastní proxy**
4. **Moduly jsou nezávislé** - můžeš je volat zvlášť
5. **Databáze je lokální** - data zůstávají u tebe

## 📞 Podpora

Pro přidání nových funkcí nebo opravu chyb:
1. Zkontroluj dokumentaci v README.md
2. Podívej se na příklady v modulech
3. Použij šablonu _template.js pro nové moduly
