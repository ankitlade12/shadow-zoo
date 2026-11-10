# Phase 1 checkpoint — shadow loop

**Date:** 2026-11-10, 08:30 CST
**Environment:** IWSDK 1.1.0-rc.2 emulator (Meta Quest 3 profile, `sunlit_living_room` synthetic room), headless managed Chromium on macOS.

| Check | Result |
| --- | --- |
| Unit tests | 60 passed, 1 skipped (the silhouette-sheet generator, which only runs on request with `SHEET=1`). |
| Typecheck and build | Pass. `tsc --noEmit` is clean and `vite build` succeeds. |
| Stage on the emulator living-room wall | Yes. 15 planes were detected and the back wall was chosen at 3.40 m. The light pool's half-extents are 1.2 × 0.9 m, centered at eye height (y = 1.5 m). Evidence: `evidence/p1-rabbit-shadow.png`. |
| Synthetic rabbit pose matched and came alive | Yes. The rabbit came alive with a glowing eye and hopped, then the next visitor appeared. Evidence: `evidence/p1-rabbit-alive.png`. |
| Emulated hand shadow follows the hand | Yes. In emulator hand mode, the right hand in the `peace` pose (wrist 40 cm forward and 30 cm below the eyes) casts a V-shaped shadow with its forearm. Evidence: `evidence/p1-emulated-hand.png`. |
| Emulated built-in pose matched a visitor | Yes. IWER's built-in `peace` pose matched the rabbit visitor within a few seconds through the real WebXR hand-tracking path; a living rabbit appeared and the dog visitor followed. Evidence: `evidence/p1-emulated-match.png`. |

## Issues found and fixed during the checkpoint

1. **The light pool was clamped to a picture.** The framed picture (1.2 × 0.8 m) hangs 2 cm in front of the wall, so it was the nearest vertical plane. Planes labeled `wall` now win; otherwise planes at least 1.0 m wide and 1.5 m tall win over smaller ones. Tests cover both cases.
2. **Virtual hand and controller models were visible.** They are now hidden every frame.
   - The white outline hand and black controller that still appear in screenshots are drawn by the emulator's own device overlay, not by the game.
3. **Creature confusion (found while building the library, not in the emulator).** IoU alone scored different creatures as similar as 0.83. Matching now adds a 64-bin radial signature: the worst cross-creature score is 0.27, and the worst robust self-match is 0.74. The swan became a peacock, because a one-handed swan has no neck without the untracked forearm.

## Limits

- Emulator only. There are no physical-headset results, so Quest hand-tracking noise, passthrough contrast and real rooms are untested.
- No performance numbers have been measured. Rendering uses one mask pass into a 512-pixel texture plus a single quad, with matching at 15 Hz.

## Decision

Continue to Phase 2. The core loop works end to end through the real hand-tracking input path, so there is no reason to fall back to ComfortPass.
