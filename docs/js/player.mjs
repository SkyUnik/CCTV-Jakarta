export const HLS_MIME_TYPES = Object.freeze([
  "application/vnd.apple.mpegurl",
  "application/x-mpegURL",
]);

export function supportsNativeHls(video) {
  return HLS_MIME_TYPES.some((type) => Boolean(video.canPlayType?.(type)));
}

export function shouldUseNativeHls(video, hlsApi) {
  return supportsNativeHls(video) && !hlsApi?.isSupported?.();
}

export function playbackTechnology(video, hlsApi, scope = globalThis) {
  if (hlsApi?.isSupported?.()) {
    const mediaSource = hlsApi.getMediaSource?.();
    return scope?.ManagedMediaSource && mediaSource === scope.ManagedMediaSource
      ? "hls-mms"
      : "hls-mse";
  }
  return supportsNativeHls(video) ? "native" : "unsupported";
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
  let hlsAttached = false;
  let mode = null;
  let technology = "unsupported";
  let activeLoad = null;
  let mediaRecoveryAttempts = 0;

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
    hlsAttached = false;
  }

  function destroy({ preservePip = false, clearSource = true } = {}) {
    generation += 1;
    activeLoad = null;
    mediaRecoveryAttempts = 0;
    destroyHls();
    clearHandlers();
    if (!video) return;
    if (!preservePip) video.pause?.();
    if (clearSource && !isPictureInPictureActive(video)) {
      video.removeAttribute?.("src");
      video.load?.();
    }
    mode = null;
    technology = "unsupported";
  }

  function loadNative(camera, currentGeneration, callbacks) {
    mode = "native";
    technology = "native";
    const ready = () => {
      if (currentGeneration === generation) {
        (callbacks.onReady ?? onReady)({ camera, mode, technology });
      }
    };
    video.onloadedmetadata = ready;
    video.oncanplay = ready;
    video.onerror = () => {
      if (currentGeneration === generation) {
        (callbacks.onError ?? onError)(video.error, { camera, mode, technology });
      }
    };
    if (video.src !== camera.streamUrl) video.src = camera.streamUrl;
    if (video.readyState >= 1) queueMicrotask(ready);
  }

  function eventUrl(data) {
    return data?.url ?? data?.frag?.url ?? data?.context?.url ?? null;
  }

  function eventMatchesActiveLoad(data) {
    const url = eventUrl(data);
    return !url || url === activeLoad?.camera?.streamUrl;
  }

  function ensureHls() {
    if (hls) return hls;
    hls = new hlsClass({
      enableWorker: true,
      lowLatencyMode: true,
      preferManagedMediaSource: true,
      backBufferLength: 30,
      liveSyncDurationCount: 3,
      liveMaxLatencyDurationCount: 8,
      manifestLoadingMaxRetry: 2,
      levelLoadingMaxRetry: 2,
      fragLoadingMaxRetry: 2,
    });
    hls.on(hlsClass.Events.MANIFEST_PARSED, (_, data) => {
      if (!activeLoad || !eventMatchesActiveLoad(data)) return;
      const { callbacks, camera, generation: loadGeneration } = activeLoad;
      if (loadGeneration === generation) {
        (callbacks.onReady ?? onReady)({ camera, mode: "hls", technology });
      }
    });
    hls.on(hlsClass.Events.ERROR, (_, data) => {
      if (!activeLoad || !eventMatchesActiveLoad(data) || !data?.fatal) return;
      const { callbacks, camera, generation: loadGeneration } = activeLoad;
      if (loadGeneration === generation) {
        if (
          data?.type === hlsClass.ErrorTypes?.MEDIA_ERROR &&
          mediaRecoveryAttempts < 1 &&
          typeof hls.recoverMediaError === "function"
        ) {
          mediaRecoveryAttempts += 1;
          hls.recoverMediaError();
          return;
        }
        if (supportsNativeHls(video)) {
          const shouldContinue = !video.paused || isPictureInPictureActive(video);
          destroyHls();
          clearHandlers();
          loadNative(camera, loadGeneration, callbacks);
          if (shouldContinue) video.play?.().catch?.(() => {});
          return;
        }
        (callbacks.onError ?? onError)(data, { camera, mode: "hls", technology });
      }
    });
    return hls;
  }

  function loadHls(camera, currentGeneration, callbacks) {
    if (!hlsClass?.isSupported?.()) return false;
    mode = "hls";
    technology = playbackTechnology(video, hlsClass);
    clearHandlers();
    const instance = ensureHls();
    activeLoad = { callbacks, camera, generation: currentGeneration };
    mediaRecoveryAttempts = 0;
    if (!hlsAttached) {
      instance.attachMedia(video);
      hlsAttached = true;
    } else {
      // HLS.js loadSource() normally detaches and recreates MediaSource when
      // the URL changes. transferMedia() lets us reset the stream controllers
      // while keeping the same HTMLVideoElement and MediaSource attachment,
      // which prevents iOS fullscreen/PiP geometry from being torn down.
      const transferredMedia = instance.transferMedia?.();
      if (transferredMedia) {
        hlsAttached = false;
        instance.loadSource(camera.streamUrl);
        instance.attachMedia(transferredMedia);
        hlsAttached = true;
        return true;
      }
    }
    instance.loadSource(camera.streamUrl);
    return true;
  }

  function load(camera, { continuePlaying = false, onError: loadError, onReady: loadReady } = {}) {
    if (!video || !camera?.streamUrl) return false;
    generation += 1;
    const currentGeneration = generation;
    const callbacks = { onError: loadError, onReady: loadReady };
    const pipActive = isPictureInPictureActive(video);
    activeLoad = null;
    if (!pipActive) clearHandlers();
    if (shouldUseNativeHls(video, hlsClass)) {
      destroyHls();
      loadNative(camera, currentGeneration, callbacks);
    } else if (!loadHls(camera, currentGeneration, callbacks)) {
      loadNative(camera, currentGeneration, callbacks);
    }
    if (continuePlaying || pipActive || video.paused === false) {
      video.play?.().catch?.(() => {});
    }
    return true;
  }

  return {
    destroy,
    enterFullscreen: () => enterVideoFullscreen(video),
    getMode: () => mode,
    getTechnology: () => technology,
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
