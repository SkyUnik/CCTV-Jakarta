import { createHash } from "node:crypto";

export function validatePublicHlsUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Camera URL must be a valid URL");
  }
  if (url.protocol !== "https:") {
    throw new Error("Camera URL must use HTTPS");
  }
  if (!/\.m3u8$/i.test(url.pathname)) {
    throw new Error("Camera URL path must end in .m3u8");
  }
  return url.toString();
}

export function validateSourcePage(value) {
  if (!value) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Source page must be a valid URL");
  }
  if (url.protocol !== "https:") {
    throw new Error("Source page must use HTTPS");
  }
  return url.toString();
}

export function createManualCamera(options) {
  const streamUrl = validatePublicHlsUrl(options.url);
  const sourcePage = validateSourcePage(options.sourcePage);
  const road = options.road ?? "dalam-kota";
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(road)) {
    throw new Error(`Invalid road slug: ${road}`);
  }
  const side = options.side ? options.side.toUpperCase() : null;
  if (side !== null && side !== "A" && side !== "B") {
    throw new Error("Side must be A or B");
  }
  const km = options.km === undefined || options.km === null
    ? null
    : Number(options.km);
  if (km !== null && (!Number.isFinite(km) || km < 0)) {
    throw new Error("KM must be a non-negative number");
  }
  const providerCameraId = options.providerId ?? null;
  const stablePart = providerCameraId
    ? String(providerCameraId).replace(/[^a-zA-Z0-9_-]/g, "-")
    : `manual-${createHash("sha256").update(streamUrl).digest("hex").slice(0, 12)}`;

  return {
    id: `public-${road}-${stablePart}`,
    providerCameraId,
    highwayId: road,
    name: String(options.name ?? "").trim(),
    streamUrl,
    sourcePage,
    km,
    side,
    coordinates: null,
    roadPositionM: null,
    enabled: false,
    curationStatus: "needs_review",
    notes: "Added manually; verify provenance, direction, and coordinates.",
    scrapedAt: null,
  };
}

export function appendManualCamera(document, camera) {
  const cameras = Array.isArray(document?.cameras) ? document.cameras : [];
  if (cameras.some((existing) => existing.id === camera.id)) {
    throw new Error(`Camera ID already exists: ${camera.id}`);
  }
  if (cameras.some((existing) => existing.streamUrl === camera.streamUrl)) {
    throw new Error("That stream URL already exists in the camera file");
  }
  return {
    ...(document ?? {}),
    schemaVersion: document?.schemaVersion ?? 1,
    cameras: [...cameras, camera],
  };
}
