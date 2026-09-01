import { coordinateAtRoadPosition, createOnlineMap, estimateCameraOnHighway } from "/site/js/online-map.mjs";
import { createVideoController } from "/site/js/player.mjs";

const $ = (selector) => document.querySelector(selector);
const elements = {
  btnHighwayHealth: $("#btn-highway-health"),
  btnCheckDuplicates: $("#btn-check-duplicates"),
  btnRenameHighway: $("#btn-rename-highway"),
  btnBulkDirection: $("#btn-bulk-direction"),
  btnBulkEnable: $("#btn-bulk-enable"),
  bulkDirectionCancel: $("#bulk-direction-cancel"),
  bulkDirectionConfirm: $("#bulk-direction-confirm"),
  bulkDirectionDialog: $("#bulk-direction-dialog"),
  bulkDirectionForm: $("#bulk-direction-form"),
  bulkDirectionSelect: $("#bulk-direction-select"),
  bulkDirectionTarget: $("#bulk-direction-target"),
  bulkEnableCancel: $("#bulk-enable-cancel"),
  bulkEnableConfirm: $("#bulk-enable-confirm"),
  bulkEnableDialog: $("#bulk-enable-dialog"),
  bulkEnableForm: $("#bulk-enable-form"),
  bulkEnableTarget: $("#bulk-enable-target"),
  bulkEnableSummary: $("#bulk-enable-summary"),
  bulkEnableAction: $("#bulk-enable-action"),
  bulkEnableBypass: $("#bulk-enable-bypass"),
  bulkGeocode: $("#bulk-geocode"),
  bulkGateGeocode: $("#bulk-gate-geocode"),
  cameraCount: $("#camera-count"),
  cameraForm: $("#camera-form"),
  cameraId: $("#camera-id"),
  cameraList: $("#camera-list"),
  cameraName: $("#camera-name"),
  cameraKm: $("#camera-km"),
  cameraSide: $("#camera-side"),
  commit: $("#commit"),
  commitMessage: $("#commit-message"),
  commandOutput: $("#command-output"),
  curationStatus: $("#curation-status"),
  deleteCamera: $("#delete-camera"),
  duplicateCamerasDialog: $("#duplicate-cameras-dialog"),
  duplicateCamerasForm: $("#duplicate-cameras-form"),
  duplicateCamerasSummary: $("#duplicate-cameras-summary"),
  duplicateCamerasTbody: $("#duplicate-cameras-tbody"),
  duplicateCamerasCancel: $("#duplicate-cameras-cancel"),
  duplicateCamerasConfirm: $("#duplicate-cameras-confirm"),
  enabled: $("#enabled"),
  frameAudit: $("#frame-audit"),
  frameAuditGuide: $("#frame-audit-guide"),
  frameToolbar: $("#frame-toolbar"),
  gateMatchCancel: $("#gate-match-cancel"),
  gateMatchDialog: $("#gate-match-dialog"),
  gateMatchForm: $("#gate-match-form"),
  gateMatchSummary: $("#gate-match-summary"),
  gateMatchTbody: $("#gate-match-tbody"),
  gitDiff: $("#git-diff"),
  gitSummary: $("#git-summary"),
  highwayHealthDialog: $("#highway-health-dialog"),
  healthDialogTitle: $("#health-dialog-title"),
  healthDialogEyebrow: $("#health-dialog-eyebrow"),
  healthOverallBadge: $("#health-overall-badge"),
  healthLoading: $("#health-loading"),
  healthLoadingText: $("#health-loading-text"),
  healthContent: $("#health-content"),
  healthStreamBadge: $("#health-stream-badge"),
  healthStreamRatio: $("#health-stream-ratio"),
  healthStreamList: $("#health-stream-list"),
  healthScrapeBadge: $("#health-scrape-badge"),
  healthScrapeTime: $("#health-scrape-time"),
  healthScrapeAge: $("#health-scrape-age"),
  healthScrapeUpstream: $("#health-scrape-upstream"),
  healthGeoBadge: $("#health-geo-badge"),
  healthGeoLength: $("#health-geo-length"),
  healthGeoPoints: $("#health-geo-points"),
  healthGeoMapped: $("#health-geo-mapped"),
  healthGeoReview: $("#health-geo-review"),
  healthIssuesContainer: $("#health-issues-container"),
  healthIssuesList: $("#health-issues-list"),
  healthActionRefreshScrape: $("#health-action-refresh-scrape"),
  healthActionRepairGeo: $("#health-action-repair-geo"),
  healthDialogClose: $("#health-dialog-close"),
  highwayId: $("#highway-id"),
  inferenceStatus: $("#inference-status"),
  jsonDiffAfter: $("#json-diff-after"),
  jsonDiffBefore: $("#json-diff-before"),
  latitude: $("#latitude"),
  longitude: $("#longitude"),
  newCamera: $("#new-camera"),
  notes: $("#notes"),
  providerId: $("#provider-id"),
  push: $("#push"),
  redRegion: $("#red-region"),
  refreshGit: $("#refresh-git"),
  regionConfirm: $("#region-confirm"),
  regionDirection: $("#region-direction"),
  regionEnabled: $("#region-enabled"),
  regionLabel: $("#region-label"),
  regionLeft: $("#region-left"),
  regionRight: $("#region-right"),
  reloadVideo: $("#reload-video"),
  renameHighwayCancel: $("#rename-highway-cancel"),
  renameHighwayConfirm: $("#rename-highway-confirm"),
  renameHighwayDialog: $("#rename-highway-dialog"),
  renameHighwayForm: $("#rename-highway-form"),
  renameHighwayInput: $("#rename-highway-input"),
  renameHighwayTarget: $("#rename-highway-target"),
  resetPinCoords: $("#reset-pin-coords"),
  roadFilter: $("#road-filter"),
  runTests: $("#run-tests"),
  saveCamera: $("#save-camera"),
  savePinCoords: $("#save-pin-coords"),
  saveState: $("#save-state"),
  search: $("#search"),
  sourcePage: $("#source-page"),
  statusFilter: $("#status-filter"),
  streamUrl: $("#stream-url"),
  video: $("#audit-video"),
  videoStage: $("#video-stage"),
  verifyCamera: $("#verify-camera"),

  // Map elements from original app
  mapBody: $("#map-body"),
  mapCameraCard: $("#map-camera-card"),
  mapCameraList: $("#map-camera-list"),
  mapCloseButton: $("#map-close-button"),
  mapExpandButton: $("#map-expand-button"),
  mapGpsButton: $("#map-gps-button"),
  mapRouteMap: $("#route-map"),
  mapSection: $("#route-map-panel"),
  mapShowAllLines: $("#map-show-all-lines"),
  mapSummary: $("#map-summary"),
  mapTileStatus: $("#map-tile-status"),
  mapToggle: $("#map-toggle"),
};

const state = {
  activePin: null,
  cameras: [],
  current: null,
  draftCoordinates: null,
  draftPin: null,
  highwayFeatures: [],
  highways: [],
  nonce: "",
  onlineMap: null,
  pendingDuplicates: [],
  pendingGateMatches: [],
  regions: {},
  videoController: null,
};

