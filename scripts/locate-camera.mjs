#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { lookupOsmCandidates } from "./lib/osm-candidates.mjs";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

function usage() {
  return `Usage:
  npm run camera:locate -- --id CAMERA_ID [options]

Options:
  --file CAMERA_JSON       Default: docs/data/cameras.json
  --highways GEOJSON       Default: docs/data/highways.geojson
  --name CAMERA_NAME       Override/add a name when ID is not yet committed
  --road HIGHWAY_ID        Override/add the target road
  --km NUMBER              Override/add provider stationing
  --source-page URL        Public provider source
  --longitude NUMBER       Approximate search center only; never treated as verified
  --latitude NUMBER        Approximate search center only; never treated as verified
  --out REVIEW_JSON        Default: .review/<id>-candidates.json
  --refresh                Ignore cached public OSM responses
`;
}

function parseArguments(argv) {
  const options = {
    file: "docs/data/cameras.json",
    highways: "docs/data/highways.geojson",
    refresh: false,
  };
  const boolean = new Set(["--refresh"]);
  const allowed = new Set(["--id", "--file", "--highways", "--name", "--road", "--km", "--source-page", "--longitude", "--latitude", "--out"]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") return { help: true };
    if (boolean.has(argument)) { options.refresh = true; continue; }
    if (!allowed.has(argument)) throw new Error(`Unknown argument: ${argument}`);
    const value = argv[++index];
    if (value == null || value.startsWith("--")) throw new Error(`Missing value for ${argument}`);
    options[argument.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
  }
  if (!options.id) throw new Error("--id is required");
  options.out ??= `.review/${options.id}-candidates.json`;
  return options;
}

async function cachedFetch(url, options, refresh) {
  const key = createHash("sha256").update(`${options?.method ?? "GET"}\n${url}\n${options?.body ?? ""}`).digest("hex");
  const cachePath = resolve(repositoryRoot, `.review/osm-cache/${key}.json`);
  if (!refresh) {
    try {
      await stat(cachePath);
      const cached = JSON.parse(await readFile(cachePath, "utf8"));
      return { ok: true, status: 200, json: async () => cached };
    } catch {}
  }
  const response = await fetch(url, options);
  if (!response.ok) return response;
  const body = await response.json();
  await mkdir(dirname(cachePath), { recursive: true });
  await writeFile(cachePath, `${JSON.stringify(body, null, 2)}\n`, "utf8");
  return { ok: true, status: response.status, json: async () => body };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) { process.stdout.write(usage()); return; }
  const [cameraDocument, highwayData] = await Promise.all([
    readFile(resolve(repositoryRoot, options.file), "utf8").then(JSON.parse),
    readFile(resolve(repositoryRoot, options.highways), "utf8").then(JSON.parse),
  ]);
  const camera = (cameraDocument.cameras ?? []).find((candidate) => candidate.id === options.id) ?? null;
  const highwayId = options.road ?? camera?.highwayId;
  const highway = (highwayData.features ?? []).find((feature) =>
    (feature.properties?.id ?? feature.id) === highwayId);
  if (!highway) throw new Error(`Highway not found: ${highwayId ?? "missing --road"}`);
  const approximateCoordinates = options.longitude != null && options.latitude != null
    ? [Number(options.longitude), Number(options.latitude)]
    : null;
  if (approximateCoordinates?.some((value) => !Number.isFinite(value))) {
    throw new Error("Approximate longitude/latitude must be finite numbers");
  }
  const input = {
    cameraId: options.id,
    cameraName: options.name ?? camera?.name,
    highway,
    highwayName: highway.properties?.name,
    km: Number(options.km ?? camera?.km),
    sourcePage: options.sourcePage ?? camera?.sourcePage ?? null,
    approximateCoordinates,
  };
  const result = await lookupOsmCandidates(input, {
    fetchImpl: (url, fetchOptions) => cachedFetch(url, fetchOptions, options.refresh),
  });
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: "needs_human_review",
    warning: "Candidates are public OSM landmarks, not verified CCTV mounting coordinates. This command never enables cameras.",
    input: {
      cameraId: options.id,
      cameraName: input.cameraName,
      highwayId,
      highwayName: input.highwayName,
      km: Number.isFinite(input.km) ? input.km : null,
      sourcePage: input.sourcePage,
      approximateCoordinates,
    },
    searchTerms: result.searchTerms,
    candidates: result.candidates,
  };
  const outputPath = resolve(repositoryRoot, options.out);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`Wrote ${report.candidates.length} review candidates to ${outputPath}\nNo camera data was changed.\n`);
}

main().catch((error) => {
  process.stderr.write(`Camera lookup failed: ${error.message}\n`);
  process.exitCode = 1;
});
