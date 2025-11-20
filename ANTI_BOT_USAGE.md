# Anti-Bot Maskování - Návod k použití

## 🎯 Přehled

Tento systém implementuje pokročilé techniky maskování automatizace:

1. **Canvas Fingerprinting** - Každý účet má unikátní canvas fingerprint
2. **Audio Fingerprinting** - Každý účet má unikátní audio fingerprint
3. **WebSocket Behavior** - Lidské časování akcí přes WebSocket
4. **Human Behavior** - Simulace lidského chování (myš, klávesnice, čtení)
5. **Anti-Bot Detection** - Detekce Cloudflare, hCaptcha, banů

---

## 📦 1. Automatické Maskování (už funguje)

**Canvas & Audio fingerprinting** jsou již **automaticky aktivní** ve všech browserech díky stealth scriptu:

```javascript
// src/browserManager.js, sharedBrowserPool.js, controlPanel.js
let fingerprint = db.getFingerprint(accountId);
if (!fingerprint) {
  fingerprint = generateFingerprint(); // Obsahuje canvasNoise + audioNoise
  db.saveFingerprint(accountId, fingerprint);
}

const stealthScript = createStealthScript(fingerprint); // Aktivuje maskování
await context.addInitScript(stealthScript);
```

✅ **Každý účet má nyní:**
- Unikátní canvas fingerprint (RGB noise)
- Unikátní audio fingerprint (frequency noise)
- Unikátní font metrics
- Všechno uložené v DB a konzistentní mezi běhy

---

## 🎭 2. Human Behavior - Ruční použití

Pro **kritické akce** kde chceš vypadat extra lidsky:

### Lidský klik místo obyčejného click()

```javascript
import { humanClick, humanType, simulateReading } from './utils/humanBehavior.js';

// ❌ BOT-LIKE (instant, pixel-perfect)
await page.click('#attack-button');

// ✅ HUMAN-LIKE (Bézier curve, random position, 50-120ms timing)
await humanClick(page, '#attack-button');
```

### Lidské psaní místo type()

```javascript
// ❌ BOT-LIKE (instant)
await page.fill('#message', 'Hello');

// ✅ HUMAN-LIKE (char by char, 5% chyby, pauzy po interpunkci)
await humanType(page, '#message', 'Hello world!');
```

### Simulace čtení stránky

```javascript
// Před důležitou akcí simuluj že čteš stránku
await simulateReading(page, 3000); // 3 sekundy čtení (scroll + pohyby myší)
await humanClick(page, '#important-button');
```

---

## 🌐 3. WebSocket Behavior - Lidské časování

Pro **game actions přes WebSocket** (rekrutování, útoky, atd.):

### Setup WebSocket interceptor

```javascript
import { setupWebSocketInterceptor } from './utils/webSocketBehavior.js';

// Při vytváření browseru
const page = await context.newPage();

// Aktivuj WebSocket humanization
await setupWebSocketInterceptor(page, {
  autoHumanize: true,      // Automaticky přidej delay do všech WS zpráv
  minDelay: 200,           // Min 200ms mezi akcemi
  maxDelay: 1500,          // Max 1500ms
  enableIdleBehavior: true,// Občas simuluj AFK
  logActions: false        // Debug logging
});
```

### Použití Action Manager (pokročilé)

Pro **přesnou kontrolu** nad timing patterns:

```javascript
import { WebSocketActionManager } from './utils/webSocketBehavior.js';

// Získej WebSocket connection (z game)
const ws = await page.evaluate(() => {
  // Find existing WS connection
  return window.gameWebSocket; // nebo jak se jmenuje
});

// Vytvoř action manager
const actionManager = new WebSocketActionManager(ws);

// Queue actions s human timing
await actionManager.queueAction(
  { type: 'recruit', unit: 'spear', count: 10 },
  {
    minDelay: 500,
    maxDelay: 2000,
    actionType: 'click',
    priority: 'normal'
  }
);

await actionManager.queueAction(
  { type: 'attack', target: 'village123' },
  {
    minDelay: 2000,
    maxDelay: 5000,
    actionType: 'form_submit',
    priority: 'normal'
  }
);

// Občas simuluj AFK (náhodně každých 5-15 min)
actionManager.startRandomIdleBehavior();

// Získej statistiky
console.log(actionManager.getStats());
```

