# 📦 Moduly

Tato složka obsahuje jednotlivé moduly pro různé akce v Divoké kmeny.

## ✅ Hotové moduly

### `accountInfo.js`
Sbírá informace o účtu a ukládá je do databáze.

**Funkce:**
- Zjišťuje svět
- Kontroluje premium status
- Načítá suroviny (dřevo, hlína, železo)
- Zjišťuje populaci
- Počítá vesnice
- Získává body

**Použití:**
```javascript
import AccountInfoModule from './modules/accountInfo.js';

const infoModule = new AccountInfoModule(page, db, accountId);
const info = await infoModule.collectAllInfo();
```

## 🔜 Plánované moduly

### `buildings.js`
Správa a stavba budov.

**Funkce:**
- Seznam všech budov ve vesnici
- Automatická stavba podle plánu
- Upgrade budov
- Fronta staveb

### `recruiting.js`
Nábor jednotek.

**Funkce:**
- Seznam dostupných jednotek
- Automatický nábor podle plánu
- Výpočet času náboru
- Správa fronty

### `market.js`
Obchodování mezi vesnicemi.

**Funkce:**
- Posílání surovin mezi vesnicemi
- Automatické vyvažování surovin
- Obchodování s jinými hráči

### `attacks.js`
Správa útoků a obrany.

**Funkce:**
- Seznam příchozích útoků
- Odeslání útoků
- Automatická obrana
- Farmení vesnic

### `reports.js`
Správa reportů.

**Funkce:**
- Čtení reportů
- Analýza útoků/obran
- Automatické značení důležitých reportů

### `village.js`
Správa vesnic.

**Funkce:**
- Přepínání mezi vesnicemi
- Seznam všech vesnic
- Přejmenování vesnic
- Základní info o vesnici

## 🛠️ Vytvoření nového modulu

1. Zkopíruj `_template.js` a přejmenuj ho
2. Implementuj metodu `execute()`
3. Přidej specifické metody pro tvůj modul
4. Otestuj modul samostatně
5. Přidej dokumentaci sem do README

## 📝 Příklad struktury modulu

```javascript
class MyModule {
  constructor(page, db, accountId) {
    this.page = page;
    this.db = db;
    this.accountId = accountId;
  }

  async execute(params = {}) {
    // Hlavní logika modulu
  }

  async helperMethod() {
    // Pomocná metoda
  }
}

export default MyModule;
```

## 💡 Tipy

- Každý modul by měl být **nezávislý**
- Používej `console.log` pro průběžné informace
- Zachycuj chyby pomocí `try/catch`
- Ukládej důležité informace do databáze
- Testuj moduly samostatně před integrací
