import { createVideoController } from "/site/js/player.mjs";

const $ = (selector) => document.querySelector(selector);
const elements = {
  cameraCount: $("#camera-count"), cameraForm: $("#camera-form"), cameraId: $("#camera-id"),
  cameraList: $("#camera-list"), cameraName: $("#camera-name"), cameraKm: $("#camera-km"),
  cameraSide: $("#camera-side"), commit: $("#commit"), commitMessage: $("#commit-message"),
  commandOutput: $("#command-output"), curationStatus: $("#curation-status"), deleteCamera: $("#delete-camera"),
  enabled: $("#enabled"), gitDiff: $("#git-diff"), gitSummary: $("#git-summary"), highwayId: $("#highway-id"),
  latitude: $("#latitude"), longitude: $("#longitude"), newCamera: $("#new-camera"), notes: $("#notes"),
  providerId: $("#provider-id"), push: $("#push"), redRegion: $("#red-region"), refreshGit: $("#refresh-git"),
  regionConfirm: $("#region-confirm"), regionDirection: $("#region-direction"), regionLabel: $("#region-label"),
  regionLeft: $("#region-left"), regionRight: $("#region-right"), roadFilter: $("#road-filter"),
  runTests: $("#run-tests"), saveState: $("#save-state"), search: $("#search"), sourcePage: $("#source-page"),
  statusFilter: $("#status-filter"), streamUrl: $("#stream-url"), video: $("#audit-video"), videoStage: $("#video-stage"),
  verifyCamera: $("#verify-camera"),
};

const state = { cameras: [], current: null, highways: [], nonce: "", regions: {}, videoController: null };
state.videoController = createVideoController({ video: elements.video, hlsClass: window.Hls });

function defaultRegion(direction) {
  return direction === "B"
    ? { x: .5, y: 0, width: .5, height: 1, status: "inferred" }
    : { x: 0, y: 0, width: .5, height: 1, status: "inferred" };
}

function activeRegion() {
  const direction = elements.regionDirection.value;
  state.regions[direction] ??= defaultRegion(direction);
  return state.regions[direction];
}

function renderRegion() {
  const region = activeRegion();
  Object.assign(elements.redRegion.style, {
    left: `${region.x * 100}%`, top: `${region.y * 100}%`,
    width: `${region.width * 100}%`, height: `${region.height * 100}%`,
  });
  elements.redRegion.dataset.status = region.status;
  elements.regionConfirm.textContent = region.status === "confirmed" ? "Area confirmed" : "Konfirmasi area";
  elements.regionLabel.textContent = state.highways.find((road) => road.id === elements.highwayId.value)?.name ?? "Ruas";
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.method && options.method !== "GET" ? { "X-Admin-Nonce": state.nonce } : {}),
      ...options.headers,
    },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
  return body;
}

function setBusy(message = "") { elements.saveState.textContent = message; }
function valueOrNull(element) { return element.value.trim() === "" ? null : Number(element.value); }

function filteredCameras() {
  const query = elements.search.value.trim().toLowerCase();
  return state.cameras.filter((camera) => {
    if (elements.roadFilter.value && camera.highwayId !== elements.roadFilter.value) return false;
    if (elements.statusFilter.value && camera.curationStatus !== elements.statusFilter.value) return false;
    if (!query) return true;
    return [camera.id, camera.name, camera.providerCameraId, camera.highwayId]
      .some((value) => String(value ?? "").toLowerCase().includes(query));
  });
}

function renderCameraList() {
  const cameras = filteredCameras();
  elements.cameraCount.textContent = `${cameras.length} dari ${state.cameras.length} kamera`;
  elements.cameraList.replaceChildren(...cameras.map((camera) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "camera-item";
    button.setAttribute("aria-pressed", String(camera.id === state.current?.id));
    const title = document.createElement("strong");
    const detail = document.createElement("span");
    title.textContent = camera.name;
    detail.textContent = `${camera.highwayId} • ${camera.side ?? camera.directions?.join("/") ?? "?"} • ${camera.curationStatus}`;
    button.append(title, detail);
    button.addEventListener("click", () => selectCamera(camera));
    return button;
  }));
}

