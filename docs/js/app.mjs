import {
  adjacentCamera,
  automaticCameras,
  createPassTracker,
  initialCamera,
  matchHighways,
  projectPointToLine,
  publicCameras,
} from "./geo.mjs";
import {
  geolocationFailure,
  geolocationPermissionState,
  INITIAL_LOCATION_OPTIONS,
  TRACKING_LOCATION_OPTIONS,
} from "./geolocation.mjs";
import { createOnlineMap } from "./online-map.mjs";
import { advanceRoutePosition, positionOnHighway } from "./simulator.mjs";
import {
  enterVideoFullscreen,
  fullscreenMethod,
  nativeMediaErrorMessage,
  prefersNativeHls,
  supportsNativeHls,
} from "./player.mjs";
import { createQuickActionManager } from "./quick-actions.mjs";

const elements = {
  accuracy: document.querySelector("#accuracy-value"),
  cameraHighway: document.querySelector("#camera-highway"),
  cameraKm: document.querySelector("#camera-km"),
  cameraLive: document.querySelector("#camera-live"),
  cameraTitle: document.querySelector("#camera-title"),
  demoAdvance: document.querySelector("#demo-advance"),
  demoPanel: document.querySelector("#demo-panel"),
  directionA: document.querySelector("#direction-a"),
  directionB: document.querySelector("#direction-b"),
  directionSection: document.querySelector("#direction-section"),
  download: document.querySelector("#download-button"),
  errorMessage: document.querySelector("#error-message"),
  errorPanel: document.querySelector("#error-panel"),
  gpsStatus: document.querySelector("#gps-status"),
  gpsDebug: document.querySelector("#gps-debug-link"),
  highwayList: document.querySelector("#highway-list"),
  journeyStatus: document.querySelector("#journey-status"),
  kojaQuick: document.querySelector("#koja-quick-button"),
  manualCameraButton: document.querySelector("#manual-camera-button"),
  manualCameraPicker: document.querySelector("#manual-camera-picker"),
  manualCameraSelect: document.querySelector("#manual-camera-select"),
  mapBody: document.querySelector("#map-body"),
  mapCameraCard: document.querySelector("#map-camera-card"),
  mapCameraList: document.querySelector("#map-camera-list"),
  mapCloseButton: document.querySelector("#map-close-button"),
  mapExpandButton: document.querySelector("#map-expand-button"),
  mapGpsButton: document.querySelector("#map-gps-button"),
  mapSection: document.querySelector(".route-map"),
  mapSummary: document.querySelector("#map-summary"),
  mapElement: document.querySelector("#route-map"),
  mapTileStatus: document.querySelector("#map-tile-status"),
  mapToggle: document.querySelector("#map-toggle"),
  next: document.querySelector("#next-button"),
  openPlayer: document.querySelector("#open-player-button"),
  playerCard: document.querySelector(".player-card"),
  playerHelper: document.querySelector("#player-helper"),
  position: document.querySelector("#position-value"),
  previous: document.querySelector("#previous-button"),
  quickClose: document.querySelector("#quick-camera-close"),
  quickFullscreen: document.querySelector("#quick-camera-fullscreen"),
  quickOverlay: document.querySelector("#quick-camera-overlay"),
  quickPlay: document.querySelector("#quick-camera-play"),
  quickRetry: document.querySelector("#quick-camera-retry"),
  quickStatus: document.querySelector("#quick-camera-status"),
  quickVideo: document.querySelector("#quick-camera-video"),
  restart: document.querySelector("#restart-button"),
  retry: document.querySelector("#retry-button"),
  routePanel: document.querySelector("#route-panel"),
  routeHelper: document.querySelector("#route-helper"),
  routeShortcut: document.querySelector("#route-shortcut"),
  skip: document.querySelector("#skip-button"),
  simulatorHighway: document.querySelector("#simulator-highway"),
  simulatorPanel: document.querySelector("#simulator-panel"),
  simulatorPosition: document.querySelector("#simulator-position"),
  simulatorPositionOutput: document.querySelector("#simulator-position-output"),
  simulatorSpeed: document.querySelector("#simulator-speed"),
  sourceLink: document.querySelector("#source-link"),
  start: document.querySelector("#start-button"),
  stop: document.querySelector("#stop-button"),
  trackingIndicator: document.querySelector("#tracking-indicator"),
  video: document.querySelector("#camera-video"),
  videoPlaceholder: document.querySelector("#video-placeholder"),
};

const query = new URLSearchParams(location.search);

const state = {
  cameras: [],
  currentCamera: null,
  currentProjection: null,
  demo: query.get("demo") === "1",
  direction: null,
  highway: null,
  highways: [],
  hls: null,
  loadGeneration: 0,
  loadTimer: null,
  lastPosition: null,
  locationAttempt: 0,
  manualCameras: [],
  manualMode: false,
  routeMap: null,
  pendingMapCamera: null,
  playIntent: false,
  playbackBlocked: false,
  playerReady: false,
  routeEnded: false,
  simulator: query.get("simulator") === "1",
  simulatorLastTick: null,
  simulatorPositionM: 0,
  simulatorTimer: null,
  simulatorSpeedKmh: 60,
  sourceChanging: false,
  stallTimer: null,
  usableCameras: [],
  watchId: null,
};

