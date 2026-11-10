# Phase 2B-1 checkpoint: game flow

**Date:** 2026-11-10 (CST)
**Environment:** IWSDK 1.1.0-rc.2 emulator (Meta Quest 3, synthetic living room), headless managed Chromium, emulated hand-tracking input.

| Check | Result |
| --- | --- |
| Unit and integration tests | 124 passed, 1 skipped (the silhouette-sheet generator, which only runs on request). Includes save validation, the streak and daily visitor, progression gates, onboarding captions, visitor twists, tricks and reduced motion, and three end-to-end `Session` scenarios. |
| Typecheck and build | Pass. |
| First minute (first-time player) | The caption "Make a rabbit with your hand", the glowing 3D ghost hand demonstrating the rabbit, and the amber rabbit outline all appear. Evidence: `evidence/p2b1-first-minute.png`. |
| Rabbit matched | `reveal` fired; the caption changed to "Pinch to give it a firefly"; the ghost hand faded; no next visitor appeared during teaching. Evidence: `evidence/p2b1-feed-step.png`. |
| Feeding | The pinch released a firefly and the rabbit ate it (`firefly`, then `eat`); the caption changed to "Rest your shadow on it". |
| Patience fallback | After 20 s in a teaching step, the next visitor (the dog) arrives anyway, so a player who doesn't pet can't get stuck. Evidence: `evidence/p2b1-next-visitor.png`. |
| Persistence | After a page reload, the rabbit is restored silently from `localStorage`, with no onboarding. The next guided visitor (the dog) follows. Evidence: `evidence/p2b1-restored.png`. |
| Hint and ghost for a stuck player | After 6 s without progress, the caption "Copy the glowing shape" appears and the ghost hand demonstrates the dog. Evidence: `evidence/p2b1-hint-ghost.png`. |
| Browser errors | No exceptions; only the aborted dev-runtime requests that happen during reloads. |

## Changes during verification

- Renamed the game's `AudioSystem` to `SoundSystem`. The ECS system list showed two `AudioSystem` entries: the SDK's built-in one and ours.

## Limits

- Petting was not re-driven in this run because placing the emulated hand's shadow exactly on a moving creature is fiddly. It was verified in Phase 2A, and the step transition is unit-tested.
- The daily visitor and streak were verified by unit and session tests only; the emulator can't advance the date.
- On a real Quest, captions and the ghost hand need a readability and comfort check, which hasn't been possible without a headset.
