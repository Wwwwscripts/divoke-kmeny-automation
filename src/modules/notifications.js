/**
 * Modul pro Discord notifikace
 *
 * Note: V Node.js 18+ je fetch nativně dostupné jako globální funkce
 */

import logger from '../logger.js';

class NotificationsModule {
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
   * Detekce dobytí vesnice (přesměrování na create_village.php)
   */
  async detectConqueredVillage() {
    try {
      const currentUrl = this.page.url();

      // Zkontroluj zda URL obsahuje create_village.php
      if (currentUrl.includes('create_village.php')) {
        // Zkontroluj, jestli už jsme poslali notifikaci
        const lastConqueredNotification = this.getLastNotification('conquered');
        const now = Date.now();

        // Pošli Discord notifikaci pouze pokud od poslední uplynulo více než 60 minut (1 hodina)
        // Tím se zabrání spamování Discord notifikací
        if (!lastConqueredNotification || (now - lastConqueredNotification) > 60 * 60 * 1000) {
          await this.sendDiscordNotification('conquered');
          this.saveLastNotification('conquered', now);
        }

        return true;
      }

      return false;
    } catch (error) {
      logger.error('Chyba při detekci dobytí vesnice', this.getAccountName(), error);
      return false;
    }
  }

  /**
   * Detekce CAPTCHA
   */
  async detectCaptcha() {
    try {
      const hasCaptcha = await this.page.evaluate(() => {
        // Hledáme různé typy CAPTCHA
        const captchaElements = [
          document.querySelector('.captcha'),
          document.querySelector('#captcha'),
          document.querySelector('[class*="captcha"]'),
          document.querySelector('[id*="captcha"]'),
          document.querySelector('img[src*="captcha"]')
        ];

        return captchaElements.some(el => el !== null);
      });

      if (hasCaptcha) {
        // Zkontroluj, jestli už jsme poslali notifikaci pro CAPTCHA
        const lastCaptchaNotification = this.getLastNotification('captcha');
        const now = Date.now();

        // Pošli notifikaci pouze pokud od poslední uplynulo více než 60 minut (1 hodina)
        // Tím se zabrání spamování Discord notifikací během noci
        if (!lastCaptchaNotification || (now - lastCaptchaNotification) > 60 * 60 * 1000) {
          await this.sendDiscordNotification('captcha');
          this.saveLastNotification('captcha', now);
        }

        return true;
      }

      return false;
    } catch (error) {
      logger.error('Chyba při detekci CAPTCHA', this.getAccountName(), error);
      return false;
    }
  }

  /**
   * Detekce příchozích útoků (LEHKÁ OPERACE - jen zjištění počtu)
   * ŽÁDNÉ fetche, jen čtení z HTML
   */
  async detectAttacks() {
    try {
      // BEZPEČNOSTNÍ KONTROLA: Zkontroluj captcha NEJDŘÍV
      const hasCaptcha = await this.detectCaptcha();
      if (hasCaptcha) {
        logger.warn('⚠️ Captcha detekována - zastavuji všechny operace', this.getAccountName());
        return { count: 0, attacks: [], captchaDetected: true };
      }

      // Získáme základní info z hlavní stránky (BEZ fetchování!)
      const basicInfo = await this.page.evaluate(() => {
        const attackElement = document.querySelector('#incomings_amount');
        if (!attackElement) return null;

        const count = parseInt(attackElement.textContent.trim(), 10) || 0;
        if (count === 0) return { count: 0, commandIds: [] };

        // Získáme ID všech příchozích útoků
        const commandRows = [...document.querySelectorAll('#commands_incomings tr.command-row')];
        const commandIds = commandRows.map(row => {
          const detailLink = row.querySelector('a[href*="info_command"]');
          const commandId = detailLink?.href.match(/id=(\d+)/)?.[1];
          const timer = row.querySelector('span[data-endtime]');
          const timestamp = timer?.getAttribute('data-endtime');

          return {
            commandId,
            arrivalTimestamp: timestamp
          };
        }).filter(item => item.commandId);

        return { count, commandIds };
      });

      if (!basicInfo || basicInfo.count === 0) {
        const currentCount = 0;
        const lastAttackCount = this.getLastAttackCount();
        this.saveLastAttackCount(currentCount);
        return { count: 0, attacks: [] };
      }

      const currentCount = basicInfo.count;
      const lastAttackCount = this.getLastAttackCount();

      // Získáme existující útoky z databáze
      const existingAttacks = this.getExistingAttacks();

      // Detekce šlechtického vlaku (4 útoky s rozestupem max 300ms)
      const isTrain = this.detectNoblesTrain(existingAttacks);

      // Pošleme notifikaci POUZE pokud počet STOUPL
      if (currentCount > lastAttackCount) {
        await this.sendDiscordNotification('attack', {
          count: currentCount,
          attacks: existingAttacks,
          isTrain: isTrain
        });
      }

      // Uložíme aktuální počet pro příští kontrolu
      this.saveLastAttackCount(currentCount);

      return {
        count: currentCount,
        attacks: existingAttacks,
        isTrain: isTrain,
        commandIds: basicInfo.commandIds
      };
    } catch (error) {
      logger.error('Chyba při detekci útoků', this.getAccountName(), error);
      return null;
    }
  }

