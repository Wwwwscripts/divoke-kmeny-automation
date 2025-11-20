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

      // Přejít na tržiště - MODE OWN_OFFER (kontrola skladů zde)
      const worldUrl = this.getWorldUrl();
      console.log(`🌐 Navigace na tržiště (own_offer)...`);
      await this.page.goto(`${worldUrl}/game.php?screen=market&mode=own_offer`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      await this.page.waitForTimeout(2000);

      // 1. Zkontrolovat aktuální stavy surovin
      const resources = await this.getResourceStates();
      console.log(`📦 Suroviny ve skladu:`, resources);

      // 2. Získat příchozí/odchozí suroviny
      const incomingOutgoing = await this.getIncomingOutgoingResources();
      console.log(`📥 Příchozí suroviny:`, incomingOutgoing.incoming);
      console.log(`📤 Odchozí suroviny:`, incomingOutgoing.outgoing);

      // 3. Získat vlastní nabídky (co nabízíme / co chceme)
      const ownOffers = await this.getOwnOffers();
      console.log(`📋 Vlastní nabídky - nabízím:`, ownOffers.offering);
      console.log(`📋 Vlastní nabídky - chci:`, ownOffers.wanting);

      // 4. Zkontrolovat aktivační podmínku
      const maxResource = Math.max(...Object.values(resources));
      if (maxResource < this.MIN_THRESHOLD) {
        console.log(`⏭️  Žádná surovina nepřesahuje ${this.MIN_THRESHOLD}, skip...`);
        return { success: true, message: 'Balancování není potřeba', waitTime: 2 * 60 * 60 * 1000 };
      }

      // 5. Vypočítat cílový stav a co vyměnit (včetně příchozích/odchozích/nabídek)
      const balance = this.calculateBalance(resources, incomingOutgoing, ownOffers);
      console.log(`🎯 Cílový stav:`, balance.targets);
      console.log(`📊 Přebytky:`, balance.surplus);
      console.log(`📊 Nedostatky:`, balance.deficit);

      // Pokud je vše vyvážené
      if (Object.keys(balance.surplus).length === 0 && Object.keys(balance.deficit).length === 0) {
        console.log(`✅ Suroviny jsou již vyvážené!`);
        return { success: true, message: 'Suroviny jsou vyvážené', waitTime: 2 * 60 * 60 * 1000 };
      }

      // 6. Zkontrolovat počet obchodníků
      const merchants = await this.getMerchantsCount();
      console.log(`🚚 Obchodníci: ${merchants.available}/${merchants.total}`);

      if (merchants.available === 0) {
        console.log(`⏭️  Žádní dostupní obchodníci`);
        return { success: true, message: 'Žádní dostupní obchodníci', waitTime: 2 * 60 * 60 * 1000 };
      }

      // 7. Přejít na hlavní tržiště pro přijímání nabídek
      await this.page.goto(`${worldUrl}/game.php?screen=market`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });
      await this.page.waitForTimeout(2000);

      // 8. Přijmout existující nabídky
      const acceptedOffers = await this.acceptExistingOffers(balance, merchants.available);
      console.log(`✅ Přijato nabídek: ${acceptedOffers.count}`);

      // Aktualizovat dostupné obchodníky
      let availableMerchants = merchants.available - acceptedOffers.merchantsUsed;

      // Přepočítat balance po přijetí nabídek
      const updatedBalance = this.updateBalanceAfterTrades(balance, acceptedOffers.trades);
      console.log(`📊 Aktualizovaný stav po přijetí nabídek:`, updatedBalance);

      // 9. Vytvořit vlastní nabídky pokud je potřeba
      if (availableMerchants > 0 && (Object.keys(updatedBalance.surplus).length > 0 || Object.keys(updatedBalance.deficit).length > 0)) {
        console.log(`📝 Vytváření vlastních nabídek...`);
        const createdOffers = await this.createOwnOffers(updatedBalance, availableMerchants);
        console.log(`✅ Vytvořeno nabídek: ${createdOffers.count}`);
      }

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
   *
   * Zahrnuje:
   * - Aktuální suroviny ve skladu
   * - Příchozí suroviny (z přijatých nabídek)
   * - Vlastní nabídky "Za" (co chceme) - počítáme jako by nám už jedou
   */
  calculateBalance(resources, incomingOutgoing = null, ownOffers = null) {
    // Výchozí prázdné hodnoty
    const incoming = incomingOutgoing ? incomingOutgoing.incoming : { wood: 0, stone: 0, iron: 0 };
    const wanting = ownOffers ? ownOffers.wanting : { wood: 0, stone: 0, iron: 0 };

    // Vypočítar "efektivní" suroviny = sklad + příchozí + vlastní_nabídky_ZA
    const effective = {};
    this.RESOURCES.forEach(res => {
      effective[res] = resources[res] + incoming[res] + wanting[res];
    });

    console.log(`📊 Efektivní suroviny (sklad + příchozí + wanting):`, effective);

    // Zaokrouhlit na tisíce dolů
    const rounded = {};
    this.RESOURCES.forEach(res => {
      rounded[res] = Math.floor(effective[res] / 1000) * 1000;
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
   * Po každém přijetí se stránka automaticky refreshne, checkboxy zůstanou nastavené
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

        // Nastavit filtry POUZE JEDNOU na začátku
        await this.setMarketFilters(wantResource, offerResource);
        await this.page.waitForTimeout(1500);

        // Loop pro přijímání nabídek (po každém přijetí se stránka refreshne)
        while (stillNeed > 0 && availableMerchants - merchantsUsed > 0) {
          // Najít vhodné nabídky
          const offers = await this.findSuitableOffers(wantResource, offerResource);

          if (offers.length === 0) {
            console.log(`  ℹ️  Žádné další nabídky`);
            break;
          }

          console.log(`  Nalezeno ${offers.length} vhodných nabídek`);

          // Přijmout PRVNÍ nabídku
          const offer = offers[0];
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

              // Počkat na automatický refresh stránky (po submitu formuláře)
              console.log(`  ⏳ Čekám na refresh stránky...`);
              await this.page.waitForTimeout(3000); // Počkat na reload a načtení
            } else {
              // Pokud se nepodařilo přijmout, ukončit loop
              break;
            }
          } else {
            break;
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
   * LANGUAGE-INDEPENDENT - hledá tabulku s form.market_accept_offer
   */
  async findSuitableOffers(wantResource, offerResource) {
    return await this.page.evaluate(({ want, offer }) => {
      const tables = document.querySelectorAll('table.vis');
      let offerTable = null;

      // Najít tabulku s nabídkami k přijetí
      // Tato tabulka obsahuje formuláře s třídou market_accept_offer
      for (const table of tables) {
        const form = table.querySelector('form.market_accept_offer');
        if (form) {
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

  /**
   * Získat příchozí a odchozí suroviny z tržiště (z tabulky 2 na mode=own_offer)
   * Příchozí = suroviny které nám jedou z přijatých nabídek
   * Odchozí = suroviny které odjíždějí v našich nabídkách
   * LANGUAGE-INDEPENDENT - hledá tabulku se 2 TH obsahujícími span.nowrap s ikonami
   */
  async getIncomingOutgoingResources() {
    return await this.page.evaluate(() => {
      const incoming = { wood: 0, stone: 0, iron: 0 };
      const outgoing = { wood: 0, stone: 0, iron: 0 };

      const tables = document.querySelectorAll('table.vis');

      // Najít tabulku s příchozími/odchozími
      // Tato tabulka má 1 řádek s 2 TH, každý TH má více span.nowrap s ikonami
      for (const table of tables) {
        const ths = table.querySelectorAll('th');

        // Kontrola: tabulka má právě 2 TH
        if (ths.length !== 2) continue;

        // Kontrola: oba TH mají span.nowrap s ikonami
        let hasIcons = true;
        for (const th of ths) {
          const spans = th.querySelectorAll('span.nowrap');
          if (spans.length === 0) {
            hasIcons = false;
            break;
          }

          // Kontrola že alespoň jeden span má ikonu
          let hasIcon = false;
          for (const span of spans) {
            if (span.querySelector('span.icon.header')) {
              hasIcon = true;
              break;
            }
          }
          if (!hasIcon) {
            hasIcons = false;
            break;
          }
        }

        if (!hasIcons) continue;

        // Toto je naše tabulka!
        // První TH = příchozí, druhý TH = odchozí
        const firstTh = ths[0];
        const secondTh = ths[1];

        // Parsovat příchozí suroviny z prvního TH
        const incomingSpans = firstTh.querySelectorAll('span.nowrap');
        incomingSpans.forEach(span => {
          const icon = span.querySelector('span.icon.header');
          if (!icon) return;

          const resourceType = icon.className.split(' ').find(c => c === 'wood' || c === 'stone' || c === 'iron');
          if (!resourceType) return;

          // Parse množství (2.531 -> 2531)
          const amountText = span.textContent.replace(/\./g, '').replace(/\s/g, '').trim();
          const amount = parseInt(amountText, 10);

          if (!isNaN(amount)) {
            incoming[resourceType] = amount;
          }
        });

        // Parsovat odchozí suroviny z druhého TH
        const outgoingSpans = secondTh.querySelectorAll('span.nowrap');
        outgoingSpans.forEach(span => {
          const icon = span.querySelector('span.icon.header');
          if (!icon) return;

          const resourceType = icon.className.split(' ').find(c => c === 'wood' || c === 'stone' || c === 'iron');
          if (!resourceType) return;

          const amountText = span.textContent.replace(/\./g, '').replace(/\s/g, '').trim();
          const amount = parseInt(amountText, 10);

          if (!isNaN(amount)) {
            outgoing[resourceType] = amount;
          }
        });

        break;
      }

      return { incoming, outgoing };
    });
  }

  /**
   * Získat vlastní vytvořené nabídky z tabulky (tabulka 6 na mode=own_offer)
   * Vrátí co nabízíme a co chceme z našich aktivních nabídek
   * LANGUAGE-INDEPENDENT - hledá tabulku s TH[colspan="2"] a řádky s ikonami
   */
  async getOwnOffers() {
    return await this.page.evaluate(() => {
      const offering = { wood: 0, stone: 0, iron: 0 }; // Co nabízíme celkem
      const wanting = { wood: 0, stone: 0, iron: 0 };   // Co chceme celkem

      const tables = document.querySelectorAll('table.vis');

      // Najít tabulku s vlastními nabídkami
      // Tato tabulka má header s TH[colspan="2"] a data řádky s ikonami v prvních 2 TD
      for (const table of tables) {
        const headerRow = table.querySelector('tr');
        if (!headerRow) continue;

        // Kontrola: má TH s colspan="2" (unikátní pro tuto tabulku)
        const colspanTh = headerRow.querySelector('th[colspan="2"]');
        if (!colspanTh) continue;

        // Parsovat jednotlivé řádky s nabídkami
        const rows = table.querySelectorAll('tr');
        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          const cells = row.querySelectorAll('td');

          if (cells.length < 3) continue;

          // TD 0: co nabízíme (ikona + množství)
          const offerCell = cells[0];
          const offerIcon = offerCell.querySelector('span.icon.header');
          if (!offerIcon) continue; // Skip řádky bez ikony

          const offerResource = offerIcon.className.split(' ').find(c => c === 'wood' || c === 'stone' || c === 'iron');
          const offerAmountText = offerCell.textContent.replace(/\./g, '').replace(/\s/g, '').trim();
          const offerAmount = parseInt(offerAmountText, 10);

          // TD 1: co chceme (ikona + množství)
          const wantCell = cells[1];
          const wantIcon = wantCell.querySelector('span.icon.header');
          if (!wantIcon) continue; // Skip řádky bez ikony

          const wantResource = wantIcon.className.split(' ').find(c => c === 'wood' || c === 'stone' || c === 'iron');
          const wantAmountText = wantCell.textContent.replace(/\./g, '').replace(/\s/g, '').trim();
          const wantAmount = parseInt(wantAmountText, 10);

          // TD 2: počet nabídek
          const countCell = cells[2];
          const count = parseInt(countCell.textContent.trim(), 10);

          if (offerResource && !isNaN(offerAmount) && !isNaN(count)) {
            offering[offerResource] += offerAmount * count;
          }

          if (wantResource && !isNaN(wantAmount) && !isNaN(count)) {
            wanting[wantResource] += wantAmount * count;
          }
        }

        break;
      }

      return { offering, wanting };
    });
  }

  /**
   * Aktualizovat balance po obchodech
   */
  updateBalanceAfterTrades(balance, trades) {
    const newSurplus = { ...balance.surplus };
    const newDeficit = { ...balance.deficit };

    trades.forEach(trade => {
      // Snížit přebytek
      if (newSurplus[trade.give]) {
        newSurplus[trade.give] -= trade.amount;
        if (newSurplus[trade.give] <= 0) {
          delete newSurplus[trade.give];
        }
      }

      // Snížit nedostatek
      if (newDeficit[trade.receive]) {
        newDeficit[trade.receive] -= trade.amount;
        if (newDeficit[trade.receive] <= 0) {
          delete newDeficit[trade.receive];
        }
      }
    });

    return { surplus: newSurplus, deficit: newDeficit, targets: balance.targets };
  }

  /**
   * Vytvořit vlastní nabídky
   */
  async createOwnOffers(balance, availableMerchants) {
    let count = 0;

    // Přejít na stránku pro vytváření nabídek
    const worldUrl = this.getWorldUrl();
    await this.page.goto(`${worldUrl}/game.php?screen=market&mode=own_offer`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    await this.page.waitForTimeout(2000);

    // Pro každou kombinaci přebytek -> nedostatek
    for (const [offerResource, offerAmount] of Object.entries(balance.surplus)) {
      for (const [wantResource, wantAmount] of Object.entries(balance.deficit)) {
        if (availableMerchants <= 0) break;

        const offersToCreate = Math.min(
          Math.floor(offerAmount / this.OFFER_SIZE),
          Math.floor(wantAmount / this.OFFER_SIZE),
          availableMerchants
        );

        if (offersToCreate > 0) {
          console.log(`  📝 Vytvářím ${offersToCreate}x nabídku: ${offerResource} → ${wantResource}`);

          const success = await this.createOffer(offerResource, wantResource, offersToCreate);

          if (success) {
            count += offersToCreate;
            availableMerchants -= offersToCreate;

            // Aktualizovat balance
            balance.surplus[offerResource] -= offersToCreate * this.OFFER_SIZE;
            balance.deficit[wantResource] -= offersToCreate * this.OFFER_SIZE;

            if (balance.surplus[offerResource] <= 0) delete balance.surplus[offerResource];
            if (balance.deficit[wantResource] <= 0) delete balance.deficit[wantResource];

            await this.page.waitForTimeout(2500);
          }
        }
      }
    }

    return { count };
  }

  /**
   * Vytvořit jednu vlastní nabídku
   */
  async createOffer(sellResource, buyResource, count) {
    try {
      const success = await this.page.evaluate(({ sell, buy, count }) => {
        // Nastavit množství (mělo by být už 1000)
        const sellAmount = document.querySelector('input[name="sell"]');
        const buyAmount = document.querySelector('input[name="buy"]');

        if (sellAmount) sellAmount.value = '1000';
        if (buyAmount) buyAmount.value = '1000';

        // Zvolit suroviny (radio buttons)
        const sellRadio = document.querySelector(`input[name="res_sell"][value="${sell}"]`);
        const buyRadio = document.querySelector(`input[name="res_buy"][value="${buy}"]`);

        if (!sellRadio || !buyRadio) return false;

        sellRadio.checked = true;
        buyRadio.checked = true;

        // Nastavit počet nabídek
        const multiInput = document.querySelector('input[name="multi"]');
        if (!multiInput) return false;

        multiInput.value = count.toString();

        // Submit
        const submitBtn = document.querySelector('input[name="submit_offer"]');
        if (!submitBtn) return false;

        submitBtn.click();
        return true;
      }, { sell: sellResource, buy: buyResource, count });

      return success;
    } catch (error) {
      console.error(`Chyba při vytváření nabídky:`, error.message);
      return false;
    }
  }

}

export default BalancModule;
