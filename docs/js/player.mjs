export const HLS_MIME_TYPES = Object.freeze([
  "application/vnd.apple.mpegurl",
  "application/x-mpegURL",
]);

export function supportsNativeHls(video) {
  return HLS_MIME_TYPES.some((type) => Boolean(video.canPlayType?.(type)));
}

export function prefersNativeHls(video, hlsApi) {
  if (!supportsNativeHls(video)) return false;
  const hasSafariVideoApi = typeof video.webkitEnterFullscreen === "function" ||
    typeof video.webkitSetPresentationMode === "function";
  return hasSafariVideoApi || !hlsApi?.isSupported?.();
}

export function shouldUseNativeHls(video, hlsApi) {
  return supportsNativeHls(video) && !hlsApi?.isSupported?.();
}

export function fullscreenMethod(video) {
  if (
    typeof video.webkitEnterFullscreen === "function" &&
    video.webkitSupportsFullscreen !== false
  ) return "webkit";
  if (
    typeof video.webkitSetPresentationMode === "function" &&
    (typeof video.webkitSupportsPresentationMode !== "function" ||
      video.webkitSupportsPresentationMode("fullscreen"))
  ) return "presentation";
  if (typeof video.requestFullscreen === "function") return "standard";
  return null;
}

export function isPictureInPictureActive(video, ownerDocument = globalThis.document) {
  return Boolean(
    video &&
    (
      video.webkitPresentationMode === "picture-in-picture" ||
      ownerDocument?.pictureInPictureElement === video
    )
  );
}

export async function enterVideoFullscreen(video) {
  const method = fullscreenMethod(video);
  if (method === "webkit") {
    video.webkitEnterFullscreen();
    return method;
  }
  if (method === "presentation") {
    video.webkitSetPresentationMode("fullscreen");
    return method;
  }
  if (method === "standard") {
    await video.requestFullscreen({ navigationUI: "hide" });
    return method;
  }
  return null;
}

export function createVideoController({
  hlsClass = globalThis.Hls,
  onError = () => {},
  onReady = () => {},
  video,
} = {}) {
  let generation = 0;
  let hls = null;
  let mode = null;

  function clearHandlers() {
    if (!video) return;
    video.onloadedmetadata = null;
    video.oncanplay = null;
    video.onerror = null;
  }

  function destroyHls() {
    if (!hls) return;
    hls.destroy();
    hls = null;
  }

  function destroy({ preservePip = false, clearSource = true } = {}) {
    generation += 1;
    destroyHls();
    clearHandlers();
    if (!video) return;
    if (!preservePip) video.pause?.();
    if (clearSource && !isPictureInPictureActive(video)) {
      video.removeAttribute?.("src");
      video.load?.();
    }
    mode = null;
  }

  function loadNative(camera, currentGeneration, callbacks) {
    mode = "native";
    const ready = () => {
      if (currentGeneration === generation) (callbacks.onReady ?? onReady)({ camera, mode });
    };
    video.onloadedmetadata = ready;
    video.oncanplay = ready;
    video.onerror = () => {
      if (currentGeneration === generation) (callbacks.onError ?? onError)(video.error, { camera, mode });
    };
    if (video.src !== camera.streamUrl) video.src = camera.streamUrl;
  }

  function loadHls(camera, currentGeneration, callbacks) {
    if (!hlsClass?.isSupported?.()) return false;
    mode = "hls";
    destroyHls();
    clearHandlers();
    hls = new hlsClass({
      enableWorker: true,
      lowLatencyMode: true,
      backBufferLength: 30,
      liveSyncDurationCount: 3,
      liveMaxLatencyDurationCount: 8,
      manifestLoadingMaxRetry: 2,
      levelLoadingMaxRetry: 2,
      fragLoadingMaxRetry: 2,
    });
    hls.on(hlsClass.Events.MANIFEST_PARSED, () => {
      if (currentGeneration === generation) (callbacks.onReady ?? onReady)({ camera, mode });
    });
    hls.on(hlsClass.Events.ERROR, (_, data) => {
      if (currentGeneration === generation && data?.fatal) {
        if (supportsNativeHls(video)) {
          destroyHls();
          loadNative(camera, currentGeneration, callbacks);
          if (!video.paused || isPictureInPictureActive(video)) video.play?.().catch?.(() => {});
          return;
        }
        (callbacks.onError ?? onError)(data, { camera, mode });
      }
    });
    hls.attachMedia(video);
    hls.loadSource(camera.streamUrl);
    return true;
  }

  function load(camera, { continuePlaying = false, onError: loadError, onReady: loadReady } = {}) {
    if (!video || !camera?.streamUrl) return false;
    generation += 1;
    const currentGeneration = generation;
    const callbacks = { onError: loadError, onReady: loadReady };
    const pipActive = isPictureInPictureActive(video);
    if (!pipActive) clearHandlers();
    if (shouldUseNativeHls(video, hlsClass)) {
      destroyHls();
      loadNative(camera, currentGeneration, callbacks);
    } else if (!loadHls(camera, currentGeneration, callbacks)) {
      loadNative(camera, currentGeneration, callbacks);
    }
    if (continuePlaying || pipActive || !video.paused) {
      video.play?.().catch?.(() => {});
    }
    return true;
  }

  return {
    destroy,
    enterFullscreen: () => enterVideoFullscreen(video),
    getMode: () => mode,
    isPipActive: () => isPictureInPictureActive(video),
    load,
    play: () => video?.play?.(),
  };
}

export function nativeMediaErrorMessage(mediaError) {
  switch (mediaError?.code) {
    case 1:
      return "Pemutaran kamera dibatalkan.";
    case 2:
      return "Jaringan terputus saat memuat kamera.";
    case 3:
      return "Safari tidak dapat mendekode format video kamera ini.";
    case 4:
      return "Format atau alamat stream kamera tidak didukung.";
    default:
      return "Kamera publik sedang offline atau sumber menolak pemutaran.";
  }
}
