#!/usr/bin/env node

import { readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import {
  buildCameraDocument,
  cameraPageUrl,
  mergeCameraData,
  parseCameraPage,
} from "./lib/binamarga.mjs";

const USER_AGENT =
  "Jakarta-Toll-CCTV-Metadata-Collector/0.1 (+public-page-only; contact repository owner)";

const { values } = parseArgs({
  options: {
    file: { type: "string", default: "docs/data/cameras.json" },
    config: { type: "string", default: "data-source/highways.config.json" },
    timeout: { type: "string", default: "20000" },
    delay: { type: "string", default: "300" },
  },
  strict: false,
});

const cameraPath = resolve(values.file);
const configPath = resolve(values.config);
const timeoutMs = Number(values.timeout) || 20000;
const delayMs = Number(values.delay) || 300;

async function fetchWithRetry(url, maxRetries = 2) {
  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "User-Agent": USER_AGENT,
        },
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.toLowerCase().includes("text/html")) {
        throw new Error(`Expected HTML, got ${contentType}`);
      }

      return await response.text();
    } catch (error) {
      if (attempt === maxRetries) throw error;
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
}

async function main() {
  process.stdout.write("Memuat data kamera dan konfigurasi ruas...\n");
  const cameraText = await readFile(cameraPath, "utf8");
  let document = JSON.parse(cameraText);

  let configRoads = [];
  try {
    const configText = await readFile(configPath, "utf8");
    const config = JSON.parse(configText);
    configRoads = (config.highways ?? []).map((h) => h.id).filter(Boolean);
  } catch {
    // optional config
  }

  const existingRoads = [
    ...new Set((document.cameras ?? []).map((c) => c.highwayId).filter(Boolean)),
  ];
  const allRoads = [...new Set([...configRoads, ...existingRoads])];

  process.stdout.write(`Ditemukan ${allRoads.length} ruas untuk di-scrape.\n\n`);

  const initialUrlMap = new Map((document.cameras ?? []).map((c) => [c.id, c.streamUrl]));
  let totalScraped = 0;
  let totalUpdated = 0;
  let failedRoads = 0;

  for (const road of allRoads) {
    const sourcePage = cameraPageUrl(road);
    const scrapedAt = new Date().toISOString();

    try {
      const html = await fetchWithRetry(sourcePage);
      const scraped = parseCameraPage(html, { road, sourcePage, scrapedAt });

      if (scraped.length === 0) {
        process.stdout.write(`⚠️  [${road}] Tidak ada kamera HLS ditemukan.\n`);
        continue;
      }

      let roadUpdated = 0;
      for (const item of scraped) {
        const oldUrl = initialUrlMap.get(item.id);
        if (oldUrl && oldUrl !== item.streamUrl) {
          roadUpdated += 1;
        }
      }

      const merged = mergeCameraData(scraped, document);
      document = buildCameraDocument(
        merged,
        { road, sourcePage, scrapedAt },
        document,
      );

      totalScraped += scraped.length;
      totalUpdated += roadUpdated;

      process.stdout.write(
        `✓  [${road}] ${scraped.length} kamera (${roadUpdated} URL stream diperbarui)\n`,
      );
    } catch (error) {
      failedRoads += 1;
      process.stdout.write(`✗  [${road}] Gagal: ${error.message}\n`);
    }

    if (delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  const tempPath = `${cameraPath}.tmp-${process.pid}`;
  await writeFile(tempPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  await rename(tempPath, cameraPath);

  process.stdout.write("\n========================================\n");
  process.stdout.write(`Selesai! Disimpan ke: ${cameraPath}\n`);
  process.stdout.write(`Total kamera discrape: ${totalScraped}\n`);
  process.stdout.write(`Total URL stream diperbarui: ${totalUpdated}\n`);
  if (failedRoads > 0) {
    process.stdout.write(`Ruas gagal: ${failedRoads}\n`);
  }
  process.stdout.write("========================================\n");
}

main().catch((error) => {
  process.stderr.write(`Scrape all gagal: ${error.message}\n`);
  process.exitCode = 1;
});