let passTracker = createPassTracker();

function setJourneyStatus(message) {
  elements.journeyStatus.textContent = message;
}

function updateTrackingIndicator() {
  let indicatorState = "off";
  let message = "Pelacakan kamera via GPS: tidak aktif";
  const trackingActive = state.watchId !== null || state.simulatorTimer !== null;
  if (state.simulatorTimer !== null && state.manualMode) {
    indicatorState = "standby";
    message = "Simulasi GPS aktif, tetapi pergantian kamera manual";
  } else if (state.simulatorTimer !== null && state.highway && state.direction && state.currentCamera) {
    indicatorState = "active";
    message = "Simulasi pelacakan kamera: aktif";
  } else if (elements.start.disabled && !trackingActive) {
    indicatorState = "standby";
    message = "Pelacakan kamera via GPS: menunggu lokasi";
  } else if (trackingActive && state.manualMode) {
    indicatorState = "standby";
    message = "GPS aktif, tetapi pergantian kamera manual";
  } else if (
    trackingActive &&
    state.highway &&
    state.direction &&
    state.currentCamera
  ) {
    indicatorState = "active";
    message = "Pelacakan kamera via GPS: aktif";
  } else if (trackingActive) {
    indicatorState = "standby";
    message = "GPS aktif • pilih ruas dan arah";
  }
  elements.trackingIndicator.dataset.state = indicatorState;
  elements.trackingIndicator.querySelector("strong").textContent = message;
}

function updateRestartButton() {
  elements.restart.disabled = !(
    state.highway &&
    state.direction &&
    state.currentCamera &&
    state.playerReady
  );
}

function selectedHighwayId() {
  return state.highway?.properties?.id ?? state.highway?.id ?? null;
}

function activeCameraList() {
  return state.manualMode ? state.manualCameras : state.usableCameras;
}

function formatKm(km) {
  if (!Number.isFinite(km)) return "KM —";
  const whole = Math.floor(km);
  const meters = Math.round((km - whole) * 1_000);
  return `KM ${String(whole).padStart(2, "0")}+${String(meters).padStart(3, "0")}`;
}

function destroyPlayer() {
  state.loadGeneration += 1;
  clearTimeout(state.loadTimer);
  state.loadTimer = null;
  clearTimeout(state.stallTimer);
  state.stallTimer = null;
  if (state.hls) {
    state.hls.destroy();
    state.hls = null;
  }
  elements.video.pause();
  elements.video.onloadedmetadata = null;
  elements.video.oncanplay = null;
  elements.video.onerror = null;
  elements.video.removeAttribute("src");
  elements.video.load();
}

function setPlayerReady(ready) {
  state.playerReady = ready;
  elements.openPlayer.disabled = !ready || !state.currentCamera;
  updateRestartButton();
}

function showPlaybackError(message) {
  clearTimeout(state.loadTimer);
  state.loadTimer = null;
  state.sourceChanging = false;
  state.hls?.stopLoad();
  setPlayerReady(false);
  state.playbackBlocked = true;
  elements.errorMessage.textContent = message;
  elements.errorPanel.hidden = false;
  setJourneyStatus("Pilih Coba lagi atau Kamera berikutnya. Pergantian otomatis dijeda.");
}

function clearPlaybackError() {
  state.playbackBlocked = false;
  elements.errorPanel.hidden = true;
}

