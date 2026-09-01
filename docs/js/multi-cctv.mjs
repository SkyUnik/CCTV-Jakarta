import { viewRegionFor } from "./driving-ui.mjs";
import { createVideoController, isPictureInPictureActive } from "./player.mjs";

export const MAX_LIVE_CONTROLLERS = 4;

export function isTollGate(camera) {
  if (!camera) return false;
  if (camera.cameraType === "toll_gate") return true;
  const name = String(camera.name ?? "").toUpperCase();
  return /\bGT\b|GERBANG TOL/.test(name);
}

export function orderCamerasForMultiCctv(cameras = []) {
  const list = [...cameras].filter((camera) =>
    camera &&
    typeof camera.streamUrl === "string" &&
    camera.streamUrl.length > 0
  );

  return list.sort((a, b) => {
    const isGateA = isTollGate(a);
    const isGateB = isTollGate(b);

    // GT first
    if (isGateA && !isGateB) return -1;
    if (!isGateA && isGateB) return 1;

    // Within same group (GT or regular), sort by KM ascending
    const kmA = Number.isFinite(a.km)
      ? a.km
      : (Number.isFinite(a.roadPositionM) ? a.roadPositionM / 1_000 : Number.POSITIVE_INFINITY);
    const kmB = Number.isFinite(b.km)
      ? b.km
      : (Number.isFinite(b.roadPositionM) ? b.roadPositionM / 1_000 : Number.POSITIVE_INFINITY);

    if (kmA !== kmB) return kmA - kmB;
    return (a.name ?? "").localeCompare(b.name ?? "", "id") || a.id.localeCompare(b.id);
  });
}

export function orderCamerasForJourney(cameras = [], direction = null) {
  if (direction === "A" || direction === "B") {
    const list = [...cameras].filter((camera) =>
      camera &&
      typeof camera.streamUrl === "string" &&
      camera.streamUrl.length > 0 &&
      (Number.isFinite(camera.km) || Number.isFinite(camera.roadPositionM))
    );
    if (direction === "B") {
      return list.sort((a, b) => {
        const kmA = Number.isFinite(a.km) ? a.km : (Number.isFinite(a.roadPositionM) ? a.roadPositionM / 1_000 : 0);
        const kmB = Number.isFinite(b.km) ? b.km : (Number.isFinite(b.roadPositionM) ? b.roadPositionM / 1_000 : 0);
        return kmB - kmA || b.id.localeCompare(a.id);
      });
    }
    return list.sort((a, b) => {
      const kmA = Number.isFinite(a.km) ? a.km : (Number.isFinite(a.roadPositionM) ? a.roadPositionM / 1_000 : 0);
      const kmB = Number.isFinite(b.km) ? b.km : (Number.isFinite(b.roadPositionM) ? b.roadPositionM / 1_000 : 0);
      return kmA - kmB || a.id.localeCompare(b.id);
    });
  }
  return orderCamerasForMultiCctv(cameras);
}

function escapeKey(event) {
  return event.key === "Escape";
}

function formatKm(km) {
  if (!Number.isFinite(km)) return "KM —";
  const whole = Math.floor(km);
  const meters = Math.round((km - whole) * 1_000);
  return `KM ${String(whole).padStart(2, "0")}+${String(meters).padStart(3, "0")}`;
}

function formatDirection(camera) {
  if (camera.cameraType === "toll_gate") return "Gerbang Tol";
  if (camera.cameraType === "wide_view") return "Dua Arah (A/B)";
  if (camera.side === "A") return "Arah A";
  if (camera.side === "B") return "Arah B";
  if (Array.isArray(camera.directions) && camera.directions.includes("A") && camera.directions.includes("B")) {
    return "Arah A/B";
  }
  return "Arah —";
}

