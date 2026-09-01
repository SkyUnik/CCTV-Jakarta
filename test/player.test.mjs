import assert from "node:assert/strict";
import test from "node:test";

import {
  createVideoController,
  enterVideoFullscreen,
  fullscreenMethod,
  isPictureInPictureActive,
  nativeMediaErrorMessage,
  playbackTechnology,
  supportsNativeHls,
} from "../docs/js/player.mjs";

test("detects Safari native HLS using either registered MIME spelling", () => {
  assert.equal(supportsNativeHls({ canPlayType: (type) =>
    type === "application/vnd.apple.mpegurl" ? "maybe" : "" }), true);
  assert.equal(supportsNativeHls({ canPlayType: (type) =>
    type === "application/x-mpegURL" ? "probably" : "" }), true);
  assert.equal(supportsNativeHls({ canPlayType: () => "" }), false);
});

test("reports Managed Media Source separately from standard MSE", () => {
  function ManagedMediaSource() {}
  function MediaSource() {}
  const video = { canPlayType: () => "probably" };
  const mmsHls = {
    getMediaSource: () => ManagedMediaSource,
    isSupported: () => true,
  };
  const mseHls = {
    getMediaSource: () => MediaSource,
    isSupported: () => true,
  };
  assert.equal(
    playbackTechnology(video, mmsHls, { ManagedMediaSource }),
    "hls-mms",
  );
  assert.equal(
    playbackTechnology(video, mseHls, { ManagedMediaSource }),
    "hls-mse",
  );
  assert.equal(playbackTechnology(video, { isSupported: () => false }, {}), "native");
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

test("native reload eagerly sets source before load and preserves PiP", () => {
  const order = [];
  const attributes = {};
  const video = {
    paused: true,
    src: "https://media.example/cam.m3u8",
    canPlayType: () => "probably",
    load: () => { order.push("load"); },
    setAttribute(name, value) {
      attributes[name] = value;
      order.push(`${name}:${value}`);
    },
  };
  const controller = createVideoController({ video, hlsClass: { isSupported: () => false } });
  controller.load(
    { streamUrl: "https://media.example/cam.m3u8" },
    { reloadSource: true },
  );
  assert.equal(attributes.preload, "auto");
  assert.equal(attributes.src, "https://media.example/cam.m3u8");
  assert.ok(order.indexOf("src:https://media.example/cam.m3u8") < order.indexOf("load"));

  order.length = 0;
  video.webkitPresentationMode = "picture-in-picture";
  controller.load(
    { streamUrl: "https://media.example/cam.m3u8" },
    { reloadSource: true },
  );
  assert.equal(order.includes("load"), false, "PiP retry does not call video.load()");
});

test("HLS.js reloads the same URL through the existing attached instance", () => {
  let instanceCount = 0;
  const sources = [];
  const video = { paused: true, canPlayType: () => "" };
  const FakeHls = function () {
    instanceCount += 1;
    this.on = () => {};
    this.attachMedia = () => {};
    this.loadSource = (url) => { sources.push(url); };
    this.transferMedia = () => ({ media: video, mediaSource: {}, tracks: {} });
    this.destroy = () => {};
  };
  FakeHls.isSupported = () => true;
  FakeHls.Events = { MANIFEST_PARSED: "manifest", ERROR: "error" };
  const controller = createVideoController({ video, hlsClass: FakeHls });
  const camera = { streamUrl: "https://media.example/cam.m3u8" };
  controller.load(camera);
  controller.load(camera, { reloadSource: true });
  assert.equal(instanceCount, 1);
  assert.deepEqual(sources, [camera.streamUrl, camera.streamUrl]);
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

test("HLS.js hot-swap reuses one attached instance without clearing the PiP element", () => {
  let hlsDestroys = 0;
  let hlsAttaches = 0;
  let hlsSources = [];
  let hlsTransfers = 0;
  const attachArguments = [];
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
    this.attachMedia = (value) => {
      hlsAttaches += 1;
      attachArguments.push(value);
    };
    this.loadSource = (url) => { hlsSources.push(url); };
    this.transferMedia = () => {
      hlsTransfers += 1;
      return { media: video, mediaSource: {}, tracks: {} };
    };
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

  // Normal auto-switch keeps the MMS/MSE attachment and video element intact.
  controller.load({ streamUrl: "https://media.example/cam-2.m3u8" });
  assert.equal(instanceCount, 1, "HLS.js instance reused");
  assert.equal(hlsTransfers, 1, "MediaSource transferred before URL change");
  assert.equal(hlsAttaches, 2, "transferred MediaSource reattached without replacing video");
  assert.equal(attachArguments[0], video);
  assert.equal(attachArguments[1].media, video);
  assert.equal(hlsDestroys, 0, "controller not destroyed during hot-swap");
  assert.deepEqual(hlsSources, [
    "https://media.example/cam-1.m3u8",
    "https://media.example/cam-2.m3u8",
  ]);
  assert.equal(videoLoadCalls, 0, "video.load() never called during PiP");
  assert.equal(removeCalls, 0, "src never cleared");

  // A terminal destroy still releases the instance; a later load starts fresh.
  controller.destroy({ preservePip: true, clearSource: false });
  assert.equal(hlsDestroys, 1);
  controller.load({ streamUrl: "https://media.example/cam-3.m3u8" });
  assert.equal(instanceCount, 2, "destroy + load creates a fresh instance");
  assert.equal(hlsAttaches, 3);
});

test("HLS.js recovers one fatal media error before reporting or falling back", () => {
  let instance;
  let recoveries = 0;
  let errors = 0;
  const video = {
    paused: true,
    canPlayType: () => "",
  };
  const FakeHls = function () {
    instance = this;
    this.listeners = {};
    this.on = (event, fn) => { this.listeners[event] = fn; };
    this.attachMedia = () => {};
    this.loadSource = () => {};
    this.recoverMediaError = () => { recoveries += 1; };
    this.destroy = () => {};
  };
  FakeHls.isSupported = () => true;
  FakeHls.Events = { MANIFEST_PARSED: "manifest", ERROR: "error" };
  FakeHls.ErrorTypes = { MEDIA_ERROR: "mediaError" };

  const controller = createVideoController({
    video,
    hlsClass: FakeHls,
    onError: () => { errors += 1; },
  });
  controller.load({ streamUrl: "https://media.example/cam.m3u8" });
  instance.listeners.error(null, { fatal: true, type: "mediaError" });
  instance.listeners.error(null, { fatal: true, type: "mediaError" });
  assert.equal(recoveries, 1, "only one in-place recovery attempted");
  assert.equal(errors, 1, "second fatal error is surfaced");
});

test("late HLS events from the previous URL do not ready the new camera", () => {
  let instance;
  const ready = [];
  const video = { paused: true, canPlayType: () => "" };
  const FakeHls = function () {
    instance = this;
    this.listeners = {};
    this.on = (event, fn) => { this.listeners[event] = fn; };
    this.attachMedia = () => {};
    this.loadSource = () => {};
    this.transferMedia = () => ({ media: video, mediaSource: {}, tracks: {} });
    this.destroy = () => {};
  };
  FakeHls.isSupported = () => true;
  FakeHls.Events = { MANIFEST_PARSED: "manifest", ERROR: "error" };

  const controller = createVideoController({ video, hlsClass: FakeHls });
  controller.load(
    { id: "one", streamUrl: "https://media.example/one.m3u8" },
    { onReady: ({ camera }) => ready.push(camera.id) },
  );
  controller.load(
    { id: "two", streamUrl: "https://media.example/two.m3u8" },
    { onReady: ({ camera }) => ready.push(camera.id) },
  );
  instance.listeners.manifest(null, { url: "https://media.example/one.m3u8" });
  instance.listeners.manifest(null, { url: "https://media.example/two.m3u8" });
  assert.deepEqual(ready, ["two"]);
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
