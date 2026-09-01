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
    "route-map",
    "map-expand-button",
    "map-close-button",
    "map-tile-status",
    "map-gps-button",
    "map-camera-card",
    "map-camera-list",
    "koja-quick-button",
    "jor-priuk-quick-button",
    "jor-priuk-overlay",
    "jor-priuk-close",
    "jor-priuk-video",
    "jor-priuk-status",
    "jor-priuk-play",
    "jor-priuk-fullscreen",
    "jor-priuk-retry",
    "quick-camera-overlay",
    "quick-camera-close",
    "quick-camera-video",
    "quick-camera-status",
    "quick-camera-play",
    "quick-camera-fullscreen",
    "quick-camera-retry",
  ]) {
    assert.equal($(`#${id}`).length, 1, `Missing unique #${id}`);
  }
  assert.equal($("#camera-video").is("[playsinline]"), true);
  assert.equal($("#camera-video").is("[disablepictureinpicture]"), false);
  assert.equal($("#camera-video").is("[muted]"), true);
  assert.equal($("#camera-video").is("[controls]"), true);
  assert.equal($("#camera-video").attr("preload"), "auto");
  assert.equal($("#camera-video").attr("x-webkit-airplay"), "allow");
  assert.equal($("#quick-camera-video").is("[disablepictureinpicture]"), false);
  assert.equal($("#jor-priuk-video").is("[disablepictureinpicture]"), false);
  assert.equal($("#jor-priuk-video").is("[playsinline]"), true);
  assert.equal($("#jor-priuk-video").is("[muted]"), true);
  assert.equal($("script[src^='http']").length, 0);
  assert.equal($("#map-toggle").is("[checked]"), true);
  assert.match($("#route-map").attr("aria-label"), /OpenStreetMap/i);
  assert.equal($("link[href^='http']").length, 0);
  assert.equal($("link[href='./vendor/leaflet/leaflet.css']").length, 1);
  assert.equal($("link[href='./vendor/leaflet-markercluster/MarkerCluster.css']").length, 1);
  assert.match($("link[href^='./styles.css']").attr("href"), /^\.\/styles\.css\?v=/);
  assert.match($("script[type='module']").attr("src"), /^\.\/js\/app\.mjs\?v=/);
  assert.equal($("script[src='./vendor/leaflet/leaflet.js']").length, 1);
  assert.equal($("script[src='./vendor/leaflet-markercluster/leaflet.markercluster.js']").length, 1);
  assert.equal($("#route-shortcut").is("button"), true);
  assert.match($("#route-shortcut").attr("aria-label"), /Langkah 1/i);
  assert.equal($("#route-shortcut").text().trim(), "#1");
  assert.equal($("#restart-button").is("[disabled]"), true);
  assert.match($("#tracking-indicator").text(), /Pelacakan kamera via GPS/i);
  assert.equal($("#tracking-indicator").attr("data-state"), "off");
  assert.equal($(".telemetry + .tracking-indicator-slot #tracking-indicator").length, 1);
});

