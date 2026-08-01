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

export function preventPictureInPicture(video) {
  if (!video) return;
  try {
    video.disablePictureInPicture = true;
  } catch {
    // Some Safari builds expose the property as readonly; the attribute still helps.
  }
  video.setAttribute?.("disablepictureinpicture", "");
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

export async function exitPictureInPicture(video, ownerDocument = globalThis.document) {
  if (!isPictureInPictureActive(video, ownerDocument)) return false;
  if (
    ownerDocument?.pictureInPictureElement === video &&
    typeof ownerDocument.exitPictureInPicture === "function"
  ) {
    await ownerDocument.exitPictureInPicture();
    return true;
  }
  if (
    video.webkitPresentationMode === "picture-in-picture" &&
    typeof video.webkitSetPresentationMode === "function" &&
    (typeof video.webkitSupportsPresentationMode !== "function" ||
      video.webkitSupportsPresentationMode("inline"))
  ) {
    video.webkitSetPresentationMode("inline");
    return true;
  }
  return false;
}

export async function enterVideoFullscreen(video) {
  if (isPictureInPictureActive(video)) {
    await exitPictureInPicture(video);
  }
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
