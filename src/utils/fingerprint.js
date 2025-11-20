/**
 * Browser Fingerprint Generator
 * Generuje unikátní browser fingerprint pro každý účet
 */

import { randomRange } from './randomize.js';

/**
 * Možné konfigurace prohlížečů
 */
const CHROME_VERSIONS = [
  '119.0.0.0', '120.0.0.0', '121.0.0.0', '122.0.0.0', '123.0.0.0'
];

const WINDOWS_VERSIONS = [
  'Windows NT 10.0; Win64; x64',
  'Windows NT 10.0; WOW64',
  'Windows NT 11.0; Win64; x64'
];

const SCREEN_RESOLUTIONS = [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 1536, height: 864 },
  { width: 1600, height: 900 },
  { width: 2560, height: 1440 }
];

const VIEWPORTS = [
  { width: 1280, height: 720 },
  { width: 1366, height: 768 },
  { width: 1440, height: 810 },
  { width: 1536, height: 864 },
  { width: 1600, height: 900 }
];

const WEBGL_VENDORS = [
  { vendor: 'Intel Inc.', renderer: 'Intel Iris OpenGL Engine' },
  { vendor: 'Intel Inc.', renderer: 'Intel(R) UHD Graphics 620' },
  { vendor: 'NVIDIA Corporation', renderer: 'NVIDIA GeForce GTX 1050/PCIe/SSE2' },
  { vendor: 'NVIDIA Corporation', renderer: 'NVIDIA GeForce GTX 1650/PCIe/SSE2' },
  { vendor: 'AMD', renderer: 'AMD Radeon RX 580' },
  { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Mesa Intel(R) UHD Graphics 620 (KBL GT2), OpenGL 4.6)' }
];

/**
 * Vybere náhodný element z pole
 */
function randomChoice(array) {
  return array[Math.floor(Math.random() * array.length)];
}

/**
 * Generuje náhodný browser fingerprint
 */
