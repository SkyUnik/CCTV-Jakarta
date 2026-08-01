import assert from "node:assert/strict";
import test from "node:test";

import {
  adjacentCamera,
  createPassTracker,
  initialCamera,
  matchHighways,
  projectPointToLine,
  verifiedCameras,
} from "../docs/js/geo.mjs";

const line = [
  [106.8, -6.2],
  [106.81, -6.2],
  [106.81, -6.19],
];
const feature = {
  type: "Feature",
  id: "test-road",
  properties: {
    id: "test-road",
    matchRadiusM: 60,
    maxAccuracyM: 100,
    maxMatchRadiusM: 150,
  },
  geometry: { type: "LineString", coordinates: line },
};

test("projects onto the curved polyline rather than its endpoint chord", () => {
  const projection = projectPointToLine([106.8101, -6.195], line);
  assert.equal(projection.segmentIndex, 1);
  assert.ok(projection.distanceM < 20);
  assert.ok(projection.progressM > 1_500);
  assert.ok(projection.totalLengthM > 2_100);
});

test("matches within the dynamic threshold and rejects poor accuracy", () => {
  const matched = matchHighways(
    { longitude: 106.8101, latitude: -6.195, accuracy: 20 },
    [feature],
  );
  assert.equal(matched.accepted, true);
  assert.equal(matched.candidates[0].thresholdM, 60);

  const expanded = matchHighways(
    { longitude: 106.8107, latitude: -6.195, accuracy: 70 },
    [feature],
  );
  assert.equal(expanded.candidates[0].thresholdM, 105);

  const inaccurate = matchHighways(
    { longitude: 106.81, latitude: -6.195, accuracy: 101 },
    [feature],
  );
  assert.equal(inaccurate.accepted, false);
  assert.equal(inaccurate.reason, "accuracy_too_low");
});

test("filters unverified cameras and orders initial A/B choices", () => {
  const cameras = [
    { id: "a", highwayId: "test-road", side: "A", roadPositionM: 500, coordinates: [1, 1], enabled: true, curationStatus: "verified" },
    { id: "b", highwayId: "test-road", side: "A", roadPositionM: 1_000, coordinates: [1, 1], enabled: true, curationStatus: "verified" },
    { id: "c", highwayId: "test-road", side: "A", roadPositionM: 1_500, coordinates: [1, 1], enabled: false, curationStatus: "needs_review" },
  ];
  const usable = verifiedCameras(cameras, "test-road", "A");
  assert.deepEqual(usable.map((camera) => camera.id), ["a", "b"]);
  assert.equal(initialCamera(usable, "A", 600)?.id, "b");
  assert.equal(initialCamera(usable, "B", 900)?.id, "a");
  assert.equal(adjacentCamera(usable, "a", "A")?.id, "b");
  assert.equal(adjacentCamera(usable, "b", "B")?.id, "a");
  assert.equal(initialCamera(usable, "A", 1_100), null);
});

test("requires two fixes beyond the pass hysteresis and resets on jitter", () => {
  const tracker = createPassTracker({ hysteresisM: 75, requiredFixes: 2 });
  const update = (progressM) => tracker.update({
    cameraId: "camera-1",
    cameraPositionM: 1_000,
    direction: "A",
    progressM,
  });
  assert.equal(update(1_080).passed, false);
  assert.equal(update(1_060).consecutiveFixes, 0);
  assert.equal(update(1_090).passed, false);
  assert.equal(update(1_100).passed, true);
});

test("applies passing logic in the decreasing B direction", () => {
  const tracker = createPassTracker({ hysteresisM: 75, requiredFixes: 2 });
  const first = tracker.update({ cameraId: "camera-b", cameraPositionM: 1_000, direction: "B", progressM: 920 });
  const second = tracker.update({ cameraId: "camera-b", cameraPositionM: 1_000, direction: "B", progressM: 900 });
  assert.equal(first.passed, false);
  assert.equal(second.passed, true);
});
