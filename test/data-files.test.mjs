import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { automaticCameras, projectPointToLine, verifiedCameras } from "../docs/js/geo.mjs";

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

test("all current kilometer cameras can be mapped while provisional records remain distinct", async () => {
  const highways = await readJson("../docs/data/highways.geojson");
  const cameras = await readJson("../docs/data/cameras.json");
  const { groupEstimatedCameraMarkers } = await import("../docs/js/online-map.mjs");
  const result = groupEstimatedCameraMarkers(cameras.cameras, highways.features);
  assert.equal(result.groups.reduce((total, group) => total + group.cameras.length, 0), 93);
  assert.equal(result.unlocated.length, 1);
  assert.equal(result.groups.filter((group) => group.quality === "provisional_landmark")
    .reduce((total, group) => total + group.cameras.length, 0), 7);
  assert.equal(cameras.cameras.filter((camera) => camera.curationStatus === "verified").length, 0);
  assert.ok(cameras.cameras.filter((camera) => camera.curationStatus === "provisional_stationing").every((camera) =>
    camera.locationReview?.warning.includes("not a surveyed camera coordinate")
  ));
});

test("only explicitly directed provisional records enter automatic playback", async () => {
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
  assert.equal(data.cameras.filter((camera) => camera.enabled).length, 53);
  assert.equal(data.cameras.filter((camera) => camera.curationStatus === "provisional_stationing").length, 46);
  assert.equal(data.cameras.filter((camera) => camera.curationStatus === "provisional_landmark").length, 7);
  assert.equal(data.cameras.filter((camera) => camera.curationStatus === "needs_review").length, 41);
  assert.equal(automaticCameras(data.cameras, "dalam-kota", "A").length, 2);
  assert.equal(automaticCameras(data.cameras, "dalam-kota", "B").length, 2);
  assert.equal(automaticCameras(data.cameras, "akses-tanjung-priok", "A").length, 19);
  assert.equal(automaticCameras(data.cameras, "akses-tanjung-priok", "B").length, 17);
  assert.equal(automaticCameras(data.cameras, "jakarta-bogor-ciawi", "A").length, 1);
  assert.equal(automaticCameras(data.cameras, "jakarta-bogor-ciawi", "B").length, 15);
  assert.equal(automaticCameras(data.cameras, "6-tol-dalam-kota-kelapa-gading-pulo-gebang", "A").length, 1);
  assert.equal(automaticCameras(data.cameras, "6-tol-dalam-kota-kelapa-gading-pulo-gebang", "B").length, 1);
  assert.ok(data.cameras.filter((camera) => camera.enabled).every((camera) =>
    ((camera.side === "A" || camera.side === "B") ||
      (camera.cameraType === "toll_gate" && camera.side === null &&
        camera.directions?.join("") === "AB")) &&
    Array.isArray(camera.coordinates) &&
    Number.isFinite(camera.roadPositionM) &&
    ["osm_route_stationing_interpolation", "osm_toll_booth_projection"]
      .includes(camera.locationReview?.method)
  ));

  const expectedGates = new Map([
    ["binamarga-akses-tanjung-priok-1514", ["3723687947", 8_473]],
    ["binamarga-akses-tanjung-priok-1176", ["5630170832", 6_503]],
    ["binamarga-akses-tanjung-priok-1175", ["4919847409", 6_177]],
    ["binamarga-akses-tanjung-priok-1174", ["5671841190", 2_797]],
    ["binamarga-akses-tanjung-priok-742", ["5665426814", 5_065]],
    ["binamarga-akses-tanjung-priok-743", ["10738919923", 494]],
    ["binamarga-6-tol-dalam-kota-kelapa-gading-pulo-gebang-1438", ["8956339735", 6_558]],
  ]);
  const gates = data.cameras.filter((camera) => camera.cameraType === "toll_gate");
  assert.equal(gates.length, expectedGates.size);
  for (const camera of gates) {
    const expected = expectedGates.get(camera.id);
    assert.ok(expected, `unexpected gate ${camera.id}`);
    assert.equal(camera.locationReview.osmElementId, expected[0]);
    assert.equal(camera.roadPositionM, expected[1]);
    assert.deepEqual(camera.directions, ["A", "B"]);
  }
});
