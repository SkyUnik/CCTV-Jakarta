import assert from "node:assert/strict";
import test from "node:test";

import { assessPlaylist } from "../scripts/lib/stream-check.mjs";

const manifest = "#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXT-X-MEDIA-SEQUENCE:1\n#EXTINF:2,\nsegment.ts\n";

test("accepts a valid playlist with wildcard CORS for Safari and HLS.js", () => {
  const result = assessPlaylist({
    body: manifest,
    headers: {
      "access-control-allow-origin": "*",
      "content-type": "application/vnd.apple.mpegurl",
    },
    origin: "https://example.github.io",
    status: 200,
    url: "https://media.example/camera.m3u8",
  });
  assert.equal(result.safariNativeCandidate, true);
  assert.equal(result.hlsJsCandidate, true);
  assert.deepEqual(result.warnings, []);
});

test("records the provider MIME quirk without rejecting a valid native candidate", () => {
  const result = assessPlaylist({
    body: manifest,
    headers: { "access-control-allow-origin": "*", "content-type": "text/plain" },
    origin: "https://example.github.io",
    status: 206,
    url: "https://media.example/camera.m3u8",
  });
  assert.equal(result.safariNativeCandidate, true);
  assert.equal(result.hlsJsCandidate, true);
  assert.deepEqual(result.warnings, ["unexpected_content_type:text/plain"]);
});

test("does not claim HLS.js compatibility when CORS is absent", () => {
  const result = assessPlaylist({
    body: manifest,
    headers: { "content-type": "application/x-mpegurl" },
    origin: "https://example.github.io",
    status: 200,
    url: "https://media.example/camera.m3u8",
  });
  assert.equal(result.safariNativeCandidate, true);
  assert.equal(result.hlsJsCandidate, false);
  assert.ok(result.warnings.includes("cors_not_confirmed"));
});
