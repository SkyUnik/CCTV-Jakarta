import test from "node:test";
import assert from "node:assert/strict";

import { bulkDeleteCameras, findDuplicateCameras } from "../scripts/lib/camera-duplicates.mjs";

test("findDuplicateCameras identifies cameras with identical streamUrl and preserves original", () => {
  const doc = {
    cameras: [
      {
        id: "cam-1",
        providerCameraId: "1",
        name: "Tol Jagorawi KM 10",
        highwayId: "jagorawi",
        streamUrl: "https://cctv.binamarga.pu.go.id/hls/1.m3u8",
        curationStatus: "verified",
      },
      {
        id: "cam-2",
        providerCameraId: "2",
        name: "Tol Jagorawi KM 12",
        highwayId: "jagorawi",
        streamUrl: "https://cctv.binamarga.pu.go.id/hls/2.m3u8",
        curationStatus: "provisional_stationing",
      },
      {
        id: "cam-3",
        providerCameraId: "1-duplicate",
        name: "Tol Jagorawi KM 10 Duplikat",
        highwayId: "jagorawi",
        streamUrl: "https://cctv.binamarga.pu.go.id/hls/1.m3u8",
        curationStatus: "needs_review",
      },
      {
        id: "cam-4",
        providerCameraId: "1-triplicate",
        name: "Tol Jagorawi KM 10 Triplikat",
        highwayId: "jagorawi",
        streamUrl: "https://cctv.binamarga.pu.go.id/hls/1.m3u8",
        curationStatus: "needs_review",
      },
    ],
  };

  const result = findDuplicateCameras(doc);
  assert.equal(result.totalDuplicates, 2);
  assert.equal(result.duplicates.length, 2);

  // First duplicate entry: cam-3 duplicates cam-1
  assert.equal(result.duplicates[0].duplicateCamera.id, "cam-3");
  assert.equal(result.duplicates[0].originalCamera.id, "cam-1");
  assert.equal(result.duplicates[0].streamUrl, "https://cctv.binamarga.pu.go.id/hls/1.m3u8");

  // Second duplicate entry: cam-4 duplicates cam-1
  assert.equal(result.duplicates[1].duplicateCamera.id, "cam-4");
  assert.equal(result.duplicates[1].originalCamera.id, "cam-1");
});

test("findDuplicateCameras scopes results to specified highwayId", () => {
  const doc = {
    cameras: [
      {
        id: "cam-1",
        highwayId: "highway-a",
        streamUrl: "https://cctv.binamarga.pu.go.id/hls/shared.m3u8",
      },
      {
        id: "cam-2",
        highwayId: "highway-a",
        streamUrl: "https://cctv.binamarga.pu.go.id/hls/shared.m3u8",
      },
      {
        id: "cam-3",
        highwayId: "highway-b",
        streamUrl: "https://cctv.binamarga.pu.go.id/hls/b-dup.m3u8",
      },
      {
        id: "cam-4",
        highwayId: "highway-b",
        streamUrl: "https://cctv.binamarga.pu.go.id/hls/b-dup.m3u8",
      },
    ],
  };

  const resultA = findDuplicateCameras(doc, { highwayId: "highway-a" });
  assert.equal(resultA.totalDuplicates, 1);
  assert.equal(resultA.duplicates[0].duplicateCamera.id, "cam-2");

  const resultB = findDuplicateCameras(doc, { highwayId: "highway-b" });
  assert.equal(resultB.totalDuplicates, 1);
  assert.equal(resultB.duplicates[0].duplicateCamera.id, "cam-4");
});

test("bulkDeleteCameras removes selected camera IDs safely", () => {
  const doc = {
    cameras: [
      { id: "cam-1", name: "A" },
      { id: "cam-2", name: "B" },
      { id: "cam-3", name: "C" },
    ],
  };

  const { document: nextDoc, deletedCount } = bulkDeleteCameras(doc, ["cam-2", "cam-3"]);
  assert.equal(deletedCount, 2);
  assert.equal(nextDoc.cameras.length, 1);
  assert.equal(nextDoc.cameras[0].id, "cam-1");
});