state.videoController = createVideoController({ video: elements.video, hlsClass: window.Hls });

function setInferenceStatus(message, isBusy = false) {
  if (!elements.inferenceStatus) return;
  elements.inferenceStatus.textContent = message || "Siap";
  elements.inferenceStatus.classList.toggle("is-busy", isBusy);
}

function updateDraftMarker(lon, lat) {
  if (!state.onlineMap?.leafletMap || !Number.isFinite(lon) || !Number.isFinite(lat)) {
    clearDraftMarker();
    return;
  }
  state.draftCoordinates = [lon, lat];
  if (!state.draftPin) {
    const draftIcon = window.L.divIcon({
      className: "admin-draft-pin",
      html: "<span>📍</span>",
      iconAnchor: [18, 18],
      iconSize: [36, 36],
    });
    state.draftPin = window.L.marker([lat, lon], { draggable: true, icon: draftIcon });
    state.draftPin.on("dragend", () => {
      const pos = state.draftPin.getLatLng();
      const nextLat = Number(pos.lat.toFixed(6));
      const nextLon = Number(pos.lng.toFixed(6));
      updateDraftMarker(nextLon, nextLat);
    });
  } else {
    state.draftPin.setLatLng([lat, lon]);
  }

  if (!state.onlineMap.leafletMap.hasLayer(state.draftPin)) {
    state.draftPin.addTo(state.onlineMap.leafletMap);
  }

  if (elements.savePinCoords) elements.savePinCoords.disabled = false;
  if (elements.resetPinCoords) elements.resetPinCoords.disabled = false;
  setInferenceStatus(`Pin draf dipindah ke: [${lon}, ${lat}]. Klik "Simpan Koordinat Pin" untuk menerapkan.`, false);
}

function clearDraftMarker() {
  state.draftCoordinates = null;
  if (state.draftPin && state.onlineMap?.leafletMap?.hasLayer(state.draftPin)) {
    state.draftPin.remove();
  }
  if (elements.savePinCoords) elements.savePinCoords.disabled = true;
  if (elements.resetPinCoords) elements.resetPinCoords.disabled = true;
}

try {
  state.onlineMap = createOnlineMap({
    body: elements.mapBody,
    cameraCard: elements.mapCameraCard,
    cameraList: elements.mapCameraList,
    closeButton: elements.mapCloseButton,
    expandButton: elements.mapExpandButton,
    gpsButton: elements.mapGpsButton,
    mapElement: elements.mapRouteMap,
    mapSection: elements.mapSection,
    onSelectHighway: (highwayId) => {
      elements.roadFilter.value = highwayId;
      renderCameraList();
      state.onlineMap?.selectHighway(highwayId);
    },
    onWatchCamera: (camera) => {
      selectCamera(camera);
    },
    showAllLinesToggle: elements.mapShowAllLines,
    summary: elements.mapSummary,
    tileStatus: elements.mapTileStatus,
    toggle: elements.mapToggle,
    watchButtonLabel: "Lihat Lokasi",
  });

  const map = state.onlineMap.leafletMap;
  const pinIcon = window.L.divIcon({
    className: "admin-active-pin",
    html: "<span>⌖</span>",
    iconAnchor: [18, 18],
    iconSize: [36, 36],
  });
  state.activePin = window.L.marker([0, 0], { draggable: true, icon: pinIcon });

  state.activePin.on("dragend", () => {
    const pos = state.activePin.getLatLng();
    const lat = Number(pos.lat.toFixed(6));
    const lon = Number(pos.lng.toFixed(6));
    updateDraftMarker(lon, lat);
  });

  map.on("click", (event) => {
    const lat = Number(event.latlng.lat.toFixed(6));
    const lon = Number(event.latlng.lng.toFixed(6));
    updateDraftMarker(lon, lat);
  });
} catch (error) {
  console.error("Failed to initialize online map:", error);
}

function updateActiveMarker(lon, lat) {
  if (!state.onlineMap?.leafletMap || !Number.isFinite(lon) || !Number.isFinite(lat)) {
    if (state.activePin && state.onlineMap?.leafletMap?.hasLayer(state.activePin)) {
      state.activePin.remove();
    }
    return;
  }
  state.activePin.setLatLng([lat, lon]);
  if (!state.onlineMap.leafletMap.hasLayer(state.activePin)) {
    state.activePin.addTo(state.onlineMap.leafletMap);
  }
}

function defaultRegion(direction) {
  return direction === "B"
    ? { x: .5, y: 0, width: .5, height: 1, status: "inferred" }
    : { x: 0, y: 0, width: .5, height: 1, status: "inferred" };
}

function activeRegion() {
  const direction = elements.regionDirection.value;
  state.regions[direction] ??= defaultRegion(direction);
  return state.regions[direction];
}

function renderRegion() {
  const isDual = elements.cameraSide.value === "A/B";
  if (!isDual) {
    if (elements.redRegion) elements.redRegion.hidden = true;
    if (elements.frameToolbar) elements.frameToolbar.hidden = true;
    if (elements.frameAuditGuide) elements.frameAuditGuide.hidden = true;
    return;
  }
  const direction = elements.regionDirection.value;
  const region = state.regions[direction];
  const enabled = Boolean(region);
  elements.regionEnabled.checked = enabled;
  elements.redRegion.hidden = !enabled;
  elements.regionLeft.disabled = !enabled;
  elements.regionRight.disabled = !enabled;
  elements.regionConfirm.disabled = !enabled;
  if (!enabled) return;

  Object.assign(elements.redRegion.style, {
    left: `${region.x * 100}%`, top: `${region.y * 100}%`,
    width: `${region.width * 100}%`, height: `${region.height * 100}%`,
  });
  elements.redRegion.dataset.status = region.status;
  elements.regionConfirm.textContent = region.status === "confirmed" ? "Area confirmed" : "Konfirmasi area";
  elements.regionLabel.textContent = state.highways.find((road) => road.id === elements.highwayId.value)?.name ?? "Ruas";
}

function updateDirectionUi() {
  const isDual = elements.cameraSide.value === "A/B";
  if (elements.frameToolbar) {
    elements.frameToolbar.hidden = !isDual;
  }
  if (elements.frameAuditGuide) {
    elements.frameAuditGuide.hidden = !isDual;
  }
  if (isDual) {
    renderRegion();
  } else if (elements.redRegion) {
    elements.redRegion.hidden = true;
  }
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.method && options.method !== "GET" ? { "X-Admin-Nonce": state.nonce } : {}),
      ...options.headers,
    },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
  return body;
}

function setBusy(message = "") { elements.saveState.textContent = message; }
function valueOrNull(element) { return element.value.trim() === "" ? null : Number(element.value); }