async function playCamera(camera, options = {}) {
  if (!camera) return;
  const continuePlaying = options.forcePlay || state.playIntent;
  const muted = elements.video.muted;
  state.sourceChanging = true;
  destroyPlayer();
  const generation = state.loadGeneration;
  setPlayerReady(false);
  clearPlaybackError();
  state.currentCamera = camera;
  state.routeEnded = false;
  passTracker.reset();
  updateTrackingIndicator();
  state.routeMap?.selectCamera(camera.id);

  elements.video.muted = muted;
  elements.videoPlaceholder.hidden = true;
  elements.cameraLive.hidden = false;
  elements.cameraTitle.textContent = camera.name;
  elements.cameraHighway.textContent = state.highway?.properties?.name ?? "Tol Jakarta";
  elements.cameraKm.textContent = formatKm(camera.km);
  elements.sourceLink.href = camera.streamUrl;
  elements.sourceLink.hidden = false;
  updateControls();
  setJourneyStatus(state.manualMode
    ? "Kamera manual aktif. Pergantian otomatis berbasis GPS tidak digunakan untuk kamera ini."
    : camera.curationStatus === "provisional_stationing"
      ? "Kamera provisional aktif berdasarkan KM dan geometri OSM. Sistem menunggu posisi GPS melewati titik perkiraan."
      : "Kamera aktif. Sistem menunggu posisi terkonfirmasi setelah kamera ini.");

  const onReady = () => {
    if (generation !== state.loadGeneration || state.playerReady) return;
    clearTimeout(state.loadTimer);
    state.loadTimer = null;
    state.sourceChanging = false;
    setPlayerReady(true);
    elements.playerHelper.textContent = fullscreenMethod(elements.video)
      ? "Siap dibuka dengan pemutar layar penuh perangkat."
      : "Tekan tombol untuk memutar; gunakan kontrol layar penuh pada video bila tersedia.";
    if (continuePlaying) {
      elements.video.play().catch(() => {
        state.playIntent = false;
        setJourneyStatus(camera.curationStatus === "provisional_stationing"
          ? "Kamera provisional siap berdasarkan KM. Buka pemutar video untuk melanjutkan."
          : "Kamera siap. Buka pemutar video untuk melanjutkan.");
      });
    } else {
      setJourneyStatus(camera.curationStatus === "provisional_stationing"
        ? "Kamera provisional siap berdasarkan KM dan geometri OSM. Buka pemutar video layar penuh untuk menonton."
        : "Kamera siap. Buka pemutar video layar penuh untuk menonton.");
    }
  };

  state.loadTimer = setTimeout(() => {
    if (generation !== state.loadGeneration) return;
    showPlaybackError("Stream tidak merespons dalam 20 detik. Kamera mungkin offline atau jaringan sedang lambat.");
  }, 20_000);

  const attachHlsJs = () => {
    if (generation !== state.loadGeneration || !globalThis.Hls?.isSupported()) return false;
    elements.video.onloadedmetadata = null;
    elements.video.oncanplay = null;
    elements.video.onerror = null;
    elements.video.removeAttribute("src");
    elements.video.load();
    state.hls = new globalThis.Hls({
      enableWorker: true,
      lowLatencyMode: true,
      backBufferLength: 30,
      liveSyncDurationCount: 3,
      liveMaxLatencyDurationCount: 8,
      manifestLoadingMaxRetry: 2,
      levelLoadingMaxRetry: 2,
      fragLoadingMaxRetry: 2,
    });
    state.hls.on(globalThis.Hls.Events.MANIFEST_PARSED, onReady);
    state.hls.on(globalThis.Hls.Events.ERROR, (_, data) => {
      if (generation !== state.loadGeneration || !data.fatal) return;
      showPlaybackError(
        data.type === globalThis.Hls.ErrorTypes.NETWORK_ERROR
          ? "Stream tidak dapat diambil. Kamera mungkin offline atau dibatasi oleh CORS."
          : "Browser tidak dapat memproses stream kamera ini.",
      );
    });
    state.hls.loadSource(camera.streamUrl);
    state.hls.attachMedia(elements.video);
    return true;
  };

  const attachNative = () => {
    elements.video.src = camera.streamUrl;
    elements.video.onloadedmetadata = onReady;
    elements.video.oncanplay = onReady;
    elements.video.onerror = () => {
      if (generation !== state.loadGeneration) return;
      if (attachHlsJs()) {
        setJourneyStatus("Pemutar bawaan menolak sumber; mencoba mode kompatibilitas…");
        return;
      }
      showPlaybackError(nativeMediaErrorMessage(elements.video.error));
    };
    elements.video.load();
  };

  if (prefersNativeHls(elements.video, globalThis.Hls)) {
    attachNative();
  } else if (!attachHlsJs() && supportsNativeHls(elements.video)) {
    attachNative();
  } else if (!state.hls) {
    showPlaybackError("Browser ini tidak mendukung pemutaran HLS.");
  }
}

async function openVideoPlayer() {
  if (!state.currentCamera || !state.playerReady) return;
  state.playIntent = true;
  clearPlaybackError();

  // Both calls start synchronously inside the tap handler. This is important on
  // iOS, where playback and full-screen entry require a direct user gesture.
  const playPromise = elements.video.play();
  let method = null;
  try {
    method = await enterVideoFullscreen(elements.video);
    setJourneyStatus(method
      ? "Pemutar video layar penuh dibuka. Menunggu siaran kamera…"
      : "Video diputar. Gunakan kontrol layar penuh bawaan perangkat.");
  } catch {
    setJourneyStatus("Safari memblokir pembukaan otomatis. Tekan tombol putar pada video.");
  }
  playPromise.catch(() => {
    state.playIntent = false;
    setJourneyStatus(method
      ? "Pemutar terbuka, tetapi siaran belum mulai. Tekan Putar pada kontrol video."
      : "Safari belum memulai siaran. Tekan tombol putar pada video.");
  });
}

function scheduleStallStatus() {
  clearTimeout(state.stallTimer);
  state.stallTimer = setTimeout(() => {
    if (
      state.playIntent &&
      !state.playbackBlocked &&
      elements.video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA
    ) setJourneyStatus("Siaran masih menunggu data. Coba lagi jika gambar belum muncul.");
  }, 6_000);
}

function updateControls() {
  const cameras = activeCameraList();
  if (!state.currentCamera || cameras.length === 0) {
    elements.previous.disabled = true;
    elements.next.disabled = true;
    return;
  }
  elements.previous.disabled = !adjacentCamera(
    cameras,
    state.currentCamera.id,
    state.direction,
    -1,
  );
  elements.next.disabled = !adjacentCamera(
    cameras,
    state.currentCamera.id,
    state.direction,
    1,
  );
}

