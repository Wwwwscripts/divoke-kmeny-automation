/**
 * Šablona pro vytváření nových modulů
 * Každý modul by měl mít podobnou strukturu
 */

class ModuleTemplate {
  constructor(page, db, accountId) {
    this.page = page;
    this.db = db;
    this.accountId = accountId;
  }

  /**
   * Hlavní funkce modulu
   */
  async execute(params = {}) {
    try {
      console.log(`🚀 Spouštím modul: ${this.constructor.name}`);
      
      // 1. Navigace na správnou stránku (pokud je potřeba)
      // await this.page.goto('...');
      
      // 2. Provedení akcí
      // ...
      
      // 3. Uložení výsledků do databáze (pokud je potřeba)
      // this.db.updateAccountInfo(this.accountId, {...});
      
      console.log(`✅ Modul ${this.constructor.name} dokončen`);
      return { success: true };
      
    } catch (error) {
      console.error(`❌ Chyba v modulu ${this.constructor.name}:`, error.message);
      return { success: false, error: error.message };
    }
  }
}

export default ModuleTemplate;
