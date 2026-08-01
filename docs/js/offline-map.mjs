const SVG_NS = "http://www.w3.org/2000/svg";
const MAP_WIDTH = 1_000;
const MAP_HEIGHT = 620;
const MAP_PADDING = 38;
const EARTH_METERS_PER_DEGREE = 111_195;

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function segmentLength(a, b) {
  const referenceLatitude = ((a[1] + b[1]) / 2) * Math.PI / 180;
  const dx = (b[0] - a[0]) * EARTH_METERS_PER_DEGREE * Math.cos(referenceLatitude);
  const dy = (b[1] - a[1]) * EARTH_METERS_PER_DEGREE;
  return Math.hypot(dx, dy);
}

export function coordinateAtRoadPosition(coordinates, requestedPositionM) {
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  const lengths = [];
  let totalLengthM = 0;
  for (let index = 1; index < coordinates.length; index += 1) {
    const lengthM = segmentLength(coordinates[index - 1], coordinates[index]);
    lengths.push(lengthM);
    totalLengthM += lengthM;
  }
  if (totalLengthM <= 0) return null;
  const positionM = clamp(Number(requestedPositionM), 0, totalLengthM);
  let cumulativeM = 0;
  for (let index = 0; index < lengths.length; index += 1) {
    const lengthM = lengths[index];
    if (lengthM === 0) continue;
    if (cumulativeM + lengthM >= positionM || index === lengths.length - 1) {
      const fraction = clamp((positionM - cumulativeM) / lengthM, 0, 1);
      const start = coordinates[index];
      const end = coordinates[index + 1];
      return [
        start[0] + fraction * (end[0] - start[0]),
        start[1] + fraction * (end[1] - start[1]),
      ];
    }
    cumulativeM += lengthM;
  }
  return [...coordinates.at(-1)];
}

export function estimateCameraOnHighway(camera, feature) {
  if (!Number.isFinite(camera?.km)) return null;
  const anchors = feature?.properties?.cameraStationing?.anchors;
  if (!Array.isArray(anchors) || anchors.length !== 2) return null;
  const [first, second] = [...anchors].sort((a, b) => a.km - b.km);
  if (
    !Number.isFinite(first.km) ||
    !Number.isFinite(second.km) ||
    !Number.isFinite(first.roadPositionM) ||
    !Number.isFinite(second.roadPositionM) ||
    second.km <= first.km ||
    camera.km < first.km ||
    camera.km > second.km
  ) return null;
  const fraction = (camera.km - first.km) / (second.km - first.km);
  const roadPositionM = first.roadPositionM +
    fraction * (second.roadPositionM - first.roadPositionM);
  const coordinate = coordinateAtRoadPosition(
    feature.geometry?.coordinates,
    roadPositionM,
  );
  if (!coordinate) return null;
  return {
    camera,
    coordinate,
    highwayId: feature.properties?.id ?? feature.id,
    quality: "estimated_stationing",
    roadPositionM,
  };
}

export function groupEstimatedCameraMarkers(cameras, features) {
  const featureById = new Map(features.map((feature) => [
    feature.properties?.id ?? feature.id,
    feature,
  ]));
  const groups = new Map();
  const unlocated = [];
  for (const camera of cameras) {
    const feature = featureById.get(camera.highwayId);
    const estimate = estimateCameraOnHighway(camera, feature);
    if (!estimate) {
      unlocated.push(camera);
      continue;
    }
    const key = `${estimate.highwayId}:${Math.round(estimate.roadPositionM)}`;
    const group = groups.get(key) ?? {
      coordinate: estimate.coordinate,
      cameras: [],
      highwayId: estimate.highwayId,
      quality: estimate.quality,
      roadPositionM: estimate.roadPositionM,
    };
    group.cameras.push(camera);
    groups.set(key, group);
  }
  return { groups: [...groups.values()], unlocated };
}

