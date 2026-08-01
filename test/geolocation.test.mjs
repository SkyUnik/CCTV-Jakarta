import assert from "node:assert/strict";
import test from "node:test";

import {
  geolocationFailure,
  geolocationPermissionState,
  INITIAL_LOCATION_OPTIONS,
  TRACKING_LOCATION_OPTIONS,
} from "../docs/js/geolocation.mjs";

test("reports insecure origins before generic permission errors", () => {
  const result = geolocationFailure({ code: 1 }, { available: true, secureContext: false });
  assert.match(result.status, /HTTPS/);
  assert.match(result.helper, /GitHub Pages/);
});

test("gives iOS Safari website-setting instructions for permission denial", () => {
  const result = geolocationFailure({ code: 1 }, { available: true, secureContext: true });
  assert.match(result.status, /ditolak Safari/);
  assert.match(result.helper, /Pengaturan Situs Web/);
  assert.match(result.helper, /muat ulang/);
});

test("identifies disabled Safari Location Services behind a granted website permission", () => {
  const result = geolocationFailure(
    { code: 1 },
    { available: true, permissionState: "granted", secureContext: true },
  );
  assert.match(result.status, /Location Services Safari belum aktif/);
  assert.match(result.helper, /Privacy & Security/);
  assert.match(result.helper, /Safari Websites/);
  assert.match(result.helper, /Precise Location/);
  assert.match(result.helper, /Apps → Safari → Location → Edit/);
});

test("reads geolocation permission state without failing unsupported browsers", async () => {
  assert.equal(await geolocationPermissionState(undefined), "unavailable");
  assert.equal(await geolocationPermissionState({ query: async () => ({ state: "granted" }) }), "granted");
  assert.equal(
    await geolocationPermissionState({ query: async () => { throw new Error("unsupported"); } }),
    "unavailable",
  );
});

test("distinguishes unavailable positions and timeouts", () => {
  assert.match(geolocationFailure({ code: 2 }).status, /belum tersedia/);
  assert.match(geolocationFailure({ code: 3 }).status, /terlalu lama/);
});

test("requests a fresh first fix before using cached tracking fixes", () => {
  assert.equal(INITIAL_LOCATION_OPTIONS.maximumAge, 0);
  assert.equal(INITIAL_LOCATION_OPTIONS.enableHighAccuracy, true);
  assert.ok(TRACKING_LOCATION_OPTIONS.maximumAge > 0);
});
