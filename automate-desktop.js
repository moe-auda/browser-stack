/**
 * BrowserStack Automate — Desktop performance testing
 *
 * Speed Lab API Beta does not support desktop browser testing.
 * This module uses BrowserStack Automate (WebDriver) to open each URL
 * in a real desktop browser and collect performance metrics via the
 * browser's native Performance API (NavigationTiming + PaintTiming).
 *
 * Supports: OS X Big Sur (Safari), Windows 11 (Chrome)
 * API docs: https://www.browserstack.com/docs/automate/api-reference/selenium/introduction
 */

const AUTOMATE_URL = "https://hub-cloud.browserstack.com/wd/hub";

/**
 * Run a performance test on a desktop browser via BrowserStack Automate.
 * Returns a metrics object in the same shape as Speed Lab results.
 */
export async function runDesktopTest({ username, accessKey, url, profile }) {
  const sessionId = await startSession({ username, accessKey, url, profile });

  try {
    const metrics = await collectMetrics({ username, accessKey, sessionId, url });
    await markSessionPassed({ username, accessKey, sessionId });
    return metrics;
  } catch (err) {
    await markSessionFailed({ username, accessKey, sessionId, reason: err.message });
    throw err;
  }
}

async function startSession({ username, accessKey, url, profile }) {
  const capabilities = {
    "bstack:options": {
      os: profile.os,
      osVersion: profile.osVersion,
      sessionName: `Speed Lab weekly — ${profile.label}`,
      buildName: `Speed Lab ${new Date().toISOString().slice(0, 10)}`,
      networkLogs: true,
      consoleLogs: "info",
    },
    browserName: profile.browser,
    browserVersion: profile.browserVersion,
  };

  const response = await fetch(`${AUTOMATE_URL}/session`, {
    method: "POST",
    headers: {
      Authorization: basicAuth(username, accessKey),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ desiredCapabilities: capabilities }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to start Automate session [${response.status}]: ${text}`);
  }

  const data = await response.json();
  const sessionId = data?.sessionId ?? data?.value?.sessionId;

  if (!sessionId) {
    throw new Error(`No sessionId in response: ${JSON.stringify(data)}`);
  }

  // Navigate to the URL
  await executeCommand({
    username, accessKey, sessionId,
    path: "url",
    body: { url },
  });

  // Wait for page load event
  await waitForLoad({ username, accessKey, sessionId });

  return sessionId;
}

async function collectMetrics({ username, accessKey, sessionId, url }) {
  // Use both PerformanceNavigation2 and legacy PerformanceTiming for cross-browser compatibility.
  // Safari supports timing but not all PerformanceObserver entry types.
  const script = `
    try {
      // NavigationTiming Level 2 (Chrome, Firefox, Edge, Safari 15+)
      var nav2 = performance.getEntriesByType('navigation')[0];

      // Legacy NavigationTiming Level 1 (all browsers including Safari 14)
      var nav1 = performance.timing || {};

      // Paint timing (Chrome, Firefox — Safari doesn't expose FCP via getEntriesByType)
      var paint = {};
      try {
        performance.getEntriesByType('paint').forEach(function(e) { paint[e.name] = e.startTime; });
      } catch(e) {}

      // LCP (Chromium only)
      var lcp = null;
      try {
        var lcpEntries = performance.getEntriesByType('largest-contentful-paint');
        if (lcpEntries && lcpEntries.length > 0) lcp = lcpEntries[lcpEntries.length - 1].startTime;
      } catch(e) {}

      var pageLoad = null;

      if (nav2) {
        pageLoad = nav2.loadEventEnd > 0 ? Math.round(nav2.loadEventEnd - nav2.fetchStart) : null;
      } else if (nav1 && nav1.loadEventEnd) {
        pageLoad = nav1.loadEventEnd > 0 ? Math.round(nav1.loadEventEnd - nav1.navigationStart) : null;
      }

      var fcp = paint['first-contentful-paint'] ? Math.round(paint['first-contentful-paint']) : null;

      // TTI approximation via domInteractive (not Lighthouse TTI, but a reasonable proxy)
      var tti = null;
      if (nav2 && nav2.domInteractive > 0) {
        tti = Math.round(nav2.domInteractive - nav2.fetchStart);
      } else if (nav1 && nav1.domInteractive > 0) {
        tti = Math.round(nav1.domInteractive - nav1.navigationStart);
      }

      // TBT via Long Tasks API (Chrome only; Safari returns null)
      var tbt = null;
      try {
        var longTasks = performance.getEntriesByType('longtask');
        if (longTasks && longTasks.length > 0) {
          tbt = Math.round(longTasks.reduce(function(sum, t) {
            var blocking = t.duration - 50;
            return sum + (blocking > 0 ? blocking : 0);
          }, 0));
        }
      } catch(e) {}

      return {
        pageLoadTime: pageLoad,
        firstContentfulPaint: fcp,
        largestContentfulPaint: lcp ? Math.round(lcp) : null,
        timeToInteractive: tti,
        totalBlockingTime: tbt,
        speedIndex: null,
      };
    } catch(err) {
      return { _error: err.message };
    }
  `;

  const result = await executeScript({ username, accessKey, sessionId, script });
  return result;
}

async function waitForLoad({ username, accessKey, sessionId }) {
  const script = `return document.readyState`;
  const maxAttempts = 30;

  for (let i = 0; i < maxAttempts; i++) {
    await sleep(2000);
    const state = await executeScript({ username, accessKey, sessionId, script });
    if (state === "complete") return;
  }
  // Proceed even if not "complete" — collect whatever we have
}

async function executeScript({ username, accessKey, sessionId, script }) {
  const data = await executeCommand({
    username, accessKey, sessionId,
    path: "execute/sync",
    body: { script, args: [] },
  });
  return data?.value ?? data;
}

async function executeCommand({ username, accessKey, sessionId, path, body }) {
  const response = await fetch(`${AUTOMATE_URL}/session/${sessionId}/${path}`, {
    method: "POST",
    headers: {
      Authorization: basicAuth(username, accessKey),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Command ${path} failed [${response.status}]: ${text}`);
  }

  return response.json();
}

async function markSessionPassed({ username, accessKey, sessionId }) {
  await fetch(`https://api.browserstack.com/automate/sessions/${sessionId}.json`, {
    method: "PUT",
    headers: {
      Authorization: basicAuth(username, accessKey),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ status: "passed", reason: "Performance metrics collected" }),
  });
}

async function markSessionFailed({ username, accessKey, sessionId, reason }) {
  await fetch(`https://api.browserstack.com/automate/sessions/${sessionId}.json`, {
    method: "PUT",
    headers: {
      Authorization: basicAuth(username, accessKey),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ status: "failed", reason }),
  }).catch(() => {});
}

function basicAuth(username, accessKey) {
  return "Basic " + Buffer.from(`${username}:${accessKey}`).toString("base64");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
