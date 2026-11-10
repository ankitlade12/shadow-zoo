# Phase 2B-2 checkpoint: menu and settings

**Date:** 2026-11-10 (CST)
**Environment:** IWSDK 1.1.0-rc.2 emulator, headless managed Chromium, emulated hand rays.

| Check | Result |
| --- | --- |
| Tests and typecheck | 126 passed, 1 skipped; typecheck clean. |
| "Menu" chip on the wall | Rendered at the bottom-left of the light pool, about 5 degrees wide. The emulator lists it as the sequence target `open`. |
| Open with ray and pinch from the seated position | The right hand's ray aimed at the chip plus `xr select` opened the settings panel 0.55 m in front of the player, slightly below eye level. Evidence: `evidence/p2b2-menu-open.png`. |
| Change a setting with ray and pinch | Clicking "Sound: On" changed it to "Sound: Off", applied it (SoundSystem mutes) and saved it; the dev log shows `setting sound -> Sound: Off`. Evidence: `evidence/p2b2-sound-toggled.png`. |
| Pinch on UI does not feed | While a hand ray hovers the chip or menu, `uiHovered` clears hand pinches before the session sees them. |

## Issues found and fixed during verification

1. **The panel was huge.** Its width was measured at instantiation, before UIKit layout. It is now measured when the menu opens, falling back to the markup width (440 UIKit units, which is 4.4 m at scale 1).
2. **The stage drew over the menu.** Both are transparent; the composite had render order 10. The stage composite and caption now draw first (render order -10 and -9), so UI panels land on top.
3. **Labels did not update.** The Horizon kit `ButtonLabel` wraps a Text child; `setProperties({ text })` now targets that child.
4. **Poking the wall chip by walking up to it** (an `xr run-sequence` press) was unreliable under slow headless frames, and a seated player would never do it. Ray and pinch is the supported path and works.

## Limits

- Reset zoo (two-tap) and Re-light were exercised by unit tests and code review only. Reset reloads the page by design.
- The editor-side `ui assets` catalog didn't list the new panels until a dev-server restart; the runtime loads them fine.
