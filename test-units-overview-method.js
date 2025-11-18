/**
 * Test zjistovani jednotek metodou pres overview_villages
 * Pouziva stejnou metodu jako script "Prehled armady"
 */

function testOverviewMethod() {
  console.log('='.repeat(80));
  console.log('TEST: Overview Villages Method (jako script Prehled armady)');
  console.log('='.repeat(80));

  // Zjistime URL
  const link = "/game.php?village=" + game_data.village.id + "&type=complete&mode=units&group=0&page=-1&screen=overview_villages";

  if (game_data.player.sitter != 0) {
    link = "/game.php?t=" + game_data.player.id + "&village=" + game_data.village.id + "&type=complete&mode=units&group=0&page=-1&screen=overview_villages";
  }

  console.log('Nacitam URL: ' + link);
  console.log('Cekej...');

  // Nacteme stranku
  var xhr = new XMLHttpRequest();
  xhr.open('GET', link, true);

  xhr.onreadystatechange = function() {
    if (xhr.readyState == 4 && xhr.status == 200) {
      console.log('[OK] Stranka nactena');

      // Vytvorime docasny body element
      var tempBody = document.createElement("body");
      tempBody.innerHTML = xhr.responseText;

      // Najdeme tabulku
      var table = tempBody.querySelector('#units_table');

      if (!table) {
        console.log('[X] Tabulka #units_table nenalezena');
        return;
      }

      console.log('[OK] Tabulka nalezena');
      console.log('Pocet radku: ' + table.rows.length);

      if (table.rows.length === 0) {
        console.log('[X] Tabulka je prazdna');
        return;
      }

      // Zobrazime prvni radek (hlavicka)
      console.log('\nPrvni radek (hlavicka):');
      var firstRow = table.rows[0];
      for (var i = 0; i < firstRow.cells.length; i++) {
        console.log('  Bunka ' + i + ': "' + firstRow.cells[i].textContent.trim() + '"');
      }

      // Najdeme druhy radek (prvni vesnice)
      if (table.rows.length < 2) {
        console.log('[X] Tabulka nema data (jen hlavicku)');
        return;
      }

      console.log('\nDruhy radek (prvni vesnice):');
      var dataRow = table.rows[1];

      // Zjistime offset (nekdy je prvni bunka nazev vesnice)
      var offset = (firstRow.cells.length == dataRow.cells.length) ? 2 : 1;
      console.log('Offset (preskocit prvni bunky): ' + offset);

      for (var i = 0; i < dataRow.cells.length; i++) {
        console.log('  Bunka ' + i + ': "' + dataRow.cells[i].textContent.trim() + '"');
      }

      // Parsujeme jednotky
      var unitTypes = ['spear', 'sword', 'axe', 'archer', 'spy', 'light', 'marcher', 'heavy', 'ram', 'catapult', 'knight', 'snob'];

      // Kontrola jestli ma archer (nektera sveta nemaji lukostrelce)
      if (!firstRow.innerHTML.match("archer")) {
        console.log('[!] Svet nema lukostrelce - odstranuji archer a marcher');
        unitTypes.splice(unitTypes.indexOf("archer"), 1);
        unitTypes.splice(unitTypes.indexOf("marcher"), 1);
      }

      // Kontrola jestli ma rytire
      if (!firstRow.innerHTML.match("knight")) {
        console.log('[!] Svet nema rytire - odstranuji knight');
        unitTypes.splice(unitTypes.indexOf("knight"), 1);
      }

      console.log('\nTypy jednotek: ' + unitTypes.join(', '));
      console.log('Pocet typu jednotek: ' + unitTypes.length);

      // Secteme jednotky ze vsech vesnic
      var totalUnits = {};
      var unitsInVillages = {};  // Radek 1 = jednotky ve vesnicich
      var unitsSupport = {};      // Radek 2 = vlastni podpora
      var unitsSent = {};         // Radek 3 = odeslana podpora
      var unitsOnWay = {};        // Radek 4 = na ceste

      // Inicializace
      for (var j = 0; j < unitTypes.length; j++) {
        totalUnits[unitTypes[j]] = 0;
        unitsInVillages[unitTypes[j]] = 0;
        unitsSupport[unitTypes[j]] = 0;
        unitsSent[unitTypes[j]] = 0;
        unitsOnWay[unitTypes[j]] = 0;
      }

      // Projdeme vsechny radky
      // Kazda vesnice ma 5 radku (0-4):
      // 0 = ve vesnici (available)
      // 1 = vlastni podpora v jinych vesnicich
      // 2 = odeslana podpora
      // 3 = na ceste
      // 4 = prazdny radek / oddelovac

      var villageCount = 0;

      for (var i = 1; i < table.rows.length; i++) {
        var row = table.rows[i];
        var rowType = (i - 1) % 5; // 0, 1, 2, 3, 4

        // Preskocime prazdne radky
        if (row.cells.length < offset + unitTypes.length) {
          continue;
        }

        for (var j = 0; j < unitTypes.length; j++) {
          var cellIndex = offset + j;
          var count = parseInt(row.cells[cellIndex].textContent.trim()) || 0;

          totalUnits[unitTypes[j]] += count;

          if (rowType === 0) {
            unitsInVillages[unitTypes[j]] += count;
            if (j === 0) villageCount++; // Pocitame vesnice jen jednou
          } else if (rowType === 1) {
            unitsSupport[unitTypes[j]] += count;
          } else if (rowType === 2) {
            unitsSent[unitTypes[j]] += count;
          } else if (rowType === 3) {
            unitsOnWay[unitTypes[j]] += count;
          }
        }
      }

      console.log('\n' + '='.repeat(80));
      console.log('VYSLEDEK - Pocet vesnic: ' + villageCount);
      console.log('='.repeat(80));

      // Vytiskneme tabulku
      var results = {};
      for (var j = 0; j < unitTypes.length; j++) {
        var unitType = unitTypes[j];
        results[unitType] = {
          'Ve vesnicich': unitsInVillages[unitType],
          'Vlastni podpora': unitsSupport[unitType],
          'Odeslana': unitsSent[unitType],
          'Na ceste': unitsOnWay[unitType],
          'CELKEM': totalUnits[unitType]
        };
      }

      console.table(results);

      console.log('\n' + '='.repeat(80));
      console.log('Pro podporu modulu potrebujeme:');
      console.log('- inVillage = "Ve vesnicich" + "Vlastni podpora"');
      console.log('- total = CELKEM vsech');
      console.log('- away = CELKEM - inVillage');
      console.log('='.repeat(80));

      // Finalni format pro modul
      var finalFormat = {};
      for (var j = 0; j < unitTypes.length; j++) {
        var unitType = unitTypes[j];
        var inVillage = unitsInVillages[unitType] + unitsSupport[unitType];
        var total = totalUnits[unitType];
        var away = total - inVillage;

        finalFormat[unitType] = {
          inVillage: inVillage,
          total: total,
          away: away
        };
      }

      console.log('\nFINALNI FORMAT PRO MODUL:');
      console.table(finalFormat);

      // Ulozime do globalniho objektu pro dalsi pouziti
      window.detectedUnits = finalFormat;
      console.log('\n[OK] Data ulozena do window.detectedUnits');
      console.log('Muzes je pouzit: console.log(window.detectedUnits)');
    }
  };

  xhr.send(null);
}

// Export do globalniho scope
window.testOverviewMethod = testOverviewMethod;

console.log('[OK] Test overview method nacten!');
console.log('');
console.log('Pouziti:');
console.log('  testOverviewMethod()');
console.log('');
console.log('Tato metoda:');
console.log('- Nacte overview_villages s mode=units');
console.log('- Secte jednotky ze vsech vesnic');
console.log('- Rozlisi jednotky ve vesnicich vs mimo vesnice');
console.log('- Je to PRESNE stejna metoda jako pouziva script "Prehled armady"');
