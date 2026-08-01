# Jakarta Toll CCTV Player

A privacy-first, location-aware CCTV player for Jakarta toll roads. The website
will run entirely in the browser and will be deployable as a static GitHub Pages
site from the `docs/` directory.

The first supported corridor is **Tol Dalam Kota**. Its direction convention is:

- **A** — travelling away from KM 0 at Cawang
- **B** — travelling toward KM 0 at Cawang

## Project layout

```text
docs/         Static GitHub Pages website
  data/       Manually reviewed highway and CCTV metadata
  vendor/     Pinned browser libraries and their licenses
scripts/      Safe, public-page-only data collection and preparation tools
test/         Automated tests and saved public-page fixtures
```

## Safety and privacy boundaries

- Browser location stays on the user's device. It is not stored, logged, or sent
  to this project or to a map service.
- The data collector may read only public Bina Marga CCTV web pages. It must not
  probe hidden endpoints, bypass access controls, scan ports, or download video
  segments.
- Visitors never query OpenStreetMap or Overpass at runtime. Reviewed road
  geometry is committed as static GeoJSON.
- The project has no backend, proxy, database, analytics, or API keys.
- A camera cannot be used for automatic playback until its direction and
  coordinates have been manually verified.

## Data editing

Raw camera metadata is written to `docs/data/cameras.scraped.json`. The reviewed
website dataset lives in `docs/data/cameras.json`. Scraped values such as the provider ID, label, and public HLS
URL are kept separate from editorial fields such as coordinates, A/B side,
enabled state, and review status. Future scraper runs must preserve those
editorial fields when `--merge` is used.

Highway definitions will live in `docs/data/highways.geojson`. Coordinates use
GeoJSON order: `[longitude, latitude]`.

The committed Tol Dalam Kota geometry is a directed 19.6 km OSM path from the
pinned Cawang junction node to the pinned Pluit junction node. Rebuild it from
the saved public source snapshot with:

```sh
npm run highway:build
```

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
`needs_review`. Coordinates and direction must still be verified before the
camera can be used automatically.

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

### iPhone Safari player

Safari receives the original public HLS playlist directly through its native
`<video>` element; HLS.js is not placed in front of Safari's built-in HLS
implementation. After selecting a road and direction, wait until **Buka pemutar
video layar penuh** is enabled and tap it. On iPhone this opens the system video
controller, which is the intended primary experience. The embedded video also
keeps native controls as a fallback.

The page deliberately omits `playsinline`, because Apple documents that iPhone
video without that attribute uses the native full-screen controller. Playback
is muted initially so a newly selected live camera has the best chance of
resuming under Safari's media policies; sound can be changed from the native
controls if the source includes audio.

If a camera change causes iOS to leave full screen, the same launch button can
be tapped again. This is an iOS user-gesture restriction: the page must not
silently force full screen after an asynchronous GPS update.

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
