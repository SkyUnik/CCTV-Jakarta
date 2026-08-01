import assert from "node:assert/strict";
import test from "node:test";

import {
  coordinateAtRoadPosition,
  createSchematicProjection,
  estimateCameraOnHighway,
  groupEstimatedCameraMarkers,
} from "../docs/js/offline-map.mjs";

const feature = {
  type: "Feature",
  properties: {
    id: "road",
    cameraStationing: {
      quality: "estimated_stationing",
      anchors: [
        { km: 10, roadPositionM: 0 },
        { km: 12, roadPositionM: 2_200 },
      ],
    },
  },
  geometry: {
    type: "LineString",
    coordinates: [
      [106.8, -6.2],
      [106.81, -6.2],
      [106.81, -6.19],
    ],
  },
};

test("interpolates along every curved-road segment", () => {
  const point = coordinateAtRoadPosition(feature.geometry.coordinates, 1_700);
  assert.ok(point[0] > 106.809);
  assert.ok(point[1] > -6.2);
});

test("calibrates a provider kilometer without creating verified coordinates", () => {
  const camera = {
    id: "camera",
    highwayId: "road",
    km: 11,
    coordinates: null,
    roadPositionM: null,
    enabled: false,
    curationStatus: "needs_review",
  };
  const estimate = estimateCameraOnHighway(camera, feature);
  assert.equal(estimate.roadPositionM, 1_100);
  assert.equal(estimate.quality, "estimated_stationing");
  assert.equal(camera.coordinates, null);
  assert.equal(camera.roadPositionM, null);
  assert.equal(camera.enabled, false);
});

test("refuses cameras outside calibration and groups colocated records", () => {
  const cameras = [
    { id: "a", highwayId: "road", km: 11 },
    { id: "b", highwayId: "road", km: 11 },
    { id: "outside", highwayId: "road", km: 13 },
    { id: "missing", highwayId: "road", km: null },
  ];
  assert.equal(estimateCameraOnHighway(cameras[2], feature), null);
  const result = groupEstimatedCameraMarkers(cameras, [feature]);
  assert.equal(result.groups.length, 1);
  assert.deepEqual(result.groups[0].cameras.map((camera) => camera.id), ["a", "b"]);
  assert.deepEqual(result.unlocated.map((camera) => camera.id), ["outside", "missing"]);
});

test("creates stable finite SVG views for all and selected roads", () => {
  const projection = createSchematicProjection([feature]);
  const selected = projection.viewBoxForFeature(feature);
  assert.deepEqual(projection.allViewBox, { x: 0, y: 0, width: 1_000, height: 620 });
  assert.ok(Object.values(selected).every(Number.isFinite));
  assert.ok(selected.width > 0);
  assert.ok(selected.height > 0);
});
