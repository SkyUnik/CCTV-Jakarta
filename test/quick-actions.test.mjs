import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createQuickActionManager,
  DEFAULT_QUICK_ACTIONS,
  fetchQuickActions,
} from "../docs/js/quick-actions.mjs";

test("quick action registry has valid structure for JOR Priuk and Koja Timur", async () => {
  const content = await readFile(new URL("../docs/data/quick-actions.json", import.meta.url), "utf8");
  const data = JSON.parse(content);
  assert.equal(Array.isArray(data), true);
  assert.equal(data.length, 2);
  const jor = data[0];
  assert.equal(jor.id, "jor-priuk-quick");
  assert.equal(jor.label, "JOR Priuk");
  assert.equal(jor.layout, "single");
  assert.deepEqual(jor.cameraIds, ["binamarga-akses-tanjung-priok-753"]);
  const koja = data[1];
  assert.equal(koja.id, "koja-timur-quick");
  assert.equal(koja.label, "Koja Timur");
  assert.deepEqual(koja.cameraIds, ["binamarga-akses-tanjung-priok-742"]);
});

test("fetchQuickActions returns parsed registry data or fallback", async () => {
  const actions = await fetchQuickActions();
  assert.equal(Array.isArray(actions), true);
  assert.equal(actions[0].id, "jor-priuk-quick");
  assert.equal(actions[1].id, "koja-timur-quick");

  const fallback = await fetchQuickActions("./data/non-existent.json");
  assert.deepEqual(fallback, DEFAULT_QUICK_ACTIONS);
});

test("quick action manager preloads metadata and triggers one-tap fullscreen without altering trip state", async () => {
  const fakeCamera = {
    id: "binamarga-akses-tanjung-priok-742",
    name: "ATP GT KOJA TIMUR",
    streamUrl: "https://pub2.hk-opt.com/LiveApp/streams/610831844814460955304790.m3u8",
  };

  let plays = 0;
  let fullscreens = 0;
  let overlayHidden = true;

  const elements = {
    launcher: { addEventListener: () => {} },
    overlay: {
      get hidden() { return overlayHidden; },
      set hidden(val) { overlayHidden = val; },
    },
    close: { addEventListener: () => {} },
    video: {
      muted: false,
      disablePictureInPicture: false,
      src: "",
      canPlayType: (type) => (type.includes("mpegurl") ? "probably" : ""),
      addEventListener: () => {},
      setAttribute: () => {},
      play: async () => { plays += 1; },
      pause: () => {},
      load: () => {},
      removeAttribute: () => {},
      requestFullscreen: async () => { fullscreens += 1; },
    },
    status: { hidden: true, textContent: "" },
    play: { addEventListener: () => {} },
    fullscreen: { addEventListener: () => {} },
    retry: { addEventListener: () => {} },
  };

  const manager = createQuickActionManager({
    elements,
    cameras: [fakeCamera],
    actionIndex: 1,
    label: "Koja Timur",
  });

  await manager.init();
  manager.triggerOneTap();
  await Promise.resolve();

  assert.equal(overlayHidden, false);
  assert.equal(elements.video.muted, true);
  assert.equal(elements.video.src, fakeCamera.streamUrl);
  assert.equal(plays, 1);
  assert.equal(fullscreens, 1);

  manager.close();
  assert.equal(overlayHidden, true);
});

