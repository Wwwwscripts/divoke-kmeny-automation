// ==UserScript==
// @name         Auto Scavenge (without premium, Spears only)
// @version      1.2
// @author       Wwww
// @match        https://*/game.php?*screen=place&*mode=scavenge
// @match        https://*/game.php?*screen=place&*mode=scavenge&
// @icon         https://raw.githubusercontent.com/Wwwwscripts/share/refs/heads/main/W.png
// ==/UserScript==

(function() {
    'use strict';

    let autoScavengeRunning = false;
    let autoUnlockEnabled = false; // NEW: Auto unlock feature toggle
    let isUIMinimized = false;
    let reloadTimeoutId = null;
    let countdownIntervalId = null;
    let reloadTimestamp = null;
    let intervalId = null;
    let captchaCheckInterval = null;
    let isPausedByCaptcha = false;

    const reloadDelayRunning = 300000; // 5 minutes
    const reloadDelayAfterSend = 120000; // 2 minutes

    // CAPTCHA detection function
    function checkForCAPTCHA() {
        try {
            const captchaElements = document.getElementsByClassName('captcha');
            return captchaElements.length > 0;
        } catch (error) {
            return false;
        }
    }

    // CAPTCHA monitoring every 30 seconds
    function startCaptchaMonitoring() {
        // Stop existing interval if running
        if (captchaCheckInterval) {
            clearInterval(captchaCheckInterval);
        }

        captchaCheckInterval = setInterval(() => {
            if (!autoScavengeRunning) return; // Only check when running

            const captchaPresent = checkForCAPTCHA();

            if (captchaPresent && !isPausedByCaptcha) {
                // CAPTCHA appeared - pause all processes
                console.log('Auto Scavenge: CAPTCHA detected - pausing all processes');
                isPausedByCaptcha = true;
                pauseAllProcesses();
                updateResults('⚠️ CAPTCHA DETECTED - All processes paused. Waiting for CAPTCHA to be solved...');
                updateAutoButtons();
            } else if (!captchaPresent && isPausedByCaptcha) {
                // CAPTCHA disappeared - resume processes
                console.log('Auto Scavenge: CAPTCHA solved - resuming processes');
                isPausedByCaptcha = false;
                resumeAllProcesses();
                updateResults('✅ CAPTCHA solved - Resuming Auto Scavenge');
                updateAutoButtons();
            }
        }, 30000); // 30 seconds
    }

    function pauseAllProcesses() {
        // Stop all intervals and timeouts
        if (intervalId) {
            clearInterval(intervalId);
            intervalId = null;
        }
        if (reloadTimeoutId) {
            clearTimeout(reloadTimeoutId);
            reloadTimeoutId = null;
        }
        if (countdownIntervalId) {
            clearInterval(countdownIntervalId);
            countdownIntervalId = null;
        }
        reloadTimestamp = null;
    }

    function resumeAllProcesses() {
        if (!autoScavengeRunning) return;

        // Resume the script
        runScript();
    }

    function initScript() {
        loadSettings();
        addCustomStyles();
        addCustomUI();

        // Check for CAPTCHA on load
        setTimeout(() => {
            if (checkForCAPTCHA()) {
                console.log('Auto Scavenge: CAPTCHA detected on load - not starting');
                isPausedByCaptcha = true;
                updateResults('CAPTCHA detected - Auto Scavenge paused. Solve CAPTCHA to continue.');
                updateAutoButtons();
            }

            if (autoScavengeRunning && !isPausedByCaptcha) {
                console.log('Auto Scavenge: Restored - script running, starting process');
                setTimeout(() => {
                    runScript();
                }, 1000);
            } else if (autoScavengeRunning && isPausedByCaptcha) {
                console.log('Auto Scavenge: Script should run, but CAPTCHA is present');
                startCaptchaMonitoring(); // Start monitoring to detect when solved
            } else {
                console.log('Auto Scavenge: Script not active');
            }
        }, 2000);

        setInterval(checkAndRestoreUI, 1000);
    }

    function checkAndRestoreUI() {
        const existingUI = document.querySelector('#scavengeUI');
        if (!existingUI) {
            addCustomUI();
            updateAutoButtons();
        }
    }

    function addCustomStyles() {
        const existingStyle = document.querySelector('#scavengeStyles');
        if (existingStyle) {
            existingStyle.remove();
        }

        const style = document.createElement('style');
        style.id = 'scavengeStyles';
        style.textContent = `
            .scavenge-helper {
                background-color: #f4e4bc;
                border: 2px solid #7d510f;
                padding: 15px;
                margin: 15px 0;
                font-family: Verdana, Arial, sans-serif;
                font-size: 11px;
                position: relative;
                z-index: 1;
                transition: all 0.3s ease;
            }
            .scavenge-helper.minimized {
                padding: 8px 15px;
            }
            .scavenge-helper.captcha-warning {
                border-color: #dc3545;
                background-color: #f8d7da;
            }
            .scavenge-helper h3 {
                color: #7d510f;
                margin: 0 0 15px 0;
                font-size: 13px;
                font-weight: bold;
                text-align: center;
                background-color: #e6d5a6;
                padding: 8px;
                border: 1px solid #7d510f;
            }
            .author-badge {
                position: absolute;
                top: 5px;
                right: 35px;
                color: #7d510f;
                font-size: 9px;
                font-style: italic;
            }
            .minimize-btn {
                position: absolute;
                top: 5px;
                right: 8px;
                background-color: #7d510f;
                color: #f4e4bc;
                border: none;
                width: 20px;
                height: 20px;
                cursor: pointer;
                font-size: 12px;
                font-weight: bold;
                text-align: center;
                line-height: 18px;
                border-radius: 2px;
            }
            .minimize-btn:hover {
                background-color: #5d3a0b;
            }
            .scavenge-button {
                background-color: #f4e4bc;
                color: #7d510f;
                border: 1px solid #7d510f;
                padding: 6px 12px;
                cursor: pointer;
                margin: 2px;
                font-size: 11px;
                font-weight: bold;
            }
            .scavenge-button:hover {
                background-color: #e6d5a6;
            }
            .toggle-btn-on {
                background-color: #7d510f;
                color: #f4e4bc;
            }
            .toggle-btn-paused {
                background-color: #ffc107;
                color: #333;
            }
            .status-box {
                margin: 10px 0;
                padding: 6px;
                text-align: center;
                font-weight: bold;
                border: 1px solid #7d510f;
                background-color: #fff8e1;
                font-size: 11px;
            }
            .status-box.captcha-status {
                background-color: #fff3cd;
                border-color: #ffc107;
                color: #856404;
            }
            .main-control {
                text-align: center;
                margin: 15px 0;
            }
            .checkbox-container {
                text-align: center;
                margin: 10px 0;
                padding: 8px;
                background-color: #fff8e1;
                border: 1px solid #7d510f;
            }
            .checkbox-container label {
                cursor: pointer;
                color: #7d510f;
                font-weight: bold;
            }
            .checkbox-container input[type="checkbox"] {
                margin-right: 5px;
                cursor: pointer;
            }
            .results-box {
                background-color: #fff8e1;
                border: 1px solid #7d510f;
                padding: 6px;
                margin: 10px 0;
                font-size: 11px;
                font-family: monospace;
                text-align: center;
                color: #7d510f;
            }
            .results-box.captcha-warning-box {
                background-color: #fff3cd;
                border-color: #ffc107;
                color: #856404;
            }
            .ui-content {
                transition: all 0.3s ease;
            }
            .minimized-status {
                display: none;
                text-align: center;
                color: #7d510f;
                font-weight: bold;
                font-size: 11px;
            }
            .scavenge-helper.minimized .minimized-status {
                display: block;
            }
            .scavenge-helper.minimized .ui-content {
                display: none;
            }
        `;
        document.head.appendChild(style);
    }

    function toggleMinimize() {
        isUIMinimized = !isUIMinimized;

        const helperDiv = document.querySelector('#scavengeUI');
        const minimizeBtn = document.querySelector('#minimizeBtn');

        if (helperDiv && minimizeBtn) {
            if (isUIMinimized) {
                helperDiv.classList.add('minimized');
                minimizeBtn.textContent = '+';
                minimizeBtn.title = 'Maximize UI';
            } else {
                helperDiv.classList.remove('minimized');
                minimizeBtn.textContent = '−';
                minimizeBtn.title = 'Minimize UI';
            }

            saveSettings();
        }
    }

    function addCustomUI() {
        const existingUI = document.querySelector('#scavengeUI');
        if (existingUI) {
            updateAutoButtons();
            return;
        }

        const helperDiv = document.createElement('div');
        helperDiv.className = 'scavenge-helper';
        helperDiv.id = 'scavengeUI';

        if (isUIMinimized) {
            helperDiv.classList.add('minimized');
        }

        if (isPausedByCaptcha) {
            helperDiv.classList.add('captcha-warning');
        }

        let html = '<div class="author-badge">by Wwww</div>';
        html += '<button class="minimize-btn" id="minimizeBtn" title="' + (isUIMinimized ? 'Maximize UI' : 'Minimize UI') + '">' + (isUIMinimized ? '+' : '−') + '</button>';
        html += '<div class="minimized-status" id="minimizedStatus">Auto Scavenge - ' + (isPausedByCaptcha ? 'PAUSED (CAPTCHA)' : autoScavengeRunning ? 'RUNNING' : 'STOPPED') + '</div>';
        html += '<div class="ui-content" id="uiContent">';
        html += '<h3>Auto Scavenge</h3>';
        html += '<div class="main-control">';
        html += '<button class="scavenge-button" id="toggleAutoBtn">Start Auto</button>';
        html += '</div>';

        // NEW: Auto Unlock checkbox
        html += '<div class="checkbox-container">';
        html += '<label>';
        html += '<input type="checkbox" id="autoUnlockCheckbox" ' + (autoUnlockEnabled ? 'checked' : '') + '>';
        html += 'Auto Unlock Scavenges';
        html += '</label>';
        html += '</div>';

        html += '<div id="autoStatus" class="status-box">Auto Scavenge stopped</div>';
        html += '<div id="results" class="results-box" style="display: none;"></div>';
        html += '</div>';

        helperDiv.innerHTML = html;

        const contentDiv = document.querySelector('#content_value') || document.body;
        contentDiv.insertBefore(helperDiv, contentDiv.firstChild);

        document.getElementById('minimizeBtn').addEventListener('click', toggleMinimize);
        document.getElementById('toggleAutoBtn').addEventListener('click', toggleAutoScavenge);

        // NEW: Auto Unlock checkbox event listener
        document.getElementById('autoUnlockCheckbox').addEventListener('change', function(e) {
            autoUnlockEnabled = e.target.checked;
            saveSettings();
            updateResults(autoUnlockEnabled ? 'Auto Unlock ENABLED' : 'Auto Unlock DISABLED');
        });

        loadValuesToUI();
    }

    function saveSettings() {
        const settings = {
            autoScavengeRunning,
            autoUnlockEnabled, // NEW: Save unlock setting
            isUIMinimized
        };

        localStorage.setItem('autoScavenge_settings', JSON.stringify(settings));
    }

    function loadSettings() {
        try {
            const saved = localStorage.getItem('autoScavenge_settings');
            if (!saved) return;

            const settings = JSON.parse(saved);

            if (settings.autoScavengeRunning !== undefined) {
                autoScavengeRunning = settings.autoScavengeRunning;
            }
            if (settings.autoUnlockEnabled !== undefined) { // NEW: Load unlock setting
                autoUnlockEnabled = settings.autoUnlockEnabled;
            }
            if (settings.isUIMinimized !== undefined) {
                isUIMinimized = settings.isUIMinimized;
            }
        } catch (error) {
            console.error('Error loading settings:', error);
        }
    }

    function loadValuesToUI() {
        updateAutoButtons();
        updateMinimizedStatus();

        // NEW: Update checkbox state
        const checkbox = document.getElementById('autoUnlockCheckbox');
        if (checkbox) {
            checkbox.checked = autoUnlockEnabled;
        }
    }

    function updateAutoButtons() {
        const btn = document.getElementById('toggleAutoBtn');
        const status = document.getElementById('autoStatus');
        const helperDiv = document.getElementById('scavengeUI');

        if (!btn || !status) return;

        if (isPausedByCaptcha) {
            btn.textContent = 'Paused (CAPTCHA)';
            btn.className = 'scavenge-button toggle-btn-paused';
            status.innerHTML = '⚠️ CAPTCHA DETECTED - All processes paused ⚠️';
            status.className = 'status-box captcha-status';
            if (helperDiv) helperDiv.classList.add('captcha-warning');
        } else if (autoScavengeRunning) {
            btn.textContent = 'Stop Auto';
            btn.className = 'scavenge-button toggle-btn-on';
            status.innerHTML = 'Auto Scavenge RUNNING';
            status.style.backgroundColor = '#d4edda';
            status.style.color = '#155724';
            status.className = 'status-box';
            if (helperDiv) helperDiv.classList.remove('captcha-warning');
        } else {
            btn.textContent = 'Start Auto';
            btn.className = 'scavenge-button';
            status.innerHTML = 'Auto Scavenge STOPPED';
            status.style.backgroundColor = '#f8d7da';
            status.style.color = '#721c24';
            status.className = 'status-box';
            if (helperDiv) helperDiv.classList.remove('captcha-warning');
        }

        updateMinimizedStatus();
    }

    function updateMinimizedStatus() {
        const minimizedStatus = document.getElementById('minimizedStatus');
        if (minimizedStatus) {
            let status;
            if (isPausedByCaptcha) {
                status = 'PAUSED (CAPTCHA)';
            } else if (autoScavengeRunning) {
                status = 'RUNNING';
            } else {
                status = 'STOPPED';
            }
            minimizedStatus.textContent = 'Auto Scavenge - ' + status;
        }
    }

    function updateResults(message) {
        const results = document.getElementById('results');
        if (results) {
            results.innerHTML = message;
            results.style.display = 'block';

            // If CAPTCHA warning, change appearance
            if (message.toLowerCase().includes('captcha')) {
                results.className = 'results-box captcha-warning-box';
            } else {
                results.className = 'results-box';
            }
        }
    }

    function toggleAutoScavenge() {
        if (autoScavengeRunning) {
            stopAutoScavenge();
        } else {
            startAutoScavenge();
        }
    }

    function startAutoScavenge() {
        if (autoScavengeRunning) {
            updateResults('Already running!');
            return;
        }

        // Check for CAPTCHA before starting
        if (checkForCAPTCHA()) {
            isPausedByCaptcha = true;
            updateResults('Cannot start - CAPTCHA detected. Please solve CAPTCHA first.');
            updateAutoButtons();
            return;
        }

        autoScavengeRunning = true;
        isPausedByCaptcha = false;
        saveSettings();
        updateAutoButtons();
        updateMinimizedStatus();

        // Start CAPTCHA monitoring
        startCaptchaMonitoring();

        runScript();
        updateResults('Auto Scavenge started');
    }

    function stopAutoScavenge() {
        autoScavengeRunning = false;
        isPausedByCaptcha = false;
        clearAllTimers();

        if (captchaCheckInterval) {
            clearInterval(captchaCheckInterval);
            captchaCheckInterval = null;
        }

        updateResults('Auto Scavenge stopped');
        saveSettings();
        updateAutoButtons();
        updateMinimizedStatus();
    }

    function clearAllTimers() {
        if (intervalId) {
            clearInterval(intervalId);
            intervalId = null;
        }
        if (reloadTimeoutId) {
            clearTimeout(reloadTimeoutId);
            reloadTimeoutId = null;
        }
        if (countdownIntervalId) {
            clearInterval(countdownIntervalId);
            countdownIntervalId = null;
        }
        reloadTimestamp = null;
    }

    function startReloadCountdown(delay) {
        // Skip if paused by CAPTCHA
        if (isPausedByCaptcha) {
            console.log('Auto Scavenge: Skipping reload countdown - paused by CAPTCHA');
            return;
        }

        if (reloadTimeoutId) clearTimeout(reloadTimeoutId);
        if (countdownIntervalId) clearInterval(countdownIntervalId);

        reloadTimestamp = Date.now() + delay;

        countdownIntervalId = setInterval(() => {
            // Check CAPTCHA during countdown
            if (isPausedByCaptcha) {
                clearInterval(countdownIntervalId);
                return;
            }

            const remainingMs = reloadTimestamp - Date.now();
            if (remainingMs <= 0) {
                updateResults('Reloading...');
                clearInterval(countdownIntervalId);
                return;
            }
            const secondsLeft = Math.ceil(remainingMs / 1000);
            updateResults(`Reload in ${secondsLeft}s`);
        }, 500);

        reloadTimeoutId = setTimeout(() => {
            if (!isPausedByCaptcha) {
                saveSettings();
                location.reload();
            }
        }, delay);
    }

    function runScript() {
        if (!autoScavengeRunning || isPausedByCaptcha) return;

        const checkInterval = 500;
        const maxWaitTime = 10000;
        let waited = 0;

        const allocationDelay = 1500;

        if (intervalId) clearInterval(intervalId);

        intervalId = setInterval(() => {
            // Check CAPTCHA before each iteration
            if (isPausedByCaptcha) {
                clearInterval(intervalId);
                return;
            }

            const spearElement = document.querySelector('a.units-entry-all.squad-village-required[data-unit="spear"]');
            if (spearElement) {
                const spearText = spearElement.textContent;
                const spearMatch = spearText.match(/\((\d+)\)/);
                let spearCount = 0;
                if (spearMatch) {
                    spearCount = parseInt(spearMatch[1], 10);
                    if (spearCount > 1000) {
                        spearCount = 1000;
                    }
                } else {
                    clearInterval(intervalId);
                    return;
                }

                const scavengeOptions = Array.from(document.querySelectorAll('div.scavenge-option'));
                if (scavengeOptions.length === 0) {
                    clearInterval(intervalId);
                    return;
                }

                let anyRunning = false;
                const availableForSend = [];
                const lockedScavenges = [];

                scavengeOptions.forEach((opt) => {
                    const startBtn = opt.querySelector('a.btn.btn-default.free_send_button');
                    const unlockBtn = opt.querySelector('a.btn.btn-default.unlock-button');
                    const returnCountdown = opt.querySelector('span.return-countdown');

                    if (startBtn) {
                        availableForSend.push(opt);
                    } else if (unlockBtn) {
                        lockedScavenges.push(opt);
                    } else if (returnCountdown && returnCountdown.textContent.trim() !== '') {
                        anyRunning = true;
                    }
                });

                if (!anyRunning && availableForSend.length > 0) {
                    const count = availableForSend.length;
                    const allocationPercentages = {
                        4: [57.63, 23.03, 11.51, 7.64],
                        3: [62.48, 24.99, 12.49],
                        2: [71.42, 28.57],
                        1: [100]
                    };

                    const percentages = allocationPercentages[count] || [100];
                    const allocation = percentages.map(pct => Math.floor((pct / 100) * spearCount));

                    clearInterval(intervalId);
                    intervalId = null;

                    function sendScavenges(index = 0) {
                        if (!autoScavengeRunning || isPausedByCaptcha) {
                            return;
                        }
                        if (index >= availableForSend.length) {
                            startReloadCountdown(reloadDelayAfterSend);
                            return;
                        }

                        const opt = availableForSend[index];
                        const unitsInput = document.querySelector('input[name="spear"]');
                        if (!unitsInput) {
                            return;
                        }

                        const unitsToSend = allocation[index];

                        if (unitsToSend < 10) {
                            sendScavenges(index + 1);
                            return;
                        }

                        unitsInput.value = unitsToSend;

                        ['input', 'change', 'keyup', 'keydown', 'blur'].forEach(eventType => {
                            unitsInput.dispatchEvent(new Event(eventType, { bubbles: true }));
                        });

                        const startBtn = opt.querySelector('a.btn.btn-default.free_send_button');
                        if (!startBtn) {
                            sendScavenges(index + 1);
                            return;
                        }

                        startBtn.click();

                        setTimeout(() => {
                            sendScavenges(index + 1);
                        }, allocationDelay);
                    }

                    sendScavenges();

                    return;
                }

                // IMPROVED: Auto unlock logic with checkbox control
                if (anyRunning || availableForSend.length === 0) {
                    // NEW: Check if auto unlock is enabled before attempting unlock
                    if (autoUnlockEnabled && lockedScavenges.length > 0) {
                        console.log('Auto Scavenge: Auto unlock enabled, attempting to unlock scavenge...');

                        const unlockContainer = lockedScavenges[0];
                        const unlockBtn = unlockContainer.querySelector('a.btn.btn-default.unlock-button');

                        if (unlockBtn) {
                            unlockBtn.click();

                            setTimeout(() => {
                                // Check CAPTCHA before confirming
                                if (isPausedByCaptcha) return;

                                // FIXED: Search for confirm button ONLY in popup
                                const popup = document.querySelector('.popup_box_content');

                                if (!popup) {
                                    console.log('Auto Scavenge: Popup not found');
                                    startReloadCountdown(reloadDelayRunning);
                                    return;
                                }

                                // Find the confirm button in popup (not unlock-button, not disabled)
                                const confirmBtn = popup.querySelector('a.btn.btn-default:not(.unlock-button):not(.btn-disabled)');
                                const disabledBtn = popup.querySelector('a.btn.btn-default.btn-disabled');

                                if (confirmBtn) {
                                    console.log('Auto Scavenge: Found enabled unlock confirmation button, clicking...');
                                    confirmBtn.click();
                                    updateResults('Unlocking scavenge...');
                                    startReloadCountdown(reloadDelayRunning);
                                } else if (disabledBtn) {
                                    console.log('Auto Scavenge: Unlock button disabled (not enough resources), closing popup...');
                                    const closeBtn = document.querySelector('a.popup_box_close');
                                    if (closeBtn) {
                                        closeBtn.click();
                                    }
                                    updateResults('Cannot unlock - not enough resources');
                                    startReloadCountdown(reloadDelayRunning);
                                } else {
                                    console.log('Auto Scavenge: No confirmation button found, reloading...');
                                    startReloadCountdown(reloadDelayRunning);
                                }
                            }, 1000);
                        } else {
                            startReloadCountdown(reloadDelayRunning);
                        }

                        clearInterval(intervalId);
                        return;
                    } else if (!autoUnlockEnabled && lockedScavenges.length > 0) {
                        console.log('Auto Scavenge: Locked scavenges found but auto unlock is disabled');
                        updateResults('Locked scavenges found - enable Auto Unlock to unlock them');
                    }

                    // If auto unlock is disabled or no locked scavenges, just wait
                    startReloadCountdown(reloadDelayRunning);
                    clearInterval(intervalId);
                    return;
                }

                startReloadCountdown(reloadDelayRunning);
                clearInterval(intervalId);

            } else {
                waited += checkInterval;
                if (waited > maxWaitTime) {
                    clearInterval(intervalId);
                }
            }
        }, checkInterval);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initScript);
    } else {
        initScript();
    }

})();
