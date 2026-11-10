# Shadow Zoo — design spec

- **Date:** 2026-11-09
- **Status:** approved by the user in chat ("lets do it … build full blown game")
- **Competition:** Meta VR Start Developer Competition 2026, Gaming track, New Experience division
- **Deadline:** 2026-11-18 12:00 PT (2:00 p.m. CT). The rules are recorded in the project memory.
- **Platform:** WebXR built with Meta's Immersive Web SDK (IWSDK) 1.1.0-rc.2. It is submitted as a hosted link, with no APK.

## 1. Pitch

Make shadow puppets with your hands on your real wall, and watch them come alive.

A warm lantern shines from behind you, and your tracked hands cast shadows onto the wall you are facing. Shape your hand into a creature's silhouette and the shadow wriggles free, becomes a living animal, and joins a zoo that lives on your wall. You can pet the animals, feed them fireflies, and "wear" one to puppeteer it with sound. They are there to greet you the next day.

**Honest novelty claim.** Silhouette (Quest, 2023) used hand shadows for puzzles inside a virtual world. Shadow Zoo puts the shadows on the player's real wall, makes them come alive, and keeps them as a persistent zoo. Never claim "first".

## 2. Player experience

### 2.1 First minute (targets Best First Five Minutes)

1. **2D page.** A title, one line ("Make shadow puppets on your wall — watch them come alive"), and an **Enter** button that a pinch can press.
2. **Lantern on.** A warm pool of light fades onto the wall in front of the player, or onto a paper screen if no wall is found. The player's own hand shadow appears inside it right away.
3. **Rabbit.** A glowing ghost hand floats about 45 cm in front of the player and demonstrates the rabbit pose, while the rabbit's outline pulses on the wall.
4. **Payoff, usually within 30–60 s.** The shadow fits, the outline snaps, the rabbit wriggles free, hops and sniffs the player's hand shadow. A chime plays.
5. **Feed it.** A pinch makes a firefly, which the rabbit chases and eats, earning a heart.

There are no text walls. Captions are at most five words and every step has a visual demonstration.

### 2.2 Creatures

There are six creatures in the core game. All are one-handed and either hand works (left-hand targets are mirrored).

| Creature | Hand shape | Living behaviors | Puppet action (when "worn") |
|---|---|---|---|
| Rabbit | Sideways V: index and middle up as ears, thumb on the ring and pinky fingers | Hops, twitches its ears, nibbles | Ear wiggle makes a squeak |
| Dog | Flat hand sideways, thumb up as the ear, pinky dropped as the jaw | Trots, chases the hand shadow, wags | Pinky jaw makes a bark |
| Crocodile | Fingers together as the upper jaw, thumb below as the lower jaw | Slithers along the bottom of the light pool, chomps | Thumb jaw makes a chomp |
| Peacock | Open hand: fingers fanned up as the tail, thumb out front as the head | Struts, fans its tail, pecks | Tail fan (finger spread) makes a call |
| Spider | Palm down, fingers curled downward as legs | Drops on a thread from the top, scuttles | Finger wiggle makes a skitter |
| Turtle | Fist as the shell, thumb poking out as the head | Slow walk, hides in its shell when touched | Thumb in and out makes a peep |

**Change, 2026-11-10:** the swan became a **peacock**. A one-handed swan has no neck without the untracked forearm, so its silhouette was too close to the spider's.

**Stretch:** two two-handed creatures (bird and deer). They are only included if they score well under hand-overlap tests, because tracking struggles when two hands overlap.

### 2.3 Core loop

1. **Visitor.** A creature's outline appears in the light pool. A ghost-hand hint appears after 6 s without progress.
2. **Match.** The player's shadow must resemble the outline in shape and orientation. Position and size are normalized, so it does not need to be pixel-exact.
3. **Come alive.** The outline snaps to the shadow, the creature detaches, plays a reveal animation and chime, and joins the zoo.
4. **Play.**
   - **Pet:** keep your hand's shadow on a creature.
   - **Feed:** pinch to release a firefly at your index fingertip's shadow; the nearest hungry creature chases and eats it.
   - **Wear:** make a known creature's shape. Your shadow gains eyes and a voice. Zoo creatures react: rabbits scatter when your dog barks, and your crocodile can eat fireflies.
