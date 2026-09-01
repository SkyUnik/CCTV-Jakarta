import { projectPointToLine } from "../../docs/js/geo.mjs";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

function tokens(value) {
  return new Set(String(value ?? "").toLowerCase().normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter((token) =>
      token.length > 1 && !["cctv", "tol", "jalan", "km", "arah"].includes(token)));
}

function similarity(a, b) {
  const left = tokens(a);
  const right = tokens(b);
  if (!left.size || !right.size) return 0;
  let overlap = 0;
  for (const token of left) if (right.has(token)) overlap += 1;
  return overlap / new Set([...left, ...right]).size;
}

function osmType(value) {
  return value === "N" || value === "node" ? "node"
    : value === "W" || value === "way" ? "way"
      : value === "R" || value === "relation" ? "relation" : null;
}

function sourceUrl(type, id) {
  return type && id ? `https://www.openstreetmap.org/${type}/${id}` : null;
}

function coordinatesOf(candidate) {
  const longitude = Number(candidate.lon ?? candidate.center?.lon);
  const latitude = Number(candidate.lat ?? candidate.center?.lat);
  return Number.isFinite(longitude) && Number.isFinite(latitude)
    ? [longitude, latitude]
    : null;
}

export function buildOsmSearchTerms({ cameraName, highwayName, km }) {
  const cleanedCamera = String(cameraName ?? "")
    .replace(/\b(?:CCTV|KM)\b/gi, " ")
    .replace(/\b\d+(?:[+. ]\d+)?\s*[AB]?\b/gi, " ")
    .replace(/\s+/g, " ").trim();
  const terms = [
    [cleanedCamera, highwayName, "Indonesia"].filter(Boolean).join(" "),
    [cameraName, highwayName].filter(Boolean).join(" "),
    [cleanedCamera, Number.isFinite(Number(km)) ? `KM ${km}` : null].filter(Boolean).join(" "),
  ].filter((value) => value.length >= 3);
  return [...new Set(terms)].slice(0, 3);
}

function nominatimCandidate(item, query) {
  const type = osmType(item.osm_type);
  return {
    source: "nominatim",
    query,
    osmType: type,
    osmId: item.osm_id == null ? null : String(item.osm_id),
    name: item.display_name ?? item.name ?? "Unnamed OSM candidate",
    category: item.category ?? null,
    osmClass: item.class ?? null,
    osmTypeName: item.type ?? null,
    coordinates: coordinatesOf(item),
    sourceUrl: sourceUrl(type, item.osm_id),
    rawTags: item.extratags ?? {},
  };
}

function overpassCandidate(item) {
  const type = osmType(item.type);
  return {
    source: "overpass",
    query: "nearby road infrastructure",
    osmType: type,
    osmId: String(item.id),
    name: item.tags?.name ?? item.tags?.ref ?? `${item.tags?.barrier ?? item.tags?.man_made ?? item.tags?.highway ?? type} ${item.id}`,
    category: item.tags?.barrier ?? item.tags?.man_made ?? item.tags?.highway ?? null,
    osmClass: null,
    osmTypeName: null,
    coordinates: coordinatesOf(item),
    sourceUrl: sourceUrl(type, item.id),
    rawTags: item.tags ?? {},
  };
}

export function rankOsmCandidates(candidates, { cameraName, highway }) {
  return candidates.map((candidate) => {
    if (!candidate.coordinates) return { ...candidate, score: 0, rejectedReason: "missing_coordinates" };
    const projection = highway?.geometry?.coordinates
      ? projectPointToLine(candidate.coordinates, highway.geometry.coordinates)
      : null;
    const nameScore = similarity(cameraName, candidate.name);
    const roadScore = similarity(highway?.properties?.name, candidate.name);
    const infrastructureBonus = /toll|surveillance|gantry|booth/i.test([
      candidate.category,
      candidate.rawTags?.barrier,
      candidate.rawTags?.man_made,
      candidate.rawTags?.highway,
    ].filter(Boolean).join(" ")) ? 20 : 0;
    const distanceScore = projection ? Math.max(0, 35 - projection.distanceM / 50) : 0;
    const score = Math.round((nameScore * 30 + roadScore * 15 + infrastructureBonus + distanceScore) * 10) / 10;
    return {
      ...candidate,
      score,
      projectionDistanceM: projection ? Math.round(projection.distanceM) : null,
      projectedRoadPositionM: projection ? Math.round(projection.progressM) : null,
      withinNormalReviewRadius: projection
        ? projection.distanceM <= (highway.properties?.maxMatchRadiusM ?? 150)
        : null,
    };
  }).sort((a, b) => b.score - a.score ||
    (a.projectionDistanceM ?? Infinity) - (b.projectionDistanceM ?? Infinity));
}

function deduplicate(candidates) {
  const seen = new Set();
  return candidates.filter((candidate) => {
    const key = `${candidate.osmType}:${candidate.osmId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function requestJson(fetchImpl, url, options = {}) {
  const response = await fetchImpl(url, {
    ...options,
    headers: {
      Accept: "application/json",
      "User-Agent": "CCTV-Jakarta-camera-review/1.0",
      ...options.headers,
    },
  });
  if (!response.ok) throw new Error(`OSM request failed (${response.status}) for ${url}`);
  return response.json();
}

export async function lookupOsmCandidates(input, {
  fetchImpl = globalThis.fetch,
  wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("fetch is unavailable");
  const terms = buildOsmSearchTerms(input);
  if (terms.length === 0) throw new Error("Camera name or search context is required");
  const candidates = [];
  for (let index = 0; index < terms.length; index += 1) {
    if (index > 0) await wait(1_050);
    const url = new URL(NOMINATIM_URL);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("countrycodes", "id");
    url.searchParams.set("limit", "8");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("extratags", "1");
    url.searchParams.set("q", terms[index]);
    const result = await requestJson(fetchImpl, url.toString());
    candidates.push(...result.map((item) => nominatimCandidate(item, terms[index])));
  }

  const center = input.approximateCoordinates ?? candidates.find((candidate) => candidate.coordinates)?.coordinates;
  if (Array.isArray(center) && center.length === 2) {
    const [longitude, latitude] = center.map(Number);
    if (Number.isFinite(longitude) && Number.isFinite(latitude)) {
      const query = `[out:json][timeout:25];(nwr(around:1500,${latitude},${longitude})[barrier=toll_booth];nwr(around:1500,${latitude},${longitude})[highway=toll_gantry];nwr(around:1500,${latitude},${longitude})[man_made=surveillance];);out center tags;`;
      const result = await requestJson(fetchImpl, OVERPASS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ data: query }).toString(),
      });
      candidates.push(...(result.elements ?? []).map(overpassCandidate));
    }
  }
  return {
    searchTerms: terms,
    candidates: rankOsmCandidates(deduplicate(candidates), input),
  };
}
