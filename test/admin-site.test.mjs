import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import * as cheerio from "cheerio";

test("local admin UI exposes audit, red-region, verification, and publish checkpoints", async () => {
  const html = await readFile(new URL("../admin/index.html", import.meta.url), "utf8");
  const $ = cheerio.load(html);
  for (const id of [
    "camera-list", "camera-form", "camera-id", "provider-id", "stream-url", "highway-id",
    "longitude", "latitude", "audit-video", "red-region", "region-direction", "region-left",
    "region-right", "region-confirm", "save-camera", "verify-camera", "delete-camera",
    "git-diff", "run-tests", "commit", "push", "map-body", "route-map", "map-toggle",
    "bulk-geocode", "bulk-gate-geocode", "save-pin-coords", "reset-pin-coords", "reload-video",
    "btn-rename-highway", "btn-bulk-direction", "btn-bulk-enable", "rename-highway-dialog",
    "bulk-direction-dialog", "bulk-enable-dialog", "btn-highway-health", "highway-health-dialog",
    "btn-check-duplicates", "duplicate-cameras-dialog", "inference-status", "json-diff-details",
    "json-diff-before", "json-diff-after", "gate-match-dialog", "frame-audit",
  ]) assert.equal($(`#${id}`).length, 1, `Missing #${id}`);
  assert.equal($("#audit-video").is("[disablepictureinpicture]"), false);
  assert.equal($("#camera-side option[value='A/B']").length, 1);
  assert.equal($(".help-accordion").length, 1);
  assert.equal($("script[src='/site/vendor/leaflet/leaflet.js']").length, 1);
  assert.equal($("script[src='/site/vendor/hls.min.js']").length, 1);
  assert.equal($("script[type='module'][src='./admin.mjs']").length, 1);
});

test("admin code keeps write UI outside the public GitHub Pages document", async () => {
  const publicHtml = await readFile(new URL("../docs/index.html", import.meta.url), "utf8");
  assert.doesNotMatch(publicHtml, /api\/admin|Local Camera Audit|admin\.mjs/);
});
