import { projectPointToLine } from "../../docs/js/geo.mjs";

export function verifyGateCamera(document, highwayData, options) {
  const cameras = Array.isArray(document?.cameras) ? document.cameras : [];
  const cameraIndex = cameras.findIndex((camera) => camera.id === options.id);
  if (cameraIndex < 0) throw new Error(`Camera not found: ${options.id}`);
  const longitude = Number(options.longitude);
  const latitude = Number(options.latitude);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
    throw new Error("Longitude and latitude must be numbers");
  }
  if (!options.sourceUrl) throw new Error("A public landmark source URL is required");

  const camera = cameras[cameraIndex];
  const highway = highwayData.features?.find(
    (feature) => (feature.properties?.id ?? feature.id) === camera.highwayId,
  );
  if (!highway) throw new Error(`Highway not found: ${camera.highwayId}`);
  const projection = projectPointToLine(
    [longitude, latitude],
    highway.geometry.coordinates,
  );
  const maximumDistanceM = highway.properties?.maxMatchRadiusM ?? 150;
  if (projection.distanceM > maximumDistanceM && !options.allowDistantProjection) {
    throw new Error(
      `Gate is ${Math.round(projection.distanceM)} m from the configured highway ` +
        `(maximum ${maximumDistanceM} m); review it and use --allow-distant-projection explicitly`,
    );
  }

  const distanceM = Math.round(projection.distanceM);
  const distant = projection.distanceM > maximumDistanceM;
  const warning = distant
    ? `Distant projection ${distanceM} m from canonical geometry was explicitly approved; not a surveyed camera coordinate.`
    : "Public toll-gate landmark projected onto the canonical route; not a surveyed camera coordinate.";
  const verified = {
    ...camera,
    side: null,
    directions: ["A", "B"],
    cameraType: "toll_gate",
    coordinates: [longitude, latitude],
    roadPositionM: Math.round(projection.progressM),
    enabled: true,
    curationStatus: "provisional_landmark",
    notes: options.notes ?? camera.notes ?? "",
    locationReview: {
      status: "provisional",
      method: "osm_toll_booth_projection",
      sourceUrl: options.sourceUrl,
      ...(options.osmNode ? {
        osmElementType: "node",
        osmElementId: String(options.osmNode),
      } : {}),
      sourceCoordinates: [longitude, latitude],
      projectionDistanceM: distanceM,
      reviewedAt: options.reviewedAt ?? new Date().toISOString().slice(0, 10),
      warning,
    },
  };
  const updatedCameras = [...cameras];
  updatedCameras[cameraIndex] = verified;
  return {
    document: { ...document, cameras: updatedCameras },
    camera: verified,
    projection,
  };
}
