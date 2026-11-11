# Shadow Zoo: Devpost submission

Copy for each field of the Devpost "Enter a Submission" form, in order.

## Project name

Shadow Zoo

## Elevator pitch

Make shadow animals with your bare hands on your real wall, and watch them come alive, play and wait for you to come back.

## Track and division

- **Track:** Gaming
- **Division:** New Experience (conceived and built after September 24, 2026)

## Links

- **Play it:** https://ankitlade12.github.io/shadow-zoo/ (Meta Quest Browser on Quest 3 or 3S; on a computer, the same link opens a desktop preview)
- **Video:** the YouTube link, uploaded as Public, from `docs/video/shadow-zoo-demo.mp4` (2:08, narrated and captioned)
- **Image gallery:** the nine captioned 3:2 screenshots in `docs/gallery/`, in order
- **Code:** https://github.com/ankitlade12/shadow-zoo

## Built with

webxr, immersive-web-sdk, three.js, typescript, web-audio-api, mediapipe, vite, github-pages

## About the project

Paste into the "About the project" field (Markdown), which uses Devpost's headings.

### Inspiration

Every kid has made a rabbit on the wall with a flashlight. We wanted the moment your hand becomes an animal to keep going: what if the shadow hopped off your hand, and stayed?

### What it does

Shadow Zoo turns the wall in front of you into a stage. A warm lantern glows behind you and lights your real wall. A glowing outline appears: a rabbit. Shape your hand until its shadow fits, and the rabbit wriggles free, hops along your wall and blinks at you.

Seven creatures wait to be discovered, each a real shadow puppet with its own personality: rabbit, dog, crocodile, peacock, spider, turtle, and the bird, which takes both hands. Hook your thumbs, spread your fingers, and it takes wing.

Then you play with them, using nothing but your hands:

- **Feed:** pinch to release a firefly, and your creatures chase it down.
- **Pet:** rest your shadow on a creature to earn hearts. At three hearts it learns a trick.
- **Wear:** make a creature's shape and become it. Snap its jaw and your dog barks, and the rabbits scatter.

Every match earns up to three stars, a row of silhouettes on the wall shows who's still missing, and finding the last one sets off a finale and turns the lantern gold. Your zoo is saved and greets you tomorrow, and daily visitors bring a twist: a shy one you must hold perfectly still, or a big one that makes you bring your hand closer to the light.

It's hands-only and seated, with a complete moment in under ten minutes, and it only works with your real wall and your real hands.

### How we built it

- **Meta's Immersive Web SDK (WebXR):** one link, nothing to install. Plane detection finds your wall; hand tracking gives 25 joints per hand.
- **A shadow engine:** each hand's bones are projected from a virtual flame onto the wall as soft capsules and composited over passthrough in a single pass, light enough for standalone hardware. Edges soften as your hand nears the lantern, and the flame flickers like candlelight.
- **Shape matching:** overlap plus a 64-direction radial signature, robust to hand size, rotation and tracking noise.
- **Sound:** every sound is synthesized live and placed on the wall in 3D.

### Challenges we ran into

- **Telling creatures apart.** Hand silhouettes share a big palm blob, so a plain overlap score confused them (0.83 between two creatures). The radial signature cut the worst confusion to under 0.4, against a match threshold of 0.62.
- **Finding the right wall.** A picture frame was detected as the wall. The game now prefers real walls by size and label, and falls back to a paper screen when no wall is found.
- **A crowded wall.** Six creatures merged into one dark blob. The zoo now shrinks to a shared size and walkers spread into the gaps; overlaps fell from about 30% to under 10%.
- **Two hands, one shadow.** The bird scores both hands together and keeps their true spacing.

### Accomplishments that we're proud of

- A complete game with no controllers and no reading: a glowing ghost hand teaches every shape.
- Shadows that behave like real light, cheap enough for standalone hardware.
- Playable anywhere: on Quest with your hands, and on any computer, even with your real hands through a webcam.
- 188 automated tests and an emulator drill that brings all seven creatures to life.

### What we learned

Hands-first design is mostly about forgiveness: real hands shake, so matching must tolerate noise, holds must be short, and every shape needs a demonstration. And mixed reality is at its most magical when the game borrows something real: your wall, and your hands.

### What's next for Shadow Zoo

More two-handed creatures, a shadow-theater mode for performing stories, and shared zoos you can visit with friends. Target launch: March 2027, as a free web app for Meta Quest.

## How hand interactions work (optional field)

Your hands are the controller and the content. The game reads all 25 joints of each tracked hand and casts them as a shadow from a virtual lantern, so the shape of your hand is the input. Bringing a creature to life means holding a real shadow-puppet pose. A pinch releases a firefly, resting your hand's shadow on a creature pets it, and snapping a worn creature's jaw makes it speak. Even the menu is hands-only: point and pinch. That is what excites us about the future of VR: the real room becoming the canvas, and the most natural input there is, your hands, becoming the whole game.

## Target launch date

March 2027

## Testing instructions for judges

- **Meta Quest 3 or 3S:** open the link in Meta Quest Browser, sit facing a wall in a lit room and put your controllers down. Press **Light the lantern**, and allow hand tracking and spatial data when asked.
- **No headset:** the same link opens a desktop preview in Meta's WebXR emulator with a virtual living room. Choose real hands through your webcam (tracked on your device, never recorded or sent), or play with the mouse, where keys 1 to 7 make the shapes.
- The demo video is captured in Meta's IWSDK WebXR emulator, and says so on screen.

## Team

A team of two; names, emails and roles go in the Devpost form.
