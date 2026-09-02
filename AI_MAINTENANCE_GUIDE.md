# AI Maintenance Guide

Use this playbook when updating roads or cameras. It is the canonical procedure; do not repeat broad research when the road configuration and provider source already exist.

## Safety boundary

- Fetch only the public Bina Marga road page and public `.m3u8` manifest. Never probe hidden endpoints, bypass authentication, scan ports, or download video segments.
- Preserve editorial fields during scraper merges. New and ambiguous cameras remain `enabled: false` with `curationStatus: "needs_review"`.
- Never guess camera coordinates. Record a stable public source and the review metadata.
- GPS stays in the browser. Do not add it to URLs, logs, storage, analytics, or application requests.

## Routine camera refresh

1. Create a review artifact first with `npm run scrape -- --road <slug> --out .review/<slug>.json --merge docs/data/cameras.json`.
2. Review additions, removals, URL changes, duplicate provider IDs, KM parsing, and A/B parsing. A provider may rotate every `.m3u8` URL at once; confirm that stable provider IDs still map to the same labels before accepting it.
3. Apply an accepted refresh with `npm run scrape -- --road <slug> --out docs/data/cameras.json --merge docs/data/cameras.json`. The scraper preserves `side`, `directions`, `cameraType`, coordinates, route position, enablement, curation status, notes, and location review.
4. Keep the aggregate camera order stable when only one road is refreshed so the diff shows provider changes instead of unrelated JSON movement. Confirm that other roads and all editorial fields are semantically unchanged.
5. Check manifests with `npm run streams:check -- --out docs/data/stream-compatibility.json`; do not fetch media segments. Treat the report as a time-limited pre-publish check, not a permanent availability guarantee.
6. Run focused tests, then one `npm test`. Commit and push are separate review actions and require checkpoint approval.

For Tol Dalam Kota (Cawang–Pluit), `<slug>` is `dalam-kota`. Refreshing this road should update the `sources` entry and the `scrapedAt` value of its provider records. A URL-only rotation must not alter provider camera IDs, labels, curation, direction review, coordinates, or enablement.

## Local audit UI

- Start it with `npm run admin`; it must remain bound to `127.0.0.1` and must
  never be copied into the GitHub Pages `docs/` output.
- Save, validation, diff, commit, and push are separate actions. The Git helper
  may stage only `docs/data/cameras.json` and must refuse unrelated tracked
  changes.
- Provider camera IDs and camera IDs are stable identities. A stream, road,
  direction, or coordinate change disables the camera and returns it to
  `needs_review` until verification succeeds.
- Hard delete intentionally leaves no tombstone, so a later provider scrape can
  rediscover the same stable provider ID. Use it only after confirming the
  exact ID in the UI.

## Player and multi-CCTV invariants

- Keep Picture-in-Picture available on every video element. Never add `disablepictureinpicture`.
- Automatic camera changes must preserve the existing video element and active PiP/full-screen geometry. Do not clear `src` or call `video.load()` before the replacement source is set. Reuse the HLS.js instance and transfer its media attachment when supported.
- Set native `src` and `preload` synchronously before playback or full-screen calls made from a user gesture. Standby multi-CCTV cards keep the stream URL eagerly assigned with `preload="metadata"`; active cards switch to `preload="auto"`.
- Multi-CCTV cards use native video controls without a custom play text or play overlay. Preserve `object-fit: contain`, the black video background, the 300 px card minimum, and the 250 px media/video minimum-height fallback unless a reviewed design change replaces them across desktop and mobile.
- Preserve the current ordering contract: toll gates are grouped first; ordinary journey cameras follow KM order, ascending for A and descending for B. Wide-view cameras may serve both directions through `directions: ["A", "B"]`.
- Keep the live-controller limit and never evict a stream that is active in PiP. Detaching an ordinary card may destroy its controller, but must restore its metadata thumbnail source.
- When deployed CSS or JavaScript changes, bump the matching cache-busting query tokens in `docs/index.html`.
- Player work requires unit/integration coverage for destroy + load lifecycle, HLS.js instance reuse/swapping, PiP-safe automatic switching, and synchronous user-gesture playback. Multi-CCTV changes also require ordering, controller-limit, detach/restore, and layout-invariant coverage.

## Programmatic location candidates

Run `npm run camera:locate -- --id <camera-id>` to generate an OSM candidate
report under `.review/`. The tool may query public Nominatim and Overpass,
records exact OSM element URLs and projection distances, and never edits or
enables camera data. A road landmark is evidence for review, not proof of the
physical CCTV mounting point.

## Toll-gate cameras without KM

Treat labels matching `GT`, `GERBANG TOL`, or `GARDU TOL` as toll-gate candidates, never as automatically verified cameras.

1. Find the named public toll-gate landmark. Prefer an OpenStreetMap element tagged `barrier=toll_booth`; corroborate its name and road context.
2. Save the exact public element URL and coordinates. A landmark coordinate is provisional and is not claimed to be the surveyed CCTV mounting point.
3. Project it onto the canonical local road geometry:

   `npm run camera:verify-gate -- --id <camera-id> --longitude <lon> --latitude <lat> --source-url <public-url> --osm-node <node-id>`

4. The command creates one `cameraType: "toll_gate"` record usable in both directions through `directions: ["A", "B"]`. Keep `side: null`; do not duplicate the record.
5. The normal maximum projection distance is the road's `maxMatchRadiusM` (usually 150 m). A larger distance must stop review. Only after explicit human approval rerun with `--allow-distant-projection`; the permanent warning and measured distance must remain in `locationReview`.
6. Confirm the gate appears on the map at the public landmark coordinate and in automatic A/B route ordering at the projected `roadPositionM`.

## Adding a new road

Complete its provider slug, public source page, local OSM source/snapshot, canonical LineString direction, KM-zero definition, A/B labels, matching limits, and stationing anchors before scraping or enabling cameras. If any field is unknown, create a review template and stop instead of guessing.

## Review checklist

- Automatic lists include only verified stationing cameras or explicitly approved provisional landmarks.
- A means away from KM 0; B means toward KM 0.
- Route ordering, reverse ordering, hysteresis, map grouping, and unlocated counts pass tests.
- Test iOS Safari permission, native HLS, user-gesture fullscreen, denied GPS fallback, and route end behavior.
- Confirm no analytics/CDN/location upload was introduced. OSM tile requests disclose viewport area as documented by the UI.
- Review the diff, then commit, push, wait for GitHub Pages, and smoke-test the public URL once.