function updateManualCameraPicker() {
  if (!state.highway || !state.direction) {
    state.manualCameras = [];
    elements.manualCameraPicker.hidden = true;
    return;
  }
  state.manualCameras = publicCameras(
    state.cameras,
    selectedHighwayId(),
    state.direction,
  );
  elements.manualCameraSelect.replaceChildren();
  for (const camera of state.manualCameras) {
    const option = document.createElement("option");
    option.value = camera.id;
    const directionLabel = camera.side ??
      (Array.isArray(camera.directions) ? camera.directions.join("/") : null);
    const side = directionLabel ? ` • ${directionLabel}` : "";
    option.textContent = `${formatKm(camera.km)}${side} — ${camera.name}`;
    elements.manualCameraSelect.append(option);
  }
  elements.manualCameraButton.disabled = state.manualCameras.length === 0;
  elements.manualCameraPicker.hidden = state.manualCameras.length === 0;
}

function updateUsableCameras() {
  if (!state.highway || !state.direction) {
    state.usableCameras = [];
  } else if (state.demo) {
    state.usableCameras = demoCameras(state.direction);
  } else {
    state.usableCameras = automaticCameras(
      state.cameras,
      selectedHighwayId(),
      state.direction,
    );
  }
  updateManualCameraPicker();
  elements.download.disabled = state.usableCameras.length === 0 && state.manualCameras.length === 0;
  if (state.usableCameras.length === 0) {
    destroyPlayer();
    state.currentCamera = null;
    state.playIntent = false;
    elements.cameraLive.hidden = true;
    elements.videoPlaceholder.hidden = false;
    elements.cameraTitle.textContent = "Belum ada kamera otomatis";
    elements.cameraHighway.textContent = state.highway?.properties?.name ?? "Tol Jakarta";
    elements.cameraKm.textContent = "KM —";
    elements.sourceLink.hidden = true;
    setJourneyStatus("Data stream tersedia, tetapi ruas ini belum memiliki kamera dengan arah dan posisi yang cukup untuk pergantian otomatis.");
  }
  updateControls();
}

function selectDirection(direction) {
  const pendingMapCamera = state.pendingMapCamera;
  const previousDirection = state.direction;
  state.direction = direction;
  state.manualMode = false;
  state.currentCamera = null;
  state.playIntent = false;
  state.routeEnded = false;
  passTracker.reset();
  if (
    state.simulator &&
    state.simulatorTimer === null &&
    state.highway &&
    previousDirection !== direction
  ) {
    state.simulatorPositionM = direction === "B"
      ? state.highway.properties.canonicalLengthM
      : 0;
    updateSimulatorPositionControl();
  }
  updateTrackingIndicator();
  elements.directionA.setAttribute("aria-pressed", String(direction === "A"));
  elements.directionB.setAttribute("aria-pressed", String(direction === "B"));
  updateUsableCameras();
  if (
    pendingMapCamera &&
    pendingMapCamera.highwayId === selectedHighwayId() &&
    (pendingMapCamera.side === null || pendingMapCamera.side === direction)
  ) {
    state.pendingMapCamera = null;
    state.manualMode = true;
    playCamera(pendingMapCamera);
    return;
  }
  if (state.usableCameras.length === 0) return;
  const progressM = state.currentProjection?.progressM ??
    (direction === "A" ? 0 : state.highway.properties.canonicalLengthM);
  const camera = initialCamera(state.usableCameras, direction, progressM);
  if (camera) playCamera(camera);
  else {
    state.routeEnded = true;
    setJourneyStatus("Tidak ada kamera berikutnya pada arah perjalanan ini.");
  }
}

function selectHighway(feature) {
  const nextId = feature.properties?.id ?? feature.id;
  if (nextId === selectedHighwayId()) {
    state.routeMap?.selectHighway(nextId);
    return;
  }
  state.highway = feature;
  state.currentCamera = null;
  state.playIntent = false;
  state.currentProjection = null;
  state.routeEnded = false;
  state.manualMode = false;
  state.pendingMapCamera = null;
  updateTrackingIndicator();
  state.routeMap?.selectHighway(nextId);
  updateSimulatorPositionControl();
  elements.directionSection.hidden = false;
  const properties = feature.properties ?? {};
  elements.directionA.querySelector("small").textContent =
    properties.directionA ?? "Mengikuti arah KM bertambah";
  elements.directionB.querySelector("small").textContent =
    properties.directionB ?? "Mengikuti arah KM berkurang";
  elements.highwayList.querySelectorAll("button").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.highwayId === selectedHighwayId()));
  });
  if (state.lastPosition) updateProjectionForSelectedRoad(state.lastPosition);
  if (state.direction) updateUsableCameras();
}

function selectHighwayFromMap(highwayId) {
  const feature = state.highways.find(
    (candidate) => (candidate.properties?.id ?? candidate.id) === highwayId,
  );
  if (feature) selectHighway(feature);
}

function watchCameraFromMap(camera) {
  const feature = state.highways.find(
    (candidate) => (candidate.properties?.id ?? candidate.id) === camera.highwayId,
  );
  if (!feature) return;
  selectHighway(feature);
  state.pendingMapCamera = camera;
  if (camera.side === "A" || camera.side === "B") {
    selectDirection(camera.side);
    return;
  }
  const locationNote = camera.cameraType === "toll_gate"
    ? "Lokasi gerbang bersifat provisional dari landmark publik."
    : "Lokasi marker masih berupa perkiraan berdasarkan KM.";
  setJourneyStatus(`Pilih arah A atau B untuk menonton kamera ini. ${locationNote}`);
  elements.directionSection.hidden = false;
  elements.directionA.focus({ preventScroll: true });
}

