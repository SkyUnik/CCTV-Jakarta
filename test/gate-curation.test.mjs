import assert from "node:assert/strict";
import test from "node:test";

import { verifyGateCamera } from "../scripts/lib/gate-curation.mjs";

const document = {
  cameras: [{ id: "gate", highwayId: "road", side: null, enabled: false }],
};
const highwayData = {
  features: [{
    type: "Feature",
    properties: { id: "road", maxMatchRadiusM: 150 },
    geometry: {
      type: "LineString",
      coordinates: [[106.8, -6.2], [106.81, -6.2]],
    },
  }],
};

test("curates one toll-gate record for both directions with source metadata", () => {
  const result = verifyGateCamera(document, highwayData, {
    id: "gate",
    longitude: 106.805,
    latitude: -6.2,
    sourceUrl: "https://www.openstreetmap.org/node/123",
    osmNode: "123",
    reviewedAt: "2026-08-01",
  });
  assert.equal(result.camera.enabled, true);
  assert.equal(result.camera.side, null);
  assert.deepEqual(result.camera.directions, ["A", "B"]);
  assert.equal(result.camera.cameraType, "toll_gate");
  assert.equal(result.camera.curationStatus, "provisional_landmark");
  assert.equal(result.camera.locationReview.osmElementId, "123");
  assert.match(result.camera.locationReview.warning, /not a surveyed camera coordinate/);
});

test("rejects a distant projection unless review explicitly allows it", () => {
  const options = {
    id: "gate",
    longitude: 106.805,
    latitude: -6.195,
    sourceUrl: "https://www.openstreetmap.org/node/456",
  };
  assert.throws(() => verifyGateCamera(document, highwayData, options), /allow-distant-projection/);
  const result = verifyGateCamera(document, highwayData, {
    ...options,
    allowDistantProjection: true,
  });
  assert.ok(result.camera.locationReview.projectionDistanceM > 150);
  assert.match(result.camera.locationReview.warning, /explicitly approved/);
});
