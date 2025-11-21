/**
 * Modul pro automatické odesílání podpory do vesnic
 * Používá rally point (place) obrazovku pro odesílání jednotek
 */

import logger from '../logger.js';

class SupportSender {
  constructor(page, db, accountId) {
    this.page = page;
    this.db = db;
    this.accountId = accountId;
    this.accountName = null;
  }

  /**
   * Získá username pro logging
   */
  getAccountName() {
    if (!this.accountName) {
      const account = this.db.getAccount(this.accountId);
      this.accountName = account?.username || `ID:${this.accountId}`;
    }
    return this.accountName;
  }

  /**
   * Získá URL světa (podporuje CZ i SK)
   */
  getWorldUrl() {
    const currentUrl = this.page.url();

    // Zkus najít CZ svět
    let match = currentUrl.match(/\/\/([^.]+)\.divokekmeny\.cz/);
    if (match) {
      return `https://${match[1]}.divokekmeny.cz`;
    }

    // Zkus najít SK svět
    match = currentUrl.match(/\/\/([^.]+)\.divoke-kmene\.sk/);
    if (match) {
      return `https://${match[1]}.divoke-kmene.sk`;
    }

    throw new Error('Nepodařilo se zjistit svět (ani CZ ani SK)');
  }

  /**
   * Získá村ID z page objektu
   */
  async getVillageId() {
    return await this.page.evaluate(() => {
      return game_data.village.id;
    });
  }

  /**
   * Odeslat podporu do vesnice
   * @param {string} unitType - Typ jednotky (spear, sword, axe, archer, spy, light, marcher, heavy, ram, catapult, knight, snob)
   * @param {number} targetX - Cílová X souřadnice
   * @param {number} targetY - Cílová Y souřadnice
   * @param {number} count - Počet jednotek (výchozí: 1)
   */
  async sendSupport(unitType, targetX, targetY, count = 1) {
    try {
      // BEZPEČNOSTNÍ KONTROLA: Zkontroluj captcha PŘED odesláním podpory
      const NotificationsModule = (await import('./notifications.js')).default;
      const notificationsModule = new NotificationsModule(this.page, this.db, this.accountId);
      const hasCaptcha = await notificationsModule.detectCaptcha();

      if (hasCaptcha) {
        logger.warn('⚠️ Captcha detekována před odesláním podpory - přerušuji', this.getAccountName());
        return { success: false, captchaDetected: true, error: 'Captcha detekována' };
      }

      const worldUrl = this.getWorldUrl();
      const villageId = await this.getVillageId();

      logger.info(`Odesílám podporu: ${count}x ${unitType} na ${targetX}|${targetY}`, this.getAccountName());

      // Přejít na rally point
      const placeUrl = `${worldUrl}/game.php?village=${villageId}&screen=place`;
      await this.page.goto(placeUrl, { waitUntil: 'domcontentloaded' });
      await this.page.waitForTimeout(1000);

      // Zjistit, jestli máme dostatek jednotek
      const availableUnits = await this.page.evaluate((unit) => {
        const unitInput = document.querySelector(`input[name="${unit}"]`);
        if (!unitInput) return 0;

        // Najít text "(X)" vedle inputu, který ukazuje dostupné jednotky
        const linkElement = unitInput.closest('td')?.nextElementSibling?.querySelector('a');
        if (linkElement) {
          const match = linkElement.textContent.match(/\((\d+)\)/);
          if (match) return parseInt(match[1]);
        }
        return 0;
      }, unitType);

      if (availableUnits === 0) {
        logger.warning(`Žádné dostupné jednotky typu ${unitType}`, this.getAccountName());
        throw new Error(`Žádné dostupné jednotky typu ${unitType}`);
      }

      if (availableUnits < count) {
        logger.warning(`Nedostatek jednotek: požadováno ${count}, dostupných ${availableUnits}`, this.getAccountName());
        count = availableUnits; // Použít maximum dostupných
      }

      // Vyplnit formulář
      await this.page.evaluate(({ unit, amount, x, y }) => {
        // Vyplnit počet jednotek
        const unitInput = document.querySelector(`input[name="${unit}"]`);
        if (unitInput) {
          unitInput.value = amount;
        }

        // Vyplnit souřadnice
        const xInput = document.querySelector('input[name="x"]');
        const yInput = document.querySelector('input[name="y"]');
        if (xInput) xInput.value = x;
        if (yInput) yInput.value = y;
      }, { unit: unitType, amount: count, x: targetX, y: targetY });

      await this.page.waitForTimeout(500);

      // Kliknout na tlačítko "Útok/Podpora"
      const submitButton = await this.page.$('input[type="submit"][value*="ttack"], input[type="submit"][value*="tok"], input[type="submit"][value*="Support"], input[type="submit"][value*="Podpora"]');

      if (!submitButton) {
        logger.error('Nenalezeno tlačítko pro odeslání', this.getAccountName());
        throw new Error('Nenalezeno tlačítko pro odeslání');
      }

      await submitButton.click();
      await this.page.waitForTimeout(2000);

      // Ověřit, že jsme na potvrzovací stránce
      const currentUrl = this.page.url();
      if (!currentUrl.includes('try=confirm')) {
        logger.error('Nepovedlo se přejít na potvrzovací stránku', this.getAccountName());
        throw new Error('Nepovedlo se přejít na potvrzovací stránku');
      }

      // Zkontrolovat, jestli je to podpora (ne útok)
      const isSupport = await this.page.evaluate(() => {
        // Hledat text "Podpora" nebo "Support" na stránce
        const bodyText = document.body.innerText;
        return bodyText.includes('Podpora') || bodyText.includes('Support');
      });

      if (!isSupport) {
        logger.error('Detekován útok místo podpory - přerušuji', this.getAccountName());
        throw new Error('Detekován útok místo podpory');
      }

      // Potvrdit odeslání
      const confirmButton = await this.page.$('input[type="submit"][id="troop_confirm_submit"]');

      if (!confirmButton) {
        logger.error('Nenalezeno potvrzovací tlačítko', this.getAccountName());
        throw new Error('Nenalezeno potvrzovací tlačítko');
      }

      await confirmButton.click();
      await this.page.waitForTimeout(2000);

      // Ověřit úspěch
      const success = await this.page.evaluate(() => {
        // Hledat zprávu o úspěšném odeslání
        const bodyText = document.body.innerText;
        return bodyText.includes('Command sent') ||
               bodyText.includes('Příkaz odeslán') ||
               bodyText.includes('Rozkaz odoslaný');
      });

      if (success) {
        logger.success(`✅ Podpora odeslána: ${count}x ${unitType} na ${targetX}|${targetY}`, this.getAccountName());
        return { success: true, count, unitType, targetX, targetY };
      } else {
        logger.error('Podpora nebyla odeslána', this.getAccountName());
        throw new Error('Podpora nebyla odeslána');
      }

    } catch (error) {
      logger.error(`Chyba při odesílání podpory: ${error.message}`, this.getAccountName());
      throw error;
    }
  }

