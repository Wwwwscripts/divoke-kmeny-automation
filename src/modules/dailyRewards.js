/**
 * Modul pro automatické vybírání denních odměn
 *
 * Spouští se jednou denně (ideálně ve 4:00) nebo při startu programu
 * Kontroluje dostupnost denních odměn na stránce mode=daily_bonus
 * a automaticky je vybírá.
 */

class DailyRewardsModule {
  constructor(page, db, accountId) {
    this.page = page;
    this.db = db;
    this.accountId = accountId;
  }

  /**
   * Hlavní metoda modulu - spustí výběr denních odměn
   */
  async execute() {
    try {
      console.log(`\n🎁 === DENNÍ ODMĚNY - Účet ${this.accountId} ===`);

      // Získat informace o účtu
      const account = this.db.getAccount(this.accountId);
      if (!account) {
        throw new Error(`Účet s ID ${this.accountId} nebyl nalezen`);
      }

      // Zkontrolovat, zda má svět povolené denní odměny
      const worldSettings = this.db.getWorldSettings(account.world);
      if (!worldSettings.dailyRewardsEnabled) {
        console.log(`⏭️  Denní odměny nejsou povoleny pro svět ${account.world}`);
        return { success: true, message: 'Denní odměny nejsou povoleny pro tento svět' };
      }

      // Přejít na stránku denních odměn
      const worldUrl = this.getWorldUrl();
      console.log(`🌐 Navigace na stránku denních odměn...`);
      await this.page.goto(`${worldUrl}/game.php?screen=main&mode=daily_bonus`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      // Počkat na načtení stránky
      await this.page.waitForTimeout(2000);

      // Zkontrolovat, zda stránka denních odměn existuje
      const pageExists = await this.checkPageExists();
      if (!pageExists) {
        console.log(`ℹ️  Stránka denních odměn nebyla nalezena - svět pravděpodobně nemá tuto funkci`);
        return { success: true, message: 'Stránka denních odměn neexistuje' };
      }

      // Najít a vybrat všechny dostupné odměny
      const claimedCount = await this.claimAllRewards();

      console.log(`✅ Výběr denních odměn dokončen: ${claimedCount} odměn vybráno`);
      return {
        success: true,
        claimedCount,
        message: `Vybráno ${claimedCount} denních odměn`
      };

    } catch (error) {
      console.error(`❌ Chyba při výběru denních odměn:`, error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Získat URL světa z aktuální URL stránky
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
   * Zkontrolovat, zda stránka denních odměn existuje
   */
  async checkPageExists() {
    try {
      // TODO: Po získání informací z konzole upravit tento selektor
      // Zkontrolovat, zda existuje nějaký relevantní element na stránce
      const exists = await this.page.evaluate(() => {
        // Placeholder - budeme potřebovat vědět, jak vypadá stránka
        // Možné varianty:
        // - return document.querySelector('#daily_bonus_content') !== null;
        // - return document.querySelector('.daily-rewards') !== null;
        // - return document.querySelector('[class*="bonus"]') !== null;

        // Prozatím zkontrolujeme, zda stránka neobsahuje error
        const contentValue = document.querySelector('#content_value');
        if (!contentValue) return false;

        const text = contentValue.textContent;
        // Pokud stránka obsahuje error nebo je prázdná, neexistuje
        if (text.includes('Error') || text.includes('error') || text.trim().length < 50) {
          return false;
        }

        return true;
      });

      return exists;
    } catch (error) {
      console.error(`Chyba při kontrole existence stránky:`, error.message);
      return false;
    }
  }

  /**
   * Vybrat všechny dostupné denní odměny
   */
  async claimAllRewards() {
    try {
      // TODO: Po získání informací z konzole implementovat výběr odměn
      const result = await this.page.evaluate(() => {
        let claimed = 0;

        // PLACEHOLDER - čeká na informace od uživatele
        // Po získání struktury stránky implementujeme skutečnou logiku

        // Příklady možných implementací (závisí na struktuře stránky):

        // Varianta 1: Tlačítka s třídou
        // const rewardButtons = document.querySelectorAll('.reward-claim-button:not(.disabled)');
        // rewardButtons.forEach(button => {
        //   button.click();
        //   claimed++;
        // });

        // Varianta 2: Odkazy s data atributem
        // const rewardLinks = document.querySelectorAll('a[data-reward-id]:not(.claimed)');
        // rewardLinks.forEach(link => {
        //   link.click();
        //   claimed++;
        // });

        // Varianta 3: AJAX requesty
        // const rewards = document.querySelectorAll('[data-reward-id]');
        // rewards.forEach(async reward => {
        //   const rewardId = reward.getAttribute('data-reward-id');
        //   if (!reward.classList.contains('claimed')) {
        //     await fetch('/game.php?screen=main&mode=daily_bonus&action=claim', {
        //       method: 'POST',
        //       body: `reward_id=${rewardId}&h=${game_data.csrf}`
        //     });
        //     claimed++;
        //   }
        // });

        return claimed;
      });

      return result;
    } catch (error) {
      console.error(`Chyba při výběru odměn:`, error.message);
      return 0;
    }
  }

  /**
   * Pomocná metoda pro náhodné čekání (simulace lidského chování)
   */
  async randomWait(minMs = 1000, maxMs = 3000) {
    const wait = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
    await this.page.waitForTimeout(wait);
  }
}

export default DailyRewardsModule;
