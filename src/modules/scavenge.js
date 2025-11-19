/**
 * Modul pro automatický sběr surovin (Scavenge)
 *
 * Běží každých 5 minut a automaticky odesílá kopijníky na sběr.
 * Logika je založena na UserScriptu - rozdělení jednotek podle počtu možností.
 * LANGUAGE-INDEPENDENT - používá pouze CSS třídy, ne text.
 */

class ScavengeModule {
  constructor(page, db, accountId) {
    this.page = page;
    this.db = db;
    this.accountId = accountId;
  }

  /**
   * Hlavní metoda modulu
   */
  async execute() {
    try {
      console.log(`\n⛏️  === SCAVENGE - Účet ${this.accountId} ===`);

      // Získat informace o účtu
      const account = this.db.getAccount(this.accountId);
      if (!account) {
        throw new Error(`Účet s ID ${this.accountId} nebyl nalezen`);
      }

      // Zkontrolovat, zda má svět povolený scavenge
      const worldSettings = this.db.getWorldSettings(account.world);
      if (!worldSettings.scavengeEnabled) {
        console.log(`⏭️  Sběr není povolen pro svět ${account.world}`);
        return { success: true, message: 'Sběr není povolen pro tento svět' };
      }

      // Přejít na stránku sběru
      const worldUrl = this.getWorldUrl();
      console.log(`🌐 Navigace na stránku sběru...`);
      await this.page.goto(`${worldUrl}/game.php?screen=place&mode=scavenge`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      // Počkat na načtení stránky
      await this.page.waitForTimeout(2000);

      // Zkontrolovat, zda stránka sběru existuje
      const pageExists = await this.checkPageExists();
      if (!pageExists) {
        console.log(`ℹ️  Stránka sběru nebyla nalezena`);
        return { success: true, message: 'Stránka sběru neexistuje' };
      }

      // Spustit logiku sběru
      const result = await this.runScavengeLogic();

      return result;

    } catch (error) {
      console.error(`❌ Chyba při sběru:`, error.message);
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
   * Zkontrolovat, zda stránka sběru existuje
   */
  async checkPageExists() {
    try {
      const exists = await this.page.evaluate(() => {
        // Stránka existuje, pokud má scavenge options
        const scavengeOptions = document.querySelectorAll('.scavenge-option');
        return scavengeOptions.length > 0;
      });

      return exists;
    } catch (error) {
      console.error(`Chyba při kontrole existence stránky:`, error.message);
      return false;
    }
  }

  /**
   * Hlavní logika sběru - převzato z UserScriptu
   */
  async runScavengeLogic() {
    try {
      const checkInterval = 500;
      const maxWaitTime = 10000;
      let waited = 0;

      // Počkat na načtení elementů
      while (waited < maxWaitTime) {
        const spearLinkExists = await this.page.evaluate(() => {
          return document.querySelector('a.units-entry-all[data-unit="spear"]') !== null;
        });

        if (spearLinkExists) {
          break;
        }

        await this.page.waitForTimeout(checkInterval);
        waited += checkInterval;
      }

      // Získat počet dostupných kopijníků
      const spearCount = await this.page.evaluate(() => {
        const spearLink = document.querySelector('a.units-entry-all[data-unit="spear"]');
        if (!spearLink) return 0;

        // Link má strukturu: <a class="units-entry-all" data-unit="spear">(3681)</a>
        const text = spearLink.textContent || '';
        const match = text.match(/\((\d+)\)/);

        if (match) {
          let count = parseInt(match[1], 10);
          // Maximum 1000 kopijníků
          return count > 1000 ? 1000 : count;
        }

        return 0;
      });

      console.log(`🪖 Dostupné kopijníky: ${spearCount}`);

      if (spearCount === 0) {
        console.log(`⏭️  Žádné kopijníky k dispozici`);
        return { success: true, message: 'Žádné jednotky k dispozici', waitTime: 5 * 60 * 1000 };
      }

      // Analyzovat scavenge možnosti
      const scavengeAnalysis = await this.analyzeScavengeOptions();

      console.log(`📊 Analýza: ${scavengeAnalysis.availableForSend.length} dostupných, ${scavengeAnalysis.running} běžících, ${scavengeAnalysis.locked.length} zamčených`);

      // Pokud něco běží nebo nic není dostupné
      if (scavengeAnalysis.running > 0 || scavengeAnalysis.availableForSend.length === 0) {
        // Pokud jsou zamčené možnosti, zkus je odemknout
        if (scavengeAnalysis.locked.length > 0) {
          console.log(`🔓 Pokus o odemknutí možnosti...`);
          await this.unlockOption(scavengeAnalysis.locked[0]);
          return { success: true, message: 'Odemykání možnosti', waitTime: 5 * 60 * 1000 };
        }

        console.log(`⏳ Sběr běží, čekání...`);
        return { success: true, message: 'Sběr již běží', waitTime: 5 * 60 * 1000 };
      }

      // Rozdělit jednotky podle počtu možností
      const allocation = this.calculateAllocation(spearCount, scavengeAnalysis.availableForSend.length);

      console.log(`📦 Rozdělení jednotek:`, allocation);

      // Odeslat na všechny dostupné možnosti
      const sent = await this.sendToAllOptions(scavengeAnalysis.availableForSend, allocation);

      console.log(`✅ Odesláno na ${sent} možností`);

      return {
        success: true,
        message: `Odesláno ${sent} scavenge možností`,
        waitTime: 2 * 60 * 1000 // 2 minuty po odeslání
      };

    } catch (error) {
      console.error(`Chyba v logice sběru:`, error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Analyzovat scavenge možnosti
   */
  async analyzeScavengeOptions() {
    return await this.page.evaluate(() => {
      const options = Array.from(document.querySelectorAll('.scavenge-option'));

      const availableForSend = [];
      const locked = [];
      let running = 0;

      options.forEach((opt, index) => {
        const inactiveView = opt.querySelector('.inactive-view');
        const lockedView = opt.querySelector('.locked-view');
        const countdown = opt.querySelector('[class*="countdown"], [class*="return"]');

        if (inactiveView && !lockedView) {
          // Dostupná možnost - má inactive-view a nemá locked-view
          const sendButton = opt.querySelector('a.free_send_button');
          if (sendButton) {
            availableForSend.push(index);
          }
        } else if (lockedView) {
          // Zamčená možnost
          locked.push(index);
        } else if (countdown && countdown.textContent.trim() !== '') {
          // Běžící sběr
          running++;
        }
      });

      return { availableForSend, locked, running };
    });
  }

  /**
   * Vypočítat rozdělení jednotek podle počtu možností
   * Podle UserScriptu
   */
  calculateAllocation(totalSpears, optionsCount) {
    const allocationPercentages = {
      4: [57.63, 23.03, 11.51, 7.64],
      3: [62.48, 24.99, 12.49],
      2: [71.42, 28.57],
      1: [100]
    };

    const percentages = allocationPercentages[optionsCount] || [100];
    return percentages.map(pct => Math.floor((pct / 100) * totalSpears));
  }

  /**
   * Odeslat jednotky na všechny dostupné možnosti
   */
  async sendToAllOptions(optionIndexes, allocation) {
    let sent = 0;

    for (let i = 0; i < optionIndexes.length; i++) {
      const optionIndex = optionIndexes[i];
      const unitsToSend = allocation[i];

      if (unitsToSend < 10) {
        console.log(`⏭️  Přeskakuji možnost ${optionIndex + 1} (méně než 10 jednotek)`);
        continue;
      }

      console.log(`📤 Odesílám ${unitsToSend} jednotek na možnost ${optionIndex + 1}...`);

      const success = await this.sendToOption(optionIndex, unitsToSend);

      if (success) {
        sent++;
        // Čekat mezi odesláními (1.5s)
        await this.page.waitForTimeout(1500);
      }
    }

    return sent;
  }

  /**
   * Odeslat jednotky na konkrétní možnost
   */
  async sendToOption(optionIndex, unitsCount) {
    try {
      const success = await this.page.evaluate(({ optionIndex, unitsCount }) => {
        // Najdi input pro spear
        const spearInput = document.querySelector('input[name="spear"]');
        if (!spearInput) return false;

        // Nastav hodnotu
        spearInput.value = unitsCount.toString();

        // Trigger events
        ['input', 'change', 'keyup', 'keydown', 'blur'].forEach(eventType => {
          spearInput.dispatchEvent(new Event(eventType, { bubbles: true }));
        });

        // Najdi konkrétní scavenge option
        const options = Array.from(document.querySelectorAll('.scavenge-option'));
        const option = options[optionIndex];

        if (!option) return false;

        // Najdi send button
        const sendButton = option.querySelector('a.free_send_button');
        if (!sendButton) return false;

        // Klikni
        sendButton.click();

        return true;
      }, { optionIndex, unitsCount });

      return success;
    } catch (error) {
      console.error(`Chyba při odesílání na možnost ${optionIndex}:`, error.message);
      return false;
    }
  }

  /**
   * Pokus o odemknutí zamčené možnosti (premium)
   */
  async unlockOption(optionIndex) {
    try {
      // Klikni na unlock button
      await this.page.evaluate((optionIndex) => {
        const options = Array.from(document.querySelectorAll('.scavenge-option'));
        const option = options[optionIndex];

        if (!option) return;

        const unlockBtn = option.querySelector('a.unlock-button');
        if (unlockBtn) {
          unlockBtn.click();
        }
      }, optionIndex);

      // Počkat na popup
      await this.page.waitForTimeout(1000);

      // Pokus o potvrzení (nebo zavření pokud disabled)
      await this.page.evaluate(() => {
        // FIXED: Hledat confirm button JEN V POPUP okně
        const popup = document.querySelector('.popup_box_content');

        if (!popup) {
          console.log('Auto Scavenge: Popup nenalezen');
          return;
        }

        // Najít confirm button v popup (ne unlock-button, ne disabled)
        const confirmBtn = popup.querySelector('a.btn.btn-default:not(.unlock-button):not(.btn-disabled)');
        const disabledBtn = popup.querySelector('a.btn.btn-default.btn-disabled');

        if (confirmBtn) {
          console.log('Auto Scavenge: Potvrzuji odemknutí...');
          confirmBtn.click();
        } else if (disabledBtn) {
          console.log('Auto Scavenge: Odemknutí není možné (nedostatek surovin), zavírám popup...');
          const closeBtn = document.querySelector('a.popup_box_close');
          if (closeBtn) closeBtn.click();
        } else {
          console.log('Auto Scavenge: Confirm button nenalezen, zavírám popup...');
          const closeBtn = document.querySelector('a.popup_box_close');
          if (closeBtn) closeBtn.click();
        }
      });

      return true;
    } catch (error) {
      console.error(`Chyba při odemykání:`, error.message);
      return false;
    }
  }

  /**
   * Pomocná metoda pro náhodné čekání
   */
  async randomWait(minMs = 1000, maxMs = 3000) {
    const wait = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
    await this.page.waitForTimeout(wait);
  }
}

export default ScavengeModule;
