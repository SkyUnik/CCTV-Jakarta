import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_LIVE_CONTROLLERS,
  createMultiCctvManager,
  isTollGate,
  orderCamerasForJourney,
  orderCamerasForMultiCctv,
} from "../docs/js/multi-cctv.mjs";

function createMockElement(tag = "div") {
  const listeners = new Map();
  const attributes = new Map();
  return {
    tagName: tag.toUpperCase(),
    className: "",
    classList: {
      add(...cls) {
        this._classes = this._classes || new Set();
        cls.forEach((c) => this._classes.add(c));
      },
      remove(...cls) {
        this._classes = this._classes || new Set();
        cls.forEach((c) => this._classes.delete(c));
      },
      contains(c) {
        return this._classes?.has(c) ?? false;
      },
    },
    dataset: {},
    style: {},
    children: [],
    hidden: false,
    _textContent: undefined,
    get textContent() {
      if (this._textContent !== undefined) return this._textContent;
      return this.children.map((c) => c.textContent || "").join(" ");
    },
    set textContent(v) {
      this._textContent = v;
    },
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
    querySelector(selector) {
      function findDescendant(node) {
        for (const child of node.children) {
          if (selector.startsWith(".") && (child.className?.includes(selector.slice(1)) || child.classList?.contains(selector.slice(1)))) {
            return child;
          }
          if (selector.startsWith("#") && child.id === selector.slice(1)) {
            return child;
          }
          if (child.tagName === selector.toUpperCase()) {
            return child;
          }
          const found = findDescendant(child);
          if (found) return found;
        }
        return null;
      }
      return findDescendant(this) || createMockElement();
    },
    querySelectorAll() {
      return [];
    },
    setAttribute(k, v) {
      attributes.set(k, String(v));
    },
    getAttribute(k) {
      return attributes.get(k);
    },
    removeAttribute(k) {
      attributes.delete(k);
      if (k === "src") delete this.src;
    },
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

test("orderCamerasForMultiCctv puts GT first then regular cameras sorted by lowest KM", () => {
  const mockCameras = [
    { id: "cam-3", name: "KM 30", km: 30, streamUrl: "https://example.com/3.m3u8" },
    { id: "gate-2", name: "GT Pasar Rebo 2", km: 21, cameraType: "toll_gate", streamUrl: "https://example.com/g2.m3u8" },
    { id: "cam-1", name: "KM 10", km: 10, streamUrl: "https://example.com/1.m3u8" },
    { id: "gate-1", name: "GT Fatmawati 1", km: 15, streamUrl: "https://example.com/g1.m3u8" },
    { id: "cam-2", name: "KM 20", km: 20, streamUrl: "https://example.com/2.m3u8" },
    { id: "cam-no-km", name: "Ruas Cilandak", km: null, streamUrl: "https://example.com/nokm.m3u8" },
  ];

  assert.equal(isTollGate(mockCameras[1]), true);
  assert.equal(isTollGate(mockCameras[3]), true);
  assert.equal(isTollGate(mockCameras[0]), false);

  const ordered = orderCamerasForMultiCctv(mockCameras);
  assert.deepEqual(
    ordered.map((c) => c.id),
    ["gate-1", "gate-2", "cam-1", "cam-2", "cam-3", "cam-no-km"],
  );
});

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
    cameras: [
      { id: "c2", name: "KM 02", km: 2, streamUrl: "https://example.com/2.m3u8" },
      { id: "g1", name: "GT Ciawi", km: 1, cameraType: "toll_gate", streamUrl: "https://example.com/g1.m3u8" },
      { id: "c1", name: "KM 01", km: 1, streamUrl: "https://example.com/1.m3u8" },
    ],
  });

  assert.equal(manager.isOpen(), true);
  assert.equal(title.textContent, "Tol Jagorawi");
  assert.match(subtitle.textContent, /Semua Arah/);

  // GT heading + 1 GT card + Road heading + 2 Road cards = 5 elements
  assert.equal(grid.children.length, 5);
  assert.match(grid.children[0].innerHTML, /Gerbang Tol/);
  assert.equal(grid.children[1].dataset.cameraId, "g1");
  assert.match(grid.children[2].innerHTML, /Jalur Utama/);
  assert.equal(grid.children[3].dataset.cameraId, "c1");
  assert.equal(grid.children[4].dataset.cameraId, "c2");

  // Initial standby cards do not preload or set src eagerly
  const cardGt = grid.children[1];
  const videoGt = cardGt.querySelector(".multi-cctv-video");
  assert.equal(videoGt.getAttribute("preload"), "none");
  assert.equal(videoGt.src, undefined);
  assert.equal(manager.getActiveSlots().size, 0);

  // Card header contains camera number and name
  const header = cardGt.querySelector(".multi-cctv-card-header");
  assert.ok(header);
  assert.match(cardGt.textContent, /GT Ciawi/);

  // Click card to attach slot and start live stream
  cardGt.dispatchEvent({ type: "click", target: cardGt });
  assert.equal(manager.getActiveSlots().size, 1);
  assert.equal(videoGt.getAttribute("preload"), "auto");
  assert.equal(videoGt.src, "https://example.com/g1.m3u8");

  // Click card again to detach slot and clean up stream
  cardGt.dispatchEvent({ type: "click", target: cardGt });
  assert.equal(manager.getActiveSlots().size, 0);
  assert.equal(videoGt.getAttribute("preload"), "none");
  assert.equal(videoGt.src, undefined);

  // Clicking backdrop closes modal
  overlay.dispatchEvent({ type: "click", target: overlay });
  assert.equal(manager.isOpen(), false);
});
