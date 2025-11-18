/**
 * Modul pro detekci a sledování příchozích útoků
 * Zjišťuje detaily o útocích z overview stránky
 */

import logger from '../logger.js';

class IncomingAttacksModule {
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
   * Detekce a zpracování příchozích útoků
   */
  async execute() {
    try {
      // Přejdeme na overview screen pokud tam nejsme
      const currentUrl = this.page.url();
      if (!currentUrl.includes('screen=overview')) {
        await this.page.goto(currentUrl.replace(/screen=[^&]*/, 'screen=overview'));
        await this.page.waitForTimeout(1000);
      }

      // Zjistíme počet příchozích útoků
      const attacksData = await this.page.evaluate(() => {
        const attackElement = document.querySelector('#incomings_amount');
        if (!attackElement) {
          return { count: 0, attacks: [] };
        }

        const count = parseInt(attackElement.textContent.trim(), 10) || 0;
        if (count === 0) {
          return { count: 0, attacks: [] };
        }

        // Parsování detailů jednotlivých útoků
        const attacks = [...document.querySelectorAll('.command-row')]
          .filter(row => row.querySelector('img[src*="attack.webp"]'))  // jen příchozí útoky
          .map(row => {
            try {
              // Název útoku
              const name = row.querySelector('.quickedit-label')?.textContent.trim() || 'Útok';

              // Čas dopadu
              const arrivalSpan = row.querySelector('[data-endtime]');
              const countdown = arrivalSpan?.textContent.trim() || '-';
              const timestamp = arrivalSpan?.dataset.endtime || null;

              // Převedení timestampu na čitelný formát
              const arrivalDate = timestamp
                ? new Date(Number(timestamp) * 1000).toLocaleString('cs-CZ', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit'
                  })
                : '-';

              // Útočník - hledáme link s jménem hráče
              let attacker = 'Neznámý';
              const attackerLink = row.querySelector('a[href*="info_player"]');
              if (attackerLink) {
                attacker = attackerLink.textContent.trim();
              }

              // Souřadnice odkud útok přichází
              let origin = '-';
              const coordLink = row.querySelector('a[href*="screen=info_village"]');
              if (coordLink) {
                const match = coordLink.textContent.match(/(\d+)\|(\d+)/);
                if (match) {
                  origin = `${match[1]}|${match[2]}`;
                }
              }

              return {
                name: name,
                attacker: attacker,
                origin: origin,
                arrival_countdown: countdown,  // Pro kompatibilitu s attacks.html
                countdown: countdown,          // Alias pro Discord
                arrival_timestamp: timestamp,
                arrival_date: arrivalDate,
                arrival_time: arrivalDate,     // Alias pro Discord
                impact: name  // Název útoku = typ dopadu
              };
            } catch (e) {
              return null;
            }
          })
          .filter(attack => attack !== null);  // Odfiltrujeme neúspěšné pokusy

        return { count, attacks };
      });

      // Uložíme data do databáze
      if (attacksData.count > 0) {
        this.saveAttacksData(attacksData.count, attacksData.attacks);
      } else {
        // Pokud nejsou útoky, vymažeme data
        this.saveAttacksData(0, []);
      }

      return {
        success: true,
        count: attacksData.count,
        attacks: attacksData.attacks
      };

    } catch (error) {
      logger.error('Chyba při detekci příchozích útoků', this.getAccountName(), error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Uložení dat o útocích do databáze
   */
  saveAttacksData(count, attacks) {
    try {
      const data = this.db._loadAccounts();
      const account = data.accounts.find(a => a.id === this.accountId);

      if (account) {
        account.last_attack_count = count;
        account.attacks_info = JSON.stringify(attacks);
        this.db._saveAccounts(data);
      }
    } catch (error) {
      logger.error('Chyba při ukládání dat útoků', this.getAccountName(), error);
    }
  }

  /**
   * Získání aktuálního počtu útoků
   */
  getLastAttackCount() {
    const account = this.db.getAccount(this.accountId);
    return account?.last_attack_count || 0;
  }

  /**
   * Získání detailů útoků
   */
  getAttacksInfo() {
    try {
      const account = this.db.getAccount(this.accountId);
      if (!account || !account.attacks_info) {
        return [];
      }
      return JSON.parse(account.attacks_info);
    } catch (error) {
      logger.error('Chyba při načítání detailů útoků', this.getAccountName(), error);
      return [];
    }
  }
}

export default IncomingAttacksModule;
