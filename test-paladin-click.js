/**
 * Testovací skript pro test kliknutí na confirmation tlačítko
 *
 * JAK POUŽÍT:
 * 1. Otevřete hru v prohlížeči
 * 2. Jděte na screen=statue (socha paladina)
 * 3. Otevřete konzoli (F12)
 * 4. Zkopírujte a vložte celý tento soubor do konzole
 * 5. Spusťte: await testPaladinClick()
 */

async function testPaladinClick() {
  console.log('='.repeat(60));
  console.log('🎖️  PALADIN CLICK TEST');
  console.log('='.repeat(60));

  // Krok 1: Najdi recruit tlačítko
  console.log('\n📋 KROK 1: Hledám recruit tlačítko');
  console.log('-'.repeat(60));

  const recruitButton = document.querySelector('a.knight_recruit_launch');

  if (!recruitButton) {
    console.log('❌ Recruit button nenalezen!');
    console.log('   Paladin je pravděpodobně již rekrutován nebo probíhá rekrutace.');
    return;
  }

  console.log('✅ Recruit button nalezen!');
  console.log(`   class="${recruitButton.className}"`);
  console.log(`   text="${recruitButton.textContent.trim()}"`);

  // Krok 2: Klikni na recruit tlačítko
  console.log('\n📋 KROK 2: Klikám na recruit tlačítko');
  console.log('⏳ Počkám 3 sekundy (pokud nechcete kliknout, stiskněte ESC a zavřete konzoli)');
  console.log('-'.repeat(60));

  await new Promise(resolve => setTimeout(resolve, 3000));

  console.log('🖱️  Klikám...');
  recruitButton.click();

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

  const confirmButton = document.querySelector('#knight_recruit_confirm');

  if (!confirmButton) {
    console.log('❌ Confirmation tlačítko nenalezeno!');
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
    console.log('✅✅✅ ÚSPĚCH! Popup se zavřel - rekrutace byla potvrzena!');
  } else {
    console.log('⚠️  Popup je stále otevřený');
    console.log('   To může znamenat:');
    console.log('   1. Rekrutace probíhá, ale popup se nezavřel');
    console.log('   2. Kliknutí nefungovalo správně');
    console.log('   3. Hra čeká na další akci');
    console.log('\n   Zkuste ručně zavřít popup a zkontrolovat, zda rekrutace probíhá');
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
      console.log('\n✅✅✅ COUNTDOWN DETEKOVÁN - Rekrutace běží!');
    } else {
      console.log('\n⚠️  Countdown nenalezen - zkontrolujte stránku ručně');
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('✅ TEST DOKONČEN');
  console.log('='.repeat(60));
}

console.log('📝 Testovací skript pro kliknutí načten!');
console.log('🚀 Pro spuštění testu zadejte: await testPaladinClick()');
console.log('⚠️  POZOR: Tento skript SKUTEČNĚ SPUSTÍ rekrutaci paladina!');
