# Testování zjišťování jednotek - Návod

Tento testovací script slouží k otestování různých metod zjišťování jednotek v Divokých kmenech.

## Jak použít

### 1. Otevřete si Divoké kmeny v prohlížeči
Přihlaste se do své vesnice normálně přes prohlížeč.

### 2. Otevřete konzoli
Stiskněte **F12** (nebo **Ctrl+Shift+I**) a přejděte na záložku **Console**.

### 3. Zkopírujte a vložte testovací script
Otevřete soubor `test-units-detection.js` a celý jeho obsah zkopírujte do konzole. Poté stiskněte **Enter**.

Měli byste vidět zprávu:
```
✅ Testovací script načten!

📋 Dostupné funkce:
  • testUnitsDetection() - Hlavní testovací funkce
  • quickTest() - Rychlý test na aktuální stránce
  • analyzeCurrentPage() - Analýza DOM struktury
  • testTrainScreen() - Test train screen
  • testRallyPoint() - Test rally point
  • testOverview() - Test overview

💡 Pro začátek zadej: quickTest()
```

## Dostupné funkce

### quickTest()
**Nejrychlejší test - doporučený na začátek**

- Testuje zjišťování jednotek na **aktuální stránce**
- **Nepřechází** nikam jinam
- Zobrazí, které jednotky se podařilo zjistit a které ne

**Použití:**
```javascript
quickTest()
```

**Kdy použít:**
- Chcete rychle zjistit, jak funguje zjišťování na aktuální obrazovce
- Jste na train screen, rally point nebo jiné stránce s jednotkami

---

### analyzeCurrentPage()
**Podrobná analýza DOM struktury**

- Analyzuje DOM strukturu aktuální stránky
- Zobrazí všechny inputy pro jednotky
- Ukáže obsah všech buněk v řádcích s jednotkami
- Pomůže pochopit, jak jsou jednotky strukturované v HTML

**Použití:**
```javascript
analyzeCurrentPage()
```

**Kdy použít:**
- Chcete pochopit, jak jsou jednotky v HTML strukturované
- Zjišťování nefunguje a chcete vidět, co je špatně
- Vyvíjíte novou metodu zjišťování

---

### testTrainScreen()
**Test zjišťování z train screen**

- Přejde na `/game.php?screen=train` (kasárny/stáje/dílna)
- Otestuje zjišťování jednotek podle patternu "X / Y"
- Zobrazí podrobné informace o každé jednotce

**⚠️ UPOZORNĚNÍ:** Tato funkce přejde na jinou stránku!

**Použití:**
```javascript
testTrainScreen()
```

**Výstup:**
```
📊 Analyzuji: spear
HTML řádku: <tr>...</tr>
Počet buněk: 5
  Buňka 0: "Kopíjník"
  Buňka 1: "100"
  Buňka 2: "50 / 100"
  ✅ NALEZENO: 50/100 (mimo: 50)

📊 VÝSLEDEK:
┌─────────┬──────────────┬──────┬───────┬──────┐
│ (index) │   status     │ inV. │ total │ away │
├─────────┼──────────────┼──────┼───────┼──────┤
│ spear   │ ✅ Nalezeno  │  50  │  100  │  50  │
│ sword   │ ✅ Nalezeno  │  30  │   30  │   0  │
...
```

---

### testRallyPoint()
**Test zjišťování z rally point**

- Přejde na `/game.php?screen=place` (shromaždiště)
- Otestuje zjišťování jednotek podle patternu "(123)"
- Hledá také data-count atributy

**⚠️ UPOZORNĚNÍ:** Tato funkce přejde na jinou stránku!

**Použití:**
```javascript
testRallyPoint()
```

---

### testOverview()
**Test zjišťování z overview**

- Přejde na `/game.php?screen=overview_villages&mode=units` (přehled vesnic)
- Otestuje zjišťování jednotek z tabulky
- Hledá elementy s class `.unit-item-{unitType}`

