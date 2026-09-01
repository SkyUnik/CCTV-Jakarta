#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { estimateCameraOnHighway } from "../docs/js/online-map.mjs";
import { parseSide } from "./lib/binamarga.mjs";

const DIRECTION_SOURCE = "https://bpjt.pu.go.id/telah-uji-laik-fungsi-jalan-tol-indralaya-prabumulih-akan-segera-dioperasikan/";

function parseArguments(argv) {
  const options = {
    cameras: "docs/data/cameras.json",
    highways: "docs/data/highways.geojson",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--cameras" || key === "--highways") {
      const value = argv[index + 1];
      if (!value) throw new Error(`${key} requires a path`);
      options[key.slice(2)] = value;
      index += 1;
      continue;
    }
    if (key === "--help") {
      console.log("Usage: npm run camera:provision -- [--cameras <json>] [--highways <geojson>]");
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${key}`);
  }
  return options;
}

function roundedCoordinate(coordinate) {
  return coordinate.map((value) => Number(value.toFixed(7)));
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const cameraPath = path.resolve(options.cameras);
  const highwayPath = path.resolve(options.highways);
  const cameraData = JSON.parse(await readFile(cameraPath, "utf8"));
  const highwayData = JSON.parse(await readFile(highwayPath, "utf8"));
  const featureById = new Map(highwayData.features.map((feature) => [
    feature.properties?.id ?? feature.id,
    feature,
  ]));
  const provisionedAt = new Date().toISOString();
  let provisioned = 0;
  let retainedVerified = 0;
  let excluded = 0;

  cameraData.cameras = cameraData.cameras.map((camera) => {
    if (camera.curationStatus === "verified" || camera.curationStatus === "provisional_landmark") {
      retainedVerified += 1;
      return camera;
    }
    const feature = featureById.get(camera.highwayId);
    const cameraToEstimate = camera.curationStatus === "provisional_stationing"
      ? { ...camera, coordinates: null, roadPositionM: null }
      : camera;
    const estimate = estimateCameraOnHighway(cameraToEstimate, feature);
    const isWideView = camera.cameraType === "wide_view" &&
      Array.isArray(camera.directions) &&
      camera.directions.includes("A") &&
      camera.directions.includes("B") &&
      camera.directionReview?.status === "confirmed";
    const side = isWideView ? null : (camera.side ?? parseSide(camera.name));
    const hasExplicitDirection = isWideView || side === "A" || side === "B";
    if (!estimate || !hasExplicitDirection) {
      excluded += 1;
      if (camera.curationStatus !== "provisional_stationing") return camera;
      return {
        ...camera,
        coordinates: null,
        roadPositionM: null,
        enabled: false,
        curationStatus: "needs_review",
        locationReview: null,
      };
    }
    provisioned += 1;
    return {
      ...camera,
      side,
      coordinates: roundedCoordinate(estimate.coordinate),
      roadPositionM: Math.round(estimate.roadPositionM),
      enabled: true,
      curationStatus: "provisional_stationing",
      locationReview: {
        method: "osm_route_stationing_interpolation",
        status: "provisional",
        stationingKm: camera.km,
        cameraLabelSource: camera.sourcePage,
        roadGeometrySource: feature.properties?.osmSource,
        roadSnapshotSource: feature.properties?.osmSnapshotSource,
        directionConventionSource: DIRECTION_SOURCE,
        provisionedAt,
        warning: "Interpolated from provider KM along reviewed OSM road geometry; not a surveyed camera coordinate.",
      },
    };
  });

  await writeFile(cameraPath, `${JSON.stringify(cameraData, null, 2)}\n`, "utf8");
  console.log(`Provisioned ${provisioned} camera records; retained ${retainedVerified} verified; excluded ${excluded}.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
