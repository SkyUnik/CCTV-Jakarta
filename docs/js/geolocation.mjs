export const INITIAL_LOCATION_OPTIONS = Object.freeze({
  enableHighAccuracy: true,
  maximumAge: 0,
  timeout: 20_000,
});

export const TRACKING_LOCATION_OPTIONS = Object.freeze({
  enableHighAccuracy: true,
  maximumAge: 5_000,
  timeout: 20_000,
});

export async function geolocationPermissionState(permissions) {
  if (!permissions?.query) return "unavailable";
  try {
    const status = await permissions.query({ name: "geolocation" });
    return status?.state ?? "unavailable";
  } catch {
    return "unavailable";
  }
}

export function geolocationFailure(error, environment = {}) {
  if (environment.secureContext === false) {
    return {
      status: "HTTPS diperlukan",
      helper: "Safari hanya mengizinkan GPS pada halaman HTTPS. Buka alamat GitHub Pages, bukan alamat LAN HTTP.",
    };
  }
  if (environment.available === false) {
    return {
      status: "GPS tidak didukung",
      helper: "Browser ini tidak menyediakan akses lokasi. Pilih ruas dan arah secara manual.",
    };
  }
  if (error?.code === 1) {
    if (environment.permissionState === "granted") {
      return {
        status: "GPS diblokir iOS",
        helper: "Izin situs sudah Allow, tetapi iOS tetap menolak lokasi. Buka Settings → Privacy & Security → Location Services → Safari Websites → While Using the App, lalu aktifkan Precise Location. Jika sudah aktif, hapus skyunik.github.io lewat Settings → Apps → Safari → Location → Edit, pilih Ask untuk Other Websites, buka ulang Safari, lalu coba lagi.",
      };
    }
    return {
      status: "Izin GPS ditolak Safari",
      helper: "Safari menolak permintaan lokasi. Buka menu halaman (…) → Pengaturan Situs Web → Lokasi → Tanya atau Izinkan, muat ulang halaman, lalu coba lagi.",
    };
  }
  if (error?.code === 2) {
    return {
      status: "Posisi belum tersedia",
      helper: "iPhone belum memperoleh posisi. Aktifkan Location Services dan coba lagi di area dengan sinyal GPS yang lebih baik.",
    };
  }
  if (error?.code === 3) {
    return {
      status: "GPS terlalu lama",
      helper: "Permintaan lokasi melewati batas waktu. Biarkan Safari tetap terbuka lalu coba lagi.",
    };
  }
  return {
    status: "GPS tidak tersedia",
    helper: "Lokasi belum dapat dibaca. Pilih ruas dan arah secara manual.",
  };
}