export function createMultiCctvManager({
  closeButton,
  gridElement,
  hlsClass = globalThis.Hls,
  overlayElement,
  subtitleElement,
  titleElement,
  maxControllers = MAX_LIVE_CONTROLLERS,
  onSelectCamera = () => {},
} = {}) {
  let activeHighway = null;
  let activeCameras = [];
  let isOpen = false;
  let openerButton = null;

  // Active controller slots: Map<cameraId, { card, video, controller, pinned: boolean }>
  const activeSlots = new Map();

  function buildCard(camera, index) {
    const card = document.createElement("article");
    card.className = `multi-cctv-card${isTollGate(camera) ? " is-gt" : ""}`;
    card.dataset.cameraId = camera.id;
    card.dataset.index = String(index);
    card.style.minHeight = "230px";

    const header = document.createElement("div");
    header.className = "multi-cctv-card-header";

    const titleGroup = document.createElement("div");
    titleGroup.className = "multi-cctv-card-title";

    const num = document.createElement("span");
    num.className = "camera-num";
    num.textContent = `#${index + 1}`;

    const name = document.createElement("strong");
    name.textContent = camera.name;
    name.title = camera.name;

    titleGroup.append(num, name);

    const liveBadge = document.createElement("span");
    liveBadge.className = "multi-cctv-badge";
    liveBadge.textContent = "STANDBY";

    header.append(titleGroup, liveBadge);

    const mediaWrap = document.createElement("div");
    mediaWrap.className = "multi-cctv-media";
    mediaWrap.style.minHeight = "180px";

    const video = document.createElement("video");
    video.controls = true;
    video.muted = true;
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");
    video.setAttribute("preload", "metadata");
    video.src = camera.streamUrl;
    video.setAttribute("aria-label", `Siaran CCTV ${camera.name}`);
    video.className = "multi-cctv-video";

    const playOverlay = document.createElement("div");
    playOverlay.className = "multi-cctv-play-overlay";

    const playBtn = document.createElement("div");
    playBtn.className = "multi-cctv-play-btn";

    const playIcon = document.createElement("span");
    playIcon.className = "multi-cctv-play-icon";
    playIcon.textContent = "▶";
    playIcon.setAttribute("aria-hidden", "true");

    const playText = document.createElement("span");
    playText.className = "multi-cctv-play-text";
    playText.textContent = "Putar Siaran";

    playBtn.append(playIcon, playText);
    playOverlay.append(playBtn);
    mediaWrap.append(video, playOverlay);

    // Region overlay if configured
    const region = viewRegionFor(camera, camera.side ?? "A");
    if (region) {
      const regionBox = document.createElement("div");
      regionBox.className = "video-road-region multi-cctv-region";
      regionBox.style.left = `${(region.x * 100).toFixed(2)}%`;
      regionBox.style.top = `${(region.y * 100).toFixed(2)}%`;
      regionBox.style.width = `${(region.width * 100).toFixed(2)}%`;
      regionBox.style.height = `${(region.height * 100).toFixed(2)}%`;

      const label = document.createElement("strong");
      label.textContent = activeHighway?.properties?.name ?? "Ruas Tol";
      const status = document.createElement("span");
      status.textContent = region.status === "confirmed" ? "Area diverifikasi" : "Area perkiraan";
      regionBox.append(label, status);
      mediaWrap.append(regionBox);
    }

    const footer = document.createElement("div");
    footer.className = "multi-cctv-card-footer";

    const kmTag = document.createElement("span");
    kmTag.className = "meta-tag km";
    kmTag.textContent = formatKm(camera.km);

    const dirTag = document.createElement("span");
    dirTag.className = `meta-tag dir${isTollGate(camera) ? " is-gt" : ""}`;
    dirTag.textContent = formatDirection(camera);

    footer.append(kmTag, dirTag);
    card.append(header, mediaWrap, footer);

    card.addEventListener("click", (event) => {
      if (activeSlots.has(camera.id)) {
        if (event.target === video) return;
        detachSlot(camera.id);
      } else {
        attachSlot(camera, card);
      }
      onSelectCamera(camera);
    });

    return card;
  }

  function availableSlotsCount() {
    let pinnedCount = 0;
    for (const slot of activeSlots.values()) {
      if (slot.pinned || (slot.video && isPictureInPictureActive(slot.video))) {
        pinnedCount += 1;
      }
    }
    return Math.max(0, maxControllers - pinnedCount);
  }

  function detachSlot(cameraId) {
    const slot = activeSlots.get(cameraId);
    if (!slot) return;
    if (slot.video && isPictureInPictureActive(slot.video)) {
      slot.pinned = true;
      return; // Never interrupt PiP
    }
    slot.controller?.destroy({ clearSource: true, preservePip: false });
    if (slot.video) {
      // Restore thumbnail: re-set src with metadata-only preload
      const streamUrl = slot.camera?.streamUrl;
      if (streamUrl) {
        slot.video.src = streamUrl;
        slot.video.setAttribute("preload", "metadata");
      } else {
        slot.video.removeAttribute("src");
        slot.video.setAttribute("preload", "none");
      }
      slot.video.onloadeddata = null;
      slot.video.onplaying = null;
    }
    const playOverlay = slot.card?.querySelector(".multi-cctv-play-overlay");
    if (playOverlay) {
      playOverlay.hidden = false;
      playOverlay.style.display = "flex";
    }
    const badge = slot.card?.querySelector(".multi-cctv-badge");
    if (badge) {
      badge.textContent = "STANDBY";
      badge.classList.remove("is-live");
    }
    activeSlots.delete(cameraId);
  }

  function attachSlot(camera, card) {
    if (activeSlots.has(camera.id)) return;

    // Check pool capacity
    const activeUnpinned = [...activeSlots.entries()].filter(
      ([, s]) => !s.pinned && !isPictureInPictureActive(s.video),
    );
    if (activeSlots.size >= maxControllers) {
      if (activeUnpinned.length > 0) {
        // Evict the oldest unpinned controller
        const [evictId] = activeUnpinned[0];
        detachSlot(evictId);
      } else {
        // All controllers are pinned in PiP, cannot attach more
        return;
      }
    }

    const video = card.querySelector(".multi-cctv-video");
    const playOverlay = card.querySelector(".multi-cctv-play-overlay");
    const badge = card.querySelector(".multi-cctv-badge");

    const revealVideo = () => {
      if (playOverlay) {
        playOverlay.hidden = true;
        playOverlay.style.display = "none";
      }
      if (badge) {
        badge.textContent = "LIVE";
        badge.classList?.add?.("is-live");
      }
      video?.play?.()?.catch?.(() => {});
    };

    if (video) {
      video.setAttribute("preload", "auto");
      video.onloadeddata = revealVideo;
      video.onplaying = revealVideo;
    }

    const controller = createVideoController({
      hlsClass,
      video,
      onReady: () => {
        revealVideo();
      },
      onError: () => {
        if (badge) {
          badge.textContent = "OFFLINE";
          badge.classList?.remove?.("is-live");
        }
      },
    });

    controller.load(camera, { continuePlaying: true, reloadSource: true });
    revealVideo();

    activeSlots.set(camera.id, {
      camera,
      card,
      controller,
      pinned: false,
      video,
    });
  }

  function handleKeydown(event) {
    if (!isOpen) return;
    if (escapeKey(event)) {
      close();
      return;
    }
    if (event.key !== "Tab") return;

    const focusable = [...overlayElement.querySelectorAll(
      'button:not([disabled]):not([hidden]), [tabindex="0"]',
    )].filter((el) => el.getClientRects?.().length > 0 || true);
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

  function open({ highway, cameras = [], opener = null } = {}) {
    if (isOpen) return;
    isOpen = true;
    openerButton = opener;
    activeHighway = highway;
    activeCameras = orderCamerasForMultiCctv(cameras);

    document?.body?.classList?.add("multi-cctv-open");
    overlayElement.hidden = false;

    if (titleElement) {
      titleElement.textContent = highway?.properties?.name ?? "Ruas Tol Jakarta";
    }
    if (subtitleElement) {
      subtitleElement.textContent = `Semua Arah • ${activeCameras.length} CCTV`;
    }

    if (gridElement) {
      gridElement.replaceChildren();
      const gtCameras = activeCameras.filter(isTollGate);
      const roadCameras = activeCameras.filter((c) => !isTollGate(c));

      if (activeCameras.length === 0) {
        const emptyNotice = document.createElement("p");
        emptyNotice.className = "multi-cctv-empty";
        emptyNotice.textContent = "Belum ada CCTV untuk ruas tol ini.";
        gridElement.append(emptyNotice);
      } else {
        let globalIndex = 0;

        if (gtCameras.length > 0) {
          const gtHeading = document.createElement("div");
          gtHeading.className = "multi-cctv-section-heading is-gt-section";
          gtHeading.innerHTML = `<span class="title">📍 Gerbang Tol (GT)</span><span class="count">${gtCameras.length} CCTV</span>`;
          gridElement.append(gtHeading);

          for (let i = 0; i < gtCameras.length; i += 1) {
            const card = buildCard(gtCameras[i], globalIndex);
            globalIndex += 1;
            gridElement.append(card);
          }
        }

        if (roadCameras.length > 0) {
          const roadHeading = document.createElement("div");
          roadHeading.className = "multi-cctv-section-heading is-road-section";
          roadHeading.innerHTML = `<span class="title">🛣️ Jalur Utama Tol</span><span class="count">${roadCameras.length} CCTV</span>`;
          gridElement.append(roadHeading);

          for (let i = 0; i < roadCameras.length; i += 1) {
            const card = buildCard(roadCameras[i], globalIndex);
            globalIndex += 1;
            gridElement.append(card);
          }
        }
      }
    }

    if (typeof globalThis.document?.addEventListener === "function") {
      document.addEventListener("keydown", handleKeydown);
    }
    if (typeof globalThis.requestAnimationFrame === "function") {
      requestAnimationFrame(() => {
        closeButton?.focus?.({ preventScroll: true });
      });
    } else {
      closeButton?.focus?.({ preventScroll: true });
    }
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    if (typeof globalThis.document?.removeEventListener === "function") {
      document.removeEventListener("keydown", handleKeydown);
    }

    for (const [id, slot] of activeSlots) {
      if (!slot.video || !isPictureInPictureActive(slot.video)) {
        slot.controller?.destroy({ clearSource: true, preservePip: false });
        if (slot.video) {
          slot.video.removeAttribute("src");
          slot.video.setAttribute("preload", "none");
          slot.video.load?.();
          slot.video.onloadeddata = null;
          slot.video.onplaying = null;
        }
        activeSlots.delete(id);
      }
    }

    document?.body?.classList?.remove("multi-cctv-open");
    overlayElement.hidden = true;

    if (openerButton && typeof openerButton.focus === "function") {
      openerButton.focus({ preventScroll: true });
    }
  }

  closeButton?.addEventListener("click", close);

  // Click outside dialog box to close
  overlayElement?.addEventListener("click", (event) => {
    const panel = typeof overlayElement.querySelector === "function"
      ? overlayElement.querySelector(".multi-cctv-panel")
      : null;
    if (typeof panel?.contains === "function" ? !panel.contains(event.target) : event.target === overlayElement) {
      close();
    }
  });

  return {
    attachSlot,
    availableSlotsCount,
    close,
    destroy() {
      close();
    },
    detachSlot,
    getActiveSlots: () => activeSlots,
    isOpen: () => isOpen,
    open,
  };
}
