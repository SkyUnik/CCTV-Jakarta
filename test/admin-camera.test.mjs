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

test("new admin cameras remain disabled and preserve explicit or omitted regions", () => {
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
  assert.equal(result.camera.viewRegions, undefined);

  const withRegion = saveAdminCamera({ schemaVersion: 1, cameras: [] }, highways, {
    originalId: null,
    camera: {
      providerCameraId: "new-8",
      highwayId: "road",
      name: "With region",
      streamUrl: "https://media.example/new.m3u8",
      sourcePage: "https://provider.example/cameras",
      side: "B",
      km: 2,
      viewRegions: { B: defaultViewRegion("B") },
    },
  });
  assert.deepEqual(withRegion.camera.viewRegions.B, defaultViewRegion("B"));
});

test("saves dual-direction A/B cameras with directions array and toll_gate type", () => {
  const original = verifiedCamera();
  const document = { schemaVersion: 1, cameras: [original] };
  const saved = saveAdminCamera(document, highways, {
    originalId: original.id,
    camera: {
      ...original,
      cameraType: "toll_gate",
      side: null,
      directions: ["A", "B"],
      viewRegions: {
        A: defaultViewRegion("A"),
        B: defaultViewRegion("B"),
      },
    },
  }).camera;
  assert.equal(saved.side, null);
  assert.deepEqual(saved.directions, ["A", "B"]);
  assert.equal(saved.cameraType, "toll_gate");
  assert.deepEqual(saved.viewRegions.A, defaultViewRegion("A"));
  assert.deepEqual(saved.viewRegions.B, defaultViewRegion("B"));
});

test("saves wide_view camera type and preserves coordinates when direction changes", () => {
  const original = verifiedCamera();
  const document = { schemaVersion: 1, cameras: [original] };
  const wide = saveAdminCamera(document, highways, {
    originalId: original.id,
    camera: {
      ...original,
      cameraType: "wide_view",
      side: null,
      directions: ["A", "B"],
      directionReview: { status: "confirmed", method: "admin_wide_view_selection" },
    },
  }).camera;
  assert.equal(wide.side, null);
  assert.deepEqual(wide.directions, ["A", "B"]);
  assert.equal(wide.cameraType, "wide_view");
  assert.equal(wide.directionReview.status, "confirmed");
  assert.equal(wide.curationStatus, "verified");
  assert.equal(wide.roadPositionM, 500);
  assert.deepEqual(wide.coordinates, [106.805, -6.2]);

  // Switching back to single side B preserves coordinates
  const singleB = saveAdminCamera({ schemaVersion: 1, cameras: [wide] }, highways, {
    originalId: wide.id,
    camera: {
      ...wide,
      side: "B",
    },
  }).camera;
  assert.equal(singleB.side, "B");
  assert.equal(singleB.directions, undefined);
  assert.equal(singleB.cameraType, undefined);
  assert.equal(singleB.directionReview, undefined);
  assert.equal(singleB.curationStatus, "verified");
  assert.equal(singleB.roadPositionM, 500);
});

test("locateGatesForHighway matches toll gate cameras against OSM nodes", async () => {
  const { locateGatesForHighway } = await import("../scripts/lib/gate-locator.mjs");
  const doc = {
    cameras: [
      { id: "cam-gate-1", highwayId: "road", name: "GT KEBON BAWANG", coordinates: null },
      { id: "cam-normal", highwayId: "road", name: "KM 10+200", coordinates: null },
    ],
  };
  const fakeOverpassElements = [
    { id: 123456, lat: -6.2001, lon: 106.805, tags: { name: "Gerbang Tol Kebon Bawang", barrier: "toll_booth" } },
  ];
  const result = await locateGatesForHighway({
    cameraDocument: doc,
    highwayData: highways,
    highwayId: "road",
    overpassElements: fakeOverpassElements,
  });

  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].camera.id, "cam-gate-1");
  assert.equal(result.matches[0].hasCandidate, true);
  assert.equal(result.matches[0].topCandidate.osmNode, "123456");
  assert.equal(result.matches[0].topCandidate.withinLimit, true);
});

test("gate name matching is agnostic to KM strings in camera names", async () => {
  const { computeNameSimilarity, cleanTokens } = await import("../scripts/lib/gate-locator.mjs");
  assert.deepEqual(cleanTokens("JORRS GT FATMAWATI 2 KM 21+400"), ["fatmawati", "2"]);
  assert.deepEqual(cleanTokens("GT KEBON BAWANG KM 08.400"), ["kebon", "bawang"]);
  assert.deepEqual(cleanTokens("KM 19+850 GT PASAR REBO"), ["pasar", "rebo"]);
  const sim = computeNameSimilarity("JORRS GT FATMAWATI 2 KM 21+400", "Gerbang Tol Fatmawati 2");
  assert.equal(sim, 1.0);
});


test("bulk direction changes update all cameras on highway", () => {
  const doc = {
    cameras: [
      { id: "cam-1", highwayId: "road", side: "A" },
      { id: "cam-2", highwayId: "road", side: null },
      { id: "cam-3", highwayId: "other", side: "A" },
    ],
  };

  const updatedAB = doc.cameras.map((c) => {
    if (c.highwayId !== "road") return c;
    return { ...c, side: null, directions: ["A", "B"] };
  });
  assert.deepEqual(updatedAB[0].directions, ["A", "B"]);
  assert.equal(updatedAB[0].side, null);
  assert.deepEqual(updatedAB[1].directions, ["A", "B"]);
  assert.equal(updatedAB[2].side, "A");
  assert.equal(updatedAB[2].directions, undefined);
});