function coordinateBounds(coordinates) {
  const xs = coordinates.map((coordinate) => coordinate[0]);
  const ys = coordinates.map((coordinate) => coordinate[1]);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

function paddedViewBox(points, minimumSpan = 80) {
  const bounds = coordinateBounds(points);
  const width = Math.max(minimumSpan, bounds.maxX - bounds.minX);
  const height = Math.max(minimumSpan, bounds.maxY - bounds.minY);
  const padding = Math.max(24, Math.max(width, height) * 0.12);
  return {
    x: bounds.minX - padding,
    y: bounds.minY - padding,
    width: width + padding * 2,
    height: height + padding * 2,
  };
}

export function createSchematicProjection(features) {
  const coordinates = features.flatMap((feature) => feature.geometry?.coordinates ?? []);
  if (coordinates.length === 0) throw new Error("Map needs at least one highway coordinate");
  const longitude = coordinates.reduce((sum, coordinate) => sum + coordinate[0], 0) / coordinates.length;
  const latitude = coordinates.reduce((sum, coordinate) => sum + coordinate[1], 0) / coordinates.length;
  const cosine = Math.cos(latitude * Math.PI / 180);
  const raw = (coordinate) => ({
    x: (coordinate[0] - longitude) * EARTH_METERS_PER_DEGREE * cosine,
    y: -(coordinate[1] - latitude) * EARTH_METERS_PER_DEGREE,
  });
  const rawPoints = coordinates.map(raw);
  const rawBounds = coordinateBounds(rawPoints.map(({ x, y }) => [x, y]));
  const usableWidth = MAP_WIDTH - MAP_PADDING * 2;
  const usableHeight = MAP_HEIGHT - MAP_PADDING * 2;
  const scale = Math.min(
    usableWidth / Math.max(1, rawBounds.maxX - rawBounds.minX),
    usableHeight / Math.max(1, rawBounds.maxY - rawBounds.minY),
  );
  const contentWidth = (rawBounds.maxX - rawBounds.minX) * scale;
  const contentHeight = (rawBounds.maxY - rawBounds.minY) * scale;
  const offsetX = (MAP_WIDTH - contentWidth) / 2;
  const offsetY = (MAP_HEIGHT - contentHeight) / 2;
  const project = (coordinate) => {
    const point = raw(coordinate);
    return [
      offsetX + (point.x - rawBounds.minX) * scale,
      offsetY + (point.y - rawBounds.minY) * scale,
    ];
  };
  return {
    allViewBox: { x: 0, y: 0, width: MAP_WIDTH, height: MAP_HEIGHT },
    metersToUnits: scale,
    project,
    viewBoxForFeature(feature) {
      return paddedViewBox((feature.geometry?.coordinates ?? []).map(project));
    },
  };
}

function svgElement(name, attributes = {}) {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  return element;
}

function viewBoxText(viewBox) {
  return `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`;
}

function isActivationKey(event) {
  return event.key === "Enter" || event.key === " ";
}

export function createOfflineMap(options) {
  const {
    body,
    cameraCard,
    cameraList,
    gpsButton,
    onSelectHighway,
    onWatchCamera,
    summary,
    svg,
    toggle,
  } = options;
  let cameras = [];
  let features = [];
  let gpsFix = null;
  let markerGroups = [];
  let projection = null;
  let selectedHighwayId = null;
  let viewBox = { x: 0, y: 0, width: MAP_WIDTH, height: MAP_HEIGHT };
  let currentMarkerHitRadius = 20;

  function featureId(feature) {
    return feature.properties?.id ?? feature.id;
  }

  function showCameraGroup(group) {
    cameraList.replaceChildren();
    for (const camera of group.cameras) {
      const item = document.createElement("div");
      item.className = "map-camera-item";
      const description = document.createElement("div");
      const name = document.createElement("strong");
      const metadata = document.createElement("span");
      name.textContent = camera.name;
      metadata.textContent = `${Number.isFinite(camera.km) ? `KM ${camera.km.toFixed(3)}` : "KM —"}${camera.side ? ` • ${camera.side}` : " • arah belum pasti"}`;
      description.append(name, metadata);
      const watch = document.createElement("button");
      watch.className = "button button-small";
      watch.type = "button";
      watch.textContent = "Tonton";
      watch.setAttribute("aria-label", `Tonton ${camera.name}`);
      watch.addEventListener("click", () => onWatchCamera(camera));
      item.append(description, watch);
      cameraList.append(item);
    }
    cameraCard.hidden = false;
    cameraCard.querySelector("strong").textContent = group.cameras.length > 1
      ? `${group.cameras.length} kamera di titik ini`
      : "Lokasi perkiraan berdasarkan KM";
  }

  function render() {
    if (!projection) return;
    svg.replaceChildren();
    svg.setAttribute("viewBox", viewBoxText(viewBox));
    const markerRadius = clamp(viewBox.width / 115, 4.5, 10);
    const markerHitRadius = Math.max(markerRadius * 2.2, viewBox.width * 0.035);
    currentMarkerHitRadius = markerHitRadius;

    const routes = svgElement("g", { class: "map-routes" });
    for (const feature of features) {
      const id = featureId(feature);
      const points = feature.geometry.coordinates
        .map((coordinate) => projection.project(coordinate).join(","))
        .join(" ");
      const group = svgElement("g", {
        class: `map-route${selectedHighwayId === id ? " is-selected" : selectedHighwayId ? " is-muted" : ""}`,
      });
      const hit = svgElement("polyline", {
        "aria-label": `Pilih ${feature.properties?.name ?? id}`,
        class: "map-route-hit",
        fill: "none",
        points,
        role: "button",
        tabindex: "0",
      });
      const line = svgElement("polyline", { class: "map-route-line", fill: "none", points });
      const choose = () => onSelectHighway(id);
      hit.addEventListener("click", choose);
      hit.addEventListener("keydown", (event) => {
        if (!isActivationKey(event)) return;
        event.preventDefault();
        choose();
      });
      group.append(hit, line);
      routes.append(group);
    }
    svg.append(routes);

    const markers = svgElement("g", { class: "map-markers" });
    for (const marker of markerGroups) {
      const [x, y] = projection.project(marker.coordinate);
      const muted = selectedHighwayId && marker.highwayId !== selectedHighwayId;
      const feature = features.find((candidate) => featureId(candidate) === marker.highwayId);
      const kilometer = marker.cameras[0]?.km;
      const markerLabel = `${marker.cameras.length} kamera ${feature?.properties?.name ?? marker.highwayId}, ${Number.isFinite(kilometer) ? `KM ${kilometer.toFixed(3)}` : "KM belum tersedia"}, lokasi perkiraan`;
      const group = svgElement("g", {
        class: `map-marker${muted ? " is-muted" : selectedHighwayId ? " is-selected" : ""}`,
      });
      const target = svgElement("circle", {
        "aria-label": markerLabel,
        class: "map-marker-target",
        cx: x,
        cy: y,
        r: markerHitRadius,
        role: "button",
        tabindex: "0",
      });
      const dot = svgElement("circle", { class: "map-marker-dot", cx: x, cy: y, r: markerRadius });
      group.append(target, dot);
      if (marker.cameras.length > 1) {
        const badge = svgElement("text", {
          "aria-hidden": "true",
          x,
          y: y + markerRadius * 0.36,
          "font-size": markerRadius * 1.05,
          "text-anchor": "middle",
        });
        badge.textContent = marker.cameras.length;
        group.append(badge);
      }
      const open = () => showCameraGroup(marker);
      target.addEventListener("keydown", (event) => {
        if (!isActivationKey(event)) return;
        event.preventDefault();
        open();
      });
      markers.append(group);
    }
    svg.append(markers);

    if (gpsFix) {
      const [x, y] = projection.project([gpsFix.longitude, gpsFix.latitude]);
      const gps = svgElement("g", { class: "map-gps", "aria-label": `Lokasi GPS, akurasi ${Math.round(gpsFix.accuracy)} meter` });
      gps.append(
        svgElement("circle", {
          class: "map-gps-accuracy",
          cx: x,
          cy: y,
          r: Math.max(4, gpsFix.accuracy * projection.metersToUnits),
        }),
        svgElement("circle", { class: "map-gps-dot", cx: x, cy: y, r: markerRadius * 0.72 }),
      );
      svg.append(gps);
    }
  }

  function setView(nextViewBox) {
    viewBox = nextViewBox;
    render();
  }

  toggle.addEventListener("change", () => {
    body.hidden = !toggle.checked;
  });
  svg.addEventListener("click", (event) => {
    if (event.target.closest?.(".map-route-hit")) return;
    const matrix = svg.getScreenCTM();
    if (!matrix || !projection) return;
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const local = point.matrixTransform(matrix.inverse());
    let nearest = null;
    for (const marker of markerGroups) {
      const [x, y] = projection.project(marker.coordinate);
      const distance = Math.hypot(local.x - x, local.y - y);
      if (!nearest || distance < nearest.distance) nearest = { distance, marker };
    }
    if (nearest && nearest.distance <= currentMarkerHitRadius) showCameraGroup(nearest.marker);
  });
  gpsButton.addEventListener("click", () => {
    if (!gpsFix || !projection) return;
    const [x, y] = projection.project([gpsFix.longitude, gpsFix.latitude]);
    const span = 180;
    setView({ x: x - span, y: y - span, width: span * 2, height: span * 2 });
  });

  return {
    setData(nextFeatures, nextCameras) {
      features = nextFeatures;
      cameras = nextCameras;
      projection = createSchematicProjection(features);
      const markerData = groupEstimatedCameraMarkers(cameras, features);
      markerGroups = markerData.groups;
      viewBox = projection.allViewBox;
      summary.textContent = `${markerGroups.reduce((total, marker) => total + marker.cameras.length, 0)} kamera dipetakan secara perkiraan • ${markerData.unlocated.length} tanpa lokasi`;
      render();
    },
    selectHighway(highwayId) {
      selectedHighwayId = highwayId;
      cameraCard.hidden = true;
      const feature = features.find((candidate) => featureId(candidate) === highwayId);
      setView(feature ? projection.viewBoxForFeature(feature) : projection.allViewBox);
    },
    showAll() {
      selectedHighwayId = null;
      cameraCard.hidden = true;
      setView(projection.allViewBox);
    },
    updatePosition(position) {
      gpsFix = position;
      gpsButton.disabled = !position;
      render();
    },
  };
}
