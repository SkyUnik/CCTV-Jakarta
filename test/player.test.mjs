import assert from "node:assert/strict";
import test from "node:test";

import {
  createVideoController,
  enterVideoFullscreen,
  fullscreenMethod,
  isPictureInPictureActive,
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

test("detects Picture-in-Picture without exiting before fullscreen", async () => {
  let fullscreenCalls = 0;
  const video = {
    webkitPresentationMode: "picture-in-picture",
    webkitEnterFullscreen() { fullscreenCalls += 1; },
  };
  assert.equal(isPictureInPictureActive(video), true);
  assert.equal(await enterVideoFullscreen(video), "webkit");
  assert.equal(fullscreenCalls, 1);
});

test("video controller switches while PiP is active without clearing the element", () => {
  let loadCalls = 0;
  let removeCalls = 0;
  let plays = 0;
  const video = {
    paused: false,
    src: "https://media.example/old.m3u8",
    webkitPresentationMode: "picture-in-picture",
    canPlayType: () => "probably",
    load: () => { loadCalls += 1; },
    pause: () => {},
    play: async () => { plays += 1; },
    removeAttribute: () => { removeCalls += 1; },
  };
  const controller = createVideoController({ video, hlsClass: { isSupported: () => false } });
  assert.equal(controller.load({ streamUrl: "https://media.example/new.m3u8" }), true);
  assert.equal(video.src, "https://media.example/new.m3u8");
  assert.equal(loadCalls, 0);
  assert.equal(removeCalls, 0);
  assert.equal(plays, 1);
});

test("destroy with preservePip then load keeps PiP video playing", () => {
  let pauseCalls = 0;
  let removeCalls = 0;
  let loadCalls = 0;
  let plays = 0;
  const video = {
    paused: false,
    src: "https://media.example/cam-a.m3u8",
    webkitPresentationMode: "picture-in-picture",
    canPlayType: () => "probably",
    load: () => { loadCalls += 1; },
    pause: () => { pauseCalls += 1; },
    play: async () => { plays += 1; },
    removeAttribute: () => { removeCalls += 1; },
  };
  const controller = createVideoController({ video, hlsClass: { isSupported: () => false } });
  // Simulate playCamera's destroyPlayer + load sequence
  controller.destroy({ preservePip: true, clearSource: false });
  assert.equal(pauseCalls, 0, "should not pause during PiP");
  assert.equal(removeCalls, 0, "should not remove src during PiP");
  assert.equal(loadCalls, 0, "should not call video.load during PiP");
  assert.equal(video.src, "https://media.example/cam-a.m3u8", "src preserved after destroy");

  const loaded = controller.load(
    { streamUrl: "https://media.example/cam-b.m3u8" },
    { continuePlaying: true },
  );
  assert.equal(loaded, true);
  assert.equal(video.src, "https://media.example/cam-b.m3u8");
  assert.equal(plays, 1, "auto-plays after PiP switch");
  assert.equal(removeCalls, 0, "src never removed during entire sequence");
});

test("HLS.js PiP switch destroys old instance and attaches new without clearing src", () => {
  let hlsDestroys = 0;
  let hlsAttaches = 0;
  let hlsSources = [];
  let removeCalls = 0;
  let videoLoadCalls = 0;
  const video = {
    paused: false,
    src: "",
    webkitPresentationMode: "picture-in-picture",
    canPlayType: () => "",
    load: () => { videoLoadCalls += 1; },
    pause: () => {},
    play: async () => {},
    removeAttribute: () => { removeCalls += 1; },
  };
  const FakeHls = {
    isSupported: () => true,
    Events: { MANIFEST_PARSED: "mp", ERROR: "err" },
  };
  // Track HLS.js instance lifecycle
  let instanceCount = 0;
  const originalHlsClass = function () {
    instanceCount += 1;
    this._listeners = {};
    this.on = (event, fn) => { this._listeners[event] = fn; };
    this.attachMedia = () => { hlsAttaches += 1; };
    this.loadSource = (url) => { hlsSources.push(url); };
    this.destroy = () => { hlsDestroys += 1; };
  };
  originalHlsClass.isSupported = FakeHls.isSupported;
  originalHlsClass.Events = FakeHls.Events;

  const controller = createVideoController({ video, hlsClass: originalHlsClass });

  // First load
  controller.load({ streamUrl: "https://media.example/cam-1.m3u8" });
  assert.equal(instanceCount, 1);
  assert.equal(hlsAttaches, 1);
  assert.deepEqual(hlsSources, ["https://media.example/cam-1.m3u8"]);

  // Switch during PiP — simulate auto-switch
  controller.destroy({ preservePip: true, clearSource: false });
  assert.equal(hlsDestroys, 1, "old HLS.js instance destroyed");
  assert.equal(removeCalls, 0, "no src removal during PiP");

  controller.load({ streamUrl: "https://media.example/cam-2.m3u8" });
  assert.equal(instanceCount, 2, "new HLS.js instance created");
  assert.equal(hlsAttaches, 2, "new instance attached to same video");
  assert.deepEqual(hlsSources, [
    "https://media.example/cam-1.m3u8",
    "https://media.example/cam-2.m3u8",
  ]);
  assert.equal(videoLoadCalls, 0, "video.load() never called during PiP");
  assert.equal(removeCalls, 0, "src never cleared");
});

test("play and enterFullscreen are synchronously callable from one gesture", async () => {
  let playOrder = [];
  const video = {
    webkitEnterFullscreen() { playOrder.push("fullscreen"); },
    play: async () => { playOrder.push("play"); },
  };
  const controller = createVideoController({ video, hlsClass: { isSupported: () => false } });
  // Simulate openVideoPlayer: both calls start synchronously
  const playPromise = controller.play();
  const fsPromise = controller.enterFullscreen();
  assert.deepEqual(playOrder, ["play", "fullscreen"], "both initiated in same microtask");
  await playPromise;
  await fsPromise;
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
