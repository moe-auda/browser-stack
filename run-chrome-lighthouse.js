/**
 * Self-hosted Lighthouse runner for Chrome performance testing.
 *
 * Replaces BrowserStack Speed Lab for Windows 11 Chrome because Speed Lab's
 * Lighthouse consistently returns performance_score=-1 on pressreader.com
 * (service worker interference prevents page-idle detection).
 *
 * Key hang-prevention settings:
 *   maxWaitForLoad: 45 s  — hard cap on how long Lighthouse waits for idle
 *   maxWaitForFcp:  15 s  — cap on waiting for First Contentful Paint
 *   --disable-extensions  — avoids extension interference in headless Chrome
 *   --disable-background-networking — reduces noise during audit
 */

import lighthouse from "lighthouse";
import * as chromeLauncher from "chrome-launcher";

const DESKTOP_THROTTLING = {
  // Simulated broadband — matches BrowserStack desktop Speed Lab profile
  rttMs: 40,
  throughputKbps: 10_240,
  cpuSlowdownMultiplier: 1,
  requestLatencyMs: 0,
  downloadThroughputKbps: 0,
  uploadThroughputKbps: 0,
};

function num(audit) {
  const v = audit?.numericValue;
  return v != null ? Math.round(v) : null;
}

export async function runChromeLighthouse({ url }) {
  const chrome = await chromeLauncher.launch({
    chromeFlags: [
      "--headless",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-default-apps",
    ],
  });

  try {
    const result = await lighthouse(
      url,
      { port: chrome.port, output: "json", logLevel: "error" },
      {
        extends: "lighthouse:default",
        settings: {
          formFactor: "desktop",
          screenEmulation: {
            mobile: false,
            width: 1350,
            height: 940,
            deviceScaleFactor: 1,
            disabled: false,
          },
          throttlingMethod: "simulate",
          throttling: DESKTOP_THROTTLING,
          onlyCategories: ["performance"],
          maxWaitForLoad: 45_000,
          maxWaitForFcp: 15_000,
        },
      }
    );

    const lhr = result?.lhr;

    if (!lhr) {
      throw new Error("Lighthouse returned no result");
    }

    if (lhr.runtimeError?.code) {
      throw new Error(`Lighthouse runtime error: ${lhr.runtimeError.message}`);
    }

    const score = lhr.categories?.performance?.score;
    if (score == null || score < 0) {
      throw new Error(`Lighthouse returned invalid performance score: ${score}`);
    }

    const audits = lhr.audits ?? {};

    return {
      pageLoadTime: null, // Lighthouse does not expose nav load event time
      firstContentfulPaint: num(audits["first-contentful-paint"]),
      largestContentfulPaint: num(audits["largest-contentful-paint"]),
      timeToInteractive: num(audits["interactive"]),
      totalBlockingTime: num(audits["total-blocking-time"]),
      speedIndex: num(audits["speed-index"]),
      browserPerformanceScore: Math.round(score * 100),
    };
  } finally {
    await chrome.kill();
  }
}
