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
      camera.side === side &&
      camera.enabled === true &&
      camera.curationStatus === "verified" &&
      Array.isArray(camera.coordinates) &&
      Number.isFinite(camera.roadPositionM),
    )
    .sort((a, b) => a.roadPositionM - b.roadPositionM);
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
  const hysteresisM = options.hysteresisM ?? 75;
  const requiredFixes = options.requiredFixes ?? 2;
  let consecutiveFixes = 0;
  let trackedCameraId = null;

  return {
    reset() {
      consecutiveFixes = 0;
      trackedCameraId = null;
    },
    update({ cameraId, cameraPositionM, direction, progressM }) {
      if (trackedCameraId !== cameraId) {
        trackedCameraId = cameraId;
        consecutiveFixes = 0;
      }
      const passed = direction === "A"
        ? progressM >= cameraPositionM + hysteresisM
        : progressM <= cameraPositionM - hysteresisM;
      consecutiveFixes = passed ? consecutiveFixes + 1 : 0;
      return {
        passed: consecutiveFixes >= requiredFixes,
        consecutiveFixes,
        requiredFixes,
      };
    },
  };
}