  /**
   * Fetchování detailů útoků (TĚŽKÁ OPERACE - fetch requesty)
   * Volá se POUZE pokud jsou útoky
   */
  async fetchAttackDetails(commandIds) {
    try {
      // BEZPEČNOSTNÍ KONTROLA: Zkontroluj captcha PŘED jakýmkoli fetchováním
      const hasCaptchaBeforeFetch = await this.detectCaptcha();
      if (hasCaptchaBeforeFetch) {
        logger.warn('⚠️ Captcha detekována před fetchováním útoků - přeskakuji', this.getAccountName());
        return { captchaDetected: true };
      }

      // Získáme existující útoky
      const existingAttacks = this.getExistingAttacks();
      const existingCommandIds = new Set(existingAttacks.map(a => a.commandId));

      // Fetchujeme POUZE nové útoky (které ještě nemáme v DB)
      const newCommandIds = commandIds.filter(item => !existingCommandIds.has(item.commandId));

      if (newCommandIds.length === 0) {
        return { newAttacks: [] };
      }

      const newAttacks = [];

      // Randomizuj pořadí fetchů (vypadá lidštěji)
      const shuffled = [...newCommandIds].sort(() => Math.random() - 0.5);

      for (let i = 0; i < shuffled.length; i++) {
        const { commandId, arrivalTimestamp } = shuffled[i];

        try {
          // Fetchujeme detail útoku
          const attackDetails = await this.page.evaluate(async (cmdId) => {
            const detailUrl = `https://${window.location.host}/game.php?screen=info_command&id=${cmdId}`;

            try {
              const response = await fetch(detailUrl);
              const html = await response.text();
              const parser = new DOMParser();
              const doc = parser.parseFromString(html, 'text/html');

              // Najdi útočníka
              const attackerLink = doc.querySelector('a[href*="info_player"][href*="id="]');
              const attackerName = attackerLink?.textContent.trim() || 'Neznámý';

              // Najdi vesnici útočníka
              const attackerVillageLink = Array.from(doc.querySelectorAll('a[href*="info_village"]'))
                .find(link => link.textContent.includes('(') && link.textContent.includes('|'));
              const attackerVillage = attackerVillageLink?.textContent.trim() || '';
              const attackerCoords = attackerVillage.match(/\((\d+\|\d+)\)/)?.[1] || '-';

              // Čas příjezdu z tabulky
              const arrivalCell = Array.from(doc.querySelectorAll('table.vis tr')).find(tr =>
                tr.textContent.includes('Příchod:')
              );
              const arrivalTime = arrivalCell?.querySelectorAll('td')[1]?.textContent.trim() || '-';

              return {
                attackerName,
                attackerCoords,
                arrivalTime
              };
            } catch (e) {
              return null;
            }
          }, commandId);

          if (attackDetails) {
            // Převedení timestampu na čitelný formát pro countdown
            const arrivalTime = arrivalTimestamp
              ? new Date(Number(arrivalTimestamp) * 1000).toLocaleString('cs-CZ', {
                  day: '2-digit',
                  month: '2-digit',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit'
                })
              : attackDetails.arrivalTime;

            newAttacks.push({
              attacker: attackDetails.attackerName,
              origin: attackDetails.attackerCoords,
              arrival_timestamp: arrivalTimestamp,
              arrival_time: arrivalTime,
              commandId: commandId
            });

            logger.info(`✅ Načten detail útoku ${i + 1}/${shuffled.length}`, this.getAccountName());
          }

          // VELKÁ random pauza mezi fechy (2-5s) - vypadá velmi lidsky
          if (i < shuffled.length - 1) {
            const randomDelay = 2000 + Math.random() * 3000;
            await this.page.waitForTimeout(randomDelay);
          }

        } catch (error) {
          logger.error(`Chyba při načítání detailu útoku ${commandId}`, this.getAccountName(), error);
        }
      }

      // Spojíme existující útoky s novými
      const allAttacks = [...existingAttacks, ...newAttacks];

      // Uložíme do databáze
      if (allAttacks.length > 0) {
        this.saveAttacksInfo(allAttacks);
      }

      return { newAttacks, allAttacks };
    } catch (error) {
      logger.error('Chyba při fetchování detailů útoků', this.getAccountName(), error);
      return null;
    }
  }

