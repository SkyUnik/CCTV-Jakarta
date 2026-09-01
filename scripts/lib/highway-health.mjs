import { estimateCameraOnHighway } from "../../docs/js/online-map.mjs";
import { buildFeature } from "../build-highway.mjs";
import { buildCameraDocument, cameraPageUrl, mergeCameraData, parseCameraPage } from "./binamarga.mjs";
import { verifyGateCamera } from "./gate-curation.mjs";
import { locateGatesForHighway } from "./gate-locator.mjs";

const USER_AGENT = "Jakarta-Toll-CCTV-Health-Check/1.0 (+public-page-check)";

export async function checkHighwayHealth({
  cameraDocument,
  highwayData,
  highwayId,
  fetchImpl = globalThis.fetch,
}) {
  const feature = (highwayData.features ?? []).find(
    (f) => (f.properties?.id ?? f.id) === highwayId,
  );
  if (!feature) {
    throw new Error(`Ruas tidak ditemukan: ${highwayId}`);
  }

  const highwayName = feature.properties?.name ?? highwayId;
  const cameras = (cameraDocument.cameras ?? []).filter(
    (c) => c.highwayId === highwayId,
  );

  // 1. Live Stream Ping
  const streamDetails = [];
  let onlineStreams = 0;
  let offlineStreams = 0;

  for (const camera of cameras) {
    if (!camera.streamUrl) {
      streamDetails.push({
        id: camera.id,
        name: camera.name,
        streamUrl: null,
        status: "no_url",
        statusCode: null,
        latencyMs: 0,
        error: "URL stream kosong",
      });
      offlineStreams += 1;
      continue;
    }

    const start = performance.now();
    try {
      const response = await fetchImpl(camera.streamUrl, {
        headers: {
          Accept: "application/vnd.apple.mpegurl, application/x-mpegURL, text/plain, */*",
          "User-Agent": USER_AGENT,
        },
        redirect: "follow",
        signal: AbortSignal.timeout(6000),
      });
      const latencyMs = Math.round(performance.now() - start);

      if (response.ok) {
        const body = (await response.text()).slice(0, 4096);
        const validManifest = body.includes("#EXTM3U") && body.length > 15;
        if (validManifest) {
          onlineStreams += 1;
          streamDetails.push({
            id: camera.id,
            name: camera.name,
            streamUrl: camera.streamUrl,
            status: "online",
            statusCode: 200,
            latencyMs,
          });
        } else {
          offlineStreams += 1;
          streamDetails.push({
            id: camera.id,
            name: camera.name,
            streamUrl: camera.streamUrl,
            status: "empty_or_invalid_manifest",
            statusCode: response.status,
            latencyMs,
            error: "Response 200 tetapi isi manifest HLS kosong atau tidak valid",
          });
        }
      } else {
        offlineStreams += 1;
        streamDetails.push({
          id: camera.id,
          name: camera.name,
          streamUrl: camera.streamUrl,
          status: "http_error",
          statusCode: response.status,
          latencyMs,
          error: `HTTP ${response.status} ${response.statusText}`,
        });
      }
    } catch (error) {
      const latencyMs = Math.round(performance.now() - start);
      offlineStreams += 1;
      const isTimeout = error.name === "TimeoutError" || error.name === "AbortError";
      streamDetails.push({
        id: camera.id,
        name: camera.name,
        streamUrl: camera.streamUrl,
        status: "network_error",
        statusCode: null,
        latencyMs,
        error: isTimeout ? "Timeout (>6s)" : error.message,
      });
    }
  }

  // 2. Scrape Freshness & Upstream Check
  const sources = Array.isArray(cameraDocument.sources)
    ? cameraDocument.sources
    : cameraDocument.source
      ? [cameraDocument.source]
      : [];
  const roadSource = sources.find((s) => s.road === highwayId);
  const lastScrapedAt = roadSource?.scrapedAt ?? cameras.find((c) => c.scrapedAt)?.scrapedAt ?? null;
  const ageHours = lastScrapedAt
    ? Number(((Date.now() - Date.parse(lastScrapedAt)) / (1000 * 3600)).toFixed(1))
    : null;

  let livePageReachable = false;
  let upstreamChangedCount = 0;
  let liveScrapedCount = 0;

  try {
    const pageUrl = cameraPageUrl(highwayId);
    const pageRes = await fetchImpl(pageUrl, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(10000),
    });
    if (pageRes.ok) {
      livePageReachable = true;
      const html = await pageRes.text();
      const liveScraped = parseCameraPage(html, { road: highwayId, sourcePage: pageUrl });
      liveScrapedCount = liveScraped.length;
      const localUrlById = new Map(cameras.map((c) => [c.id, c.streamUrl]));
      for (const scrapedCam of liveScraped) {
        const localUrl = localUrlById.get(scrapedCam.id);
        if (localUrl && localUrl !== scrapedCam.streamUrl) {
          upstreamChangedCount += 1;
        }
      }
    }
  } catch {
    livePageReachable = false;
  }

  const isStale = (ageHours !== null && ageHours > 24) || upstreamChangedCount > 0;

  // 3. Geography & OSM Integrity
  const coordinates = feature.geometry?.coordinates ?? [];
  const canonicalLengthM = feature.properties?.canonicalLengthM ?? 0;
  const locatedCameras = cameras.filter((c) => c.curationStatus !== "needs_review").length;
  const needsReviewCameras = cameras.filter((c) => c.curationStatus === "needs_review").length;
  const gatesCount = cameras.filter((c) => c.cameraType === "toll_gate").length;

  const validKms = cameras.map((c) => c.km).filter(Number.isFinite);
  let kmSpanDiscrepancy = false;
  let minKm = null;
  let maxKm = null;
  let cameraSpanM = 0;

  if (validKms.length >= 2) {
    minKm = Math.min(...validKms);
    maxKm = Math.max(...validKms);
    cameraSpanM = Math.round((maxKm - minKm) * 1000);
    if (canonicalLengthM > 0 && cameraSpanM > canonicalLengthM * 1.25 && (cameraSpanM - canonicalLengthM) > 2000) {
      kmSpanDiscrepancy = true;
    }
  }

  const issues = [];
  if (offlineStreams > 0) {
    issues.push(`${offlineStreams} dari ${cameras.length} stream kamera tidak dapat dimuat / offline.`);
  }
  if (upstreamChangedCount > 0) {
    issues.push(`${upstreamChangedCount} URL stream di website Bina Marga telah berganti dan belum diperbarui.`);
  } else if (ageHours !== null && ageHours > 24) {
    issues.push(`Data scrape telah berusia ${ageHours} jam (disarankan refresh scrape berkala).`);
  }
  if (kmSpanDiscrepancy) {
    issues.push(
      `Rentang KM kamera (${minKm} s.d. ${maxKm} = ${(cameraSpanM / 1000).toFixed(1)} km) jauh melebihi panjang geometri tol (${(canonicalLengthM / 1000).toFixed(1)} km). Terindikasi geometri terpotong atau segmen OSM hilang.`
    );
  }
  if (needsReviewCameras > 0) {
    issues.push(`${needsReviewCameras} kamera berstatus 'needs_review' (belum terpetakan ke geometri).`);
  }
  if (coordinates.length < 2 || canonicalLengthM < 500) {
    issues.push("Geometri jalan tol terlalu pendek atau tidak valid.");
  }

  let overallStatus = "healthy";
  if (
    (cameras.length > 0 && offlineStreams / cameras.length >= 0.35) ||
    coordinates.length < 2 ||
    canonicalLengthM < 500 ||
    kmSpanDiscrepancy
  ) {
    overallStatus = "critical";
  } else if (issues.length > 0) {
    overallStatus = "warning";
  }

  return {
    highwayId,
    highwayName,
    overallStatus,
    streams: {
      total: cameras.length,
      online: onlineStreams,
      offline: offlineStreams,
      healthPercent: cameras.length > 0 ? Math.round((onlineStreams / cameras.length) * 100) : 0,
      details: streamDetails,
    },
    scraping: {
      lastScrapedAt,
      ageHours,
      isStale,
      upstreamChangedCount,
      liveScrapedCount,
      livePageReachable,
    },
    geography: {
      canonicalLengthM,
      pointCount: coordinates.length,
      startNodeId: feature.properties?.osmStartNodeId ?? null,
      endNodeId: feature.properties?.osmEndNodeId ?? null,
      totalCameras: cameras.length,
      locatedCameras,
      needsReviewCameras,
      gatesCount,
      boundsValid: coordinates.length >= 2 && canonicalLengthM >= 500,
    },
    issues,
  };
}

