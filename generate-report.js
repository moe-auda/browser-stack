/**
 * BrowserStack Performance Report Generator
 *
 * - Groups daily result files into calendar weeks (Week 1, Week 2 …)
 *   so split runs (mobile one day, desktop another) merge cleanly.
 * - Calculates a 0–100 Performance Score per (url, profile) entry,
 *   shown as the primary metric in every table and chart.
 * - Secondary metrics (FCP, LCP, TBT, TTI, Load, SI) remain visible
 *   but are visually de-emphasised.
 *
 * Usage: node generate-report.js   (also called by run-tests.js)
 * Output: results/report.html
 */

import fs from "fs";
import path from "path";

const RESULTS_DIR = "./results";
const REPORT_FILE = path.join(RESULTS_DIR, "report.html");

const URLS = [
  "https://www.pressreader.com",
  "https://www.pressreader.com/usa/usa-today-us-edition/20241113/281535116518251",
  "https://www.pressreader.com/catalog",
  "https://www.pressreader.com/newspapers/n/the-wall-street-journal",
];

const URL_LABELS = {
  "https://www.pressreader.com": "PressReader Home",
  "https://www.pressreader.com/usa/usa-today-us-edition/20241113/281535116518251": "USA Today Edition",
  "https://www.pressreader.com/catalog": "Catalog",
  "https://www.pressreader.com/newspapers/n/the-wall-street-journal": "Wall Street Journal",
};

const PROFILES = ["iPhone 12", "Samsung Galaxy S10", "OS X Big Sur — Safari", "Windows 11 — Chrome"];

const PROFILE_COLORS = {
  "iPhone 12":                 { border: "#007AFF", background: "rgba(0,122,255,0.12)" },
  "Samsung Galaxy S10":        { border: "#27AE60", background: "rgba(39,174,96,0.12)" },
  "OS X Big Sur — Safari":     { border: "#FF9500", background: "rgba(255,149,0,0.12)" },
  "Windows 11 — Chrome":       { border: "#E74C3C", background: "rgba(231,76,60,0.12)" },
};

// Secondary metrics shown in the detail table
const METRICS = [
  { key: "firstContentfulPaint",  label: "First Contentful Paint",  abbr: "FCP",  unit: "ms", good: 1800, warn: 3000 },
  { key: "largestContentfulPaint",label: "Largest Contentful Paint", abbr: "LCP",  unit: "ms", good: 2500, warn: 4000 },
  { key: "totalBlockingTime",     label: "Total Blocking Time",      abbr: "TBT",  unit: "ms", good: 200,  warn: 600  },
  { key: "timeToInteractive",     label: "Time to Interactive",      abbr: "TTI",  unit: "ms", good: 3800, warn: 7300 },
  { key: "pageLoadTime",          label: "Page Load Time",           abbr: "Load", unit: "ms", good: 2000, warn: 5000, desktopOnly: true },
  { key: "speedIndex",            label: "Speed Index",              abbr: "SI",   unit: "ms", good: 3400, warn: 5800 },
];

const CWV_KEYS = new Set(["firstContentfulPaint", "largestContentfulPaint", "totalBlockingTime"]);

// Score weights — raw points (redistributed proportionally when a metric is null)
// Calibrated to approximate SpeedLab's Lighthouse-based scores.
const SCORE_DEFS = [
  { key: "firstContentfulPaint",  good: 1800, warn: 3000, w: 10 },
  { key: "largestContentfulPaint",good: 2500, warn: 4000, w: 25 },
  { key: "timeToInteractive",     good: 3800, warn: 7300, w: 10 },
  { key: "totalBlockingTime",     good: 200,  warn: 600,  w:  5 },
  { key: "speedIndex",            good: 3400, warn: 5800, w: 30 },
  { key: "pageLoadTime",          good: 2000, warn: 5000, w: 20 },
];

// ─── Week utilities ──────────────────────────────────────────────────────────

