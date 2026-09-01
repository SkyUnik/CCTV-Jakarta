# Jakarta Toll CCTV Player

A privacy-first, location-aware CCTV player for Jakarta toll roads. The website
will run entirely in the browser and will be deployable as a static GitHub Pages
site from the `docs/` directory.

The committed dataset supports four corridors:

- Tol Dalam Kota (Cawang–Pluit)
- 6 Tol Dalam Kota (Kelapa Gading–Pulo Gebang)
- Akses Tanjung Priok
- Jakarta–Bogor–Ciawi (Jagorawi)

Every corridor uses the same direction convention:

- **A** — travelling with increasing stationing, away from the corridor's KM 0
- **B** — travelling with decreasing stationing, toward the corridor's KM 0

## Project layout

```text
docs/         Static GitHub Pages website
  data/       Manually reviewed highway and CCTV metadata
  vendor/     Pinned browser libraries and their licenses
scripts/      Safe, public-page-only data collection and preparation tools
test/         Automated tests and saved public-page fixtures
```

## Safety and privacy boundaries

- Coordinates from the Geolocation API stay in browser memory and are never
  stored, logged, or uploaded by this project. The online map requests standard
  OpenStreetMap tiles for the visible viewport, so the requested tile area can
  reveal an approximate location to the OpenStreetMap Foundation.
- The data collector may read only public Bina Marga CCTV web pages. It must not
  probe hidden endpoints, bypass access controls, scan ports, or download video
  segments.
- Reviewed road geometry remains committed as static GeoJSON; visitors never
  query Overpass, Nominatim, or the OSM editing API. The interactive basemap
  loads only the tiles currently visible from `tile.openstreetmap.org`, with no
  prefetch, bulk download, offline cache, proxy, or API key.
- The project has no backend, proxy, database, analytics, or API keys.
- Automatic playback accepts either surveyed/reviewed coordinates or an
  explicitly audited `provisional_stationing` record. Provisional records must
  have an A/B suffix from the provider and retain a warning that their
  coordinate was interpolated from KM stationing rather than surveyed.

## Data editing

Raw camera metadata is written to `docs/data/cameras.scraped.json`. The reviewed
website dataset lives in `docs/data/cameras.json`. Scraped values such as the provider ID, label, and public HLS
URL are kept separate from editorial fields such as coordinates, A/B side,
enabled state, and review status. Future scraper runs must preserve those
editorial fields when `--merge` is used.

Highway definitions will live in `docs/data/highways.geojson`. Coordinates use
GeoJSON order: `[longitude, latitude]`.

### Local camera audit app

Run the write-capable audit UI only on the local machine:

```sh
npm run admin
```

Open `http://127.0.0.1:4175/admin/`. The service binds only to loopback and the
admin assets are outside `docs/`, so GitHub Pages remains read-only. The UI can
create, edit, verify, and hard-delete camera records; preview a public stream;
and drag/resize the red A/B road region stored as normalized `viewRegions`.

Saving changes never commits or pushes. The checkpoint panel runs the test
suite and shows the allowlisted camera-data diff. Commit and push are separate,
explicit actions. Commit is refused while any tracked file outside
`docs/data/cameras.json` is dirty.

Changing a verified camera's stream, road, direction, or coordinates
automatically disables it and returns it to `needs_review`. Use the verify
action or the existing `camera:verify`/`camera:verify-gate` commands after
checking a public source.

### Programmatic geography candidates

Another agent can produce a sourced OSM review report without editing camera
data:

```sh
npm run camera:locate -- --id CAMERA_ID
```

The command builds searches from the provider name, road, and KM metadata;
queries public Nominatim and nearby Overpass toll/surveillance landmarks;
projects candidates onto the committed road geometry; and writes a ranked
report to `.review/<camera-id>-candidates.json`. Public responses are cached in
`.review/osm-cache/`. A candidate is never called a verified CCTV coordinate
and is never applied or enabled automatically.

Highway definitions are configured in `data-source/highways.config.json`. Each
entry pins its reviewed OSM source, directed start/end nodes, labels, and GPS
thresholds. The browser receives only the generated static GeoJSON and never
queries OSM. Rebuild every configured corridor from the committed snapshots:

```sh
npm run highway:build
```

The current canonical paths are approximately 19.6 km Cawang–Pluit, 7.3 km
Kelapa Gading–Pulo Gebang, 11.1 km Akses Tanjung Priok, and 46.7 km Jagorawi.

