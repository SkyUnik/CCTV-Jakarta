import assert from "node:assert/strict";
import test from "node:test";

import { createStreamAttemptTracker } from "../docs/js/journey.mjs";

test("stream attempts allow three total loads with 1s and 2s backoff", () => {
  const tracker = createStreamAttemptTracker();
  assert.deepEqual(tracker.start("camera-a"), {
    attempt: 1,
    cameraId: "camera-a",
    fallbackUsed: false,
  });
  assert.deepEqual(tracker.fail("camera-a"), {
    action: "retry",
    attempt: 2,
    cameraId: "camera-a",
    delayMs: 1_000,
    fallbackUsed: false,
  });
  assert.equal(tracker.fail("camera-a").delayMs, 2_000);
  assert.equal(tracker.fail("camera-a").action, "exhausted");
});

test("stream attempts preserve the one-camera fallback boundary", () => {
  const tracker = createStreamAttemptTracker();
  tracker.start("camera-b", { fallbackUsed: true });
  tracker.fail("camera-b");
  tracker.fail("camera-b");
  const exhausted = tracker.fail("camera-b");
  assert.equal(exhausted.action, "exhausted");
  assert.equal(exhausted.fallbackUsed, true);
});

test("starting a new target invalidates failures from an old camera", () => {
  const tracker = createStreamAttemptTracker();
  tracker.start("camera-a");
  tracker.start("camera-c");
  assert.equal(tracker.fail("camera-a").action, "stale");
  assert.equal(tracker.snapshot().attempt, 1);
  assert.equal(tracker.snapshot().cameraId, "camera-c");
});
