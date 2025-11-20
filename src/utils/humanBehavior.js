/**
 * Human-like behavior utilities
 * Pomáhá maskovat automatizaci přidáním lidského chování
 */

import { randomRange, randomDelay } from './randomize.js';

/**
 * Simuluje lidský pohyb myši od aktuální pozice k cíli
 * Používá Bézierovu křivku pro přirozenější pohyb
 */
export async function humanMouseMove(page, targetX, targetY) {
  try {
    // Získej aktuální pozici myši (nebo použij náhodnou počáteční)
    const startX = Math.floor(Math.random() * 800);
    const startY = Math.floor(Math.random() * 600);

    // Počet kroků - větší vzdálenost = více kroků
    const distance = Math.sqrt(Math.pow(targetX - startX, 2) + Math.pow(targetY - startY, 2));
    const steps = Math.max(10, Math.floor(distance / 20));

    // Generuj Bézierovu křivku pro přirozený pohyb
    const controlPoint1X = startX + (targetX - startX) * 0.3 + (Math.random() - 0.5) * 100;
    const controlPoint1Y = startY + (targetY - startY) * 0.3 + (Math.random() - 0.5) * 100;
    const controlPoint2X = startX + (targetX - startX) * 0.7 + (Math.random() - 0.5) * 100;
    const controlPoint2Y = startY + (targetY - startY) * 0.7 + (Math.random() - 0.5) * 100;

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;

      // Bézierova křivka
      const x = Math.pow(1 - t, 3) * startX +
                3 * Math.pow(1 - t, 2) * t * controlPoint1X +
                3 * (1 - t) * Math.pow(t, 2) * controlPoint2X +
                Math.pow(t, 3) * targetX;

      const y = Math.pow(1 - t, 3) * startY +
                3 * Math.pow(1 - t, 2) * t * controlPoint1Y +
                3 * (1 - t) * Math.pow(t, 2) * controlPoint2Y +
                Math.pow(t, 3) * targetY;

      await page.mouse.move(x, y);

      // Krátké zpoždění mezi pohyby (1-5ms)
      await new Promise(r => setTimeout(r, randomRange(1, 5)));
    }

    // Malé "třesení" na konci (lidé netrefí pixel perfect)
    await page.mouse.move(
      targetX + (Math.random() - 0.5) * 2,
      targetY + (Math.random() - 0.5) * 2
    );
  } catch (error) {
    // Pokud selže, prostě přesuň myš přímo
    await page.mouse.move(targetX, targetY);
  }
}

/**
 * Lidský klik s realistickým timingem
 */
export async function humanClick(page, selector, options = {}) {
  const element = await page.$(selector);
  if (!element) {
    throw new Error(`Element not found: ${selector}`);
  }

  // Získej pozici elementu
  const box = await element.boundingBox();
  if (!box) {
    // Fallback na obyčejný klik
    await element.click(options);
    return;
  }

  // Náhodný bod uvnitř elementu (ne přesně střed!)
  const x = box.x + box.width * (0.3 + Math.random() * 0.4);
  const y = box.y + box.height * (0.3 + Math.random() * 0.4);

  // Pohyb myši k elementu
  await humanMouseMove(page, x, y);

  // Malá pauza před klikem (50-150ms)
  await randomDelay(100, 50);

  // Realistická délka kliknutí (50-120ms mezi mousedown a mouseup)
  await page.mouse.down();
  await new Promise(r => setTimeout(r, randomRange(50, 120)));
  await page.mouse.up();

  // Malá pauza po kliku
  await randomDelay(50, 30);
}

/**
 * Lidské psaní textu s realistickými pauzami
 */
