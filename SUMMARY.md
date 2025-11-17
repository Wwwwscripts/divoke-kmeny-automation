# ✅ HOTOVO - Divoké kmeny Multi-účet Automatizace

## 🎉 Co máš připravené?

### 1. ✅ Základní systém
- **SQLite databáze** pro ukládání účtů, hesel, cookies a proxy
- **Podpora proxy** pro každý účet (různé formáty)
- **Automatické ukládání cookies** po prvním přihlášení
- **Modulární struktura** - každá funkce v samostatném souboru

### 2. ✅ Funkční moduly
- **accountInfo.js** - Sbírá info o účtu (svět, premium, suroviny, body, vesnice)
- **helpers.js** - Pomocné funkce pro práci s hrou

### 3. ✅ Control Panel
- **Web interface** na http://localhost:3000
- Přehled všech účtů
- Statistiky v reálném čase
- Auto-refresh každých 30 sekund

### 4. ✅ Skripty
```bash
npm start              # První spuštění + test
npm run test-module    # Test sběru informací
npm run panel          # Spustit control panel
npm run add-accounts   # Přidat více účtů najednou
```

## 📋 Jak začít?

### Krok 1: Instalace
```bash
npm install
```

### Krok 2: Přidat účet
Uprav `src/index.js` nebo `src/addAccounts.js`:
```javascript
const testAccount = {
  username: 'tvuj_ucet',
  password: 'tvoje_heslo',
  proxy: null, // nebo 'http://user:pass@host:port'
  world: null
};
```

### Krok 3: První přihlášení
```bash
npm start
```
- Otevře se prohlížeč
- Ručně se přihlas (captcha)
- Cookies se uloží

### Krok 4: Test automatického sběru dat
```bash
npm run test-module
```

### Krok 5: Control Panel
```bash
npm run panel
```
Otevři: http://localhost:3000

## 📂 Struktura souborů

```
divoke-kmeny-automation/
├── src/
│   ├── index.js              # Hlavní test
│   ├── database.js           # Správa databáze
│   ├── browserManager.js     # Playwright + proxy
│   ├── controlPanel.js       # Express server
│   ├── helpers.js            # Pomocné funkce
│   ├── addAccounts.js        # Přidání více účtů
│   ├── test-module.js        # Test modulu
│   └── modules/
│       ├── accountInfo.js    # Sběr informací
│       ├── _template.js      # Šablona pro nové moduly
│       └── README.md         # Nápověda pro moduly
├── public/
│   └── index.html            # Control panel UI
├── data/
│   └── accounts.db           # SQLite databáze (vytvoří se automaticky)
├── package.json
├── README.md
├── QUICKSTART.md
└── PROJECT_OVERVIEW.md
```

## 🎯 Co dělat dál?

### 1. Přidat další moduly podle potřeby:

**buildings.js** - Stavby
- Seznam budov
- Automatická stavba
- Upgrade
- Fronta

**recruiting.js** - Jednotky
- Nábor jednotek
- Plánování
- Automatizace

**market.js** - Obchod
- Posílání surovin
- Vyvažování
- Obchod

**attacks.js** - Útoky
- Farmení
- Automatické útoky
- Obrana

### 2. Vylepšit control panel:
- Ovládání modulů přes web
- Grafy a statistiky
- Live logy
- Notifikace

### 3. Automatizace:
- Plánovač úkolů
- Běh na pozadí
- Cron jobs

## 💡 Příklad vytvoření nového modulu

1. Zkopíruj `src/modules/_template.js`
2. Přejmenuj ho (např. `buildings.js`)
3. Implementuj metodu `execute()`
4. Otestuj:
```javascript
const module = new BuildingsModule(page, db, accountId);
await module.execute();
```

## ⚠️ Důležité

1. **První přihlášení** je vždy manuální (captcha)
2. **Další spuštění** jsou automatická (cookies)
3. **Každý účet** může mít vlastní proxy
4. **Moduly jsou nezávislé** - můžeš je volat zvlášť
5. **Data jsou lokální** - v SQLite databázi

## 🔐 Proxy formáty

Podporované formáty:
```
123.45.67.89:8080
http://123.45.67.89:8080
http://user:pass@123.45.67.89:8080
https://proxy.example.com:8080
```

## 📊 Databázové tabulky

### accounts
- id, username, password
- world, proxy, cookies
- premium, units_info
- last_login, active

### account_stats
- wood, clay, iron
- population_current, population_max
- villages_count, points

## 🚀 To je vše!

Máš kompletní základ pro automatizaci Divokých kmenů s více účty.

**Další kroky:**
1. Nainstaluj: `npm install`
2. Přidej účty
3. Spusť `npm start` a přihlas se ručně
4. Spusť `npm run test-module` pro test
5. Spusť `npm run panel` pro control panel
6. Vytvoř další moduly podle potřeby

Všechno je připravené k použití! 🎮
