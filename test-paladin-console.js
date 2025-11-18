/**
 * Testovací skript pro detekci problémů s paladinem
 *
 * JAK POUŽÍT:
 * 1. Otevřete hru v prohlížeči
 * 2. Jděte na screen=statue (socha paladina)
 * 3. Otevřete konzoli (F12)
 * 4. Zkopírujte a vložte celý tento soubor do konzole
 * 5. Spusťte: await testPaladin()
 */

async function testPaladin() {
  console.log('='.repeat(60));
  console.log('🎖️  PALADIN DEBUG TEST');
  console.log('='.repeat(60));

  // Test 1: Detekce stavu paladina
  console.log('\n📋 TEST 1: Detekce tlačítek');
  console.log('-'.repeat(60));

  const recruitButton = document.querySelector('a.knight_recruit_launch');
  const reviveButton = document.querySelector('a.knight_revive_launch');
  const reviveAbortButton = document.querySelector('a.knight_revive_abort');
  const trainButton = document.querySelector('a.knight_train_launch');

  console.log('✓ Recruit button (a.knight_recruit_launch):', recruitButton ? '✅ FOUND' : '❌ NOT FOUND');
  console.log('✓ Revive button (a.knight_revive_launch):', reviveButton ? '✅ FOUND' : '❌ NOT FOUND');
  console.log('✓ Revive abort (a.knight_revive_abort):', reviveAbortButton ? '✅ FOUND' : '❌ NOT FOUND');
  console.log('✓ Train button (a.knight_train_launch):', trainButton ? '✅ FOUND' : '❌ NOT FOUND');

  // Test 2: Všechny linky
  console.log('\n📋 TEST 2: Všechny linky na stránce');
  console.log('-'.repeat(60));

  const allLinks = document.querySelectorAll('a');
  console.log(`Celkem nalezeno ${allLinks.length} linků`);

  const relevantLinks = Array.from(allLinks).filter(a =>
    a.className.includes('knight') ||
    a.textContent.toLowerCase().includes('paladin') ||
    a.textContent.toLowerCase().includes('rekrut') ||
    a.textContent.toLowerCase().includes('oživit') ||
    a.textContent.toLowerCase().includes('trénovat')
  );

  console.log(`\nRelevantní linky (${relevantLinks.length}):`);
  relevantLinks.forEach((link, i) => {
    console.log(`  ${i + 1}. class="${link.className}"`);
    console.log(`     id="${link.id}"`);
    console.log(`     text="${link.textContent.trim()}"`);
    console.log(`     href="${link.href}"`);
    console.log('');
  });

  // Test 3: Detekce skills
  console.log('\n📋 TEST 3: Detekce skills');
  console.log('-'.repeat(60));

  const learnableSkills = document.querySelectorAll('.skill_node.learnable');
  console.log(`Learnable skills: ${learnableSkills.length}`);

  const allSkillNodes = document.querySelectorAll('.skill_node');
  console.log(`All skill nodes: ${allSkillNodes.length}`);

  // Test 4: Obsah stránky
  console.log('\n📋 TEST 4: Obsah content_value');
  console.log('-'.repeat(60));

  const content = document.querySelector('#content_value');
  if (content) {
    const text = content.textContent.trim().substring(0, 500);
    console.log('Content text (prvních 500 znaků):');
    console.log(text);

    const hasCountdown = text.includes(':') && text.match(/\d{1,2}:\d{2}:\d{2}/);
    console.log('\nMá countdown?', hasCountdown ? '✅ ANO' : '❌ NE');
  } else {
    console.log('❌ #content_value nenalezen');
  }

  // Test 5: Zkusíme kliknout na recruit/revive button
  console.log('\n📋 TEST 5: Simulace kliknutí');
  console.log('-'.repeat(60));

  let buttonToClick = null;
  let buttonType = null;

  if (recruitButton) {
    buttonToClick = recruitButton;
    buttonType = 'RECRUIT';
  } else if (reviveButton) {
    buttonToClick = reviveButton;
    buttonType = 'REVIVE';
  }

  if (buttonToClick) {
    console.log(`⚠️  Chystám se kliknout na ${buttonType} button...`);
    console.log('   Počkám 3 sekundy, abyste mohli zrušit (Ctrl+C)');

    await new Promise(resolve => setTimeout(resolve, 3000));

    console.log(`🖱️  Klikám na ${buttonType} button...`);
    buttonToClick.click();

    console.log('⏳ Čekám 2 sekundy na popup...');
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Test 6: Detekce popup
    console.log('\n📋 TEST 6: Detekce popup');
    console.log('-'.repeat(60));

    const popup = document.querySelector('.popup_box_container, .popup_box');
    console.log('Popup:', popup ? '✅ FOUND' : '❌ NOT FOUND');

    if (popup) {
      console.log('\n🔍 Analýza popup obsahu:');

      // Všechna tlačítka v popupu
      const popupButtons = popup.querySelectorAll('a, button');
      console.log(`\nTlačítka v popupu (${popupButtons.length}):`);

      popupButtons.forEach((btn, i) => {
        console.log(`  ${i + 1}. Tag: ${btn.tagName}`);
        console.log(`     class="${btn.className}"`);
        console.log(`     id="${btn.id}"`);
        console.log(`     text="${btn.textContent.trim()}"`);
        console.log(`     href="${btn.href || 'N/A'}"`);
        console.log('');
      });

      // Zkusíme najít confirm button
      const selectors = [
        '#knight_recruit_confirm',
        '#knight_revive_confirm',
        '.btn-confirm-yes',
        '.evt-confirm-btn'
      ];

      console.log('\n🔍 Hledání confirmation tlačítka:');
      for (const selector of selectors) {
        const button = document.querySelector(selector);
        console.log(`  ${selector}: ${button ? '✅ FOUND' : '❌ NOT FOUND'}`);
        if (button) {
          console.log(`     class="${button.className}"`);
          console.log(`     text="${button.textContent.trim()}"`);
        }
      }

      // Zkusíme najít tlačítko podle textu
      console.log('\n🔍 Hledání tlačítka podle textu:');
      const yesTexts = ['Ano', 'Yes', 'OK', 'Potvrdit', 'Confirm'];
      for (const text of yesTexts) {
        const buttons = Array.from(popupButtons).filter(btn =>
          btn.textContent.trim().toLowerCase().includes(text.toLowerCase())
        );
        if (buttons.length > 0) {
          console.log(`  Tlačítka obsahující "${text}": ${buttons.length}x ✅`);
          buttons.forEach(btn => {
            console.log(`     - class="${btn.className}" id="${btn.id}"`);
          });
        }
      }

      console.log('\n⚠️  Popup je otevřený - zavřete jej ručně nebo stiskněte ESC');
    }
  } else {
    console.log('❌ Žádné tlačítko k otestování (paladin je pravděpodobně alive nebo recruiting/reviving)');
  }

  // Test 7: Skill points
  console.log('\n📋 TEST 7: Skill points info');
  console.log('-'.repeat(60));

  const skillPointsContainer = document.querySelector('.knight_skill_points_container');
  if (skillPointsContainer) {
    console.log('✅ Skill points container nalezen');
    console.log('Text:', skillPointsContainer.textContent.trim());

    const numbers = skillPointsContainer.textContent.match(/\d+/g);
    if (numbers && numbers.length >= 2) {
      console.log(`Skill points: ${numbers[0] - numbers[1]} dostupných (${numbers[1]}/${numbers[0]} použitých)`);
    }
  } else {
    console.log('❌ Skill points container nenalezen');
  }

  // Závěr
  console.log('\n' + '='.repeat(60));
  console.log('✅ TEST DOKONČEN');
  console.log('='.repeat(60));
  console.log('\n💡 TIP: Zkopírujte výstup a sdílejte ho pro další analýzu');
}

// Automaticky spustíme test
console.log('📝 Testovací skript načten!');
console.log('🚀 Pro spuštění testu zadejte: await testPaladin()');