function filteredCameras() {
  const query = elements.search.value.trim().toLowerCase();
  return state.cameras.filter((camera) => {
    if (elements.roadFilter.value && camera.highwayId !== elements.roadFilter.value) return false;
    if (elements.statusFilter.value && camera.curationStatus !== elements.statusFilter.value) return false;
    if (!query) return true;
    return [camera.id, camera.name, camera.providerCameraId, camera.highwayId]
      .some((value) => String(value ?? "").toLowerCase().includes(query));
  });
}

function renderCameraList() {
  const cameras = filteredCameras();
  elements.cameraCount.textContent = `${cameras.length} dari ${state.cameras.length} kamera`;
  elements.cameraList.replaceChildren(...cameras.map((camera) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "camera-item";
    button.setAttribute("aria-pressed", String(camera.id === state.current?.id));
    const title = document.createElement("strong");
    const detail = document.createElement("span");
    title.textContent = camera.name;
    detail.textContent = `${camera.highwayId} • ${camera.side ?? camera.directions?.join("/") ?? "?"} • ${camera.curationStatus}`;
    button.append(title, detail);
    button.addEventListener("click", () => selectCamera(camera));
    return button;
  }));
}

function renderJsonWithDiff(beforeObj, afterObj) {
  if (!elements.jsonDiffBefore || !elements.jsonDiffAfter) return;
  const beforeJson = JSON.stringify(beforeObj ?? {}, null, 2);
  const afterJson = JSON.stringify(afterObj ?? {}, null, 2);

  elements.jsonDiffBefore.textContent = beforeJson;

  const beforeLines = beforeJson.split("\n");
  const afterLines = afterJson.split("\n");

  const diffHtml = afterLines.map((line) => {
    const isNewOrChanged = !beforeLines.includes(line);
    const escaped = line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    if (isNewOrChanged && line.trim() !== "{" && line.trim() !== "}") {
      return `<span class="diff-line-changed">${escaped}</span>`;
    }
    return escaped;
  }).join("\n");

  elements.jsonDiffAfter.innerHTML = `<code>${diffHtml}</code>`;
}

function updateJsonDiff() {
  const currentCamera = state.current ? structuredClone(state.current) : null;
  const draftCamera = formCamera();
  renderJsonWithDiff(currentCamera, draftCamera);
}

function setForm(camera) {
  elements.cameraId.value = camera?.id ?? "(dibuat otomatis)";
  elements.providerId.value = camera?.providerCameraId ?? "";
  elements.providerId.readOnly = Boolean(camera?.providerCameraId);
  elements.cameraName.value = camera?.name ?? "";
  elements.streamUrl.value = camera?.streamUrl ?? "";
  elements.sourcePage.value = camera?.sourcePage ?? "";
  elements.highwayId.value = camera?.highwayId ?? state.highways[0]?.id ?? "";
  elements.cameraKm.value = camera?.km ?? "";

  const isDualDirection = camera?.cameraType === "wide_view" ||
    camera?.cameraType === "toll_gate" ||
    camera?.directions?.join("/") === "A/B" ||
    camera?.directions?.join("") === "AB" ||
    (Array.isArray(camera?.directions) && camera.directions.includes("A") && camera.directions.includes("B")) ||
    camera?.side === "A/B";

  elements.cameraSide.value = isDualDirection ? "A/B" : (camera?.side ?? "");
  elements.curationStatus.value = camera?.curationStatus ?? "needs_review";
  elements.longitude.value = camera?.coordinates?.[0] ?? "";
  elements.latitude.value = camera?.coordinates?.[1] ?? "";
  elements.enabled.checked = Boolean(camera?.enabled);
  elements.notes.value = camera?.notes ?? "";
  state.regions = structuredClone(camera?.viewRegions ?? {});
  elements.regionDirection.value = camera?.side === "B" ? "B" : "A";

  updateDirectionUi();
  clearDraftMarker();

  elements.deleteCamera.disabled = !camera;
  elements.verifyCamera.disabled = !camera;

  if (camera?.streamUrl) {
    state.videoController.load(camera);
    elements.video.play?.().catch(() => {});
  } else {
    state.videoController.destroy({ clearSource: true });
  }

  updateActiveMarker(camera?.coordinates?.[0], camera?.coordinates?.[1]);
  updateJsonDiff();
}

function selectCamera(camera) {
  state.current = camera;
  setForm(camera);
  renderCameraList();
  if (camera) {
    const selected = camera.id ? state.onlineMap?.selectCamera(camera.id) : false;
    if (!selected && camera.highwayId) {
      state.onlineMap?.selectHighway(camera.highwayId);
    }
  }
  setBusy("");
}

function formCamera() {
  const base = state.current ? structuredClone(state.current) : {};
  const sideValue = elements.cameraSide.value;
  const isDual = sideValue === "A/B";

  const updated = {
    ...base,
    coordinates: elements.longitude.value && elements.latitude.value
      ? [Number(elements.longitude.value), Number(elements.latitude.value)]
      : null,
    enabled: elements.enabled.checked,
    highwayId: elements.highwayId.value,
    id: state.current?.id ?? "",
    km: valueOrNull(elements.cameraKm),
    name: elements.cameraName.value,
    notes: elements.notes.value,
    providerCameraId: state.current?.providerCameraId ?? (elements.providerId.value.trim() || null),
    side: isDual ? null : (sideValue || null),
    sourcePage: elements.sourcePage.value || null,
    streamUrl: elements.streamUrl.value,
  };

  if (isDual) {
    updated.directions = ["A", "B"];
    if (base.cameraType === "toll_gate") {
      updated.cameraType = "toll_gate";
      delete updated.directionReview;
    } else {
      updated.cameraType = "wide_view";
      updated.directionReview = base.directionReview && base.directionReview.status === "confirmed"
        ? base.directionReview
        : { status: "confirmed", method: "admin_wide_view_selection" };
    }
  } else {
    delete updated.directions;
    delete updated.directionReview;
    if (base.cameraType === "toll_gate" || base.cameraType === "wide_view") {
      delete updated.cameraType;
    }
  }

  if (isDual && Object.keys(state.regions).length > 0) {
    updated.viewRegions = structuredClone(state.regions);
  } else if (!isDual) {
    delete updated.viewRegions;
  }

  return updated;
}

async function reload({ selectId = state.current?.id } = {}) {
  const [body, highwayGeoJson] = await Promise.all([
    api("/api/admin/state"),
    fetch("/site/data/highways.geojson").then((r) => r.json()).catch(() => ({ features: [] })),
  ]);

  state.nonce = body.nonce;
  state.cameras = body.cameras;
  state.highways = body.highways;
  state.highwayFeatures = highwayGeoJson.features ?? [];

  elements.highwayId.replaceChildren(...state.highways.map((road) => new Option(road.name, road.id)));
  elements.roadFilter.replaceChildren(new Option("Semua ruas", ""), ...state.highways.map((road) => new Option(road.name, road.id)));
  renderGit(body.git);

  state.onlineMap?.setData(state.highwayFeatures, state.cameras);

  const selected = state.cameras.find((camera) => camera.id === selectId) ?? state.cameras[0] ?? null;
  state.current = selected;
  setForm(selected);
  renderCameraList();
}