**⚠️ UPOZORNĚNÍ:** Tato funkce přejde na jinou stránku!

**Použití:**
```javascript
testOverview()
```

---

### testUnitsDetection()
**Hlavní testovací funkce**

- Zobrazí přehled všech dostupných testů
- Analyzuje aktuální stránku
- Ukáže návod, jak použít další testy

**Použití:**
```javascript
testUnitsDetection()
```

## Pracovní postup

### Doporučený postup pro testování:

1. **Začněte s rychlým testem:**
   ```javascript
   quickTest()
   ```
   - Uvidíte, jestli zjišťování funguje na aktuální stránce

2. **Pokud quickTest() najde problémy, analyzujte DOM:**
   ```javascript
   analyzeCurrentPage()
   ```
   - Podívejte se na HTML strukturu jednotek
   - Zjistěte, proč zjišťování nefunguje

3. **Otestujte konkrétní obrazovky:**
   ```javascript
   testTrainScreen()  // Test train screen
   testRallyPoint()   // Test rally point
   testOverview()     // Test overview
   ```

4. **Porovnejte výsledky:**
   - Která metoda zjistila nejvíce jednotek?
   - Která je nejspolehlivější?
   - Jsou výsledky konzistentní?

## Řešení problémů

### ❌ "Input nenalezen"
- Pravděpodobně jste na stránce, která nemá inputy pro jednotky
- Zkuste přejít na train screen nebo rally point manuálně

### ❌ "Pattern 'X / Y' nenalezen"
- Pattern pro jednotky není ve formátu "číslo / číslo"
- Použijte `analyzeCurrentPage()` a podívejte se na skutečný formát

### ⚠️ "Částečně nalezeno (závorka)"
- Podařilo se zjistit jen počet ve vesnici (z "(123)")
- Celkový počet nebyl nalezen

## Interpretace výsledků

### Struktura dat jednotek:

```javascript
{
  inVillage: 50,  // Počet jednotek ve vesnici
  total: 100,     // Celkový počet jednotek (ve vesnici + mimo)
  away: 50        // Počet jednotek mimo vesnici (vypočítaný: total - inVillage)
}
```

### Co znamenají symboly:

- ✅ **Nalezeno** - Jednotky úspěšně zjištěny
- ⚠️ **Částečně nalezeno** - Zjištěn jen částečný počet
- ❌ **Nenalezeno** - Jednotky se nepodařilo zjistit

## Příklad použití

```javascript
// 1. Načteme script do konzole
// (zkopírujeme celý obsah test-units-detection.js)

// 2. Spustíme rychlý test
quickTest()

// Výstup:
// ┌─────────┬──────────────┬──────┬───────┬──────┐
// │ (index) │   status     │ inV. │ total │ away │
// ├─────────┼──────────────┼──────┼───────┼──────┤
// │ spear   │ ✅ Nalezeno  │  50  │  100  │  50  │
// │ sword   │ ✅ Nalezeno  │  30  │   30  │   0  │
// │ axe     │ ❌ Nenalezeno│   -  │   -   │   -  │
// ...

// 3. Pokud něco nefunguje, analyzujeme DOM
analyzeCurrentPage()

// 4. Otestujeme různé obrazovky
testTrainScreen()
testRallyPoint()
testOverview()
```

## Reportování chyb

Pokud zjistíte, že zjišťování nefunguje správně:

1. Spusťte `analyzeCurrentPage()`
2. Zkopírujte výstup z konzole
3. Udělejte screenshot obrazovky
4. Nahlaste problém s informacemi:
   - Jakou obrazovku testujete (train/place/overview)?
   - Jaký pattern se očekává?
   - Jaký pattern je ve skutečnosti?
   - Výstup z `analyzeCurrentPage()`

---

**Vytvořeno:** 2025-11-18
**Autor:** Claude Code
**Projekt:** Divoké kmeny - Automation
