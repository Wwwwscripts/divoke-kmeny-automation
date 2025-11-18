/**
 * Testovaci script pro konzoli - zjistovani jednotek
 * VERZE BEZ EMOJI
 */

// Test 1: Zjistovani jednotek z Train screen
async function testTrainScreen() {
  console.log('\n' + '='.repeat(80));
  console.log('TEST 1: TRAIN SCREEN (kasar ny/staje/dilna)');
  console.log('='.repeat(80));

  try {
    const world = window.location.hostname.match(/([^.]+)\./)[1];
    const domain = window.location.hostname.match(/\.(.*)/)[1];
    const worldUrl = `https://${world}.${domain}`;

    console.log('Svet: ' + worldUrl);

    window.location.href = `${worldUrl}/game.php?screen=train`;
    await new Promise(resolve => setTimeout(resolve, 2000));

    const unitTypes = ['spear', 'sword', 'axe', 'archer', 'spy', 'light', 'marcher', 'heavy', 'ram', 'catapult'];
    const units = {};

    unitTypes.forEach(unitType => {
      const input = document.querySelector(`input[name="${unitType}"]`);

      if (!input) {
        console.log('[X] ' + unitType + ': Input nenalezen');
        units[unitType] = { inVillage: 0, total: 0, away: 0 };
        return;
      }

      const row = input.closest('tr');
      if (!row) {
        console.log('[X] ' + unitType + ': Radek nenalezen');
        units[unitType] = { inVillage: 0, total: 0, away: 0 };
        return;
      }

      console.log('\nAnalyzuji: ' + unitType);
      console.log('HTML radku:', row.innerHTML);

      const cells = Array.from(row.querySelectorAll('td'));
      console.log('Pocet bunek: ' + cells.length);

      let found = false;
      cells.forEach((cell, index) => {
        const text = cell.textContent.trim();
        console.log('  Bunka ' + index + ': "' + text + '"');

        const match = text.match(/^(\d+)\s*\/\s*(\d+)$/);
        if (match) {
          const inVillage = parseInt(match[1]);
          const total = parseInt(match[2]);
          const away = total - inVillage;

          console.log('  [OK] NALEZENO: ' + inVillage + '/' + total + ' (mimo: ' + away + ')');

          units[unitType] = { inVillage, total, away };
          found = true;
        }
      });

      if (!found) {
        console.log('  [!] Pattern "X / Y" nenalezen');
        units[unitType] = { inVillage: 0, total: 0, away: 0 };
      }
    });

    console.log('\nVYSLEDEK:');
    console.table(units);

    return units;

  } catch (error) {
    console.error('[X] Chyba:', error);
    return null;
  }
}

