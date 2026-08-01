import {
  enterVideoFullscreen,
  exitPictureInPicture,
  nativeMediaErrorMessage,
  preventPictureInPicture,
  prefersNativeHls,
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
  let hlsInstance = null;

  preventPictureInPicture(elements.video);

  function findActiveCamera() {
    const targetId = actions[0]?.cameraIds?.[0] || KOJA_TIMUR_DEFAULT_CAMERA.id;
    return cameras.find((c) => c.id === targetId) || KOJA_TIMUR_DEFAULT_CAMERA;
  }

  function destroyQuickPlayer(options = {}) {
    if (hlsInstance) {
      hlsInstance.destroy();
      hlsInstance = null;
    }
    if (elements.video) {
      elements.video.pause();
      elements.video.onloadedmetadata = null;
      elements.video.onerror = null;
      if (!options.reuseSource) {
        elements.video.removeAttribute("src");
        elements.video.load();
      }
    }
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
    destroyQuickPlayer({ reuseSource: true });
    setStatus("Memuat stream Koja Timur…");
    elements.video.muted = true;

    const streamUrl = camera.streamUrl;
    const useNative = prefersNativeHls(elements.video, hlsClass);

    if (useNative) {
      if (elements.video.src !== streamUrl) {
        elements.video.src = streamUrl;
      }
      if (elements.video.readyState >= 1) {
        setStatus(null);
      } else {
        elements.video.onloadedmetadata = () => setStatus(null);
      }
      elements.video.onerror = () => {
        setStatus(nativeMediaErrorMessage(elements.video.error));
      };
      elements.video.play().catch(() => {
        setStatus("Gagal memulai pemutaran stream.");
      });
    } else if (hlsClass?.isSupported?.()) {
      hlsInstance = new hlsClass({ autoStartLoad: true });
      hlsInstance.loadSource(streamUrl);
      hlsInstance.attachMedia(elements.video);
      hlsInstance.on(hlsClass.Events.MANIFEST_PARSED, () => {
        setStatus(null);
        elements.video.play().catch(() => {
          setStatus("Gagal memulai pemutaran stream.");
        });
      });
      hlsInstance.on(hlsClass.Events.ERROR, (_, data) => {
        if (data?.fatal) {
          setStatus("Kamera publik Koja Timur tidak dapat diputar.");
        }
      });
    } else {
      setStatus("Browser tidak mendukung format pemutaran video ini.");
    }
  }

  function triggerOneTap() {
    if (!elements.overlay) return;
    elements.overlay.hidden = false;
    playStream();
    if (elements.video) {
      void enterVideoFullscreen(elements.video);
    }
  }

  function close() {
    void exitPictureInPicture(elements.video).finally(() => destroyQuickPlayer());
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
        void enterVideoFullscreen(elements.video);
      });
    }
    if (elements.video) {
      elements.video.addEventListener?.("enterpictureinpicture", () => {
        void exitPictureInPicture(elements.video);
      });
      elements.video.addEventListener?.("webkitpresentationmodechanged", () => {
        if (elements.video.webkitPresentationMode === "picture-in-picture") {
          void exitPictureInPicture(elements.video);
        }
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
  };
}
