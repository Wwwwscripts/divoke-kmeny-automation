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
      await this.page.goto(`${worldUrl}/game.php?screen=info_player&mode=daily_bonus`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      // Počkat na načtení stránky (delší timeout pro pomalé světy)
      await this.page.waitForTimeout(3000);

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
      const result = await this.page.evaluate(() => {
        const dailyBonusContent = document.querySelector('#daily_bonus_content');
        const rewardsGrid = document.querySelector('.rewards_grid');
        const rewards = document.querySelectorAll('.reward');

        return {
          hasDailyBonusContent: dailyBonusContent !== null,
          hasRewardsGrid: rewardsGrid !== null,
          rewardsCount: rewards.length,
          exists: (dailyBonusContent !== null || rewardsGrid !== null) && rewards.length > 0
        };
      });

      console.log(`📊 Kontrola stránky: daily_bonus_content=${result.hasDailyBonusContent}, rewards_grid=${result.hasRewardsGrid}, rewards=${result.rewardsCount}`);

      return result.exists;
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
      const result = await this.page.evaluate(() => {
        let claimedCount = 0;

        // Najdi všechny odměny s třídou "unlocked" (dostupné k otevření)
        // Selektor: .db-chest.unlocked (bez .claimed)
        const unlockedChests = document.querySelectorAll('.db-chest.unlocked:not(.claimed)');

        // Debug info
        const allChests = document.querySelectorAll('.db-chest');
        const allRewards = document.querySelectorAll('.reward');

        unlockedChests.forEach((chest) => {
          // Najdi nadřazený element odměny
          const rewardElement = chest.closest('.reward');
          if (!rewardElement) return;

          // Najdi tlačítko v .actions
          // Může být "Otevřít" (CZ) nebo "Otvoriť" (SK)
          const button = rewardElement.querySelector('.actions a.btn');
          if (button) {
            // Klikni na tlačítko
            button.click();
            claimedCount++;
          }
        });

        return {
          claimed: claimedCount,
          totalChests: allChests.length,
          totalRewards: allRewards.length,
          unlockedCount: unlockedChests.length
        };
      });

      console.log(`📊 Stav odměn: ${result.totalRewards} celkem, ${result.totalChests} truhlice, ${result.unlockedCount} odemčené`);

      if (result.claimed > 0) {
        console.log(`✅ Vybráno ${result.claimed} denních odměn`);

        // Po kliknutí počkej chvíli, aby se stránka aktualizovala
        await this.randomWait(2000, 3000);
      } else {
        console.log(`ℹ️  Žádné dostupné odměny k vyzvednutí (odemčené: ${result.unlockedCount})`);
      }

      return result.claimed;
    } catch (error) {
      console.error(`❌ Chyba při výběru odměn:`, error.message);
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