function renderGit(git) {
  elements.gitSummary.textContent = `Branch ${git.branch || "detached"} • ${git.trackedChanges.length} tracked changes`;
  elements.gitDiff.textContent = git.diff || "Tidak ada perubahan camera data.";
  if (git.outsideAllowlist.length) {
    elements.gitSummary.textContent += ` • commit diblokir oleh: ${git.outsideAllowlist.map((item) => item.path).join(", ")}`;
  }
}

function installRegionDrag() {
  let drag = null;
  elements.redRegion.addEventListener("pointerdown", (event) => {
    const region = activeRegion();
    drag = {
      mode: event.target === elements.redRegion.querySelector("i") ? "resize" : "move",
      original: { ...region },
      startX: event.clientX,
      startY: event.clientY,
    };
    elements.redRegion.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  elements.redRegion.addEventListener("pointermove", (event) => {
    if (!drag) return;
    const rect = elements.videoStage.getBoundingClientRect();
    const dx = (event.clientX - drag.startX) / rect.width;
    const dy = (event.clientY - drag.startY) / rect.height;
    const region = activeRegion();
    if (drag.mode === "move") {
      region.x = Math.max(0, Math.min(1 - region.width, drag.original.x + dx));
      region.y = Math.max(0, Math.min(1 - region.height, drag.original.y + dy));
    } else {
      region.width = Math.max(.1, Math.min(1 - region.x, drag.original.width + dx));
      region.height = Math.max(.1, Math.min(1 - region.y, drag.original.height + dy));
    }
    region.status = "inferred";
    renderRegion();
    updateJsonDiff();
  });
  elements.redRegion.addEventListener("pointerup", () => { drag = null; });
}

elements.cameraForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    setBusy("Menyimpan…");
    const result = await api("/api/admin/cameras", {
      body: JSON.stringify({ camera: formCamera(), originalId: state.current?.id ?? null }),
      method: "POST",
    });
    await reload({ selectId: result.camera.id });
    setBusy("Tersimpan lokal • belum commit");
    setInferenceStatus("Kamera tersimpan di data lokal.", false);
  } catch (error) {
    setBusy(error.message);
    setInferenceStatus(`Gagal menyimpan: ${error.message}`, false);
  }
});

elements.newCamera.addEventListener("click", () => {
  state.current = null;
  setForm(null);
  renderCameraList();
});

elements.deleteCamera.addEventListener("click", async () => {
  if (!state.current) return;
  const confirmation = prompt(`Hard delete tidak membuat tombstone. Ketik ID berikut:\n${state.current.id}`);
  if (confirmation == null) return;
  try {
    await api(`/api/admin/cameras/${encodeURIComponent(state.current.id)}`, {
      body: JSON.stringify({ confirmation }),
      method: "DELETE",
    });
    state.current = null;
    await reload({ selectId: null });
    setBusy("Kamera dihapus lokal • belum commit");
  } catch (error) { setBusy(error.message); }
});

elements.verifyCamera.addEventListener("click", async () => {
  if (!state.current) return;
  try {
    const result = await api(`/api/admin/cameras/${encodeURIComponent(state.current.id)}/verify`, {
      body: JSON.stringify({
        latitude: elements.latitude.value,
        longitude: elements.longitude.value,
        notes: elements.notes.value,
        side: elements.cameraSide.value,
      }),
      method: "POST",
    });
    await reload({ selectId: result.camera.id });
    setBusy(`Verified • ${Math.round(result.projection.distanceM)} m dari geometri`);
  } catch (error) { setBusy(error.message); }
});

elements.savePinCoords.addEventListener("click", () => {
  if (!state.draftCoordinates) return;
  const [lon, lat] = state.draftCoordinates;
  elements.longitude.value = lon;
  elements.latitude.value = lat;
  updateActiveMarker(lon, lat);
  clearDraftMarker();
  setInferenceStatus(`Koordinat pin diterapkan ke form: ${lon}, ${lat}`, false);
  setBusy(`Koordinat diset dari pin: ${lon}, ${lat}`);
  updateJsonDiff();
});

elements.resetPinCoords.addEventListener("click", () => {
  clearDraftMarker();
  const origLon = state.current?.coordinates?.[0];
  const origLat = state.current?.coordinates?.[1];
  updateActiveMarker(origLon, origLat);
  setInferenceStatus("Perubahan pin draf dibatalkan.", false);
});

elements.reloadVideo.addEventListener("click", () => {
  const camera = formCamera();
  if (camera.streamUrl) {
    state.videoController.destroy({ clearSource: true });
    state.videoController.load(camera);
    elements.video.play?.().catch(() => {});
    setInferenceStatus(`Memuat ulang video stream: ${camera.name || camera.id}`, false);
  } else {
    alert("URL Stream kosong.");
  }
});

elements.cameraSide.addEventListener("change", () => {
  updateDirectionUi();
  updateJsonDiff();
});

for (const element of [elements.search, elements.roadFilter, elements.statusFilter]) {
  element.addEventListener("input", () => {
    renderCameraList();
    if (element === elements.roadFilter) {
      if (elements.roadFilter.value) {
        state.onlineMap?.selectHighway(elements.roadFilter.value);
      } else {
        state.onlineMap?.showAll();
      }
    }
  });
}

elements.highwayId.addEventListener("change", () => {
  renderRegion();
  if (elements.highwayId.value) {
    state.onlineMap?.selectHighway(elements.highwayId.value);
  }
  updateJsonDiff();
});

elements.regionDirection.addEventListener("change", renderRegion);
elements.regionEnabled.addEventListener("change", () => {
  const direction = elements.regionDirection.value;
  if (elements.regionEnabled.checked) {
    state.regions[direction] = defaultRegion(direction);
  } else {
    delete state.regions[direction];
  }
  renderRegion();
  updateJsonDiff();
});
elements.regionLeft.addEventListener("click", () => { state.regions[elements.regionDirection.value] = defaultRegion("A"); renderRegion(); updateJsonDiff(); });
elements.regionRight.addEventListener("click", () => { state.regions[elements.regionDirection.value] = defaultRegion("B"); renderRegion(); updateJsonDiff(); });
elements.regionConfirm.addEventListener("click", () => { activeRegion().status = "confirmed"; renderRegion(); updateJsonDiff(); });
elements.streamUrl.addEventListener("change", () => {
  if (elements.streamUrl.validity.valid && elements.streamUrl.value) {
    state.videoController.load({ streamUrl: elements.streamUrl.value });
  }
  updateJsonDiff();
});

for (const input of elements.cameraForm.querySelectorAll("input, select, textarea")) {
  input.addEventListener("input", updateJsonDiff);
  input.addEventListener("change", updateJsonDiff);
}