function renderHighways(candidates = null) {
  const candidateById = new Map(
    (candidates ?? []).map((candidate) => [candidate.highwayId, candidate]),
  );
  const features = candidates?.length
    ? candidates.map((candidate) => candidate.feature)
    : state.highways;
  elements.highwayList.replaceChildren();
  for (const feature of features) {
    const id = feature.properties?.id ?? feature.id;
    const candidate = candidateById.get(id);
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.className = "highway-button";
    button.type = "button";
    button.dataset.highwayId = id;
    button.setAttribute("aria-pressed", String(id === selectedHighwayId()));
    const label = document.createElement("span");
    const name = document.createElement("strong");
    const description = document.createElement("small");
    name.textContent = feature.properties?.name ?? id;
    const properties = feature.properties ?? {};
    description.textContent =
      `A → ${properties.terminalLabel ?? "KM bertambah"} • ` +
      `B → ${properties.zeroKmLabel ?? "KM berkurang"}`;
    label.append(name, description);
    button.append(label);
    if (candidate) {
      const distance = document.createElement("span");
      distance.className = "highway-distance";
      distance.textContent = `${Math.round(candidate.distanceM)} m`;
      button.append(distance);
    }
    button.addEventListener("click", () => selectHighway(feature));
    item.append(button);
    elements.highwayList.append(item);
  }
}

function updateProjectionForSelectedRoad(position) {
  if (!state.highway) return;
  state.currentProjection = projectPointToLine(
    [position.longitude, position.latitude],
    state.highway.geometry.coordinates,
  );
  elements.position.textContent = `${(state.currentProjection.progressM / 1_000).toFixed(1)} km`;
}

function updateSimulatorPositionControl() {
  if (!state.simulator || !state.highway) return;
  const totalLengthM = Math.round(state.highway.properties?.canonicalLengthM ?? 0);
  state.simulatorPositionM = Math.min(totalLengthM, Math.max(0, state.simulatorPositionM));
  elements.simulatorPosition.max = String(totalLengthM);
  elements.simulatorPosition.value = String(Math.round(state.simulatorPositionM));
  elements.simulatorPositionOutput.textContent =
    `${(state.simulatorPositionM / 1_000).toFixed(1).replace(".", ",")} km`;
  elements.simulatorHighway.value = selectedHighwayId() ?? "";
}

function emitSimulatorPosition() {
  const position = positionOnHighway(state.highway, state.simulatorPositionM);
  if (!position) return;
  handlePosition(position);
  elements.gpsStatus.textContent = state.simulatorTimer === null
    ? "Simulasi siap"
    : "GPS simulasi aktif";
}

function finishSimulatorRoute() {
  clearInterval(state.simulatorTimer);
  state.simulatorTimer = null;
  state.simulatorLastTick = null;
  elements.start.disabled = false;
  elements.stop.hidden = true;
  updateTrackingIndicator();
  setJourneyStatus("Simulasi mencapai ujung ruas. Atur posisi atau arah, lalu mulai kembali.");
}

function tickSimulator() {
  if (!state.highway || !state.direction) return;
  const now = performance.now();
  const elapsedMs = Math.min(1_000, Math.max(0, now - state.simulatorLastTick));
  state.simulatorLastTick = now;
  const next = advanceRoutePosition({
    direction: state.direction,
    elapsedMs,
    positionM: state.simulatorPositionM,
    speedKmh: state.simulatorSpeedKmh,
    totalLengthM: state.highway.properties.canonicalLengthM,
  });
  state.simulatorPositionM = next.positionM;
  updateSimulatorPositionControl();
  emitSimulatorPosition();
  if (next.ended) finishSimulatorRoute();
}

function startSimulatorTracking() {
  if (!state.highway) selectHighway(state.highways[0]);
  if (!state.direction) selectDirection("A");
  clearInterval(state.simulatorTimer);
  state.simulatorSpeedKmh = Number(elements.simulatorSpeed.value);
  state.simulatorLastTick = performance.now();
  state.simulatorTimer = setInterval(tickSimulator, 250);
  elements.start.disabled = true;
  elements.stop.hidden = false;
  elements.routeHelper.textContent = "Posisi tiruan bergerak tepat di sepanjang geometri ruas lokal.";
  emitSimulatorPosition();
  updateTrackingIndicator();
}

function handlePosition(position) {
  elements.gpsDebug.hidden = true;
  const fix = {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracy: position.coords.accuracy,
  };
  state.lastPosition = fix;
  updateTrackingIndicator();
  state.routeMap?.updatePosition(fix);
  elements.accuracy.textContent = `±${Math.round(fix.accuracy)} m`;
  const result = matchHighways(fix, state.highways);
  if (!result.accepted) {
    elements.gpsStatus.textContent = result.reason === "accuracy_too_low" ? "GPS kurang akurat" : "Ruas tidak ditemukan";
    elements.routeHelper.textContent = result.reason === "accuracy_too_low"
      ? "Tunggu akurasi GPS membaik, atau pilih ruas secara manual."
      : "Tidak ada ruas terverifikasi di dekat posisi. Pilih ruas secara manual.";
    renderHighways();
    if (state.highway) updateProjectionForSelectedRoad(fix);
    return;
  }

  elements.gpsStatus.textContent = state.simulator ? "GPS simulasi aktif" : "GPS aktif";
  elements.routeHelper.textContent = result.candidates.length > 1
    ? "Beberapa ruas terdeteksi. Pilih ruas yang sedang digunakan."
    : "Ruas terdekat terdeteksi dari posisi saat ini.";
  renderHighways(result.candidates);
  if (!state.highway && result.candidates.length === 1) selectHighway(result.candidates[0].feature);
  const selectedCandidate = result.candidates.find(
    (candidate) => candidate.highwayId === selectedHighwayId(),
  );
  if (state.highway && selectedCandidate) {
    updateProjectionForSelectedRoad(fix);
    evaluatePassing();
  }
}

