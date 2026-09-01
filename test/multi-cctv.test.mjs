import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_LIVE_CONTROLLERS,
  createMultiCctvManager,
  orderCamerasForJourney,
} from "../docs/js/multi-cctv.mjs";

function createMockElement(tag = "div") {
  const listeners = new Map();
  return {
    tagName: tag.toUpperCase(),
    className: "",
    dataset: {},
    style: {},
    children: [],
    hidden: false,
    textContent: "",
    innerHTML: "",
    append(...elements) {
      this.children.push(...elements);
    },
    prepend(...elements) {
      this.children.unshift(...elements);
    },
    replaceChildren(...elements) {
      this.children = [...elements];
    },
    querySelector() {
      return createMockElement();
    },
    querySelectorAll() {
      return [];
    },
    setAttribute() {},
    removeAttribute() {},
    addEventListener(event, handler) {
      listeners.set(event, handler);
    },
    removeEventListener(event) {
      listeners.delete(event);
    },
    dispatchEvent(event) {
      listeners.get(event.type)?.(event);
    },
    focus() {},
    remove() {},
  };
}

test("orderCamerasForJourney sorts cameras ascending for A and descending for B based on kilometer", () => {
  const mockCameras = [
    { id: "cam-3", name: "KM 30", km: 30, streamUrl: "https://example.com/3.m3u8" },
    { id: "cam-1", name: "KM 10", km: 10, streamUrl: "https://example.com/1.m3u8" },
    { id: "cam-2", name: "KM 20", km: 20, streamUrl: "https://example.com/2.m3u8" },
    { id: "cam-invalid", name: "KM Null", km: null, roadPositionM: null, streamUrl: "https://example.com/x.m3u8" },
  ];

  const orderedA = orderCamerasForJourney(mockCameras, "A");
  assert.equal(orderedA.length, 3);
  assert.deepEqual(orderedA.map((c) => c.id), ["cam-1", "cam-2", "cam-3"]);

  const orderedB = orderCamerasForJourney(mockCameras, "B");
  assert.equal(orderedB.length, 3);
  assert.deepEqual(orderedB.map((c) => c.id), ["cam-3", "cam-2", "cam-1"]);
});

test("multi-cctv manager handles open/close, on-demand play toggling, and backdrop close", () => {
  assert.equal(MAX_LIVE_CONTROLLERS, 4);

  // Setup DOM mock
  globalThis.document = {
    body: { classList: { add: () => {}, remove: () => {} } },
    createElement: (tag) => createMockElement(tag),
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  const overlay = createMockElement("section");
  const grid = createMockElement("div");
  const title = createMockElement("h2");
  const subtitle = createMockElement("p");
  const closeBtn = createMockElement("button");

  const manager = createMultiCctvManager({
    closeButton: closeBtn,
    gridElement: grid,
    hlsClass: null,
    mapElement: null,
    overlayElement: overlay,
    subtitleElement: subtitle,
    titleElement: title,
    maxControllers: 4,
  });

  assert.equal(manager.isOpen(), false);
  assert.equal(manager.availableSlotsCount(), 4);

  manager.open({
    highway: { properties: { name: "Tol Jagorawi", directionA: "Ciawi" } },
    direction: "A",
    cameras: [
      { id: "c1", name: "KM 01", roadPositionM: 1000, streamUrl: "https://example.com/1.m3u8" },
      { id: "c2", name: "KM 02", roadPositionM: 2000, streamUrl: "https://example.com/2.m3u8" },
    ],
  });

  assert.equal(manager.isOpen(), true);
  assert.equal(title.textContent, "Tol Jagorawi");
  assert.match(subtitle.textContent, /Arah A/);
  assert.equal(grid.children.length, 2);

  // Clicking backdrop closes modal
  overlay.dispatchEvent({ type: "click", target: overlay });
  assert.equal(manager.isOpen(), false);
});