elements.refreshGit.addEventListener("click", async () => renderGit(await api("/api/admin/git")));
elements.runTests.addEventListener("click", async () => {
  elements.commandOutput.textContent = "Menjalankan npm test…";
  try { elements.commandOutput.textContent = (await api("/api/admin/validate", { body: "{}", method: "POST" })).output; }
  catch (error) { elements.commandOutput.textContent = error.message; }
});
elements.commit.addEventListener("click", async () => {
  if (!confirm("Commit hanya camera data setelah diff dan tests direview. Lanjutkan?")) return;
  try {
    renderGit(await api("/api/admin/commit", { body: JSON.stringify({ confirmed: true, message: elements.commitMessage.value }), method: "POST" }));
  } catch (error) { elements.commandOutput.textContent = error.message; }
});
elements.push.addEventListener("click", async () => {
  if (!confirm("Push current branch ke origin sekarang?")) return;
  try { elements.commandOutput.textContent = `Pushed ${(await api("/api/admin/push", { body: JSON.stringify({ confirmed: true }), method: "POST" })).branch}`; }
  catch (error) { elements.commandOutput.textContent = error.message; }
});

elements.bulkGeocode.addEventListener("click", async () => {
  const roadFilter = elements.roadFilter.value;
  if (!roadFilter) {
    alert("Pilih satu ruas spesifik dari dropdown filter terlebih dahulu.");
    return;
  }
  const feature = state.highwayFeatures.find((f) => (f.properties?.id ?? f.id) === roadFilter);
  if (!feature) {
    alert("Data geometri ruas tidak ditemukan.");
    return;
  }

  const coords = feature.geometry?.coordinates ?? [];
  if (coords.length < 2) {
    alert("Geometri ruas tidak memiliki koordinat yang valid.");
    return;
  }

  const camerasOnRoad = state.cameras.filter((c) => c.highwayId === roadFilter);
  const validKms = camerasOnRoad.map((c) => c.km).filter(Number.isFinite);
  const minKm = validKms.length ? Math.min(...validKms) : 0;
  const maxKm = validKms.length ? Math.max(...validKms) : 0;
  const canonicalLengthM = feature.properties?.canonicalLengthM || 0;

  const toUpdate = [];
  for (const camera of camerasOnRoad) {
    if (camera.coordinates) continue; // Lewati kamera yang sudah ada koordinat

    let coordinate = null;
    let roadPosM = null;

    // 1. Coba stationing anchor standar
    const estimate = estimateCameraOnHighway(camera, feature);
    if (estimate?.coordinate) {
      coordinate = estimate.coordinate;
      roadPosM = estimate.roadPositionM;
    } else if (Number.isFinite(camera.km)) {
      // 2. Fallback: Interpolasi proporsional sepanjang polyline jalan
      const fraction = maxKm > minKm ? (camera.km - minKm) / (maxKm - minKm) : 0.5;
      roadPosM = canonicalLengthM > 0 ? fraction * canonicalLengthM : fraction * 10000;
      coordinate = coordinateAtRoadPosition(coords, roadPosM);
    }

    if (coordinate) {
      toUpdate.push({
        camera,
        coordinate: [Number(coordinate[0].toFixed(6)), Number(coordinate[1].toFixed(6))],
        roadPositionM: roadPosM != null ? Math.round(roadPosM) : null,
      });
    }
  }

  if (toUpdate.length === 0) {
    alert("Tidak ada kamera yang membutuhkan estimasi (semua sudah berkoordinat atau data KM kosong).");
    return;
  }

  if (!confirm(`Akan mengisi koordinat untuk ${toUpdate.length} kamera di ruas ${feature.properties?.name || roadFilter}. Lanjutkan?`)) return;

  setBusy(`Mengestimasi & menyimpan ${toUpdate.length} kamera...`);
  setInferenceStatus(`Mengestimasi & menyimpan ${toUpdate.length} kamera dari KM...`, true);
  try {
    const payload = {
      updates: toUpdate.map(({ camera, coordinate, roadPositionM }) => ({
        id: camera.id,
        coordinates: coordinate,
        roadPositionM: roadPositionM,
      })),
    };

    await api("/api/admin/apply-km-estimates", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    await reload({ selectId: state.current?.id });
    setBusy(`Selesai! ${toUpdate.length} kamera pada ruas ${roadFilter} diperbarui.`);
    setInferenceStatus(`Selesai! ${toUpdate.length} kamera pada ruas ${roadFilter} diperbarui.`, false);
    alert(`Berhasil mengisi koordinat untuk ${toUpdate.length} kamera di ruas ${feature.properties?.name || roadFilter}!`);
  } catch (err) {
    alert(err.message);
    setBusy("");
    setInferenceStatus(`Gagal estimasi KM: ${err.message}`, false);
  }
});

elements.bulkGateGeocode.addEventListener("click", async () => {
  const roadFilter = elements.roadFilter.value;
  if (!roadFilter) {
    alert("Pilih satu ruas spesifik dari dropdown filter terlebih dahulu.");
    return;
  }

  setInferenceStatus(`Mencari gerbang tol OSM di Overpass untuk ruas ${roadFilter}...`, true);
  try {
    const result = await api("/api/admin/locate-gates", {
      method: "POST",
      body: JSON.stringify({ highwayId: roadFilter }),
    });

    state.pendingGateMatches = result.matches ?? [];

    if (state.pendingGateMatches.length === 0) {
      setInferenceStatus("Tidak ada kamera gerbang tol terdeteksi pada ruas ini.", false);
      alert("Tidak ada kamera gerbang tol yang cocok pada ruas ini.");
      return;
    }

    elements.gateMatchSummary.textContent = `Ditemukan ${state.pendingGateMatches.length} kamera gerbang tol pada ruas ${result.highwayName}. Pilih data yang ingin diterapkan:`;

    elements.gateMatchTbody.replaceChildren(...state.pendingGateMatches.map((item, index) => {
      const tr = document.createElement("tr");

      const tdCheck = document.createElement("td");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.dataset.index = String(index);
      checkbox.checked = Boolean(item.topCandidate?.withinLimit);
      checkbox.disabled = !item.hasCandidate;
      tdCheck.append(checkbox);

      const tdCam = document.createElement("td");
      tdCam.innerHTML = `<strong>${item.camera.name}</strong><br><span class="muted">${item.camera.id}</span>`;

      const tdCandidate = document.createElement("td");
      if (item.topCandidate) {
        tdCandidate.innerHTML = `<a href="${item.topCandidate.sourceUrl}" target="_blank" rel="noreferrer">${item.topCandidate.osmName}</a><br><span class="muted">Node: ${item.topCandidate.osmNode} [${item.topCandidate.coordinates[0]}, ${item.topCandidate.coordinates[1]}]</span>`;
      } else {
        tdCandidate.innerHTML = `<span class="muted">Tidak ditemukan kandidat OSM</span>`;
      }

      const tdDistance = document.createElement("td");
      if (item.topCandidate) {
        const tagClass = item.topCandidate.withinLimit ? "tag-within" : "tag-warning";
        tdDistance.innerHTML = `<span class="${tagClass}">${item.topCandidate.distanceM} m</span>`;
      } else {
        tdDistance.textContent = "-";
      }

      const tdStatus = document.createElement("td");
      if (item.topCandidate) {
        tdStatus.textContent = item.topCandidate.withinLimit ? "OK (≤150m)" : "Warning (>150m)";
      } else {
        tdStatus.textContent = "N/A";
      }

      tr.append(tdCheck, tdCam, tdCandidate, tdDistance, tdStatus);
      return tr;
    }));

    elements.gateMatchDialog.showModal();
    setInferenceStatus("Menunggu konfirmasi pemilihan kandidat gerbang tol...", false);
  } catch (err) {
    setInferenceStatus(`Gagal mencari gate: ${err.message}`, false);
    alert(err.message);
  }
});

elements.gateMatchCancel.addEventListener("click", () => {
  elements.gateMatchDialog.close();
  setInferenceStatus("Pencarian gate dibatalkan.", false);
});

elements.gateMatchForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  elements.gateMatchDialog.close();

  const checkboxes = elements.gateMatchTbody.querySelectorAll("input[type='checkbox']:checked");
  const selectedIndices = Array.from(checkboxes).map((cb) => Number(cb.dataset.index));

  if (selectedIndices.length === 0) {
    setInferenceStatus("Tidak ada gerbang tol yang dipilih.", false);
    return;
  }

  const toApply = selectedIndices
    .map((index) => state.pendingGateMatches[index])
    .filter((match) => match?.topCandidate);

  setInferenceStatus(`Menerapkan koordinat untuk ${toApply.length} gerbang tol...`, true);
  try {
    const payload = {
      matches: toApply.map((match) => ({
        id: match.camera.id,
        longitude: match.topCandidate.coordinates[0],
        latitude: match.topCandidate.coordinates[1],
        sourceUrl: match.topCandidate.sourceUrl,
        osmNode: match.topCandidate.osmNode,
        allowDistantProjection: true,
      })),
    };

    await api("/api/admin/apply-gate-matches", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    await reload({ selectId: state.current?.id });
    setInferenceStatus(`Selesai! ${toApply.length} kamera gerbang tol berhasil diset koordinatnya.`, false);
    alert(`Berhasil memperbarui ${toApply.length} kamera gerbang tol!`);
  } catch (err) {
    setInferenceStatus(`Gagal menyimpan gerbang: ${err.message}`, false);
    alert(err.message);
  }
});