The browser projects each GPS fix onto every segment of this curved LineString.
It rejects accuracy worse than 100 m and accepts a road only inside a threshold
of `max(60 m, 1.5 × accuracy)`, capped at 150 m. Camera passing requires two
consecutive fixes at least 75 m beyond the camera position.

## Public CCTV collector

Install the pinned dependency, then collect one public road page:

```sh
npm install
npm run scrape -- --road dalam-kota --out docs/data/cameras.scraped.json
```

To refresh provider-controlled fields without losing manually reviewed fields:

```sh
npm run scrape -- \
  --road dalam-kota \
  --out docs/data/cameras.json \
  --merge docs/data/cameras.json
```

The collector makes exactly one request per invocation, only to the public Bina
Marga `cctv_tol` page selected by `--road`. It does not request playlists,
video segments, administrative endpoints, or other hosts.

The same command accepts the other committed Bina Marga slugs:

```sh
npm run scrape -- --road 6-tol-dalam-kota-kelapa-gading-pulo-gebang --out docs/data/cameras.json --merge docs/data/cameras.json
npm run scrape -- --road akses-tanjung-priok --out docs/data/cameras.json --merge docs/data/cameras.json
npm run scrape -- --road jakarta-bogor-ciawi --out docs/data/cameras.json --merge docs/data/cameras.json
```

The current aggregate contains 94 provider records: 26 Cawang–Pluit, 9 Kelapa
Gading–Pulo Gebang, 31 Akses Tanjung Priok, and 28 Jagorawi. Records lacking
an explicit provider A/B direction remain disabled for automatic GPS switching.
They are still available through the site's manual camera picker after choosing
a road and direction.

### Provisional automatic cameras

The public Bina Marga pages expose camera labels, KM stationing, A/B suffixes,
and streams, but not surveyed camera coordinates. With explicit project-owner
approval, `camera:provision` interpolates only explicitly directed A/B records
along the committed OSM road geometry:

```sh
npm run camera:provision
```

The command records both the public camera-label source and OSM geometry source
inside `locationReview`, uses `curationStatus: "provisional_stationing"`, and
does not call the result `verified`. Records without KM or A/B stay disabled.
The current data has 46 eligible provider records representing 44 distinct
automatic road/side positions; same-side duplicates at one station are skipped
during automatic ordering. A later manual coordinate review supersedes the
provisional record through `camera:verify`.

### Append another public HLS camera

Use the helper instead of hand-editing JSON when adding one camera from another
public page:

```sh
npm run camera:add -- \
  --file docs/data/cameras.json \
  --road dalam-kota \
  --name "Provider camera name" \
  --url "https://provider.example/live/camera.m3u8" \
  --source-page "https://provider.example/public-camera-page" \
  --side A \
  --km 8.0
```

The command accepts only HTTPS URLs whose path ends in `.m3u8`, refuses
duplicate IDs and stream URLs, and always appends the record disabled with
`needs_review`. It remains manual unless it receives either a surveyed review
or an explicitly audited provisional stationing record.

After checking a camera location against its provider or another authoritative
source, record that review and calculate its curved-road position with:

```sh
npm run camera:verify -- \
  --id public-dalam-kota-manual-example \
  --side A \
  --longitude 106.8000 \
  --latitude -6.2000 \
  --notes "Checked against the provider map"
```

The verification command refuses coordinates more than 150 m from the highway.
Only this explicit review step enables a camera for automatic playback.

Run the tests with:

```sh
npm test
```

## Local preview

Start the included static server from the repository root:

```sh
npm run serve
```

Then open `http://127.0.0.1:4173/`. Opening `index.html` directly with a `file:`
URL is not supported because browsers apply different location and module
security rules.

The normal preview uses only cameras marked `enabled: true` and
`curationStatus: "verified"`. For interface testing before camera coordinates
are curated, open `http://127.0.0.1:4173/?demo=1`. Demo mode clearly identifies
itself, uses synthetic road positions, and must not be used for navigation or
driving decisions.

The map uses locally vendored Leaflet code and loads only the visible raster
tiles from `tile.openstreetmap.org`. Road lines and estimated CCTV positions
come from the committed local data. To review the no-basemap fallback locally,
open `http://127.0.0.1:4173/?tileFail=1`; the road, CCTV, and GPS overlays remain
available over a plain background. Combine it with demo mode using
`http://127.0.0.1:4173/?demo=1&tileFail=1`.

### iPhone Safari player

