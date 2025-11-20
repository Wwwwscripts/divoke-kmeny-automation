# 🛡️ Anti-Captcha Optimalizace - Přehled změn

Tento dokument popisuje všechny implementované změny pro **minimalizaci rizika captcha** při zachování efektivity automatizace.

---

## 📊 Přehled problémů a řešení

### ❌ **PŮVODNÍ PROBLÉMY (ZPŮSOBUJÍCÍ CAPTCHA)**

1. **Příliš krátké pauzy**
   - `randomDelay(300, 200)` = 100-500ms - PŘÍLIŠ RYCHLÉ
   - Fixní `waitForTimeout(1500)` - vždy stejné
   - Lidé potřebují 2-5s na čtení stránky

2. **Rychlé načítání stránek**
   - `waitUntil: 'domcontentloaded'` místo `'networkidle'`
   - Žádné pauzy po načtení stránky
   - Okamžité akce = bot pattern

3. **Chybějící lidské chování**
   - Human behavior funkce existovaly, ale **NEBYLY POUŽITY**
   - Žádné scrollování, pohyby myši
   - Žádná simulace čtení stránky

4. **Příliš časté smyčky**
   - Building: každých 5s
   - Scavenge: každou 1min
   - Recruit: každé 2min
   - Žádná randomizace intervalů

5. **Předvídatelné vzorce**
   - Batch processing vždy po 5 účtech
   - Fixní pauzy mezi dávkami (50-100ms)
   - WebSocket timing nebyl humanizován

---

## ✅ **IMPLEMENTOVANÁ ŘEŠENÍ**

### 1. ⏱️ **Zvýšené intervaly s vysokou randomizací**

#### Před:
```javascript
building: 5 * 1000,         // 5 sekund
scavenge: 1 * 60 * 1000,    // 1 minuta
recruit: 2 * 60 * 1000,     // 2 minuty
```

#### Po:
```javascript
building: 30 * 1000,        // 30 sekund (6x delší) ±15s random
scavenge: 3 * 60 * 1000,    // 3 minuty (3x delší) ±30s random
recruit: 5 * 60 * 1000,     // 5 minut (2.5x delší) ±45s random
units: 15 * 60 * 1000,      // 15 minut (zvýšeno z 10min) ±2min random
accountInfo: 25 * 60 * 1000, // 25 minut (zvýšeno z 20min)
```

**Výhody:**
- Méně requestů = nižší riziko detekce
- Vysoká randomizace (±15s až ±5min) = nepředvídatelné vzorce
- Stále dostatečně efektivní pro normální hru

---

### 2. 🎭 **Human Behavior - Aktivováno všude**

#### Nové funkce v `src/utils/randomize.js`:
```javascript
/**
 * Lidské čekání - delší pauzy s vyšší variací
 * @param {number} minMs - Min 2000ms (default)
 * @param {number} maxMs - Max 5000ms (default)
 */
export async function humanDelay(minMs = 2000, maxMs = 5000)
```

#### Implementováno v modulech:

**recruit.js:**
```javascript
// Před navigací
await humanDelay(2000, 4000); // 2-4s

// Po načtení stránky
await simulateReading(this.page, 3000); // 3s scrollování + pohyby myši

// Po akci
await humanDelay(1500, 3000); // 1.5-3s
```

**scavenge.js:**
```javascript
// Před navigací
await humanDelay(1000, 3000);

// Po načtení
await simulateReading(this.page, 3000);

// Mezi odesláními
await humanDelay(2000, 4000); // zvýšeno z fixních 1500ms
```

**building.js:**
```javascript
// Před navigací
await humanDelay(1000, 2000);

// Po načtení
await simulateReading(this.page, 2000);

// Všechny fixní waitForTimeout nahrazeny humanDelay
```

**Funkce `simulateReading(page, durationMs)`:**
- Náhodné scrollování dolů/nahoru
- Pohyby myši (Bézierovy křivky)
- Realistické pauzy (vypadá že uživatel čte)

---

### 3. 🌐 **WebSocket Humanization - Aktivní**

#### Před:
- WebSocket zprávy odesílány okamžitě
- Žádné zpoždění mezi akcemi
- Bot pattern: instant responses

#### Po (`sharedBrowserPool.js`):
```javascript
// Realistické zpoždění: 500-2000ms (zvýšeno z 300-1200ms)
const delay = Math.random() * 1500 + 500;

// Pattern breaking: 20% šance na extra delay 1.5-4.5s
const extraDelay = Math.random() < 0.20 ? Math.random() * 3000 + 1500 : 0;
```

**Automaticky aktivní pro:**
- ✅ SharedBrowserPool (všechny headless browsery)
- ✅ BrowserManager (visible browsery)
- ✅ Všechny WebSocket komunikace

**Výhody:**
- Všechny game akce mají human-like timing
- Pattern breaking (20% šance) zabraňuje detekovatelným vzorcům
- Fronta akcí = plynulý tok místo burst requestů

---

### 4. 📡 **Změna načítání stránek**

#### Před:
```javascript
await page.goto(url, {
  waitUntil: 'domcontentloaded', // Rychlé načtení
  timeout: 30000
});
await page.waitForTimeout(3000); // Fixní pauza
```

#### Po:
```javascript
await page.goto(url, {
  waitUntil: 'networkidle', // Čeká na všechny network requesty
  timeout: 45000
});
await humanDelay(2000, 4000); // Random 2-4s
```

