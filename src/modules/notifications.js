/**
 * Modul pro Discord notifikace
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
        return count > 0 ? { count } : null;
      });

      const currentCount = attackInfo ? attackInfo.count : 0;
      
      // Získáme poslední uložený počet útoků
      const lastAttackCount = this.getLastAttackCount();
      
      console.log(`📊 Útoky: Aktuálně ${currentCount}, Předchozí ${lastAttackCount}`);

      // Pošleme notifikaci POUZE pokud počet STOUPL
      if (currentCount > lastAttackCount) {
        console.log(`⚔️  NOVÝ ÚTOK! Počet útoků vzrostl z ${lastAttackCount} na ${currentCount}`);
        await this.sendDiscordNotification('attack', { count: currentCount });
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
        embed = {
          title: '⚔️ NOVÝ PŘÍCHOZÍ ÚTOK!',
          description: `Účet **${account.username}** má nový útok!`,
          color: 0xFFA500, // Oranžová
          fields: [
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
              name: '⏰ Čas',
              value: new Date().toLocaleString('cs-CZ'),
              inline: true
            }
          ]
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
        console.log(`⚠️  Nepodařilo se odeslat Discord notifikaci (${type})`);
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