function evaluatePassing() {
  if (
    state.manualMode ||
    !state.currentCamera ||
    !state.currentProjection ||
    state.playbackBlocked ||
    state.routeEnded
  ) return;
  const result = passTracker.update({
    cameraId: state.currentCamera.id,
    cameraPositionM: state.currentCamera.roadPositionM,
    direction: state.direction,
    progressM: state.currentProjection.progressM,
  });
  if (!result.passed) {
    setJourneyStatus(
      `${state.currentCamera.curationStatus === "provisional_stationing" ? "Titik KM provisional • " : ""}Melacak posisi • konfirmasi lewat kamera ${result.consecutiveFixes}/${result.requiredFixes}`,
    );
    return;
  }
  const next = adjacentCamera(
    state.usableCameras,
    state.currentCamera.id,
    state.direction,
    1,
  );
  if (next) playCamera(next);
  else {
    state.routeEnded = true;
    setJourneyStatus("Akhir daftar kamera untuk arah ini. Kamera terakhir tetap ditampilkan.");
    updateControls();
  }
}

async function geolocationError(error, attempt = state.locationAttempt) {
  if (attempt !== state.locationAttempt) return;
  if (state.watchId !== null) navigator.geolocation.clearWatch(state.watchId);
  state.watchId = null;
  elements.start.disabled = false;
  elements.stop.hidden = true;
  updateTrackingIndicator();
  const permissionState = error?.code === 1
    ? await geolocationPermissionState(navigator.permissions)
    : "unavailable";
  if (attempt !== state.locationAttempt) return;
  const failure = geolocationFailure(error, {
    available: "geolocation" in navigator,
    permissionState,
    secureContext: window.isSecureContext,
  });
  elements.gpsStatus.textContent = failure.status;
  elements.routeHelper.textContent = failure.helper;
  elements.gpsDebug.hidden = false;
  setJourneyStatus("Mode manual aktif. Pergantian otomatis menunggu GPS yang andal.");
  renderHighways();
}

async function trackingLocationError(error, attempt) {
  if (attempt !== state.locationAttempt) return;
  if (error.code === 1) {
    await geolocationError(error, attempt);
    return;
  }
  const failure = geolocationFailure(error, {
    available: true,
    secureContext: window.isSecureContext,
  });
  elements.gpsStatus.textContent = failure.status;
  elements.routeHelper.textContent = `${failure.helper} Pelacakan tetap aktif.`;
}

function startTracking() {
  const attempt = ++state.locationAttempt;
  if (!window.isSecureContext || !("geolocation" in navigator)) {
    geolocationError({ code: 0 }, attempt);
    return;
  }
  elements.start.disabled = true;
  elements.stop.hidden = false;
  elements.gpsStatus.textContent = "Meminta izin GPS…";
  elements.routeHelper.textContent = "Safari mungkin menampilkan permintaan izin lokasi untuk situs ini.";
  elements.gpsDebug.hidden = true;
  updateTrackingIndicator();

  // Ask for one fix directly from the button tap before registering a watch.
  // This produces the most reliable permission prompt on iOS Safari.
  navigator.geolocation.getCurrentPosition(
    (position) => {
      if (attempt !== state.locationAttempt) return;
      handlePosition(position);
      const watchId = navigator.geolocation.watchPosition(
        (nextPosition) => {
          if (attempt === state.locationAttempt) handlePosition(nextPosition);
        },
        (error) => trackingLocationError(error, attempt),
        TRACKING_LOCATION_OPTIONS,
      );
      if (attempt === state.locationAttempt) {
        state.watchId = watchId;
        updateTrackingIndicator();
      }
      else navigator.geolocation.clearWatch(watchId);
    },
    (error) => void geolocationError(error, attempt),
    INITIAL_LOCATION_OPTIONS,
  );
}

function stopTracking() {
  state.locationAttempt += 1;
  if (state.simulatorTimer !== null) clearInterval(state.simulatorTimer);
  state.simulatorTimer = null;
  state.simulatorLastTick = null;
  if (state.watchId !== null) navigator.geolocation.clearWatch(state.watchId);
  state.watchId = null;
  elements.start.disabled = false;
  elements.stop.hidden = true;
  elements.gpsStatus.textContent = state.simulator ? "Simulasi dihentikan" : "Dihentikan";
  updateTrackingIndicator();
  state.routeMap?.updatePosition(null);
  setJourneyStatus("Pelacakan dihentikan. Kamera dapat dipilih secara manual.");
}

