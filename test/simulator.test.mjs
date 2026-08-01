import assert from "node:assert/strict";
import test from "node:test";

import { advanceRoutePosition, positionOnHighway } from "../docs/js/simulator.mjs";

const feature = {
  properties: { canonicalLengthM: 2_000 },
  geometry: {
    type: "LineString",
    coordinates: [[106.8, -6.2], [106.81, -6.2], [106.81, -6.19]],
  },
};

test("advances A and B at the selected vehicle speed", () => {
  const directionA = advanceRoutePosition({
    direction: "A", elapsedMs: 1_000, positionM: 100, speedKmh: 60, totalLengthM: 2_000,
  });
  const directionB = advanceRoutePosition({
    direction: "B", elapsedMs: 1_000, positionM: 1_000, speedKmh: 120, totalLengthM: 2_000,
  });
  assert.ok(Math.abs(directionA.positionM - 116.6667) < 0.01);
  assert.ok(Math.abs(directionB.positionM - 966.6667) < 0.01);
});

test("clamps simulation at both route ends", () => {
  assert.deepEqual(advanceRoutePosition({
    direction: "A", elapsedMs: 1_000, positionM: 1_995, speedKmh: 240, totalLengthM: 2_000,
  }), { ended: true, positionM: 2_000 });
  assert.deepEqual(advanceRoutePosition({
    direction: "B", elapsedMs: 1_000, positionM: 5, speedKmh: 240, totalLengthM: 2_000,
  }), { ended: true, positionM: 0 });
});

test("mock GPS coordinates stay on the complete curved LineString", () => {
  const position = positionOnHighway(feature, 1_700);
  assert.equal(position.coords.accuracy, 8);
  assert.ok(position.coords.longitude > 106.809);
  assert.ok(position.coords.latitude > -6.2);
});
