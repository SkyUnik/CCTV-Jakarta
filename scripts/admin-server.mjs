#!/usr/bin/env node

import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { readFile, rename, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";

import { hardDeleteCamera, saveAdminCamera } from "./lib/admin-camera.mjs";
import { commitAdminChanges, inspectAdminGit, pushCurrentBranch } from "./lib/admin-git.mjs";
import { readJsonBody, validateAdminRequest } from "./lib/admin-security.mjs";
import { verifyCamera } from "./lib/camera-curation.mjs";
import { verifyGateCamera } from "./lib/gate-curation.mjs";
import { locateGatesForHighway } from "./lib/gate-locator.mjs";
import { checkHighwayHealth, refreshRoadScrape, repairHighwayGeography } from "./lib/highway-health.mjs";
import { bulkDeleteCameras, findDuplicateCameras } from "./lib/camera-duplicates.mjs";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const adminRoot = resolve(repositoryRoot, "admin");
const docsRoot = resolve(repositoryRoot, "docs");
const cameraPath = resolve(repositoryRoot, "docs/data/cameras.json");
const highwayPath = resolve(repositoryRoot, "docs/data/highways.geojson");
const highwayConfigPath = resolve(repositoryRoot, "data-source/highways.config.json");
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".geojson": "application/geo+json; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

async function readData() {
  const [cameraText, highwayText] = await Promise.all([
    readFile(cameraPath, "utf8"),
    readFile(highwayPath, "utf8"),
  ]);
  return {
    cameraDocument: JSON.parse(cameraText),
    highwayData: JSON.parse(highwayText),
  };
}

async function writeCameraDocument(document) {
  const temporary = `${cameraPath}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  await rename(temporary, cameraPath);
}

async function writeHighwayConfig(config) {
  const temporary = `${highwayConfigPath}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  await rename(temporary, highwayConfigPath);
}

async function writeHighwayData(data) {
  const temporary = `${highwayPath}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await rename(temporary, highwayPath);
}

function json(response, status, body) {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
  }).end(JSON.stringify(body));
}

async function serveFile(response, root, pathname) {
  const requested = resolve(root, `.${pathname}`);
  if (requested !== root && !requested.startsWith(`${root}${sep}`)) return false;
  try {
    const info = await stat(requested);
    const file = info.isDirectory() ? resolve(requested, "index.html") : requested;
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'self'; connect-src 'self' https:; img-src 'self' data: https:; media-src 'self' https: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; worker-src 'self' blob:; object-src 'none'; frame-ancestors 'none'",
      "Content-Type": contentTypes[extname(file)] ?? "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
    });
    createReadStream(file).pipe(response);
    return true;
  } catch {
    return false;
  }
}

export function createAdminServer({ port = Number(process.env.ADMIN_PORT ?? 4175) } = {}) {
  const nonce = randomBytes(24).toString("base64url");
  const server = createServer(async (request, response) => {
    try {
      validateAdminRequest(request, nonce, port);
      const requestUrl = new URL(request.url, `http://127.0.0.1:${port}`);
      const pathname = decodeURIComponent(requestUrl.pathname);

      if (pathname === "/api/admin/state" && request.method === "GET") {
        const [{ cameraDocument, highwayData }, git] = await Promise.all([
          readData(),
          inspectAdminGit({ cwd: repositoryRoot }),
        ]);
        json(response, 200, {
          nonce,
          cameras: cameraDocument.cameras ?? [],
          highways: (highwayData.features ?? []).map((feature) => ({
            id: feature.properties?.id ?? feature.id,
            name: feature.properties?.name ?? feature.id,
          })),
          git,
        });
        return;
      }

      if (pathname === "/api/admin/cameras" && request.method === "POST") {
        const payload = await readJsonBody(request);
        const { cameraDocument, highwayData } = await readData();
        const result = saveAdminCamera(cameraDocument, highwayData, payload);
        await writeCameraDocument(result.document);
        json(response, result.created ? 201 : 200, { camera: result.camera, created: result.created });
        return;
      }

      if (pathname === "/api/admin/locate-gates" && request.method === "POST") {
        const payload = await readJsonBody(request);
        const { cameraDocument, highwayData } = await readData();
        const result = await locateGatesForHighway({
          cameraDocument,
          highwayData,
          highwayId: payload.highwayId,
        });
        json(response, 200, result);
        return;
      }

      if (pathname === "/api/admin/apply-gate-matches" && request.method === "POST") {
        const payload = await readJsonBody(request);
        const { cameraDocument, highwayData } = await readData();
        let document = cameraDocument;
        const updatedCameras = [];
        for (const item of payload.matches ?? []) {
          const result = verifyGateCamera(document, highwayData, {
            id: item.id,
            longitude: item.longitude,
            latitude: item.latitude,
            sourceUrl: item.sourceUrl,
            osmNode: item.osmNode,
            notes: item.notes,
            allowDistantProjection: Boolean(item.allowDistantProjection),
          });
          document = result.document;
          updatedCameras.push(result.camera);
        }
        await writeCameraDocument(document);
        json(response, 200, { updated: updatedCameras });
        return;
      }

      if (pathname === "/api/admin/apply-km-estimates" && request.method === "POST") {
        const payload = await readJsonBody(request);
        const { cameraDocument, highwayData } = await readData();
        const featureById = new Map((highwayData.features ?? []).map((f) => [f.properties?.id ?? f.id, f]));
        const updateMap = new Map((payload.updates ?? []).map((u) => [u.id, u]));
        const provisionedAt = new Date().toISOString();
        const updatedCameras = [];

        const nextCameras = (cameraDocument.cameras ?? []).map((camera) => {
          const update = updateMap.get(camera.id);
          if (!update) return camera;

          const feature = featureById.get(camera.highwayId);
          const updated = {
            ...camera,
            coordinates: update.coordinates,
            roadPositionM: update.roadPositionM,
            enabled: true,
            curationStatus: "provisional_stationing",
            locationReview: {
              method: "osm_route_stationing_interpolation",
              status: "provisional",
              stationingKm: camera.km,
              cameraLabelSource: camera.sourcePage,
              roadGeometrySource: feature?.properties?.osmSource,
              roadSnapshotSource: feature?.properties?.osmSnapshotSource,
              directionConventionSource: "https://bpjt.pu.go.id/telah-uji-laik-fungsi-jalan-tol-indralaya-prabumulih-akan-segera-dioperasikan/",
              provisionedAt,
              warning: "Interpolated from provider KM along reviewed OSM road geometry; not a surveyed camera coordinate.",
            },
          };
          updatedCameras.push(updated);
          return updated;
        });

        const document = { ...cameraDocument, cameras: nextCameras };
        await writeCameraDocument(document);
        json(response, 200, { updated: updatedCameras });
        return;
      }

      if (pathname === "/api/admin/rename-highway" && request.method === "POST") {
        const payload = await readJsonBody(request);
        const { highwayId, newName } = payload;
        if (!highwayId || !newName?.trim()) {
          throw new Error("highwayId and newName are required");
        }
        const trimmedName = newName.trim();

        // 1. Update data-source/highways.config.json
        const highwayConfig = JSON.parse(await readFile(highwayConfigPath, "utf8"));
        const configHighway = (highwayConfig.highways ?? []).find((h) => h.id === highwayId);
        if (!configHighway) throw new Error(`Highway not found in config: ${highwayId}`);
        configHighway.properties = configHighway.properties ?? {};
        configHighway.properties.name = trimmedName;
        await writeHighwayConfig(highwayConfig);

        // 2. Update docs/data/highways.geojson
        const { highwayData } = await readData();
        const feature = (highwayData.features ?? []).find((f) => (f.properties?.id ?? f.id) === highwayId);
        if (feature) {
          feature.properties = feature.properties ?? {};
          feature.properties.name = trimmedName;
          await writeHighwayData(highwayData);
        }

        json(response, 200, { highwayId, name: trimmedName });
        return;
      }

      if (pathname === "/api/admin/bulk-update-direction" && request.method === "POST") {
        const payload = await readJsonBody(request);
        const { highwayId, direction } = payload;
        if (!highwayId) {
          throw new Error("highwayId is required");
        }

        const { cameraDocument } = await readData();
        let updatedCount = 0;

        const nextCameras = (cameraDocument.cameras ?? []).map((camera) => {
          if (camera.highwayId !== highwayId) return camera;
          updatedCount += 1;

          if (direction === "A/B") {
            if (camera.cameraType === "toll_gate") {
              return {
                ...camera,
                side: null,
                directions: ["A", "B"],
              };
            }
            return {
              ...camera,
              cameraType: "wide_view",
              side: null,
              directions: ["A", "B"],
              directionReview: {
                status: "confirmed",
                method: "admin_wide_view_selection",
              },
            };
          } else if (direction === "A" || direction === "B") {
            const updated = { ...camera, side: direction };
            delete updated.directions;
            delete updated.directionReview;
            if (updated.cameraType === "wide_view" || updated.cameraType === "toll_gate") {
              delete updated.cameraType;
            }
            return updated;
          } else {
            // "Belum pasti" / null
            const updated = { ...camera, side: null, enabled: false };
            delete updated.directions;
            delete updated.directionReview;
            if (updated.cameraType === "wide_view" || updated.cameraType === "toll_gate") {
              delete updated.cameraType;
            }
            return updated;
          }
        });

        const document = { ...cameraDocument, cameras: nextCameras };
        await writeCameraDocument(document);
        json(response, 200, { highwayId, updatedCount, direction });
        return;
      }

      if (pathname === "/api/admin/bulk-update-enabled" && request.method === "POST") {
        const payload = await readJsonBody(request);
        const { highwayId, enabled = true, bypassValidation = false } = payload;
        if (!highwayId) {
          throw new Error("highwayId is required");
        }

        const { cameraDocument } = await readData();
        let updatedCount = 0;
        let skippedCount = 0;

        const nextCameras = (cameraDocument.cameras ?? []).map((camera) => {
          if (camera.highwayId !== highwayId) return camera;

          if (enabled) {
            const hasCoords = Array.isArray(camera.coordinates) &&
              camera.coordinates.length === 2 &&
              Number.isFinite(camera.coordinates[0]) &&
              Number.isFinite(camera.coordinates[1]) &&
              Number.isFinite(camera.roadPositionM);

            const hasDirection = (camera.side === "A" || camera.side === "B") ||
              (camera.side === null &&
               ((camera.cameraType === "toll_gate" && camera.directions?.includes("A") && camera.directions?.includes("B")) ||
                (camera.cameraType === "wide_view" && camera.directionReview?.status === "confirmed" && camera.directions?.includes("A") && camera.directions?.includes("B"))));

            if (hasCoords && hasDirection) {
              const curationStatus = camera.curationStatus === "needs_review" || !camera.curationStatus
                ? (camera.cameraType === "toll_gate" ? "provisional_landmark" : "provisional_stationing")
                : camera.curationStatus;

              const locationReview = camera.locationReview ? { ...camera.locationReview } : {
                method: camera.cameraType === "toll_gate" ? "osm_toll_booth_projection" : "osm_route_stationing_interpolation",
                status: "provisional",
                warning: "Provisional coordinate enabled via bulk admin action.",
              };

              if (curationStatus !== "verified" && locationReview.status !== "provisional") {
                locationReview.status = "provisional";
              }

              updatedCount += 1;
              return {
                ...camera,
                enabled: true,
                curationStatus,
                locationReview,
              };
            } else {
              skippedCount += 1;
              return camera;
            }
          } else {
            updatedCount += 1;
            return {
              ...camera,
              enabled: false,
            };
          }
        });

        const document = { ...cameraDocument, cameras: nextCameras };
        await writeCameraDocument(document);
        json(response, 200, { highwayId, updatedCount, skippedCount, enabled, bypassValidation });
        return;
      }

      if (pathname === "/api/admin/highway-health" && request.method === "POST") {
        const payload = await readJsonBody(request);
        const { cameraDocument, highwayData } = await readData();
        const result = await checkHighwayHealth({
          cameraDocument,
          highwayData,
          highwayId: payload.highwayId,
        });
        json(response, 200, result);
        return;
      }

      if (pathname === "/api/admin/refresh-road-scrape" && request.method === "POST") {
        const payload = await readJsonBody(request);
        const { cameraDocument } = await readData();
        const result = await refreshRoadScrape({
          cameraDocument,
          highwayId: payload.highwayId,
        });
        await writeCameraDocument(result.document);
        json(response, 200, {
          highwayId: result.highwayId,
          totalScraped: result.totalScraped,
          updatedCount: result.updatedCount,
        });
        return;
      }

      if (pathname === "/api/admin/repair-highway-geography" && request.method === "POST") {
        const payload = await readJsonBody(request);
        const { cameraDocument, highwayData } = await readData();
        const highwayConfig = JSON.parse(await readFile(highwayConfigPath, "utf8"));
        const result = await repairHighwayGeography({
          cameraDocument,
          highwayData,
          highwayConfig,
          highwayId: payload.highwayId,
        });
        await Promise.all([
          writeCameraDocument(result.cameraDocument),
          writeHighwayData(result.highwayData),
        ]);
        json(response, 200, {
          highwayId: payload.highwayId,
          provisionedCount: result.provisionedCount,
          gateMatchesCount: result.gateMatchesCount,
        });
        return;
      }

      if (pathname === "/api/admin/find-duplicate-cameras" && request.method === "POST") {
        const payload = await readJsonBody(request);
        const { cameraDocument } = await readData();
        const result = findDuplicateCameras(cameraDocument, { highwayId: payload.highwayId || null });
        json(response, 200, result);
        return;
      }

      if (pathname === "/api/admin/bulk-delete-cameras" && request.method === "POST") {
        const payload = await readJsonBody(request);
        const { cameraDocument } = await readData();
        const result = bulkDeleteCameras(cameraDocument, payload.cameraIds);
        await writeCameraDocument(result.document);
        json(response, 200, {
          deletedCount: result.deletedCount,
          remainingCount: result.document.cameras?.length ?? 0,
        });
        return;
      }

      const cameraMatch = pathname.match(/^\/api\/admin\/cameras\/([^/]+)$/);
      if (cameraMatch && request.method === "DELETE") {
        const id = decodeURIComponent(cameraMatch[1]);
        const payload = await readJsonBody(request);
        const { cameraDocument } = await readData();
        const result = hardDeleteCamera(cameraDocument, id, payload.confirmation);
        await writeCameraDocument(result.document);
        json(response, 200, { deleted: result.camera });
        return;
      }

      const verifyMatch = pathname.match(/^\/api\/admin\/cameras\/([^/]+)\/verify$/);
      if (verifyMatch && request.method === "POST") {
        const id = decodeURIComponent(verifyMatch[1]);
        const payload = await readJsonBody(request);
        const { cameraDocument, highwayData } = await readData();
        const result = verifyCamera(cameraDocument, highwayData, { ...payload, id });
        await writeCameraDocument(result.document);
        json(response, 200, { camera: result.camera, projection: result.projection });
        return;
      }

      if (pathname === "/api/admin/git" && request.method === "GET") {
        json(response, 200, await inspectAdminGit({ cwd: repositoryRoot }));
        return;
      }
      if (pathname === "/api/admin/validate" && request.method === "POST") {
        const result = await execFileAsync("npm", ["test"], {
          cwd: repositoryRoot,
          encoding: "utf8",
          maxBuffer: 20_000_000,
        });
        json(response, 200, { output: `${result.stdout}${result.stderr}`.trim() });
        return;
      }
      if (pathname === "/api/admin/commit" && request.method === "POST") {
        const payload = await readJsonBody(request);
        const state = await commitAdminChanges({ cwd: repositoryRoot, ...payload });
        json(response, 200, state);
        return;
      }
      if (pathname === "/api/admin/push" && request.method === "POST") {
        const payload = await readJsonBody(request);
        json(response, 200, await pushCurrentBranch({ cwd: repositoryRoot, ...payload }));
        return;
      }

      if (pathname === "/") {
        response.writeHead(302, { Location: "/admin/" }).end();
        return;
      }
      if (pathname.startsWith("/site/")) {
        if (await serveFile(response, docsRoot, pathname.slice("/site".length))) return;
      } else if (pathname.startsWith("/admin/")) {
        if (await serveFile(response, adminRoot, pathname.slice("/admin".length))) return;
      }
      json(response, 404, { error: "Not found" });
    } catch (error) {
      json(response, /nonce|origin|loopback/i.test(error.message) ? 403 : 400, {
        error: error.message,
      });
    }
  });
  return { nonce, port, server };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { port, server } = createAdminServer();
  server.listen(port, "127.0.0.1", () => {
    process.stdout.write(`Camera audit: http://127.0.0.1:${port}/admin/\n`);
  });
}
