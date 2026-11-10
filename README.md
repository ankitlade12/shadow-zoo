# Shadow Zoo

Make shadow puppets with your hands on your real wall, and watch them come alive.

**Play it:** open **https://ankitlade12.github.io/shadow-zoo/** in Meta Quest Browser on a Quest 3 or 3S.
**Watch it:** [`docs/video/shadow-zoo-demo.mp4`](docs/video/shadow-zoo-demo.mp4) (1:36, IWSDK emulator footage).

Shadow Zoo is a hands-first mixed reality game for Meta Quest, built with Meta's Immersive Web SDK (WebXR). A warm virtual lantern shines from behind you, and your tracked hands cast soft shadows onto the wall you are facing. When your hand's shadow matches a creature's glowing outline, it wriggles free and joins a living zoo on your wall. You can feed it fireflies, pet it with your shadow, or "wear" it and puppeteer its voice. The zoo is still there the next time you come back.

## How to play

1. Open the game in **Meta Quest Browser**, sit facing a wall in a lit room, and put your controllers down.
2. Press **Light the lantern**. A pool of warm light appears on the wall in front of you.
3. Shape your hand until its shadow fits the glowing outline. A ghost hand shows you how.
4. **Pinch** to release a firefly; your creatures chase and eat it. **Rest your shadow** on a creature to pet it. Hearts grow, and at three hearts it learns a trick.
5. Make the shape of a creature you've already met to **wear it**: snap its jaw, ears or tail to make its voice. Your dog's bark scatters the rabbits.
6. Come back tomorrow. Your zoo is saved, your streak warms the lantern, and a daily visitor brings a twist.

**Creatures:** rabbit, dog, crocodile, peacock, spider and turtle. All six are one-handed, and either hand works.

**Comfort and access:**
- Seated play, and the light pool stays within a comfortable field of view.
- No reading is required: captions are short, and a ghost hand demonstrates every shape.
- The menu (pinch the "Menu" chip on the wall) has:
  - assist level (gentle matching relaxes further over time);
  - hand preference;
  - sound on or off;
  - reduced motion;
  - a narrow view for Meta VR Glasses;
  - Re-light (moves the stage to the wall you face);
  - Reset zoo.

## Run it locally

Requirements: Node 20.19+, 22.12+ or 24+.

```bash
npm install
npm run dev        # IWSDK dev server with the WebXR emulator (Meta Quest 3, synthetic living room)
npm test           # unit and integration tests (Vitest)
npm run typecheck
npm run build      # static site in dist/
```

The dev server is managed by the IWSDK CLI. To test without a headset, use the emulator. For example:

```bash
./node_modules/.bin/iwsdk dev up --ai-mode agent --headless
./node_modules/.bin/iwsdk xr enter
./node_modules/.bin/iwsdk xr set-input-mode --input-json '{"mode":"hand"}'
./node_modules/.bin/iwsdk xr set-hand-pose --input-json '{"device":"hand-right","poseId":"peace"}'
./node_modules/.bin/iwsdk browser screenshot
```

To develop with a fixed synthetic hand shape, set `VITE_TESTPOSE=rabbit` (or another creature) when starting the dev server.

`scripts/drill.sh` plays a fresh game with built-in emulator poses and times each creature's match. `scripts/seed-save.mjs` loads a first-time, returning or full-zoo save into the emulator's browser.

### Demo video

The submission video is footage from the IWSDK emulator, and it says so on screen. To rebuild it:

```bash
./node_modules/.bin/iwsdk dev up --ai-mode agent --headless --allow-browser-automation --screenshot-width 1280 --screenshot-height 720
bash scripts/demo.sh                                                    # plays and records the scripted demo
./node_modules/.bin/iwsdk browser run scripts/render-audio.mjs --timeout 110000
python3 scripts/encode.py                                              # writes docs/video/shadow-zoo-demo.mp4
```

- **Scripted play.** `demo.sh` plays the game with built-in emulator hand poses, smooth hand motions and pinches. It also clicks "Light the lantern" for real. No game code is bypassed.
- **Recording.** `record.mjs` records the page with the Chrome DevTools screencast. It connects to the dev server's local automation endpoint, so it has no time limit. It also streams the game's dev-mode console lines to a live log, which the demo script waits on.
- **Audio.** The screencast captures no audio. `render-audio.mjs` rebuilds the soundtrack offline from the game's own sound recipes, placed at the moments and wall positions the game traced in dev mode.
- **Encoding.** `encode.py` joins the segments, adds the chapter titles and an "emulator footage" label, and muxes the audio. It needs ffmpeg and Pillow.

## How it works

```
src/core/     pure game math and logic (no WebXR; unit-tested)
  poses        hand joint sets built on the WebXR emulator's hand skeleton
  projector    point-light projection of hand bones onto the wall plane
  silhouette   capsule rasterizer, normalized IoU plus a radial signature for shape matching
  library      the six creatures: hand shapes, actions, motion styles
  stage        wall choice from plane detection, light pool, lantern placement
  creature, fireflies, particles, interact, puppet, matcher, save, daily
src/game/     the game: hand shadows, visitors, wearing, the zoo, progression, onboarding, session
src/render/   shadow canvas (2D mask pass plus one composite quad), captions, ghost hand
src/systems/  IWSDK ECS systems: hands, stage, menu, game, render, sound
```

- **Shadows.** Each tracked hand's 25 joints are projected from a virtual lantern onto the stage plane as tapered capsules. They're drawn into a small 2D mask once per frame, then composited over passthrough with a single wall-aligned quad.
- **Matching.** The hand's shadow is normalized for position and size, then compared with each creature's silhouette. The comparison combines overlap (IoU) with a 64-direction radial signature, which finds the rotation and penalizes misplaced ears, jaws or legs. A short hold and a gently relaxing threshold keep it fair.
- **Creatures.** Creatures are themselves hand shadows. Each one blends between its base pose and an action pose (ear twitch, jaw snap, tail fan, leg curl, head tuck) and moves with its own gait.
- **A zoo that makes room.**
  - A creature appears at the size your hand cast it. As the zoo fills, everyone eases to a shared smaller size, so six creatures still read as six animals.
  - Walkers spread into the gaps between their neighbors.
  - A creature holds still while your shadow rests on it.
- **Audio.** All sound is synthesized with the Web Audio API and placed on the wall in 3D, so there are no audio assets.

## Privacy

- Shadow Zoo stores your progress and settings only in this browser's `localStorage` on your device.
- It has no accounts, analytics, network APIs or AI services.
- Hand-joint data is used only in memory to draw shadows and is never stored or sent anywhere.

## Status and limits

- Built and tested in the IWSDK WebXR emulator: synthetic room, emulated hand tracking, scripted hand poses. No physical Quest headset was available during development.
- Real hand-tracking noise, passthrough contrast in real rooms, and on-device frame rate still need confirming on hardware.
- Evidence screenshots and checkpoint reports are in `docs/`.

## License

[MIT](LICENSE)
