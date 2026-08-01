#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";

import { assessPlaylist, headersToObject } from "./lib/stream-check.mjs";

const { values } = parseArgs({
  options: {
    delay: { type: "string", default: "500" },
    file: { type: "string", default: "docs/data/cameras.json" },
    origin: { type: "string", default: "https://example.github.io" },
    out: { type: "string" },
    timeout: { type: "string", default: "15000" },
  },
});

const delayMs = Number(values.delay);
const timeoutMs = Number(values.timeout);
if (!Number.isFinite(delayMs) || delayMs < 250) throw new Error("--delay must be at least 250 ms");
if (!Number.isFinite(timeoutMs) || timeoutMs < 1_000) throw new Error("--timeout must be at least 1000 ms");
const origin = new URL(values.origin).origin;
const data = JSON.parse(await readFile(values.file, "utf8"));
const byUrl = new Map();
for (const camera of data.cameras ?? []) {
  if (!camera.streamUrl) continue;
  const item = byUrl.get(camera.streamUrl) ?? { cameraIds: [], url: camera.streamUrl };
  item.cameraIds.push(camera.id);
  byUrl.set(camera.streamUrl, item);
}

const checks = [];
for (const item of byUrl.values()) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(item.url, {
      headers: {
        Accept: "application/vnd.apple.mpegurl, application/x-mpegURL, */*",
        Origin: origin,
        Range: "bytes=0-16383",
        "User-Agent": "Jakarta-Toll-CCTV-Compatibility-Check/1.0 (+manual-public-playlist-check)",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    const body = (await response.text()).slice(0, 16_384);
    checks.push({
      cameraIds: item.cameraIds,
      ...assessPlaylist({
        body,
        headers: headersToObject(response.headers),
        origin,
        status: response.status,
        url: item.url,
      }),
    });
  } catch (error) {
    checks.push({
      cameraIds: item.cameraIds,
      url: item.url,
      error: error.name === "AbortError" ? "timeout" : error.message,
      validManifest: false,
      safariNativeCandidate: false,
      hlsJsCandidate: false,
    });
  } finally {
    clearTimeout(timer);
  }
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

const report = {
  schemaVersion: 1,
  checkedAt: new Date().toISOString(),
  sourceFile: values.file,
  requestedOrigin: origin,
  scope: "Public HLS playlists only; no media segments requested",
  summary: {
    uniqueStreams: checks.length,
    validManifests: checks.filter((check) => check.validManifest).length,
    safariNativeCandidates: checks.filter((check) => check.safariNativeCandidate).length,
    hlsJsCandidates: checks.filter((check) => check.hlsJsCandidate).length,
  },
  checks,
};

const output = `${JSON.stringify(report, null, 2)}\n`;
if (values.out) await writeFile(values.out, output);
process.stdout.write(output);