export async function refreshRoadScrape({
  cameraDocument,
  highwayId,
  fetchImpl = globalThis.fetch,
}) {
  const sourcePage = cameraPageUrl(highwayId);
  const scrapedAt = new Date().toISOString();

  const response = await fetchImpl(sourcePage, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "User-Agent": USER_AGENT,
    },
    redirect: "follow",
    signal: AbortSignal.timeout(20000),
  });

  if (!response.ok) {
    throw new Error(`Bina Marga mengembalikan HTTP ${response.status}`);
  }

  const html = await response.text();
  const scraped = parseCameraPage(html, { road: highwayId, sourcePage, scrapedAt });
  if (scraped.length === 0) {
    throw new Error("Tidak ada kamera HLS ditemukan pada halaman Bina Marga untuk ruas ini.");
  }

  const initialUrlMap = new Map((cameraDocument.cameras ?? []).map((c) => [c.id, c.streamUrl]));
  let updatedCount = 0;
  for (const item of scraped) {
    const oldUrl = initialUrlMap.get(item.id);
    if (oldUrl && oldUrl !== item.streamUrl) {
      updatedCount += 1;
    }
  }

  const merged = mergeCameraData(scraped, cameraDocument);
  const document = buildCameraDocument(merged, { road: highwayId, sourcePage, scrapedAt }, cameraDocument);

  return {
    document,
    highwayId,
    totalScraped: scraped.length,
    updatedCount,
  };
}

