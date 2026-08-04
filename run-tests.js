/**
 * BrowserStack Weekly Test Runner
 *
 * All profiles (mobile + desktop) → Speed Lab API
 *
 * Usage:
 *   node run-tests.js              — all 20 tests
 *   node run-tests.js --iphone     — iPhone 12 only        (4 tests) — Friday
 *   node run-tests.js --galaxy     — Galaxy S10 only       (4 tests) — Saturday
 *   node run-tests.js --galaxy-s24 — Galaxy S24 only       (4 tests)
 *   node run-tests.js --android    — both Android phones   (8 tests)
 *   node run-tests.js --safari     — OS X Safari only      (4 tests) — Sunday
 *   node run-tests.js --chrome     — Windows Chrome only   (4 tests) — Monday
 *   node run-tests.js --desktop    — Safari + Chrome       (8 tests) — manual override
 */

import "dotenv/config";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import path from "path";
import { URLS, MOBILE_PROFILES, DESKTOP_PROFILES } from "./config.js";
import { submitMobileTest, waitForReport } from "./speedlab-api.js";
import { runChromeLighthouse } from "./run-chrome-lighthouse.js";
import { runDesktopTest } from "./automate-desktop.js";
import { extractMetrics, saveResults, printSummary } from "./reporter.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Parse profile-selection flags
const args = process.argv.slice(2);
const FLAG_IPHONE  = args.includes("--iphone");
const FLAG_GALAXY  = args.includes("--galaxy");
const FLAG_GALAXY_S24 = args.includes("--galaxy-s24");
const FLAG_ANDROID = args.includes("--android");
const FLAG_SAFARI  = args.includes("--safari");
const FLAG_CHROME  = args.includes("--chrome");
const FLAG_DESKTOP = args.includes("--desktop");
const FLAG_ALL     = !FLAG_IPHONE && !FLAG_GALAXY && !FLAG_GALAXY_S24 && !FLAG_ANDROID && !FLAG_SAFARI && !FLAG_CHROME && !FLAG_DESKTOP;

const USERNAME   = process.env.BROWSERSTACK_USERNAME;
const ACCESS_KEY = process.env.BROWSERSTACK_ACCESS_KEY;
const REGION     = process.env.SPEEDLAB_REGION  ?? "usw";
const MOBILE_NETWORK = process.env.MOBILE_NETWORK ?? "4g_normal";
const configuredLighthouseAttempts = Number.parseInt(process.env.LIGHTHOUSE_ATTEMPTS ?? "3", 10);
const LIGHTHOUSE_ATTEMPTS = Number.isFinite(configuredLighthouseAttempts)
  ? Math.max(1, configuredLighthouseAttempts)
  : 3;

if (!USERNAME || !ACCESS_KEY) {
  console.error("Error: BROWSERSTACK_USERNAME and BROWSERSTACK_ACCESS_KEY must be set in .env");
  process.exit(1);
}

// ─── Speed Lab test runner (mobile + desktop) ──────────────────────────────

async function runTest({ url, profile }) {
  if (profile.useAutomate) {
    console.log(`  [Automate]  ${profile.label} — ${url}`);
    try {
      const metrics = await runDesktopTest({
        username: USERNAME,
        accessKey: ACCESS_KEY,
        url,
        profile: { label: profile.label, ...(profile.automate ?? {}) },
      });
      return { url, profile: profile.label, source: "automate", reportId: null, metrics, error: null };
    } catch (err) {
      console.error(`  [Failed]    ${profile.label} — ${err.message}`);
      return { url, profile: profile.label, source: "automate", reportId: null, metrics: null, error: err.message };
    }
  }

  // Chrome runs self-hosted Lighthouse in GitHub Actions — Speed Lab Lighthouse fails on
  // pressreader.com due to service worker interference (all 5 runs return perf=-1).
  if (profile.useLighthouse) {
    console.log(`  [Lighthouse] ${profile.label} — ${url}`);
    for (let attempt = 1; attempt <= LIGHTHOUSE_ATTEMPTS; attempt++) {
      try {
        const metrics = await runChromeLighthouse({
          url,
          formFactor: profile.lighthouseFormFactor ?? "desktop",
          screenEmulation: profile.lighthouseScreenEmulation,
        });
        return { url, profile: profile.label, source: "lighthouse", reportId: null, metrics, error: null };
      } catch (err) {
        if (attempt < LIGHTHOUSE_ATTEMPTS) {
          console.warn(`  [Retry]     ${profile.label} attempt ${attempt}/${LIGHTHOUSE_ATTEMPTS} — ${err.message}`);
          await new Promise((resolve) => setTimeout(resolve, 10_000));
          continue;
        }

        console.error(`  [Failed]    ${profile.label} — ${err.message}`);
        return { url, profile: profile.label, source: "lighthouse", reportId: null, metrics: null, error: err.message };
      }
    }
  }

  // All other profiles (mobile + Safari) use Speed Lab
  console.log(`  [SpeedLab]  ${profile.label} — ${url}`);
  try {
    const reportId = await submitMobileTest({
      username: USERNAME,
      accessKey: ACCESS_KEY,
      url,
      deviceProfile: profile,
      network: MOBILE_NETWORK,
      region: REGION,
    });

    console.log(`  [Waiting]   ${profile.label} report=${reportId}`);
    const report = await waitForReport({ username: USERNAME, accessKey: ACCESS_KEY, reportId });
    const metrics = extractMetrics(report);

    return { url, profile: profile.label, source: "speedlab", reportId, metrics, error: null };
  } catch (err) {
    console.error(`  [Failed]    ${profile.label} — ${err.message}`);
    return { url, profile: profile.label, source: "speedlab", reportId: null, metrics: null, error: err.message };
  }
}

