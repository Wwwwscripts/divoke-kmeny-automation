/**
 * Testovací script pro konzoli - zjišťování jednotek
 *
 * Jak použít:
 * 1. Otevři si Divoké kmeny v prohlížeči
 * 2. Otevři konzoli (F12)
 * 3. Zkopíruj a vlož tento celý script do konzole
 * 4. Spusť funkci: testUnitsDetection()
 */

// ============================================================================
// TESTOVACÍ FUNKCE PRO ZJIŠŤOVÁNÍ JEDNOTEK
// ============================================================================

/**
 * Test 1: Zjišťování jednotek z Train screen
 */
async function testTrainScreen() {
  console.log('\n' + '='.repeat(80));
  console.log('TEST 1: TRAIN SCREEN (kasárny/stáje/dílna)');
  console.log('='.repeat(80));

  try {
    // Zjistíme svět
    const world = window.location.hostname.match(/([^.]+)\./)[1];
    const domain = window.location.hostname.match(/\.(.*)/)[1];
    const worldUrl = `https://${world}.${domain}`;

    console.log(`🌍 Svět: ${worldUrl}`);

    // Přejdeme na train screen
    window.location.href = `${worldUrl}/game.php?screen=train`;

    // Počkáme na načtení
    await new Promise(resolve => setTimeout(resolve, 2000));

    const unitTypes = ['spear', 'sword', 'axe', 'archer', 'spy', 'light', 'marcher', 'heavy', 'ram', 'catapult'];
    const units = {};

    unitTypes.forEach(unitType => {
      const input = document.querySelector(`input[name="${unitType}"]`);

      if (!input) {
        console.log(`❌ ${unitType}: Input nenalezen`);
        units[unitType] = { inVillage: 0, total: 0, away: 0 };
        return;
      }

      const row = input.closest('tr');
      if (!row) {
        console.log(`❌ ${unitType}: Řádek nenalezen`);
        units[unitType] = { inVillage: 0, total: 0, away: 0 };
        return;
      }

      console.log(`\n🔍 Analyzuji: ${unitType}`);
      console.log('HTML řádku:', row.innerHTML);

      // Hledáme všechny buňky
      const cells = Array.from(row.querySelectorAll('td'));
      console.log(`Počet buněk: ${cells.length}`);

      let found = false;
      cells.forEach((cell, index) => {
        const text = cell.textContent.trim();
        console.log(`  Buňka ${index}: "${text}"`);

        // Hledáme pattern "X / Y"
        const match = text.match(/^(\d+)\s*\/\s*(\d+)$/);
        if (match) {
          const inVillage = parseInt(match[1]);
          const total = parseInt(match[2]);
          const away = total - inVillage;

          console.log(`  ✅ NALEZENO: ${inVillage}/${total} (mimo: ${away})`);

          units[unitType] = { inVillage, total, away };
          found = true;
        }
      });

      if (!found) {
        console.log(`  ⚠️ Pattern "X / Y" nenalezen`);
        units[unitType] = { inVillage: 0, total: 0, away: 0 };
      }
    });

    console.log('\n📊 VÝSLEDEK:');
    console.table(units);

    return units;

  } catch (error) {
    console.error('❌ Chyba:', error);
    return null;
  }
}

/**
 * Test 2: Zjišťování jednotek z Rally Point (place)
 */
