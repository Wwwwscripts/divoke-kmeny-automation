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
      // Zkontrolovat, zda existuje hlavní kontejner s denními odměnami
      const exists = await this.page.evaluate(() => {
        const dailyBonusContent = document.querySelector('#daily_bonus_content');
        const rewardsGrid = document.querySelector('.rewards_grid');

        // Stránka existuje, pokud má oba elementy
        return dailyBonusContent !== null && rewardsGrid !== null;
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
      console.log(`🔍 Hledám dostupné odměny k vyzvednutí...`);

      // Najdi všechny dostupné odměny (unlocked) a klikni na ně
      const claimed = await this.page.evaluate(() => {
        let claimedCount = 0;

        // Najdi všechny odměny s třídou "unlocked" (dostupné k otevření)
        const unlockedChests = document.querySelectorAll('.reward .db-chest.unlocked');

        unlockedChests.forEach((chest) => {
          // Najdi nadřazený element odměny
          const rewardElement = chest.closest('.reward');
          if (!rewardElement) return;

          // Najdi tlačítko "Otevřít"
          const button = rewardElement.querySelector('.actions a.btn');
          if (button && button.textContent.includes('Otevřít')) {
            console.log(`🎁 Klikám na odměnu: ${rewardElement.className}`);

            // Klikni na tlačítko
            button.click();
            claimedCount++;
          }
        });

        return claimedCount;
      });

      if (claimed > 0) {
        console.log(`✅ Vybráno ${claimed} denních odměn`);

        // Po kliknutí počkej chvíli, aby se stránka aktualizovala
        await this.randomWait(2000, 3000);
      } else {
        console.log(`ℹ️  Žádné dostupné odměny k vyzvednutí`);
      }

      return claimed;
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
