/**
 * Stealth script pro maskování automation properties
 * Skryje navigator.webdriver a další bot-detection signály
 */

export const stealthScript = `
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

  // 3. Přepsat permissions API (Playwright má odlišný behavior)
  const originalQuery = window.navigator.permissions.query;
  window.navigator.permissions.query = (parameters) => (
    parameters.name === 'notifications' ?
      Promise.resolve({ state: Notification.permission }) :
      originalQuery(parameters)
  );

  // 4. MaskovatPluginArray (Playwright má 0 pluginů)
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

  // 5. Maskovat jazyky (Playwright má pouze 1)
  Object.defineProperty(navigator, 'languages', {
    get: () => ['cs-CZ', 'cs', 'en-US', 'en']
  });

  // 6. Přidat realistický platform
  Object.defineProperty(navigator, 'platform', {
    get: () => 'Win32'
  });

  // 7. Maskovat deviceMemory (Playwright nevrací tuto hodnotu)
  Object.defineProperty(navigator, 'deviceMemory', {
    get: () => 8
  });

  // 8. Maskovat hardwareConcurrency
  Object.defineProperty(navigator, 'hardwareConcurrency', {
    get: () => 8
  });

  // 9. Přepsat WebGL vendor/renderer pro realistické hodnoty
  const getParameter = WebGLRenderingContext.prototype.getParameter;
  WebGLRenderingContext.prototype.getParameter = function(parameter) {
    if (parameter === 37445) {
      return 'Intel Inc.'; // UNMASKED_VENDOR_WEBGL
    }
    if (parameter === 37446) {
      return 'Intel Iris OpenGL Engine'; // UNMASKED_RENDERER_WEBGL
    }
    return getParameter.call(this, parameter);
  };

  // 10. Maskovat WebDriver flag v iframe
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

  // 11. Přidat random mouse movements simulation (meta property)
  window.__playwright_stealth_enabled = true;
`;

export default stealthScript;