function setForm(camera) {
  elements.cameraId.value = camera?.id ?? "(dibuat otomatis)";
  elements.providerId.value = camera?.providerCameraId ?? "";
  elements.providerId.readOnly = Boolean(camera?.providerCameraId);
  elements.cameraName.value = camera?.name ?? "";
  elements.streamUrl.value = camera?.streamUrl ?? "";
  elements.sourcePage.value = camera?.sourcePage ?? "";
  elements.highwayId.value = camera?.highwayId ?? state.highways[0]?.id ?? "";
  elements.cameraKm.value = camera?.km ?? "";
  elements.cameraSide.value = camera?.side ?? "";
  elements.curationStatus.value = camera?.curationStatus ?? "needs_review";
  elements.longitude.value = camera?.coordinates?.[0] ?? "";
  elements.latitude.value = camera?.coordinates?.[1] ?? "";
  elements.enabled.checked = Boolean(camera?.enabled);
  elements.notes.value = camera?.notes ?? "";
  state.regions = structuredClone(camera?.viewRegions ?? {});
  elements.regionDirection.value = camera?.side ?? "A";
  renderRegion();
  elements.deleteCamera.disabled = !camera;
  elements.verifyCamera.disabled = !camera;
  if (camera?.streamUrl) state.videoController.load(camera);
  else state.videoController.destroy();
}

function selectCamera(camera) {
  state.current = camera;
  setForm(camera);
  renderCameraList();
  setBusy("");
}

function formCamera() {
  const base = state.current ? structuredClone(state.current) : {};
  return {
    ...base,
    id: state.current?.id ?? "",
    providerCameraId: state.current?.providerCameraId ?? (elements.providerId.value.trim() || null),
    name: elements.cameraName.value,
    streamUrl: elements.streamUrl.value,
    sourcePage: elements.sourcePage.value || null,
    highwayId: elements.highwayId.value,
    km: valueOrNull(elements.cameraKm),
    side: elements.cameraSide.value || null,
    coordinates: elements.longitude.value && elements.latitude.value
      ? [Number(elements.longitude.value), Number(elements.latitude.value)]
      : null,
    enabled: elements.enabled.checked,
    notes: elements.notes.value,
    viewRegions: structuredClone(state.regions),
  };
}

async function reload({ selectId = state.current?.id } = {}) {
  const body = await api("/api/admin/state");
  state.nonce = body.nonce;
  state.cameras = body.cameras;
  state.highways = body.highways;
  elements.highwayId.replaceChildren(...state.highways.map((road) => new Option(road.name, road.id)));
  elements.roadFilter.replaceChildren(new Option("Semua ruas", ""), ...state.highways.map((road) => new Option(road.name, road.id)));
  renderGit(body.git);
  const selected = state.cameras.find((camera) => camera.id === selectId) ?? state.cameras[0] ?? null;
  state.current = selected;
  setForm(selected);
  renderCameraList();
}

function renderGit(git) {
  elements.gitSummary.textContent = `Branch ${git.branch || "detached"} • ${git.trackedChanges.length} tracked changes`;
  elements.gitDiff.textContent = git.diff || "Tidak ada perubahan camera data.";
  if (git.outsideAllowlist.length) {
    elements.gitSummary.textContent += ` • commit diblokir oleh: ${git.outsideAllowlist.map((item) => item.path).join(", ")}`;
  }
}

