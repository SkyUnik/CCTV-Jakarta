import { appendManualCamera, createManualCamera, validatePublicHlsUrl, validateSourcePage } from "./manual-camera.mjs";

const DIRECTIONS = new Set(["A", "B"]);

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function defaultViewRegion(direction) {
  return direction === "B"
    ? { x: 0.5, y: 0, width: 0.5, height: 1, status: "inferred" }
    : { x: 0, y: 0, width: 0.5, height: 1, status: "inferred" };
}

export function normalizeViewRegion(region, direction) {
  const fallback = defaultViewRegion(direction);
  const width = clamp(finite(region?.width, fallback.width), 0.1, 1);
  const height = clamp(finite(region?.height, fallback.height), 0.1, 1);
  const x = clamp(finite(region?.x, fallback.x), 0, 1 - width);
  const y = clamp(finite(region?.y, fallback.y), 0, 1 - height);
  return {
    x: Number(x.toFixed(4)),
    y: Number(y.toFixed(4)),
    width: Number(width.toFixed(4)),
    height: Number(height.toFixed(4)),
    status: region?.status === "confirmed" ? "confirmed" : "inferred",
  };
}

export function normalizeViewRegions(viewRegions, camera) {
  if (!viewRegions || typeof viewRegions !== "object" || Object.keys(viewRegions).length === 0) {
    return null;
  }
  const normalized = {};
  for (const direction of Object.keys(viewRegions)) {
    if (DIRECTIONS.has(direction) && viewRegions[direction]) {
      normalized[direction] = normalizeViewRegion(viewRegions[direction], direction);
    }
  }
  return Object.keys(normalized).length > 0 ? normalized : null;
}

function coordinatesChanged(before, after) {
  return JSON.stringify(before?.coordinates ?? null) !== JSON.stringify(after?.coordinates ?? null) ||
    before?.highwayId !== after?.highwayId;
}

function streamChanged(before, after) {
  return before?.streamUrl !== after?.streamUrl;
}

export function validateAdminCamera(camera, highwayIds) {
  if (!camera?.id || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(camera.id)) {
    throw new Error("Camera ID is required and may contain letters, numbers, underscore, or hyphen");
  }
  if (!camera.name?.trim()) throw new Error("Camera name is required");
  if (!highwayIds.has(camera.highwayId)) throw new Error(`Unknown highway: ${camera.highwayId}`);
  const streamUrl = validatePublicHlsUrl(camera.streamUrl);
  const sourcePage = validateSourcePage(camera.sourcePage);
  let side = camera.side == null || camera.side === "" ? null : String(camera.side).toUpperCase();
  if (side !== null && !DIRECTIONS.has(side)) throw new Error("Side must be A, B, or empty");

  let cameraType = camera.cameraType === "toll_gate" || camera.cameraType === "wide_view"
    ? camera.cameraType
    : undefined;

  if (side !== null) {
    cameraType = undefined;
  }

  let directions = Array.isArray(camera.directions)
    ? [...new Set(camera.directions.map((value) => String(value).toUpperCase()))]
    : undefined;
  if (directions?.some((value) => !DIRECTIONS.has(value))) {
    throw new Error("Directions may contain only A and B");
  }

  let directionReview = camera.directionReview;
  if (cameraType === "wide_view") {
    side = null;
    directions = ["A", "B"];
    directionReview = camera.directionReview && typeof camera.directionReview === "object"
      ? {
          status: camera.directionReview.status === "confirmed" ? "confirmed" : "needs_review",
          method: camera.directionReview.method ?? "admin_wide_view_selection",
        }
      : { status: "confirmed", method: "admin_wide_view_selection" };
  } else if (cameraType === "toll_gate") {
    side = null;
    directions = ["A", "B"];
    directionReview = undefined;
  } else {
    directions = undefined;
    directionReview = undefined;
  }

  let coordinates = null;
  if (camera.coordinates != null) {
    if (!Array.isArray(camera.coordinates) || camera.coordinates.length !== 2) {
      throw new Error("Coordinates must be [longitude, latitude]");
    }
    coordinates = camera.coordinates.map(Number);
    if (!coordinates.every(Number.isFinite)) throw new Error("Coordinates must be finite numbers");
  }
  const km = camera.km == null || camera.km === "" ? null : Number(camera.km);
  if (km !== null && (!Number.isFinite(km) || km < 0)) throw new Error("KM must be non-negative");
  const roadPositionM = camera.roadPositionM == null
    ? null
    : Number(camera.roadPositionM);
  if (roadPositionM !== null && (!Number.isFinite(roadPositionM) || roadPositionM < 0)) {
    throw new Error("Road position must be non-negative");
  }
  const normalized = {
    ...camera,
    id: camera.id.trim(),
    name: camera.name.trim(),
    streamUrl,
    sourcePage,
    km,
    side,
    coordinates,
    roadPositionM,
    enabled: Boolean(camera.enabled),
    notes: String(camera.notes ?? ""),
  };
  if (cameraType) normalized.cameraType = cameraType;
  else delete normalized.cameraType;
  if (directions) normalized.directions = directions;
  else delete normalized.directions;
  if (directionReview) normalized.directionReview = directionReview;
  else delete normalized.directionReview;
  const viewRegions = normalizeViewRegions(camera.viewRegions, normalized);
  if (viewRegions) normalized.viewRegions = viewRegions;
  else delete normalized.viewRegions;
  return normalized;
}

