import fs from "fs";
import path from "path";

const RESULTS_DIR = "./results";

/**
 * Extract the key performance metrics from a Speed Lab report response.
 */
export function extractMetrics(report) {
  const r = report.results ?? {};
  const visual = r.visual_metrics ?? {};
  const nav = r.navigation_timings ?? {};

  return {
    pageLoadTime: r.page_load_time_ms ?? null,
    firstContentfulPaint: visual.first_contentful_paint_ms ?? null,
    largestContentfulPaint: visual.largest_contentful_paint_ms ?? null,
    timeToInteractive: visual.time_to_interactive_ms ?? null,
    totalBlockingTime: visual.total_blocking_time_ms ?? null,
    speedIndex: visual.speed_index_ms ?? null,
  };
}

/**
 * Save the full weekly run to a timestamped JSON file and append a CSV row.
 */
export function saveResults(runDate, allResults) {
  if (!fs.existsSync(RESULTS_DIR)) {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
  }

  // Full JSON dump
  const jsonFile = path.join(RESULTS_DIR, `${runDate}.json`);
  fs.writeFileSync(jsonFile, JSON.stringify(allResults, null, 2));

  // Append to cumulative CSV
  const csvFile = path.join(RESULTS_DIR, "all-results.csv");
  const csvExists = fs.existsSync(csvFile);

  const header =
    "date,url,profile,pageLoadTime_ms,firstContentfulPaint_ms,largestContentfulPaint_ms," +
    "timeToInteractive_ms,totalBlockingTime_ms,speedIndex_ms,reportId,error\n";

  const rows = allResults
    .map((r) => {
      const m = r.metrics ?? {};
      return [
        runDate,
        `"${r.url}"`,
        `"${r.profile}"`,
        m.pageLoadTime ?? "",
        m.firstContentfulPaint ?? "",
        m.largestContentfulPaint ?? "",
        m.timeToInteractive ?? "",
        m.totalBlockingTime ?? "",
        m.speedIndex ?? "",
        r.reportId ?? "",
        r.error ? `"${r.error}"` : "",
      ].join(",");
    })
    .join("\n");

  if (!csvExists) fs.appendFileSync(csvFile, header);
  fs.appendFileSync(csvFile, rows + "\n");

  return { jsonFile, csvFile };
}

/**
 * Print a readable summary to stdout.
 */
export function printSummary(runDate, allResults) {
  console.log(`\n${"=".repeat(70)}`);
  console.log(`BrowserStack Weekly Performance Run — ${runDate}`);
  console.log(`${"=".repeat(70)}\n`);

  for (const r of allResults) {
    console.log(`URL:     ${r.url}`);
    console.log(`Profile: ${r.profile}  [${r.source ?? "speedlab"}]`);

    if (r.error) {
      console.log(`Status:  FAILED — ${r.error}`);
    } else {
      const m = r.metrics;
      const id = r.reportId ? `report=${r.reportId}` : "automate session";
      console.log(`Status:  OK  (${id})`);
      console.log(`  Page Load Time:          ${fmt(m.pageLoadTime)} ms`);
      console.log(`  First Contentful Paint:  ${fmt(m.firstContentfulPaint)} ms`);
      console.log(`  Largest Contentful Paint:${fmt(m.largestContentfulPaint)} ms`);
      console.log(`  Time to Interactive:     ${fmt(m.timeToInteractive)} ms`);
      console.log(`  Total Blocking Time:     ${fmt(m.totalBlockingTime)} ms`);
      console.log(`  Speed Index:             ${fmt(m.speedIndex)} ms`);
    }
    console.log();
  }
}

function fmt(val) {
  return val != null ? val : "n/a";
}