elements.btnCheckDuplicates.addEventListener("click", async () => {
  const roadId = elements.roadFilter.value || null;
  const scopeLabel = roadId ? `ruas ${roadId}` : "seluruh ruas jalan tol";

  setInferenceStatus(`Memeriksa kamera duplikat pada ${scopeLabel}...`, true);
  try {
    const result = await api("/api/admin/find-duplicate-cameras", {
      method: "POST",
      body: JSON.stringify({ highwayId: roadId }),
    });

    state.pendingDuplicates = result.duplicates ?? [];

    if (state.pendingDuplicates.length === 0) {
      setInferenceStatus(`Tidak ditemukan kamera duplikat pada ${scopeLabel}.`, false);
      alert(`Tidak ada kamera duplikat dengan stream URL identik yang ditemukan pada ${scopeLabel}.`);
      return;
    }

    elements.duplicateCamerasSummary.textContent = `Ditemukan ${state.pendingDuplicates.length} kamera duplikat pada ${scopeLabel}. Kamera asli (ID lama) akan dipertahankan, centang kamera duplikat yang ingin dihapus:`;

    elements.duplicateCamerasTbody.replaceChildren(...state.pendingDuplicates.map((item, index) => {
      const tr = document.createElement("tr");

      const tdCheck = document.createElement("td");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.dataset.index = String(index);
      checkbox.checked = true;
      tdCheck.append(checkbox);

      const tdDup = document.createElement("td");
      tdDup.innerHTML = `<strong>${item.duplicateCamera.name || "-"}</strong><br><span class="muted">${item.duplicateCamera.id} (${item.duplicateCamera.highwayId})</span><br><span class="tag-warning">${item.duplicateCamera.curationStatus || "needs_review"}</span>`;

      const tdOrig = document.createElement("td");
      tdOrig.innerHTML = `<strong>${item.originalCamera.name || "-"}</strong><br><span class="muted">${item.originalCamera.id} (${item.originalCamera.highwayId})</span><br><span class="tag-within">${item.originalCamera.curationStatus || "needs_review"}</span>`;

      const tdStream = document.createElement("td");
      tdStream.innerHTML = `<span class="muted" style="word-break: break-all; font-family: monospace; font-size: 11px;">${item.streamUrl}</span>`;

      tr.append(tdCheck, tdDup, tdOrig, tdStream);
      return tr;
    }));

    elements.duplicateCamerasDialog.showModal();
    setInferenceStatus("Menunggu konfirmasi penghapusan kamera duplikat...", false);
  } catch (err) {
    setInferenceStatus(`Gagal memeriksa duplikat: ${err.message}`, false);
    alert(err.message);
  }
});

elements.duplicateCamerasCancel.addEventListener("click", () => {
  elements.duplicateCamerasDialog.close();
  setInferenceStatus("Pemeriksaan duplikat dibatalkan.", false);
});

elements.duplicateCamerasForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  elements.duplicateCamerasDialog.close();

  const checkboxes = elements.duplicateCamerasTbody.querySelectorAll("input[type='checkbox']:checked");
  const selectedIndices = Array.from(checkboxes).map((cb) => Number(cb.dataset.index));

  if (selectedIndices.length === 0) {
    setInferenceStatus("Tidak ada kamera duplikat yang dipilih untuk dihapus.", false);
    return;
  }

  const cameraIdsToDelete = selectedIndices
    .map((index) => state.pendingDuplicates[index]?.duplicateCamera?.id)
    .filter(Boolean);

  setInferenceStatus(`Menghapus ${cameraIdsToDelete.length} kamera duplikat...`, true);
  try {
    const result = await api("/api/admin/bulk-delete-cameras", {
      method: "POST",
      body: JSON.stringify({ cameraIds: cameraIdsToDelete }),
    });

    await reload({ selectId: null });
    setInferenceStatus(`Berhasil menghapus ${result.deletedCount} kamera duplikat. Sisa ${result.remainingCount} kamera.`, false);
    alert(`Berhasil menghapus ${result.deletedCount} kamera duplikat!`);
  } catch (err) {
    setInferenceStatus(`Gagal menghapus kamera duplikat: ${err.message}`, false);
    alert(err.message);
  }
});

elements.btnRenameHighway.addEventListener("click", () => {
  const roadId = elements.roadFilter.value || elements.highwayId.value;
  if (!roadId) {
    alert("Pilih satu ruas terlebih dahulu dari filter ruas atau form.");
    return;
  }
  const highway = state.highways.find((h) => h.id === roadId);
  const currentName = highway?.name || roadId;

  elements.renameHighwayTarget.textContent = `Mengubah nama tampilan untuk ruas: [${roadId}]`;
  elements.renameHighwayInput.value = currentName;
  elements.renameHighwayDialog.showModal();
});

