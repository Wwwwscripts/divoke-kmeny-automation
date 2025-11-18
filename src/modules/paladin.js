/**
 * Modul pro automatickou správu Paladina
 * - Rekrutování nového paladina
 * - Oživování mrtvého paladina
 * - Automatické učení dostupných skillů
 *
 * Language-independent implementation
 */

import logger from '../logger.js';

class PaladinModule {
  constructor(page, db, accountId) {
    this.page = page;
    this.db = db;
    this.accountId = accountId;
    this.accountName = null;
  }

  /**
   * Získá username pro logging
   */
  getAccountName() {
    if (!this.accountName) {
      const account = this.db.getAccount(this.accountId);
      this.accountName = account?.username || `ID:${this.accountId}`;
    }
    return this.accountName;
  }

  /**
   * Get world URL (supports both CZ and SK)
   */
  getWorldUrl() {
    const currentUrl = this.page.url();

    // Try CZ world
    let match = currentUrl.match(/\/\/([^.]+)\.divokekmeny\.cz/);
    if (match) {
      return `https://${match[1]}.divokekmeny.cz`;
    }

    // Try SK world
    match = currentUrl.match(/\/\/([^.]+)\.divoke-kmene\.sk/);
    if (match) {
      return `https://${match[1]}.divoke-kmene.sk`;
    }

    throw new Error('Could not determine world (neither CZ nor SK)');
  }

  /**
   * Navigate to statue (Paladin building)
   */
  async goToStatue() {
    try {
      const worldUrl = this.getWorldUrl();
      await this.page.goto(`${worldUrl}/game.php?screen=statue`, {
        waitUntil: 'domcontentloaded'
      });
      await this.page.waitForTimeout(1500);
      return true;
    } catch (error) {
      logger.error('Chyba při přechodu do sochy', this.getAccountName(), error);
      return false;
    }
  }

  /**
   * Detect paladin state
   * Returns: 'not_recruited' | 'recruiting' | 'dead' | 'reviving' | 'alive'
   */
  async detectPaladinState() {
    try {
      return await this.page.evaluate(() => {
        // Check for buttons (language-independent)
        const recruitButton = document.querySelector('a.knight_recruit_launch');
        const reviveButton = document.querySelector('a.knight_revive_launch');
        const reviveAbortButton = document.querySelector('a.knight_revive_abort');
        const trainButton = document.querySelector('a.knight_train_launch');

        // Check for skills (indicates paladin is alive)
        const learnableSkills = document.querySelectorAll('.skill_node.learnable');
        const hasSkills = learnableSkills.length > 0;

        // State detection logic
        if (reviveAbortButton && !reviveButton) {
          return { state: 'reviving', details: 'Paladin is being revived' };
        }

        if (reviveButton) {
          return { state: 'dead', details: 'Paladin is dead' };
        }

        if (recruitButton && !hasSkills) {
          // Check if recruiting is in progress (countdown visible)
          const content = document.querySelector('#content_value');
          const hasCountdown = content?.innerText.includes(':') &&
                               (content?.innerText.match(/\d{1,2}:\d{2}:\d{2}/) !== null);

          if (hasCountdown) {
            return { state: 'recruiting', details: 'Paladin is being recruited' };
          }

          return { state: 'not_recruited', details: 'Paladin not recruited yet' };
        }

        if (hasSkills || trainButton) {
          return { state: 'alive', details: 'Paladin is alive and active' };
        }

        return { state: 'unknown', details: 'Could not determine paladin state' };
      });
    } catch (error) {
      logger.error('Chyba při detekci stavu paladina', this.getAccountName(), error);
      return { state: 'error', details: error.message };
    }
  }

  /**
   * Recruit new paladin
   */
  async recruitPaladin() {
    try {
      const success = await this.page.evaluate(() => {
        const recruitButton = document.querySelector('a.knight_recruit_launch');
        if (recruitButton) {
          // Use both click methods to ensure it works
          recruitButton.click();

          // Alternative: trigger click event
          const clickEvent = new MouseEvent('click', {
            view: window,
            bubbles: true,
            cancelable: true
          });
          recruitButton.dispatchEvent(clickEvent);

          return true;
        }
        return false;
      });

      if (!success) {
        return { success: false, action: 'recruit' };
      }

      await this.page.waitForTimeout(1500);

      // Confirm recruitment
      const confirmed = await this.confirmPopup();

      if (confirmed) {
        // LOGUJ AKCI
        logger.paladin(this.getAccountName(), 'Rekrutování', 'Zahájeno');
        return { success: true, action: 'recruit', message: 'Recruitment started' };
      }

      return { success: false, action: 'recruit', message: 'Confirmation failed' };

    } catch (error) {
      logger.error('Chyba při rekrutování paladina', this.getAccountName(), error);
      return { success: false, action: 'recruit', error: error.message };
    }
  }

