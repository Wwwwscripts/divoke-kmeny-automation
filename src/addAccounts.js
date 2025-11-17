import DatabaseManager from './database.js';

/**
 * Skript pro přidání více účtů najednou
 * 
 * Použití:
 * 1. Uprav pole 'accounts' níže
 * 2. Spusť: node src/addAccounts.js
 */

// Definuj všechny účty, které chceš přidat
const accounts = [
  {
    username: 'ucet1',
    password: 'heslo1',
    proxy: null, // nebo 'http://user:pass@host:port'
    world: null  // automaticky se zjistí
  },
  {
    username: 'ucet2',
    password: 'heslo2',
    proxy: '123.45.67.89:8080',
    world: 'cs120'
  },
  {
    username: 'ucet3',
    password: 'heslo3',
    proxy: 'http://user:pass@proxy.example.com:8080',
    world: 'cs121'
  },
  // Přidej další účty podle potřeby...
];

async function addMultipleAccounts() {
  console.log('='.repeat(60));
  console.log('📝 Přidávání více účtů do databáze');
  console.log('='.repeat(60));
  
  const db = new DatabaseManager();
  
  let added = 0;
  let skipped = 0;
  
  for (const account of accounts) {
    // Zkontroluj, jestli účet již existuje
    const existing = db.getAccountByUsername(account.username);
    
    if (existing) {
      console.log(`⚠️  Účet ${account.username} již existuje - přeskakuji`);
      skipped++;
      continue;
    }
    
    // Přidej účet
    const accountId = db.addAccount(
      account.username,
      account.password,
      account.proxy,
      account.world
    );
    
    if (accountId) {
      added++;
    }
  }
  
  console.log('\n' + '='.repeat(60));
  console.log(`✅ Přidáno: ${added} účtů`);
  console.log(`⚠️  Přeskočeno: ${skipped} účtů (již existují)`);
  console.log('='.repeat(60));
  
  // Zobraz všechny účty
  console.log('\n📋 Všechny účty v databázi:');
  const allAccounts = db.getAllActiveAccounts();
  
  allAccounts.forEach((acc, index) => {
    console.log(`\n${index + 1}. ${acc.username}`);
    console.log(`   ID: ${acc.id}`);
    console.log(`   Svět: ${acc.world || 'Neznámý'}`);
    console.log(`   Proxy: ${acc.proxy || 'Žádná'}`);
    console.log(`   Přidán: ${acc.created_at}`);
  });
  
  db.close();
  console.log('\n✅ Hotovo!');
}

// Spustit
addMultipleAccounts().catch(console.error);
