export function createStreamAttemptTracker(options = {}) {
  const retryDelaysMs = options.retryDelaysMs ?? [1_000, 2_000];
  let attempt = 0;
  let cameraId = null;
  let fallbackUsed = false;

  return {
    reset() {
      attempt = 0;
      cameraId = null;
      fallbackUsed = false;
    },
    start(nextCameraId, options = {}) {
      cameraId = nextCameraId;
      fallbackUsed = options.fallbackUsed === true;
      attempt = 1;
      return { attempt, cameraId, fallbackUsed };
    },
    fail(failedCameraId) {
      if (!cameraId || failedCameraId !== cameraId) {
        return { action: "stale", attempt, cameraId, fallbackUsed };
      }
      if (attempt <= retryDelaysMs.length) {
        const delayMs = retryDelaysMs[attempt - 1];
        attempt += 1;
        return { action: "retry", attempt, cameraId, delayMs, fallbackUsed };
      }
      return { action: "exhausted", attempt, cameraId, fallbackUsed };
    },
    snapshot() {
      return { attempt, cameraId, fallbackUsed };
    },
  };
}
