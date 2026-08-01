import { projectPointToLine } from "../../docs/js/geo.mjs";

export function verifyCamera(document, highwayData, options) {
  const cameras = Array.isArray(document?.cameras) ? document.cameras : [];
  const cameraIndex = cameras.findIndex((camera) => camera.id === options.id);
  if (cameraIndex < 0) throw new Error(`Camera not found: ${options.id}`);
  const side = String(options.side ?? "").toUpperCase();
  if (side !== "A" && side !== "B") throw new Error("Side must be A or B");
  const longitude = Number(options.longitude);
  const latitude = Number(options.latitude);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
    throw new Error("Longitude and latitude must be numbers");
  }

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
  if (projection.distanceM > maximumDistanceM) {
    throw new Error(
      `Camera is ${Math.round(projection.distanceM)} m from the configured highway ` +
        `(maximum ${maximumDistanceM} m)`,
    );
  }

  const verified = {
    ...camera,
    side,
    coordinates: [longitude, latitude],
    roadPositionM: Math.round(projection.progressM),
    enabled: true,
    curationStatus: "verified",
    notes: options.notes ?? camera.notes ?? "",
  };
  const updatedCameras = [...cameras];
  updatedCameras[cameraIndex] = verified;
  return {
    document: { ...document, cameras: updatedCameras },
    camera: verified,
    projection,
  };
}
