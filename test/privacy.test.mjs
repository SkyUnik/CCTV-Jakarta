import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("browser code neither stores nor transmits geolocation", async () => {
  const app = await readFile(new URL("../docs/js/app.mjs", import.meta.url), "utf8");
  const map = await readFile(new URL("../docs/js/offline-map.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(app, /localStorage|sessionStorage|indexedDB|sendBeacon|XMLHttpRequest|WebSocket/);
  assert.doesNotMatch(map, /fetch\(|localStorage|sessionStorage|indexedDB|sendBeacon|XMLHttpRequest|WebSocket/);
  const fetchTargets = [...app.matchAll(/fetch\((['"])(.*?)\1/g)].map((match) => match[2]);
  assert.deepEqual(fetchTargets.sort(), ["./data/cameras.json", "./data/highways.geojson"]);
});

test("mobile CSS retains full-width launch controls and compact breakpoints", async () => {
  const css = await readFile(new URL("../docs/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.launch-player \.button\s*{\s*width:\s*100%/);
  assert.match(css, /@media \(max-width: 520px\)/);
  assert.match(css, /min-width:\s*320px/);
  assert.match(css, /\.map-canvas\s*{[^}]*min-height:\s*230px/s);
  assert.match(css, /\.map-route-line/);
  assert.match(css, /\.map-marker-target/);
  assert.match(css, /#start-button\s*{[^}]*min-height:\s*64px/s);
  assert.match(css, /\.manual-camera-picker select\s*{[^}]*min-height:\s*68px/s);
  assert.match(css, /\.manual-camera-picker \.button\s*{[^}]*min-height:\s*60px/s);
  assert.match(css, /\.floating-actions\s*{[^}]*position:\s*fixed[^}]*right:[^}]*z-index:\s*1000/s);
  assert.match(css, /\.floating-action\s*{[^}]*border-radius:\s*50%/s);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /\.tracking-indicator-slot\s*{[^}]*padding-top:\s*20px/s);
  assert.match(css, /\.tracking-indicator\s*{[^}]*margin:\s*0/s);
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
