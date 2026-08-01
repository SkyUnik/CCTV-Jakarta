import { createHash } from "node:crypto";

import * as cheerio from "cheerio";

export const PROVIDER_BASE_URL = "https://binamarga.pu.go.id";
export const CAMERA_PAGE_PATH = "/contents/cctv_tol/";

const EDITORIAL_FIELDS = [
  "side",
  "coordinates",
  "roadPositionM",
  "enabled",
  "curationStatus",
  "notes",
  "locationReview",
];

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function fallbackCameraId(streamUrl) {
  return createHash("sha256").update(streamUrl).digest("hex").slice(0, 12);
}

function extractProviderCameraId(card, streamUrl) {
  const candidates = [
    card.find("video[id]").first().attr("id"),
    card.find("[id^='my_video_']").first().attr("id"),
  ];

  for (const candidate of candidates) {
    const match = String(candidate ?? "").match(/my_video_(\d+)/i);
    if (match) return match[1];
  }

  return null;
}

function extractName(card) {
  const headings = card.find("h1, h2, h3, h4, h5, h6");
  for (let index = headings.length - 1; index >= 0; index -= 1) {
    const value = cleanText(headings.eq(index).text());
    if (value) return value;
  }

  const ignored = new Set([
    "play",
    "play video",
    "pause",
    "mute",
    "unmute",
    "fullscreen",
  ]);
  const lines = card
    .text()
    .split(/\r?\n/)
    .map(cleanText)
    .filter((line) => line && !ignored.has(line.toLowerCase()));

  return lines.at(-1) ?? "Unnamed CCTV";
}

export function parseKilometer(name) {
  const match = cleanText(name).match(/(?:\bKM\s*)?0*(\d{1,3})\s*\+\s*(\d{1,3})(?!\d)/i);
  if (!match) return null;
  return Number(match[1]) + Number(match[2].padEnd(3, "0")) / 1000;
}

export function parseSide(name) {
  const text = cleanText(name);
  const trailing = text.match(/\|\s*([AB])\s*$/i);
  if (trailing) return trailing[1].toUpperCase();

  const stationSuffix = text.match(/\+\s*\d{1,3}\s*([AB])(?=\s*(?:\||$))/i);
  return stationSuffix ? stationSuffix[1].toUpperCase() : null;
}

export function parseCameraPage(html, options) {
  const { road, sourcePage, scrapedAt = new Date().toISOString() } = options;
  const $ = cheerio.load(html);
  const cameras = [];
  const seenIds = new Set();

  $(".card-cctv").each((_, element) => {
    const card = $(element);
    const streamUrl = card
      .find("source[src]")
      .toArray()
      .map((source) => cleanText($(source).attr("src")))
      .find((url) => /\.m3u8(?:$|[?#])/i.test(url));

    if (!streamUrl) return;

    const providerCameraId = extractProviderCameraId(card, streamUrl);
    const stablePart = providerCameraId ?? `url-${fallbackCameraId(streamUrl)}`;
    const id = `binamarga-${road}-${stablePart}`;
    if (seenIds.has(id)) return;
    seenIds.add(id);

    const name = extractName(card);
    cameras.push({
      id,
      providerCameraId,
      highwayId: road,
      name,
      streamUrl,
      sourcePage,
      km: parseKilometer(name),
      side: parseSide(name),
      coordinates: null,
      roadPositionM: null,
      enabled: false,
      curationStatus: "needs_review",
      notes: "",
      scrapedAt,
    });
  });

  return cameras;
}

export function mergeCameraData(scrapedCameras, existingData) {
  const existingCameras = Array.isArray(existingData?.cameras)
    ? existingData.cameras
    : [];
  const existingById = new Map(existingCameras.map((camera) => [camera.id, camera]));

  const mergedScraped = scrapedCameras.map((scraped) => {
    const existing = existingById.get(scraped.id);
    if (!existing) return scraped;

    const merged = { ...existing, ...scraped };
    for (const field of EDITORIAL_FIELDS) {
      if (Object.hasOwn(existing, field)) merged[field] = existing[field];
    }
    return merged;
  });

  const scrapedIds = new Set(scrapedCameras.map((camera) => camera.id));
  const existingOnly = existingCameras.filter((camera) => !scrapedIds.has(camera.id));
  return [...mergedScraped, ...existingOnly];
}

export function buildCameraDocument(cameras, options, existingData = null) {
  const { road, sourcePage, scrapedAt } = options;
  const source = {
    provider: "Direktorat Jenderal Bina Marga",
    road,
    sourcePage,
    scrapedAt,
  };
  const existingSources = Array.isArray(existingData?.sources)
    ? existingData.sources
    : existingData?.source
      ? [existingData.source]
      : [];
  const sources = [
    ...existingSources.filter((entry) => entry.road !== road),
    source,
  ];
  return {
    schemaVersion: 1,
    source,
    sources,
    cameras,
  };
}

export function cameraPageUrl(road) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(road)) {
    throw new Error(`Invalid road slug: ${road}`);
  }
  const url = new URL(CAMERA_PAGE_PATH, PROVIDER_BASE_URL);
  url.searchParams.set("id_ruas", road);
  return url.toString();
}