  /**
   * Získání existujících útoků z databáze
   */
  getExistingAttacks() {
    try {
      const account = this.db.getAccount(this.accountId);
      if (!account?.attacks_info) return [];

      const attacks = JSON.parse(account.attacks_info);
      return Array.isArray(attacks) ? attacks : [];
    } catch (e) {
      return [];
    }
  }

  /**
   * Detekce šlechtického vlaku
   * Vlak = 4 útoky s rozestupem max 300ms (0.3s)
   */
  detectNoblesTrain(attacks) {
    if (attacks.length < 4) return false;

    // Seřadíme útoky podle timestampu
    const sorted = [...attacks]
      .filter(a => a.arrival_timestamp)
      .sort((a, b) => Number(a.arrival_timestamp) - Number(b.arrival_timestamp));

    if (sorted.length < 4) return false;

    // Zkontrolujeme první 4 útoky - rozestup max 300ms (0.3s)
    for (let i = 0; i < 3; i++) {
      const current = Number(sorted[i].arrival_timestamp);
      const next = Number(sorted[i + 1].arrival_timestamp);
      const diff = Math.abs(next - current);

      // Timestamp je v sekundách, ale milisekundy jsou v desetinné části
      // Pro cs117 je formát "20:19:23:611" což znamená timestamp má milisekundy
      // ale v data-endtime je to v sekundách s desetinnou částí
      if (diff > 0.3) { // více než 300ms
        return false;
      }
    }

    return true;
  }

  /**
   * Získání posledního počtu útoků
   */
  getLastAttackCount() {
    const account = this.db.getAccount(this.accountId);
    return account?.last_attack_count || 0;
  }

  /**
   * Uložení aktuálního počtu útoků
   */
  saveLastAttackCount(count) {
    try {
      const data = this.db._loadAccounts();
      const account = data.accounts.find(a => a.id === this.accountId);

      if (account) {
        account.last_attack_count = count;
        this.db._saveAccounts(data);
      }
    } catch (error) {
      logger.error('Chyba při ukládání počtu útoků', this.getAccountName(), error);
    }
  }

  /**
   * Uložení detailů útoků (MERGE s existujícími dopadlými)
   * Zachová dopadlé útoky dokud je uživatel neodstraní ručně
   */
  saveAttacksInfo(attacks) {
    try {
      const data = this.db._loadAccounts();
      const account = data.accounts.find(a => a.id === this.accountId);

      if (account) {
        const now = Math.floor(Date.now() / 1000);

        // Načteme existující útoky
        let existingAttacks = [];
        if (account.attacks_info) {
          try {
            existingAttacks = JSON.parse(account.attacks_info);
          } catch (e) {
            existingAttacks = [];
          }
        }

        // Najdeme dopadlé útoky (které už dopadly - timestamp < now)
        const completedAttacks = existingAttacks.filter(attack => {
          const timestamp = Number(attack.arrival_timestamp);
          return timestamp > 0 && timestamp < now;
        });

        // Vytvoříme Set timestampů z nových útoků (abychom je neduplicovali)
        const newTimestamps = new Set(attacks.map(a => a.arrival_timestamp));

        // Odfiltrujeme dopadlé útoky, které už TAKÉ nejsou v novém seznamu
        // (tzn. zachováme jen ty dopadlé, které nejsou duplicitní s novými)
        const uniqueCompletedAttacks = completedAttacks.filter(attack =>
          !newTimestamps.has(attack.arrival_timestamp)
        );

        // Spojíme: nové aktivní útoky + staré dopadlé útoky (oznámení)
        const mergedAttacks = [...attacks, ...uniqueCompletedAttacks];

        account.attacks_info = JSON.stringify(mergedAttacks);
        this.db._saveAccounts(data);
      }
    } catch (error) {
      logger.error('Chyba při ukládání detailů útoků', this.getAccountName(), error);
    }
  }

  /**
   * Získání času poslední notifikace daného typu
   */
  getLastNotification(type) {
    const account = this.db.getAccount(this.accountId);
    const key = `last_notification_${type}`;
    return account?.[key] || null;
  }

