# Phase 3 checkpoint: emulator pose drill

**Date:** 2026-11-10 (CST)
**Environment:** IWSDK 1.1.0-rc.2 emulator (Meta Quest 3 profile, `sunlit_living_room`), headless managed Chromium, emulated hand tracking.
**Script:** `scripts/drill.sh`

The drill resets the zoo through the hands-operable menu. It then plays a fresh game with built-in emulator hand poses only: no custom joint data and no test hooks. Every creature is posed with the right hand. The wrist is held at the comfortable point (0.05, 1.3, -0.4), and the left hand rests out of the light. Times run from posing the hand to the `reveal` sound, and each one starts after the dev log shows that creature's visitor has arrived. Times are whole seconds from the shell clock.

| Creature | Built-in pose (fingers / palm direction) | Time to match | Evidence |
| --- | --- | --- | --- |
| Rabbit | `peace` (fingers up-right / palm away) | 1 s | `evidence/drill/rabbit.png` |
| Firefly feed (rabbit) | `point` plus three pinches | 2 s to the first `eat` | |
| Dog | `flat`, thumb from `thumbs-up` (fingers left / palm toward player) | under 1 s | `evidence/drill/dog.png` |
| Crocodile | `flat`, thumb from `open` (fingers left / palm away) | 1 s | `evidence/drill/crocodile.png` |
| Peacock | `open` (fingers up / palm away) | 1 s | `evidence/drill/peacock.png` |
| Spider | `claw`, thumb from `open` (fingers down / palm away) | 2 s | `evidence/drill/spider.png` |
| Turtle | `thumbs-up` (fingers toward the wall, tilted down / palm down) | 1 s | `evidence/drill/turtle.png` |

All six creatures matched on the first try at Normal assist. `evidence/drill/zoo.png` shows the full zoo.

## Also exercised

- **Reset zoo, two-tap.** Phase 2B-2 checked it by unit tests only. Here it runs end to end with ray and pinch: open the menu, tap Reset, tap again to confirm. The page reloads with an empty zoo, and the first visitor is the rabbit again.
- **Visitor pacing.** After the guided first three visitors, the next visitor waits for the play gate (45 s or 3 eats). Headless frames run slower than real time, so the drill waits for the dev-only `[ShadowZoo] visitor <id>` log instead of a fixed timeout.

## Issues found

1. **Two drill false starts.**
   - In the first run, Reset reloads the page, and the drill carried on posing hands on the landing page. The drill now waits for the old XR session to end, re-enters and checks `sessionActive`.
   - In the second run, posing before the visitor arrived counted gate waiting time as matching time. The drill now waits for the visitor log first.
   - Neither was a game bug.
2. **A full zoo bunched up.** With all six creatures, the silhouettes overlapped into one dark mass in the middle of the pool (`evidence/drill/zoo.png`).
   - **Cause.** On the emulator's wall (3.4 m away, magnification 5) a cast creature is 0.47–0.63 m in size and up to 1.1 m wide. The pool's ground line is only about 1.7 m long.
   - **Fixed: the zoo makes room.**
     - A creature appears at its hand-cast size, then eases to a shared zoo size. The zoo size shrinks as more creatures arrive: no shrink for one, about 0.2 m for six.
     - Walkers wander toward the middle of their own gap between neighbors, so they spread evenly and don't walk through each other.
     - The ground line moved up into brighter light (-0.42 of the pool's half-height).
   - **Measured in simulation (60 s, three seeds).**
     - The mean gap to the nearest walker rose from 0.16–0.19 m to about 0.34 m.
     - Overlapping pairs fell from 28–37% to 7–10%.
   - **Evidence:** `evidence/p3-zoo-spread.png` and `evidence/p3-zoo-spread-detail.png`.
3. **Feeding a full zoo would have stalled.** Fireflies settled 0.16 m above the ground line, which is the full vertical reach of a 0.18 m creature. They now settle at 0.1 of the pool's half-height. A regression test feeds a full zoo three fireflies and expects three meals.

## Limits

- Built-in emulator poses are clean and static. Real tracked hands jitter and vary between people, which is what the assist relaxation and the EMA smoothing are for. This still has to be confirmed on a headset.
- Frame rate on Quest 3 is not measured here. Headless Chromium uses software rendering.