elements.renameHighwayCancel.addEventListener("click", () => {
  elements.renameHighwayDialog.close();
});

elements.renameHighwayForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  elements.renameHighwayDialog.close();

  const roadId = elements.roadFilter.value || elements.highwayId.value;
  const newName = elements.renameHighwayInput.value.trim();
  if (!roadId || !newName) return;

  setInferenceStatus(`Menyimpan nama baru ruas ${roadId}...`, true);
  try {
    const result = await api("/api/admin/rename-highway", {
      method: "POST",
      body: JSON.stringify({ highwayId: roadId, newName }),
    });
    await reload({ selectId: state.current?.id });
    setInferenceStatus(`Berhasil mengubah nama ruas ${roadId} menjadi "${result.name}".`, false);
    alert(`Nama ruas berhasil diperbarui menjadi "${result.name}"!`);
  } catch (err) {
    setInferenceStatus(`Gagal mengubah nama ruas: ${err.message}`, false);
    alert(err.message);
  }
});

elements.btnBulkDirection.addEventListener("click", () => {
  const roadId = elements.roadFilter.value || elements.highwayId.value;
  if (!roadId) {
    alert("Pilih satu ruas spesifik terlebih dahulu dari filter ruas atau form.");
    return;
  }
  const highway = state.highways.find((h) => h.id === roadId);
  const highwayName = highway?.name || roadId;
  const camerasOnRoad = state.cameras.filter((c) => c.highwayId === roadId);

  elements.bulkDirectionTarget.textContent = `Ruas: ${highwayName} (${camerasOnRoad.length} kamera akan diperbarui)`;
  elements.bulkDirectionSelect.value = "";
  elements.bulkDirectionDialog.showModal();
});

elements.bulkDirectionCancel.addEventListener("click", () => {
  elements.bulkDirectionDialog.close();
});

elements.bulkDirectionForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  elements.bulkDirectionDialog.close();

  const roadId = elements.roadFilter.value || elements.highwayId.value;
  const direction = elements.bulkDirectionSelect.value;
  if (!roadId) return;

  const dirLabel = direction || "Belum pasti";
  setInferenceStatus(`Mengubah arah semua kamera di ruas ${roadId} menjadi "${dirLabel}"...`, true);
  try {
    const result = await api("/api/admin/bulk-update-direction", {
      method: "POST",
      body: JSON.stringify({ highwayId: roadId, direction }),
    });

    await reload({ selectId: state.current?.id });
    setInferenceStatus(`Selesai! Arah ${result.updatedCount} kamera di ruas ${roadId} diubah menjadi "${dirLabel}".`, false);
    alert(`Berhasil mengubah arah ${result.updatedCount} kamera di ruas ${roadId} menjadi "${dirLabel}"!`);
  } catch (err) {
    setInferenceStatus(`Gagal mengubah arah: ${err.message}`, false);
    alert(err.message);
  }
});

elements.btnBulkEnable.addEventListener("click", () => {
  const roadId = elements.roadFilter.value || elements.highwayId.value;
  if (!roadId) {
    alert("Pilih satu ruas spesifik terlebih dahulu dari filter ruas atau form.");
    return;
  }
  const highway = state.highways.find((h) => h.id === roadId);
  const highwayName = highway?.name || roadId;
  const camerasOnRoad = state.cameras.filter((c) => c.highwayId === roadId);
  const readyCount = camerasOnRoad.filter((c) =>
    Array.isArray(c.coordinates) &&
    c.coordinates.length === 2 &&
    Number.isFinite(c.roadPositionM) &&
    ((c.side === "A" || c.side === "B") || (c.side === null && c.directions?.includes("A") && c.directions?.includes("B")))
  ).length;
  const alreadyEnabledCount = camerasOnRoad.filter((c) => c.enabled).length;

  elements.bulkEnableTarget.textContent = `Ruas: ${highwayName}`;
  elements.bulkEnableSummary.textContent = `Total kamera pada ruas ini: ${camerasOnRoad.length} (Aktif saat ini: ${alreadyEnabledCount}, Siap diaktifkan: ${readyCount}).`;
  elements.bulkEnableAction.value = "enable";
  elements.bulkEnableBypass.checked = false;
  elements.bulkEnableDialog.showModal();
});

elements.bulkEnableCancel.addEventListener("click", () => {
  elements.bulkEnableDialog.close();
});

elements.bulkEnableForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  elements.bulkEnableDialog.close();

  const roadId = elements.roadFilter.value || elements.highwayId.value;
  const action = elements.bulkEnableAction.value;
  const isEnable = action === "enable";
  const bypass = elements.bulkEnableBypass.checked;
  if (!roadId) return;

  const actionLabel = isEnable ? "mengaktifkan" : "menonaktifkan";
  setInferenceStatus(`Sedang ${actionLabel} semua kamera di ruas ${roadId}...`, true);
  try {
    const result = await api("/api/admin/bulk-update-enabled", {
      method: "POST",
      body: JSON.stringify({ highwayId: roadId, enabled: isEnable, bypassValidation: bypass }),
    });

    await reload({ selectId: state.current?.id });
    const msg = isEnable
      ? `Selesai! ${result.updatedCount} kamera di ruas ${roadId} berhasil diaktifkan (${result.skippedCount} dilewati).`
      : `Selesai! ${result.updatedCount} kamera di ruas ${roadId} berhasil dinonaktifkan.`;
    setInferenceStatus(msg, false);
    alert(msg);
  } catch (err) {
    setInferenceStatus(`Gagal memperbarui status aktif: ${err.message}`, false);
    alert(err.message);
  }
});

elements.btnHighwayHealth.addEventListener("click", () => {
  const roadId = elements.roadFilter.value || elements.highwayId.value;
  if (!roadId) {
    alert("Pilih satu ruas spesifik terlebih dahulu dari filter ruas atau form.");
    return;
  }
  runHighwayHealthCheck(roadId);
});

let currentHealthRoadId = null;

async function runHighwayHealthCheck(roadId) {
  currentHealthRoadId = roadId;
  const highway = state.highways.find((h) => h.id === roadId);
  const highwayName = highway?.name || roadId;

  elements.healthDialogEyebrow.textContent = `Ruas: [${roadId}]`;
  elements.healthDialogTitle.textContent = `Kesehatan Ruas: ${highwayName}`;
  elements.healthOverallBadge.className = "health-badge health-badge-unknown";
  elements.healthOverallBadge.textContent = "Mendiagnosis...";
  elements.healthLoading.hidden = false;
  elements.healthLoadingText.textContent = "Mendiagnosis live stream, kesegaran scrape, dan geografi OSM...";
  elements.healthContent.hidden = true;
  elements.highwayHealthDialog.showModal();

  try {
    const data = await api("/api/admin/highway-health", {
      method: "POST",
      body: JSON.stringify({ highwayId: roadId }),
    });
    renderHighwayHealthResult(data);
  } catch (err) {
    elements.healthLoading.hidden = true;
    elements.healthContent.hidden = false;
    elements.healthOverallBadge.className = "health-badge health-badge-critical";
    elements.healthOverallBadge.textContent = "Error";
    elements.healthIssuesContainer.hidden = false;
    elements.healthIssuesList.innerHTML = `<li>Gagal melakukan audit kesehatan: ${err.message}</li>`;
  }
}

