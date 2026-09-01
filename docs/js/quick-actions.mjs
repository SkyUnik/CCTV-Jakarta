import {
  createVideoController,
  nativeMediaErrorMessage,
} from "./player.mjs";

export const KOJA_TIMUR_DEFAULT_CAMERA = Object.freeze({
  id: "binamarga-akses-tanjung-priok-742",
  name: "ATP GT KOJA TIMUR",
  streamUrl: "https://pub2.hk-opt.com/LiveApp/streams/610831844814460955304790.m3u8",
});

export const JOR_PRIUK_DEFAULT_CAMERA = Object.freeze({
  id: "binamarga-akses-tanjung-priok-753",
  name: "ATP KM 61+400 A",
  streamUrl: "https://pub2.hk-opt.com/LiveApp/streams/756751654695732090756915.m3u8",
});

export const DEFAULT_QUICK_ACTIONS = Object.freeze([
  {
    id: "jor-priuk-quick",
    label: "JOR Priuk",
    layout: "single",
    cameraIds: ["binamarga-akses-tanjung-priok-753"],
    defaultCamera: JOR_PRIUK_DEFAULT_CAMERA,
  },
  {
    id: "koja-timur-quick",
    label: "Koja Timur",
    layout: "single",
    cameraIds: ["binamarga-akses-tanjung-priok-742"],
    defaultCamera: KOJA_TIMUR_DEFAULT_CAMERA,
  },
]);

export async function fetchQuickActions(url = "./data/quick-actions.json") {
  try {
    const res = await fetch(url);
    if (!res.ok) return DEFAULT_QUICK_ACTIONS;
    const data = await res.json();
    return Array.isArray(data) && data.length > 0 ? data : DEFAULT_QUICK_ACTIONS;
  } catch {
    return DEFAULT_QUICK_ACTIONS;
  }
}

export function createQuickActionManager({
  elements,
  cameras = [],
  hlsClass = typeof window !== "undefined" ? window.Hls : null,
  actionIndex = 0,
  label = "Kamera",
}) {
  let actions = DEFAULT_QUICK_ACTIONS;
  let loadedCameraId = null;
  let playerReady = false;
  let preloadedMetadata = false;
  let pendingFullscreen = false;
  const controller = createVideoController({
    hlsClass,
    video: elements.video,
    onReady: (context = {}) => {
      playerReady = true;
      preloadedMetadata = true;
      if (elements.video?.dataset) {
        elements.video.dataset.playbackTechnology = context.technology ??
          controller.getTechnology();
      }
      setStatus(null);
      if (pendingFullscreen) {
        pendingFullscreen = false;
        void controller.enterFullscreen();
      }
    },
    onError: (error) => {
      playerReady = false;
      pendingFullscreen = false;
      setStatus(error?.details
        ? `Kamera publik ${label} tidak dapat diputar.`
        : nativeMediaErrorMessage(elements.video?.error));
    },
  });

  function findActiveCamera() {
    const action = actions[actionIndex] ?? actions[0];
    const fallback = action?.defaultCamera ?? KOJA_TIMUR_DEFAULT_CAMERA;
    const targetId = action?.cameraIds?.[0] || fallback.id;
    return cameras.find((c) => c.id === targetId) || fallback;
  }

  function destroyQuickPlayer(options = {}) {
    pendingFullscreen = false;
    loadedCameraId = null;
    playerReady = false;
    preloadedMetadata = false;
    controller.destroy({
      clearSource: !options.reuseSource,
      preservePip: options.preservePip,
    });
  }

  function setStatus(message) {
    if (!elements.status) return;
    if (message) {
      elements.status.textContent = message;
      elements.status.hidden = false;
    } else {
      elements.status.hidden = true;
    }
  }

  async function init() {
    actions = await fetchQuickActions();
    const activeCamera = findActiveCamera();
    if (activeCamera?.streamUrl && elements.video) {
      loadedCameraId = activeCamera.id;
      controller.load(activeCamera);
    }
  }

  function playStream({ forceReload = false } = {}) {
    if (!elements.video) return;
    const camera = findActiveCamera();
    setStatus(`Memuat stream ${label}…`);
    elements.video.muted = true;
    if (!forceReload && playerReady && loadedCameraId === camera.id) {
      controller.play()?.catch?.(() => {
        setStatus(`Tekan Putar untuk membuka kamera ${label}.`);
      });
      return;
    }
    loadedCameraId = camera.id;
    playerReady = false;
    if (!controller.load(camera, { continuePlaying: true })) {
      setStatus("Browser tidak mendukung format pemutaran video ini.");
    }
  }

  function triggerOneTap() {
    if (!elements.overlay) return;
    elements.overlay.hidden = false;
    pendingFullscreen = true;
    // play() is called synchronously from the gesture inside playStream,
    // which unlocks the video on iOS Safari for later fullscreen entry.
    playStream();
    if (elements.video) {
      // Try immediate fullscreen; succeeds if video already has metadata.
      // If it returns null the video isn't ready yet and onReady will retry.
      controller.enterFullscreen().then((method) => {
        if (method) pendingFullscreen = false;
      });
    }
  }

  function close() {
    pendingFullscreen = false;
    if (!controller.isPipActive()) destroyQuickPlayer();
    if (elements.overlay) {
      elements.overlay.hidden = true;
    }
  }

  function bindEvents() {
    if (elements.launcher) {
      elements.launcher.addEventListener("click", triggerOneTap);
    }
    if (elements.close) {
      elements.close.addEventListener("click", close);
    }
    if (elements.overlay) {
      elements.overlay.addEventListener("click", (event) => {
        const card = typeof elements.overlay.querySelector === "function"
          ? elements.overlay.querySelector(".quick-camera-card")
          : null;
        if (card ? !card.contains(event.target) : event.target === elements.overlay) {
          close();
        }
      });
    }
    if (elements.play) {
      elements.play.addEventListener("click", playStream);
    }
    if (elements.fullscreen && elements.video) {
      elements.fullscreen.addEventListener("click", () => {
        void controller.enterFullscreen();
      });
    }
    if (elements.retry) {
      elements.retry.addEventListener("click", () => playStream({ forceReload: true }));
    }
  }

  return {
    init,
    bindEvents,
    triggerOneTap,
    close,
    destroyQuickPlayer,
    getPreloadedMetadata: () => preloadedMetadata,
    isPipActive: controller.isPipActive,
  };
}