export async function repairHighwayGeography({
  cameraDocument,
  highwayData,
  highwayConfig,
  highwayId,
  fetchImpl = globalThis.fetch,
}) {
  const definition = (highwayConfig.highways ?? []).find((h) => h.id === highwayId);
  if (!definition) {
    throw new Error(`Definisi ruas tidak ditemukan di highways.config.json: ${highwayId}`);
  }

  // 1. Rebuild GeoJSON Feature from OSM
  const rebuiltFeature = await buildFeature(definition);
  const otherFeatures = (highwayData.features ?? []).filter(
    (f) => (f.properties?.id ?? f.id) !== highwayId,
  );
  const nextHighwayData = {
    ...highwayData,
    features: [...otherFeatures, rebuiltFeature],
  };

  // 2. Re-provision KM Stationing
  const provisionedAt = new Date().toISOString();
  let provisionedCount = 0;
  let nextCameras = (cameraDocument.cameras ?? []).map((camera) => {
    if (camera.highwayId !== highwayId) return camera;
    if (camera.curationStatus === "verified" || camera.curationStatus === "provisional_landmark") {
      return camera;
    }
    const tempCam = camera.curationStatus === "provisional_stationing"
      ? { ...camera, coordinates: null, roadPositionM: null }
      : camera;
    const estimate = estimateCameraOnHighway(tempCam, rebuiltFeature);
    const hasExplicitDirection = camera.side === "A" || camera.side === "B";
    if (!estimate || !hasExplicitDirection) {
      return {
        ...camera,
        coordinates: null,
        roadPositionM: null,
        enabled: false,
        curationStatus: "needs_review",
        locationReview: null,
      };
    }
    provisionedCount += 1;
    return {
      ...camera,
      coordinates: estimate.coordinate.map((v) => Number(v.toFixed(7))),
      roadPositionM: Math.round(estimate.roadPositionM),
      enabled: true,
      curationStatus: "provisional_stationing",
      locationReview: {
        method: "osm_route_stationing_interpolation",
        status: "provisional",
        stationingKm: camera.km,
        cameraLabelSource: camera.sourcePage,
        roadGeometrySource: rebuiltFeature.properties?.osmSource,
        roadSnapshotSource: rebuiltFeature.properties?.osmSnapshotSource,
        directionConventionSource: "https://bpjt.pu.go.id/telah-uji-laik-fungsi-jalan-tol-indralaya-prabumulih-akan-segera-dioperasikan/",
        provisionedAt,
        warning: "Interpolated from provider KM along reviewed OSM road geometry; not a surveyed camera coordinate.",
      },
    };
  });

  // 3. Auto-locate & Apply Gate Landmarks
  let gateMatchesCount = 0;
  let workingDoc = { ...cameraDocument, cameras: nextCameras };
  try {
    const gateLocatorResult = await locateGatesForHighway({
      cameraDocument: workingDoc,
      highwayData: nextHighwayData,
      highwayId,
      fetchImpl,
    });
    const maxMatchRadiusM = rebuiltFeature.properties?.maxMatchRadiusM ?? 150;
    for (const match of gateLocatorResult.matches ?? []) {
      if (match.projectionDistanceM <= maxMatchRadiusM && match.sourceCoordinates) {
        const verifyRes = verifyGateCamera(workingDoc, nextHighwayData, {
          id: match.id,
          longitude: match.sourceCoordinates[0],
          latitude: match.sourceCoordinates[1],
          sourceUrl: match.sourceUrl,
          osmNode: match.osmNode,
          notes: match.candidateName,
          allowDistantProjection: false,
        });
        workingDoc = verifyRes.document;
        gateMatchesCount += 1;
      }
    }
  } catch {
    // optional gate matching fallback
  }

  return {
    cameraDocument: workingDoc,
    highwayData: nextHighwayData,
    provisionedCount,
    gateMatchesCount,
  };
}