async function testRallyPoint() {
  console.log('\n' + '='.repeat(80));
  console.log('TEST 2: RALLY POINT (shromaždiště)');
  console.log('='.repeat(80));

  try {
    // Zjistíme svět
    const world = window.location.hostname.match(/([^.]+)\./)[1];
    const domain = window.location.hostname.match(/\.(.*)/)[1];
    const worldUrl = `https://${world}.${domain}`;

    console.log(`🌍 Svět: ${worldUrl}`);

    // Přejdeme na rally point
    window.location.href = `${worldUrl}/game.php?screen=place`;

    // Počkáme na načtení
    await new Promise(resolve => setTimeout(resolve, 2000));

    const unitTypes = ['spear', 'sword', 'axe', 'archer', 'spy', 'light', 'marcher', 'heavy', 'ram', 'catapult', 'knight', 'snob'];
    const units = {};

    unitTypes.forEach(unitType => {
      const input = document.querySelector(`input[name="${unitType}"]`);

      if (!input) {
        console.log(`❌ ${unitType}: Input nenalezen`);
        units[unitType] = { inVillage: 0, total: 0, away: 0 };
        return;
      }

      const row = input.closest('tr');
      if (!row) {
        console.log(`❌ ${unitType}: Řádek nenalezen`);
        units[unitType] = { inVillage: 0, total: 0, away: 0 };
        return;
      }

      console.log(`\n🔍 Analyzuji: ${unitType}`);
      console.log('HTML řádku:', row.innerHTML);

      // Hledáme element s jednotkami
      const unitElement = row.querySelector('.unit-item, .units-entry, a');

      if (unitElement) {
        const text = unitElement.textContent || '';
        console.log(`  Text elementu: "${text}"`);

        // Pattern 1: "(123)" - jednotky ve vesnici
        const inVillageMatch = text.match(/\((\d+)\)/);
        const inVillage = inVillageMatch ? parseInt(inVillageMatch[1]) : 0;

        console.log(`  Ve vesnici (závorka): ${inVillage}`);

        // Pattern 2: Celkový počet
        let total = inVillage;

        // Zkusíme data-count
        const dataCount = input.getAttribute('data-count');
        if (dataCount) {
          total = parseInt(dataCount);
          console.log(`  Celkem (data-count): ${total}`);
        }

        // Nebo pattern "123 (456)"
        const totalMatch = text.match(/(\d+)\s*\(/);
        if (totalMatch) {
          total = parseInt(totalMatch[1]);
          console.log(`  Celkem (před závorkou): ${total}`);
        }

        const away = Math.max(0, total - inVillage);

        console.log(`  ✅ VÝSLEDEK: ${inVillage}/${total} (mimo: ${away})`);

        units[unitType] = { inVillage, total, away };
      } else {
        console.log(`  ⚠️ Element s jednotkami nenalezen`);
        units[unitType] = { inVillage: 0, total: 0, away: 0 };
      }
    });

    console.log('\n📊 VÝSLEDEK:');
    console.table(units);

    return units;

  } catch (error) {
    console.error('❌ Chyba:', error);
    return null;
  }
}

/**
 * Test 3: Zjišťování jednotek z Overview
 */
async function testOverview() {
  console.log('\n' + '='.repeat(80));
  console.log('TEST 3: OVERVIEW (přehled vesnic)');
  console.log('='.repeat(80));

  try {
    // Zjistíme svět
    const world = window.location.hostname.match(/([^.]+)\./)[1];
    const domain = window.location.hostname.match(/\.(.*)/)[1];
    const worldUrl = `https://${world}.${domain}`;

    console.log(`🌍 Svět: ${worldUrl}`);

    // Přejdeme na overview
    window.location.href = `${worldUrl}/game.php?screen=overview_villages&mode=units`;

    // Počkáme na načtení
    await new Promise(resolve => setTimeout(resolve, 2500));

    const unitTypes = ['spear', 'sword', 'axe', 'archer', 'spy', 'light', 'marcher', 'heavy', 'ram', 'catapult', 'knight', 'snob'];
    const units = {};

    // Najdeme první řádek s jednotkami
    const firstRow = document.querySelector('#units_table tbody tr:first-child');

    if (!firstRow) {
      console.log('❌ Nenalezen žádný řádek s jednotkami');
      return null;
    }

    console.log('✅ Nalezen řádek s jednotkami');
    console.log('HTML řádku:', firstRow.innerHTML);

    unitTypes.forEach(unitType => {
      console.log(`\n🔍 Analyzuji: ${unitType}`);

      // Hledáme různé možné selectory
      const selectors = [
        `.unit-item-${unitType}`,
        `[data-unit="${unitType}"]`,
        `img[src*="${unitType}"]`
      ];

      let unitCell = null;
      for (const selector of selectors) {
        unitCell = firstRow.querySelector(selector);
        if (unitCell) {
          console.log(`  ✅ Nalezen element: ${selector}`);
          break;
        }
      }

      if (unitCell) {
        const count = parseInt(unitCell.textContent.trim()) || 0;
        console.log(`  Počet: ${count}`);

        units[unitType] = {
          inVillage: count,
          total: count,
          away: 0
        };
      } else {
        console.log(`  ⚠️ Element nenalezen`);
        units[unitType] = { inVillage: 0, total: 0, away: 0 };
      }
    });

    console.log('\n📊 VÝSLEDEK:');
    console.table(units);

    return units;

  } catch (error) {
    console.error('❌ Chyba:', error);
    return null;
  }
}

/**
 * Test 4: Analýza DOM struktury na aktuální stránce
 */
function analyzeCurrentPage() {
  console.log('\n' + '='.repeat(80));
  console.log('TEST 4: ANALÝZA AKTUÁLNÍ STRÁNKY');
  console.log('='.repeat(80));

  const currentUrl = window.location.href;
  console.log(`📍 URL: ${currentUrl}`);

  // Zjistíme, jaký screen je otevřený
  const screenMatch = currentUrl.match(/screen=([^&]+)/);
  const screen = screenMatch ? screenMatch[1] : 'unknown';
  console.log(`📺 Screen: ${screen}`);

  // Hledáme všechny inputy pro jednotky
  console.log('\n🔍 Hledám inputy pro jednotky:');
  const unitTypes = ['spear', 'sword', 'axe', 'archer', 'spy', 'light', 'marcher', 'heavy', 'ram', 'catapult', 'knight', 'snob'];

  unitTypes.forEach(unitType => {
    const input = document.querySelector(`input[name="${unitType}"]`);

    if (input) {
      console.log(`\n✅ ${unitType}:`);
      console.log(`  - Value: ${input.value}`);
      console.log(`  - Max: ${input.max}`);
      console.log(`  - Data atributy:`, input.dataset);

      const row = input.closest('tr');
      if (row) {
        console.log(`  - Text řádku: ${row.textContent.trim()}`);

        // Najdeme všechny buňky
        const cells = row.querySelectorAll('td');
        console.log(`  - Počet buněk: ${cells.length}`);

        cells.forEach((cell, i) => {
          console.log(`    Buňka ${i}: "${cell.textContent.trim()}"`);
        });
      }
    }
  });

  // Hledáme tabulku s jednotkami
  console.log('\n🔍 Hledám tabulky:');
  const tables = document.querySelectorAll('table');
  console.log(`Nalezeno ${tables.length} tabulek`);

  tables.forEach((table, i) => {
    const id = table.id || 'bez ID';
    const classes = table.className || 'bez tříd';
    console.log(`  Tabulka ${i}: id="${id}", class="${classes}"`);
  });
}

/**
 * Hlavní testovací funkce - spustí všechny testy
 */
async function testUnitsDetection() {
  console.clear();
  console.log('🧪 TESTOVÁNÍ ZJIŠŤOVÁNÍ JEDNOTEK');
  console.log('='.repeat(80));

  // Nejdřív analyzujeme aktuální stránku
  analyzeCurrentPage();

  // Pak se zeptáme, jaké testy spustit
  console.log('\n📋 Dostupné testy:');
  console.log('1. testTrainScreen() - Test zjišťování z train screen');
  console.log('2. testRallyPoint() - Test zjišťování z rally point');
  console.log('3. testOverview() - Test zjišťování z overview');
  console.log('4. analyzeCurrentPage() - Analýza aktuální stránky');

  console.log('\n💡 Pro spuštění testu napiš název funkce, např:');
  console.log('   testTrainScreen()');
  console.log('   testRallyPoint()');
  console.log('   testOverview()');
  console.log('   analyzeCurrentPage()');

  console.log('\n⚠️ POZNÁMKA: Testy 1-3 přejdou na jinou stránku!');
}

/**
 * Rychlý test na aktuální stránce bez přechodu
 */
function quickTest() {
  console.log('\n' + '='.repeat(80));
  console.log('RYCHLÝ TEST - AKTUÁLNÍ STRÁNKA');
  console.log('='.repeat(80));

  const unitTypes = ['spear', 'sword', 'axe', 'archer', 'spy', 'light', 'marcher', 'heavy', 'ram', 'catapult', 'knight', 'snob'];
  const results = {};

  unitTypes.forEach(unitType => {
    const input = document.querySelector(`input[name="${unitType}"]`);

    if (!input) {
      results[unitType] = { status: '❌ Input nenalezen', data: null };
      return;
    }

    const row = input.closest('tr');
    if (!row) {
      results[unitType] = { status: '❌ Řádek nenalezen', data: null };
      return;
    }

    const cells = Array.from(row.querySelectorAll('td'));
    const cellTexts = cells.map(c => c.textContent.trim());

    // Hledáme pattern X / Y
    let found = null;
    for (let text of cellTexts) {
      const match = text.match(/^(\d+)\s*\/\s*(\d+)$/);
      if (match) {
        found = {
          inVillage: parseInt(match[1]),
          total: parseInt(match[2]),
          away: parseInt(match[2]) - parseInt(match[1])
        };
        break;
      }
    }

    if (found) {
      results[unitType] = {
        status: '✅ Nalezeno',
        data: found
      };
    } else {
      // Zkusíme najít v závorce
      for (let text of cellTexts) {
        const match = text.match(/\((\d+)\)/);
        if (match) {
          found = {
            inVillage: parseInt(match[1]),
            total: parseInt(match[1]),
            away: 0
          };
          break;
        }
      }

      results[unitType] = {
        status: found ? '⚠️ Částečně nalezeno (závorka)' : '❌ Nenalezeno',
        data: found
      };
    }
  });

  console.table(results);

  // Shrnutí
  const successful = Object.values(results).filter(r => r.status.includes('✅')).length;
  const partial = Object.values(results).filter(r => r.status.includes('⚠️')).length;
  const failed = Object.values(results).filter(r => r.status.includes('❌')).length;

  console.log('\n📊 SHRNUTÍ:');
  console.log(`✅ Úspěšně: ${successful}`);
  console.log(`⚠️ Částečně: ${partial}`);
  console.log(`❌ Selhalo: ${failed}`);
}

// ============================================================================
// EXPORT FUNKCÍ DO GLOBÁLNÍHO SCOPE
// ============================================================================

window.testUnitsDetection = testUnitsDetection;
window.testTrainScreen = testTrainScreen;
window.testRallyPoint = testRallyPoint;
window.testOverview = testOverview;
window.analyzeCurrentPage = analyzeCurrentPage;
window.quickTest = quickTest;

// ============================================================================
// AUTO-START
// ============================================================================

console.log('\n✅ Testovací script načten!');
console.log('\n📋 Dostupné funkce:');
console.log('  • testUnitsDetection() - Hlavní testovací funkce');
console.log('  • quickTest() - Rychlý test na aktuální stránce');
console.log('  • analyzeCurrentPage() - Analýza DOM struktury');
console.log('  • testTrainScreen() - Test train screen');
console.log('  • testRallyPoint() - Test rally point');
console.log('  • testOverview() - Test overview');

console.log('\n💡 Pro začátek zadej: quickTest()');