5. **Progress.**
   - **Bonds:** each creature has 0–5 hearts, earned by petting, feeding and playing together. At 3 hearts it learns a trick (rabbit flip, dog roll, crocodile tail wag, peacock tail fan, spider weaves a web in the corner of the pool, turtle spin).
   - **Session 1:** guided rabbit, then dog, then crocodile. After that, peacock, spider and turtle arrive as visitors after short play goals (about 45–60 s, or 3 fireflies eaten). A judge can meet all six in about 8–10 minutes.
   - **Stars:** each match earns 1–3 stars for speed. Personal bests are kept.

### 2.4 Reason to come back

- **Daily visitor.** A creature chosen from the date (as the seed) arrives with a twist, for example a mirrored shape, a bigger shadow, or "hold it for 3 s". Completing it earns a lantern ember.
- **Lantern streak.** Consecutive days make the lantern glow richer and add ornaments, giving visible growth between sessions.
- **Welcome back.** Unlocked creatures are already in the light pool and greet the player. Bonds and tricks persist.

### 2.5 Comfort, accessibility and design rules

- Seated play; hands stay at chest height and nothing requires reaching.
- Field-of-view aware: the light pool stays within about ±20° horizontal and ±15° vertical of the forward view. A **Narrow view** menu setting, for Meta VR Glasses (37° each side, 25° up, 43° down), shrinks the pool to about ±14° horizontal and ±10° vertical. The game can't detect the device, so the player turns this on.
- Assist levels (Gentle, Normal, Expert) change the match threshold and hold time. In Gentle and Normal the threshold also relaxes the longer the player tries, so nobody gets stuck.
- Hand preference: Auto, Left or Right. Every sound has a visual cue (sound-independent). There is a Reduced motion option and an option to turn sound off.
- **Re-light** moves the stage to the wall the player is currently facing.
- Data controls: Reset progress, with a confirmation step.

## 3. Technical design

### 3.1 Session and features (`iwsdk.config.json`)

- **Session:** `xr.mode: "ar"`, with `handTracking` required and `planeDetection` optional.
- **IWSDK features:**
  - On: `sceneUnderstanding` (gives `XRPlane` entities) and `spatialUI` (menus).
  - Off: locomotion, physics, grabbing and environment raycast.
- **Emulator:** `dev.emulator.device: "metaQuest3"`, `environment: "sunlit_living_room"`. The emulator's synthetic room supplies walls.
- The virtual hand visuals are turned off with `toggleVisual(false)`, so the player sees their real hands in passthrough.

### 3.2 Coordinate model

The **stage** is a plane with an orthonormal basis:
- origin at the stage center on the wall;
- `u` points right, `v` points up, and `n` points out of the wall toward the player;
- units are meters.

All 2D gameplay (shadows, creatures, fireflies, hit tests) happens in stage `(u, v)` coordinates.

