import assert from "node:assert/strict";
import test from "node:test";

import {
  adjacentCamera,
  automaticCameras,
  cameraSupportsDirection,
  createHighwayTracker,
  createPassTracker,
  initialCamera,
  matchHighways,
  nextCameraAtProgress,
  projectPointToLine,
  publicCameras,
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

test("manual camera lists include matching and unknown sides without enabling automation", () => {
  const cameras = [
    { id: "a", highwayId: "road", side: "A", km: 2, name: "A", streamUrl: "https://example/a.m3u8" },
    { id: "b", highwayId: "road", side: "B", km: 1, name: "B", streamUrl: "https://example/b.m3u8" },
    { id: "u", highwayId: "road", side: null, km: 3, name: "Unknown", streamUrl: "https://example/u.m3u8" },
    { id: "u-duplicate", highwayId: "road", side: null, km: 3, name: "Unknown", streamUrl: "https://example/u.m3u8" },
  ];
  assert.deepEqual(publicCameras(cameras, "road", "A").map((camera) => camera.id), ["a", "u"]);
  assert.deepEqual(publicCameras(cameras, "road", "B").map((camera) => camera.id), ["b", "u"]);
  assert.equal(verifiedCameras(cameras, "road", "A").length, 0);
  assert.equal(automaticCameras(cameras, "road", "A").length, 0);
});

test("allows audited provisional stationing and deduplicates one side at one position", () => {
  const base = {
    highwayId: "road",
    side: "A",
    roadPositionM: 1_000,
    coordinates: [106.8, -6.2],
    enabled: true,
    curationStatus: "provisional_stationing",
    locationReview: { method: "osm_route_stationing_interpolation" },
  };
  const cameras = [
    { ...base, id: "first" },
    { ...base, id: "duplicate" },
    { ...base, id: "next", roadPositionM: 2_000 },
    { ...base, id: "unsafe", roadPositionM: 3_000, locationReview: null },
  ];
  assert.deepEqual(
    automaticCameras(cameras, "road", "A").map((camera) => camera.id),
    ["duplicate", "next"],
  );
  assert.equal(verifiedCameras(cameras, "road", "A").length, 0);
});

test("allows an explicitly sourced toll gate in both A and B, but not generic unknown-side cameras", () => {
  const gate = {
    id: "gate",
    highwayId: "road",
    side: null,
    directions: ["A", "B"],
    cameraType: "toll_gate",
    roadPositionM: 1_000,
    coordinates: [106.8, -6.2],
    enabled: true,
    curationStatus: "provisional_landmark",
    locationReview: { method: "osm_toll_booth_projection" },
  };
  const unsafe = { ...gate, id: "unsafe", cameraType: undefined };
  assert.equal(cameraSupportsDirection(gate, "A"), true);
  assert.equal(cameraSupportsDirection(gate, "B"), true);
  assert.equal(cameraSupportsDirection(unsafe, "A"), false);
  assert.deepEqual(automaticCameras([gate, unsafe], "road", "A").map(({ id }) => id), ["gate"]);
  assert.deepEqual(automaticCameras([gate, unsafe], "road", "B").map(({ id }) => id), ["gate"]);
});

test("allows confirmed wide_view cameras in both A and B, but rejects unconfirmed or generic A/B", () => {
  const wide = {
    id: "wide",
    highwayId: "road",
    side: null,
    directions: ["A", "B"],
    cameraType: "wide_view",
    directionReview: { status: "confirmed", method: "admin_wide_view_selection" },
    roadPositionM: 1_500,
    coordinates: [106.805, -6.2],
    enabled: true,
    curationStatus: "provisional_stationing",
    locationReview: { method: "osm_route_stationing_interpolation" },
  };
  const unconfirmed = {
    ...wide,
    id: "unconfirmed",
    directionReview: { status: "needs_review" },
    roadPositionM: 2_500,
  };
  const generic = {
    ...wide,
    id: "generic",
    cameraType: undefined,
    directionReview: undefined,
    roadPositionM: 3_500,
  };

  assert.equal(cameraSupportsDirection(wide, "A"), true);
  assert.equal(cameraSupportsDirection(wide, "B"), true);
  assert.equal(cameraSupportsDirection(unconfirmed, "A"), false);
  assert.equal(cameraSupportsDirection(unconfirmed, "B"), false);
  assert.equal(cameraSupportsDirection(generic, "A"), false);
  assert.equal(cameraSupportsDirection(generic, "B"), false);

  assert.deepEqual(
    automaticCameras([wide, unconfirmed, generic], "road", "A").map(({ id }) => id),
    ["wide"],
  );
  assert.deepEqual(
    automaticCameras([wide, unconfirmed, generic], "road", "B").map(({ id }) => id),
    ["wide"],
  );
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

test("uses GPS accuracy as a bounded pass buffer", () => {
  const tracker = createPassTracker();
  const update = (progressM, accuracyM) => tracker.update({
    accuracyM,
    cameraId: "camera-accuracy",
    cameraPositionM: 1_000,
    direction: "A",
    progressM,
  });
  assert.equal(update(1_080, 100).bufferM, 100);
  assert.equal(update(1_110, 100).passed, false);
  assert.equal(update(1_120, 100).passed, true);
  tracker.reset();
  assert.equal(update(1_151, 999).bufferM, 150);
  assert.equal(update(1_170, 999).passed, true);
});

test("selects the nearest camera still ahead after a multi-camera GPS jump", () => {
  const cameras = [
    { id: "one", roadPositionM: 1_000 },
    { id: "two", roadPositionM: 2_000 },
    { id: "three", roadPositionM: 3_000 },
    { id: "four", roadPositionM: 4_000 },
  ];
  assert.equal(nextCameraAtProgress(cameras, "A", 2_500)?.id, "three");
  assert.equal(nextCameraAtProgress(cameras, "B", 2_500)?.id, "two");
  assert.equal(nextCameraAtProgress(cameras, "A", 4_500), null);
  assert.equal(nextCameraAtProgress(cameras, "B", 500), null);
});

test("highway tracker selects a unique first fix and stabilizes road changes", () => {
  const tracker = createHighwayTracker();
  const roadA = { highwayId: "a", confidence: 0.7 };
  const roadB = { highwayId: "b", confidence: 0.95 };
  assert.deepEqual(
    tracker.update({ candidates: [roadA] }),
    {
      changed: true,
      consecutiveFixes: 3,
      highwayId: "a",
      pendingHighwayId: null,
      requiredFixes: 3,
    },
  );
  assert.equal(tracker.update({ candidates: [roadB], currentHighwayId: "a" }).changed, false);
  assert.equal(tracker.update({ candidates: [roadB], currentHighwayId: "a" }).changed, false);
  const changed = tracker.update({ candidates: [roadB], currentHighwayId: "a" });
  assert.equal(changed.changed, true);
  assert.equal(changed.highwayId, "b");
});

test("highway tracker keeps a valid road unless the leader is clearly better", () => {
  const tracker = createHighwayTracker();
  const close = [
    { highwayId: "b", confidence: 0.75 },
    { highwayId: "a", confidence: 0.60 },
  ];
  for (let index = 0; index < 4; index += 1) {
    assert.equal(tracker.update({ candidates: close, currentHighwayId: "a" }).highwayId, "a");
  }
  const clear = [
    { highwayId: "b", confidence: 0.85 },
    { highwayId: "a", confidence: 0.60 },
  ];
  assert.equal(tracker.update({ candidates: clear, currentHighwayId: "a" }).changed, false);
  assert.equal(tracker.update({ candidates: clear, currentHighwayId: "a" }).changed, false);
  assert.equal(tracker.update({ candidates: clear, currentHighwayId: "a" }).highwayId, "b");
});

test("manual road lock suppresses and resets pending automatic changes", () => {
  const tracker = createHighwayTracker();
  const candidates = [{ highwayId: "b", confidence: 1 }];
  tracker.update({ candidates, currentHighwayId: "a" });
  const locked = tracker.update({ candidates, currentHighwayId: "a", locked: true });
  assert.equal(locked.highwayId, "a");
  assert.equal(locked.pendingHighwayId, null);
  assert.equal(tracker.update({ candidates, currentHighwayId: "a" }).consecutiveFixes, 1);
});
