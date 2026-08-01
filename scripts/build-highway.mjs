#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const RELATION_ID = 5_385_689;
const START_NODE_ID = 309_137_378; // Simpang Susun Cawang, canonical KM 0 end
const END_NODE_ID = 1_757_817_871; // Simpang Susun Pluit
const DEFAULT_INPUT = "data-source/osm-relation-5385689-full.json";
const DEFAULT_OUTPUT = "docs/data/highways.geojson";
const EARTH_RADIUS_M = 6_371_008.8;

function radians(value) {
  return (value * Math.PI) / 180;
}

function distanceMeters(a, b) {
  const latitudeA = radians(a.lat);
  const latitudeB = radians(b.lat);
  const latitudeDelta = latitudeB - latitudeA;
  const longitudeDelta = radians(b.lon - a.lon);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(latitudeA) * Math.cos(latitudeB) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(haversine));
}

function parseArguments(argv) {
  const options = { input: DEFAULT_INPUT, output: DEFAULT_OUTPUT };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") return { help: true };
    if (argument !== "--input" && argument !== "--output") {
      throw new Error(`Unknown argument: ${argument}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${argument}`);
    options[argument.slice(2)] = value;
    index += 1;
  }
  return options;
}

function addEdge(graph, from, edge) {
  if (!graph.has(from)) graph.set(from, []);
  graph.get(from).push(edge);
}

function buildGraph(ways, nodes) {
  const graph = new Map();
  for (const way of ways) {
    if (!/^motorway(?:_link)?$/.test(way.tags?.highway ?? "")) continue;
    for (let index = 1; index < way.nodes.length; index += 1) {
      const from = way.nodes[index - 1];
      const to = way.nodes[index];
      const weight = distanceMeters(nodes.get(from), nodes.get(to));
      addEdge(graph, from, { to, weight, wayId: way.id });
      if (way.tags?.oneway !== "yes") {
        addEdge(graph, to, { to: from, weight, wayId: way.id });
      }
    }
  }
  return graph;
}

function shortestPath(graph, start, end) {
  const distance = new Map([[start, 0]]);
  const previous = new Map();
  const queue = [[0, start]];

  while (queue.length > 0) {
    queue.sort((a, b) => a[0] - b[0]);
    const [currentDistance, current] = queue.shift();
    if (currentDistance !== distance.get(current)) continue;
    if (current === end) break;
    for (const edge of graph.get(current) ?? []) {
      const candidate = currentDistance + edge.weight;
      if (candidate >= (distance.get(edge.to) ?? Number.POSITIVE_INFINITY)) continue;
      distance.set(edge.to, candidate);
      previous.set(edge.to, { nodeId: current, wayId: edge.wayId });
      queue.push([candidate, edge.to]);
    }
  }

  if (!distance.has(end)) throw new Error("No directed motorway path found from Cawang to Pluit");
  const nodeIds = [end];
  const wayIds = [];
  let current = end;
  while (current !== start) {
    const step = previous.get(current);
    if (!step) throw new Error("Incomplete route predecessor chain");
    wayIds.push(step.wayId);
    current = step.nodeId;
    nodeIds.push(current);
  }

  return {
    distanceM: distance.get(end),
    nodeIds: nodeIds.reverse(),
    wayIds: [...new Set(wayIds.reverse())],
  };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(
      `Usage: npm run highway:build -- [--input ${DEFAULT_INPUT}] [--output ${DEFAULT_OUTPUT}]\n`,
    );
    return;
  }

  const source = JSON.parse(await readFile(resolve(options.input), "utf8"));
  const relation = source.elements.find(
    (element) => element.type === "relation" && element.id === RELATION_ID,
  );
  if (!relation) throw new Error(`OSM relation ${RELATION_ID} was not found`);

  const nodes = new Map(
    source.elements
      .filter((element) => element.type === "node")
      .map((element) => [element.id, element]),
  );
  const relationWayIds = new Set(
    relation.members.filter((member) => member.type === "way").map((member) => member.ref),
  );
  const ways = source.elements.filter(
    (element) => element.type === "way" && relationWayIds.has(element.id),
  );
  if (!nodes.has(START_NODE_ID) || !nodes.has(END_NODE_ID)) {
    throw new Error("Pinned Cawang or Pluit OSM node is missing from the snapshot");
  }

  const route = shortestPath(buildGraph(ways, nodes), START_NODE_ID, END_NODE_ID);
  const coordinates = route.nodeIds.map((nodeId) => {
    const node = nodes.get(nodeId);
    return [node.lon, node.lat];
  });
  const output = {
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      id: "dalam-kota",
      properties: {
        id: "dalam-kota",
        name: "Tol Dalam Kota (Cawang–Pluit)",
        zeroKmLabel: "Simpang Susun Cawang",
        zeroKmCoordinates: coordinates[0],
        terminalLabel: "Simpang Susun Pluit",
        directionA: "Menjauh dari KM 0 Cawang",
        directionB: "Menuju KM 0 Cawang",
        matchRadiusM: 60,
        maxAccuracyM: 100,
        maxMatchRadiusM: 150,
        passHysteresisM: 75,
        passConfirmationFixes: 2,
        canonicalLengthM: Math.round(route.distanceM),
        osmRelationId: RELATION_ID,
        osmStartNodeId: START_NODE_ID,
        osmEndNodeId: END_NODE_ID,
        osmRelationTimestamp: relation.timestamp,
        osmSource: `https://www.openstreetmap.org/relation/${RELATION_ID}`,
        osmSnapshotSource: `https://api.openstreetmap.org/api/0.6/relation/${RELATION_ID}/full.json`,
        attribution: "© OpenStreetMap contributors",
        license: "https://opendatacommons.org/licenses/odbl/1-0/",
        reviewStatus: "canonical_path_selected",
        selectedWayIds: route.wayIds,
      },
      geometry: { type: "LineString", coordinates },
    }],
  };

  const outputPath = resolve(options.output);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  process.stdout.write(
    `Built ${Math.round(route.distanceM)} m canonical path with ${coordinates.length} points.\n` +
      `Saved ${outputPath}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`Highway build failed: ${error.message}\n`);
  process.exitCode = 1;
});