---

## 🔍 4. Anti-Bot Detection

Kontrola zda hra/server detekoval bot:

### Základní check

```javascript
import { detectAnyChallenge, detectBan } from './utils/antiBot.js';

// Po načtení stránky
const challenges = await detectAnyChallenge(page);

if (challenges.cloudflare.detected) {
  console.log('⚠️ Cloudflare challenge detected!');
  // Čekej na vyřešení nebo otevři visible browser
}

if (challenges.hcaptcha.detected) {
  console.log('⚠️ hCaptcha detected!');
  console.log('Sitekey:', challenges.hcaptcha.sitekey);
  // Integrace s 2Captcha solver
}

// Check ban
const banInfo = await detectBan(page);
if (banInfo.detected) {
  console.log('🚫 Account banned!');
  console.log('IP ban:', banInfo.ipBan);
}
```

### Komplexní security check

```javascript
import { performSecurityCheck } from './utils/antiBot.js';

const report = await performSecurityCheck(page);

console.log('Status:', report.status); // 'ok' | 'challenge' | 'banned'
console.log('Challenges:', report.challenges);
console.log('WebSocket active:', report.websocket.likelyMonitoring);

// Ulož report do DB pro analýzu
if (report.status === 'banned') {
  db.markAccountBanned(accountId, report);
}
```

---

## 🎯 5. Integrace do existujícího kódu

### Příklad: Rekrutování s human behavior

**Před (bot-like):**
```javascript
// src/modules/recruit.js
await page.click(`a[href*="train"]`);
await page.click('input[name="spear"]');
await page.fill('input[name="spear"]', '10');
await page.click('.btn-recruit');
```

**Po (human-like):**
```javascript
// src/modules/recruit.js
import { humanClick, humanType, simulateReading, humanWait } from '../utils/humanBehavior.js';

// Simuluj že čteš stránku
await simulateReading(page, 2000);

// Lidský klik na train
await humanClick(page, `a[href*="train"]`);

// Čekej s mikro-interakcemi
await humanWait(page, 500, 300);

// Klikni na jednotku
await humanClick(page, 'input[name="spear"]');

// Lidské psaní počtu
await humanType(page, 'input[name="spear"]', '10');

// Pauza před submitnutím (jako když člověk kontroluje)
await humanWait(page, 1000, 500);

// Submit
await humanClick(page, '.btn-recruit');
```

### Příklad: Attack s WebSocket timing

```javascript
// src/modules/attack.js
import { setupWebSocketInterceptor } from '../utils/webSocketBehavior.js';

async function sendAttack(page, target, units) {
  // Setup WS interceptor pokud ještě není
  await setupWebSocketInterceptor(page, {
    autoHumanize: true,
    minDelay: 500,
    maxDelay: 2000
  });

  // Teď všechny WS zprávy budou mít human timing
  await page.evaluate((target, units) => {
    // Game WS send (automaticky zpomaleno interceptorem)
    gameWebSocket.send(JSON.stringify({
      action: 'attack',
      target: target,
      units: units
    }));
  }, target, units);
}
```

---

## 📊 6. Monitoring a Debug

### Check fingerprints v DB

```javascript
import DatabaseManager from './database.js';
const db = new DatabaseManager();

// Získej fingerprint účtu
const fingerprint = db.getFingerprint(accountId);
console.log('Canvas noise:', fingerprint.canvasNoise);
console.log('Audio noise:', fingerprint.audioNoise);
console.log('User Agent:', fingerprint.userAgent);
```

