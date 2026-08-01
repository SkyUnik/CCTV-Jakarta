import {
  adjacentCamera,
  createPassTracker,
  initialCamera,
  matchHighways,
  projectPointToLine,
  publicCameras,
  verifiedCameras,
} from "./geo.mjs";
import {
  geolocationFailure,
  geolocationPermissionState,
  INITIAL_LOCATION_OPTIONS,
  TRACKING_LOCATION_OPTIONS,
} from "./geolocation.mjs";
import { createOfflineMap } from "./offline-map.mjs";
import {
  enterVideoFullscreen,
  fullscreenMethod,
  nativeMediaErrorMessage,
  prefersNativeHls,
  supportsNativeHls,
} from "./player.mjs";

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
  manualCameraButton: document.querySelector("#manual-camera-button"),
  manualCameraPicker: document.querySelector("#manual-camera-picker"),
  manualCameraSelect: document.querySelector("#manual-camera-select"),
  mapBody: document.querySelector("#map-body"),
  mapCameraCard: document.querySelector("#map-camera-card"),
  mapCameraList: document.querySelector("#map-camera-list"),
  mapGpsButton: document.querySelector("#map-gps-button"),
  mapSummary: document.querySelector("#map-summary"),
  mapSvg: document.querySelector("#route-map-svg"),
  mapToggle: document.querySelector("#map-toggle"),
  next: document.querySelector("#next-button"),
  openPlayer: document.querySelector("#open-player-button"),
  playerCard: document.querySelector(".player-card"),
  playerHelper: document.querySelector("#player-helper"),
  position: document.querySelector("#position-value"),
  previous: document.querySelector("#previous-button"),
  retry: document.querySelector("#retry-button"),
  routeHelper: document.querySelector("#route-helper"),
  skip: document.querySelector("#skip-button"),
  sourceLink: document.querySelector("#source-link"),
  start: document.querySelector("#start-button"),
  stop: document.querySelector("#stop-button"),
  video: document.querySelector("#camera-video"),
  videoPlaceholder: document.querySelector("#video-placeholder"),
};

const state = {
  cameras: [],
  currentCamera: null,
  currentProjection: null,
  demo: new URLSearchParams(location.search).get("demo") === "1",
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
  offlineMap: null,
  pendingMapCamera: null,
  playIntent: false,
  playbackBlocked: false,
  playerReady: false,
  routeEnded: false,
  sourceChanging: false,
  stallTimer: null,
  usableCameras: [],
  watchId: null,
};

let passTracker = createPassTracker();

function setJourneyStatus(message) {
  elements.journeyStatus.textContent = message;
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
        setJourneyStatus("Kamera siap. Buka pemutar video untuk melanjutkan.");
      });
    } else {
      setJourneyStatus("Kamera siap. Buka pemutar video layar penuh untuk menonton.");
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
    const side = camera.side ? ` • ${camera.side}` : "";
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
    state.usableCameras = verifiedCameras(
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
    elements.cameraTitle.textContent = "Belum ada kamera terverifikasi";
    elements.cameraHighway.textContent = state.highway?.properties?.name ?? "Tol Jakarta";
    elements.cameraKm.textContent = "KM —";
    elements.sourceLink.hidden = true;
    setJourneyStatus("Data stream tersedia, tetapi koordinat kamera belum diverifikasi untuk pergantian otomatis.");
  }
  updateControls();
}

function selectDirection(direction) {
  const pendingMapCamera = state.pendingMapCamera;
  state.direction = direction;
  state.manualMode = false;
  state.currentCamera = null;
  state.playIntent = false;
  state.routeEnded = false;
  passTracker.reset();
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
    state.offlineMap?.selectHighway(nextId);
    return;
  }
  state.highway = feature;
  state.currentCamera = null;
  state.playIntent = false;
  state.currentProjection = null;
  state.routeEnded = false;
  state.manualMode = false;
  state.pendingMapCamera = null;
  state.offlineMap?.selectHighway(nextId);
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
  setJourneyStatus("Pilih arah A atau B untuk menonton kamera ini. Lokasi marker masih berupa perkiraan berdasarkan KM.");
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

function handlePosition(position) {
  elements.gpsDebug.hidden = true;
  const fix = {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracy: position.coords.accuracy,
  };
  state.lastPosition = fix;
  state.offlineMap?.updatePosition(fix);
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

  elements.gpsStatus.textContent = "GPS aktif";
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
      `Melacak posisi • konfirmasi lewat kamera ${result.consecutiveFixes}/${result.requiredFixes}`,
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
      if (attempt === state.locationAttempt) state.watchId = watchId;
      else navigator.geolocation.clearWatch(watchId);
    },
    (error) => void geolocationError(error, attempt),
    INITIAL_LOCATION_OPTIONS,
  );
}

function stopTracking() {
  state.locationAttempt += 1;
  if (state.watchId !== null) navigator.geolocation.clearWatch(state.watchId);
  state.watchId = null;
  elements.start.disabled = false;
  elements.stop.hidden = true;
  elements.gpsStatus.textContent = "Dihentikan";
  state.offlineMap?.updatePosition(null);
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
  playCamera(camera);
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
    state.offlineMap = createOfflineMap({
      body: elements.mapBody,
      cameraCard: elements.mapCameraCard,
      cameraList: elements.mapCameraList,
      gpsButton: elements.mapGpsButton,
      onSelectHighway: selectHighwayFromMap,
      onWatchCamera: watchCameraFromMap,
      summary: elements.mapSummary,
      svg: elements.mapSvg,
      toggle: elements.mapToggle,
    });
    state.offlineMap.setData(state.highways, state.cameras);
    renderHighways();
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
    elements.routeHelper.textContent = "Jalankan situs melalui server HTTP, bukan langsung dari file lokal.";
    setJourneyStatus("Berkas data tidak dapat dibaca.");
  }
}

elements.start.addEventListener("click", startTracking);
elements.stop.addEventListener("click", stopTracking);
elements.manualCameraButton.addEventListener("click", loadManualCamera);
elements.directionA.addEventListener("click", () => selectDirection("A"));
elements.directionB.addEventListener("click", () => selectDirection("B"));
elements.previous.addEventListener("click", () => moveCamera(-1));
elements.next.addEventListener("click", () => moveCamera(1));
elements.openPlayer.addEventListener("click", openVideoPlayer);
elements.retry.addEventListener("click", () => playCamera(state.currentCamera));
elements.skip.addEventListener("click", () => moveCamera(1));
elements.download.addEventListener("click", downloadM3u);
elements.demoAdvance.addEventListener("click", advanceDemo);

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
  setJourneyStatus("Siaran CCTV sedang diputar.");
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
  if (state.watchId !== null) navigator.geolocation.clearWatch(state.watchId);
  if (state.hls) state.hls.destroy();
});

loadData();
