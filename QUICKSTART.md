# 🚀 Rychlý start

## Instalace

1. **Nainstaluj Node.js** (pokud ještě nemáš)
   - Stáhni z https://nodejs.org/
   - Verze 18 nebo vyšší

2. **Nainstaluj závislosti**
   ```bash
   npm install
   ```

3. **Přidej svůj účet**
   - Otevři `src/index.js`
   - Uprav sekci `testAccount`:
   ```javascript
   const testAccount = {
     username: 'tvuj_ucet',      // Tvé uživatelské jméno
     password: 'tvoje_heslo',    // Tvé heslo
     proxy: null,                // nebo 'host:port' nebo 'http://user:pass@host:port'
     world: null                 // automaticky se zjistí
   };
   ```

4. **První spuštění**
   ```bash
   npm start
   ```
   - Otevře se prohlížeč
   - Pokud nejsi přihlášen, **ručně se přihlas** (kvůli captcha)
   - Cookies se automaticky uloží pro příště

5. **Test sběru informací**
   ```bash
   npm run test-module
   ```
   - Načte informace o účtu
   - Uloží do databáze

6. **Spuštění Control Panelu**
   ```bash
   npm run panel
   ```
   - Otevři http://localhost:3000
   - Uvidíš přehled všech účtů

## ✅ Hotovo!

Teď máš:
- ✅ Databázi s účty
- ✅ Podporu proxy
- ✅ Automatické načítání cookies
- ✅ Modul pro sběr informací
- ✅ Web control panel

## 🔜 Další kroky

Můžeme přidat:
1. **Moduly pro akce** - stavby, nábor, útoky, obchod...
2. **Automatizaci** - plánovač úkolů
3. **Více účtů** - správa více účtů najednou
4. **Notifikace** - upozornění na důležité události

## ⚠️ Poznámky

- První přihlášení je **manuální** (captcha)
- Další spuštění už jsou **automatická** (cookies)
- Každý účet může mít **vlastní proxy**
- Data jsou v `data/accounts.db`