export function generateFingerprint() {
  const chromeVersion = randomChoice(CHROME_VERSIONS);
  const windowsVersion = randomChoice(WINDOWS_VERSIONS);
  const screen = randomChoice(SCREEN_RESOLUTIONS);
  const viewport = randomChoice(VIEWPORTS);
  const webgl = randomChoice(WEBGL_VENDORS);

  // Hardware specs
  const deviceMemory = randomChoice([4, 8, 16]);
  const hardwareConcurrency = randomChoice([2, 4, 6, 8, 12, 16]);

  // User Agent
  const userAgent = `Mozilla/5.0 (${windowsVersion}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;

  return {
    userAgent,
    viewport: {
      width: viewport.width,
      height: viewport.height
    },
    screen: {
      width: screen.width,
      height: screen.height,
      availWidth: screen.width,
      availHeight: screen.height - randomRange(30, 80), // Taskbar
      colorDepth: 24,
      pixelDepth: 24
    },
    deviceMemory,
    hardwareConcurrency,
    webgl: {
      vendor: webgl.vendor,
      renderer: webgl.renderer
    },
    platform: 'Win32',
    languages: ['cs-CZ', 'cs', 'en-US', 'en']
  };
}

/**
 * Vytvoří stealth script s konkrétním fingerprintem
 */
export function createStealthScript(fingerprint) {
  return `
    // 1. Skrýt navigator.webdriver
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined
    });

    // 2. Maskovat Chrome automation
    window.navigator.chrome = {
      runtime: {},
      loadTimes: function() {},
      csi: function() {},
      app: {}
    };

    // 3. Přepsat permissions API
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters) => (
      parameters.name === 'notifications' ?
        Promise.resolve({ state: Notification.permission }) :
        originalQuery(parameters)
    );

    // 4. MaskovatPluginArray
    Object.defineProperty(navigator, 'plugins', {
      get: () => [
        {
          0: { type: "application/x-google-chrome-pdf", suffixes: "pdf", description: "Portable Document Format", enabledPlugin: Plugin },
          description: "Portable Document Format",
          filename: "internal-pdf-viewer",
          length: 1,
          name: "Chrome PDF Plugin"
        },
        {
          0: { type: "application/pdf", suffixes: "pdf", description: "", enabledPlugin: Plugin },
          description: "",
          filename: "mhjfbmdgcfjbbpaeojofohoefgiehjai",
          length: 1,
          name: "Chrome PDF Viewer"
        },
        {
          0: { type: "application/x-nacl", suffixes: "", description: "Native Client Executable", enabledPlugin: Plugin },
          1: { type: "application/x-pnacl", suffixes: "", description: "Portable Native Client Executable", enabledPlugin: Plugin },
          description: "",
          filename: "internal-nacl-plugin",
          length: 2,
          name: "Native Client"
        }
      ]
    });

    // 5. Nastavit jazyky z fingerprint
    Object.defineProperty(navigator, 'languages', {
      get: () => ${JSON.stringify(fingerprint.languages)}
    });

    // 6. Nastavit platform
    Object.defineProperty(navigator, 'platform', {
      get: () => '${fingerprint.platform}'
    });

    // 7. Nastavit deviceMemory
    Object.defineProperty(navigator, 'deviceMemory', {
      get: () => ${fingerprint.deviceMemory}
    });

    // 8. Nastavit hardwareConcurrency
    Object.defineProperty(navigator, 'hardwareConcurrency', {
      get: () => ${fingerprint.hardwareConcurrency}
    });

    // 9. Přepsat WebGL vendor/renderer z fingerprint
    const getParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function(parameter) {
      if (parameter === 37445) {
        return '${fingerprint.webgl.vendor}'; // UNMASKED_VENDOR_WEBGL
      }
      if (parameter === 37446) {
        return '${fingerprint.webgl.renderer}'; // UNMASKED_RENDERER_WEBGL
      }
      return getParameter.call(this, parameter);
    };

    // 10. Nastavit screen z fingerprint
    Object.defineProperty(window.screen, 'width', {
      get: () => ${fingerprint.screen.width}
    });
    Object.defineProperty(window.screen, 'height', {
      get: () => ${fingerprint.screen.height}
    });
    Object.defineProperty(window.screen, 'availWidth', {
      get: () => ${fingerprint.screen.availWidth}
    });
    Object.defineProperty(window.screen, 'availHeight', {
      get: () => ${fingerprint.screen.availHeight}
    });
    Object.defineProperty(window.screen, 'colorDepth', {
      get: () => ${fingerprint.screen.colorDepth}
    });
    Object.defineProperty(window.screen, 'pixelDepth', {
      get: () => ${fingerprint.screen.pixelDepth}
    });

    // 11. Maskovat WebDriver flag v iframe
    Object.defineProperty(window, 'navigator', {
      value: new Proxy(navigator, {
        get: (target, prop) => {
          if (prop === 'webdriver') {
            return undefined;
          }
          return target[prop];
        }
      })
    });

    // 12. Odstranit všechny Playwright-specific properties
    delete window.playwright;
    delete window.__playwright;
    delete window.__pw_manual;
    delete window.__PW_inspect;
    delete document.__playwright_evaluation_script__;

    // 13. Odstranit Chrome CDP (DevTools Protocol) indicators
    // Tyto properties nastavuje Playwright/Puppeteer přes CDP
    const cdcProps = Object.keys(window).filter(prop => /^(cdc_|__cdc|_cdc)/.test(prop));
    cdcProps.forEach(prop => delete window[prop]);

    const docCdcProps = Object.keys(document).filter(prop => /^(\\$cdc|\\$chrome)/.test(prop));
    docCdcProps.forEach(prop => delete document[prop]);

    // 14. Odstranit Selenium/WebDriver indicators
    delete window._Selenium_IDE_Recorder;
    delete window.__selenium_evaluate;
    delete window.__selenium_unwrapped;
    delete window.__webdriver_evaluate;
    delete window.__driver_evaluate;
    delete window.__webdriver_script_fn;
    delete window.__webdriver_script_func;
    delete window.__webdriver_script_function;
    delete window.__fxdriver_evaluate;
    delete window.__driver_unwrapped;
    delete window.__webdriver_unwrapped;
    delete window.__fxdriver_unwrapped;
    delete window._selenium;
    delete window._webdriver;
    delete window.callSelenium;
    delete window.callPhantom;
    delete window._phantom;
    delete window.__phantomas;
    delete window.__nightmare;
    delete window.domAutomation;
    delete window.domAutomationController;

    // 15. Opravit Function.prototype.toString pro native funkce
    // Bot detekce kontroluje zda modifikované funkce vypadají nativně
    const originalToString = Function.prototype.toString;
    const nativeFunctionString = 'function () { [native code] }';

    Function.prototype.toString = function() {
      // Pokud je to naše modifikovaná funkce, vrať native-looking string
      if (this === WebGLRenderingContext.prototype.getParameter ||
          this === navigator.permissions.query) {
        return nativeFunctionString;
      }
      return originalToString.call(this);
    };

    // 16. Opravit iframe contentWindow descriptor (Playwright specific)
    // Playwright mění způsob jak funguje contentWindow u iframe
    try {
      const iframeGetter = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow').get;
      Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
        get: function() {
          const win = iframeGetter.call(this);
          if (win) {
            // Zajisti že webdriver je undefined i v iframe
            try {
              Object.defineProperty(win.navigator, 'webdriver', {
                get: () => undefined,
                configurable: true
              });
            } catch (e) {}
          }
          return win;
        },
        configurable: true
      });
    } catch (e) {
      // Pokud se nepodaří, pokračuj
    }

    // 17. Přidat chybějící Chrome runtime properties
    if (!window.chrome) {
      window.chrome = {};
    }
    if (!window.chrome.runtime) {
      window.chrome.runtime = {
        OnInstalledReason: {
          CHROME_UPDATE: 'chrome_update',
          INSTALL: 'install',
          SHARED_MODULE_UPDATE: 'shared_module_update',
          UPDATE: 'update'
        },
        OnRestartRequiredReason: {
          APP_UPDATE: 'app_update',
          OS_UPDATE: 'os_update',
          PERIODIC: 'periodic'
        },
        PlatformArch: {
          ARM: 'arm',
          ARM64: 'arm64',
          MIPS: 'mips',
          MIPS64: 'mips64',
          X86_32: 'x86-32',
          X86_64: 'x86-64'
        },
        PlatformNaclArch: {
          ARM: 'arm',
          MIPS: 'mips',
          MIPS64: 'mips64',
          X86_32: 'x86-32',
          X86_64: 'x86-64'
        },
        PlatformOs: {
          ANDROID: 'android',
          CROS: 'cros',
          LINUX: 'linux',
          MAC: 'mac',
          OPENBSD: 'openbsd',
          WIN: 'win'
        },
        RequestUpdateCheckStatus: {
          NO_UPDATE: 'no_update',
          THROTTLED: 'throttled',
          UPDATE_AVAILABLE: 'update_available'
        }
      };
    }

    // 18. Maskovat connection rtt (round trip time) - bot detekce může měřit
    if (navigator.connection) {
      Object.defineProperty(navigator.connection, 'rtt', {
        get: () => ${Math.floor(Math.random() * 50) + 50}, // 50-100ms
        configurable: true
      });
    }

    // 19. Přidat Battery API maskování
    if (navigator.getBattery) {
      const originalGetBattery = navigator.getBattery;
      navigator.getBattery = function() {
        return originalGetBattery.call(navigator).then(battery => {
          Object.defineProperty(battery, 'charging', { value: true });
          Object.defineProperty(battery, 'chargingTime', { value: 0 });
          Object.defineProperty(battery, 'dischargingTime', { value: Infinity });
          Object.defineProperty(battery, 'level', { value: ${(Math.random() * 0.5 + 0.5).toFixed(2)} });
          return battery;
        });
      };
    }

    // 20. Odstranit automation flags z window.external
    if (window.external && window.external.toString && window.external.toString().indexOf('Sequentum') !== -1) {
      delete window.external;
    }

    // 21. Přidat správné touch support podle zařízení
    const isTouchDevice = ${fingerprint.screen.width < 1024 ? 'true' : 'false'};
    if (isTouchDevice) {
      Object.defineProperty(navigator, 'maxTouchPoints', {
        get: () => ${Math.floor(Math.random() * 5) + 1}
      });
    } else {
      Object.defineProperty(navigator, 'maxTouchPoints', {
        get: () => 0
      });
    }

    // 22. Console.debug maskování - detekce dev tools
    const originalDebug = console.debug;
    console.debug = function() {
      // Kontrola zda jsou dev tools otevřené
      // Boti obvykle nemají dev tools otevřené, ale maskujeme to stejně
      return originalDebug.apply(this, arguments);
    };
  `;
}

export default {
  generateFingerprint,
  createStealthScript
};
