const SVG_WIDTH = 640;
const SVG_HEIGHT = 300;
const SVG_PADDING = 24;

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function featureId(feature) {
  return feature?.properties?.id ?? feature?.id ?? "";
}

function featureName(feature) {
  return feature?.properties?.name ?? featureId(feature);
}

function validCoordinates(feature) {
  return (feature?.geometry?.coordinates ?? []).filter((coordinate) =>
    Array.isArray(coordinate) &&
    coordinate.length >= 2 &&
    Number.isFinite(coordinate[0]) &&
    Number.isFinite(coordinate[1])
  );
}

export function stableHighwayColor(id) {
  let hash = 2166136261;
  for (const character of String(id)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 58% 36%)`;
}

export function projectHighwaysToSvg(features, options = {}) {
  const width = options.width ?? SVG_WIDTH;
  const height = options.height ?? SVG_HEIGHT;
  const padding = options.padding ?? SVG_PADDING;
  const entries = (features ?? []).map((feature) => ({
    coordinates: validCoordinates(feature),
    feature,
    id: featureId(feature),
    name: featureName(feature),
  })).filter((entry) => entry.id && entry.coordinates.length >= 2);
  const coordinates = entries.flatMap((entry) => entry.coordinates);
  if (coordinates.length === 0) return [];

  const longitudes = coordinates.map(([longitude]) => longitude);
  const latitudes = coordinates.map(([, latitude]) => latitude);
  
  // Median-based filtering to ignore extreme geographic outliers (e.g. Central Java) for the Jakarta map framing
  const sortedLons = longitudes.slice().sort((a, b) => a - b);
  const sortedLats = latitudes.slice().sort((a, b) => a - b);
  const medianLon = sortedLons[Math.floor(sortedLons.length / 2)];
  const medianLat = sortedLats[Math.floor(sortedLats.length / 2)];
  
  const inlierCoords = coordinates.filter(
    ([lon, lat]) => Math.abs(lon - medianLon) <= 1.0 && Math.abs(lat - medianLat) <= 1.0,
  );
  const bboxCoords = inlierCoords.length >= 2 ? inlierCoords : coordinates;
  const bboxLons = bboxCoords.map(([lon]) => lon);
  const bboxLats = bboxCoords.map(([, lat]) => lat);

  const minimumLongitude = Math.min(...bboxLons);
  const maximumLongitude = Math.max(...bboxLons);
  const minimumLatitude = Math.min(...bboxLats);
  const maximumLatitude = Math.max(...bboxLats);
  const longitudeSpan = Math.max(maximumLongitude - minimumLongitude, Number.EPSILON);
  const latitudeSpan = Math.max(maximumLatitude - minimumLatitude, Number.EPSILON);
  const scale = Math.min(
    (width - padding * 2) / longitudeSpan,
    (height - padding * 2) / latitudeSpan,
  );
  const drawnWidth = longitudeSpan * scale;
  const drawnHeight = latitudeSpan * scale;
  const offsetX = (width - drawnWidth) / 2;
  const offsetY = (height - drawnHeight) / 2;
  const project = ([longitude, latitude]) => [
    offsetX + (longitude - minimumLongitude) * scale,
    offsetY + (maximumLatitude - latitude) * scale,
  ];

  return entries.map((entry) => {
    const points = entry.coordinates.map(project);
    const labelPoint = points[Math.floor(points.length / 2)] ?? [0, 0];
    return {
      color: stableHighwayColor(entry.id),
      id: entry.id,
      labelX: Math.round(labelPoint[0]),
      labelY: Math.round(labelPoint[1]),
      name: entry.name,
      path: points.map(([x, y], index) =>
        `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`
      ).join(" "),
    };
  });
}

export function filterHighways(features, query) {
  const normalizedQuery = String(query ?? "").trim().toLocaleLowerCase("id");
  if (!normalizedQuery) return [...(features ?? [])];
  return (features ?? []).filter((feature) =>
    `${featureName(feature)} ${featureId(feature)}`
      .toLocaleLowerCase("id")
      .includes(normalizedQuery)
  );
}

export function viewRegionFor(camera, direction) {
  if (!camera || !["A", "B"].includes(direction)) return null;
  const source = camera.viewRegions?.[direction];
  if (!source) return null;
  const x = clamp(Number(source.x), 0, 1);
  const y = clamp(Number(source.y), 0, 1);
  const width = clamp(Number(source.width), 0.05, 1 - x);
  const height = clamp(Number(source.height), 0.05, 1 - y);
  return {
    height,
    status: source.status === "confirmed" ? "confirmed" : "inferred",
    width,
    x,
    y,
  };
}

export function driverJourneySteps({
  cameraName = null,
  direction = null,
  highwayName = null,
  trackingActive = false,
} = {}) {
  const currentIndex = !highwayName ? 0 : !direction ? 1 : !cameraName ? 2 : 3;
  const values = [
    highwayName ?? "Pilih",
    direction ?? "Pilih",
    cameraName ?? "Menunggu",
    trackingActive ? "Aktif" : cameraName ? "Siap" : "Mati",
  ];
  return ["Ruas", "Arah", "Kamera", "Tracking"].map((label, index) => ({
    label,
    state: index < currentIndex ? "done" : index === currentIndex ? "current" : "pending",
    value: values[index],
  }));
}
