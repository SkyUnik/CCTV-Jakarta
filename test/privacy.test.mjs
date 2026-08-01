import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("browser code neither stores nor transmits geolocation", async () => {
  const app = await readFile(new URL("../docs/js/app.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(app, /localStorage|sessionStorage|indexedDB|sendBeacon|XMLHttpRequest|WebSocket/);
  const fetchTargets = [...app.matchAll(/fetch\((['"])(.*?)\1/g)].map((match) => match[2]);
  assert.deepEqual(fetchTargets.sort(), ["./data/cameras.json", "./data/highways.geojson"]);
});

test("mobile CSS retains full-width launch controls and compact breakpoints", async () => {
  const css = await readFile(new URL("../docs/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.launch-player \.button\s*{\s*width:\s*100%/);
  assert.match(css, /@media \(max-width: 520px\)/);
  assert.match(css, /min-width:\s*320px/);
});

test("compatibility report contains playlist checks only", async () => {
  const report = JSON.parse(
    await readFile(new URL("../docs/data/stream-compatibility.json", import.meta.url), "utf8"),
  );
  assert.match(report.scope, /no media segments requested/i);
  assert.equal(report.summary.uniqueStreams, report.checks.length);
  assert.ok(report.checks.length > 0);
  for (const check of report.checks) {
    assert.match(check.url, /^https:\/\/.*\.m3u8(?:\?|$)/i);
    assert.equal("body" in check, false);
  }
});
