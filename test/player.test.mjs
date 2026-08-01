import assert from "node:assert/strict";
import test from "node:test";

import {
  enterVideoFullscreen,
  fullscreenMethod,
  nativeMediaErrorMessage,
  prefersNativeHls,
  supportsNativeHls,
} from "../docs/js/player.mjs";

test("detects Safari native HLS using either registered MIME spelling", () => {
  assert.equal(supportsNativeHls({ canPlayType: (type) =>
    type === "application/vnd.apple.mpegurl" ? "maybe" : "" }), true);
  assert.equal(supportsNativeHls({ canPlayType: (type) =>
    type === "application/x-mpegURL" ? "probably" : "" }), true);
  assert.equal(supportsNativeHls({ canPlayType: () => "" }), false);
});

test("prefers native HLS only for Safari APIs or when HLS.js is unavailable", () => {
  const hls = { isSupported: () => true };
  const chromiumLike = { canPlayType: () => "maybe" };
  const safariLike = { canPlayType: () => "maybe", webkitEnterFullscreen() {} };
  assert.equal(prefersNativeHls(chromiumLike, hls), false);
  assert.equal(prefersNativeHls(safariLike, hls), true);
  assert.equal(prefersNativeHls(chromiumLike, { isSupported: () => false }), true);
});

test("prefers the iPhone video full-screen API", async () => {
  let webkitCalls = 0;
  let standardCalls = 0;
  const video = {
    webkitEnterFullscreen() { webkitCalls += 1; },
    requestFullscreen() { standardCalls += 1; },
  };
  assert.equal(fullscreenMethod(video), "webkit");
  assert.equal(await enterVideoFullscreen(video), "webkit");
  assert.equal(webkitCalls, 1);
  assert.equal(standardCalls, 0);
});

test("uses the standards full-screen API outside iOS Safari", async () => {
  let options;
  const video = {
    requestFullscreen(value) { options = value; },
  };
  assert.equal(fullscreenMethod(video), "standard");
  assert.equal(await enterVideoFullscreen(video), "standard");
  assert.deepEqual(options, { navigationUI: "hide" });
});

test("uses Safari presentation mode on macOS", async () => {
  let mode;
  const video = {
    webkitSetPresentationMode(value) { mode = value; },
    webkitSupportsPresentationMode(value) { return value === "fullscreen"; },
  };
  assert.equal(fullscreenMethod(video), "presentation");
  assert.equal(await enterVideoFullscreen(video), "presentation");
  assert.equal(mode, "fullscreen");
});

test("gracefully reports when programmatic full-screen is unavailable", async () => {
  assert.equal(fullscreenMethod({}), null);
  assert.equal(await enterVideoFullscreen({}), null);
});

test("maps native media failures to useful messages", () => {
  assert.match(nativeMediaErrorMessage({ code: 2 }), /Jaringan/);
  assert.match(nativeMediaErrorMessage({ code: 3 }), /mendekode/);
  assert.match(nativeMediaErrorMessage({ code: 4 }), /tidak didukung/);
  assert.match(nativeMediaErrorMessage(null), /offline/);
});
