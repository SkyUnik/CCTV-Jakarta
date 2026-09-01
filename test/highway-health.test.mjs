import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  checkHighwayHealth,
  refreshRoadScrape,
  repairHighwayGeography,
} from "../scripts/lib/highway-health.mjs";

test("checkHighwayHealth audits stream connectivity, scraping freshness, and OSM geometry", async () => {
  const cameraDocument = {
    sources: [
      {
        road: "test-highway",
        scrapedAt: new Date(Date.now() - 3600 * 1000).toISOString(),
      },
    ],
    cameras: [
      {
        id: "cam-1",
        highwayId: "test-highway",
        name: "KM 01+000",
        streamUrl: "https://example.com/live/cam1.m3u8",
        coordinates: [106.8, -6.2],
        roadPositionM: 1000,
        curationStatus: "provisional_stationing",
        enabled: true,
      },
      {
        id: "cam-2",
        highwayId: "test-highway",
        name: "KM 02+000",
        streamUrl: "https://example.com/live/cam2.m3u8",
        coordinates: null,
        roadPositionM: null,
        curationStatus: "needs_review",
        enabled: false,
      },
    ],
  };

  const highwayData = {
    features: [
      {
        id: "test-highway",
        properties: {
          id: "test-highway",
          name: "Tol Test Jakarta",
          canonicalLengthM: 5000,
          osmStartNodeId: 100,
          osmEndNodeId: 200,
        },
        geometry: {
          type: "LineString",
          coordinates: [
            [106.8, -6.2],
            [106.85, -6.22],
          ],
        },
      },
    ],
  };

  const mockFetch = async (url) => {
    if (url.includes("cam1.m3u8")) {
      return {
        ok: true,
        status: 200,
        text: async () => "#EXTM3U\n#EXT-X-VERSION:3\n#EXTINF:2.0,\nseg1.ts\n",
      };
    }
    if (url.includes("cam2.m3u8")) {
      return {
        ok: false,
        status: 502,
        statusText: "Bad Gateway",
        text: async () => "",
      };
    }
    if (url.includes("binamarga.pu.go.id")) {
      return {
        ok: true,
        status: 200,
        text: async () => `
          <div class="card-cctv">
            <h5 class="card-title">KM 01+000</h5>
            <source src="https://example.com/live/cam1.m3u8">
          </div>
          <div class="card-cctv">
            <h5 class="card-title">KM 02+000</h5>
            <source src="https://example.com/live/cam2.m3u8">
          </div>
        `,
      };
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const result = await checkHighwayHealth({
    cameraDocument,
    highwayData,
    highwayId: "test-highway",
    fetchImpl: mockFetch,
  });

  assert.equal(result.highwayId, "test-highway");
  assert.equal(result.highwayName, "Tol Test Jakarta");
  assert.equal(result.streams.total, 2);
  assert.equal(result.streams.online, 1);
  assert.equal(result.streams.offline, 1);
  assert.equal(result.streams.healthPercent, 50);
  assert.equal(result.streams.details[0].status, "online");
  assert.equal(result.streams.details[1].status, "http_error");

  assert.equal(result.scraping.livePageReachable, true);
  assert.equal(result.scraping.upstreamChangedCount, 0);
  assert.equal(result.scraping.isStale, false);

  assert.equal(result.geography.canonicalLengthM, 5000);
  assert.equal(result.geography.locatedCameras, 1);
  assert.equal(result.geography.needsReviewCameras, 1);
  assert.equal(result.overallStatus, "critical"); // 1 of 2 streams offline = 50% >= 35%
  assert.ok(result.issues.length >= 2);
});

test("refreshRoadScrape updates stream URLs without erasing editorial curation", async () => {
  const cameraDocument = {
    cameras: [
      {
        id: "binamarga-test-highway-101",
        providerCameraId: "101",
        highwayId: "test-highway",
        name: "KM 05+000",
        streamUrl: "https://example.com/old/stream.m3u8",
        coordinates: [106.81, -6.21],
        roadPositionM: 5000,
        side: "A",
        curationStatus: "verified",
        notes: "Audited manually",
        locationReview: { method: "survey" },
      },
    ],
  };

  const mockHtml = `
    <div class="card-cctv">
      <h5 class="card-title">KM 05+000</h5>
      <video id="my_video_101"></video>
      <source src="https://example.com/new/stream.m3u8">
    </div>
  `;

  const mockFetch = async () => ({
    ok: true,
    status: 200,
    text: async () => mockHtml,
  });

  const result = await refreshRoadScrape({
    cameraDocument,
    highwayId: "test-highway",
    fetchImpl: mockFetch,
  });

  assert.equal(result.updatedCount, 1);
  const updatedCam = result.document.cameras.find((c) => c.id === "binamarga-test-highway-101");
  assert.equal(updatedCam.streamUrl, "https://example.com/new/stream.m3u8");
  assert.deepEqual(updatedCam.coordinates, [106.81, -6.21]);
  assert.equal(updatedCam.side, "A");
  assert.equal(updatedCam.curationStatus, "verified");
  assert.equal(updatedCam.notes, "Audited manually");
});

test("repairHighwayGeography rebuilds geometry and provisions KM stationing", async () => {
  const highwayConfig = JSON.parse(
    await readFile(new URL("../data-source/highways.config.json", import.meta.url), "utf8"),
  );
  const highwayData = JSON.parse(
    await readFile(new URL("../docs/data/highways.geojson", import.meta.url), "utf8"),
  );
  const cameraDocument = {
    cameras: [
      {
        id: "binamarga-bekasi-cawang-kampung-melayu-1327",
        highwayId: "bekasi-cawang-kampung-melayu",
        name: "GT Cipinang",
        side: "A",
        km: 0.85,
        curationStatus: "provisional_stationing",
        enabled: true,
      },
    ],
  };

  const result = await repairHighwayGeography({
    cameraDocument,
    highwayData,
    highwayConfig,
    highwayId: "bekasi-cawang-kampung-melayu",
  });

  assert.equal(result.provisionedCount, 1);
  assert.ok(result.highwayData.features.length > 0);
  const cam = result.cameraDocument.cameras.find((c) => c.id === "binamarga-bekasi-cawang-kampung-melayu-1327");
  assert.ok(Array.isArray(cam.coordinates));
  assert.ok(cam.roadPositionM > 0);
  assert.equal(cam.curationStatus, "provisional_stationing");
});
