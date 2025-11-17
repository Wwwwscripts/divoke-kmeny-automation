/**
 * Modul pro Discord notifikace
 *
 * Note: V Node.js 18+ je fetch nativně dostupné jako globální funkce
 */

class NotificationsModule {
  constructor(page, db, accountId) {
    this.page = page;
    this.db = db;
    this.accountId = accountId;
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
        console.log('⚠️  CAPTCHA DETEKOVÁNA!');
        
        // Zkontroluj, jestli už jsme poslali notifikaci pro CAPTCHA
        const lastCaptchaNotification = this.getLastNotification('captcha');
        const now = Date.now();
        
        // Pošli notifikaci pouze pokud od poslední uplynulo více než 10 minut
        if (!lastCaptchaNotification || (now - lastCaptchaNotification) > 10 * 60 * 1000) {
          await this.sendDiscordNotification('captcha');
          this.saveLastNotification('captcha', now);
        } else {
          console.log('⏭️  CAPTCHA notifikace již odeslána - přeskakuji');
        }
        
        return true;
      }

      return false;
    } catch (error) {
      console.error('❌ Chyba při detekci CAPTCHA:', error.message);
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

        // Sbíráme detaily jednotlivých útoků
        const attacks = [];
        const rows = document.querySelectorAll('#commands_incomings tr.command-row, #commands_incomings tr');

        rows.forEach(row => {
          try {
            // Hledáme buňky s daty
            const cells = row.querySelectorAll('td');
            if (cells.length < 3) return;

            // Útočník - hledáme link nebo text s jménem
            let attacker = 'Neznámý';
            const attackerLink = row.querySelector('a[href*="info_player"]');
            if (attackerLink) {
              attacker = attackerLink.textContent.trim();
            }

            // Čas dopadu
            let arrivalTime = '-';
            const timeSpan = row.querySelector('span.timer, span[class*="timer"]');
            if (timeSpan) {
              arrivalTime = timeSpan.textContent.trim();
            }

            // Countdown - může být v data-endtime atributu
            let countdown = '-';
            if (timeSpan && timeSpan.hasAttribute('data-endtime')) {
              const endtime = parseInt(timeSpan.getAttribute('data-endtime'));
              const now = Math.floor(Date.now() / 1000);
              const diff = endtime - now;

              if (diff > 0) {
                const hours = Math.floor(diff / 3600);
                const minutes = Math.floor((diff % 3600) / 60);
                const seconds = diff % 60;
                countdown = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
              }
            } else if (timeSpan) {
              countdown = timeSpan.textContent.trim();
            }

            // Typ útoku - pokud najdeme ikonu
            let attackType = 'attack';
            const attackIcon = row.querySelector('img[src*="attack"]');
            if (attackIcon) {
              const src = attackIcon.src;
              if (src.includes('support')) attackType = 'support';
              else if (src.includes('attack')) attackType = 'attack';
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

            // Pokud máme aspoň útočníka, přidáme útok
            if (attacker !== 'Neznámý' || origin !== '-') {
              attacks.push({
                attacker: attacker,
                origin: origin,
                arrival_time: arrivalTime,
                countdown: countdown,
                type: attackType
              });
            }
          } catch (e) {
            console.error('Chyba při parsování řádku útoku:', e);
          }
        });

        return { count, attacks };
      });

      const currentCount = attackInfo ? attackInfo.count : 0;
      const attacks = attackInfo ? attackInfo.attacks : [];

      // Získáme poslední uložený počet útoků
      const lastAttackCount = this.getLastAttackCount();

      console.log(`📊 Útoky: Aktuálně ${currentCount}, Předchozí ${lastAttackCount}`);

      // Uložíme detaily útoků do databáze
      if (attacks.length > 0) {
        this.saveAttacksInfo(attacks);
        console.log(`📋 Uloženo ${attacks.length} detailů útoků`);
      }

      // Pošleme notifikaci POUZE pokud počet STOUPL
      if (currentCount > lastAttackCount) {
        console.log(`⚔️  NOVÝ ÚTOK! Počet útoků vzrostl z ${lastAttackCount} na ${currentCount}`);
        await this.sendDiscordNotification('attack', {
          count: currentCount,
          attacks: attacks
        });
      }

      // Uložíme aktuální počet pro příští kontrolu
      this.saveLastAttackCount(currentCount);

      return attackInfo;
    } catch (error) {
      console.error('❌ Chyba při detekci útoků:', error.message);
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
      console.error('❌ Chyba při ukládání počtu útoků:', error.message);
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
      console.error('❌ Chyba při ukládání detailů útoků:', error.message);
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
      console.error('❌ Chyba při ukládání času notifikace:', error.message);
    }
  }

  /**
   * Odeslání Discord notifikace
   */
  async sendDiscordNotification(type, data = {}) {
    try {
      const account = this.db.getAccountWithStats(this.accountId);
      if (!account) {
        console.log('⚠️  Účet nenalezen pro notifikaci');
        return;
      }

      // Získáme Discord webhook URL podle typu (CAPTCHA nebo ATTACK)
      const webhookUrl = this.getDiscordWebhook(type);
      if (!webhookUrl) {
        console.log(`⚠️  Discord webhook pro ${type} není nakonfigurován`);
        console.log(`💡 Vytvořte .env soubor a nastavte DISCORD_WEBHOOK_${type.toUpperCase()}`);
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

      if (response.ok) {
        console.log(`✅ Discord notifikace (${type}) odeslána`);
      } else {
        const errorText = await response.text();
        console.log(`⚠️  Nepodařilo se odeslat Discord notifikaci (${type})`);
        console.log(`   Status: ${response.status} ${response.statusText}`);
        console.log(`   Chyba: ${errorText}`);
      }

    } catch (error) {
      console.error('❌ Chyba při odesílání Discord notifikace:', error.message);
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
    }
    return null;
  }
}

export default NotificationsModule;