import assert from "node:assert/strict";
import test from "node:test";

import {
  driverJourneySteps,
  filterHighways,
  projectHighwaysToSvg,
  stableHighwayColor,
  viewRegionFor,
} from "../docs/js/driving-ui.mjs";

const features = [
  {
    type: "Feature",
    properties: { id: "road-a", name: "Tol Alpha" },
    geometry: { type: "LineString", coordinates: [[106.7, -6.3], [106.9, -6.1]] },
  },
  {
    type: "Feature",
    properties: { id: "road-b", name: "Tol Beta" },
    geometry: { type: "LineString", coordinates: [[106.8, -6.4], [107, -6.2]] },
  },
];

test("projects every highway into a bounded SVG with stable colors and labels", () => {
  const projected = projectHighwaysToSvg(features);
  assert.equal(projected.length, 2);
  assert.deepEqual(projected.map((road) => road.name), ["Tol Alpha", "Tol Beta"]);
  assert.notEqual(projected[0].color, projected[1].color);
  assert.equal(stableHighwayColor("road-a"), stableHighwayColor("road-a"));
  assert.match(projected[0].path, /^M\d+\.\d{2} \d+\.\d{2} L/);
  for (const road of projected) {
    assert.ok(road.labelX >= 0 && road.labelX <= 640);
    assert.ok(road.labelY >= 0 && road.labelY <= 300);
  }
});

test("filters compact road choices by name or stable id", () => {
  assert.deepEqual(filterHighways(features, "beta").map((feature) => feature.properties.id), ["road-b"]);
  assert.deepEqual(filterHighways(features, "road-a").map((feature) => feature.properties.id), ["road-a"]);
  assert.equal(filterHighways(features, "").length, 2);
});

test("maps explicit regions and returns null when omitted", () => {
  assert.equal(viewRegionFor({}, "A"), null);
  assert.equal(viewRegionFor({}, "B"), null);
  assert.equal(viewRegionFor(null, "A"), null);
  assert.deepEqual(viewRegionFor({
    viewRegions: { A: { x: 0.25, y: 0.1, width: 0.6, height: 0.7, status: "confirmed" } },
  }, "A"), {
    x: 0.25, y: 0.1, width: 0.6, height: 0.7, status: "confirmed",
  });
});

test("stepper exposes the active setup value without generic warning copy", () => {
  const steps = driverJourneySteps({ highwayName: "Tol Alpha", direction: "B" });
  assert.deepEqual(steps.map((step) => step.state), ["done", "done", "current", "pending"]);
  assert.deepEqual(steps.map((step) => step.value), ["Tol Alpha", "B", "Menunggu", "Mati"]);

  const active = driverJourneySteps({
    cameraName: "Camera 1",
    direction: "A",
    highwayName: "Tol Alpha",
    trackingActive: true,
  });
  assert.equal(active.at(-1).value, "Aktif");
  assert.equal(active.at(-1).state, "current");
});

test("robustly frames central cluster even with distant regional highway", () => {
  const withOutlier = [
    ...features,
    {
      type: "Feature",
      properties: { id: "road-distant", name: "Tol Jauh" },
      geometry: { type: "LineString", coordinates: [[108.6, -6.8], [108.7, -6.7]] },
    },
  ];
  const projected = projectHighwaysToSvg(withOutlier);
  assert.equal(projected.length, 3);
  const alphaRoad = projected.find((r) => r.id === "road-a");
  assert.match(alphaRoad.path, /^M\d+\.\d{2} \d+\.\d{2} L/);
});
