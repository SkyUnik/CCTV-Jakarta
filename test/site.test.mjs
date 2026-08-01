import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

import * as cheerio from "cheerio";

test("static page exposes the required accessible controls with relative assets", async () => {
  const html = await readFile(new URL("../docs/index.html", import.meta.url), "utf8");
  const $ = cheerio.load(html);
  for (const id of [
    "start-button",
    "stop-button",
    "highway-list",
    "direction-a",
    "direction-b",
    "camera-video",
    "previous-button",
    "next-button",
    "retry-button",
    "skip-button",
    "open-player-button",
  ]) {
    assert.equal($(`#${id}`).length, 1, `Missing unique #${id}`);
  }
  assert.equal($("#camera-video").attr("playsinline"), undefined);
  assert.equal($("#camera-video").is("[muted]"), true);
  assert.equal($("#camera-video").is("[controls]"), true);
  assert.equal($("#camera-video").attr("preload"), "metadata");
  assert.equal($("#camera-video").attr("x-webkit-airplay"), "allow");
  assert.equal($("script[src^='http']").length, 0);
  assert.equal($("link[rel='stylesheet']").attr("href"), "./styles.css");
  assert.equal($("script[type='module']").attr("src"), "./js/app.mjs");
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

test("normal camera data cannot accidentally start unverified streams", async () => {
  const data = JSON.parse(
    await readFile(new URL("../docs/data/cameras.json", import.meta.url), "utf8"),
  );
  assert.ok(data.cameras.length > 0);
  assert.equal(data.cameras.filter((camera) => camera.enabled).length, 0);
});