  /**
   * Revive dead paladin
   */
  async revivePaladin() {
    try {
      const success = await this.page.evaluate(() => {
        const reviveButton = document.querySelector('a.knight_revive_launch');
        if (reviveButton) {
          // Use both click methods to ensure it works
          reviveButton.click();

          // Alternative: trigger click event
          const clickEvent = new MouseEvent('click', {
            view: window,
            bubbles: true,
            cancelable: true
          });
          reviveButton.dispatchEvent(clickEvent);

          return true;
        }
        return false;
      });

      if (!success) {
        return { success: false, action: 'revive' };
      }

      await this.page.waitForTimeout(1500);

      // Confirm revival
      const confirmed = await this.confirmPopup();

      if (confirmed) {
        // LOGUJ AKCI
        logger.paladin(this.getAccountName(), 'Oživení', 'Zahájeno');
        return { success: true, action: 'revive', message: 'Revival started' };
      }

      return { success: false, action: 'revive', message: 'Confirmation failed' };

    } catch (error) {
      logger.error('Chyba při oživování paladina', this.getAccountName(), error);
      return { success: false, action: 'revive', error: error.message };
    }
  }

  /**
   * Confirm popup dialog (for recruit/revive)
   */
  async confirmPopup() {
    try {
      // Wait for popup to appear
      await this.page.waitForSelector('.popup_box_container, .popup_box', { timeout: 5000 });
      await this.page.waitForTimeout(1000); // Extra wait for popup to fully load

      // Try to click the confirmation button
      const result = await this.page.evaluate(() => {
        // Try multiple selectors for recruit/revive confirmation
        const selectors = [
          '#knight_recruit_confirm',  // Recruit confirmation
          '#knight_revive_confirm',   // Revive confirmation
          '.btn-confirm-yes',         // Generic confirm
          '.evt-confirm-btn'          // Event confirm
        ];

        for (const selector of selectors) {
          const button = document.querySelector(selector);
          if (button) {
            // Use both click methods to ensure it works
            button.click();

            // Alternative: trigger click event
            const clickEvent = new MouseEvent('click', {
              view: window,
              bubbles: true,
              cancelable: true
            });
            button.dispatchEvent(clickEvent);

            return { success: true, selector: selector };
          }
        }

        return { success: false, selector: null };
      });

      if (result.success) {
        await this.page.waitForTimeout(2000); // Wait for action to process
        return true;
      }

      return false;
    } catch (error) {
      logger.error('Chyba při potvrzování popup', this.getAccountName(), error);
      return false;
    }
  }

