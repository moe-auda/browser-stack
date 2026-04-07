/**
 * BrowserStack Weekly Test Runner
 *
 * Mobile (iPhone 12, Galaxy S10)  → Speed Lab API
 * Desktop (OS X Big Sur, Win 11)  → BrowserStack Automate
 *
 * Usage:
 *   node run-tests.js              — all 16 tests
 *   node run-tests.js --iphone     — iPhone 12 only (4 tests)   — Day 1
 *   node run-tests.js --galaxy     — Galaxy S10 only (4 tests)  — Day 2
 *   node run-tests.js --desktop    — desktop only (8 tests)     — Day 3
 */

import "dotenv/config";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import path from "path";
import { URLS, MOBILE_PROFILES, DESKTOP_PROFILES } from "./config.js";
import { submitMobileTest, waitForReport } from "./speedlab-api.js";
import { runDesktopTest } from "./automate-desktop.js";
import { extractMetrics, saveResults, printSummary } from "./reporter.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Parse --iphone / --galaxy / --desktop flags
const args = process.argv.slice(2);
const FLAG_IPHONE  = args.includes("--iphone");
const FLAG_GALAXY  = args.includes("--galaxy");
const FLAG_DESKTOP = args.includes("--desktop");
const FLAG_ALL     = !FLAG_IPHONE && !FLAG_GALAXY && !FLAG_DESKTOP;

const USERNAME = process.env.BROWSERSTACK_USERNAME;
const ACCESS_KEY = process.env.BROWSERSTACK_ACCESS_KEY;
const REGION = process.env.SPEEDLAB_REGION ?? "usw";
const MOBILE_NETWORK = process.env.MOBILE_NETWORK ?? "4g_normal";

if (!USERNAME || !ACCESS_KEY) {
  console.error("Error: BROWSERSTACK_USERNAME and BROWSERSTACK_ACCESS_KEY must be set in .env");
  process.exit(1);
}

// ─── Mobile test runner (Speed Lab API) ────────────────────────────────────

async function runMobileTest({ url, profile }) {
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

// ─── Desktop test runner (BrowserStack Automate) ──────────────────────────

async function runDesktopTestWrapped({ url, profile }) {
  console.log(`  [Automate]  ${profile.label} — ${url}`);

  try {
    const metrics = await runDesktopTest({ username: USERNAME, accessKey: ACCESS_KEY, url, profile });
    return { url, profile: profile.label, source: "automate", reportId: null, metrics, error: null };
  } catch (err) {
    console.error(`  [Failed]    ${profile.label} — ${err.message}`);
    return { url, profile: profile.label, source: "automate", reportId: null, metrics: null, error: err.message };
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

  // Decide which profiles to run based on flags
  const mobileProfilesToRun = MOBILE_PROFILES.filter((p) => {
    if (FLAG_ALL)    return true;
    if (FLAG_IPHONE) return p.label === "iPhone 12";
    if (FLAG_GALAXY) return p.label === "Samsung Galaxy S10";
    return false;
  });

  const runDesktop = FLAG_ALL || FLAG_DESKTOP;

  const mobileTasks = URLS.flatMap((url) =>
    mobileProfilesToRun.map((profile) => () => runMobileTest({ url, profile }))
  );

  const desktopTasks = runDesktop
    ? URLS.flatMap((url) => DESKTOP_PROFILES.map((profile) => () => runDesktopTestWrapped({ url, profile })))
    : [];

  const totalTests = mobileTasks.length + desktopTasks.length;
  const mode = FLAG_IPHONE ? "--iphone" : FLAG_GALAXY ? "--galaxy" : FLAG_DESKTOP ? "--desktop" : "full";

  console.log(`\nBrowserStack Weekly Performance Run`);
  console.log(`Date:    ${runDate}  Mode: ${mode}`);
  console.log(`Region:  ${REGION}`);
  console.log(`Total:   ${totalTests} tests (${mobileTasks.length} mobile + ${desktopTasks.length} desktop)\n`);

  // Mobile: must run one at a time — Speed Lab quota: 1 concurrent per account
  if (mobileTasks.length > 0) {
    console.log("── Mobile (Speed Lab) ─────────────────────────────────────────");
  }
  const mobileResults = await runBatch(mobileTasks, 1);

  // Desktop: 2 concurrent sessions
  if (desktopTasks.length > 0) {
    console.log("\n── Desktop (Automate) ─────────────────────────────────────────");
  }
  const desktopResults = await runBatch(desktopTasks, 2);

  const allResults = [...mobileResults, ...desktopResults];
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