The **lantern** L is fixed in world space when the stage is placed, and its position comes from the stage. Take a comfortable hand point H, 0.40 m in front of the eyes and 0.30 m below them, from the head pose at placement time. L lies on the line from the stage center through H, a further 0.75 m past H (behind the player's hands). A hand held at H then casts its shadow at the stage center whatever the wall distance. Magnification is about (0.75 + |H − stage|) / 0.75, roughly 3× at 2 m. Moving a hand toward the lantern makes its shadow bigger, as in real shadow puppetry.

A light above the head would not work. With the lantern 0.25 m above the eyes and the hands at chest height, a wall 2 m away would show the shadow about 1.6 m below eye level, near the floor.

A point **P** projects onto the stage plane (point **O**, normal **n**) along the ray from L:

```
t  = dot(O - L, n) / dot(P - L, n)
P' = L + t (P - L)
```

A joint's radius scales by `t`. If `dot(P - L, n) >= 0`, the point is not in front of the wall and is skipped.

### 3.3 Module layout

The pure modules have no IWSDK or DOM imports and are unit-tested with Vitest. The IWSDK systems are thin adapters around them.

```
src/core/            pure logic, unit-tested
  joints.ts          WebXR joint names, bone list (capsule pairs), constants
  poses.ts           creature pose angles plus IWER buildHandPose on the IWER skeleton;
                     pose -> 25 joint positions/radii; mirroring; animation channels
  projector.ts       3D joints -> 2D stage capsules (point-light projection, §3.2)
  silhouette.ts      capsules -> 48x48 coverage mask (signed-distance rasterizer);
                     normalization by centroid and sqrt(area); a 64-bin radial signature
                     picks the rotation (within 28 deg) and penalizes misplaced protrusions;
                     IoU at that rotation; either facing
  matcher.ts         per-target state machine: score smoothing (EMA), threshold,
                     0.6 s hold, assist relaxation, tracking-loss reset, events
  stage.ts           wall choice from plane descriptors; stage basis; light-pool
                     radius; fallback paper screen; light-pool containment tests
  creatures.ts       behavior state machines (wander, hop, chase, eat, react, trick)
                     in stage coordinates; seeded RNG; stay within the light pool
  progression.ts     unlock order, visitor triggers, bonds, stars, tricks, daily
                     visitor (seed = local date), streak, embers
  save.ts            versioned save schema, validation, migration, storage port
                     (localStorage adapter with try/catch; in-memory fallback)
  puppet.ts          worn-creature detection; jaw/ear actuation from finger distances
  rng.ts, math2d.ts  small utilities
src/systems/         IWSDK systems (ECS adapters)
  HandShadowSystem   reads joint transforms from the hand visual adapters, hides hand
                     visuals, projects onto the stage, publishes player capsules
  StageSystem        lantern placement, XRPlane query -> wall choice, re-light,
                     fallback screen
  GameSystem         flow: intro -> tutorial -> play; visitors, matching, reveal;
                     owns the save (load on start, save on change and visibility loss)
  ZooSystem          creature entities and behaviors; pet, feed and wear interactions
  RenderSystem       all 2D drawing: instanced signed-distance capsules (shadows,
                     outline), glow sprites (eyes, fireflies, light pool), 3D ghost hand
  AudioSystem        procedural WebAudio voices plus ambient sound, positioned at the
                     stage (HRTF panner)
  MenuSystem         lantern button plus a spatial UI panel: zoo journal, assist,
                     hand, sound, reduced motion, re-light, reset
src/index.ts         World.create(virtual:iwsdk-project) plus system registration
```

### 3.4 Frame data flow

1. The current `XRFrame` gives the hand visual adapters' `jointTransforms` (25 joints per hand).
2. Joints are converted to world positions, and radii come from `frame.fillJointRadii`. If that call isn't available, typical radii are used instead.
3. `projector` turns them into player capsules in stage coordinates.
4. `RenderSystem` draws the player shadow.
5. At 15 Hz, `matcher` compares the player capsules with the current target silhouette. A match produces a "matched" event, which triggers the reveal and adds a creature to the zoo.
6. `creatures` advance each frame. Each creature's pose is animated through its animation channels and drawn as a silhouette in stage space with the same capsule renderer, so living creatures are literally hand shadows.

### 3.5 Rendering

All shadows go into one instanced mesh of signed-distance capsules, at most about 400 instances. Glow sprites (eyes, fireflies, outline dashes) use a second instanced mesh. The light pool is a single quad. Drawing uses alpha blending over passthrough:
- the light pool is warm amber, about rgba(255,194,122,0.22);
- shadows are rgba(10,6,4,0.78) with an edge feather of about 6 mm on the wall.

The ghost hand is drawn as 3D capsules with a soft emissive material. The budget is 2 ms of CPU per frame for game logic and zero allocations per frame in `update()`.

### 3.6 Robustness

| Situation | Behavior |
|---|---|
| Hands not tracked or controllers in use | Panel: "Put controllers down — use your hands." Matching pauses. |
| Tracking lost during a match | Smoothed score and hold timer reset, so a match can't complete by accident. The shadow fades out. |
| No qualifying wall, or plane detection unavailable | Paper screen 1.6 m ahead at eye height; everything else works the same. |
| localStorage unavailable or corrupt save | Play in memory and keep the corrupt data under a backup key. A small notice is shown. |
| Session hidden or ended | Save, pause audio, suspend creature updates. |

### 3.7 Testing and evidence (no headset available)

- **Unit tests (Vitest):**
  - Projection math and silhouette IoU.
  - Matcher timing, assist relaxation and tracking loss.
  - Wall-choice cases and creatures staying within bounds.
  - Progression: daily seed, streak and visitor triggers.
  - Save validation and migration.
- **Pose library tests:**
  - Each canonical pose matches itself at IoU ≥ 0.95.
  - It still matches above the threshold under hand scale 0.85–1.15, ±12° wrist rotation and 4 mm joint noise.
  - Cross-creature IoU stays below the threshold minus a safety margin.
- **Silhouette sheet:** a PNG contact sheet of every creature, generated by a Node script, for visual review.
- **Emulator end-to-end:**
  - Start `iwsdk dev` and enter XR in the synthetic living room.
  - Pose the hands with IWER per-finger pose blends (e.g. rabbit ≈ `peace`), plus a dev-only `?testpose=` hook that injects canonical poses.
  - Screenshots prove the shadow, the outline, the reveal, the zoo, the menu and the fallback screen.
- **Limitation, stated in the README:** no physical-headset testing. Performance is verified only as desktop frame time and draw-call counts.

### 3.8 Build, hosting and submission

- `vite build` produces a static `dist/` (`base: './'`).
- Hosting is a GitHub Pages repo through Actions, or Vercel. Either needs HTTPS. **Nothing is published without the user's explicit OK.**
- The submission video is under 3 minutes, recorded in the emulator and labeled as emulator footage. The description follows the honest novelty claim.

## 4. Scope

- **Ship (must work):** §2.1–2.5 and §3, all six creatures, bonds, tricks, daily visitor, lantern streak, menu, audio, assist levels and the fallback screen.
- **Stretch:** two-handed bird and deer; a "Shadow Show" stage mode with curtain and music; Glasses-mode tuning beyond fitting the field of view.
- **Out:** AI, multiplayer, accounts, analytics, backend, controller-only play, real-world light estimation.

## 5. Schedule and checkpoint

| Date | Work |
|---|---|
| Nov 10 | Scaffold, core math (projector, silhouette, poses), pose sheet, tests |
| Nov 11 | Systems: shadows in the emulator, stage on the wall, matcher, rabbit comes alive. **Checkpoint: if this fails, revert to the ComfortPass fallback.** |
| Nov 12 | All six creatures and behaviors; pet, feed, wear; procedural audio |
| Nov 13 | Progression, bonds, tricks, daily visitor, streak, save; menu |
| Nov 14 | Onboarding polish, assist tuning, fallback screen, Glasses field of view |
| Nov 15 | Visual and audio polish, performance pass, regression |
| Nov 16 | Freeze, record emulator video, write-up; hosting (with OK) |
| Nov 17 | Submit (with OK) |
| Nov 18 | Buffer until 12:00 PT |

## 6. Risks

1. **Real-hand fit is untested.** Mitigations: one-hand shapes only, normalized matching, relaxing thresholds, and the ghost-hand hint. Borrowing a Quest for even 30 minutes is the best fix.
2. **Wall detection varies between rooms.** Mitigation: the fallback screen and Re-light.
3. **Quest browser performance.** Mitigations: instanced drawing, no shadow maps, matching at 15 Hz, a fixed allocation budget.
4. **IWSDK is a release candidate (1.1.0-rc.2).** Pin exact versions and keep to the documented API surface.
5. **Time.** The checkpoint on Nov 11 decides whether to continue or fall back to ComfortPass.
