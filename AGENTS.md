# Repository Instructions for AI

Read and follow [AI_MAINTENANCE_GUIDE.md](./AI_MAINTENANCE_GUIDE.md) before changing road or camera data.

- Do not guess coordinates or enable ambiguous cameras.
- Use provider camera IDs as stable identities and preserve editorial fields during merges.
- Use `npm run camera:verify` for surveyed A/B cameras and `npm run camera:verify-gate` for public toll-gate landmarks shared by A/B.
- A distant gate projection requires explicit human approval and `--allow-distant-projection`.
- Run related tests followed by one full `npm test`; avoid repeated browser verification loops.
- Disable PiP explicitly on iPhone video elements due to native fullscreen conflicts; eagerly set `src` and `preload` attributes for synchronous native gesture playback.
- Include unit/integration test coverage for destroy + load lifecycle, HLS.js instance swapping, and synchronous gesture handling on video state updates.
- Never commit or push until the current checkpoint is approved.
