#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const DEFAULT_CONFIG = "data-source/highways.config.json";
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
  const options = { config: DEFAULT_CONFIG, output: DEFAULT_OUTPUT };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") return { help: true };
    if (argument !== "--config" && argument !== "--output") {
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
      if (!nodes.has(from) || !nodes.has(to)) continue;
      const weight = distanceMeters(nodes.get(from), nodes.get(to));
      addEdge(graph, from, { to, weight, wayId: way.id });
      if (way.tags?.oneway !== "yes") {
        addEdge(graph, to, { to: from, weight, wayId: way.id });
      }
    }
  }
  return graph;
}

function shortestPath(graph, start, end, highwayId) {
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

  if (!distance.has(end)) {
    throw new Error(`No directed motorway path found for ${highwayId}`);
  }
  const nodeIds = [end];
  const wayIds = [];
  let current = end;
  while (current !== start) {
    const step = previous.get(current);
    if (!step) throw new Error(`Incomplete route predecessor chain for ${highwayId}`);
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

function selectWays(source, definition) {
  if (definition.sourceType === "relation") {
    const relation = source.elements.find(
      (element) => element.type === "relation" && element.id === definition.relationId,
    );
    if (!relation) throw new Error(`OSM relation missing for ${definition.id}`);
    const relationWayIds = new Set(
      relation.members.filter((member) => member.type === "way").map((member) => member.ref),
    );
    return {
      relation,
      ways: source.elements.filter(
        (element) => element.type === "way" && relationWayIds.has(element.id),
      ),
    };
  }
  if (definition.sourceType === "namedWays") {
    const names = new Set(definition.wayNames ?? []);
    return {
      relation: null,
      ways: source.elements.filter(
        (element) => element.type === "way" && names.has(element.tags?.name),
      ),
    };
  }
  throw new Error(`Unknown sourceType for ${definition.id}: ${definition.sourceType}`);
}

async function buildFeature(definition) {
  const source = JSON.parse(await readFile(resolve(definition.input), "utf8"));
  const nodes = new Map(
    source.elements
      .filter((element) => element.type === "node")
      .map((element) => [element.id, element]),
  );
  if (!nodes.has(definition.startNodeId) || !nodes.has(definition.endNodeId)) {
    throw new Error(`Pinned start or end node missing for ${definition.id}`);
  }
  const { relation, ways } = selectWays(source, definition);
  if (ways.length === 0) throw new Error(`No matching motorway ways for ${definition.id}`);
  const route = shortestPath(
    buildGraph(ways, nodes),
    definition.startNodeId,
    definition.endNodeId,
    definition.id,
  );
  const coordinates = route.nodeIds.map((nodeId) => {
    const node = nodes.get(nodeId);
    return [node.lon, node.lat];
  });
  const sourceTimestamp = relation?.timestamp ?? source.osm3s?.timestamp_osm_base ?? null;
  return {
    type: "Feature",
    id: definition.id,
    properties: {
      ...definition.properties,
      id: definition.id,
      zeroKmCoordinates: coordinates[0],
      canonicalLengthM: Math.round(route.distanceM),
      ...(definition.relationId ? { osmRelationId: definition.relationId } : {}),
      osmStartNodeId: definition.startNodeId,
      osmEndNodeId: definition.endNodeId,
      osmSnapshotTimestamp: sourceTimestamp,
      ...(relation?.timestamp ? { osmRelationTimestamp: relation.timestamp } : {}),
      selectedWayIds: route.wayIds,
    },
    geometry: { type: "LineString", coordinates },
  };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(
      `Usage: npm run highway:build -- [--config ${DEFAULT_CONFIG}] [--output ${DEFAULT_OUTPUT}]\n`,
    );
    return;
  }
  const config = JSON.parse(await readFile(resolve(options.config), "utf8"));
  if (!Array.isArray(config.highways) || config.highways.length === 0) {
    throw new Error("Highway config must contain at least one definition");
  }
  const ids = config.highways.map((definition) => definition.id);
  if (new Set(ids).size !== ids.length) throw new Error("Highway IDs must be unique");
  const features = [];
  for (const definition of config.highways) {
    const feature = await buildFeature(definition);
    features.push(feature);
    process.stdout.write(
      `Built ${definition.id}: ${feature.properties.canonicalLengthM} m, ` +
        `${feature.geometry.coordinates.length} points.\n`,
    );
  }
  const outputPath = resolve(options.output);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(
    outputPath,
    `${JSON.stringify({ type: "FeatureCollection", features }, null, 2)}\n`,
    "utf8",
  );
  process.stdout.write(`Saved ${outputPath}\n`);
}

main().catch((error) => {
  process.stderr.write(`Highway build failed: ${error.message}\n`);
  process.exitCode = 1;
});