export function saveAdminCamera(document, highwayData, payload) {
  const cameras = Array.isArray(document?.cameras) ? document.cameras : [];
  const highwayIds = new Set((highwayData?.features ?? []).map((feature) =>
    feature.properties?.id ?? feature.id));
  const originalId = payload?.originalId ?? null;
  if (!originalId) {
    const requested = payload?.camera ?? {};
    const created = createManualCamera({
      road: requested.highwayId,
      name: requested.name,
      url: requested.streamUrl,
      sourcePage: requested.sourcePage,
      providerId: requested.providerCameraId,
      side: requested.side,
      km: requested.km,
    });
    const camera = validateAdminCamera({
      ...created,
      notes: requested.notes ?? created.notes,
      viewRegions: requested.viewRegions,
    }, highwayIds);
    return { document: appendManualCamera(document, camera), camera, created: true };
  }

  const index = cameras.findIndex((camera) => camera.id === originalId);
  if (index < 0) throw new Error(`Camera not found: ${originalId}`);
  const existing = cameras[index];
  if (payload.camera?.id !== originalId) throw new Error("Camera ID is immutable");
  if (
    existing.providerCameraId != null &&
    payload.camera?.providerCameraId !== existing.providerCameraId
  ) throw new Error("Provider camera ID is immutable");
  let camera = validateAdminCamera({ ...existing, ...payload.camera }, highwayIds);
  if (coordinatesChanged(existing, camera) || streamChanged(existing, camera)) {
    camera = {
      ...camera,
      enabled: false,
      roadPositionM: null,
      curationStatus: "needs_review",
      locationReview: null,
    };
  }
  if (camera.enabled && !["verified", "provisional_stationing", "provisional_landmark"].includes(camera.curationStatus)) {
    throw new Error("Only reviewed cameras may be enabled");
  }
  const updated = [...cameras];
  updated[index] = camera;
  return { document: { ...document, cameras: updated }, camera, created: false };
}

export function hardDeleteCamera(document, id, confirmation) {
  if (confirmation !== id) throw new Error("Delete confirmation must exactly match the camera ID");
  const cameras = Array.isArray(document?.cameras) ? document.cameras : [];
  const camera = cameras.find((candidate) => candidate.id === id);
  if (!camera) throw new Error(`Camera not found: ${id}`);
  return {
    document: { ...document, cameras: cameras.filter((candidate) => candidate.id !== id) },
    camera,
  };
}
