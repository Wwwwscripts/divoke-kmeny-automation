/**
 * Centralizovaný logger pro celou aplikaci
 * Úrovně: ERROR, ACTION, INFO, DEBUG
 */

class Logger {
  constructor() {
    // Úrovně logování (od nejdůležitějších po nejméně důležité)
    this.levels = {
      ERROR: 0,   // Chyby - vždy zobrazit
      ACTION: 1,  // Důležité akce (výstavba, rekrut, výzkum, paladin)
      INFO: 2,    // Informativní zprávy (přihlášení, statistiky)
      DEBUG: 3    // Debug zprávy (kontroly, navigace)
    };

    // Aktuální úroveň - zobrazí se pouze zprávy na této úrovni nebo nižší
    // ERROR = 0 (jen chyby)
    // ACTION = 1 (chyby + akce)
    // INFO = 2 (chyby + akce + info)
    // DEBUG = 3 (vše)
    this.currentLevel = this.levels.ACTION; // Default: chyby + akce

    // Emoji pro typy zpráv
    this.icons = {
      ERROR: '❌',
      ACTION: '✅',
      INFO: 'ℹ️',
      DEBUG: '🔍'
    };
  }

  /**
   * Nastaví úroveň logování
   */
  setLevel(level) {
    if (typeof level === 'string') {
      this.currentLevel = this.levels[level.toUpperCase()] ?? this.levels.ACTION;
    } else {
      this.currentLevel = level;
    }
  }

  /**
   * Interní metoda pro logování
   */
  _log(level, message, accountName = null, error = null) {
    // Zobrazíme pouze pokud je úroveň zprávy <= aktuální úroveň
    if (this.levels[level] > this.currentLevel) {
      return;
    }

    const timestamp = new Date().toLocaleString('cs-CZ', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });

    const icon = this.icons[level] || '';
    const prefix = accountName ? `[${accountName}]` : '';

    const fullMessage = `[${timestamp}] ${icon} ${prefix} ${message}`.trim();

    if (level === 'ERROR') {
      console.error(fullMessage);
      if (error) {
        console.error('  └─', error);
      }
    } else {
      console.log(fullMessage);
    }
  }

  /**
   * CHYBY - vždy se zobrazí
   */
  error(message, accountName = null, error = null) {
    this._log('ERROR', message, accountName, error);
  }

  /**
   * DŮLEŽITÉ AKCE - výstavba, rekrut, výzkum, paladin
   */
  action(message, accountName = null) {
    this._log('ACTION', message, accountName);
  }

  /**
   * INFORMACE - přihlášení, statistiky, útoky
   */
  info(message, accountName = null) {
    this._log('INFO', message, accountName);
  }

  /**
   * DEBUG - kontroly, navigace, rutinní operace
   */
  debug(message, accountName = null) {
    this._log('DEBUG', message, accountName);
  }

  /**
   * Speciální metody pro konkrétní akce
   */

  building(accountName, buildingName, level, timeRemaining = null) {
    const time = timeRemaining ? ` (hotovo za ${timeRemaining})` : '';
    this.action(`🏗️ Výstavba: ${buildingName} úroveň ${level}${time}`, accountName);
  }

  recruit(accountName, unitType, count, timeRemaining = null) {
    const time = timeRemaining ? ` (hotovo za ${timeRemaining})` : '';
    this.action(`🎯 Rekrut: ${unitType} x${count}${time}`, accountName);
  }

  research(accountName, unitType, level, timeRemaining = null) {
    const time = timeRemaining ? ` (hotovo za ${timeRemaining})` : '';
    this.action(`🔬 Výzkum: ${unitType} na úroveň ${level}${time}`, accountName);
  }

  paladin(accountName, skill, result) {
    this.action(`🤴 Paladin: ${skill} - ${result}`, accountName);
  }

  attack(accountName, count) {
    this.action(`⚔️ Útok detekován! Počet útoků: ${count}`, accountName);
  }

  captcha(accountName) {
    this.error(`🔐 CAPTCHA detekována - vyžaduje manuální řešení`, accountName);
  }

  /**
   * Separátor pro lepší čitelnost
   */
  separator() {
    if (this.currentLevel >= this.levels.DEBUG) {
      console.log('─'.repeat(60));
    }
  }

  /**
   * Header pro začátek cyklu
   */
  cycleStart() {
    if (this.currentLevel >= this.levels.INFO) {
      console.log('\n' + '='.repeat(60));
      console.log(`🔄 Cyklus: ${new Date().toLocaleString('cs-CZ')}`);
      console.log('='.repeat(60));
    }
  }

  /**
   * Footer pro konec cyklu
   */
  cycleEnd(nextCheckMinutes = 2) {
    if (this.currentLevel >= this.levels.INFO) {
      console.log(`\n⏰ Další kontrola za ${nextCheckMinutes} minut\n`);
    }
  }
}

// Singleton instance
const logger = new Logger();

// Export pro ES modules
export default logger;