test("defers fullscreen to onReady when iPhone Safari video has no metadata yet", async () => {
  const fakeCamera = {
    id: "binamarga-akses-tanjung-priok-742",
    name: "ATP GT KOJA TIMUR",
    streamUrl: "https://pub2.hk-opt.com/LiveApp/streams/610831844814460955304790.m3u8",
  };

  let plays = 0;
  let fullscreens = 0;
  let overlayHidden = true;
  // Simulate iPhone Safari: webkitSupportsFullscreen starts false (no metadata),
  // becomes true after loadedmetadata fires.
  let webkitSupportsFullscreen = false;
  let onloadedmetadata = null;

  const elements = {
    launcher: { addEventListener: () => {} },
    overlay: {
      get hidden() { return overlayHidden; },
      set hidden(val) { overlayHidden = val; },
    },
    close: { addEventListener: () => {} },
    video: {
      muted: false,
      src: "",
      get webkitSupportsFullscreen() { return webkitSupportsFullscreen; },
      webkitEnterFullscreen() { fullscreens += 1; },
      canPlayType: (type) => (type.includes("mpegurl") ? "probably" : ""),
      addEventListener: () => {},
      setAttribute: () => {},
      play: async () => { plays += 1; },
      pause: () => {},
      load: () => {},
      removeAttribute: () => {},
      set onloadedmetadata(fn) { onloadedmetadata = fn; },
      get onloadedmetadata() { return onloadedmetadata; },
      set oncanplay(_fn) {},
      get oncanplay() { return null; },
      set onerror(_fn) {},
      get onerror() { return null; },
    },
    status: { hidden: true, textContent: "" },
    play: { addEventListener: () => {} },
    fullscreen: { addEventListener: () => {} },
    retry: { addEventListener: () => {} },
  };

  const manager = createQuickActionManager({
    elements,
    cameras: [fakeCamera],
    hlsClass: { isSupported: () => false },
  });

  await manager.init();
  manager.triggerOneTap();
  // Let the enterFullscreen().then() microtask settle
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(plays, 1, "play() called from gesture");
  assert.equal(fullscreens, 0, "fullscreen deferred — no metadata yet");

  // Simulate metadata loaded → webkitSupportsFullscreen becomes true
  webkitSupportsFullscreen = true;
  assert.equal(typeof onloadedmetadata, "function");
  onloadedmetadata();

  assert.equal(fullscreens, 1, "fullscreen entered from onReady after metadata loaded");
});

test("quick actions keep HLS.js enabled on MMS-capable iPhone Safari", async () => {
  let instances = 0;
  let attaches = 0;
  const sources = [];
  const FakeHls = function () {
    instances += 1;
    this.on = () => {};
    this.attachMedia = () => { attaches += 1; };
    this.loadSource = (url) => { sources.push(url); };
    this.destroy = () => {};
  };
  FakeHls.isSupported = () => true;
  FakeHls.Events = { MANIFEST_PARSED: "manifest", ERROR: "error" };

  const elements = {
    overlay: { hidden: true },
    video: {
      paused: true,
      src: "",
      canPlayType: () => "probably",
      webkitEnterFullscreen() {},
      play: async () => {},
      pause() {},
      removeAttribute() {},
      load() {},
    },
    status: { hidden: true, textContent: "" },
  };
  const manager = createQuickActionManager({
    elements,
    cameras: [],
    hlsClass: FakeHls,
  });
  await manager.init();

  assert.equal(instances, 1, "Safari native HLS support does not disable HLS.js");
  assert.equal(attaches, 1);
  assert.deepEqual(sources, [DEFAULT_QUICK_ACTIONS[0].defaultCamera.streamUrl]);
});

test("quick action manager closes overlay when clicking outside card backdrop", async () => {
  let overlayHidden = false;
  let clickHandler = null;

  const cardObj = {
    contains: (target) => target === cardObj || target === innerChildObj,
  };
  const innerChildObj = {};

  const overlayObj = {
    get hidden() { return overlayHidden; },
    set hidden(val) { overlayHidden = val; },
    querySelector: (selector) => (selector === ".quick-camera-card" ? cardObj : null),
    addEventListener: (type, listener) => {
      if (type === "click") clickHandler = listener;
    },
  };

  const elements = {
    overlay: overlayObj,
    video: {
      pause: () => {},
      removeAttribute: () => {},
      load: () => {},
    },
  };

  const manager = createQuickActionManager({ elements, cameras: [] });
  manager.bindEvents();

  assert.equal(typeof clickHandler, "function");
  // Click inside card (should not close)
  clickHandler({ target: cardObj });
  assert.equal(overlayHidden, false);

  clickHandler({ target: innerChildObj });
  assert.equal(overlayHidden, false);

  // Click outside card (on overlay backdrop) (should close)
  clickHandler({ target: overlayObj });
  assert.equal(overlayHidden, true);
});

test("quick action manager preserves video playback when closing overlay during active PiP", async () => {
  let overlayHidden = false;
  let pauseCount = 0;

  const elements = {
    overlay: {
      get hidden() { return overlayHidden; },
      set hidden(val) { overlayHidden = val; },
    },
    video: {
      webkitPresentationMode: "picture-in-picture",
      pause: () => { pauseCount += 1; },
      removeAttribute: () => {},
      load: () => {},
    },
  };

  const manager = createQuickActionManager({ elements, cameras: [] });
  manager.close();
  await Promise.resolve();

  assert.equal(overlayHidden, true);
  assert.equal(pauseCount, 0);
});
