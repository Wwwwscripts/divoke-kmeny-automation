/**
 * Modul pro automatické balancování surovin přes tržiště
 *
 * Běží každé 2 hodiny a automaticky vyvažuje suroviny na tržišti.
 * Aktivuje se pouze pokud je alespoň jedna surovina nad 3000 kusů.
 * Cílový poměr surovin: 35% wood, 35% stone, 30% iron
 * LANGUAGE-INDEPENDENT - používá pouze CSS třídy a ikony.
 */

class BalancModule {
  constructor(page, db, accountId) {
    this.page = page;
    this.db = db;
    this.accountId = accountId;
    this.RESOURCES = ['wood', 'stone', 'iron'];
    this.RESOURCE_PERCENTAGE = { wood: 0.35, stone: 0.35, iron: 0.30 }; // Cílová procenta
    this.MIN_THRESHOLD = 3000; // Minimální množství pro aktivaci
    this.OFFER_SIZE = 1000; // Velikost jedné nabídky
  }

  /**
   * Hlavní metoda modulu
   */
  async execute() {
    try {
      console.log(`\n⚖️  === BALANCE - Účet ${this.accountId} ===`);

      // Získat informace o účtu
      const account = this.db.getAccount(this.accountId);
      if (!account) {
        throw new Error(`Účet s ID ${this.accountId} nebyl nalezen`);
      }

      // Přejít na tržiště
      const worldUrl = this.getWorldUrl();
      console.log(`🌐 Navigace na tržiště...`);
      await this.page.goto(`${worldUrl}/game.php?screen=market`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      await this.page.waitForTimeout(2000);

      // 1. Zkontrolovat aktuální stavy surovin
      const resources = await this.getResourceStates();
      console.log(`📦 Suroviny:`, resources);

      // 2. Zkontrolovat aktivační podmínku
      const maxResource = Math.max(...Object.values(resources));
      if (maxResource < this.MIN_THRESHOLD) {
        console.log(`⏭️  Žádná surovina nepřesahuje ${this.MIN_THRESHOLD}, skip...`);
        return { success: true, message: 'Balancování není potřeba', waitTime: 2 * 60 * 60 * 1000 };
      }

      // 3. Vypočítat cílový stav a co vyměnit
      const balance = this.calculateBalance(resources);
      console.log(`🎯 Cílový stav:`, balance.targets);
      console.log(`📊 Přebytky:`, balance.surplus);
      console.log(`📊 Nedostatky:`, balance.deficit);

      // Pokud je vše vyvážené
      if (Object.keys(balance.surplus).length === 0 && Object.keys(balance.deficit).length === 0) {
        console.log(`✅ Suroviny jsou již vyvážené!`);
        return { success: true, message: 'Suroviny jsou vyvážené', waitTime: 2 * 60 * 60 * 1000 };
      }

      // 4. Zkontrolovat počet obchodníků
      const merchants = await this.getMerchantsCount();
      console.log(`🚚 Obchodníci: ${merchants.available}/${merchants.total}`);

      if (merchants.available === 0) {
        console.log(`⏭️  Žádní dostupní obchodníci`);
        return { success: true, message: 'Žádní dostupní obchodníci', waitTime: 2 * 60 * 60 * 1000 };
      }

      // 5. Přijmout existující nabídky
      const acceptedOffers = await this.acceptExistingOffers(balance, merchants.available);
      console.log(`✅ Přijato nabídek: ${acceptedOffers.count}`);

      return {
        success: true,
        message: `Balancování dokončeno - přijato ${acceptedOffers.count} nabídek`,
        waitTime: 2 * 60 * 60 * 1000 // 2 hodiny
      };

    } catch (error) {
      console.error(`❌ Chyba při balancování:`, error.message);
      return {
        success: false,
        error: error.message,
        waitTime: 2 * 60 * 60 * 1000
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
   * Získat aktuální stavy surovin ze stránky
   */
  async getResourceStates() {
    return await this.page.evaluate(() => {
      const resources = {};
      ['wood', 'stone', 'iron'].forEach(res => {
        const elem = document.querySelector(`#${res}`);
        if (elem) {
          // Parse text jako "28059" nebo "28.059"
          const value = parseInt(elem.textContent.replace(/\./g, '').replace(/\s/g, ''), 10);
          resources[res] = value || 0;
        }
      });
      return resources;
    });
  }

  /**
   * Vypočítat cílový stav a co je potřeba vyměnit
   * Pracuje pouze s celými tisíci
   * Logika: Iron max 30%, zbytek rozdělit rovnoměrně mezi wood a stone
   * Při lichém zbytku má přednost stone (hlína)
   */
  calculateBalance(resources) {
    // Zaokrouhlit na tisíce dolů
    const rounded = {};
    this.RESOURCES.forEach(res => {
      rounded[res] = Math.floor(resources[res] / 1000) * 1000;
    });

    // Celkový součet surovin
    const totalResources = Object.values(rounded).reduce((a, b) => a + b, 0);

    // Iron má max 30% z celku
    const ironMaxAmount = totalResources * 0.30;
    const ironTarget = Math.floor(ironMaxAmount / 1000) * 1000;

    // Zbytek rozdělit rovnoměrně mezi wood a stone
    const remainingForWoodStone = totalResources - ironTarget;

    // Wood dostane polovinu (zaokrouhleno dolů)
    const woodTarget = Math.floor((remainingForWoodStone / 2) / 1000) * 1000;

    // Stone dostane zbytek (má přednost při lichém čísle)
    const stoneTarget = remainingForWoodStone - woodTarget;

    const targets = {
      wood: woodTarget,
      stone: stoneTarget,
      iron: ironTarget
    };

    // Vypočítat přebytky a nedostatky
    const surplus = {}; // Co mám navíc (nabízím)
    const deficit = {}; // Co mi chybí (chci)

    this.RESOURCES.forEach(res => {
      const diff = rounded[res] - targets[res];
      if (diff > 0) {
        surplus[res] = diff;
      } else if (diff < 0) {
        deficit[res] = Math.abs(diff);
      }
    });

    return { targets, surplus, deficit, rounded };
  }

  /**
   * Získat počet dostupných obchodníků
   */
  async getMerchantsCount() {
    return await this.page.evaluate(() => {
      const tables = document.querySelectorAll('table.vis');

      for (const table of tables) {
        const text = table.textContent;
        const match = text.match(/(\d+)\/(\d+)/);

        // Kontrola že je to krátký text (ne dlouhá tabulka)
        if (match && text.length < 200) {
          return {
            available: parseInt(match[1], 10),
            total: parseInt(match[2], 10)
          };
        }
      }

      return { available: 0, total: 0 };
    });
  }

  /**
   * Přijmout existující nabídky na tržišti
   */
  async acceptExistingOffers(balance, availableMerchants) {
    const trades = [];
    let merchantsUsed = 0;
    let count = 0;

    // Pro každou surovinu kterou potřebuji
    for (const [wantResource, wantAmount] of Object.entries(balance.deficit)) {
      let stillNeed = wantAmount / this.OFFER_SIZE; // Kolik tisíců potřebuji

      // Pro každou surovinu kterou mám navíc
      for (const [offerResource, offerAmount] of Object.entries(balance.surplus)) {
        if (stillNeed <= 0 || availableMerchants - merchantsUsed <= 0) break;

        console.log(`🔍 Hledám nabídky: nabízejí ${wantResource}, chtějí ${offerResource}`);

        // Nastavit filtry
        await this.setMarketFilters(wantResource, offerResource);
        await this.page.waitForTimeout(1500);

        // Najít vhodné nabídky
        const offers = await this.findSuitableOffers(wantResource, offerResource);
        console.log(`  Nalezeno ${offers.length} vhodných nabídek`);

        // Přijmout nabídky
        for (const offer of offers) {
          if (stillNeed <= 0 || availableMerchants - merchantsUsed <= 0) break;

          const canAccept = Math.min(
            stillNeed,
            offer.available,
            availableMerchants - merchantsUsed
          );

          if (canAccept > 0) {
            console.log(`  ✅ Přijímám ${canAccept}x nabídku od ${offer.player}`);

            const success = await this.acceptOffer(offer.formAction, canAccept);

            if (success) {
              trades.push({
                give: offerResource,
                receive: wantResource,
                amount: canAccept * this.OFFER_SIZE
              });

              stillNeed -= canAccept;
              merchantsUsed += canAccept;
              count++;

              await this.page.waitForTimeout(2000);
            }
          }
        }
      }
    }

    return { count, merchantsUsed, trades };
  }

  /**
   * Nastavit filtry na tržišti (checkboxy)
   * Po každém kliknutí čeká na AJAX refresh nabídek
   */
  async setMarketFilters(resourceToBuy, resourceToSell) {
    // 1. Kliknout "všechno" pro buy → POČKAT NA AJAX
    try {
      await this.page.click('input[name="res_buy"][value="all"]');
      console.log('  ✓ Kliknuto: všechno buy, čekám na AJAX refresh...');
      await this.page.waitForTimeout(2500);
    } catch (e) {
      console.log('Checkbox "všechno buy" nenalezen');
    }

    // 2. Kliknout "všechno" pro sell → POČKAT NA AJAX
    try {
      await this.page.click('input[name="res_sell"][value="all"]');
      console.log('  ✓ Kliknuto: všechno sell, čekám na AJAX refresh...');
      await this.page.waitForTimeout(2500);
    } catch (e) {
      console.log('Checkbox "všechno sell" nenalezen');
    }

    // 3. Kliknout konkrétní surovinu pro buy → POČKAT NA AJAX
    try {
      await this.page.click(`input[name="res_buy"][value="${resourceToBuy}"]`);
      console.log(`  ✓ Kliknuto: ${resourceToBuy} buy, čekám na AJAX refresh...`);
      await this.page.waitForTimeout(2500);
    } catch (e) {
      console.log(`Checkbox "${resourceToBuy} buy" nenalezen`);
    }

    // 4. Kliknout konkrétní surovinu pro sell → POČKAT NA AJAX
    try {
      await this.page.click(`input[name="res_sell"][value="${resourceToSell}"]`);
      console.log(`  ✓ Kliknuto: ${resourceToSell} sell, čekám na AJAX refresh...`);
      await this.page.waitForTimeout(2500);
    } catch (e) {
      console.log(`Checkbox "${resourceToSell} sell" nenalezen`);
    }

    console.log('  ✅ Filtry nastaveny, nabídky načtené');
  }

  /**
   * Najít vhodné nabídky (1000 za 1000)
   */
  async findSuitableOffers(wantResource, offerResource) {
    return await this.page.evaluate(({ want, offer }) => {
      const tables = document.querySelectorAll('table.vis');
      let offerTable = null;

      // Najít tabulku s nabídkami
      for (const table of tables) {
        const text = table.textContent;
        if (text.includes('Přijmout') && text.includes('Poměr')) {
          offerTable = table;
          break;
        }
      }

      if (!offerTable) return [];

      const rows = offerTable.querySelectorAll('tr');
      const suitableOffers = [];

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const cells = row.querySelectorAll('td');

        if (cells.length < 6) continue;

        // TD 0: co nabízí (množství)
        // TD 1: co chce (množství)
        const offeredText = cells[0].textContent.trim();
        const requestedText = cells[1].textContent.trim();

        // Parsovat množství (1.000 -> 1000)
        const offeredAmount = parseInt(offeredText.replace(/\./g, '').replace(/\s/g, ''), 10);
        const requestedAmount = parseInt(requestedText.replace(/\./g, '').replace(/\s/g, ''), 10);

        // POUZE 1000 za 1000
        if (offeredAmount !== 1000 || requestedAmount !== 1000) continue;

        // Zjistit jaké suroviny se nabízejí
        const icons = cells[0].querySelectorAll('span.icon.header');
        const offeredResource = icons[0] ? icons[0].className.split(' ').find(c => c === 'wood' || c === 'stone' || c === 'iron') : null;

        const icons2 = cells[1].querySelectorAll('span.icon.header');
        const requestedResource = icons2[0] ? icons2[0].className.split(' ').find(c => c === 'wood' || c === 'stone' || c === 'iron') : null;

        // Kontrola zda odpovídá tomu co hledáme
        if (offeredResource !== want || requestedResource !== offer) continue;

        // Parsovat počet dostupných nabídek
        const availableText = cells[5].textContent.trim(); // "16 nabídek"
        const availableMatch = availableText.match(/(\d+)/);
        const available = availableMatch ? parseInt(availableMatch[1], 10) : 0;

        // Najít formulář pro přijetí
        const form = row.querySelector('form.market_accept_offer');
        if (!form) continue;

        const formAction = form.action;
        const player = cells[2].textContent.trim();

        suitableOffers.push({
          offeredResource,
          requestedResource,
          available,
          player,
          formAction
        });
      }

      return suitableOffers;
    }, { want: wantResource, offer: offerResource });
  }

  /**
   * Přijmout konkrétní nabídku
   */
  async acceptOffer(formAction, count) {
    try {
      const success = await this.page.evaluate(({ action, count }) => {
        const form = document.querySelector(`form[action="${action}"]`);
        if (!form) return false;

        const countInput = form.querySelector('input[name="count"]');
        if (!countInput) return false;

        countInput.value = count.toString();

        // Trigger events
        ['input', 'change'].forEach(eventType => {
          countInput.dispatchEvent(new Event(eventType, { bubbles: true }));
        });

        // Najít a kliknout na submit button
        const submitBtn = form.querySelector('input[type="submit"]') ||
                          form.querySelector('button[type="submit"]') ||
                          form.querySelector('input[name="submit"]');

        if (!submitBtn) return false;

        // Kliknout na button
        submitBtn.click();
        return true;
      }, { action: formAction, count });

      return success;
    } catch (error) {
      console.error(`Chyba při přijímání nabídky:`, error.message);
      return false;
    }
  }

}

export default BalancModule;
