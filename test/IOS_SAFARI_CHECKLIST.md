# iPhone Safari acceptance checklist

Use a passenger or a stationary vehicle for every road test. Do not operate the
site while driving.

## Required setup

- Publish the `docs/` directory over HTTPS. GitHub Pages satisfies the secure
  context requirement for geolocation.
- Test iOS 17.1 or newer Safari on a physical iPhone. A desktop responsive
  preview cannot prove Managed Media Source decoding, GPS behavior, PiP, or the
  iOS system full-screen controller.
- Keep `docs/data/cameras.json` unchanged until camera coordinates and A/B sides
  have been verified. Use `?demo=1` for player-only testing.

## MMS hot-swap player

1. Open `?demo=1` in Safari, select A, and wait for the full-screen button.
2. Confirm **Buka pemutar video layar penuh** opens the iOS system player.
3. In Web Inspector, confirm the main player reports `hls-mms` rather than
   falling back to `native` for a known HLS.js-compatible stream.
4. Confirm Play/Pause, mute, live-edge, rotation, PiP, and Done controls behave
   normally.
5. Exit full screen, reopen it, and confirm there is still exactly one video
   playing.
6. While full screen remains open, switch across at least three cameras whose
   streams have different aspect ratios. Confirm every image is fully contained,
   centered, and never remains cropped to the previous stream's bounds.
7. Repeat the same three-camera switch in PiP. Confirm PiP stays open, playback
   resumes, and no `src` removal or `video.load()` occurs during the swap.
8. Lock and unlock the phone, then background and restore Safari. Confirm the
   page does not create duplicate audio/video playback.
9. Repeat once on Wi-Fi and once on cellular data.

## Failure recovery

1. Choose an offline camera and wait 20 seconds.
2. Confirm automatic switching pauses and the full-screen button is disabled.
3. Tap Retry and verify no duplicate player appears.
4. Tap Camera berikutnya and verify only the selected replacement loads.
5. Open the direct stream link and confirm it is offered only as a fallback.

## Location and route behavior

1. Deny location and confirm manual road and A/B selection remains available.
2. Grant precise location while stationary near the supported road.
3. Confirm poor accuracy above 100 m is rejected.
4. Test A and B with a passenger and compare switching against known camera
   positions.
5. Confirm one noisy/reversed fix does not change cameras.
6. Confirm two valid fixes more than 75 m beyond a camera change it once.
7. Confirm the last camera remains visible at the end of the route.

## Privacy inspection

- In Safari Web Inspector, location values must never appear in network request
  URLs, bodies, headers, browser storage, or analytics calls.
- Expected page requests are local HTML/CSS/JS/JSON/GeoJSON assets plus the
  selected public HLS playlist and its media resources.
