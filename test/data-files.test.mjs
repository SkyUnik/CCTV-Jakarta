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
  assert.equal(data.features.length, 17);
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
    ["cawang-tj-priok-ancol-timur-jembatan-tigapluit", [26_000, 27_500]],
    ["bekasi-cawang-kampung-melayu", [15_000, 16_500]],
    ["jorr-e-bambu-apus-rorotan", [25_000, 26_000]],
  ]);
  assert.equal(new Set(data.features.map((feature) => feature.properties.id)).size, 17);
  for (const [id, [minimum, maximum]] of expected) {
    const feature = data.features.find((candidate) => candidate.properties.id === id);
    assert.ok(feature, `missing ${id}`);
    assert.equal(feature.geometry.type, "LineString");
    assert.ok(feature.geometry.coordinates.length > 10);
    assert.deepEqual(feature.geometry.coordinates[0], feature.properties.zeroKmCoordinates);
    assert.ok(feature.properties.canonicalLengthM >= minimum);
    assert.ok(feature.properties.canonicalLengthM <= maximum);
    assert.match(feature.properties.directionA, /KM 0|Bambu Apus/);
    assert.match(feature.properties.directionB, /KM 0|Bambu Apus/);
    assert.equal(feature.properties.cameraStationing.quality, "estimated_stationing");
    assert.equal(feature.properties.cameraStationing.anchors.length, 2);
  }
});

test("all current kilometer cameras can be mapped while provisional records remain distinct", async () => {
  const highways = await readJson("../docs/data/highways.geojson");
  const cameras = await readJson("../docs/data/cameras.json");
  const { groupEstimatedCameraMarkers } = await import("../docs/js/online-map.mjs");
  const result = groupEstimatedCameraMarkers(cameras.cameras, highways.features);
  assert.equal(result.groups.reduce((total, group) => total + group.cameras.length, 0), 190);
  assert.equal(result.unlocated.length, 56);
  assert.equal(result.groups.filter((group) => group.quality === "provisional_landmark")
    .reduce((total, group) => total + group.cameras.length, 0), 16);
  assert.equal(cameras.cameras.filter((camera) => camera.curationStatus === "verified").length, 0);
  assert.ok(cameras.cameras.filter((camera) => camera.curationStatus === "provisional_stationing").every((camera) =>
    camera.locationReview?.warning.includes("not a surveyed camera coordinate")
  ));
});