  /**
   * Uložení času poslední notifikace
   */
  saveLastNotification(type, timestamp) {
    try {
      const data = this.db._loadAccounts();
      const account = data.accounts.find(a => a.id === this.accountId);
      
      if (account) {
        const key = `last_notification_${type}`;
        account[key] = timestamp;
        this.db._saveAccounts(data);
      }
    } catch (error) {
      logger.error('Chyba při ukládání času notifikace', this.getAccountName(), error);
    }
  }

  /**
   * Odeslání Discord notifikace
   */
  async sendDiscordNotification(type, data = {}) {
    try {
      const account = this.db.getAccountWithStats(this.accountId);
      if (!account) {
        return;
      }

      // Získáme Discord webhook URL podle typu (CAPTCHA nebo ATTACK)
      const webhookUrl = this.getDiscordWebhook(type);
      if (!webhookUrl) {
        return;
      }

      let embed = {};
      let content = ''; // Pro @everyone ping

      if (type === 'captcha') {
        content = '@everyone';
        embed = {
          title: '🚨 CAPTCHA DETEKOVÁNA',
          description: `Účet **${account.username}** potřebuje vyřešit CAPTCHA!`,
          color: 0xFF0000, // Červená
          fields: [
            {
              name: '🌍 Svět',
              value: account.world || 'Neznámý',
              inline: true
            },
            {
              name: '⏰ Čas',
              value: new Date().toLocaleString('cs-CZ'),
              inline: true
            }
          ],
          footer: {
            text: '⚠️ Prohlížeč zůstane otevřený pro vyřešení'
          }
        };
      } else if (type === 'conquered') {
        content = '@everyone';
        embed = {
          title: '🏴 VESNICE DOBYTA!',
          description: `Účet **${account.username}** přišel o vesnici!`,
          color: 0xFF4500, // Oranžovo-červená
          fields: [
            {
              name: '🌍 Svět',
              value: account.world || 'Neznámý',
              inline: true
            },
            {
              name: '⏰ Čas dobytí',
              value: new Date().toLocaleString('cs-CZ'),
              inline: true
            }
          ],
          footer: {
            text: '⚠️ Prohlížeč otevřen pro vytvoření nové vesnice'
          }
        };
      } else if (type === 'attack') {
        content = '@everyone';

        let title = '⚔️ NOVÝ PŘÍCHOZÍ ÚTOK!';
        let description = `Účet **${account.username}** má nový útok!`;

        // Detekce šlechtického vlaku
        if (data.isTrain) {
          title = '🚂 PŘÍCHOZÍ ŠLECHTICKÝ VLAK!';
          description = `Účet **${account.username}** má příchozí šlechtický vlak!`;
        }

        const fields = [
          {
            name: '🌍 Svět',
            value: account.world || 'Neznámý',
            inline: true
          },
          {
            name: '⚔️ Celkem útoků',
            value: data.count?.toString() || '?',
            inline: true
          },
          {
            name: '⏰ Detekováno',
            value: new Date().toLocaleString('cs-CZ'),
            inline: true
          }
        ];

        embed = {
          title: title,
          description: description,
          color: data.isTrain ? 0xFF4500 : 0xFF0000, // Oranžová pro vlak, červená pro běžný útok
          fields: fields,
          footer: {
            text: data.isTrain ? '⚠️ VLAK DETEKOVÁN! Zkontrolujte obranu!' : '⚠️ Zkontrolujte obranou strategii!'
          }
        };
      }

      // Odešleme webhook s @everyone pingem
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          content: content,
          username: 'Divoké kmeny Bot',
          avatar_url: 'https://raw.githubusercontent.com/Wwwwscripts/share/refs/heads/main/W.png',
          embeds: [embed]
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(`Nepodařilo se odeslat Discord notifikaci (${type}) - ${response.status}: ${errorText}`, this.getAccountName());
      }

    } catch (error) {
      logger.error('Chyba při odesílání Discord notifikace', this.getAccountName(), error);
    }
  }

  /**
   * Získání Discord webhook URL podle typu
   */
  getDiscordWebhook(type) {
    if (type === 'captcha') {
      return process.env.DISCORD_WEBHOOK_CAPTCHA || null;
    } else if (type === 'attack') {
      return process.env.DISCORD_WEBHOOK_ATTACK || null;
    } else if (type === 'conquered') {
      // Pro dobytí vesnice použijeme CAPTCHA webhook (stejná urgentnost)
      return process.env.DISCORD_WEBHOOK_CAPTCHA || null;
    }
    return null;
  }
}

export default NotificationsModule;