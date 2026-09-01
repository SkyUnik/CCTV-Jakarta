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

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const adminRoot = resolve(repositoryRoot, "admin");
const docsRoot = resolve(repositoryRoot, "docs");
const cameraPath = resolve(repositoryRoot, "docs/data/cameras.json");
const highwayPath = resolve(repositoryRoot, "docs/data/highways.geojson");
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
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
      "Content-Security-Policy": "default-src 'self'; connect-src 'self' https:; img-src 'self' data:; media-src 'self' https: blob:; style-src 'self'; script-src 'self'; worker-src 'self' blob:; object-src 'none'; frame-ancestors 'none'",
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
