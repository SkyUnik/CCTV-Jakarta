import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createQuickActionManager,
  DEFAULT_QUICK_ACTIONS,
  fetchQuickActions,
} from "../docs/js/quick-actions.mjs";

test("quick action registry has valid structure for Koja Timur", async () => {
  const content = await readFile(new URL("../docs/data/quick-actions.json", import.meta.url), "utf8");
  const data = JSON.parse(content);
  assert.equal(Array.isArray(data), true);
  assert.equal(data.length >= 1, true);
  const action = data[0];
  assert.equal(action.id, "koja-timur-quick");
  assert.equal(action.label, "Koja Timur");
  assert.equal(action.layout, "single");
  assert.deepEqual(action.cameraIds, ["binamarga-akses-tanjung-priok-742"]);
});

test("fetchQuickActions returns parsed registry data or fallback", async () => {
  const actions = await fetchQuickActions();
  assert.equal(Array.isArray(actions), true);
  assert.equal(actions[0].id, "koja-timur-quick");

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
      src: "",
      canPlayType: (type) => (type.includes("mpegurl") ? "probably" : ""),
      addEventListener: () => {},
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
  });

  await manager.init();
  manager.triggerOneTap();

  assert.equal(overlayHidden, false);
  assert.equal(elements.video.muted, true);
  assert.equal(elements.video.src, fakeCamera.streamUrl);
  assert.equal(plays, 1);
  assert.equal(fullscreens, 1);

  manager.close();
  assert.equal(overlayHidden, true);
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