  /**
   * Otevřít ruční odeslání podpory (vyplní formulář ale NEodešle)
   * @param {Array<string>} unitTypes - Pole typů jednotek
   * @param {number} targetX - Cílová X souřadnice
   * @param {number} targetY - Cílová Y souřadnice
   */
  async openManualSupport(unitTypes, targetX, targetY) {
    try {
      const worldUrl = this.getWorldUrl();

      logger.info(`Otevírám ruční odeslání: ${unitTypes.join(', ')} na ${targetX}|${targetY}`, this.getAccountName());

      // Získat počty jednotek z databáze
      const account = this.db.getAccount(this.accountId);
      const unitCounts = {};

      if (account.units_info) {
        try {
          const unitsInfo = JSON.parse(account.units_info);
          unitTypes.forEach(unit => {
            const count = unitsInfo[unit]?.inVillages || 0;
            if (count > 0) {
              unitCounts[unit] = count;
            }
          });
        } catch (e) {
          logger.error(`Chyba při parsování units_info: ${e.message}`, this.getAccountName());
        }
      }

      // Sestavit URL s parametry pro jednotky a souřadnice
      const params = new URLSearchParams();
      params.append('screen', 'place');
      params.append('x', targetX);
      params.append('y', targetY);

      // Přidat jednotky do URL
      Object.entries(unitCounts).forEach(([unit, count]) => {
        params.append(unit, count);
      });

      const placeUrl = `${worldUrl}/game.php?${params.toString()}`;

      logger.info(`Navigace na: ${placeUrl}`, this.getAccountName());

      // Přejít na URL s předvyplněnými parametry
      await this.page.goto(placeUrl, { waitUntil: 'domcontentloaded' });
      await this.page.waitForTimeout(1000);

      logger.action(`Formulář vyplněn přes URL: ${Object.entries(unitCounts).map(([u,c]) => `${u}:${c}`).join(', ')} na ${targetX}|${targetY}`, this.getAccountName());
      return { success: true, unitTypes, targetX, targetY, unitCounts };

    } catch (error) {
      logger.error(`Chyba při otevírání ručního odeslání: ${error.message}`, this.getAccountName());
      throw error;
    }
  }

