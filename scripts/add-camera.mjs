#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  appendManualCamera,
  createManualCamera,
} from "./lib/manual-camera.mjs";

const DEFAULT_FILE = "docs/data/cameras.json";

function usage() {
  return `Usage:
  npm run camera:add -- --name "Camera name" --url https://host/live.m3u8 \\
    --source-page https://provider.example/cameras [options]

Options:
  --file         Camera JSON file (default: ${DEFAULT_FILE})
  --road         Highway ID (default: dalam-kota)
  --name         Display name (required)
  --url          Public HTTPS .m3u8 URL (required)
  --source-page  Public page documenting the camera (recommended)
  --provider-id  Provider's stable camera ID, when known
  --side         Parsed/provider A or B hint; still requires review
  --km           Kilometer value as a decimal number
  --help         Show this help
`;
}

function parseArguments(argv) {
  const options = { file: DEFAULT_FILE, road: "dalam-kota" };
  const allowed = new Set([
    "--file",
    "--road",
    "--name",
    "--url",
    "--source-page",
    "--provider-id",
    "--side",
    "--km",
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") return { help: true };
    if (!allowed.has(argument)) throw new Error(`Unknown argument: ${argument}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${argument}`);
    options[argument.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
    index += 1;
  }
  if (!options.name?.trim()) throw new Error("--name is required");
  if (!options.url) throw new Error("--url is required");
  return options;
}

async function readDocument(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return { schemaVersion: 1, cameras: [] };
    throw error;
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage());
    return;
  }
  const path = resolve(options.file);
  const document = await readDocument(path);
  const camera = createManualCamera(options);
  const updated = appendManualCamera(document, camera);
  await writeFile(path, `${JSON.stringify(updated, null, 2)}\n`, "utf8");
  process.stdout.write(
    `Added ${camera.name} as ${camera.id}.\n` +
    "It remains disabled until direction and coordinates are verified.\n",
  );
}

main().catch((error) => {
  process.stderr.write(`Add camera failed: ${error.message}\n`);
  process.exitCode = 1;
});
