/**
 * Modul pro automatickou správu Paladina
 * - Rekrutování nového paladina
 * - Oživování mrtvého paladina
 * - Automatické učení dostupných skillů
 *
 * Language-independent implementation
 */

class PaladinModule {
  constructor(page, db, accountId) {
    this.page = page;
    this.db = db;
    this.accountId = accountId;
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
      console.error('❌ Error navigating to statue:', error.message);
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
      console.error('❌ Error detecting paladin state:', error.message);
      return { state: 'error', details: error.message };
    }
  }

  /**
   * Recruit new paladin
   */
  async recruitPaladin() {
    try {
      console.log('🎖️  Recruiting new paladin...');

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
        console.log('❌ Recruit button not found');
        return { success: false, action: 'recruit' };
      }

      console.log('✅ Recruit button clicked');
      console.log('⏳ Waiting for confirmation popup...');
      await this.page.waitForTimeout(1500);

      // Confirm recruitment
      const confirmed = await this.confirmPopup();

      if (confirmed) {
        console.log('✅ Paladin recruitment started');
        return { success: true, action: 'recruit', message: 'Recruitment started' };
      }

      console.log('❌ Confirmation failed');
      return { success: false, action: 'recruit', message: 'Confirmation failed' };

    } catch (error) {
      console.error('❌ Error recruiting paladin:', error.message);
      return { success: false, action: 'recruit', error: error.message };
    }
  }

  /**
   * Revive dead paladin
   */
  async revivePaladin() {
    try {
      console.log('💀 Reviving dead paladin...');

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
        console.log('❌ Revive button not found');
        return { success: false, action: 'revive' };
      }

      console.log('✅ Revive button clicked');
      console.log('⏳ Waiting for confirmation popup...');
      await this.page.waitForTimeout(1500);

      // Confirm revival
      const confirmed = await this.confirmPopup();

      if (confirmed) {
        console.log('✅ Paladin revival started');
        return { success: true, action: 'revive', message: 'Revival started' };
      }

      console.log('❌ Confirmation failed');
      return { success: false, action: 'revive', message: 'Confirmation failed' };

    } catch (error) {
      console.error('❌ Error reviving paladin:', error.message);
      return { success: false, action: 'revive', error: error.message };
    }
  }

  /**
   * Confirm popup dialog (for recruit/revive)
   */
  async confirmPopup() {
    try {
      // Wait for popup to appear
      console.log('⏳ Waiting for popup to appear...');
      await this.page.waitForSelector('.popup_box_container, .popup_box', { timeout: 5000 });
      await this.page.waitForTimeout(1000); // Extra wait for popup to fully load

      // Debug: Check what's in the popup
      const debugInfo = await this.page.evaluate(() => {
        const popup = document.querySelector('.popup_box_container, .popup_box');
        const allButtons = popup ? popup.querySelectorAll('a, button') : [];

        const buttons = Array.from(allButtons).map(btn => ({
          tag: btn.tagName,
          className: btn.className,
          id: btn.id,
          text: btn.textContent.trim(),
          href: btn.href || null
        }));

        return { popupFound: !!popup, buttons };
      });

      console.log(`📋 Popup found: ${debugInfo.popupFound}`);
      console.log(`📋 Buttons in popup: ${debugInfo.buttons.length}`);
      debugInfo.buttons.forEach((btn, i) => {
        console.log(`  ${i + 1}. ${btn.tag} class="${btn.className}" id="${btn.id}" text="${btn.text}"`);
      });

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
        console.log(`✅ Clicked confirmation button: ${result.selector}`);
        await this.page.waitForTimeout(2000); // Wait for action to process

        // Check if popup closed (success indicator)
        const popupStillExists = await this.page.evaluate(() => {
          const popup = document.querySelector('.popup_box_container, .popup_box');
          return !!popup;
        });

        if (!popupStillExists) {
          console.log('✅ Popup closed - action confirmed');
          return true;
        } else {
          console.log('⚠️  Popup still open - checking if action was processed...');
          await this.page.waitForTimeout(1000);
          return true; // Assume success even if popup didn't close immediately
        }
      }

      console.log('❌ No confirmation button found');
      return false;
    } catch (error) {
      console.error('❌ Error confirming popup:', error.message);
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
      console.error('❌ Error confirming skill learning:', error.message);
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
      console.error('❌ Error getting available skills:', error.message);
      return [];
    }
  }

  /**
   * Learn a specific skill
   */
  async learnSkill(skillIndex) {
    try {
      console.log(`📚 Learning skill ${skillIndex}...`);

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
        console.log(`❌ Skill ${skillIndex} not found or not clickable`);
        return false;
      }

      // Wait for popup
      await this.page.waitForTimeout(1000);

      // Confirm learning (use skill-specific confirmation)
      const confirmed = await this.confirmSkillLearning();

      if (confirmed) {
        console.log(`✅ Skill ${skillIndex} learned`);
        await this.page.waitForTimeout(1000);
        return true;
      }

      console.log(`❌ Failed to confirm skill ${skillIndex}`);
      return false;

    } catch (error) {
      console.error(`❌ Error learning skill ${skillIndex}:`, error.message);
      return false;
    }
  }

  /**
   * Learn all available skills
   */
  async learnAllSkills() {
    try {
      console.log('🎓 Checking for available skills...');

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
          console.log('✅ No more skills to learn');
          break;
        }

        console.log(`📋 Found ${skills.length} available skill(s)`);

        // Learn the first available skill
        const success = await this.learnSkill(0);

        if (success) {
          totalLearned++;
          console.log(`✅ Total skills learned: ${totalLearned}`);
        } else {
          console.log('❌ Failed to learn skill, stopping');
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
      console.error('❌ Error learning skills:', error.message);
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
      console.error('❌ Error getting skill points:', error.message);
      return null;
    }
  }

  /**
   * Main execution function
   */
  async execute() {
    try {
      console.log('🎖️  Starting Paladin module...');

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
      console.log(`🔍 Paladin state: ${stateInfo.state} - ${stateInfo.details}`);

      // Save state to database
      this.db.updateAccountInfo(this.accountId, {
        paladin_state: stateInfo.state,
        paladin_updated: new Date().toISOString()
      });

      // Handle different states
      switch (stateInfo.state) {
        case 'not_recruited':
          // Recruit new paladin
          const recruitResult = await this.recruitPaladin();
          return {
            ...recruitResult,
            state: 'not_recruited',
            waitTime: 60 * 60 * 1000 // 60 minutes
          };

        case 'recruiting':
          // Paladin is being recruited, wait
          console.log('⏳ Paladin is being recruited, waiting...');
          return {
            success: true,
            state: 'recruiting',
            message: 'Recruitment in progress',
            waitTime: 30 * 60 * 1000 // 30 minutes
          };

        case 'dead':
          // Revive paladin
          const reviveResult = await this.revivePaladin();
          return {
            ...reviveResult,
            state: 'dead',
            waitTime: 60 * 60 * 1000 // 60 minutes
          };

        case 'reviving':
          // Paladin is being revived, wait
          console.log('⏳ Paladin is being revived, waiting...');
          return {
            success: true,
            state: 'reviving',
            message: 'Revival in progress',
            waitTime: 30 * 60 * 1000 // 30 minutes
          };

        case 'alive':
          // Learn available skills
          console.log('✅ Paladin is alive, checking skills...');

          const skillPoints = await this.getSkillPoints();
          if (skillPoints) {
            console.log(`📊 Skill points: ${skillPoints.available} available (${skillPoints.used}/${skillPoints.total} used)`);
          }

          const learnResult = await this.learnAllSkills();

          return {
            ...learnResult,
            state: 'alive',
            skillPoints: skillPoints,
            waitTime: 60 * 60 * 1000 // 60 minutes
          };

        default:
          console.log('❓ Unknown paladin state');
          return {
            success: false,
            state: 'unknown',
            message: 'Unknown paladin state',
            waitTime: 60 * 60 * 1000 // 60 minutes
          };
      }

    } catch (error) {
      console.error('❌ Error in Paladin module:', error.message);
      return {
        success: false,
        error: error.message,
        waitTime: 60 * 60 * 1000 // 60 minutes
      };
    }
  }
}

export default PaladinModule;
