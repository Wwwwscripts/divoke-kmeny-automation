import DatabaseManager from './src/database.js';

const db = new DatabaseManager();

console.log('🔧 Nastavuji 5 testovacích účtů...\n');

const testAccounts = [
  { username: 'test1', password: 'test123', world: 'cs120' },
  { username: 'test2', password: 'test123', world: 'cs120' },
  { username: 'test3', password: 'test123', world: 'cs120' },
  { username: 'test4', password: 'test123', world: 'cs120' },
  { username: 'test5', password: 'test123', world: 'cs120' }
];

for (const acc of testAccounts) {
  const accountId = db.addAccount(acc.username, acc.password, null, acc.world);

  if (accountId) {
    console.log(`✅ ${acc.username} přidán (ID: ${accountId})`);
  } else {
    console.log(`⚠️  ${acc.username} už existuje nebo selhalo přidání`);
  }
}

console.log('\n✅ Hotovo!');
console.log('Můžeš spustit panel: npm run panel');
