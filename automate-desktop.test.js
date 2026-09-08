import test from "node:test";
import assert from "node:assert/strict";
import { runDesktopTest } from "./automate-desktop.js";
import { MOBILE_PROFILES, DESKTOP_PROFILES } from "./config.js";

for (const scenario of ["iphone", "desktop", "navigation failure", "missing metrics"]) {
  test(scenario, async (t) => {
    const calls = [];
    t.mock.method(globalThis, "setTimeout", (fn) => { fn(); });
    t.mock.method(globalThis, "fetch", async (url, options) => {
      const body = options.body ? JSON.parse(options.body) : null;
      calls.push({ url, method: options.method, body });
      let value = null;
      if (url.endsWith("/session")) value = { sessionId: "test-session" };
      if (url.endsWith("/url") && scenario === "navigation failure") {
        return new Response("navigation failed", { status: 500 });
      }
      if (url.endsWith("/execute/sync")) {
        value = { value: body.script === "return document.readyState" ? "complete"
          : { pageLoadTime: scenario === "missing metrics" ? null : 123, firstContentfulPaint: null } };
      }
      return new Response(JSON.stringify(value));
    });
    const profile = scenario === "desktop" ? DESKTOP_PROFILES[0] : MOBILE_PROFILES[0];
    const run = runDesktopTest({ username: "test", accessKey: "test", url: "https://example.com", profile: { label: profile.label, ...profile.automate } });
    if (scenario === "navigation failure") await assert.rejects(run, /navigation failed/);
    else if (scenario === "missing metrics") await assert.rejects(run, /valid page load timing/);
    else assert.equal((await run).pageLoadTime, 123);
    const options = calls[0].body.desiredCapabilities["bstack:options"];
    if (scenario === "desktop") assert.equal(options.os, "OS X");
    else {
      assert.equal(options.deviceName, "iPhone 12");
      assert.equal(options.realMobile, true);
      assert.equal(options.os, undefined);
    }
    assert.equal(calls.at(-1).method, "DELETE");
    assert.equal(calls.at(-1).url.endsWith("/test-session"), true);
  });
}