  /**
   * Confirm skill learning (different button class)
   */
  async confirmSkillLearning() {
    try {
      const confirmed = await this.page.evaluate(() => {
        const learnButton = document.querySelector('.knight_study_skill');
        if (learnButton) {
          learnButton.click();
          return true;
        }
        return false;
      });

      if (confirmed) {
        await this.page.waitForTimeout(1500);
      }

      return confirmed;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get available skills
   */
  async getAvailableSkills() {
    try {
      return await this.page.evaluate(() => {
        const learnableSkills = document.querySelectorAll('.skill_node.learnable');
        const skills = [];

        learnableSkills.forEach((skill, index) => {
          // Get parent branch to identify skill type (attack/village/defense)
          const branch = skill.closest('.skill_branch');
          let skillType = 'unknown';

          if (branch) {
            const branchStyle = branch.getAttribute('style') || '';
            if (branchStyle.includes('red.png')) {
              skillType = 'attack';
            } else if (branchStyle.includes('green.png')) {
              skillType = 'village';
            } else if (branchStyle.includes('blue.png')) {
              skillType = 'defense';
            }
          }

          skills.push({
            index: index,
            type: skillType,
            text: skill.textContent.trim(),
            element: skill.className
          });
        });

        return skills;
      });
    } catch (error) {
      return [];
    }
  }

  /**
   * Learn a specific skill
   */
  async learnSkill(skillIndex, skillInfo) {
    try {
      // Click on the skill
      const clicked = await this.page.evaluate((index) => {
        const learnableSkills = document.querySelectorAll('.skill_node.learnable');
        if (learnableSkills[index]) {
          learnableSkills[index].click();
          return true;
        }
        return false;
      }, skillIndex);

      if (!clicked) {
        return false;
      }

      // Wait for popup
      await this.page.waitForTimeout(1000);

      // Confirm learning (use skill-specific confirmation)
      const confirmed = await this.confirmSkillLearning();

      if (confirmed) {
        // LOGUJ AKCI
        const skillName = this.getSkillName(skillInfo.type);
        logger.paladin(this.getAccountName(), skillName, 'Naučeno');
        await this.page.waitForTimeout(1000);
        return true;
      }

      return false;

    } catch (error) {
      logger.error('Chyba při učení skillu paladina', this.getAccountName(), error);
      return false;
    }
  }

  /**
   * Přeloží typ skillu na lidsky čitelný název
   */
  getSkillName(skillType) {
    const names = {
      'attack': 'Útok',
      'defense': 'Obrana',
      'village': 'Vesnice'
    };
    return names[skillType] || skillType;
  }

  /**
   * Learn all available skills
   */
  async learnAllSkills() {
    try {
      let totalLearned = 0;
      let maxAttempts = 20; // Prevent infinite loops
      let attempts = 0;

      while (attempts < maxAttempts) {
        attempts++;

        // Refresh page to get current state
        if (attempts > 1) {
          await this.goToStatue();
        }

        // Get available skills
        const skills = await this.getAvailableSkills();

        if (skills.length === 0) {
          break;
        }

        // Learn the first available skill (pass skill info for logging)
        const success = await this.learnSkill(0, skills[0]);

        if (success) {
          totalLearned++;
        } else {
          break;
        }

        // Small delay before next iteration
        await this.page.waitForTimeout(500);
      }

      return {
        success: true,
        skillsLearned: totalLearned,
        message: `Learned ${totalLearned} skill(s)`
      };

    } catch (error) {
      logger.error('Chyba při učení skillů paladina', this.getAccountName(), error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get skill points info
   */
  async getSkillPoints() {
    try {
      return await this.page.evaluate(() => {
        const container = document.querySelector('.knight_skill_points_container');
        if (!container) return null;

        const text = container.textContent;

        // Extract numbers (language-independent)
        const numbers = text.match(/\d+/g);

        if (numbers && numbers.length >= 2) {
          return {
            total: parseInt(numbers[0]),
            used: parseInt(numbers[1]),
            available: parseInt(numbers[0]) - parseInt(numbers[1])
          };
        }

        return null;
      });
    } catch (error) {
      return null;
    }
  }

  /**
   * Main execution function
   */
  async execute() {
    try {
      // Navigate to statue
      if (!await this.goToStatue()) {
        return {
          success: false,
          message: 'Failed to navigate to statue',
          waitTime: 60 * 60 * 1000 // 60 minutes
        };
      }

      // Detect paladin state
      const stateInfo = await this.detectPaladinState();

      // Save state to database
      this.db.updateAccountInfo(this.accountId, {
        paladin_state: stateInfo.state,
        paladin_updated: new Date().toISOString()
      });

      // Handle different states
      switch (stateInfo.state) {
        case 'not_recruited':
          // Recruit new paladin (logger.paladin() je volán uvnitř recruitPaladin())
          const recruitResult = await this.recruitPaladin();
          return {
            ...recruitResult,
            state: 'not_recruited',
            waitTime: 60 * 60 * 1000 // 60 minutes
          };

        case 'recruiting':
          // Paladin is being recruited, wait
          return {
            success: true,
            state: 'recruiting',
            message: 'Recruitment in progress',
            waitTime: 30 * 60 * 1000 // 30 minutes
          };

        case 'dead':
          // Revive paladin (logger.paladin() je volán uvnitř revivePaladin())
          const reviveResult = await this.revivePaladin();
          return {
            ...reviveResult,
            state: 'dead',
            waitTime: 60 * 60 * 1000 // 60 minutes
          };

        case 'reviving':
          // Paladin is being revived, wait
          return {
            success: true,
            state: 'reviving',
            message: 'Revival in progress',
            waitTime: 30 * 60 * 1000 // 30 minutes
          };

        case 'alive':
          // Learn available skills (logger.paladin() je volán uvnitř learnSkill())
          const skillPoints = await this.getSkillPoints();
          const learnResult = await this.learnAllSkills();

          return {
            ...learnResult,
            state: 'alive',
            skillPoints: skillPoints,
            waitTime: 60 * 60 * 1000 // 60 minutes
          };

        default:
          return {
            success: false,
            state: 'unknown',
            message: 'Unknown paladin state',
            waitTime: 60 * 60 * 1000 // 60 minutes
          };
      }

    } catch (error) {
      logger.error('Chyba v Paladin modulu', this.getAccountName(), error);
      return {
        success: false,
        error: error.message,
        waitTime: 60 * 60 * 1000 // 60 minutes
      };
    }
  }
}

export default PaladinModule;
