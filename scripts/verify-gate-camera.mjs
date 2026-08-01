#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { verifyGateCamera } from "./lib/gate-curation.mjs";

const DEFAULT_FILE = "docs/data/cameras.json";
const DEFAULT_HIGHWAYS = "docs/data/highways.geojson";

function usage() {
  return `Usage:
  npm run camera:verify-gate -- --id CAMERA_ID --longitude 106.9 --latitude -6.1 --source-url https://www.openstreetmap.org/node/123 --osm-node 123

Options:
  --file        Camera JSON file (default: ${DEFAULT_FILE})
  --highways    Highway GeoJSON file (default: ${DEFAULT_HIGHWAYS})
  --id          Camera ID (required)
  --longitude   Public toll-gate landmark longitude (required)
  --latitude    Public toll-gate landmark latitude (required)
  --source-url  Public evidence URL (required)
  --osm-node    Optional OpenStreetMap node ID
  --notes       Optional review note
  --allow-distant-projection  Explicitly accept a projection beyond the road limit
  --help        Show this help
`;
}

function parseArguments(argv) {
  const options = { file: DEFAULT_FILE, highways: DEFAULT_HIGHWAYS };
  const valueOptions = new Set([
    "--file", "--highways", "--id", "--longitude", "--latitude",
    "--source-url", "--osm-node", "--notes",
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") return { help: true };
    if (argument === "--allow-distant-projection") {
      options.allowDistantProjection = true;
      continue;
    }
    if (!valueOptions.has(argument)) throw new Error(`Unknown argument: ${argument}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for ${argument}`);
    }
    options[argument.slice(2).replaceAll("-", "_")] = value;
    index += 1;
  }
  options.sourceUrl = options.source_url;
  options.osmNode = options.osm_node;
  for (const required of ["id", "longitude", "latitude", "sourceUrl"]) {
    if (options[required] === undefined) throw new Error(`--${required.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)} is required`);
  }
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage());
    return;
  }
  const cameraPath = resolve(options.file);
  const document = JSON.parse(await readFile(cameraPath, "utf8"));
  const highwayData = JSON.parse(await readFile(resolve(options.highways), "utf8"));
  const result = verifyGateCamera(document, highwayData, options);
  await writeFile(cameraPath, `${JSON.stringify(result.document, null, 2)}\n`, "utf8");
  process.stdout.write(
    `Enabled ${result.camera.id} for A/B at ${result.camera.roadPositionM} m; ` +
      `${Math.round(result.projection.distanceM)} m from route geometry.\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`Gate verification failed: ${error.message}\n`);
  process.exitCode = 1;
});
