# 🖥️ Browser Manager - Správa visible prohlížečů

Jednoduchý dashboard pro správu visible prohlížečů a řešení přihlášení/captcha.

## Rychlý start

1. **Nastav testovací účty** (pokud nemáš):
   ```bash
   node setup-test-accounts.js
   ```

2. **Spusť control panel**:
   ```bash
   npm run panel
   ```

3. **Otevři Browser Manager**:
   ```
   http://localhost:3000/browser-manager.html
   ```

## Funkce

### 📊 Status monitoring
- **✅ Připraven** - Účet má cookies, vše OK
- **🔑 Přihlášení** - Účet nemá cookies, nutné přihlášení
- **🤖 Captcha** - Detekována captcha, vyžaduje manuální řešení
- **❓ Neznámý** - Status se kontroluje nebo je problém

### 🎮 Ovládání
Každý účet má tlačítka podle aktuálního stavu:

1. **🌐 Otevřít prohlížeč** - Otevře visible browser na hlavní stránce hry
2. **🔑 Jít na přihlášení** - Otevře browser přímo na přihlašovací stránce
3. **🤖 Otevřít a vyřešit captcha** - Otevře browser pro manuální řešení captcha

### 🔄 Auto-refresh
Status všech účtů se automaticky kontroluje každých 30 sekund.

## Workflow

### První přihlášení
1. Otevři Browser Manager
2. U účtu klikni na **"Jít na přihlášení"**
3. V otevřeném browseru se přihlas
4. Browser můžeš zavřít - cookies se uloží automaticky
5. Status se změní na **✅ Připraven**

### Řešení captcha
1. Když je detekována captcha, status se změní na **🤖 Captcha**
2. Klikni na **"Otevřít a vyřešit captcha"**
3. V browseru vyřeš captcha
4. Zavři browser
5. Status se vrátí na **✅ Připraven**

## Technické detaily

- **Frontend**: `/public/browser-manager.html`
- **Backend endpoints**:
  - `GET /api/accounts/:id/status` - Kontrola statusu účtu
  - `POST /api/accounts/:id/open-browser` - Otevření visible browseru

- **Cookies**: Ukládají se do `userDataDir` automaticky Playwrightem
- **Sdílení**: Cookies jsou sdílené mezi headless a visible browsery

## Tip

Teď můžeš úplně zapomenout na manuální správu cookies! 🎉

Všechno se děje přes visible prohlížeče:
- Přihlášení ✅
- Captcha ✅
- Ověření stavu ✅

Když zavřeš browser, všechny cookies zůstanou uložené a headless automatizace je použije.