test("start and floating shortcut smoothly reveal step one without delaying GPS", async () => {
  const app = await readFile(new URL("../docs/js/app.mjs", import.meta.url), "utf8");
  assert.match(app, /scrollIntoView\(\{[\s\S]*behavior:\s*reduceMotion\s*\?\s*"auto"\s*:\s*"smooth"/);
  assert.match(app, /elements\.start\.addEventListener\("click",\s*\(\)\s*=>\s*\{[\s\S]*if \(state\.simulator\) startSimulatorTracking\(\);\s*else startTracking\(\);\s*scrollToRoutePanel\(\);/);
  assert.match(app, /elements\.routeShortcut\.addEventListener\("click",\s*scrollToRoutePanel\)/);
  assert.match(app, /elements\.restart\.addEventListener\("click",\s*restartSavedSelection\)/);
  assert.match(app, /function restartSavedSelection\(\)[\s\S]*const savedSelection[\s\S]*stopTracking\(\);[\s\S]*void openVideoPlayer\(\);\s*if \(state\.simulator\) startSimulatorTracking\(\);\s*else if \(!state\.demo\) startTracking\(\);/);
  assert.match(app, /message = "Pelacakan kamera via GPS: aktif"/);
  assert.match(app, /async function playCamera\(camera, options = \{\}\)[\s\S]*resetPlayerLoad\(\);[\s\S]*state\.videoController\.load\(camera/);
  assert.doesNotMatch(app, /async function playCamera\(camera, options = \{\}\)[\s\S]{0,500}destroyPlayer\(/);
});

test("manual camera selection and playback synchronize the map marker", async () => {
  const source = await readFile(new URL("../docs/js/app.mjs", import.meta.url), "utf8");
  assert.match(source, /state\.routeMap\?\.selectCamera\(camera\.id\)/);
  assert.match(source, /manualCameraSelect\.addEventListener\("change", previewManualCameraOnMap\)/);
});

test("the shared simulator mode exposes road, position, direction, and speed controls", async () => {
  const html = await readFile(new URL("../docs/index.html", import.meta.url), "utf8");
  const source = await readFile(new URL("../docs/js/app.mjs", import.meta.url), "utf8");
  assert.match(html, /href="\.\/\?simulator=1"/);
  assert.match(html, /id="simulator-highway"/);
  assert.match(html, /id="simulator-position"[^>]+type="range"/);
  assert.match(html, /<option value="60">60 km\/jam<\/option>/);
  assert.match(html, /<option value="120">120 km\/jam<\/option>/);
  assert.match(html, /<option value="240">240 km\/jam<\/option>/);
  assert.match(source, /if \(state\.simulator\) startSimulatorTracking\(\)/);
  assert.match(source, /setInterval\(tickSimulator, 250\)/);
  const css = await readFile(new URL("../docs/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.simulator-link-card \.button\s*\{[^}]*display:\s*inline-flex;[^}]*align-items:\s*center;[^}]*justify-content:\s*center;/);
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

test("vendored map libraries and licenses are committed without CDN loading", async () => {
  const leaflet = await stat(new URL("../docs/vendor/leaflet/leaflet.js", import.meta.url));
  const leafletMap = await stat(new URL("../docs/vendor/leaflet/leaflet.js.map", import.meta.url));
  const cluster = await stat(new URL("../docs/vendor/leaflet-markercluster/leaflet.markercluster.js", import.meta.url));
  const clusterMap = await stat(new URL("../docs/vendor/leaflet-markercluster/leaflet.markercluster.js.map", import.meta.url));
  const leafletLicense = await readFile(new URL("../docs/vendor/leaflet/LICENSE.txt", import.meta.url), "utf8");
  const clusterLicense = await readFile(new URL("../docs/vendor/leaflet-markercluster/LICENSE.txt", import.meta.url), "utf8");
  assert.ok(leaflet.size > 100_000);
  assert.ok(leafletMap.size > 100_000);
  assert.ok(cluster.size > 20_000);
  assert.ok(clusterMap.size > 20_000);
  assert.match(leafletLicense, /BSD 2-Clause License/);
  assert.match(clusterLicense, /MIT License|Permission is hereby granted/);
  for (const asset of [
    "layers.png",
    "layers-2x.png",
    "marker-icon.png",
    "marker-icon-2x.png",
    "marker-shadow.png",
  ]) {
    const file = await stat(new URL(`../docs/vendor/leaflet/images/${asset}`, import.meta.url));
    assert.ok(file.size > 100, `${asset} must be vendored`);
  }
});

test("automatic switching data is either verified or explicitly provisional", async () => {
  const data = JSON.parse(
    await readFile(new URL("../docs/data/cameras.json", import.meta.url), "utf8"),
  );
  assert.ok(data.cameras.length > 0);
  const enabled = data.cameras.filter((camera) => camera.enabled);
  assert.equal(enabled.length, 96);
  assert.ok(enabled.every((camera) =>
    camera.curationStatus === "verified" ||
    (camera.curationStatus === "provisional_stationing" &&
      camera.locationReview?.status === "provisional") ||
    (camera.curationStatus === "provisional_landmark" &&
      camera.cameraType === "toll_gate" &&
      camera.locationReview?.status === "provisional")
  ));
});
