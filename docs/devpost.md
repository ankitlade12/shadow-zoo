# Devpost submission draft: Shadow Zoo

**Status:** a draft for the representative to review. The game and code are published; the Devpost entry has not been submitted.

- **Name:** Shadow Zoo
- **Tagline (140 characters max):** Make shadow puppets with your hands on your real wall, and watch them come alive.
- **Track:** Gaming
- **Division:** New Experience. The project was conceived and built after September 24, 2026.
- **Platform:** Meta Quest 3 and 3S (WebXR, built with the Immersive Web SDK). It's fully usable with hands, controllers aren't needed, and it's designed for seated play.
- **Build link:** https://ankitlade12.github.io/shadow-zoo/ (open it in Meta Quest Browser; on a computer it opens a desktop preview in Meta's WebXR emulator, steered with the mouse and keyboard)
- **Code:** https://github.com/ankitlade12/shadow-zoo (MIT)
- **Video:** recorded, `docs/video/shadow-zoo-demo.mp4` (1:36, IWSDK emulator footage, labeled on screen). It still needs uploading to YouTube or Vimeo for the submission link.

## Description

Remember making shadow animals on the wall as a kid? Shadow Zoo brings that magic into mixed reality, and lets the shadows come alive.

A warm lantern glows behind you and lights the real wall in front of you. Your tracked hands cast soft shadows into that pool of light. A glowing outline appears: a rabbit. Shape your hand until its shadow fits, and the rabbit wriggles free, hops along your wall and blinks at you. Over your first sessions you meet a dog, a crocodile, a peacock, a spider and a turtle. Each is a real one-handed shadow puppet, and each has its own personality and way of moving.

Then you play with them, using only your hands:

- **Feed:** pinch to release a firefly, and your creatures chase it down.
- **Pet:** rest your hand's shadow on a creature to earn hearts. At three hearts it learns a trick.
- **Wear:** make the shape of a creature you've already met and you become it. Snap your fingers closed and your dog barks (the rabbits scatter), your crocodile chomps a firefly out of the air, your rabbit squeaks.

Shadow Zoo is built for coming back. Your zoo is saved on your device and greets you the next day. Your streak warms the lantern. Once your zoo is complete, a daily visitor arrives with a twist: a shy one you must hold perfectly steady, or a big one that makes you bring your hand closer to the light.

**Why it belongs in mixed reality:** the experience depends on your real wall and your real hands. The game finds the wall you're facing, lights it, and projects your hand through a lantern, so moving your hand toward the light makes the shadow grow, just as with a real lamp. It could not exist on a flat screen.

**Designed for everyone:**
- seated play, no controllers, short sessions;
- no reading required: a glowing ghost hand demonstrates each shape, and captions are a few words long;
- assist levels that gently relax over time, either hand, reduced motion and sound-independent feedback;
- a narrow-view option for Meta VR Glasses.

## How we built it

- **Platform:** Meta's Immersive Web SDK (WebXR). Plane detection finds the wall, and the WebXR Hand Input API provides 25 joints per hand. Players need only a link; there's nothing to install.
- **Shadow engine:** hand bones are projected from a virtual point light onto the wall plane as tapered capsules, rendered into a 2D mask once per frame and composited over passthrough with a single quad. That keeps it light enough for standalone hardware.
- **Matching:** shapes are normalized for position and size, then compared with an overlap score plus a 64-direction radial signature. The signature finds the rotation and makes sure ears, jaws and legs are in the right places.
- **Creatures:** creatures are hand shadows too. Each blends between a base pose and an action pose, with its own gait.
- **Audio:** all sounds are synthesized live with the Web Audio API and placed on the wall in 3D.
- **Desktop preview:** without a headset, the same link runs Meta's WebXR emulator with a virtual living room.
  - **Real hands through the camera.** MediaPipe hand tracking runs in the page and maps each tracked hand into the room in front of the virtual wall. Players make the creatures with their actual hands, as on a headset. The camera picture never leaves the device.
  - Or an emulated hand, steered with the mouse and keyboard, takes the game's own creature poses.
  - Quest Browser never downloads the emulator or the tracker.
- **Quality:** 150+ automated tests cover the math, matching, progression, saving and the full session flow. An emulator drill plays a fresh game with built-in hand poses and times every match.

## Challenges

- **Telling creatures apart.** Hand silhouettes share a big palm blob, so a plain overlap score confused them; the swan and spider scored 0.83. Adding a radial signature brought the worst cross-creature score down to 0.27 while keeping every creature robust to hand size, rotation and noise.
- **Finding the right wall.** In testing, a picture frame in front of the wall was detected as the "wall". The game now prefers real walls by size and semantic label.
- **A crowded wall.**
  - A creature cast by your hand is about half a meter across on a wall three meters away. With all six on the wall, they merged into one dark blob.
  - The zoo now makes room. Each creature appears at the size you cast it, then everyone eases to a shared smaller size as the zoo grows. Walkers settle into the gaps between their neighbors.
  - In simulation, overlapping pairs dropped from about 30% to under 10%.
  - Shrinking exposed a real bug: fireflies hovered just out of reach of the smallest creatures. A regression test caught it, and fireflies now settle lower.
- **No headset available.** Everything was built and verified in the IWSDK emulator's synthetic room with emulated hand tracking. Built-in emulator hand poses stood in for real hands to test that each creature can be matched.

## What's next

- Two-handed creatures (bird, deer)
- A shadow-theater mode for performing stories
- Shared zoos for co-watching
- A headset playtest to tune matching on real hands

## Honest notes for judges

- Tested in the IWSDK WebXR emulator. On-device frame rate and real-room behavior haven't been verified.
- **On a computer, the link opens a desktop preview, and it says so on screen.**
  - It runs Meta's WebXR emulator with a virtual living room. You play with your real hands through your camera (MediaPipe hand tracking in the page), or with an emulated hand steered by the mouse, where keys 1 to 6 make the shapes.
  - It's there for a quick look without a headset. The game is designed for tracked hands on Quest.
- **The video is emulator footage, and it says so on screen.**
  - The game is played by a script using built-in emulated hand poses.
  - The emulator's screen capture has no audio, so the soundtrack was rebuilt offline from the game's own synthesized sound recipes. Each sound is placed at the moment and wall position where the game played it.
- Never described as "the first" of anything. Hand-shadow games exist; the new part is shadows on your real wall that come alive and stay.
- No personal data leaves the device.
