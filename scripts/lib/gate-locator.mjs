import { projectPointToLine } from "../../docs/js/geo.mjs";

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

const STOP_WORDS = new Set([
  "cctv", "tol", "jalan", "km", "arah", "gt", "gardu", "gerbang", "toll", "ic", "interchange",
  "jorr", "jorrs", "atp", "jagorawi", "japek", "dalkot",
]);

export function cleanTokens(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\bkm\s*[\d+.,-]+\b/gi, " ")
    .replace(/\bkm\b/gi, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0 && !STOP_WORDS.has(token));
}

export function computeNameSimilarity(cameraName, candidateName) {
  const leftTokens = cleanTokens(cameraName);
  const rightTokens = cleanTokens(candidateName);
  if (!leftTokens.length || !rightTokens.length) return 0;

  const isNumeric = (token) => /^\d+$/.test(token);
  const leftWords = new Set(leftTokens.filter((token) => !isNumeric(token)));
  const rightWords = new Set(rightTokens.filter((token) => !isNumeric(token)));

  let wordOverlap = 0;
  for (const word of leftWords) {
    if (rightWords.has(word)) wordOverlap += 1;
  }

  // If there are non-numeric words on both sides and none match, reject the match
  if (leftWords.size > 0 && rightWords.size > 0 && wordOverlap === 0) {
    return 0;
  }

  const left = new Set(leftTokens);
  const right = new Set(rightTokens);
  let overlap = 0;
  for (const token of left) {
    if (right.has(token)) overlap += 1;
  }
  return overlap / new Set([...left, ...right]).size;
}

export function isGateCamera(camera) {
  if (camera.cameraType === "toll_gate") return true;
  const name = String(camera.name ?? "").toUpperCase();
  return /\b(?:GT|GARDU|GERBANG\s*TOL)\b/.test(name);
}

export function calculateBoundingBox(coordinates, marginDeg = 0.02) {
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;

  for (const [lon, lat] of coordinates) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }

  return {
    minLat: Number((minLat - marginDeg).toFixed(6)),
    minLon: Number((minLon - marginDeg).toFixed(6)),
    maxLat: Number((maxLat + marginDeg).toFixed(6)),
    maxLon: Number((maxLon + marginDeg).toFixed(6)),
  };
}

export async function fetchOverpassTollBooths(bbox, { fetchImpl = globalThis.fetch } = {}) {
  const query = `[out:json][timeout:25];(node(${bbox.minLat},${bbox.minLon},${bbox.maxLat},${bbox.maxLon})[barrier=toll_booth];node(${bbox.minLat},${bbox.minLon},${bbox.maxLat},${bbox.maxLon})[highway=toll_gantry];);out body;`;
  const response = await fetchImpl(OVERPASS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "CCTV-Jakarta-admin-gate-locator/1.0",
    },
    body: new URLSearchParams({ data: query }).toString(),
  });

  if (!response.ok) {
    throw new Error(`Overpass query failed with status ${response.status}`);
  }

  const data = await response.json();
  return data.elements ?? [];
}

export async function locateGatesForHighway({
  cameraDocument,
  highwayData,
  highwayId,
  fetchImpl = globalThis.fetch,
  overpassElements = null,
}) {
  const highway = highwayData.features?.find(
    (feature) => (feature.properties?.id ?? feature.id) === highwayId,
  );
  if (!highway) throw new Error(`Highway not found: ${highwayId}`);

  const coordinates = highway.geometry?.coordinates ?? [];
  if (coordinates.length < 2) throw new Error("Highway geometry is too short");

  const cameras = (cameraDocument.cameras ?? []).filter(
    (c) => c.highwayId === highwayId && isGateCamera(c),
  );

  if (cameras.length === 0) {
    return {
      highwayId,
      highwayName: highway.properties?.name ?? highwayId,
      matches: [],
      totalGateCameras: 0,
    };
  }

  let elements = overpassElements;
  if (!elements) {
    const bbox = calculateBoundingBox(coordinates);
    try {
      elements = await fetchOverpassTollBooths(bbox, { fetchImpl });
    } catch (err) {
      throw new Error(`Gagal mengambil data gerbang tol dari OpenStreetMap: ${err.message}`);
    }
  }

  const maxMatchRadiusM = highway.properties?.maxMatchRadiusM ?? 150;
  const matches = [];

  for (const camera of cameras) {
    const candidateRankings = [];

    for (const element of elements) {
      if (!Number.isFinite(element.lon) || !Number.isFinite(element.lat)) continue;
      const elementCoords = [element.lon, element.lat];
      const projection = projectPointToLine(elementCoords, coordinates);
      const distanceM = Math.round(projection.distanceM);
      const roadPositionM = Math.round(projection.progressM);
      const elementName = element.tags?.name ?? element.tags?.ref ?? element.tags?.description ?? `Node ${element.id}`;
      const sim = computeNameSimilarity(camera.name, elementName);

      if (sim > 0) {
        candidateRankings.push({
          osmNode: String(element.id),
          osmName: elementName,
          coordinates: [element.lon, element.lat],
          distanceM,
          roadPositionM,
          withinLimit: distanceM <= maxMatchRadiusM,
          similarity: sim,
          sourceUrl: `https://www.openstreetmap.org/node/${element.id}`,
          warning: distanceM > maxMatchRadiusM
            ? `Jarak proyeksi ${distanceM} m melebihi batas standar ${maxMatchRadiusM} m`
            : null,
        });
      }
    }

    // Rank candidates: within limit first, then similarity, then distance
    candidateRankings.sort((a, b) => {
      if (a.withinLimit !== b.withinLimit) return a.withinLimit ? -1 : 1;
      if (b.similarity !== a.similarity) return b.similarity - a.similarity;
      return a.distanceM - b.distanceM;
    });

    const topCandidate = candidateRankings[0] ?? null;

    matches.push({
      camera,
      topCandidate,
      hasCandidate: Boolean(topCandidate),
    });
  }

  return {
    highwayId,
    highwayName: highway.properties?.name ?? highwayId,
    matches,
    totalGateCameras: cameras.length,
  };
}