function installRegionDrag() {
  let drag = null;
  elements.redRegion.addEventListener("pointerdown", (event) => {
    const region = activeRegion();
    drag = {
      mode: event.target === elements.redRegion.querySelector("i") ? "resize" : "move",
      startX: event.clientX, startY: event.clientY, original: { ...region },
    };
    elements.redRegion.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  elements.redRegion.addEventListener("pointermove", (event) => {
    if (!drag) return;
    const rect = elements.videoStage.getBoundingClientRect();
    const dx = (event.clientX - drag.startX) / rect.width;
    const dy = (event.clientY - drag.startY) / rect.height;
    const region = activeRegion();
    if (drag.mode === "move") {
      region.x = Math.max(0, Math.min(1 - region.width, drag.original.x + dx));
      region.y = Math.max(0, Math.min(1 - region.height, drag.original.y + dy));
    } else {
      region.width = Math.max(.1, Math.min(1 - region.x, drag.original.width + dx));
      region.height = Math.max(.1, Math.min(1 - region.y, drag.original.height + dy));
    }
    region.status = "inferred";
    renderRegion();
  });
  elements.redRegion.addEventListener("pointerup", () => { drag = null; });
}

elements.cameraForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    setBusy("Menyimpan…");
    const result = await api("/api/admin/cameras", {
      method: "POST", body: JSON.stringify({ originalId: state.current?.id ?? null, camera: formCamera() }),
    });
    await reload({ selectId: result.camera.id });
    setBusy("Tersimpan lokal • belum commit");
  } catch (error) { setBusy(error.message); }
});
elements.newCamera.addEventListener("click", () => { state.current = null; setForm(null); renderCameraList(); });
elements.deleteCamera.addEventListener("click", async () => {
  if (!state.current) return;
  const confirmation = prompt(`Hard delete tidak membuat tombstone. Ketik ID berikut:\n${state.current.id}`);
  if (confirmation == null) return;
  try {
    await api(`/api/admin/cameras/${encodeURIComponent(state.current.id)}`, {
      method: "DELETE", body: JSON.stringify({ confirmation }),
    });
    state.current = null;
    await reload({ selectId: null });
    setBusy("Kamera dihapus lokal • belum commit");
  } catch (error) { setBusy(error.message); }
});
elements.verifyCamera.addEventListener("click", async () => {
  if (!state.current) return;
  try {
    const result = await api(`/api/admin/cameras/${encodeURIComponent(state.current.id)}/verify`, {
      method: "POST",
      body: JSON.stringify({
        side: elements.cameraSide.value,
        longitude: elements.longitude.value,
        latitude: elements.latitude.value,
        notes: elements.notes.value,
      }),
    });
    await reload({ selectId: result.camera.id });
    setBusy(`Verified • ${Math.round(result.projection.distanceM)} m dari geometri`);
  } catch (error) { setBusy(error.message); }
});

for (const element of [elements.search, elements.roadFilter, elements.statusFilter]) {
  element.addEventListener("input", renderCameraList);
}
elements.highwayId.addEventListener("change", renderRegion);
elements.regionDirection.addEventListener("change", renderRegion);
elements.regionLeft.addEventListener("click", () => { state.regions[elements.regionDirection.value] = defaultRegion("A"); renderRegion(); });
elements.regionRight.addEventListener("click", () => { state.regions[elements.regionDirection.value] = defaultRegion("B"); renderRegion(); });
elements.regionConfirm.addEventListener("click", () => { activeRegion().status = "confirmed"; renderRegion(); });
elements.streamUrl.addEventListener("change", () => {
  if (elements.streamUrl.validity.valid && elements.streamUrl.value) {
    state.videoController.load({ streamUrl: elements.streamUrl.value });
  }
});
elements.refreshGit.addEventListener("click", async () => renderGit(await api("/api/admin/git")));
elements.runTests.addEventListener("click", async () => {
  elements.commandOutput.textContent = "Menjalankan npm test…";
  try { elements.commandOutput.textContent = (await api("/api/admin/validate", { method: "POST", body: "{}" })).output; }
  catch (error) { elements.commandOutput.textContent = error.message; }
});
elements.commit.addEventListener("click", async () => {
  if (!confirm("Commit hanya camera data setelah diff dan tests direview. Lanjutkan?")) return;
  try {
    renderGit(await api("/api/admin/commit", { method: "POST", body: JSON.stringify({ message: elements.commitMessage.value, confirmed: true }) }));
  } catch (error) { elements.commandOutput.textContent = error.message; }
});
elements.push.addEventListener("click", async () => {
  if (!confirm("Push current branch ke origin sekarang?")) return;
  try { elements.commandOutput.textContent = `Pushed ${(await api("/api/admin/push", { method: "POST", body: JSON.stringify({ confirmed: true }) })).branch}`; }
  catch (error) { elements.commandOutput.textContent = error.message; }
});

installRegionDrag();
reload().catch((error) => { elements.commandOutput.textContent = error.message; });
