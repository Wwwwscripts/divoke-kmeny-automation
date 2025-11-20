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

    window.__playwright_stealth_enabled = true;
  `;
}

export default {
  generateFingerprint,
  createStealthScript
};
