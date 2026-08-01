import { coordinateAtRoadPosition } from "./online-map.mjs";

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function advanceRoutePosition({
  direction,
  elapsedMs,
  positionM,
  speedKmh,
  totalLengthM,
}) {
  const sign = direction === "B" ? -1 : 1;
  const distanceM = (Number(speedKmh) / 3.6) * (Number(elapsedMs) / 1_000);
  const nextPositionM = clamp(positionM + sign * distanceM, 0, totalLengthM);
  return {
    ended: direction === "B" ? nextPositionM <= 0 : nextPositionM >= totalLengthM,
    positionM: nextPositionM,
  };
}

export function positionOnHighway(feature, positionM, accuracy = 8) {
  const coordinate = coordinateAtRoadPosition(feature?.geometry?.coordinates, positionM);
  if (!coordinate) return null;
  return {
    coords: {
      accuracy,
      latitude: coordinate[1],
      longitude: coordinate[0],
    },
    timestamp: Date.now(),
  };
}
