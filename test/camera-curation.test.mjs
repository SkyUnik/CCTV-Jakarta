import assert from "node:assert/strict";
import test from "node:test";

import { verifyCamera } from "../scripts/lib/camera-curation.mjs";

const highwayData = {
  type: "FeatureCollection",
  features: [{
    type: "Feature",
    id: "road",
    properties: { id: "road", maxMatchRadiusM: 150 },
    geometry: {
      type: "LineString",
      coordinates: [[106.8, -6.2], [106.81, -6.2]],
    },
  }],
};

test("explicit review enables a camera and calculates curved-road position", () => {
  const document = {
    schemaVersion: 1,
    cameras: [{
      id: "camera-1",
      highwayId: "road",
      side: null,
      coordinates: null,
      roadPositionM: null,
      enabled: false,
      curationStatus: "needs_review",
    }],
  };
  const result = verifyCamera(document, highwayData, {
    id: "camera-1",
    side: "A",
    longitude: 106.805,
    latitude: -6.2001,
    notes: "Checked against provider map",
  });
  assert.equal(result.camera.enabled, true);
  assert.equal(result.camera.curationStatus, "verified");
  assert.equal(result.camera.side, "A");
  assert.ok(result.camera.roadPositionM > 500);
  assert.equal(result.camera.notes, "Checked against provider map");
});

test("refuses coordinates too far from the configured highway", () => {
  const document = {
    cameras: [{ id: "camera-1", highwayId: "road" }],
  };
  assert.throws(
    () => verifyCamera(document, highwayData, {
      id: "camera-1",
      side: "B",
      longitude: 106.805,
      latitude: -6.21,
    }),
    /from the configured highway/,
  );
});