function moveCamera(step) {
  if (!state.currentCamera) return;
  const target = adjacentCamera(
    activeCameraList(),
    state.currentCamera.id,
    state.direction,
    step,
  );
  if (target) playCamera(target);
}

function downloadM3u() {
  const cameras = activeCameraList().length > 0 ? activeCameraList() : state.manualCameras;
  if (cameras.length === 0) return;
  const lines = ["#EXTM3U"];
  for (const camera of cameras) {
    lines.push(
      `#EXTINF:-1 tvg-id="${camera.id}" group-title="${state.highway.properties.name} ${state.direction}",${camera.name}`,
      camera.streamUrl,
    );
  }
  const blob = new Blob([`${lines.join("\n")}\n`], { type: "audio/x-mpegurl" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${selectedHighwayId()}-${state.direction.toLowerCase()}-cctv.m3u8`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function loadManualCamera() {
  const camera = state.manualCameras.find(
    (candidate) => candidate.id === elements.manualCameraSelect.value,
  );
  if (!camera) return;
  state.manualMode = true;
  updateTrackingIndicator();
  playCamera(camera);
}

function previewManualCameraOnMap() {
  const camera = state.manualCameras.find(
    (candidate) => candidate.id === elements.manualCameraSelect.value,
  );
  if (camera) state.routeMap?.selectCamera(camera.id);
}

function restartSavedSelection() {
  if (elements.restart.disabled) return;
  const savedSelection = {
    camera: state.currentCamera,
    direction: state.direction,
    highway: state.highway,
    manualMode: state.manualMode,
  };

  stopTracking();
  state.highway = savedSelection.highway;
  state.direction = savedSelection.direction;
  state.currentCamera = savedSelection.camera;
  state.manualMode = savedSelection.manualMode;
  state.routeMap?.selectHighway(selectedHighwayId());
  elements.highwayList.querySelectorAll("button").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.highwayId === selectedHighwayId()));
  });
  elements.directionA.setAttribute("aria-pressed", String(state.direction === "A"));
  elements.directionB.setAttribute("aria-pressed", String(state.direction === "B"));
  updateControls();
  updateTrackingIndicator();

  // Start fullscreen first so iOS keeps it attached to this direct tap.
  void openVideoPlayer();
  if (state.simulator) startSimulatorTracking();
  else if (!state.demo) startTracking();
}

function demoCameras(direction) {
  const unique = [];
  const seenUrls = new Set();
  const sorted = state.cameras
    .filter((camera) => Number.isFinite(camera.km) && camera.streamUrl)
    .sort((a, b) => a.km - b.km);
  for (const camera of sorted) {
    if (seenUrls.has(camera.streamUrl)) continue;
    seenUrls.add(camera.streamUrl);
    unique.push({
      ...camera,
      id: `demo-${camera.id}`,
      side: direction,
      coordinates: state.highway.geometry.coordinates[0],
      roadPositionM: Math.round(camera.km * 1_000),
      enabled: true,
      curationStatus: "verified",
    });
    if (unique.length === 5) break;
  }
  return unique;
}

function advanceDemo() {
  if (!state.currentCamera) return;
  const offset = state.direction === "A" ? 100 : -100;
  state.currentProjection = {
    progressM: state.currentCamera.roadPositionM + offset,
  };
  elements.position.textContent = `${(state.currentProjection.progressM / 1_000).toFixed(1)} km demo`;
  evaluatePassing();
  evaluatePassing();
}

async function loadData() {
  try {
    const [cameraResponse, highwayResponse] = await Promise.all([
      fetch("./data/cameras.json"),
      fetch("./data/highways.geojson"),
    ]);
    if (!cameraResponse.ok || !highwayResponse.ok) throw new Error("Data file unavailable");
    const cameraData = await cameraResponse.json();
    const highwayData = await highwayResponse.json();
    state.cameras = cameraData.cameras ?? [];
    state.highways = highwayData.features ?? [];
    state.routeMap = createOnlineMap({
      body: elements.mapBody,
      cameraCard: elements.mapCameraCard,
      cameraList: elements.mapCameraList,
      closeButton: elements.mapCloseButton,
      expandButton: elements.mapExpandButton,
      gpsButton: elements.mapGpsButton,
      mapElement: elements.mapElement,
      mapSection: elements.mapSection,
      onSelectHighway: selectHighwayFromMap,
      onWatchCamera: watchCameraFromMap,
      summary: elements.mapSummary,
      tileUrl: query.get("tileFail") === "1"
        ? "./__tile-fallback-test__/{z}/{x}/{y}.png"
        : undefined,
      tileStatus: elements.mapTileStatus,
      toggle: elements.mapToggle,
    });
    state.routeMap.setData(state.highways, state.cameras);
    renderHighways();
    state.quickActionManager = createQuickActionManager({
      elements: {
        launcher: elements.kojaQuick,
        overlay: elements.quickOverlay,
        close: elements.quickClose,
        video: elements.quickVideo,
        status: elements.quickStatus,
        play: elements.quickPlay,
        fullscreen: elements.quickFullscreen,
        retry: elements.quickRetry,
      },
      cameras: state.cameras,
      hlsClass: typeof window !== "undefined" ? window.Hls : null,
    });
    state.quickActionManager.bindEvents();
    void state.quickActionManager.init();
    if (state.simulator) {
      document.body.classList.add("is-simulator");
      document.title = "Simulator GPS — Jalur CCTV";
      elements.simulatorPanel.hidden = false;
      elements.start.textContent = "Mulai simulasi";
      elements.routeHelper.textContent = "Pilih ruas, arah, posisi awal, dan kecepatan simulasi.";
      elements.gpsStatus.textContent = "Mode simulasi";
      elements.simulatorHighway.replaceChildren(...state.highways.map((feature) => {
        const option = document.createElement("option");
        option.value = feature.properties?.id ?? feature.id;
        option.textContent = feature.properties?.name ?? option.value;
        return option;
      }));
      selectHighway(state.highways[0]);
      selectDirection("A");
      updateSimulatorPositionControl();
    }
    if (state.demo) {
      elements.demoPanel.hidden = false;
      selectHighway(state.highways[0]);
      selectDirection("A");
      elements.gpsStatus.textContent = "Mode demo";
      elements.routeHelper.textContent = "Pratinjau memakai posisi kamera sintetis dan tidak meminta lokasi.";
    }
  } catch {
    elements.start.disabled = true;
    elements.gpsStatus.textContent = "Data gagal dimuat";
    elements.routeHelper.textContent = "Peta atau berkas data gagal dimuat. Muat ulang halaman, lalu coba lagi.";
    setJourneyStatus("Berkas data tidak dapat dibaca.");
  }
}

function scrollToRoutePanel() {
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  elements.routePanel.scrollIntoView({
    behavior: reduceMotion ? "auto" : "smooth",
    block: "start",
  });
}

elements.start.addEventListener("click", () => {
  // Keep the GPS request synchronous with the tap for iOS Safari permissions.
  if (state.simulator) startSimulatorTracking();
  else startTracking();
  scrollToRoutePanel();
});
elements.routeShortcut.addEventListener("click", scrollToRoutePanel);
elements.restart.addEventListener("click", restartSavedSelection);
elements.stop.addEventListener("click", stopTracking);
elements.manualCameraButton.addEventListener("click", loadManualCamera);
elements.manualCameraSelect.addEventListener("change", previewManualCameraOnMap);
elements.directionA.addEventListener("click", () => selectDirection("A"));
elements.directionB.addEventListener("click", () => selectDirection("B"));
elements.previous.addEventListener("click", () => moveCamera(-1));
elements.next.addEventListener("click", () => moveCamera(1));
elements.openPlayer.addEventListener("click", openVideoPlayer);
elements.retry.addEventListener("click", () => playCamera(state.currentCamera));
elements.skip.addEventListener("click", () => moveCamera(1));
elements.download.addEventListener("click", downloadM3u);
elements.demoAdvance.addEventListener("click", advanceDemo);
elements.simulatorHighway.addEventListener("change", () => {
  const feature = state.highways.find((candidate) =>
    (candidate.properties?.id ?? candidate.id) === elements.simulatorHighway.value
  );
  if (!feature) return;
  state.simulatorPositionM = state.direction === "B"
    ? feature.properties.canonicalLengthM
    : 0;
  selectHighway(feature);
  selectDirection(state.direction ?? "A");
  updateSimulatorPositionControl();
  emitSimulatorPosition();
});
elements.simulatorPosition.addEventListener("input", () => {
  state.simulatorPositionM = Number(elements.simulatorPosition.value);
  state.simulatorLastTick = performance.now();
  updateSimulatorPositionControl();
  emitSimulatorPosition();
});
elements.simulatorPosition.addEventListener("change", () => {
  if (state.direction) selectDirection(state.direction);
});
elements.simulatorSpeed.addEventListener("change", () => {
  state.simulatorSpeedKmh = Number(elements.simulatorSpeed.value);
});

elements.video.addEventListener("play", () => {
  state.playIntent = true;
});
elements.video.addEventListener("pause", () => {
  if (!state.sourceChanging && !elements.video.ended) state.playIntent = false;
});
elements.video.addEventListener("playing", () => {
  clearTimeout(state.stallTimer);
  state.stallTimer = null;
  clearPlaybackError();
  setJourneyStatus(state.currentCamera?.curationStatus === "provisional_stationing"
    ? "Siaran CCTV sedang diputar • posisi pergantian otomatis masih provisional berdasarkan KM."
    : "Siaran CCTV sedang diputar.");
});
elements.video.addEventListener("waiting", () => {
  if (!state.playbackBlocked) scheduleStallStatus();
});
elements.video.addEventListener("stalled", () => {
  if (!state.playbackBlocked) scheduleStallStatus();
});
elements.video.addEventListener("webkitbeginfullscreen", () => {
  setJourneyStatus("Pemutar video layar penuh aktif.");
});
elements.video.addEventListener("webkitendfullscreen", () => {
  setJourneyStatus("Pemutar layar penuh ditutup. Pelacakan kamera tetap aktif.");
});

window.addEventListener("beforeunload", () => {
  if (state.simulatorTimer !== null) clearInterval(state.simulatorTimer);
  if (state.watchId !== null) navigator.geolocation.clearWatch(state.watchId);
  state.routeMap?.destroy();
  if (state.hls) state.hls.destroy();
});

loadData();
