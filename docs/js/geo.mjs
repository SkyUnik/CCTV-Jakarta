const EARTH_RADIUS_M = 6_371_008.8;

function radians(value) {
  return (value * Math.PI) / 180;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function localPoint(coordinate, referenceLatitude) {
  const scale = Math.cos(radians(referenceLatitude));
  return {
    x: EARTH_RADIUS_M * radians(coordinate[0]) * scale,
    y: EARTH_RADIUS_M * radians(coordinate[1]),
  };
}

function segmentLength(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function projectPointToLine(point, coordinates) {
  if (!Array.isArray(coordinates) || coordinates.length < 2) {
    throw new Error("A highway LineString needs at least two coordinates");
  }
  const referenceLatitude = point[1];
  const projectedPoint = localPoint(point, referenceLatitude);
  let cumulativeM = 0;
  let best = null;

  for (let index = 1; index < coordinates.length; index += 1) {
    const startCoordinate = coordinates[index - 1];
    const endCoordinate = coordinates[index];
    const start = localPoint(startCoordinate, referenceLatitude);
    const end = localPoint(endCoordinate, referenceLatitude);
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared === 0) continue;
    const fraction = clamp(
      ((projectedPoint.x - start.x) * dx + (projectedPoint.y - start.y) * dy) /
        lengthSquared,
      0,
      1,
    );
    const x = start.x + fraction * dx;
    const y = start.y + fraction * dy;
    const distanceM = Math.hypot(projectedPoint.x - x, projectedPoint.y - y);
    const lengthM = Math.sqrt(lengthSquared);
    const candidate = {
      distanceM,
      progressM: cumulativeM + fraction * lengthM,
      segmentIndex: index - 1,
      fraction,
      projectedCoordinate: [
        startCoordinate[0] + fraction * (endCoordinate[0] - startCoordinate[0]),
        startCoordinate[1] + fraction * (endCoordinate[1] - startCoordinate[1]),
      ],
    };
    if (!best || candidate.distanceM < best.distanceM) best = candidate;
    cumulativeM += lengthM;
  }

  if (!best) throw new Error("The highway LineString contains no usable segments");
  return { ...best, totalLengthM: cumulativeM };
}

export function matchHighways(position, highwayFeatures) {
  const accuracyM = Number(position.accuracy);
  if (!Number.isFinite(accuracyM) || accuracyM < 0) {
    return { accepted: false, reason: "invalid_accuracy", candidates: [] };
  }
  const candidates = [];
  let rejectedForAccuracy = false;

  for (const feature of highwayFeatures) {
    const properties = feature.properties ?? {};
    if (accuracyM > (properties.maxAccuracyM ?? 100)) {
      rejectedForAccuracy = true;
      continue;
    }
    const thresholdM = Math.min(
      properties.maxMatchRadiusM ?? 150,
      Math.max(properties.matchRadiusM ?? 60, accuracyM * 1.5),
    );
    const projection = projectPointToLine(
      [position.longitude, position.latitude],
      feature.geometry.coordinates,
    );
    if (projection.distanceM > thresholdM) continue;
    candidates.push({
      highwayId: properties.id ?? feature.id,
      feature,
      thresholdM,
      confidence: clamp(1 - projection.distanceM / thresholdM, 0, 1),
      ...projection,
    });
  }

  candidates.sort((a, b) => b.confidence - a.confidence || a.distanceM - b.distanceM);
  return {
    accepted: candidates.length > 0,
    reason: candidates.length > 0
      ? null
      : rejectedForAccuracy
        ? "accuracy_too_low"
        : "no_highway_match",
    candidates,
  };
}

export function verifiedCameras(cameras, highwayId, side) {
  return cameras
    .filter((camera) =>
      camera.highwayId === highwayId &&
      cameraSupportsDirection(camera, side) &&
      camera.enabled === true &&
      camera.curationStatus === "verified" &&
      Array.isArray(camera.coordinates) &&
      Number.isFinite(camera.roadPositionM),
    )
    .sort((a, b) => a.roadPositionM - b.roadPositionM);
}

export function cameraSupportsDirection(camera, side) {
  if (camera.side === side) return true;
  if (
    camera.cameraType === "toll_gate" &&
    Array.isArray(camera.directions) &&
    camera.directions.includes(side)
  ) {
    return true;
  }
  if (
    camera.cameraType === "wide_view" &&
    camera.directionReview?.status === "confirmed" &&
    Array.isArray(camera.directions) &&
    camera.directions.includes(side)
  ) {
    return true;
  }
  return false;
}

export function automaticCameras(cameras, highwayId, side) {
  const eligible = cameras
    .filter((camera) => {
      const reviewed = camera.curationStatus === "verified";
      const provisional =
        camera.curationStatus === "provisional_stationing" &&
        camera.locationReview?.method === "osm_route_stationing_interpolation";
      const landmark =
        camera.cameraType === "toll_gate" &&
        camera.curationStatus === "provisional_landmark" &&
        camera.locationReview?.method === "osm_toll_booth_projection";
      return camera.highwayId === highwayId &&
        cameraSupportsDirection(camera, side) &&
        camera.enabled === true &&
        (reviewed || provisional || landmark) &&
        Array.isArray(camera.coordinates) &&
        Number.isFinite(camera.roadPositionM);
    })
    .sort((a, b) => a.roadPositionM - b.roadPositionM || a.id.localeCompare(b.id));
  const seenPositions = new Set();
  return eligible.filter((camera) => {
    const key = Math.round(camera.roadPositionM);
    if (seenPositions.has(key)) return false;
    seenPositions.add(key);
    return true;
  });
}

export function publicCameras(cameras, highwayId, side) {
  const sorted = cameras
    .filter((camera) =>
      camera.highwayId === highwayId &&
      typeof camera.streamUrl === "string" &&
      camera.streamUrl.length > 0 &&
      (camera.side === null || camera.side === side)
    )
    .sort((a, b) => {
      const kilometerA = Number.isFinite(a.km) ? a.km : Number.POSITIVE_INFINITY;
      const kilometerB = Number.isFinite(b.km) ? b.km : Number.POSITIVE_INFINITY;
      return kilometerA - kilometerB || a.name.localeCompare(b.name, "id");
    });
  const seen = new Set();
  return sorted.filter((camera) => {
    const key = `${camera.streamUrl}\n${camera.name}\n${camera.side ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function initialCamera(cameras, direction, progressM) {
  return nextCameraAtProgress(cameras, direction, progressM);
}

export function nextCameraAtProgress(cameras, direction, progressM) {
  if (direction === "A") {
    return cameras.find((camera) => camera.roadPositionM >= progressM) ?? null;
  }
  if (direction === "B") {
    return [...cameras].reverse().find((camera) => camera.roadPositionM <= progressM) ?? null;
  }
  throw new Error("Direction must be A or B");
}

export function adjacentCamera(cameras, currentId, direction, step = 1) {
  const index = cameras.findIndex((camera) => camera.id === currentId);
  if (index < 0) return null;
  const travelDelta = direction === "A" ? step : -step;
  return cameras[index + travelDelta] ?? null;
}

export function createPassTracker(options = {}) {
  const minimumBufferM = options.minimumBufferM ?? options.hysteresisM ?? 50;
  const maximumBufferM = options.maximumBufferM ?? 150;
  const requiredFixes = options.requiredFixes ?? 2;
  let consecutiveFixes = 0;
  let trackedCameraId = null;

  return {
    reset() {
      consecutiveFixes = 0;
      trackedCameraId = null;
    },
    update({ accuracyM, cameraId, cameraPositionM, direction, progressM }) {
      if (trackedCameraId !== cameraId) {
        trackedCameraId = cameraId;
        consecutiveFixes = 0;
      }
      const usableAccuracyM = Number.isFinite(accuracyM) && accuracyM >= 0
        ? accuracyM
        : minimumBufferM;
      const bufferM = clamp(
        Math.max(minimumBufferM, usableAccuracyM),
        minimumBufferM,
        maximumBufferM,
      );
      const passed = direction === "A"
        ? progressM >= cameraPositionM + bufferM
        : progressM <= cameraPositionM - bufferM;
      consecutiveFixes = passed ? consecutiveFixes + 1 : 0;
      return {
        passed: consecutiveFixes >= requiredFixes,
        consecutiveFixes,
        bufferM,
        requiredFixes,
      };
    },
  };
}

export function createHighwayTracker(options = {}) {
  const confidenceMargin = options.confidenceMargin ?? 0.20;
  const requiredFixes = options.requiredFixes ?? 3;
  let pendingHighwayId = null;
  let consecutiveFixes = 0;

  function resetPending() {
    pendingHighwayId = null;
    consecutiveFixes = 0;
  }

  return {
    reset: resetPending,
    update({ candidates = [], currentHighwayId = null, locked = false } = {}) {
      if (locked || candidates.length === 0) {
        resetPending();
        return {
          changed: false,
          consecutiveFixes,
          highwayId: currentHighwayId,
          pendingHighwayId,
          requiredFixes,
        };
      }

      const leader = candidates[0];
      if (!currentHighwayId && candidates.length === 1) {
        resetPending();
        return {
          changed: true,
          consecutiveFixes: requiredFixes,
          highwayId: leader.highwayId,
          pendingHighwayId: null,
          requiredFixes,
        };
      }

      const current = candidates.find(({ highwayId }) => highwayId === currentHighwayId);
      if (leader.highwayId === currentHighwayId) {
        resetPending();
        return {
          changed: false,
          consecutiveFixes,
          highwayId: currentHighwayId,
          pendingHighwayId,
          requiredFixes,
        };
      }

      const leaderClearlyBetter = !current ||
        leader.confidence >= current.confidence + confidenceMargin;
      if (!leaderClearlyBetter) {
        resetPending();
        return {
          changed: false,
          consecutiveFixes,
          highwayId: currentHighwayId,
          pendingHighwayId,
          requiredFixes,
        };
      }

      if (pendingHighwayId === leader.highwayId) consecutiveFixes += 1;
      else {
        pendingHighwayId = leader.highwayId;
        consecutiveFixes = 1;
      }
      if (consecutiveFixes < requiredFixes) {
        return {
          changed: false,
          consecutiveFixes,
          highwayId: currentHighwayId,
          pendingHighwayId,
          requiredFixes,
        };
      }

      const highwayId = pendingHighwayId;
      resetPending();
      return {
        changed: highwayId !== currentHighwayId,
        consecutiveFixes: requiredFixes,
        highwayId,
        pendingHighwayId: null,
        requiredFixes,
      };
    },
  };
}
