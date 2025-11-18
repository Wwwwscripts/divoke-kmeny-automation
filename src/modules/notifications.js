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

        // Pošli Discord notifikaci pouze pokud od poslední uplynulo více než 10 minut
        if (!lastConqueredNotification || (now - lastConqueredNotification) > 10 * 60 * 1000) {
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

        // Pošli notifikaci pouze pokud od poslední uplynulo více než 10 minut
        if (!lastCaptchaNotification || (now - lastCaptchaNotification) > 10 * 60 * 1000) {
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
   * Detekce příchozích útoků
   */
  async detectAttacks() {
    try {
      const attackInfo = await this.page.evaluate(() => {
        const attackElement = document.querySelector('#incomings_amount');
        if (!attackElement) return null;

        const count = parseInt(attackElement.textContent.trim(), 10) || 0;
        if (count === 0) return { count: 0, attacks: [] };

        // Parsování příchozích útoků z .command-row
        const attacks = [...document.querySelectorAll('.command-row')]
          .filter(row => row.querySelector('img[src*="attack.webp"]'))  // jen příchozí útoky
          .map(row => {
            try {
              // Název útoku
              const name = row.querySelector('.quickedit-label')?.textContent.trim() || 'Útok';

              // Čas dopadu
              const arrivalSpan = row.querySelector('[data-endtime]');
              const arrivalCountdown = arrivalSpan?.textContent.trim() || '-';
              const arrivalTimestamp = arrivalSpan?.dataset.endtime || null;

              // Převedení timestampu na čitelný formát
              const arrivalTime = arrivalTimestamp
                ? new Date(Number(arrivalTimestamp) * 1000).toLocaleString('cs-CZ', {
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

              // Vesnice odkud útok přichází (může být název nebo souřadnice)
              let origin = '-';

              // Hledáme link na vesnici - může obsahovat název nebo souřadnice
              const villageLinks = row.querySelectorAll('a[href*="screen=info_village"]');

              // První link je obvykle cílová vesnice (naše), druhý je útočníkova
              if (villageLinks.length >= 2) {
                // Druhý link = odkud útok přichází
                const originText = villageLinks[1].textContent.trim();
                origin = originText; // Použijeme celý text (název nebo souřadnice)
              } else if (villageLinks.length === 1) {
                // Pokud je jen jeden link, zkusíme ho
                const originText = villageLinks[0].textContent.trim();

                // Pokud to vypadá jako souřadnice, použijeme
                if (originText.includes('|')) {
                  origin = originText;
                } else {
                  // Jinak je to pravděpodobně název vesnice
                  origin = originText;
                }
              }

              // Fallback: hledáme souřadnice kdekoli v textu
              if (origin === '-') {
                const rowText = row.textContent;
                const coordMatch = rowText.match(/(\d{1,3})\|(\d{1,3})/);
                if (coordMatch) {
                  origin = `${coordMatch[1]}|${coordMatch[2]}`;
                }
              }

              const attackData = {
                name: name,
                attacker: attacker,
                origin: origin,
                arrival_countdown: arrivalCountdown,
                arrival_timestamp: arrivalTimestamp,
                arrival_time: arrivalTime,  // Formátovaný čas pro Discord
                countdown: arrivalCountdown, // Alias pro Discord
                impact: name  // Název útoku = dopad
              };

              return attackData;
            } catch (e) {
              return null;
            }
          })
          .filter(attack => attack !== null);  // Odfiltrujeme neúspěšné pokusy

        return { count, attacks };
      });

      const currentCount = attackInfo ? attackInfo.count : 0;
      const attacks = attackInfo ? attackInfo.attacks : [];

      // Získáme poslední uložený počet útoků
      const lastAttackCount = this.getLastAttackCount();

      // Uložíme detaily útoků do databáze
      if (attacks.length > 0) {
        this.saveAttacksInfo(attacks);
      }

      // Pošleme notifikaci POUZE pokud počet STOUPL
      if (currentCount > lastAttackCount) {
        await this.sendDiscordNotification('attack', {
          count: currentCount,
          attacks: attacks
        });
      }

      // Uložíme aktuální počet pro příští kontrolu
      this.saveLastAttackCount(currentCount);

      return attackInfo;
    } catch (error) {
      logger.error('Chyba při detekci útoků', this.getAccountName(), error);
      return null;
    }
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
   * Uložení detailů útoků
   */
  saveAttacksInfo(attacks) {
    try {
      const data = this.db._loadAccounts();
      const account = data.accounts.find(a => a.id === this.accountId);

      if (account) {
        account.attacks_info = JSON.stringify(attacks);
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

        // Přidáme detaily útoků pokud jsou dostupné
        if (data.attacks && data.attacks.length > 0) {
          data.attacks.slice(0, 3).forEach((attack, index) => {
            fields.push({
              name: `\u200b`, // Prázdný řádek pro vizuální oddělení
              value: `**Útok ${index + 1}:**\n` +
                     `👤 ${attack.attacker}\n` +
                     `📍 Z: ${attack.origin}\n` +
                     `🕐 Dopad: ${attack.arrival_time}\n` +
                     `⏱️ Odpočet: ${attack.countdown}`,
              inline: false
            });
          });

          if (data.attacks.length > 3) {
            fields.push({
              name: '\u200b',
              value: `_... a další ${data.attacks.length - 3} útoky_`,
              inline: false
            });
          }
        }

        embed = {
          title: '⚔️ NOVÝ PŘÍCHOZÍ ÚTOK!',
          description: `Účet **${account.username}** má nový útok!`,
          color: 0xFF0000, // Červená pro urgentnost
          fields: fields,
          footer: {
            text: '⚠️ Zkontrolujte obranou strategie!'
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