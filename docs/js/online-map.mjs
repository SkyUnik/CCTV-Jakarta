const EARTH_METERS_PER_DEGREE = 111_195;

export const OSM_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

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

export function createGpsCenterTracker() {
  let hasCentered = false;
  return {
    reset() {
      hasCentered = false;
    },
    shouldCenter(position) {
      if (!position || hasCentered) return false;
      hasCentered = true;
      return true;
    },
  };
}

function featureId(feature) {
  return feature.properties?.id ?? feature.id;
}

function toLatLng(coordinate) {
  return [coordinate[1], coordinate[0]];
}

function escapeKey(event) {
  return event.key === "Escape";
}

export function createOnlineMap(options) {
  const leaflet = globalThis.L;
  if (!leaflet?.map || !leaflet?.markerClusterGroup) {
    throw new Error("Leaflet and marker clustering must be loaded before the map module");
  }

  const {
    body,
    cameraCard,
    cameraList,
    closeButton,
    expandButton,
    gpsButton,
    mapElement,
    mapSection,
    onSelectHighway,
    onWatchCamera,
    summary,
    tileUrl = OSM_TILE_URL,
    tileStatus,
    toggle,
  } = options;
  const routePanel = mapSection.closest(".route-panel");

  const map = leaflet.map(mapElement, {
    attributionControl: true,
    maxBoundsViscosity: 0.35,
    preferCanvas: false,
    scrollWheelZoom: true,
    zoomControl: true,
  });
  map.attributionControl.setPrefix(false);

  const tileLayer = leaflet.tileLayer(tileUrl, {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>',
    keepBuffer: 2,
    maxNativeZoom: 19,
    maxZoom: 19,
    noWrap: true,
  }).addTo(map);
  const routeLayer = leaflet.featureGroup().addTo(map);
  const markerLayer = leaflet.markerClusterGroup({
    chunkedLoading: false,
    maxClusterRadius: 46,
    showCoverageOnHover: false,
    spiderfyOnMaxZoom: true,
    zoomToBoundsOnClick: true,
    iconCreateFunction(cluster) {
      const childMarkers = cluster.getAllChildMarkers();
      const cameraCount = childMarkers
        .reduce((total, marker) => total + (marker.__cameraCount ?? 1), 0);
      const muted = Boolean(
        selectedHighwayId &&
        childMarkers.every((marker) => marker.__highwayId !== selectedHighwayId),
      );
      return leaflet.divIcon({
        className: `camera-cluster-icon${muted ? " is-muted" : ""}`,
        html: `<span>${cameraCount}</span>`,
        iconSize: [42, 42],
      });
    },
  }).addTo(map);

  const gpsCenterTracker = createGpsCenterTracker();
  const markerEntries = [];
  const routeEntries = new Map();
  let allBounds = null;
  let expanded = false;
  let features = [];
  let gpsAccuracyLayer = null;
  let gpsFix = null;
  let gpsMarker = null;
  let selectedHighwayId = null;
  let tileFailed = false;

  function showTileStatus(message = "") {
    tileStatus.hidden = !message;
    tileStatus.textContent = message;
    mapElement.classList.toggle("has-tile-error", Boolean(message));
  }

  function decorateMapTargets() {
    requestAnimationFrame(() => {
      mapElement.querySelectorAll(".camera-cluster-icon").forEach((icon) => {
        const count = Number.parseInt(icon.textContent, 10) || 0;
        icon.setAttribute("aria-label", `${count} kamera dalam area. Tekan untuk memperbesar peta.`);
        icon.setAttribute("title", `${count} kamera • perbesar area`);
      });
    });
  }

  tileLayer.on("tileerror", () => {
    tileFailed = true;
    showTileStatus("Basemap OpenStreetMap tidak tersedia. Ruas, CCTV, dan GPS tetap dapat digunakan.");
  });
  tileLayer.on("load", () => {
    if (!tileFailed) showTileStatus();
  });
  map.on("layeradd moveend zoomend", decorateMapTargets);

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

  function cameraIcon(count, muted) {
    return leaflet.divIcon({
      className: `camera-map-icon${count > 1 ? " has-count" : ""}${muted ? " is-muted" : ""}`,
      html: `<span>${count > 1 ? count : ""}</span>`,
      iconAnchor: [16, 16],
      iconSize: [32, 32],
    });
  }

  function updateSelectionStyles() {
    for (const [id, entry] of routeEntries) {
      const selected = selectedHighwayId === id;
      const muted = Boolean(selectedHighwayId && !selected);
      entry.line.setStyle({
        color: selected ? "#22614f" : "#657b73",
        opacity: muted ? 0.22 : 0.92,
        weight: selected ? 7 : 5,
      });
      entry.hit.setStyle({ opacity: 0, weight: 24 });
      if (selected) entry.line.bringToFront();
    }
    for (const entry of markerEntries) {
      const muted = Boolean(selectedHighwayId && entry.group.highwayId !== selectedHighwayId);
      entry.marker.setIcon(cameraIcon(entry.group.cameras.length, muted));
      entry.marker.setOpacity(muted ? 0.24 : 1);
    }
    map.whenReady(() => {
      markerLayer.refreshClusters(markerEntries.map((entry) => entry.marker));
      decorateMapTargets();
    });
  }

  function fit(bounds, maxZoom = 13) {
    if (!bounds?.isValid?.()) return;
    map.fitBounds(bounds, { animate: true, maxZoom, padding: [24, 24] });
  }

  function closeExpandedMap({ restoreFocus = true } = {}) {
    if (!expanded) return;
    expanded = false;
    mapSection.classList.remove("is-expanded");
    routePanel?.classList.remove("has-expanded-map");
    document.body.classList.remove("map-overlay-open");
    expandButton.setAttribute("aria-expanded", "false");
    closeButton.hidden = true;
    mapSection.removeAttribute("aria-modal");
    mapSection.removeAttribute("role");
    requestAnimationFrame(() => map.invalidateSize({ pan: false }));
    if (restoreFocus) expandButton.focus({ preventScroll: true });
  }

  function openExpandedMap() {
    if (expanded) return;
    expanded = true;
    mapSection.classList.add("is-expanded");
    routePanel?.classList.add("has-expanded-map");
    document.body.classList.add("map-overlay-open");
    expandButton.setAttribute("aria-expanded", "true");
    closeButton.hidden = false;
    mapSection.setAttribute("aria-modal", "true");
    mapSection.setAttribute("role", "dialog");
    requestAnimationFrame(() => {
      map.invalidateSize({ pan: false });
      closeButton.focus({ preventScroll: true });
    });
  }

  function onDocumentKeydown(event) {
    if (expanded && escapeKey(event)) closeExpandedMap();
    if (!expanded || event.key !== "Tab") return;
    const focusable = [...mapSection.querySelectorAll(
      'button:not([disabled]):not([hidden]), input:not([disabled]), a[href], [tabindex="0"]',
    )].filter((element) => element.getClientRects().length > 0);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  expandButton.addEventListener("click", openExpandedMap);
  closeButton.addEventListener("click", () => closeExpandedMap());
  document.addEventListener("keydown", onDocumentKeydown);
  toggle.addEventListener("change", () => {
    body.hidden = !toggle.checked;
    if (toggle.checked) requestAnimationFrame(() => map.invalidateSize({ pan: false }));
  });
  gpsButton.addEventListener("click", () => {
    if (!gpsFix) return;
    map.setView([gpsFix.latitude, gpsFix.longitude], Math.max(map.getZoom(), 16), {
      animate: true,
    });
  });

  return {
    destroy() {
      closeExpandedMap({ restoreFocus: false });
      document.removeEventListener("keydown", onDocumentKeydown);
      map.remove();
    },
    selectHighway(highwayId) {
      selectedHighwayId = highwayId;
      cameraCard.hidden = true;
      updateSelectionStyles();
      const entry = routeEntries.get(highwayId);
      if (entry) fit(entry.line.getBounds(), 15);
    },
    setData(nextFeatures, nextCameras) {
      features = nextFeatures;
      routeLayer.clearLayers();
      markerLayer.clearLayers();
      routeEntries.clear();
      markerEntries.length = 0;

      for (const feature of features) {
        const id = featureId(feature);
        const latLngs = feature.geometry.coordinates.map(toLatLng);
        const line = leaflet.polyline(latLngs, {
          color: "#657b73",
          interactive: false,
          lineCap: "round",
          lineJoin: "round",
          opacity: 0.92,
          weight: 5,
        }).addTo(routeLayer);
        const hit = leaflet.polyline(latLngs, {
          interactive: true,
          opacity: 0,
          weight: 24,
        }).addTo(routeLayer);
        const name = feature.properties?.name ?? id;
        hit.bindTooltip(`Pilih ${name}`, { direction: "top", sticky: true });
        hit.on("click", () => onSelectHighway(id));
        routeEntries.set(id, { feature, hit, line });
      }

      const markerData = groupEstimatedCameraMarkers(nextCameras, features);
      for (const group of markerData.groups) {
        const feature = features.find((candidate) => featureId(candidate) === group.highwayId);
        const kilometer = group.cameras[0]?.km;
        const label = `${group.cameras.length} kamera ${feature?.properties?.name ?? group.highwayId}, ${Number.isFinite(kilometer) ? `KM ${kilometer.toFixed(3)}` : "KM belum tersedia"}, lokasi perkiraan`;
        const marker = leaflet.marker(toLatLng(group.coordinate), {
          alt: label,
          icon: cameraIcon(group.cameras.length, false),
          keyboard: true,
          riseOnHover: true,
          title: label,
        });
        marker.__cameraCount = group.cameras.length;
        marker.__highwayId = group.highwayId;
        marker.on("add", () => {
          requestAnimationFrame(() => {
            const element = marker.getElement();
            element?.setAttribute("aria-label", label);
            element?.setAttribute("title", label);
          });
        });
        marker.on("click", () => showCameraGroup(group));
        markerEntries.push({ group, marker });
        markerLayer.addLayer(marker);
      }

      allBounds = routeLayer.getBounds();
      summary.textContent = `${markerData.groups.reduce((total, group) => total + group.cameras.length, 0)} kamera dipetakan secara perkiraan • ${markerData.unlocated.length} tanpa lokasi`;
      selectedHighwayId = null;
      updateSelectionStyles();
      fit(allBounds, 12);
    },
    showAll() {
      selectedHighwayId = null;
      cameraCard.hidden = true;
      updateSelectionStyles();
      fit(allBounds, 12);
    },
    updatePosition(position) {
      gpsFix = position;
      gpsButton.disabled = !position;
      if (!position) {
        gpsCenterTracker.reset();
        if (gpsMarker) map.removeLayer(gpsMarker);
        if (gpsAccuracyLayer) map.removeLayer(gpsAccuracyLayer);
        gpsMarker = null;
        gpsAccuracyLayer = null;
        return;
      }
      const latLng = [position.latitude, position.longitude];
      if (!gpsAccuracyLayer) {
        gpsAccuracyLayer = leaflet.circle(latLng, {
          className: "gps-accuracy-layer",
          color: "#267fc0",
          fillColor: "#267fc0",
          fillOpacity: 0.12,
          interactive: false,
          radius: position.accuracy,
          weight: 1.5,
        }).addTo(map);
        gpsMarker = leaflet.circleMarker(latLng, {
          className: "gps-position-layer",
          color: "#ffffff",
          fillColor: "#267fc0",
          fillOpacity: 1,
          interactive: false,
          radius: 7,
          weight: 3,
        }).addTo(map);
      } else {
        gpsAccuracyLayer.setLatLng(latLng).setRadius(position.accuracy);
        gpsMarker.setLatLng(latLng);
      }
      if (gpsCenterTracker.shouldCenter(position)) map.setView(latLng, 16, { animate: true });
    },
  };
}