On iOS 17.1 and newer, the pinned HLS.js player uses Managed Media Source when
the browser and stream codecs support it. Camera changes transfer the existing
MediaSource before loading the next playlist, so automatic switching does not
clear the `<video>` element or recreate its full-screen/Picture-in-Picture
geometry. Streams that cannot run through HLS.js fall back to Safari native HLS.

After selecting a road and direction, wait until **Buka pemutar video layar
penuh** is enabled and tap it. Playback and full-screen entry begin from the
same user gesture. The video remains muted initially and keeps native controls,
inline playback, Picture-in-Picture, and AirPlay affordances where Safari makes
them available.

The hot-swap guarantee is scoped to iOS 17.1 and newer. Older Safari versions
retain native HLS playback but require separate physical-device validation.

### Check public stream compatibility

Run the conservative playlist-only check whenever cameras are refreshed or
appended:

```sh
npm run streams:check -- --out docs/data/stream-compatibility.json
```

The check requests each unique public `.m3u8` once, sequentially, with a GitHub
Pages-style Origin header. It does not request media segments. The generated
report records valid HLS syntax, CORS behavior, MIME type, Safari-native
candidacy, and HLS.js candidacy. Provider availability is temporary, so rerun
the check before publishing rather than treating an old result as a guarantee.

The current Jasa Marga service serves valid HLS playlists as `text/plain`, not
the conventional HLS MIME type, and its CORS response can vary between streams.
For that reason iPhone Safari's native path is the priority and the direct
stream link remains visible when browser playback fails.

A physical-device acceptance checklist is provided at
`test/IOS_SAFARI_CHECKLIST.md`. That final device pass is intentionally separate
from desktop responsive testing because only a real iPhone can prove the native
system player, GPS radio behavior, rotation, backgrounding, and cellular data.

## GitHub Pages

After the finished files are pushed to GitHub:

1. Open the repository's **Settings → Pages**.
2. Select **Deploy from a branch**.
3. Select the `main` branch and `/docs` folder.
4. Save and wait for the published URL.

All website paths must remain relative so the site also works at a project URL
such as `https://username.github.io/repository/`.

To reproduce a project-subpath preview locally:

```sh
BASE_PATH=/CCTV-Jakarta PORT=4174 npm run serve
```

Then open `http://127.0.0.1:4174/CCTV-Jakarta/`.

To test the video player from an iPhone on the same Wi-Fi or Personal Hotspot,
run:

```sh
npm run serve:lan
```

Use the printed **iPhone demo** URL. Never replace its address with `localhost`
or `127.0.0.1`: on the phone those addresses refer to the phone itself, not the
Mac. macOS may ask for permission to accept incoming connections.

The LAN preview uses plain HTTP and is suitable only for `?demo=1` player
testing. Browser geolocation is a secure-context feature, so real GPS testing
must use the published HTTPS GitHub Pages URL (or another trusted HTTPS local
setup).

### iPhone GPS permission troubleshooting

The Start button first calls `getCurrentPosition()` directly from the tap, then
starts `watchPosition()` only after Safari returns an initial fix. If Safari
returns permission error 1 without showing a prompt:

1. Open the published HTTPS page in a normal (non-private) Safari tab.
2. Open Safari's page menu (…) and set the site's **Location** permission to
   **Ask** or **Allow** under Website Settings.
3. In **Settings → Apps → Safari → Location**, select **Ask** or **Allow**.
4. Confirm **Settings → Privacy & Security → Location Services** is enabled.
5. Open **Safari Websites** there, select **While Using the App**, and enable
   **Precise Location**.
6. Reload the page before pressing **Mulai CCTV** again.

The page cannot reopen an iOS prompt after Safari has stored a site-level Deny;
that decision must be changed in Safari's settings first.

For an isolated test, open `docs/gps-test.html` through the deployed site. It
calls the browser Geolocation API directly with no application modules or
network requests and reports the secure-context flag, Permissions API state,
error code, and browser error message. The main interface links to this test
automatically after a GPS failure.

## Data attribution

- CCTV names and public stream URLs: Direktorat Jenderal Bina Marga, Kementerian
  Pekerjaan Umum, and the relevant toll-road operator.
- Road geometry: © OpenStreetMap contributors, available under the Open Database
  License. The exact source snapshot and relation identifiers will be recorded
  with the committed GeoJSON.

## Development checkpoints

The project is implemented in reviewed buckets:

1. Clean foundation
2. Safe CCTV scraper and editable JSON
3. Highway geometry and location matching
4. Player interface and automatic switching
5. Compatibility validation and GitHub Pages handoff

Work stops after each bucket for review before the next bucket begins.
