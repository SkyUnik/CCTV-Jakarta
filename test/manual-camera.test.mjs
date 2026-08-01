import assert from "node:assert/strict";
import test from "node:test";

import {
  appendManualCamera,
  createManualCamera,
  validatePublicHlsUrl,
} from "../scripts/lib/manual-camera.mjs";

test("creates safe disabled records for manually appended public cameras", () => {
  const camera = createManualCamera({
    road: "dalam-kota",
    name: "JTC KM 08+000 A",
    url: "https://public.example/live/camera.m3u8",
    sourcePage: "https://public.example/cameras",
    side: "A",
    km: "8",
  });
  assert.match(camera.id, /^public-dalam-kota-manual-[a-f0-9]{12}$/);
  assert.equal(camera.enabled, false);
  assert.equal(camera.curationStatus, "needs_review");
  assert.equal(camera.side, "A");
  assert.equal(camera.km, 8);
  assert.equal(camera.coordinates, null);
});

test("rejects unsafe or non-HLS camera URLs", () => {
  assert.throws(() => validatePublicHlsUrl("http://public.example/live.m3u8"), /HTTPS/);
  assert.throws(() => validatePublicHlsUrl("https://public.example/video.mp4"), /.m3u8/);
  assert.throws(() => validatePublicHlsUrl("not a url"), /valid URL/);
});

test("appends once and rejects duplicate IDs or stream URLs", () => {
  const camera = createManualCamera({
    name: "Camera",
    url: "https://public.example/live/camera.m3u8",
  });
  const document = appendManualCamera({ schemaVersion: 1, cameras: [] }, camera);
  assert.equal(document.cameras.length, 1);
  assert.throws(() => appendManualCamera(document, camera), /already exists/);
  assert.throws(
    () => appendManualCamera(document, { ...camera, id: "different-id" }),
    /stream URL already exists/,
  );
});
