import {
  createVideoController,
  nativeMediaErrorMessage,
} from "./player.mjs";

export const KOJA_TIMUR_DEFAULT_CAMERA = Object.freeze({
  id: "binamarga-akses-tanjung-priok-742",
  name: "ATP GT KOJA TIMUR",
  streamUrl: "https://pub2.hk-opt.com/LiveApp/streams/610831844814460955304790.m3u8",
});

export const DEFAULT_QUICK_ACTIONS = Object.freeze([
  {
    id: "koja-timur-quick",
    label: "Koja Timur",
    layout: "single",
    cameraIds: ["binamarga-akses-tanjung-priok-742"],
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
}) {
  let actions = DEFAULT_QUICK_ACTIONS;
  let preloadedMetadata = false;
  let pendingFullscreen = false;
  const controller = createVideoController({
    hlsClass,
    video: elements.video,
    onReady: () => {
      setStatus(null);
      if (pendingFullscreen) {
        pendingFullscreen = false;
        void controller.enterFullscreen();
      }
    },
    onError: (error) => {
      pendingFullscreen = false;
      setStatus(error?.details
        ? "Kamera publik Koja Timur tidak dapat diputar."
        : nativeMediaErrorMessage(elements.video?.error));
    },
  });

  function findActiveCamera() {
    const targetId = actions[0]?.cameraIds?.[0] || KOJA_TIMUR_DEFAULT_CAMERA.id;
    return cameras.find((c) => c.id === targetId) || KOJA_TIMUR_DEFAULT_CAMERA;
  }

  function destroyQuickPlayer(options = {}) {
    pendingFullscreen = false;
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

  async function preloadMetadata(camera) {
    if (!camera?.streamUrl || preloadedMetadata) return;
    try {
      const res = await fetch(camera.streamUrl, { method: "HEAD" });
      if (res.ok) preloadedMetadata = true;
    } catch {
      // Ignore preloading network failures; stream will retry on user tap
    }
  }

  async function init() {
    actions = await fetchQuickActions();
    const activeCamera = findActiveCamera();
    if (activeCamera) {
      void preloadMetadata(activeCamera);
    }
  }

  function playStream() {
    if (!elements.video) return;
    const camera = findActiveCamera();
    setStatus("Memuat stream Koja Timur…");
    elements.video.muted = true;
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
      elements.retry.addEventListener("click", playStream);
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
