#!/usr/bin/env node

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import { extname, resolve, sep } from "node:path";

const root = resolve("docs");
const port = Number(process.env.PORT ?? 4173);
const previewHost = process.env.PREVIEW_HOST ?? "127.0.0.1";
const requestedBasePath = process.env.BASE_PATH ?? "/";
const basePath = `/${requestedBasePath.split("/").filter(Boolean).join("/")}`.replace(/^\/$/, "");
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".geojson": "application/geo+json; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url, "http://localhost");
    const fullPathname = decodeURIComponent(requestUrl.pathname);
    if (basePath && fullPathname !== basePath && !fullPathname.startsWith(`${basePath}/`)) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
      return;
    }
    const pathname = basePath ? fullPathname.slice(basePath.length) || "/" : fullPathname;
    const requested = resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
    if (requested !== root && !requested.startsWith(`${root}${sep}`)) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    const fileStat = await stat(requested);
    const file = fileStat.isDirectory() ? resolve(requested, "index.html") : requested;
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Type": contentTypes[extname(file)] ?? "application/octet-stream",
    });
    createReadStream(file).pipe(response);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
  }
}).listen(port, previewHost, () => {
  process.stdout.write(`Local preview: http://127.0.0.1:${port}${basePath}/\n`);
  if (previewHost === "0.0.0.0") {
    for (const addresses of Object.values(networkInterfaces())) {
      for (const address of addresses ?? []) {
        if (address.family === "IPv4" && !address.internal) {
          process.stdout.write(`iPhone demo: http://${address.address}:${port}${basePath}/?demo=1\n`);
        }
      }
    }
  }
});