  /**
   * Odeslat více typů jednotek najednou na podporu
   * @param {Array<string>} unitTypes - Pole typů jednotek (např. ['knight', 'spear', 'sword'])
   * @param {number} targetX - Cílová X souřadnice
   * @param {number} targetY - Cílová Y souřadnice
   */
  async sendMultipleUnits(unitTypes, targetX, targetY) {
    try {
      // BEZPEČNOSTNÍ KONTROLA: Zkontroluj captcha PŘED odesláním podpory
      const NotificationsModule = (await import('./notifications.js')).default;
      const notificationsModule = new NotificationsModule(this.page, this.db, this.accountId);
      const hasCaptcha = await notificationsModule.detectCaptcha();

      if (hasCaptcha) {
        logger.warn('⚠️ Captcha detekována před odesláním podpory - přerušuji', this.getAccountName());
        return { success: false, captchaDetected: true, error: 'Captcha detekována' };
      }

      const worldUrl = this.getWorldUrl();

      logger.info(`Odesílám komplexní podporu: ${unitTypes.join(', ')} na ${targetX}|${targetY}`, this.getAccountName());

      // Získat počty jednotek z databáze (stejně jako openManualSupport)
      const account = this.db.getAccount(this.accountId);
      const unitCounts = {};

      if (account.units_info) {
        try {
          const unitsInfo = JSON.parse(account.units_info);
          unitTypes.forEach(unit => {
            const count = unitsInfo[unit]?.inVillages || 0;
            if (count > 0) {
              unitCounts[unit] = count;
            }
          });
        } catch (e) {
          logger.error(`Chyba při parsování units_info: ${e.message}`, this.getAccountName());
        }
      }

      // Sestavit URL s parametry (stejně jako openManualSupport)
      const params = new URLSearchParams();
      params.append('screen', 'place');
      params.append('x', targetX);
      params.append('y', targetY);

      Object.entries(unitCounts).forEach(([unit, count]) => {
        params.append(unit, count);
      });

      const placeUrl = `${worldUrl}/game.php?${params.toString()}`;
      logger.info(`Navigace na: ${placeUrl}`, this.getAccountName());

      // Přejít na URL s předvyplněnými parametry
      await this.page.goto(placeUrl, { waitUntil: 'domcontentloaded' });
      await this.page.waitForTimeout(1500);

      // Kliknout na tlačítko "Podpora" (input[name="support"])
      logger.info('Klikám na tlačítko "Podpora"', this.getAccountName());
      const supportButton = await this.page.$('input[name="support"]');

      if (!supportButton) {
        logger.error('Nenalezeno tlačítko "Podpora"', this.getAccountName());
        throw new Error('Nenalezeno tlačítko "Podpora"');
      }

      await supportButton.click();
      await this.page.waitForTimeout(2000);

      // Ověřit, že jsme na potvrzovací stránce
      const currentUrl = this.page.url();
      if (!currentUrl.includes('try=confirm')) {
        logger.error('Nepovedlo se přejít na potvrzovací stránku', this.getAccountName());
        throw new Error('Nepovedlo se přejít na potvrzovací stránku');
      }

      // Zkontrolovat, jestli je to podpora (ne útok) - více kontrolních bodů
      const confirmInfo = await this.page.evaluate(() => {
        const confirmButton = document.querySelector('#troop_confirm_submit');
        const bodyText = document.body.innerText.toLowerCase();
        const pageTitle = document.title.toLowerCase();
        const urlParams = new URLSearchParams(window.location.search);

        return {
          buttonExists: confirmButton !== null,
          buttonValue: confirmButton ? confirmButton.value : '',
          buttonClass: confirmButton ? confirmButton.className : '',
          hasAttackInText: bodyText.includes('útok') || bodyText.includes('attack') || bodyText.includes('útok'),
          hasSupportInText: bodyText.includes('podpora') || bodyText.includes('support'),
          hasAttackInTitle: pageTitle.includes('útok') || pageTitle.includes('attack'),
          hasSupportInTitle: pageTitle.includes('podpora') || pageTitle.includes('support'),
          urlAction: urlParams.get('action')
        };
      });

      logger.info(`Detekce typu akce: button="${confirmInfo.buttonValue}", hasSupport=${confirmInfo.hasSupportInText}, hasAttack=${confirmInfo.hasAttackInText}`, this.getAccountName());

      // Rozhodnutí zda je to podpora
      const isSupport = confirmInfo.hasSupportInText ||
                        confirmInfo.hasSupportInTitle ||
                        confirmInfo.buttonValue.toLowerCase().includes('support') ||
                        confirmInfo.buttonValue.toLowerCase().includes('podpor') ||
                        confirmInfo.buttonClass.includes('btn-support');

      const isAttack = confirmInfo.hasAttackInText ||
                       confirmInfo.hasAttackInTitle ||
                       confirmInfo.buttonValue.toLowerCase().includes('attack') ||
                       confirmInfo.buttonValue.toLowerCase().includes('útok');

      if (!isSupport || (isAttack && !isSupport)) {
        logger.error(`Nepotvrzený typ akce - přerušuji. Support indikátory: ${confirmInfo.hasSupportInText}, Attack indikátory: ${confirmInfo.hasAttackInText}`, this.getAccountName());
        throw new Error('Nelze ověřit že jde o podporu - možný útok');
      }

      logger.info('Potvrzuji odeslání podpory', this.getAccountName());

      // Potvrdit odeslání
      const confirmButton = await this.page.$('#troop_confirm_submit');

      if (!confirmButton) {
        logger.error('Nenalezeno potvrzovací tlačítko', this.getAccountName());
        throw new Error('Nenalezeno potvrzovací tlačítko');
      }

      await confirmButton.click();
      await this.page.waitForTimeout(2000);

      // Považujeme odeslání za úspěšné (validace textu není spolehlivá)
      logger.action(`Komplexní podpora odeslána: ${unitTypes.join(', ')} (${Object.entries(unitCounts).map(([u,c]) => `${u}:${c}`).join(', ')}) na ${targetX}|${targetY}`, this.getAccountName());
      return { success: true, unitTypes, targetX, targetY, unitCounts };

    } catch (error) {
      logger.error(`Chyba při odesílání komplexní podpory: ${error.message}`, this.getAccountName());
      throw error;
    }
  }

