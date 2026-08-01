#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { verifyCamera } from "./lib/camera-curation.mjs";

const DEFAULT_FILE = "docs/data/cameras.json";
const DEFAULT_HIGHWAYS = "docs/data/highways.geojson";

function usage() {
  return `Usage:
  npm run camera:verify -- --id CAMERA_ID --side A --longitude 106.8 --latitude -6.2

Options:
  --file        Camera JSON file (default: ${DEFAULT_FILE})
  --highways    Highway GeoJSON file (default: ${DEFAULT_HIGHWAYS})
  --id          Camera ID to verify (required)
  --side        Standardized A or B (required)
  --longitude   Manually verified longitude (required)
  --latitude    Manually verified latitude (required)
  --notes       Optional review note
  --help        Show this help
`;
}

function parseArguments(argv) {
  const options = { file: DEFAULT_FILE, highways: DEFAULT_HIGHWAYS };
  const allowed = new Set([
    "--file",
    "--highways",
    "--id",
    "--side",
    "--longitude",
    "--latitude",
    "--notes",
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") return { help: true };
    if (!allowed.has(argument)) throw new Error(`Unknown argument: ${argument}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for ${argument}`);
    }
    options[argument.slice(2)] = value;
    index += 1;
  }
  for (const required of ["id", "side", "longitude", "latitude"]) {
    if (options[required] === undefined) throw new Error(`--${required} is required`);
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
  const result = verifyCamera(document, highwayData, options);
  await writeFile(cameraPath, `${JSON.stringify(result.document, null, 2)}\n`, "utf8");
  process.stdout.write(
    `Verified ${result.camera.id} on side ${result.camera.side}.\n` +
      `Road position: ${result.camera.roadPositionM} m; ` +
      `distance from geometry: ${Math.round(result.projection.distanceM)} m.\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`Camera verification failed: ${error.message}\n`);
  process.exitCode = 1;
});