export async function humanType(page, selector, text, options = {}) {
  const element = await page.$(selector);
  if (!element) {
    throw new Error(`Element not found: ${selector}`);
  }

  // Klikni na element nejdřív
  await humanClick(page, selector);

  // Vyčisti pole (někdy)
  if (Math.random() > 0.3) {
    await page.keyboard.press('Control+A');
    await randomDelay(50, 30);
  }

  // Piš znak po znaku
  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    // Realistické zpoždění mezi znaky (50-200ms, rychlejší u rutinního textu)
    const delay = randomRange(50, 200);

    // Občas udělej chybu a opravu (5% šance)
    if (Math.random() < 0.05 && i > 0) {
      // Napi špatný znak
      await page.keyboard.type('x');
      await randomDelay(100, 50);
      // Smaž ho
      await page.keyboard.press('Backspace');
      await randomDelay(150, 50);
    }

    await page.keyboard.type(char);
    await new Promise(r => setTimeout(r, delay));

    // Delší pauza po interpunkci nebo mezerách (lidé přemýšlí)
    if (['.', ',', ' ', '!', '?'].includes(char)) {
      await randomDelay(200, 100);
    }
  }
}

/**
 * Náhodné scrollování stránky (vypadá lidsky)
 */
export async function humanScroll(page, direction = 'down', distance = null) {
  const scrollDistance = distance || randomRange(100, 500);
  const steps = randomRange(5, 15);
  const stepSize = scrollDistance / steps;

  for (let i = 0; i < steps; i++) {
    await page.evaluate((step, dir) => {
      window.scrollBy(0, dir === 'down' ? step : -step);
    }, stepSize, direction);

    // Zpoždění mezi scroll kroky (20-60ms)
    await new Promise(r => setTimeout(r, randomRange(20, 60)));
  }

  // Někdy scrollni o malý kousek zpět (lidé přestřelí a vracejí se)
  if (Math.random() < 0.2) {
    await randomDelay(100, 50);
    await page.evaluate((step, dir) => {
      window.scrollBy(0, dir === 'down' ? -step : step);
    }, stepSize * 0.3, direction);
  }
}

/**
 * Náhodný pohyb myší po stránce (vypadá že uživatel čte)
 */
export async function randomMouseMovement(page, duration = 2000) {
  const startTime = Date.now();

  while (Date.now() - startTime < duration) {
    const x = randomRange(100, 1200);
    const y = randomRange(100, 800);

    await humanMouseMove(page, x, y);
    await randomDelay(500, 300);
  }
}

/**
 * Simulace čtení stránky (scroll + pohyb myší + pauzy)
 */
export async function simulateReading(page, durationMs = 5000) {
  const endTime = Date.now() + durationMs;

  while (Date.now() < endTime) {
    // Náhodně scrolluj dolů
    if (Math.random() < 0.6) {
      await humanScroll(page, 'down', randomRange(50, 200));
      await randomDelay(800, 400);
    }

    // Pohni myší (jako když čteš a sleduješ kurzorem)
    const x = randomRange(200, 800);
    const y = randomRange(200, 600);
    await humanMouseMove(page, x, y);

    // Pauza (jako když čteš text)
    await randomDelay(1000, 500);

    // Občas scrollni zpět nahoru (znovu čteš něco)
    if (Math.random() < 0.15) {
      await humanScroll(page, 'up', randomRange(30, 100));
      await randomDelay(500, 300);
    }
  }
}

/**
 * Čekání s náhodnými mikro-interakcemi (vypadá že uživatel čeká na načtení)
 */
export async function humanWait(page, baseMs, variation = 1000) {
  const waitTime = baseMs + (Math.random() - 0.5) * variation;
  const endTime = Date.now() + waitTime;

  while (Date.now() < endTime) {
    // Občas pohni myší
    if (Math.random() < 0.3) {
      const x = randomRange(300, 900);
      const y = randomRange(200, 700);
      await humanMouseMove(page, x, y);
    }

    await randomDelay(500, 200);
  }
}

export default {
  humanMouseMove,
  humanClick,
  humanType,
  humanScroll,
  randomMouseMovement,
  simulateReading,
  humanWait
};