// ─── Batch runner ──────────────────────────────────────────────────────────

async function runBatch(tasks, concurrency) {
  const results = [];
  for (let i = 0; i < tasks.length; i += concurrency) {
    const batch = tasks.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map((t) => t()));
    results.push(...batchResults);
  }
  return results;
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const runDate = new Date().toISOString().slice(0, 10);

  const mobileProfilesToRun = MOBILE_PROFILES.filter((p) => {
    if (FLAG_ALL)    return true;
    if (FLAG_IPHONE) return p.label === "iPhone 12";
    if (FLAG_GALAXY) return p.label === "Samsung Galaxy S10";
    if (FLAG_GALAXY_S24) return p.label === "Samsung Galaxy S24";
    if (FLAG_ANDROID) return p.device?.os === "android";
    return false;
  });

  const desktopProfilesToRun = DESKTOP_PROFILES.filter((p) => {
    if (FLAG_ALL || FLAG_DESKTOP) return true;
    if (FLAG_SAFARI) return p.label === "OS X Big Sur — Safari";
    if (FLAG_CHROME) return p.label === "Windows 11 — Chrome";
    return false;
  });

  const allProfiles = [...mobileProfilesToRun, ...desktopProfilesToRun];
  const tasks = URLS.flatMap((url) =>
    allProfiles.map((profile) => () => runTest({ url, profile }))
  );

  const mode = FLAG_IPHONE ? "--iphone" : FLAG_GALAXY ? "--galaxy" : FLAG_GALAXY_S24 ? "--galaxy-s24" : FLAG_ANDROID ? "--android" : FLAG_SAFARI ? "--safari" : FLAG_CHROME ? "--chrome" : FLAG_DESKTOP ? "--desktop" : "full";

  console.log(`\nBrowserStack Weekly Performance Run`);
  console.log(`Date:    ${runDate}  Mode: ${mode}`);
  console.log(`Region:  ${REGION}`);
  console.log(`Total:   ${tasks.length} tests (${mobileProfilesToRun.length * URLS.length} mobile + ${desktopProfilesToRun.length * URLS.length} desktop)\n`);
  console.log("── Speed Lab ──────────────────────────────────────────────────");

  // Speed Lab quota: 1 concurrent per account
  const allResults = await runBatch(tasks, 1);

  const { jsonFile, csvFile } = saveResults(runDate, allResults);
  printSummary(runDate, allResults);

  const passed = allResults.filter((r) => !r.error).length;
  const failed = allResults.filter((r) => r.error).length;

  // Regenerate HTML report after every run
  try {
    execSync(`node ${path.join(__dirname, "generate-report.js")}`, { cwd: __dirname, stdio: "inherit" });
  } catch (err) {
    console.warn("Warning: report generation failed —", err.message);
  }

  console.log(`${"=".repeat(70)}`);
  console.log(`Passed: ${passed}  Failed: ${failed}  Total: ${allResults.length}`);
  console.log(`JSON:   ${jsonFile}`);
  console.log(`CSV:    ${csvFile}`);
  console.log(`Report: ${path.join(__dirname, "results/report.html")}`);
  console.log(`${"=".repeat(70)}\n`);

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
