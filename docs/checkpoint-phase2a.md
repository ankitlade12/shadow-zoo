# Phase 2A checkpoint: living zoo

**Date:** 2026-11-10 (CST)
**Environment:** IWSDK 1.1.0-rc.2 emulator (Meta Quest 3, synthetic `sunlit_living_room`), headless managed Chromium, real WebXR hand-tracking path.

| Check | Result |
| --- | --- |
| Unit tests | 98 passed, 1 skipped (the silhouette-sheet generator, which only runs on request with `SHEET=1`). |
| Typecheck and build | Pass. |
| Rabbit visitor matched through the emulated hand (`peace` pose) | Yes. The `reveal` sound event fired with the audio context running. |
| Pinch to feed | Yes. Two `xr select` pinches in the `point` pose produced two `firefly` events, and the rabbit chased and ate both (`eat` ×2). Evidence: `evidence/p2a-fireflies.png`. |
| Petting | Yes. The hand's shadow resting on the rabbit produced a `pet` event. |
| Wearing and voice | Yes. The `peace` pose wears the unlocked rabbit, and folding its ears (the pinch) produced `voice-rabbit`. Evidence: `evidence/p2a-worn.png` shows the living rabbit, the player's shadow and the amber dog visitor. |
| Browser errors | 0 across the session. |

## Issues found and fixed during verification

1. **Wearing blocked all feeding.** Any pinch from a hand wearing a creature was treated as its voice. Now only creatures whose action is itself a thumb–index pinch (rabbit, crocodile) speak on a pinch; wearing the dog, for example, still lets you feed. A unit test covers this.
2. **Glows were fixed in size.** Eyes, fireflies, sparks, hearts and the spider's thread were sized for a 2 m wall and looked tiny on the emulator's 3.4 m wall. They now scale with the shadow magnification.
3. **Headless runs can't hear sound.** A dev-only log line, `[ShadowZoo] sound <name> (audio on|locked)`, now records each sound event for verification.
4. **Tooling.** An orphaned Vite process held port 8081 after the dev session was reaped while idle. It was stopped, and `dev up` was rerun.

## Limits

- Sounds are verified only as events with a running AudioContext; nobody listened.
- Real Quest hand-tracking jitter is untested.
- The stage and lantern are fixed when the session starts. If the player moves much closer to the wall, shadows shrink; Re-light, coming in Phase 2B, rebuilds the stage.
