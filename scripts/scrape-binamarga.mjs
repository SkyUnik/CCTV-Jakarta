#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  buildCameraDocument,
  cameraPageUrl,
  mergeCameraData,
  parseCameraPage,
} from "./lib/binamarga.mjs";

const DEFAULT_OUTPUT = "docs/data/cameras.scraped.json";
const USER_AGENT =
  "Jakarta-Toll-CCTV-Metadata-Collector/0.1 (+public-page-only; contact repository owner)";

function usage() {
  return `Usage:
  npm run scrape -- --road dalam-kota [--out path] [--merge curated.json]

Options:
  --road   Public Bina Marga id_ruas slug (default: dalam-kota)
  --out    JSON output path (default: ${DEFAULT_OUTPUT})
  --merge  Existing curated JSON whose editorial fields must be preserved
  --help   Show this help
`;
}

function parseArguments(argv) {
  const options = { road: "dalam-kota", out: DEFAULT_OUTPUT, merge: null };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") return { help: true };
    if (!["--road", "--out", "--merge"].includes(argument)) {
      throw new Error(`Unknown argument: ${argument}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${argument}`);
    }
    options[argument.slice(2)] = value;
    index += 1;
  }

  return options;
}

async function fetchPublicPage(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "User-Agent": USER_AGENT,
    },
    redirect: "follow",
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    throw new Error(`Bina Marga returned HTTP ${response.status}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("text/html")) {
    throw new Error(`Expected HTML but received ${contentType || "an unknown type"}`);
  }

  return response.text();
}

async function readJson(path) {
  return JSON.parse(await readFile(resolve(path), "utf8"));
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage());
    return;
  }

  const sourcePage = cameraPageUrl(options.road);
  const scrapedAt = new Date().toISOString();
  const html = await fetchPublicPage(sourcePage);
  const scraped = parseCameraPage(html, {
    road: options.road,
    sourcePage,
    scrapedAt,
  });

  if (scraped.length === 0) {
    throw new Error(
      "No public HLS cameras were found; the provider page structure may have changed.",
    );
  }

  const existing = options.merge ? await readJson(options.merge) : null;
  const cameras = mergeCameraData(scraped, existing);
  const document = buildCameraDocument(cameras, {
    road: options.road,
    sourcePage,
    scrapedAt,
  }, existing);

  const outputPath = resolve(options.out);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");

  const ambiguous = cameras.filter(
    (camera) => camera.side === null || camera.coordinates === null,
  ).length;
  process.stdout.write(
    `Collected ${cameras.length} public camera records for ${options.road}.\n` +
      `${ambiguous} record(s) still require manual curation.\n` +
      `Saved ${outputPath}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`Collector failed: ${error.message}\n`);
  process.exitCode = 1;
});
