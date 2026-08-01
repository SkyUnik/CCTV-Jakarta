import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  coordinateAtRoadPosition,
  createGpsCenterTracker,
  estimateCameraOnHighway,
  findCameraMarkerGroup,
  groupEstimatedCameraMarkers,
} from "../docs/js/online-map.mjs";

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

test("uses an explicit provisional gate coordinate before KM interpolation", () => {
  const camera = {
    id: "gate",
    highwayId: "road",
    km: 11,
    coordinates: [106.805, -6.201],
    roadPositionM: 777,
    curationStatus: "provisional_landmark",
  };
  const estimate = estimateCameraOnHighway(camera, feature);
  assert.deepEqual(estimate.coordinate, camera.coordinates);
  assert.equal(estimate.roadPositionM, 777);
  assert.equal(estimate.quality, "provisional_landmark");
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

test("finds the grouped map marker for a manually selected camera", () => {
  const result = groupEstimatedCameraMarkers([
    { id: "camera-a", highwayId: "road", km: 11 },
    { id: "camera-b", highwayId: "road", km: 11 },
  ], [feature]);
  assert.equal(findCameraMarkerGroup(result.groups, "camera-b"), result.groups[0]);
  assert.equal(findCameraMarkerGroup(result.groups, "missing"), null);
});

test("centers on only the first GPS fix until tracking is reset", () => {
  const tracker = createGpsCenterTracker();
  assert.equal(tracker.shouldCenter({ latitude: -6.2, longitude: 106.8 }), true);
  assert.equal(tracker.shouldCenter({ latitude: -6.19, longitude: 106.81 }), false);
  tracker.reset();
  assert.equal(tracker.shouldCenter({ latitude: -6.18, longitude: 106.82 }), true);
});

test("online map preserves overlays on tile failure and resizes after reveal", async () => {
  const source = await readFile(
    new URL("../docs/js/online-map.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /tileLayer\.on\("tileerror"/);
  assert.match(source, /routeLayer\s*=\s*leaflet\.featureGroup\(\)\.addTo\(map\)/);
  assert.match(source, /markerLayer\s*=\s*leaflet\.markerClusterGroup\(/);
  assert.match(source, /if \(toggle\.checked\) requestAnimationFrame\(\(\) => map\.invalidateSize/);
  assert.match(source, /zoomToBoundsOnClick:\s*true/);
  assert.match(source, /tileUrl\s*=\s*OSM_TILE_URL/);
  assert.match(source, /selectCamera\(cameraId\)/);
  assert.match(source, /markerLayer\.zoomToShowLayer\(entry\.marker, reveal\)/);
});

test("expanded map manages stacking, Escape, and focus restoration", async () => {
  const source = await readFile(
    new URL("../docs/js/online-map.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /routePanel\?\.classList\.add\("has-expanded-map"\)/);
  assert.match(source, /routePanel\?\.classList\.remove\("has-expanded-map"\)/);
  assert.match(source, /if \(expanded && escapeKey\(event\)\) closeExpandedMap\(\)/);
  assert.match(source, /expandButton\.focus\(\{ preventScroll: true \}\)/);
});
