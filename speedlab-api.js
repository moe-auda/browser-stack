/**
 * BrowserStack Speed Lab API client (Beta)
 * Docs: https://www.browserstack.com/docs/speedlab/api
 *
 * Confirmed working format (verified against live API):
 *   - Mobile: use "device" key (singular object), "device_network" for throttling
 *   - Desktop: use "browser" key (singular object), no network throttling field
 *   - Device/browser names must be lowercase, os_version must be an integer
 */

const BASE_URL = "https://api.browserstack.com/speedlab/beta";
const POLL_INTERVAL_MS = 10_000;  // 10 seconds between status checks
const MAX_POLL_ATTEMPTS = 36;     // 6 minutes max wait per test
const RETRY_DELAY_MS = 30_000;    // wait 30s before retrying if another report is in progress
const MAX_SUBMIT_RETRIES = 10;    // retry up to 10 times (~5 min total)

function authHeader(username, accessKey) {
  return "Basic " + Buffer.from(`${username}:${accessKey}`).toString("base64");
}

/**
 * Submit a Speed Lab test for a mobile device or desktop browser and return the report_id.
 * Automatically retries if another report is already in progress (HTTP 423).
 *
 * For mobile profiles pass { deviceProfile: { device: {...} } } + network.
 * For desktop profiles pass { deviceProfile: { browser: {...} } } — no network field.
 */
export async function submitMobileTest({ username, accessKey, url, deviceProfile, network, region }) {
  const isMobile = !!deviceProfile.device;
  const body = {
    url,
    region,
    ...(isMobile
      ? { device: deviceProfile.device, device_network: network }
      : { browser: deviceProfile.browser }),
  };

  for (let attempt = 1; attempt <= MAX_SUBMIT_RETRIES; attempt++) {
    const response = await fetch(`${BASE_URL}/report`, {
      method: "POST",
      headers: {
        Authorization: authHeader(username, accessKey),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (data.success) {
      return data.report_id;
    }

    if (data.error === "ANOTHER_REPORT_IN_PROGRESS") {
      process.stdout.write(`  [Waiting for slot] attempt ${attempt}/${MAX_SUBMIT_RETRIES} — retrying in ${RETRY_DELAY_MS / 1000}s...\n`);
      await sleep(RETRY_DELAY_MS);
      continue;
    }

    throw new Error(`Submit failed [${response.status}]: ${JSON.stringify(data)}`);
  }

  throw new Error("Exceeded max retries waiting for a free Speed Lab slot");
}

/**
 * Poll until a report is complete, then return the result object.
 */
export async function waitForReport({ username, accessKey, reportId }) {
  for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt++) {
    await sleep(POLL_INTERVAL_MS);

    const response = await fetch(`${BASE_URL}/report/${reportId}`, {
      headers: { Authorization: authHeader(username, accessKey) },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Poll failed [${response.status}]: ${text}`);
    }

    const data = await response.json();

    if (data.status === "complete") {
      return data;
    }

    if (data.status === "failed") {
      throw new Error(`Report ${reportId} failed on BrowserStack side`);
    }

    // Still pending — loop
  }

  throw new Error(`Report ${reportId} did not complete within the timeout window`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