function isoWeekKey(dateStr) {
  const d = new Date(dateStr + "T12:00:00Z");
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day); // Thursday in the target week
  const year = d.getUTCFullYear();
  const startOfYear = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil(((d - startOfYear) / 86400000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

function weekDateRange(weekKey) {
  const [yearStr, wStr] = weekKey.split("-W");
  const year = parseInt(yearStr, 10);
  const week = parseInt(wStr, 10);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dayOfWeek = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - dayOfWeek + 1 + (week - 1) * 7);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  const fmt = (d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `${fmt(monday)} – ${fmt(sunday)}`;
}

function groupByWeek(byDate) {
  const byWeek = {};
  for (const [date, entries] of Object.entries(byDate)) {
    const key = isoWeekKey(date);
    if (!byWeek[key]) byWeek[key] = [];
    byWeek[key].push(...(entries ?? []));
  }
  return byWeek;
}

// ─── Performance Score ───────────────────────────────────────────────────────

function scoreOneMetric(value, good, warn) {
  if (value == null) return null;
  if (value <= good) return Math.round(90 + 10 * (1 - value / good));
  if (value <= warn) return Math.round(50 + 40 * (1 - (value - good) / (warn - good)));
  return Math.max(1, Math.round(50 * Math.exp(-2 * (value - warn) / warn)));
}

function calculateScore(metrics) {
  if (!metrics) return null;
  let totalW = 0, sum = 0;
  for (const { key, good, warn, w } of SCORE_DEFS) {
    const s = scoreOneMetric(metrics[key], good, warn);
    if (s != null) { sum += s * w; totalW += w; }
  }
  return totalW === 0 ? null : Math.round(sum / totalW);
}

// Returns true only if the entry has at least one non-null metric value.
function hasAnyMetric(entry) {
  return entry.metrics != null && Object.values(entry.metrics).some((v) => v != null);
}

// Use BrowserStack's own score for Speed Lab runs; fall back to calculated for desktop.
function getScore(entry) {
  if (!entry?.metrics) return null;
  if (entry.metrics.browserPerformanceScore != null) return entry.metrics.browserPerformanceScore;
  return calculateScore(entry.metrics);
}

function scoreLabel(score) {
  if (score == null) return "score-na";
  if (score >= 75) return "score-good";
  if (score >= 50) return "score-warn";
  return "score-bad";
}

// ─── Load result files ───────────────────────────────────────────────────────

function loadAllResults() {
  const byDate = {};
  for (const f of fs.readdirSync(RESULTS_DIR).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort()) {
    try {
      byDate[f.replace(".json", "")] = JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, f), "utf-8"));
    } catch { /* skip malformed */ }
  }
  return byDate;
}

// ─── Build chart datasets (week-based) ───────────────────────────────────────

function buildChartData(byWeek, weekKeys, weekLabels, targetUrl, metricKey, desktopOnly) {
  const isScore = metricKey === "performanceScore";
  const datasets = PROFILES.map((profile) => {
    const data = weekKeys.map((wk) => {
      const entry = (byWeek[wk] ?? []).find(
        (e) => e.url === targetUrl && e.profile === profile && hasAnyMetric(e)
      );
      if (!entry) return null;
      return isScore ? getScore(entry) : (entry.metrics[metricKey] ?? null);
    });
    const c = PROFILE_COLORS[profile];
    return { label: profile, data, borderColor: c.border, backgroundColor: c.background,
             borderWidth: 2, pointRadius: 4, pointHoverRadius: 6, tension: 0.3, spanGaps: true };
  });
  // For desktop-only metrics, drop profiles that have no data at all.
  if (desktopOnly) {
    return { labels: weekLabels, datasets: datasets.filter((ds) => ds.data.some((v) => v != null)) };
  }
  return { labels: weekLabels, datasets };
}

// ─── Latest scores (from most-recent data per url/profile across all weeks) ──

function buildLatestScores(byWeek, weekKeys) {
  const best = {};
  for (const wk of weekKeys) {
    for (const entry of byWeek[wk] ?? []) {
      const key = `${entry.url}||${entry.profile}`;
      if (!best[key] || hasAnyMetric(entry)) best[key] = entry;
    }
  }

  return URLS.map((url) => {
    const profiles = PROFILES.map((profile) => {
      const entry = best[`${url}||${profile}`];
      const m = entry?.metrics ?? null;
      const score = getScore(entry);
      return {
        profile, score,
        metrics: METRICS.reduce((acc, { key }) => { acc[key] = m?.[key] ?? null; return acc; }, {}),
        error: entry?.error ?? null,
      };
    });
    const valid = profiles.filter((p) => p.score != null).map((p) => p.score);
    const avgScore = valid.length ? Math.round(valid.reduce((a, b) => a + b) / valid.length) : null;
    return { url, label: URL_LABELS[url], profiles, avgScore };
  });
}

