import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  cameraPageUrl,
  mergeCameraData,
  parseCameraPage,
  parseKilometer,
  parseSide,
} from "../scripts/lib/binamarga.mjs";

const sourcePage =
  "https://binamarga.pu.go.id/contents/cctv_tol/?id_ruas=dalam-kota";
const scrapedAt = "2026-08-01T00:00:00.000Z";

test("parses kilometer stationing and explicit suffixes", () => {
  assert.equal(parseKilometer("JTC KM 05+400 B"), 5.4);
  assert.equal(parseKilometer("JTC KM 00+400 | HALIM"), 0.4);
  assert.equal(parseKilometer("No KM"), null);
  assert.equal(parseSide("JTC KM 05+400 B"), "B");
  assert.equal(parseSide("JTC KM 05+400 A"), "A");
  assert.equal(parseSide("JTC KM 00+400 | HALIM"), null);
});

test("extracts public cards, preserves duplicate labels, and skips missing streams", async () => {
  const html = await readFile(
    new URL("./fixtures/binamarga-dalam-kota.html", import.meta.url),
    "utf8",
  );
  const cameras = parseCameraPage(html, {
    road: "dalam-kota",
    sourcePage,
    scrapedAt,
  });

  assert.equal(cameras.length, 4);
  assert.equal(cameras.filter((camera) => camera.name === "JTC KM 10+600").length, 2);
  assert.deepEqual(
    cameras.slice(0, 3).map((camera) => camera.providerCameraId),
    ["41", "42", "43"],
  );
  assert.match(cameras[3].id, /^binamarga-dalam-kota-url-[a-f0-9]{12}$/);
  assert.equal(cameras[2].side, "B");
  assert.equal(cameras[3].side, null);
  assert.ok(cameras.every((camera) => camera.enabled === false));
  assert.ok(cameras.every((camera) => camera.curationStatus === "needs_review"));
});

test("merge updates scraped fields but preserves editorial review", () => {
  const scraped = [{
    id: "binamarga-dalam-kota-41",
    providerCameraId: "41",
    name: "Updated provider label",
    streamUrl: "https://media.example/new.m3u8",
    side: null,
    coordinates: null,
    roadPositionM: null,
    enabled: false,
    curationStatus: "needs_review",
    notes: "",
  }];
  const existing = {
    cameras: [{
      id: "binamarga-dalam-kota-41",
      name: "Old provider label",
      streamUrl: "https://media.example/old.m3u8",
      side: "A",
      coordinates: [106.87, -6.24],
      roadPositionM: 10_600,
      enabled: true,
      curationStatus: "verified",
      notes: "Checked manually",
    }],
  };

  const [merged] = mergeCameraData(scraped, existing);
  assert.equal(merged.name, "Updated provider label");
  assert.equal(merged.streamUrl, "https://media.example/new.m3u8");
  assert.equal(merged.side, "A");
  assert.deepEqual(merged.coordinates, [106.87, -6.24]);
  assert.equal(merged.enabled, true);
  assert.equal(merged.curationStatus, "verified");
  assert.equal(merged.notes, "Checked manually");
});

test("merge appends newly scraped cameras and retains manual cameras", () => {
  const scraped = [{
    id: "binamarga-dalam-kota-42",
    streamUrl: "https://media.example/new-provider-camera.m3u8",
  }];
  const manual = {
    id: "public-dalam-kota-manual-abc",
    streamUrl: "https://other.example/manual-camera.m3u8",
    enabled: false,
  };
  const merged = mergeCameraData(scraped, { cameras: [manual] });
  assert.deepEqual(merged.map((camera) => camera.id), [scraped[0].id, manual.id]);
});

test("constructs only the intended public road URL", () => {
  assert.equal(cameraPageUrl("dalam-kota"), sourcePage);
  assert.throws(() => cameraPageUrl("../../admin"), /Invalid road slug/);
  assert.throws(() => cameraPageUrl("https://example.com"), /Invalid road slug/);
});
