import { viewRegionFor } from "./driving-ui.mjs";
import { createVideoController, isPictureInPictureActive } from "./player.mjs";

export const MAX_LIVE_CONTROLLERS = 4;

export function orderCamerasForJourney(cameras = [], direction = "A") {
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

function escapeKey(event) {
  return event.key === "Escape";
}

function formatKm(km) {
  if (!Number.isFinite(km)) return "KM —";
  const whole = Math.floor(km);
  const meters = Math.round((km - whole) * 1_000);
  return `KM ${String(whole).padStart(2, "0")}+${String(meters).padStart(3, "0")}`;
}

export function createMultiCctvManager({
  closeButton,
  gridElement,
  hlsClass = globalThis.Hls,
  mapElement,
  overlayElement,
  subtitleElement,
  titleElement,
  maxControllers = MAX_LIVE_CONTROLLERS,
  onSelectCamera = () => {},
} = {}) {
  let activeHighway = null;
  let activeDirection = "A";
  let activeCameras = [];
  let currentPosition = null;
  let mapInstance = null;
  let mapLayers = null;
  let isOpen = false;
  let openerButton = null;

  // Active controller slots: Map<cameraId, { card, video, controller, pinned: boolean }>
  const activeSlots = new Map();

  function buildCard(camera, index) {
    const card = document.createElement("article");
    card.className = "multi-cctv-card";
    card.dataset.cameraId = camera.id;
    card.dataset.index = String(index);

    const mediaWrap = document.createElement("div");
    mediaWrap.className = "multi-cctv-media";

    const video = document.createElement("video");
    video.controls = true;
    video.muted = true;
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");
    video.setAttribute("preload", "auto");
    video.src = camera.streamUrl;
    video.setAttribute("aria-label", `Siaran CCTV ${camera.name}`);
    video.className = "multi-cctv-video";

    const playOverlay = document.createElement("div");
    playOverlay.className = "multi-cctv-play-overlay";

    const playIcon = document.createElement("div");
    playIcon.className = "multi-cctv-play-icon";
    playIcon.textContent = "▶";
    playIcon.setAttribute("aria-hidden", "true");

    playOverlay.append(playIcon);
    mediaWrap.append(video, playOverlay);

    // Region overlay if configured
    const region = viewRegionFor(camera, activeDirection);
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

    const titleGroup = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = camera.name;
    const meta = document.createElement("span");
    meta.className = "meta";
    meta.textContent = `${formatKm(camera.km)} • Arah ${activeDirection}`;
    titleGroup.append(name, meta);

    const liveBadge = document.createElement("span");
    liveBadge.className = "multi-cctv-badge";
    liveBadge.textContent = "STANDBY";

    footer.append(titleGroup, liveBadge);
    card.append(mediaWrap, footer);

    card.addEventListener("click", () => {
      if (activeSlots.has(camera.id)) {
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
    slot.controller?.destroy({ clearSource: false, preservePip: false });
    const playOverlay = slot.card.querySelector(".multi-cctv-play-overlay");
    if (playOverlay) {
      playOverlay.hidden = false;
      playOverlay.style.display = "flex";
    }
    const badge = slot.card.querySelector(".multi-cctv-badge");
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
        badge.classList.add("is-live");
      }
      video?.play?.()?.catch?.(() => {});
    };

    if (video) {
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
          badge.classList.remove("is-live");
        }
      },
    });

    controller.load(camera, { continuePlaying: true });
    revealVideo();

    activeSlots.set(camera.id, {
      camera,
      card,
      controller,
      pinned: false,
      video,
    });
  }

  function initMap(highway, cameras, position) {
    const leaflet = globalThis.L;
    if (!leaflet?.map || !mapElement) return;

    if (!mapInstance) {
      mapInstance = leaflet.map(mapElement, {
        attributionControl: false,
        zoomControl: true,
        scrollWheelZoom: true,
      });
      leaflet.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
      }).addTo(mapInstance);
      mapLayers = leaflet.featureGroup().addTo(mapInstance);
    }

    mapLayers.clearLayers();
    if (highway?.geometry?.coordinates) {
      const latLngs = highway.geometry.coordinates.map(([lon, lat]) => [lat, lon]);
      leaflet.polyline(latLngs, {
        color: "#22614f",
        weight: 6,
        opacity: 0.95,
        lineCap: "round",
        lineJoin: "round",
      }).addTo(mapLayers);
    }

    for (let i = 0; i < cameras.length; i += 1) {
      const cam = cameras[i];
      if (Array.isArray(cam.coordinates) && cam.coordinates.length >= 2) {
        const [lon, lat] = cam.coordinates;
        const icon = leaflet.divIcon({
          className: "camera-map-icon is-mini",
          html: `<span>${i + 1}</span>`,
          iconSize: [24, 24],
          iconAnchor: [12, 12],
        });
        leaflet.marker([lat, lon], {
          icon,
          title: `${i + 1}. ${cam.name} (${formatKm(cam.km)})`,
        }).addTo(mapLayers);
      }
    }

    if (position && Number.isFinite(position.latitude) && Number.isFinite(position.longitude)) {
      const gpsIcon = leaflet.divIcon({
        className: "gps-map-pin",
        iconSize: [16, 16],
        iconAnchor: [8, 8],
      });
      leaflet.marker([position.latitude, position.longitude], {
        icon: gpsIcon,
        title: "Posisi Kendaraan",
      }).addTo(mapLayers);
    }

    const bounds = mapLayers.getBounds();
    if (bounds?.isValid?.()) {
      requestAnimationFrame(() => {
        mapInstance.invalidateSize({ pan: false });
        mapInstance.fitBounds(bounds, { padding: [20, 20], maxZoom: 14 });
      });
    }
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

  function open({ highway, direction = "A", cameras = [], position = null, opener = null } = {}) {
    if (isOpen) return;
    isOpen = true;
    openerButton = opener;
    activeHighway = highway;
    activeDirection = direction;
    currentPosition = position;
    activeCameras = orderCamerasForJourney(cameras, direction);

    document?.body?.classList?.add("multi-cctv-open");
    overlayElement.hidden = false;

    if (titleElement) {
      titleElement.textContent = highway?.properties?.name ?? "Ruas Tol Jakarta";
    }
    if (subtitleElement) {
      const dirText = direction === "A"
        ? (highway?.properties?.directionA ?? "Arah A")
        : (highway?.properties?.directionB ?? "Arah B");
      subtitleElement.textContent = `Arah ${direction} (${dirText}) • ${activeCameras.length} CCTV Berurutan`;
    }

    if (gridElement) {
      gridElement.replaceChildren();
      if (activeCameras.length === 0) {
        const emptyNotice = document.createElement("p");
        emptyNotice.className = "multi-cctv-empty";
        emptyNotice.textContent = "Belum ada CCTV terverifikasi untuk arah perjalanan ini.";
        gridElement.append(emptyNotice);
      } else {
        for (let i = 0; i < activeCameras.length; i += 1) {
          const card = buildCard(activeCameras[i], i);
          gridElement.append(card);
        }
      }
    }

    initMap(activeHighway, activeCameras, currentPosition);
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
        slot.controller?.destroy({ clearSource: false, preservePip: false });
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
      if (mapInstance) {
        mapInstance.remove();
        mapInstance = null;
      }
    },
    detachSlot,
    getActiveSlots: () => activeSlots,
    isOpen: () => isOpen,
    open,
  };
}
