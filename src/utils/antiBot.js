/**
 * Anti-bot detekce a obrana
 * Detekuje Cloudflare, hCaptcha a další anti-bot systémy
 */

/**
 * Zkontroluj zda je přítomná Cloudflare challenge
 */
export async function detectCloudflare(page) {
  try {
    // Cloudflare challenge má obvykle tyto znaky
    const indicators = await page.evaluate(() => {
      // Cloudflare má typicky tyhle elementy
      const cfChallenge = document.querySelector('#challenge-running') !== null;
      const cfBody = document.body?.className?.includes('no-js') && document.title?.includes('Just a moment');
      const cfScript = Array.from(document.scripts).some(s => s.src?.includes('cloudflare') || s.src?.includes('challenges.cloudflare.com'));
      const cfRay = document.querySelector('[data-ray]') !== null;
      const cfTitle = document.title?.toLowerCase().includes('just a moment') || document.title?.toLowerCase().includes('checking your browser');

      return {
        cfChallenge,
        cfBody,
        cfScript,
        cfRay,
        cfTitle,
        detected: cfChallenge || cfBody || cfScript || cfRay || cfTitle
      };
    });

    return indicators;
  } catch (error) {
    return { detected: false, error: error.message };
  }
}

/**
 * Zkontroluj zda je přítomná hCaptcha
 */
export async function detectHCaptcha(page) {
  try {
    const captchaInfo = await page.evaluate(() => {
      // Hledej hCaptcha iframe nebo checkbox
      const hcaptchaIframe = document.querySelector('iframe[src*="hcaptcha.com"]');
      const hcaptchaCheckbox = document.querySelector('.h-captcha, [data-hcaptcha-widget-id]');
      const hcaptchaScript = Array.from(document.scripts).some(s => s.src?.includes('hcaptcha.com'));

      let sitekey = null;
      if (hcaptchaIframe) {
        try {
          const url = new URL(hcaptchaIframe.src);
          sitekey = url.searchParams.get('sitekey');
        } catch (e) {}
      } else if (hcaptchaCheckbox) {
        sitekey = hcaptchaCheckbox.getAttribute('data-sitekey');
      }

      return {
        iframe: hcaptchaIframe !== null,
        checkbox: hcaptchaCheckbox !== null,
        script: hcaptchaScript,
        sitekey,
        detected: hcaptchaIframe !== null || hcaptchaCheckbox !== null || hcaptchaScript
      };
    });

    return captchaInfo;
  } catch (error) {
    return { detected: false, error: error.message };
  }
}

/**
 * Zkontroluj zda je přítomná reCaptcha (Google)
 */
export async function detectReCaptcha(page) {
  try {
    const captchaInfo = await page.evaluate(() => {
      const recaptchaIframe = document.querySelector('iframe[src*="recaptcha"]');
      const recaptchaDiv = document.querySelector('.g-recaptcha, [data-sitekey]');
      const recaptchaScript = Array.from(document.scripts).some(s => s.src?.includes('recaptcha'));

      let sitekey = null;
      if (recaptchaDiv) {
        sitekey = recaptchaDiv.getAttribute('data-sitekey');
      }

      return {
        iframe: recaptchaIframe !== null,
        div: recaptchaDiv !== null,
        script: recaptchaScript,
        sitekey,
        detected: recaptchaIframe !== null || recaptchaDiv !== null || recaptchaScript
      };
    });

    return captchaInfo;
  } catch (error) {
    return { detected: false, error: error.message };
  }
}

/**
 * Zkontroluj zda stránka vyžaduje nějakou captcha nebo anti-bot check
 */
export async function detectAnyChallenge(page) {
  const [cloudflare, hcaptcha, recaptcha] = await Promise.all([
    detectCloudflare(page),
    detectHCaptcha(page),
    detectReCaptcha(page)
  ]);

  return {
    cloudflare,
    hcaptcha,
    recaptcha,
    hasAnyChallenge: cloudflare.detected || hcaptcha.detected || recaptcha.detected
  };
}

/**
 * Čekej na vyřešení Cloudflare challenge (max timeout)
 */