// Test 2: Zjistovani jednotek z Rally Point (place)
async function testRallyPoint() {
  console.log('\n' + '='.repeat(80));
  console.log('TEST 2: RALLY POINT (shromazdiste)');
  console.log('='.repeat(80));

  try {
    const world = window.location.hostname.match(/([^.]+)\./)[1];
    const domain = window.location.hostname.match(/\.(.*)/)[1];
    const worldUrl = `https://${world}.${domain}`;

    console.log('Svet: ' + worldUrl);

    window.location.href = `${worldUrl}/game.php?screen=place`;
    await new Promise(resolve => setTimeout(resolve, 2000));

    const unitTypes = ['spear', 'sword', 'axe', 'archer', 'spy', 'light', 'marcher', 'heavy', 'ram', 'catapult', 'knight', 'snob'];
    const units = {};

    unitTypes.forEach(unitType => {
      const input = document.querySelector(`input[name="${unitType}"]`);

      if (!input) {
        console.log('[X] ' + unitType + ': Input nenalezen');
        units[unitType] = { inVillage: 0, total: 0, away: 0 };
        return;
      }

      const row = input.closest('tr');
      if (!row) {
        console.log('[X] ' + unitType + ': Radek nenalezen');
        units[unitType] = { inVillage: 0, total: 0, away: 0 };
        return;
      }

      console.log('\nAnalyzuji: ' + unitType);
      console.log('HTML radku:', row.innerHTML);

      const unitElement = row.querySelector('.unit-item, .units-entry, a');

      if (unitElement) {
        const text = unitElement.textContent || '';
        console.log('  Text elementu: "' + text + '"');

        const inVillageMatch = text.match(/\((\d+)\)/);
        const inVillage = inVillageMatch ? parseInt(inVillageMatch[1]) : 0;

        console.log('  Ve vesnici (zavorka): ' + inVillage);

        let total = inVillage;

        const dataCount = input.getAttribute('data-count');
        if (dataCount) {
          total = parseInt(dataCount);
          console.log('  Celkem (data-count): ' + total);
        }

        const totalMatch = text.match(/(\d+)\s*\(/);
        if (totalMatch) {
          total = parseInt(totalMatch[1]);
          console.log('  Celkem (pred zavorkou): ' + total);
        }

        const away = Math.max(0, total - inVillage);

        console.log('  [OK] VYSLEDEK: ' + inVillage + '/' + total + ' (mimo: ' + away + ')');

        units[unitType] = { inVillage, total, away };
      } else {
        console.log('  [!] Element s jednotkami nenalezen');
        units[unitType] = { inVillage: 0, total: 0, away: 0 };
      }
    });

    console.log('\nVYSLEDEK:');
    console.table(units);

    return units;

  } catch (error) {
    console.error('[X] Chyba:', error);
    return null;
  }
}

// Test 3: Zjistovani jednotek z Overview
async function testOverview() {
  console.log('\n' + '='.repeat(80));
  console.log('TEST 3: OVERVIEW (prehled vesnic)');
  console.log('='.repeat(80));

  try {
    const world = window.location.hostname.match(/([^.]+)\./)[1];
    const domain = window.location.hostname.match(/\.(.*)/)[1];
    const worldUrl = `https://${world}.${domain}`;

    console.log('Svet: ' + worldUrl);

    window.location.href = `${worldUrl}/game.php?screen=overview_villages&mode=units`;
    await new Promise(resolve => setTimeout(resolve, 2500));

    const unitTypes = ['spear', 'sword', 'axe', 'archer', 'spy', 'light', 'marcher', 'heavy', 'ram', 'catapult', 'knight', 'snob'];
    const units = {};

    const firstRow = document.querySelector('#units_table tbody tr:first-child');

    if (!firstRow) {
      console.log('[X] Nenalezen zadny radek s jednotkami');
      return null;
    }

    console.log('[OK] Nalezen radek s jednotkami');
    console.log('HTML radku:', firstRow.innerHTML);

    unitTypes.forEach(unitType => {
      console.log('\nAnalyzuji: ' + unitType);

      const selectors = [
        `.unit-item-${unitType}`,
        `[data-unit="${unitType}"]`,
        `img[src*="${unitType}"]`
      ];

      let unitCell = null;
      for (const selector of selectors) {
        unitCell = firstRow.querySelector(selector);
        if (unitCell) {
          console.log('  [OK] Nalezen element: ' + selector);
          break;
        }
      }

      if (unitCell) {
        const count = parseInt(unitCell.textContent.trim()) || 0;
        console.log('  Pocet: ' + count);

        units[unitType] = {
          inVillage: count,
          total: count,
          away: 0
        };
      } else {
        console.log('  [!] Element nenalezen');
        units[unitType] = { inVillage: 0, total: 0, away: 0 };
      }
    });

    console.log('\nVYSLEDEK:');
    console.table(units);

    return units;

  } catch (error) {
    console.error('[X] Chyba:', error);
    return null;
  }
}

// Test 4: Analyza DOM struktury na aktualni strance
function analyzeCurrentPage() {
  console.log('\n' + '='.repeat(80));
  console.log('TEST 4: ANALYZA AKTUALNI STRANKY');
  console.log('='.repeat(80));

  const currentUrl = window.location.href;
  console.log('URL: ' + currentUrl);

  const screenMatch = currentUrl.match(/screen=([^&]+)/);
  const screen = screenMatch ? screenMatch[1] : 'unknown';
  console.log('Screen: ' + screen);

  console.log('\nHledam inputy pro jednotky:');
  const unitTypes = ['spear', 'sword', 'axe', 'archer', 'spy', 'light', 'marcher', 'heavy', 'ram', 'catapult', 'knight', 'snob'];

  unitTypes.forEach(unitType => {
    const input = document.querySelector(`input[name="${unitType}"]`);

    if (input) {
      console.log('\n[OK] ' + unitType + ':');
      console.log('  - Value: ' + input.value);
      console.log('  - Max: ' + input.max);
      console.log('  - Data atributy:', input.dataset);

      const row = input.closest('tr');
      if (row) {
        console.log('  - Text radku: ' + row.textContent.trim());

        const cells = row.querySelectorAll('td');
        console.log('  - Pocet bunek: ' + cells.length);

        cells.forEach((cell, i) => {
          console.log('    Bunka ' + i + ': "' + cell.textContent.trim() + '"');
        });
      }
    }
  });

  console.log('\nHledam tabulky:');
  const tables = document.querySelectorAll('table');
  console.log('Nalezeno ' + tables.length + ' tabulek');

  tables.forEach((table, i) => {
    const id = table.id || 'bez ID';
    const classes = table.className || 'bez trid';
    console.log('  Tabulka ' + i + ': id="' + id + '", class="' + classes + '"');
  });
}

// Hlavni testovaci funkce
async function testUnitsDetection() {
  console.clear();
  console.log('TESTOVANI ZJISTOVANI JEDNOTEK');
  console.log('='.repeat(80));

  analyzeCurrentPage();

  console.log('\nDostupne testy:');
  console.log('1. testTrainScreen() - Test zjistovani z train screen');
  console.log('2. testRallyPoint() - Test zjistovani z rally point');
  console.log('3. testOverview() - Test zjistovani z overview');
  console.log('4. analyzeCurrentPage() - Analyza aktualni stranky');

  console.log('\nPro spusteni testu napis nazev funkce, napr:');
  console.log('   testTrainScreen()');
  console.log('   testRallyPoint()');
  console.log('   testOverview()');
  console.log('   analyzeCurrentPage()');

  console.log('\nPOZNAMKA: Testy 1-3 prejdou na jinou stranku!');
}

// Rychly test na aktualni strance bez prechodu
function quickTest() {
  console.log('\n' + '='.repeat(80));
  console.log('RYCHLY TEST - AKTUALNI STRANKA');
  console.log('='.repeat(80));

  const unitTypes = ['spear', 'sword', 'axe', 'archer', 'spy', 'light', 'marcher', 'heavy', 'ram', 'catapult', 'knight', 'snob'];
  const results = {};

  unitTypes.forEach(unitType => {
    const input = document.querySelector(`input[name="${unitType}"]`);

    if (!input) {
      results[unitType] = { status: '[X] Input nenalezen', data: null };
      return;
    }

    const row = input.closest('tr');
    if (!row) {
      results[unitType] = { status: '[X] Radek nenalezen', data: null };
      return;
    }

    const cells = Array.from(row.querySelectorAll('td'));
    const cellTexts = cells.map(c => c.textContent.trim());

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
        status: '[OK] Nalezeno',
        data: found
      };
    } else {
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
        status: found ? '[!] Castecne nalezeno (zavorka)' : '[X] Nenalezeno',
        data: found
      };
    }
  });

  console.table(results);

  const successful = Object.values(results).filter(r => r.status.includes('[OK]')).length;
  const partial = Object.values(results).filter(r => r.status.includes('[!]')).length;
  const failed = Object.values(results).filter(r => r.status.includes('[X]')).length;

  console.log('\nSHRNUTI:');
  console.log('[OK] Uspesne: ' + successful);
  console.log('[!] Castecne: ' + partial);
  console.log('[X] Selhalo: ' + failed);
}

// Export funkci do globalniho scope
window.testUnitsDetection = testUnitsDetection;
window.testTrainScreen = testTrainScreen;
window.testRallyPoint = testRallyPoint;
window.testOverview = testOverview;
window.analyzeCurrentPage = analyzeCurrentPage;
window.quickTest = quickTest;

console.log('\n[OK] Testovaci script nacten!');
console.log('\nDostupne funkce:');
console.log('  - testUnitsDetection() - Hlavni testovaci funkce');
console.log('  - quickTest() - Rychly test na aktualni strance');
console.log('  - analyzeCurrentPage() - Analyza DOM struktury');
console.log('  - testTrainScreen() - Test train screen');
console.log('  - testRallyPoint() - Test rally point');
console.log('  - testOverview() - Test overview');

console.log('\nPro zacatek zadej: quickTest()');
