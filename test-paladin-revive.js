/**
 * Testovací skript pro test oživení paladina
 *
 * JAK POUŽÍT:
 * 1. Otevřete hru v prohlížeči
 * 2. Jděte na screen=statue (socha paladina) - paladin MUSÍ být MRTVÝ
 * 3. Otevřete konzoli (F12)
 * 4. Zkopírujte a vložte celý tento soubor do konzole
 * 5. Spusťte: await testPaladinRevive()
 */

async function testPaladinRevive() {
  console.log('='.repeat(60));
  console.log('💀 PALADIN REVIVE TEST');
  console.log('='.repeat(60));

  // Krok 1: Najdi revive tlačítko
  console.log('\n📋 KROK 1: Hledám revive tlačítko');
  console.log('-'.repeat(60));

  const reviveButton = document.querySelector('a.knight_revive_launch');

  if (!reviveButton) {
    console.log('❌ Revive button nenalezen!');
    console.log('   Paladin pravděpodobně není mrtvý.');
    console.log('   Zkontrolujte stav paladina:');

    const recruitButton = document.querySelector('a.knight_recruit_launch');
    const reviveAbortButton = document.querySelector('a.knight_revive_abort');
    const trainButton = document.querySelector('a.knight_train_launch');
    const learnableSkills = document.querySelectorAll('.skill_node.learnable');

    if (recruitButton) {
      console.log('   → Paladin není rekrutován (nebo probíhá rekrutace)');
    } else if (reviveAbortButton) {
      console.log('   → Paladin se právě oživuje (reviving in progress)');
    } else if (trainButton || learnableSkills.length > 0) {
      console.log('   → Paladin je ŽIVÝ (alive)');
    } else {
      console.log('   → Neznámý stav paladina');
    }

    return;
  }

  console.log('✅ Revive button nalezen!');
  console.log(`   class="${reviveButton.className}"`);
  console.log(`   text="${reviveButton.textContent.trim()}"`);

  // Krok 2: Klikni na revive tlačítko
  console.log('\n📋 KROK 2: Klikám na revive tlačítko');
  console.log('⏳ Počkám 3 sekundy (pokud nechcete kliknout, stiskněte ESC a zavřete konzoli)');
  console.log('-'.repeat(60));

  await new Promise(resolve => setTimeout(resolve, 3000));

  console.log('🖱️  Klikám...');
  reviveButton.click();

  // Krok 3: Čekej na popup
  console.log('\n📋 KROK 3: Čekám na popup');
  console.log('-'.repeat(60));

  await new Promise(resolve => setTimeout(resolve, 1500));

  const popup = document.querySelector('.popup_box_container, .popup_box');

  if (!popup) {
    console.log('❌ Popup se neobjevil!');
    return;
  }

  console.log('✅ Popup se objevil!');

  // Krok 4: Analyzuj popup
  console.log('\n📋 KROK 4: Analýza popup');
  console.log('-'.repeat(60));

  const popupButtons = popup.querySelectorAll('a, button');
  console.log(`Nalezeno ${popupButtons.length} tlačítek v popupu:`);

  popupButtons.forEach((btn, i) => {
    console.log(`\n  ${i + 1}. ${btn.tagName}`);
    console.log(`     class="${btn.className}"`);
    console.log(`     id="${btn.id}"`);
    console.log(`     text="${btn.textContent.trim()}"`);
  });

  // Krok 5: Najdi confirmation tlačítko
  console.log('\n📋 KROK 5: Hledám confirmation tlačítko');
  console.log('-'.repeat(60));

  const confirmButton = document.querySelector('#knight_revive_confirm');

  if (!confirmButton) {
    console.log('❌ Confirmation tlačítko nenalezeno!');
    console.log('   Zkouším najít podle jiných selektorů...');

    // Zkus najít podle textu
    const allButtons = Array.from(popupButtons);
    const possibleButtons = allButtons.filter(btn => {
      const text = btn.textContent.trim().toLowerCase();
      return text.includes('oživit') || text.includes('revive') ||
             text.includes('ano') || text.includes('yes');
    });

    if (possibleButtons.length > 0) {
      console.log(`   Nalezeno ${possibleButtons.length} možných tlačítek:`);
      possibleButtons.forEach((btn, i) => {
        console.log(`     ${i + 1}. class="${btn.className}" id="${btn.id}" text="${btn.textContent.trim()}"`);
      });
    }

    return;
  }

  console.log('✅ Confirmation tlačítko nalezeno!');
  console.log(`   class="${confirmButton.className}"`);
  console.log(`   id="${confirmButton.id}"`);
  console.log(`   text="${confirmButton.textContent.trim()}"`);

  // Krok 6: Klikni na confirmation tlačítko
  console.log('\n📋 KROK 6: Klikám na confirmation tlačítko');
  console.log('⏳ Počkám 2 sekundy (pokud nechcete potvrdit, stiskněte ESC)');
  console.log('-'.repeat(60));

  await new Promise(resolve => setTimeout(resolve, 2000));

  console.log('🖱️  Klikám na confirmation...');

  // Zkus více metod kliknutí
  confirmButton.click();

  const clickEvent = new MouseEvent('click', {
    view: window,
    bubbles: true,
    cancelable: true
  });
  confirmButton.dispatchEvent(clickEvent);

  console.log('✅ Kliknutí provedeno (obě metody)');

  // Krok 7: Čekej a zkontroluj výsledek
  console.log('\n📋 KROK 7: Kontrola výsledku');
  console.log('-'.repeat(60));

  await new Promise(resolve => setTimeout(resolve, 2000));

  const popupStillExists = document.querySelector('.popup_box_container, .popup_box');

  if (!popupStillExists) {
    console.log('✅✅✅ ÚSPĚCH! Popup se zavřel - oživení bylo potvrzeno!');
  } else {
    console.log('⚠️  Popup je stále otevřený');
    console.log('   To může znamenat:');
    console.log('   1. Oživení probíhá, ale popup se nezavřel');
    console.log('   2. Kliknutí nefungovalo správně');
    console.log('   3. Hra čeká na další akci');
    console.log('\n   Zkuste ručně zavřít popup a zkontrolovat, zda oživení probíhá');
  }

  // Finální kontrola
  console.log('\n📋 KROK 8: Finální kontrola stránky');
  console.log('-'.repeat(60));

  await new Promise(resolve => setTimeout(resolve, 1000));

  const content = document.querySelector('#content_value');
  if (content) {
    const text = content.textContent.trim().substring(0, 300);
    console.log('Obsah stránky:');
    console.log(text);

    const hasCountdown = text.includes(':') && text.match(/\d{1,2}:\d{2}:\d{2}/);
    if (hasCountdown) {
      console.log('\n✅✅✅ COUNTDOWN DETEKOVÁN - Oživení běží!');
    } else {
      console.log('\n⚠️  Countdown nenalezen');

      // Zkontroluj, jestli je revive abort button
      const reviveAbort = document.querySelector('a.knight_revive_abort');
      if (reviveAbort) {
        console.log('✅✅✅ REVIVE ABORT BUTTON NALEZEN - Oživení běží!');
      } else {
        console.log('   Zkontrolujte stránku ručně');
      }
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('✅ TEST DOKONČEN');
  console.log('='.repeat(60));
}

console.log('📝 Testovací skript pro oživení načten!');
console.log('🚀 Pro spuštění testu zadejte: await testPaladinRevive()');
console.log('⚠️  POZOR: Tento skript SKUTEČNĚ SPUSTÍ oživení paladina!');
console.log('⚠️  Paladin MUSÍ být MRTVÝ, jinak test selže!');
