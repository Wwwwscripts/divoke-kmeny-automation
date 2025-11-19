/**
 * Worker Pool - Globální správa běžících procesů
 * Limituje max počet souběžných operací
 */
class WorkerPool {
  constructor(maxWorkers = 50) {
    this.maxWorkers = maxWorkers;
    this.runningWorkers = 0;
    this.queue = []; // Fronta čekajících úloh
  }

  /**
   * Získá počet běžících workerů
   */
  getRunningCount() {
    return this.runningWorkers;
  }

  /**
   * Získá počet čekajících úloh
   */
  getQueuedCount() {
    return this.queue.length;
  }

  /**
   * Zkontroluje, zda je volný slot
   */
  hasAvailableSlot() {
    return this.runningWorkers < this.maxWorkers;
  }

  /**
   * Spustí úlohu (pokud je místo) nebo ji zařadí do fronty
   * @param {Function} task - Async funkce k provedení
   * @param {number} priority - Priorita (1 = nejvyšší)
   * @param {string} label - Popisek pro debugging
   * @returns {Promise}
   */
  async run(task, priority = 5, label = 'task') {
    return new Promise((resolve, reject) => {
      const wrappedTask = async () => {
        this.runningWorkers++;
        const startTime = Date.now();

        try {
          const result = await task();
          resolve(result);
        } catch (error) {
          reject(error);
        } finally {
          this.runningWorkers--;
          const duration = ((Date.now() - startTime) / 1000).toFixed(1);

          // Pokus se spustit další úlohu z fronty
          this.processQueue();
        }
      };

      // Pokud je volné místo, spusť hned
      if (this.hasAvailableSlot()) {
        wrappedTask();
      } else {
        // Jinak zařaď do fronty
        this.queue.push({ task: wrappedTask, priority, label });
        // Seřaď podle priority (nižší číslo = vyšší priorita)
        this.queue.sort((a, b) => a.priority - b.priority);
      }
    });
  }

  /**
   * Zpracuje frontu - spustí další úlohu, pokud je volné místo
   */
  processQueue() {
    if (this.queue.length > 0 && this.hasAvailableSlot()) {
      const nextTask = this.queue.shift();
      nextTask.task();
    }
  }

  /**
   * Získá statistiky
   */
  getStats() {
    return {
      running: this.runningWorkers,
      queued: this.queue.length,
      available: this.maxWorkers - this.runningWorkers,
      total: this.maxWorkers,
      utilization: ((this.runningWorkers / this.maxWorkers) * 100).toFixed(1) + '%'
    };
  }

  /**
   * Vypíše statistiky do konzole
   */
  logStats() {
    const stats = this.getStats();
    console.log(`📊 Pool: ${stats.running}/${stats.total} běží | ${stats.queued} ve frontě | ${stats.utilization} využití`);
  }

  /**
   * Počká na dokončení všech běžících úloh
   * @param {number} timeout - Max čas čekání v ms (default 30s)
   * @returns {Promise<boolean>} true pokud všechny úlohy dokončeny, false při timeoutu
   */
  async waitForCompletion(timeout = 30000) {
    const startTime = Date.now();
    const checkInterval = 500; // Kontroluj každých 500ms

    console.log(`⏳ Čekám na dokončení ${this.runningWorkers} běžících úloh...`);

    while (this.runningWorkers > 0 || this.queue.length > 0) {
      const elapsed = Date.now() - startTime;

      if (elapsed >= timeout) {
        console.log(`⚠️  Timeout! Zbývá: ${this.runningWorkers} běžících, ${this.queue.length} ve frontě`);
        return false;
      }

      // Vypíše progress každých 5 sekund
      if (Math.floor(elapsed / 5000) > Math.floor((elapsed - checkInterval) / 5000)) {
        console.log(`   ⏱️  ${Math.floor(elapsed / 1000)}s - Zbývá: ${this.runningWorkers} běžících, ${this.queue.length} ve frontě`);
      }

      await new Promise(resolve => setTimeout(resolve, checkInterval));
    }

    console.log(`✅ Všechny úlohy dokončeny`);
    return true;
  }

  /**
   * Vyčistí frontu (zahodí čekající úlohy)
   * Používá se při force shutdown
   */
  clearQueue() {
    const count = this.queue.length;
    this.queue = [];
    console.log(`🗑️  Vymazáno ${count} čekajících úloh z fronty`);
    return count;
  }
}

export default WorkerPool;