function renderHighwayHealthResult(data) {
  elements.healthLoading.hidden = true;
  elements.healthContent.hidden = false;

  // Overall badge
  if (data.overallStatus === "healthy") {
    elements.healthOverallBadge.className = "health-badge health-badge-healthy";
    elements.healthOverallBadge.textContent = "🟢 Sehat";
  } else if (data.overallStatus === "warning") {
    elements.healthOverallBadge.className = "health-badge health-badge-warning";
    elements.healthOverallBadge.textContent = "🟡 Perhatian";
  } else {
    elements.healthOverallBadge.className = "health-badge health-badge-critical";
    elements.healthOverallBadge.textContent = "🔴 Kritis";
  }

  // Card 1: Streams
  const { streams } = data;
  elements.healthStreamRatio.textContent = `${streams.online}/${streams.total}`;
  if (streams.offline === 0 && streams.total > 0) {
    elements.healthStreamBadge.className = "health-badge health-badge-healthy";
    elements.healthStreamBadge.textContent = "100% Online";
  } else if (streams.online > 0) {
    elements.healthStreamBadge.className = "health-badge health-badge-warning";
    elements.healthStreamBadge.textContent = `${streams.healthPercent}% Online`;
  } else {
    elements.healthStreamBadge.className = "health-badge health-badge-critical";
    elements.healthStreamBadge.textContent = "Offline";
  }

  elements.healthStreamList.innerHTML = (streams.details ?? []).map((item) => `
    <div class="health-stream-item">
      <span class="health-stream-name" title="${item.name || item.id}">${item.name || item.id}</span>
      <span class="health-stream-status-${item.status === 'online' ? 'online' : 'offline'}">
        ${item.status === 'online' ? `✓ 200 OK (${item.latencyMs}ms)` : `✗ ${item.error || 'Offline'}`}
      </span>
    </div>
  `).join("");

  // Card 2: Scraping
  const { scraping } = data;
  if (!scraping.isStale && scraping.livePageReachable) {
    elements.healthScrapeBadge.className = "health-badge health-badge-healthy";
    elements.healthScrapeBadge.textContent = "Data Segar";
  } else if (scraping.upstreamChangedCount > 0) {
    elements.healthScrapeBadge.className = "health-badge health-badge-warning";
    elements.healthScrapeBadge.textContent = "URL Berubah";
  } else {
    elements.healthScrapeBadge.className = "health-badge health-badge-warning";
    elements.healthScrapeBadge.textContent = scraping.ageHours ? `${scraping.ageHours} jam` : "Perlu Scrape";
  }

  elements.healthScrapeTime.textContent = scraping.lastScrapedAt
    ? new Date(scraping.lastScrapedAt).toLocaleString("id-ID")
    : "Belum pernah";
  elements.healthScrapeAge.textContent = scraping.ageHours !== null
    ? `${scraping.ageHours} jam yang lalu`
    : "-";
  elements.healthScrapeUpstream.textContent = scraping.upstreamChangedCount > 0
    ? `⚠️ ${scraping.upstreamChangedCount} URL stream berganti di website Bina Marga`
    : scraping.livePageReachable
      ? "✓ Sinkron dengan website Bina Marga"
      : "Tidak dapat menghubungi website Bina Marga";

  // Card 3: Geography
  const { geography } = data;
  if (geography.boundsValid && geography.needsReviewCameras === 0) {
    elements.healthGeoBadge.className = "health-badge health-badge-healthy";
    elements.healthGeoBadge.textContent = "Valid & Lengkap";
  } else if (geography.boundsValid) {
    elements.healthGeoBadge.className = "health-badge health-badge-warning";
    elements.healthGeoBadge.textContent = "Sebagian Mapped";
  } else {
    elements.healthGeoBadge.className = "health-badge health-badge-critical";
    elements.healthGeoBadge.textContent = "Tidak Valid";
  }

  elements.healthGeoLength.textContent = `${(geography.canonicalLengthM / 1000).toFixed(2)} km`;
  elements.healthGeoPoints.textContent = `${geography.pointCount} titik polyline`;
  elements.healthGeoMapped.textContent = `${geography.locatedCameras} kamera (${geography.gatesCount} gerbang tol)`;
  elements.healthGeoReview.textContent = `${geography.needsReviewCameras} kamera`;

  // Issues list
  if (data.issues && data.issues.length > 0) {
    elements.healthIssuesContainer.hidden = false;
    elements.healthIssuesList.innerHTML = data.issues.map((issue) => `<li>${issue}</li>`).join("");
  } else {
    elements.healthIssuesContainer.hidden = true;
    elements.healthIssuesList.innerHTML = "";
  }
}

elements.healthActionRefreshScrape.addEventListener("click", async () => {
  if (!currentHealthRoadId) return;
  elements.healthLoading.hidden = false;
  elements.healthLoadingText.textContent = `Menjalankan live scrape untuk ruas ${currentHealthRoadId}...`;
  elements.healthContent.hidden = true;

  try {
    const result = await api("/api/admin/refresh-road-scrape", {
      method: "POST",
      body: JSON.stringify({ highwayId: currentHealthRoadId }),
    });
    await reload({ selectId: state.current?.id });
    setInferenceStatus(`Scrape selesai! ${result.updatedCount} URL stream diperbarui untuk ruas ${currentHealthRoadId}.`, false);
    await runHighwayHealthCheck(currentHealthRoadId);
  } catch (err) {
    alert(`Gagal scrape ruas: ${err.message}`);
    await runHighwayHealthCheck(currentHealthRoadId);
  }
});

elements.healthActionRepairGeo.addEventListener("click", async () => {
  if (!currentHealthRoadId) return;
  elements.healthLoading.hidden = false;
  elements.healthLoadingText.textContent = `Memperbaiki geometri dan stationing kamera untuk ruas ${currentHealthRoadId}...`;
  elements.healthContent.hidden = true;

  try {
    const result = await api("/api/admin/repair-highway-geography", {
      method: "POST",
      body: JSON.stringify({ highwayId: currentHealthRoadId }),
    });
    await reload({ selectId: state.current?.id });
    setInferenceStatus(`Geometri diperbarui! ${result.provisionedCount} KM diposisikan, ${result.gateMatchesCount} gerbang tol terproyeksi.`, false);
    await runHighwayHealthCheck(currentHealthRoadId);
  } catch (err) {
    alert(`Gagal memperbaiki geografi ruas: ${err.message}`);
    await runHighwayHealthCheck(currentHealthRoadId);
  }
});

elements.healthDialogClose.addEventListener("click", () => {
  elements.highwayHealthDialog.close();
});

installRegionDrag();
reload().catch((error) => { elements.commandOutput.textContent = error.message; });


