import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

import * as cheerio from "cheerio";

test("static page exposes the required accessible controls with relative assets", async () => {
  const html = await readFile(new URL("../docs/index.html", import.meta.url), "utf8");
  const $ = cheerio.load(html);
  for (const id of [
    "start-button",
    "route-panel",
    "route-shortcut",
    "restart-button",
    "tracking-indicator",
    "stop-button",
    "highway-list",
    "gps-debug-link",
    "direction-a",
    "direction-b",
    "camera-video",
    "previous-button",
    "next-button",
    "retry-button",
    "skip-button",
    "open-player-button",
    "manual-camera-picker",
    "manual-camera-select",
    "manual-camera-button",
    "map-toggle",
    "map-body",
    "route-map-svg",
    "map-gps-button",
    "map-camera-card",
    "map-camera-list",
  ]) {
    assert.equal($(`#${id}`).length, 1, `Missing unique #${id}`);
  }
  assert.equal($("#camera-video").attr("playsinline"), undefined);
  assert.equal($("#camera-video").is("[muted]"), true);
  assert.equal($("#camera-video").is("[controls]"), true);
  assert.equal($("#camera-video").attr("preload"), "metadata");
  assert.equal($("#camera-video").attr("x-webkit-airplay"), "allow");
  assert.equal($("script[src^='http']").length, 0);
  assert.equal($("#map-toggle").is("[checked]"), true);
  assert.match($("#route-map-svg").attr("aria-label"), /skematik/i);
  assert.equal($("link[rel='stylesheet']").attr("href"), "./styles.css");
  assert.match($("script[type='module']").attr("src"), /^\.\/js\/app\.mjs\?v=/);
  assert.equal($("#route-shortcut").is("button"), true);
  assert.match($("#route-shortcut").attr("aria-label"), /Langkah 1/i);
  assert.equal($("#route-shortcut").text().trim(), "#1");
  assert.equal($("#restart-button").is("[disabled]"), true);
  assert.match($("#tracking-indicator").text(), /Pelacakan kamera via GPS/i);
  assert.equal($("#tracking-indicator").attr("data-state"), "off");
});

test("start and floating shortcut smoothly reveal step one without delaying GPS", async () => {
  const app = await readFile(new URL("../docs/js/app.mjs", import.meta.url), "utf8");
  assert.match(app, /scrollIntoView\(\{[\s\S]*behavior:\s*reduceMotion\s*\?\s*"auto"\s*:\s*"smooth"/);
  assert.match(app, /elements\.start\.addEventListener\("click",\s*\(\)\s*=>\s*\{\s*\/\/[^\n]*\n\s*startTracking\(\);\s*scrollToRoutePanel\(\);/);
  assert.match(app, /elements\.routeShortcut\.addEventListener\("click",\s*scrollToRoutePanel\)/);
  assert.match(app, /elements\.restart\.addEventListener\("click",\s*restartSavedSelection\)/);
  assert.match(app, /function restartSavedSelection\(\)[\s\S]*const savedSelection[\s\S]*stopTracking\(\);[\s\S]*void openVideoPlayer\(\);\s*if \(!state\.demo\) startTracking\(\);/);
  assert.match(app, /message = "Pelacakan kamera via GPS: aktif"/);
});

test("standalone GPS diagnostic has no external dependencies or network code", async () => {
  const html = await readFile(new URL("../docs/gps-test.html", import.meta.url), "utf8");
  const $ = cheerio.load(html);
  assert.equal($("#test-button").length, 1);
  assert.match(html, /getCurrentPosition/);
  assert.match(html, /navigator\.permissions\.query/);
  assert.doesNotMatch(html, /fetch\(|XMLHttpRequest|sendBeacon|<script\s+src=/);
});

test("vendored HLS player and license are committed for offline site loading", async () => {
  const player = await stat(new URL("../docs/vendor/hls.min.js", import.meta.url));
  const license = await readFile(
    new URL("../docs/vendor/HLS-LICENSE.txt", import.meta.url),
    "utf8",
  );
  assert.ok(player.size > 100_000);
  assert.match(license, /Apache License/);
});

test("automatic switching data is either verified or explicitly provisional", async () => {
  const data = JSON.parse(
    await readFile(new URL("../docs/data/cameras.json", import.meta.url), "utf8"),
  );
  assert.ok(data.cameras.length > 0);
  const enabled = data.cameras.filter((camera) => camera.enabled);
  assert.equal(enabled.length, 46);
  assert.ok(enabled.every((camera) =>
    camera.curationStatus === "verified" ||
    (camera.curationStatus === "provisional_stationing" &&
      camera.locationReview?.status === "provisional")
  ));
});