test("only explicitly directed provisional records enter automatic playback", async () => {
  const data = await readJson("../docs/data/cameras.json");
  assert.equal(data.sources.length, 17);
  assert.equal(new Set(data.sources.map((source) => source.road)).size, 17);
  assert.equal(data.cameras.length, 246);
  assert.equal(data.cameras.filter((camera) => camera.highwayId === "dalam-kota").length, 26);
  assert.equal(data.cameras.filter((camera) => camera.highwayId === "6-tol-dalam-kota-kelapa-gading-pulo-gebang").length, 9);
  assert.equal(data.cameras.filter((camera) => camera.highwayId === "akses-tanjung-priok").length, 31);
  assert.equal(data.cameras.filter((camera) => camera.highwayId === "jakarta-bogor-ciawi").length, 29);
  assert.equal(data.cameras.filter((camera) => camera.highwayId === "cawang-tj-priok-ancol-timur-jembatan-tigapluit").length, 3);
  assert.equal(data.cameras.filter((camera) => camera.highwayId === "bekasi-cawang-kampung-melayu").length, 15);
  assert.equal(verifiedCameras(data.cameras, "dalam-kota", "A").length, 0);
  assert.equal(verifiedCameras(data.cameras, "dalam-kota", "B").length, 0);
  assert.equal(data.cameras.filter((camera) => camera.enabled).length, 166);
  assert.equal(data.cameras.filter((camera) => camera.curationStatus === "provisional_stationing").length, 150);
  assert.equal(data.cameras.filter((camera) => camera.curationStatus === "provisional_landmark").length, 16);
  assert.equal(data.cameras.filter((camera) => camera.curationStatus === "needs_review").length, 80);
  assert.equal(automaticCameras(data.cameras, "dalam-kota", "A").length, 17);
  assert.equal(automaticCameras(data.cameras, "dalam-kota", "B").length, 17);
  assert.equal(automaticCameras(data.cameras, "akses-tanjung-priok", "A").length, 12);
  assert.equal(automaticCameras(data.cameras, "akses-tanjung-priok", "B").length, 10);
  assert.equal(automaticCameras(data.cameras, "jakarta-bogor-ciawi", "A").length, 1);
  assert.equal(automaticCameras(data.cameras, "jakarta-bogor-ciawi", "B").length, 15);
  assert.equal(automaticCameras(data.cameras, "6-tol-dalam-kota-kelapa-gading-pulo-gebang", "A").length, 7);
  assert.equal(automaticCameras(data.cameras, "6-tol-dalam-kota-kelapa-gading-pulo-gebang", "B").length, 7);
  assert.equal(automaticCameras(data.cameras, "jorr-e-bambu-apus-rorotan", "A").length, 23);
  assert.equal(automaticCameras(data.cameras, "jorr-e-bambu-apus-rorotan", "B").length, 23);
  assert.equal(automaticCameras(data.cameras, "jorr-s", "A").length, 35);
  assert.equal(automaticCameras(data.cameras, "jorr-s", "B").length, 35);
  assert.ok(data.cameras.filter((camera) => camera.enabled).every((camera) =>
    ((camera.side === "A" || camera.side === "B") ||
      (camera.side === null &&
        ((camera.cameraType === "toll_gate" && camera.directions?.join("") === "AB") ||
         (camera.cameraType === "wide_view" && camera.directions?.join("") === "AB" && camera.directionReview?.status === "confirmed")))) &&
    Array.isArray(camera.coordinates) &&
    Number.isFinite(camera.roadPositionM) &&
    ["osm_route_stationing_interpolation", "osm_toll_booth_projection"]
      .includes(camera.locationReview?.method)
  ));

  const expectedGates = new Map([
    ["binamarga-bekasi-cawang-kampung-melayu-1308", ["9937690473", 15_771]],
    ["binamarga-bekasi-cawang-kampung-melayu-1322", ["9937690474", 15_771]],
    ["binamarga-bekasi-cawang-kampung-melayu-1323", ["11721811437", 11_943]],
    ["binamarga-bekasi-cawang-kampung-melayu-1324", ["5212536805", 10_516]],
    ["binamarga-bekasi-cawang-kampung-melayu-1325", ["11479397422", 5_313]],
    ["binamarga-bekasi-cawang-kampung-melayu-1327", ["8132773397", 854]],
    ["binamarga-jorr-2-kunciran-cengkareng-563", ["4341942764", 14_585]],
    ["binamarga-jorr-2-kunciran-cengkareng-564", ["4341942764", 14_585]],
    ["binamarga-jorr-s-773", ["11502481186", 5_455]],
    ["binamarga-jorr-s-774", ["6427636434", 13_587]],
    ["binamarga-jorr-s-776", ["3596790127", 11_126]],
    ["binamarga-jorr-s-777", ["2041992852", 12_968]],
    ["binamarga-jorr-s-778", ["3376105577", 9_202]],
    ["binamarga-jorr-s-779", ["11502433778", 8_147]],
    ["binamarga-jorr-s-780", ["7633508787", 13_642]],
    ["binamarga-jorr-s-772", ["11499118703", 6_091]],
  ]);
  const gates = data.cameras.filter((camera) => camera.cameraType === "toll_gate" && camera.curationStatus === "provisional_landmark");
  assert.equal(gates.length, expectedGates.size);
  for (const camera of gates) {
    const expected = expectedGates.get(camera.id);
    assert.ok(expected, `unexpected gate ${camera.id}`);
    assert.equal(camera.locationReview.osmElementId, expected[0]);
    assert.equal(camera.roadPositionM, expected[1]);
    assert.deepEqual(camera.directions, ["A", "B"]);
  }
});
