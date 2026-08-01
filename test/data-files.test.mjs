import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { projectPointToLine, verifiedCameras } from "../docs/js/geo.mjs";

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(relativePath, import.meta.url), "utf8"));
}

test("committed highway follows the pinned Cawang to Pluit OSM path", async () => {
  const data = await readJson("../docs/data/highways.geojson");
  assert.equal(data.type, "FeatureCollection");
  assert.equal(data.features.length, 4);
  const feature = data.features.find((candidate) => candidate.properties.id === "dalam-kota");
  assert.equal(feature.properties.id, "dalam-kota");
  assert.equal(feature.properties.osmRelationId, 5_385_689);
  assert.equal(feature.properties.osmStartNodeId, 309_137_378);
  assert.equal(feature.properties.osmEndNodeId, 1_757_817_871);
  assert.equal(feature.geometry.type, "LineString");
  assert.ok(feature.geometry.coordinates.length >= 300);
  assert.deepEqual(feature.geometry.coordinates[0], feature.properties.zeroKmCoordinates);
  assert.ok(feature.properties.canonicalLengthM > 19_000);
  assert.ok(feature.properties.canonicalLengthM < 20_000);

  const pluit = [106.7855362, -6.1348951];
  const projection = projectPointToLine(pluit, feature.geometry.coordinates);
  assert.ok(projection.distanceM < 1);
  assert.ok(projection.progressM > 19_000);
});

test("committed multi-road geometries are directed, curved, and uniquely identified", async () => {
  const data = await readJson("../docs/data/highways.geojson");
  const expected = new Map([
    ["6-tol-dalam-kota-kelapa-gading-pulo-gebang", [7_000, 7_600]],
    ["akses-tanjung-priok", [10_800, 11_500]],
    ["jakarta-bogor-ciawi", [46_000, 47_500]],
  ]);
  assert.equal(new Set(data.features.map((feature) => feature.properties.id)).size, 4);
  for (const [id, [minimum, maximum]] of expected) {
    const feature = data.features.find((candidate) => candidate.properties.id === id);
    assert.ok(feature, `missing ${id}`);
    assert.equal(feature.geometry.type, "LineString");
    assert.ok(feature.geometry.coordinates.length > 100);
    assert.deepEqual(feature.geometry.coordinates[0], feature.properties.zeroKmCoordinates);
    assert.ok(feature.properties.canonicalLengthM >= minimum);
    assert.ok(feature.properties.canonicalLengthM <= maximum);
    assert.match(feature.properties.directionA, /KM 0/);
    assert.match(feature.properties.directionB, /KM 0/);
    assert.equal(feature.properties.cameraStationing.quality, "estimated_stationing");
    assert.equal(feature.properties.cameraStationing.anchors.length, 2);
  }
});

test("all current kilometer cameras can be mapped without becoming verified", async () => {
  const highways = await readJson("../docs/data/highways.geojson");
  const cameras = await readJson("../docs/data/cameras.json");
  const { groupEstimatedCameraMarkers } = await import("../docs/js/offline-map.mjs");
  const result = groupEstimatedCameraMarkers(cameras.cameras, highways.features);
  assert.equal(result.groups.reduce((total, group) => total + group.cameras.length, 0), 86);
  assert.equal(result.unlocated.length, 8);
  assert.ok(result.groups.every((group) => group.quality === "estimated_stationing"));
  assert.ok(cameras.cameras.every((camera) => camera.coordinates === null));
  assert.ok(cameras.cameras.every((camera) => camera.roadPositionM === null));
});

test("unreviewed provider cameras cannot enter automatic playback", async () => {
  const data = await readJson("../docs/data/cameras.json");
  assert.equal(data.sources.length, 4);
  assert.equal(new Set(data.sources.map((source) => source.road)).size, 4);
  assert.equal(data.cameras.length, 94);
  assert.equal(data.cameras.filter((camera) => camera.highwayId === "dalam-kota").length, 26);
  assert.equal(data.cameras.filter((camera) => camera.highwayId === "6-tol-dalam-kota-kelapa-gading-pulo-gebang").length, 9);
  assert.equal(data.cameras.filter((camera) => camera.highwayId === "akses-tanjung-priok").length, 31);
  assert.equal(data.cameras.filter((camera) => camera.highwayId === "jakarta-bogor-ciawi").length, 28);
  assert.equal(verifiedCameras(data.cameras, "dalam-kota", "A").length, 0);
  assert.equal(verifiedCameras(data.cameras, "dalam-kota", "B").length, 0);
  assert.ok(data.cameras.every((camera) => camera.enabled === false));
  assert.ok(data.cameras.every((camera) => camera.curationStatus === "needs_review"));
});