export async function waitForCloudflarePass(page, timeout = 30000) {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const cf = await detectCloudflare(page);

    if (!cf.detected) {
      return true; // Cloudflare prošel
    }

    // Čekej 1 sekundu a zkus znovu
    await new Promise(r => setTimeout(r, 1000));
  }

  return false; // Timeout
}

/**
 * Získej informace o detekovaném banu nebo blokaci
 */
export async function detectBan(page) {
  try {
    const banInfo = await page.evaluate(() => {
      const bodyText = document.body?.innerText?.toLowerCase() || '';
      const title = document.title?.toLowerCase() || '';

      // Typické znaky banu
      const banned = bodyText.includes('banned') ||
                     bodyText.includes('suspended') ||
                     bodyText.includes('blocked') ||
                     bodyText.includes('access denied') ||
                     bodyText.includes('zakázán') ||
                     bodyText.includes('zablokován') ||
                     title.includes('banned') ||
                     title.includes('403') ||
                     title.includes('access denied');

      const ipBan = bodyText.includes('ip') && (
                      bodyText.includes('banned') ||
                      bodyText.includes('blocked') ||
                      bodyText.includes('restricted')
                    );

      return {
        detected: banned,
        ipBan,
        bodySnippet: bodyText.substring(0, 200)
      };
    });

    return banInfo;
  } catch (error) {
    return { detected: false, error: error.message };
  }
}

/**
 * Test zda běží websocket monitoring (game-specific)
 */
export async function detectWebSocketMonitoring(page) {
  try {
    const wsInfo = await page.evaluate(() => {
      // Zkontroluj zda existuje WebSocket connection
      const hasWebSocket = typeof window.WebSocket !== 'undefined';

      // Zkontroluj aktivní WebSocket connections (není standardní způsob, ale můžeme zkusit)
      const wsCount = window.performance?.getEntriesByType?.('resource')
        ?.filter(r => r.name?.includes('ws://') || r.name?.includes('wss://'))
        ?.length || 0;

      return {
        supported: hasWebSocket,
        activeConnections: wsCount,
        likelyMonitoring: wsCount > 0
      };
    });

    return wsInfo;
  } catch (error) {
    return { supported: false, error: error.message };
  }
}

/**
 * Přidej interceptor pro WebSocket (pro logování co hra posílá)
 */
export async function interceptWebSocket(page) {
  await page.evaluateOnNewDocument(() => {
    const OriginalWebSocket = window.WebSocket;

    window.WebSocket = function(url, protocols) {
      console.log('🔌 WebSocket connection:', url);

      const ws = new OriginalWebSocket(url, protocols);

      // Intercept odeslaných zpráv
      const originalSend = ws.send;
      ws.send = function(data) {
        console.log('📤 WS Send:', data);
        return originalSend.call(this, data);
      };

      // Intercept přijatých zpráv
      ws.addEventListener('message', (event) => {
        console.log('📥 WS Receive:', event.data);
      });

      return ws;
    };

    // Zkopíruj properties z originálu
    window.WebSocket.prototype = OriginalWebSocket.prototype;
    window.WebSocket.CONNECTING = OriginalWebSocket.CONNECTING;
    window.WebSocket.OPEN = OriginalWebSocket.OPEN;
    window.WebSocket.CLOSING = OriginalWebSocket.CLOSING;
    window.WebSocket.CLOSED = OriginalWebSocket.CLOSED;
  });
}

/**
 * Kontrola komplexní detekce (vše najednou)
 */
export async function performSecurityCheck(page) {
  const [challenges, ban, ws] = await Promise.all([
    detectAnyChallenge(page),
    detectBan(page),
    detectWebSocketMonitoring(page)
  ]);

  const report = {
    timestamp: new Date().toISOString(),
    url: page.url(),
    challenges,
    ban,
    websocket: ws,
    status: 'ok'
  };

  // Určení statusu
  if (ban.detected) {
    report.status = 'banned';
  } else if (challenges.hasAnyChallenge) {
    report.status = 'challenge';
  }

  return report;
}

export default {
  detectCloudflare,
  detectHCaptcha,
  detectReCaptcha,
  detectAnyChallenge,
  waitForCloudflarePass,
  detectBan,
  detectWebSocketMonitoring,
  interceptWebSocket,
  performSecurityCheck
};
