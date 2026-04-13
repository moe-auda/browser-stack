// URLs to test
export const URLS = [
  "https://www.pressreader.com",
  "https://www.pressreader.com/usa/usa-today-us-edition/20241113/281535116518251",
  "https://www.pressreader.com/catalog",
  "https://www.pressreader.com/newspapers/n/the-wall-street-journal",
];

// Mobile profiles — tested via BrowserStack Speed Lab API
// Field names and values must match exactly what /meta/devices returns (lowercase, integer os_version)
export const MOBILE_PROFILES = [
  {
    label: "iPhone 12",
    device: { os: "ios", os_version: 14, device: "iphone 12" },
  },
  {
    label: "Samsung Galaxy S10",
    device: { os: "android", os_version: 9, device: "samsung galaxy s10" },
  },
];

// Desktop profiles — tested via BrowserStack Speed Lab API
// Field names and values must match exactly what /meta/desktops returns (lowercase)
export const DESKTOP_PROFILES = [
  {
    label: "OS X Big Sur — Safari",
    browser: { os: "os x", os_version: "big sur", browser_name: "safari", browser_version: 14 },
  },
  {
    label: "Windows 11 — Chrome",
    browser: { os: "windows", os_version: "11", browser_name: "chrome", browser_version: 109 },
    // Speed Lab Lighthouse consistently fails on pressreader.com (service worker interference,
    // all 5 runs return perf=-1). Run Lighthouse directly in GitHub Actions instead.
    useLighthouse: true,
  },
];