  /**
   * Odeslat nejrychlejší dostupnou jednotku na podporu
   * @param {number} targetX - Cílová X souřadnice
   * @param {number} targetY - Cílová Y souřadnice
   * @param {Object} worldSettings - Nastavení světa (speed)
   * @param {Date} arrivalTime - Požadovaný čas dopadu
   */
  async sendFastestSupport(targetX, targetY, worldSettings, arrivalTime) {
    try {
      const account = this.db.getAccount(this.accountId);

      if (!account || !account.coord_x || !account.coord_y) {
        throw new Error('Vesnice nemá nastavené souřadnice');
      }

      // Vypočítat vzdálenost
      const distance = Math.sqrt(
        Math.pow(targetX - account.coord_x, 2) +
        Math.pow(targetY - account.coord_y, 2)
      );

      const now = new Date();
      const availableTime = (arrivalTime - now) / 1000 / 60; // minuty

      // Rychlosti jednotek (minuty/pole)
      const UNIT_SPEEDS = {
        spy: 9,
        knight: 10,
        light: 10,
        marcher: 10,
        heavy: 11,
        spear: 18,
        axe: 18,
        archer: 18,
        sword: 22,
        ram: 30,
        catapult: 30,
        snob: 35
      };

      const UNIT_ORDER = ['spy', 'knight', 'light', 'marcher', 'heavy', 'spear', 'axe', 'archer', 'sword', 'ram', 'catapult', 'snob'];

      // Získat informace o jednotkách
      let unitsInfo = {};
      if (account.units_info) {
        try {
          unitsInfo = JSON.parse(account.units_info);
        } catch (e) {
          logger.error('Chyba při parsování units_info', this.getAccountName());
        }
      }

      const worldSpeed = worldSettings.speed || 1;

      // Najít nejrychlejší dostupnou jednotku
      for (const unit of UNIT_ORDER) {
        const unitSpeed = UNIT_SPEEDS[unit];
        const requiredTime = (distance * unitSpeed) / worldSpeed;
        const unitCount = unitsInfo[unit]?.inVillages || 0;

        if (requiredTime <= availableTime && unitCount > 0) {
          logger.info(`Nalezena nejrychlejší jednotka: ${unit} (${unitCount}x, čas cesty: ${requiredTime.toFixed(2)} min)`, this.getAccountName());
          return await this.sendSupport(unit, targetX, targetY, 1);
        }
      }

      throw new Error('Žádné dostupné jednotky, které by stihly dorazit včas');

    } catch (error) {
      logger.error(`Chyba při odesílání nejrychlejší podpory: ${error.message}`, this.getAccountName());
      throw error;
    }
  }
}

export default SupportSender;