### Monitor WebSocket traffic

```javascript
import { monitorWebSocketTraffic } from './utils/webSocketBehavior.js';

// Monitor WS traffic na 10 sekund
const messages = await monitorWebSocketTraffic(page, 10000);

console.log('Sent:', messages.sent.length);
console.log('Received:', messages.received.length);

// Analýza timing patterns
const timings = messages.sent.map((msg, i) => {
  if (i === 0) return 0;
  return msg.timestamp - messages.sent[i - 1].timestamp;
});

console.log('Average delay:', timings.reduce((a, b) => a + b, 0) / timings.length);
```

### Test canvas fingerprint v konzoli

Otevři browser console a spusť:

```javascript
// Test canvas fingerprint
const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d');
canvas.width = 200;
canvas.height = 50;

ctx.textBaseline = 'top';
ctx.font = '14px Arial';
ctx.fillText('Test fingerprint 🎯', 2, 2);

const dataURL = canvas.toDataURL();
console.log('Canvas fingerprint hash:', dataURL.substring(0, 100));

// Každý účet by měl mít jiný hash!
```

---

## ✅ Co máme NYNÍ aktivní

| Technika | Status | Automatické | Ruční použití |
|----------|--------|-------------|---------------|
| Canvas fingerprinting | ✅ | ✅ Ano | - |
| Audio fingerprinting | ✅ | ✅ Ano | - |
| Font fingerprinting | ✅ | ✅ Ano | - |
| WebDriver masking | ✅ | ✅ Ano | - |
| Playwright flags removal | ✅ | ✅ Ano | - |
| Unique User Agents | ✅ | ✅ Ano | - |
| Unique fingerprints per účet | ✅ | ✅ Ano | - |
| Human mouse movement | ✅ | ❌ Ne | ✅ Možné |
| Human typing | ✅ | ❌ Ne | ✅ Možné |
| Human clicking | ✅ | ❌ Ne | ✅ Možné |
| Reading simulation | ✅ | ❌ Ne | ✅ Možné |
| WebSocket timing | ✅ | ❌ Ne | ✅ Možné |
| Idle/AFK behavior | ✅ | ❌ Ne | ✅ Možné |
| Cloudflare detection | ✅ | ❌ Ne | ✅ Možné |
| hCaptcha detection | ✅ | ❌ Ne | ✅ Možné |
| Ban detection | ✅ | ❌ Ne | ✅ Možné |

---

## 🚀 Next Steps (volitelné)

1. **Integruj human behavior do kritických modulů** (recruit, attack, market)
2. **Setup WebSocket interceptor globálně** v browserManager
3. **Add ban monitoring** do main loop (sleduj report.status)
4. **2Captcha integration** pokud se objeví hCaptcha
5. **Monitoring dashboard** pro sledování fingerprints a detections

---

## 🎓 Jak fungují Fingerprinty

### Canvas Fingerprinting

Bot detekce vytvoří canvas, nakreslí text, a udělá hash z výsledku.
Každý browser má mírně jiný rendering kvůli GPU/fonty/anti-aliasing.

**Bez obrany:** Všechny tvoje účty = stejný hash = BOT!
**S naší obranou:** Každý účet má jiný noise → jiný hash → vypadají jako různé browsery ✅

### Audio Fingerprinting

Bot detekce vytvoří AudioContext, vygeneruje tón, a udělá hash z audio dat.
Každý browser má mírně jiné audio processing.

**Bez obrany:** Všechny účty = stejný audio hash = BOT!
**S naší obranou:** Každý účet má jiný audio noise → jiný hash ✅

### WebSocket Timing

Hra monitoruje časování mezi akcemi přes WebSocket.

**Bez obrany:** Instant odpovědi, stejný pattern = BOT!
**S naší obranou:** Randomizovaný timing, pattern breaking, idle periods = HUMAN ✅

---

**Otázky? Připomínky? Napište do issues!** 😄