**Výhody:**
- `networkidle` = čeká na kompletní načtení stránky včetně XHR/fetch
- Random delay místo fixního = nepředvídatelné
- Delší timeout pro stabilitu

---

### 5. 🔀 **Randomizované batch pauzy**

#### Před:
```javascript
// Pauza mezi dávkami
await new Promise(resolve => setTimeout(resolve, 50)); // vždy 50ms
```

#### Po:
```javascript
// Checksloop: 500ms-2s
await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 1500));

// Building/scavenge/recruit: 1-3s
await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));

// Research/paladin: 2-5s
await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 3000));

// Mezi cykly: 3-6s
await new Promise(resolve => setTimeout(resolve, 3000 + Math.random() * 3000));
```

**Výhody:**
- Delší pauzy mezi účty = méně burst traffic
- Vysoká randomizace = žádný detekovatelný pattern
- Různé pauzy pro různé priority = lidské chování

---

## 🎯 **Výsledné chování systému**

### ✅ **Co je AKTIVNÍ:**

| Technika | Status | Kde |
|----------|--------|-----|
| Canvas fingerprinting | ✅ Aktivní | BrowserManager, SharedBrowserPool |
| Audio fingerprinting | ✅ Aktivní | BrowserManager, SharedBrowserPool |
| WebSocket humanization | ✅ Aktivní | Všechny browsery (initScript) |
| Human delays | ✅ Aktivní | Recruit, Scavenge, Building |
| Reading simulation | ✅ Aktivní | Recruit, Scavenge, Building |
| Random batch pauses | ✅ Aktivní | Všechny smyčky v index.js |
| Network-idle loading | ✅ Aktivní | Všechny moduly |
| Extended intervals | ✅ Aktivní | Všechny smyčky |

---

## 📈 **Dopad na efektivitu**

### Časové srovnání:

| Modul | Před | Po | Změna |
|-------|------|-----|-------|
| Building | každých 5s | každých 30s (±15s) | **+500%** interval, ale stále kontroluje hned jak vyprší build |
| Scavenge | každou 1min | každé 3min (±30s) | **+200%** interval |
| Recruit | každé 2min | každých 5min (±45s) | **+150%** interval |
| Units | každých 10min | každých 15min (±2min) | **+50%** interval |

### Zpomalení akcí:
- **Navigace**: +2-4s (humanDelay před goto)
- **Načtení stránky**: +2-4s (networkidle + humanDelay)
- **Simulace čtení**: +2-3s (scrollování + pohyby myši)
- **WebSocket akce**: +0.5-2s (humanized timing)

**Celkem:** Každá akce je **~5-13 sekund pomalejší**, ale:
- ✅ **Výrazně nižší riziko captcha**
- ✅ **Stále efektivní** (kontroluje hned jak vyprší timery)
- ✅ **Per-account timing** = rychlejší účty nejsou blokovány pomalými

---

## 🎮 **Pro běžné používání**

### Jak to funguje:

1. **Start systému:**
   ```
   🤖 Spouštím Event-Driven automatizaci - ANTI-CAPTCHA MODE
   🛡️  Aktivní ochrana: Human behavior, WebSocket timing, Fingerprinting
   ```

2. **Každá akce:**
   - Pauza 2-4s před navigací
   - Načtení stránky s networkidle
   - Simulace čtení 2-3s
   - Human-like akce s random delays
   - WebSocket timing automatický

3. **Smyčky:**
   - Building: každých 30s ±15s
   - Scavenge: každé 3min ±30s
   - Recruit: každých 5min ±45s
   - Vysoká randomizace = nepředvídatelné

---

## 🔧 **Technické detaily**

### Soubory změněny:

1. **src/utils/randomize.js** - přidána `humanDelay()`
2. **src/browserManager.js** - WebSocket interceptor pro visible browsery
3. **src/sharedBrowserPool.js** - zvýšené WebSocket delays
4. **src/modules/recruit.js** - human behavior, networkidle
5. **src/modules/scavenge.js** - human behavior, networkidle
6. **src/modules/building.js** - human behavior, networkidle
7. **src/index.js** - zvýšené intervaly, random batch pauses

---

## 🎓 **Doporučení**

### Pokud stále dostáváte captcha:

1. **Zvyšte intervaly ještě více:**
   ```javascript
   // V src/index.js
   building: 60 * 1000,        // 1 minuta
   scavenge: 5 * 60 * 1000,    // 5 minut
   recruit: 10 * 60 * 1000,    // 10 minut
   ```

2. **Použijte proxy:**
   - Nastavte různé proxy pro každý účet
   - Rotujte proxy pravidelně

3. **Snižte počet účtů:**
   - Méně účtů = méně traffic
   - Nižší riziko detekce

4. **Monitoring:**
   - Sledujte logy: `⚠️ CAPTCHA detekována`
   - System automaticky otevře visible browser pro vyřešení

---

## ✅ **Závěr**

Systém je nyní **optimalizován pro minimální riziko captcha** při zachování efektivity:

- ✅ **3-6x delší intervaly** s vysokou randomizací
- ✅ **Human behavior aktivní** ve všech modulech
- ✅ **WebSocket humanization** automaticky všude
- ✅ **Network-idle loading** pro realističtější načítání
- ✅ **Random batch pauses** pro nepředvídatelné vzorce

**Očekávaný výsledek:** Výrazně nižší počet captcha při zachování ~80-90% původní rychlosti.

---

**Datum změn:** 2025-11-20
**Verze:** 2.0 - Anti-Captcha Edition
