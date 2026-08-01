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
  assert.equal(data.features.length, 1);
  const feature = data.features[0];
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

test("unreviewed provider cameras cannot enter automatic playback", async () => {
  const data = await readJson("../docs/data/cameras.json");
  assert.equal(data.cameras.length, 26);
  assert.equal(verifiedCameras(data.cameras, "dalam-kota", "A").length, 0);
  assert.equal(verifiedCameras(data.cameras, "dalam-kota", "B").length, 0);
  assert.ok(data.cameras.every((camera) => camera.enabled === false));
  assert.ok(data.cameras.every((camera) => camera.curationStatus === "needs_review"));
});
