import assert from "node:assert/strict";
import test from "node:test";

import { defaultViewRegion, hardDeleteCamera, normalizeViewRegion, saveAdminCamera } from "../scripts/lib/admin-camera.mjs";

const highways = {
  features: [{ type: "Feature", properties: { id: "road", name: "Road" }, geometry: { type: "LineString", coordinates: [[106.8, -6.2], [106.81, -6.2]] } }],
};

function verifiedCamera() {
  return {
    id: "provider-road-1",
    providerCameraId: "1",
    highwayId: "road",
    name: "Camera 1",
    streamUrl: "https://media.example/camera.m3u8",
    sourcePage: "https://provider.example/cameras",
    km: 1,
    side: "A",
    coordinates: [106.805, -6.2],
    roadPositionM: 500,
    enabled: true,
    curationStatus: "verified",
  };
}

test("normalizes draggable frame regions within the video bounds", () => {
  assert.deepEqual(defaultViewRegion("A"), { x: 0, y: 0, width: .5, height: 1, status: "inferred" });
  assert.deepEqual(defaultViewRegion("B"), { x: .5, y: 0, width: .5, height: 1, status: "inferred" });
  assert.deepEqual(normalizeViewRegion({ x: .9, y: -.2, width: .4, height: .5, status: "confirmed" }, "A"), {
    x: .6, y: 0, width: .4, height: .5, status: "confirmed",
  });
});

test("safe editorial edits preserve verified location while coordinate changes downgrade it", () => {
  const original = verifiedCamera();
  const document = { schemaVersion: 1, cameras: [original] };
  const renamed = saveAdminCamera(document, highways, {
    originalId: original.id,
    camera: { ...original, name: "Renamed", viewRegions: { A: defaultViewRegion("A") } },
  }).camera;
  assert.equal(renamed.enabled, true);
  assert.equal(renamed.curationStatus, "verified");

  const moved = saveAdminCamera(document, highways, {
    originalId: original.id,
    camera: { ...original, coordinates: [106.806, -6.2] },
  }).camera;
  assert.equal(moved.enabled, false);
  assert.equal(moved.curationStatus, "needs_review");
  assert.equal(moved.roadPositionM, null);
});

test("provider identity is immutable and hard delete requires exact confirmation", () => {
  const camera = verifiedCamera();
  const document = { cameras: [camera] };
  assert.throws(() => saveAdminCamera(document, highways, {
    originalId: camera.id,
    camera: { ...camera, providerCameraId: "different" },
  }), /immutable/);
  assert.throws(() => hardDeleteCamera(document, camera.id, "wrong"), /exactly match/);
  assert.equal(hardDeleteCamera(document, camera.id, camera.id).document.cameras.length, 0);
});

test("new admin cameras remain disabled and receive inferred A/B regions", () => {
  const result = saveAdminCamera({ schemaVersion: 1, cameras: [] }, highways, {
    originalId: null,
    camera: {
      providerCameraId: "new-7",
      highwayId: "road",
      name: "New camera",
      streamUrl: "https://media.example/new.m3u8",
      sourcePage: "https://provider.example/cameras",
      side: "B",
      km: 2,
    },
  });
  assert.equal(result.created, true);
  assert.equal(result.camera.enabled, false);
  assert.equal(result.camera.curationStatus, "needs_review");
  assert.deepEqual(result.camera.viewRegions.B, defaultViewRegion("B"));
});
