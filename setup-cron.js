/**
 * Weekly cron scheduler — runs Speed Lab tests every Monday at 9:00 AM.
 *
 * Run this once to keep the cron alive in a long-running process (e.g. a server).
 * Alternatively, use the system crontab entry printed at the bottom instead.
 *
 * Usage:
 *   node setup-cron.js
 */

import cron from "node-cron";
import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// "0 9 * * 1" = Every Monday at 09:00
const SCHEDULE = "0 9 * * 1";

console.log("Speed Lab weekly scheduler started.");
console.log(`Schedule: ${SCHEDULE} (every Monday at 9:00 AM)`);
console.log("Waiting for next trigger...\n");

cron.schedule(SCHEDULE, () => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] Triggering weekly Speed Lab run...`);

  try {
    execSync(`node ${path.join(__dirname, "run-tests.js")}`, {
      stdio: "inherit",
      cwd: __dirname,
    });
    console.log(`[${timestamp}] Run complete.\n`);
  } catch (err) {
    console.error(`[${timestamp}] Run failed:`, err.message);
  }
}, {
  timezone: "America/New_York",
});

// ─────────────────────────────────────────────────────────────────────────────
// Alternative: system crontab (no long-running process required)
// ─────────────────────────────────────────────────────────────────────────────
console.log("─".repeat(60));
console.log("Alternatively, add this line to your system crontab");
console.log("(run: crontab -e):\n");
console.log(`0 9 * * 1  cd ${__dirname} && node run-tests.js >> ${__dirname}/results/cron.log 2>&1`);
console.log("─".repeat(60));