// ─── HTML helpers ─────────────────────────────────────────────────────────────

function ms(val) {
  if (val == null) return `<span class="na">—</span>`;
  return `${val.toLocaleString()}<span class="unit">ms</span>`;
}

function metricClass(val, good, warn) {
  if (val == null) return "score-na";
  if (val <= good) return "score-good";
  if (val <= warn) return "score-warn";
  return "score-bad";
}

// ─── HTML generation ──────────────────────────────────────────────────────────

function generateHtml(byDate) {
  const byWeek    = groupByWeek(byDate);
  const weekKeys  = Object.keys(byWeek).sort();
  const weekLabels= weekKeys.map((k, i) => `Week ${i + 1} (${weekDateRange(k)})`);
  const weekCount = weekKeys.length;
  const latestKey = weekKeys[weekKeys.length - 1] ?? "";
  const latestLabel  = weekLabels[weekLabels.length - 1] ?? "No data";
  const latestRange  = latestKey ? weekDateRange(latestKey) : "";

  const latestScores = buildLatestScores(byWeek, weekKeys);

  // ── Charts: Performance Score (full-width) + 6 secondary (3 rows × 2) ──
  const CHART_DEFS = [
    { key: "performanceScore", label: "Performance Score (0–100)", isScore: true,  full: true  },
    ...METRICS.map((m) => ({ key: m.key, label: `${m.label} (ms)${m.desktopOnly ? " — Desktop Only" : ""}`, isScore: false, full: false, desktopOnly: m.desktopOnly ?? false })),
  ];

  const charts = [];
  for (const url of URLS) {
    for (const def of CHART_DEFS) {
      const id   = `chart_${charts.length}`;
      const data = buildChartData(byWeek, weekKeys, weekLabels, url, def.key, def.desktopOnly);
      charts.push({ id, url, urlLabel: URL_LABELS[url], ...def, data });
    }
  }

  // Chart init scripts
  const chartScripts = charts.map(({ id, label, data, isScore }) => `
    new Chart(document.getElementById('${id}'), {
      type: 'line',
      data: ${JSON.stringify(data)},
      options: {
        responsive: true,
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } },
          tooltip: {
            callbacks: {
              label: ctx => ctx.parsed.y != null
                ? ctx.dataset.label + ': ' + ctx.parsed.y.toLocaleString()${isScore ? "" : " + ' ms'"}
                : ctx.dataset.label + ': n/a'
            }
          }
        },
        scales: {
          x: { title: { display: true, text: 'Week' }, ticks: { font: { size: 11 } } },
          y: {
            title: { display: true, text: '${label.replace(/'/g, "\\'")}' },
            beginAtZero: ${isScore ? "true" : "false"},
            ${isScore ? "min: 0, max: 100," : ""}
            ticks: { callback: v => v.toLocaleString()${isScore ? "" : " + ' ms'"}, font: { size: 11 } }
          }
        }
      }
    });`).join("\n");

  // Table header
  const cwvCols  = METRICS.filter((m) => CWV_KEYS.has(m.key));
  const loadCols = METRICS.filter((m) => !CWV_KEYS.has(m.key));
  const tableHeader = `
    <thead>
      <tr class="group-row">
        <th rowspan="2" class="col-profile">Profile</th>
        <th rowspan="2" class="col-score-head">Score</th>
        <th colspan="${cwvCols.length}" class="group-cwv">Core Web Vitals</th>
        <th colspan="${loadCols.length}" class="group-load">Page Timing</th>
      </tr>
      <tr class="metric-row">
        ${cwvCols.map((m) => `<th title="${m.label}">${m.abbr}</th>`).join("")}
        ${loadCols.map((m) => `<th title="${m.label}">${m.abbr}</th>`).join("")}
      </tr>
    </thead>`;

  // Score blocks (one per URL)
  const scoreBlocks = latestScores.map(({ label, url, profiles, avgScore }) => `
    <div class="score-block">
      <div class="score-block-header">
        <div>
          <h3>${label}</h3>
          <span class="url-pill">${url.replace("https://", "")}</span>
        </div>
        <div class="avg-score-wrap">
          <div class="avg-score ${scoreLabel(avgScore)}" title="Average score across all platforms">${avgScore ?? "—"}</div>
          <div class="avg-score-lbl">avg score</div>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          ${tableHeader}
          <tbody>
            ${profiles.map(({ profile, score, metrics, error }) => {
              if (error) return `<tr class="row-error">
                <td class="col-profile">${profile}</td>
                <td class="score-cell"><div class="perf-score score-na">—</div></td>
                <td colspan="${METRICS.length}" class="error-cell">Quota exceeded — retry tomorrow</td>
              </tr>`;
              const metricCells = METRICS.map(({ key, good, warn }) =>
                `<td class="${metricClass(metrics[key], good, warn)}">${ms(metrics[key])}</td>`
              ).join("");
              return `<tr>
                <td class="col-profile">${profile}</td>
                <td class="score-cell"><div class="perf-score ${scoreLabel(score)}">${score ?? "—"}</div></td>
                ${metricCells}
              </tr>`;
            }).join("\n")}
          </tbody>
        </table>
      </div>
    </div>`).join("\n");

  // Chart sections per URL
  const chartSections = URLS.map((url) => {
    const urlCharts = charts.filter((c) => c.url === url);
    const scoreChart = urlCharts.find((c) => c.key === "performanceScore");
    const secCharts  = urlCharts.filter((c) => c.key !== "performanceScore");

    const rows = [];
    for (let i = 0; i < secCharts.length; i += 2) {
      const pair = secCharts.slice(i, i + 2);
      rows.push(`<div class="charts-row">${pair.map(({ id, label }) =>
        `<div class="chart-wrap"><h4>${label}</h4><canvas id="${id}"></canvas></div>`
      ).join("")}</div>`);
    }

    return `
      <section class="url-section">
        <div class="url-section-header">
          <h2>${URL_LABELS[url]}</h2>
          <span class="url-pill">${url.replace("https://", "")}</span>
        </div>
        <div class="chart-wrap chart-full">
          <h4>${scoreChart.label}</h4>
          <canvas id="${scoreChart.id}"></canvas>
        </div>
        ${rows.join("\n")}
      </section>`;
  }).join("\n");

  // Threshold legend
  const legendRows = METRICS.map(({ abbr, label, good, warn }) =>
    `<tr>
      <td><strong>${abbr}</strong> <span class="legend-name">${label}</span></td>
      <td class="score-good">≤ ${good.toLocaleString()} ms</td>
      <td class="score-warn">≤ ${warn.toLocaleString()} ms</td>
      <td class="score-bad">&gt; ${warn.toLocaleString()} ms</td>
    </tr>`
  ).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>BrowserStack Performance Report — PressReader</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js"></script>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      margin: 0; padding: 0; background: #f0f2f5; color: #1a1a2e; font-size: 14px;
    }

    /* ── Header ── */
    header {
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 60%, #0f3460 100%);
      color: #fff; padding: 2rem 2.5rem;
    }
    header h1 { margin: 0 0 0.2rem; font-size: 1.5rem; font-weight: 700; letter-spacing: -0.01em; }
    header .subtitle { margin: 0 0 1.25rem; opacity: 0.6; font-size: 0.875rem; }
    .meta { display: flex; gap: 1rem; flex-wrap: wrap; }
    .meta-item {
      background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.15);
      border-radius: 10px; padding: 0.6rem 1.1rem; min-width: 100px;
    }
    .meta-item .val { font-size: 1.35rem; font-weight: 700; line-height: 1; }
    .meta-item .lbl { font-size: 0.7rem; opacity: 0.6; margin-top: 0.15rem; text-transform: uppercase; letter-spacing: 0.05em; }

    /* ── Layout ── */
    main { max-width: 1440px; margin: 0 auto; padding: 2rem 1.5rem; }
    .section-title {
      font-size: 1.1rem; font-weight: 700; color: #1a1a2e;
      margin: 0 0 0.3rem;
      display: flex; align-items: center; gap: 0.5rem;
    }
    .section-title::after {
      content: ''; flex: 1; height: 2px;
      background: linear-gradient(to right, #e0e0e0, transparent); border-radius: 2px;
    }
    .section-desc { font-size: 0.78rem; color: #888; margin: 0 0 1.25rem; }

    /* ── Score blocks grid ── */
    .scores-grid {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(560px, 1fr));
      gap: 1.25rem; margin-bottom: 2.5rem;
    }
    .score-block {
      background: #fff; border-radius: 14px; padding: 1.25rem 1.5rem;
      box-shadow: 0 1px 4px rgba(0,0,0,0.06), 0 4px 16px rgba(0,0,0,0.04);
    }
    .score-block-header {
      display: flex; justify-content: space-between; align-items: flex-start;
      margin-bottom: 1rem; gap: 0.75rem;
    }
    .score-block-header h3 { margin: 0 0 0.2rem; font-size: 0.95rem; font-weight: 700; }

    /* Average score badge in card header */
    .avg-score-wrap { text-align: center; flex-shrink: 0; }
    .avg-score {
      width: 58px; height: 58px; border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-size: 1.25rem; font-weight: 900; color: #fff; margin: 0 auto;
    }
    .avg-score-lbl { font-size: 0.62rem; color: #aaa; margin-top: 0.25rem;
                     text-transform: uppercase; letter-spacing: 0.05em; }

    /* Per-row score badge in table */
    .perf-score {
      width: 40px; height: 40px; border-radius: 50%; margin: 0 auto;
      display: flex; align-items: center; justify-content: center;
      font-size: 0.88rem; font-weight: 800; color: #fff;
    }
    /* Circle backgrounds — scoped so they don't bleed onto metric cells */
    .perf-score.score-good, .avg-score.score-good { background: #1a9e4f; color: #fff !important; }
    .perf-score.score-warn, .avg-score.score-warn { background: #d97706; color: #fff !important; }
    .perf-score.score-bad,  .avg-score.score-bad  { background: #dc2626; color: #fff !important; }
    .perf-score.score-na,   .avg-score.score-na   { background: #ddd; color: #999 !important; font-size: 0.75rem !important; font-weight: 600 !important; }

    /* URL pill */
    .url-pill {
      font-size: 0.7rem; color: #888; background: #f5f5f5; border-radius: 20px;
      padding: 0.15rem 0.6rem; white-space: nowrap; overflow: hidden;
      text-overflow: ellipsis; max-width: 340px; display: inline-block;
    }

    /* ── Table ── */
    .table-wrap { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 0.79rem; table-layout: fixed; }

    .group-row th { padding: 5px 6px; font-size: 0.68rem; font-weight: 700;
                    text-transform: uppercase; letter-spacing: 0.06em; border-bottom: none; }
    .group-cwv  { background: #eef6ff; color: #1a6bc4; text-align: center; }
    .group-load { background: #f3f0ff; color: #6b3fa0; text-align: center; }

    .metric-row th {
      padding: 5px 6px; color: #555; font-weight: 600;
      border-bottom: 2px solid #f0f0f0; text-align: right;
      font-size: 0.74rem; white-space: nowrap;
    }
    .metric-row th[title] { cursor: help; text-decoration: underline dotted #bbb; }

    td { padding: 6px 6px; border-bottom: 1px solid #f5f5f5; text-align: right; white-space: nowrap; }
    tr:last-child td { border-bottom: none; }
    .col-profile { text-align: left !important; width: 20%; white-space: normal;
                   word-break: break-word; line-height: 1.4; color: #333; }
    .col-score-head { text-align: center !important; width: 9%; font-size: 0.68rem;
                      font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;
                      color: #555; padding: 5px 6px; border-bottom: 2px solid #f0f0f0; }
    .score-cell { text-align: center !important; padding: 5px 4px !important; }

    /* Secondary metric text colours (td cells only — no background) */
    .score-good { color: #1a9e4f; font-weight: 600; }
    .score-warn { color: #d97706; font-weight: 600; }
    .score-bad  { color: #dc2626; font-weight: 600; }
    .score-na   { color: #ccc; }

    /* Make secondary metric text smaller / lighter to de-emphasise */
    td:not(.score-cell):not(.col-profile) { font-size: 0.75rem; opacity: 0.85; }

    .unit { font-size: 0.66rem; color: #bbb; margin-left: 1px; }
    .na   { color: #ccc; }

    .row-error td { color: #bbb; font-style: italic; }
    .error-cell { text-align: left !important; font-size: 0.74rem; white-space: normal; }

    /* ── Threshold legend ── */
    .legend-block {
      background: #fff; border-radius: 14px; padding: 1.1rem 1.5rem;
      box-shadow: 0 1px 4px rgba(0,0,0,0.06); margin-bottom: 2.5rem;
    }
    .legend-block table { font-size: 0.78rem; }
    .legend-block th {
      font-size: 0.7rem; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.05em; color: #999; padding: 4px 10px;
      border-bottom: 2px solid #f0f0f0; text-align: left;
    }
    .legend-block td { padding: 5px 10px; text-align: left; font-size: 0.78rem; opacity: 1; }
    .legend-name { color: #999; font-weight: 400; margin-left: 0.3rem; }

    /* ── Chart sections ── */
    .url-section {
      background: #fff; border-radius: 14px; padding: 1.5rem; margin-bottom: 1.5rem;
      box-shadow: 0 1px 4px rgba(0,0,0,0.06), 0 4px 16px rgba(0,0,0,0.04);
    }
    .url-section-header {
      display: flex; align-items: baseline; gap: 0.75rem;
      margin-bottom: 1.25rem; flex-wrap: wrap;
    }
    .url-section-header h2 { margin: 0; font-size: 1rem; font-weight: 700; }
    .charts-row {
      display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin-top: 1.25rem;
    }
    .chart-wrap h4 {
      font-size: 0.72rem; margin: 0 0 0.4rem; color: #777;
      text-transform: uppercase; letter-spacing: 0.05em;
    }
    .chart-wrap canvas { max-height: 220px; }
    .chart-full { margin-top: 0; }
    .chart-full canvas { max-height: 240px; }

    /* ── Footer ── */
    footer { text-align: center; color: #bbb; font-size: 0.75rem; padding: 1.5rem 2rem 2rem; }

    /* ── Responsive ── */
    @media (max-width: 1024px) { .scores-grid { grid-template-columns: 1fr; } }
    @media (max-width: 700px)  { .charts-row { grid-template-columns: 1fr; } .meta { gap: 0.6rem; } header { padding: 1.5rem; } }
  </style>
</head>
<body>

<header>
  <h1>BrowserStack Performance Report</h1>
  <p class="subtitle">PressReader — Weekly Speed Tests</p>
  <div class="meta">
    <div class="meta-item"><div class="val">${weekCount}</div><div class="lbl">Weeks of Data</div></div>
    <div class="meta-item"><div class="val">${latestLabel}</div><div class="lbl">Latest Week</div></div>
    <div class="meta-item"><div class="val">${latestRange}</div><div class="lbl">Date Range</div></div>
    <div class="meta-item"><div class="val">4</div><div class="lbl">URLs Tested</div></div>
    <div class="meta-item"><div class="val">4</div><div class="lbl">Platforms</div></div>
  </div>
</header>

<main>
  <section>
    <p class="section-title">Current Scores <span style="font-size:0.8rem;font-weight:400;color:#888">— ${latestLabel} (${latestRange})</span></p>
    <p class="section-desc">Performance Score (0–100) is the primary metric — higher is better. Secondary metrics are shown for reference. Hover column headers for full names.</p>
    <div class="scores-grid">${scoreBlocks}</div>
  </section>

  <section>
    <p class="section-title">Metric Thresholds</p>
    <div class="legend-block">
      <table>
        <thead>
          <tr>
            <th>Metric</th>
            <th class="score-good">Good</th>
            <th class="score-warn">Needs Work</th>
            <th class="score-bad">Poor</th>
          </tr>
        </thead>
        <tbody>${legendRows}</tbody>
      </table>
    </div>
  </section>

  <section>
    <p class="section-title">Timeline — Week by Week</p>
    <p class="section-desc">Performance Score trend is shown first. Secondary metric trends follow. X-axis labels are calendar weeks.</p>
    ${chartSections}
  </section>
</main>

<footer>Generated ${new Date().toISOString()} &nbsp;·&nbsp; BrowserStack Speed Lab + Automate &nbsp;·&nbsp; Data in results/all-results.csv</footer>

<script>
${chartScripts}
</script>
</body>
</html>`;
}

// ─── Main ────────────────────────────────────────────────────────────────────

const byDate = loadAllResults();
const html   = generateHtml(byDate);
fs.writeFileSync(REPORT_FILE, html);
console.log(`Report updated: ${REPORT_FILE}`);
