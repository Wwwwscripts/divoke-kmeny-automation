/**
 * Utility funkce pro randomizaci timingu
 * Pomáhá zamaskovat bot behavior přidáním náhodné variace
 */

/**
 * Vrátí číslo v rozsahu baseValue ± variation%
 * @param {number} baseValue - Základní hodnota v milisekundách
 * @param {number} variationPercent - Variace v procentech (default ±20%)
 * @returns {number} Randomizovaná hodnota
 */
export function randomizeInterval(baseValue, variationPercent = 20) {
  const variation = baseValue * (variationPercent / 100);
  const min = baseValue - variation;
  const max = baseValue + variation;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Vrátí náhodné číslo mezi min a max (včetně)
 * @param {number} min - Minimální hodnota
 * @param {number} max - Maximální hodnota
 * @returns {number} Náhodné číslo
 */
export function randomRange(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Počká náhodnou dobu v rozsahu baseDelay ± variation
 * @param {number} baseDelay - Základní prodleva v ms
 * @param {number} variation - Variace v ms (default ±1 sekunda)
 * @returns {Promise<void>}
 */
export async function randomDelay(baseDelay, variation = 1000) {
  const delay = randomizeInterval(baseDelay, variation);
  return new Promise(resolve => setTimeout(resolve, delay));
}

export default {
  randomizeInterval,
  randomRange,
  randomDelay
};
