# Průvodce logováním pro moduly

## Nový systém logování

Vytvořili jsme centralizovaný logger s úrovněmi logování:

- **ERROR** (0) - Chyby - vždy zobrazit
- **ACTION** (1) - Důležité akce (výstavba, rekrut, výzkum, paladin) - **DEFAULT**
- **INFO** (2) - Informativní zprávy (přihlášení, statistiky)
- **DEBUG** (3) - Debug zprávy (kontroly, navigace)

## Jak používat v modulech

### 1. Import loggeru

```javascript
import logger from '../logger.js';
```

### 2. Místo console.log používej logger

**PŘED:**
```javascript
console.log(`🎯 Rekrutuji: ${unitType}`);
console.error(`❌ Chyba při rekrutování ${unitType}:`, error.message);
console.log(`✅ ${unitType} narekrutováno`);
```

**PO:**
```javascript
// CHYBY - vždy se zobrazí
logger.error(`Chyba při rekrutování ${unitType}`, accountName, error);

// AKCE - zobrazí se jen když něco udělá
logger.recruit(accountName, unitType, 1);

// DEBUG - nezobrazí se (jen v DEBUG módu)
logger.debug(`Kontroluji ${unitType}`, accountName);
```

### 3. Speciální metody pro akce

```javascript
// Výstavba
logger.building(accountName, 'Kasárny', 10);
logger.building(accountName, 'Kasárny', 10, '15min');

// Rekrut
logger.recruit(accountName, 'spear', 100);
logger.recruit(accountName, 'spear', 100, '30min');

// Výzkum
logger.research(accountName, 'spear', 3);
logger.research(accountName, 'spear', 3, '2h');

// Paladin
logger.paladin(accountName, 'Obrana', 'Naučeno');

// Útok
logger.attack(accountName, 5);

// CAPTCHA
logger.captcha(accountName);
```

## Příklady úprav modulů

### Recruit modul (src/modules/recruit.js)

```javascript
import logger from '../logger.js';

class RecruitModule {
  constructor(page, db, accountId) {
    this.page = page;
    this.db = db;
    this.accountId = accountId;
    this.accountName = null; // Přidej
  }

  async recruitUnit(unitType) {
    try {
      // Získej username pro logger
      if (!this.accountName) {
        const account = this.db.getAccountById(this.accountId);
        this.accountName = account?.username || `ID:${this.accountId}`;
      }

      // ... kód pro rekrutování ...

      // MÍSTO: console.log(`✅ ${unitType} narekrutováno`);
      logger.recruit(this.accountName, unitType, 1);

      return true;
    } catch (error) {
      // MÍSTO: console.error(`❌ Chyba:`, error.message);
      logger.error(`Chyba při rekrutování ${unitType}`, this.accountName, error);
      return false;
    }
  }

  async startRecruiting(templateName) {
    // ODSTRAŇ verbose logy:
    // console.log(`🚀 Spouštím rekrutování...`);
    // console.log(`📋 Potřeba narekrutovat:`);

    // PONECHEJ pouze když SKUTEČNĚ rekrutuje:
    const recruited = await this.recruitUnit(unitType);
    // logger.recruit() je volán uvnitř recruitUnit()
  }
}
```

### Building modul (src/modules/building.js)

```javascript
import logger from '../logger.js';

class BuildingModule {
  async upgrade(buildingName, targetLevel) {
    try {
      // ... upgrade kód ...

      // MÍSTO: console.log(`✅ Výstavba zahájena:...`);
      logger.building(this.accountName, buildingName, targetLevel);

      return true;
    } catch (error) {
      logger.error(`Chyba při výstavbě ${buildingName}`, this.accountName, error);
      return false;
    }
  }

  async startBuilding(templateName) {
    // ODSTRAŇ: console.log(`🏗️ Výstavba zapnuta...`);

    // PONECHEJ pouze když SKUTEČNĚ staví:
    const upgraded = await this.upgrade(building, level);
    // logger.building() je volán uvnitř upgrade()
  }
}
```

### Research modul (src/modules/research.js)

```javascript
import logger from '../logger.js';

class ResearchModule {
  async researchUnit(unitType, targetLevel) {
    try {
      // ... research kód ...

      // MÍSTO: console.log(`✅ Výzkum zahájen:...`);
      logger.research(this.accountName, unitType, targetLevel);

      return true;
    } catch (error) {
      logger.error(`Chyba při výzkumu ${unitType}`, this.accountName, error);
      return false;
    }
  }
}
```

### Support modul (src/modules/support.js)

```javascript
import logger from '../logger.js';

class SupportModule {
  async getAllUnitsInfo() {
    // ODSTRAŇ všechny console.log o zjišťování
    // PONECHEJ pouze chyby:

    const unitsData = await this.getUnitsFromOverview();

    if (!unitsData) {
      logger.error('Nepodařilo se zjistit jednotky', this.accountName);
      return null;
    }

    // ODSTRAŇ printUnitsTable - není potřeba
    await this.saveUnitsToDatabase(unitsData);
    return unitsData;
  }
}
```

## Pravidla

1. **LOGUJ AKCE, NE KONTROLY**
   - ✅ Logger když narekrutuješ
   - ❌ Ne když jen kontroluješ co rekrutovat

2. **CHYBY VŽDY**
   - Všechny chyby loguj přes `logger.error()`

3. **USERNAME V KAŽDÉM LOGU**
   - Vždy přidej accountName jako druhý parametr
   - Získej ho z databáze: `this.db.getAccountById(this.accountId)?.username`

4. **MÉNĚ JE VÍCE**
   - Raději méně logů, které jsou důležité
   - Než hodně logů, které jen zahlcují konzoli

## Změna úrovně logování

V konzoli můžeš změnit úroveň:

```javascript
logger.setLevel("ERROR");  // Jen chyby
logger.setLevel("ACTION"); // Chyby + akce (DEFAULT)
logger.setLevel("INFO");   // Chyby + akce + info
logger.setLevel("DEBUG");  // Vše
```

## Výstup s novým loggingem

**ACTION úroveň (default):**
```
============================================================
🔄 Cyklus: 18.11.2025, 15:30:00
============================================================
✅ [BlazeRunner] 🎯 Rekrut: spear x100
✅ [BlazeRunner] 🏗️ Výstavba: Kasárny úroveň 10
✅ [BlazeRunner] 🔬 Výzkum: spear na úroveň 3
❌ [TestAccount] 🔐 CAPTCHA detekována - vyžaduje manuální řešení
✅ [AnotherAcc] ⚔️ Útok detekován! Počet útoků: 3

⏰ Další kontrola za 2 minut
```

**ERROR úroveň (jen chyby):**
```
❌ [TestAccount] 🔐 CAPTCHA detekována - vyžaduje manuální řešení
❌ [BlazeRunner] Chyba při výstavbě Kasárny
  └─ Error: Nedostatek surovin
```

**DEBUG úroveň (vše):**
```
============================================================
🔄 Cyklus: 18.11.2025, 15:30:00
============================================================
🔍 [BlazeRunner] Kontroluji účet
🔍 [BlazeRunner] Načítám hru...
🔍 [BlazeRunner] Přihlášen
🔍 [BlazeRunner] Statistiky aktualizovány
🔍 [BlazeRunner] Kontrola rekrutování
✅ [BlazeRunner] 🎯 Rekrut: spear x100
🔍 [BlazeRunner] Účet zpracován
...
```
