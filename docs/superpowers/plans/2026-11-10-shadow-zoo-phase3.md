# Shadow Zoo Phase 3 (presentation and shipping) — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- A polished 2D landing page that judges see in Quest Browser before entering, with a start button and an honest support note.
- A README and a Devpost write-up draft.
- A GitHub Pages deploy workflow, prepared but not pushed until the user approves.
- An emulator pose drill that proves each creature can be matched with emulated hands. It doubles as the scripted demo for the video.

**Spec:** §2.1 (2D page), §3.8 (build, hosting, submission). Publishing, pushing and submitting need the user's explicit OK.

---

### Task 1: Landing page

**Files:**
- Rewrite: `index.html`
- Create: `src/ui/landing.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write the page**

**File: `index.html#landing`**
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta
      name="description"
      content="Make shadow puppets with your hands on your real wall, and watch them come alive. A hands-first mixed reality game for Meta Quest."
    />
    <meta name="theme-color" content="#1b120c" />
    <link rel="icon" href="data:," />
    <title>Shadow Zoo</title>
    <style>
      :root {
        --ink: #ffe9c7;
        --muted: #d9c3a3;
        --glow: #ffc27a;
        --bg0: #120c08;
        --bg1: #2a1a10;
      }
      html,
      body {
        margin: 0;
        height: 100%;
        background: var(--bg0);
        color: var(--ink);
        font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
      }
      #scene-container {
        position: fixed;
        inset: 0;
      }
      #landing {
        position: fixed;
        inset: 0;
        display: grid;
        place-items: center;
        padding: 24px;
        box-sizing: border-box;
        overflow: auto;
        background:
          radial-gradient(60% 50% at 50% 36%, rgba(255, 194, 122, 0.28), rgba(255, 194, 122, 0) 70%),
          linear-gradient(180deg, var(--bg1), var(--bg0));
      }
      #landing[hidden] {
        display: none;
      }
      .card {
        max-width: 640px;
        text-align: center;
      }
      h1 {
        font-family: 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif;
        font-weight: 600;
        font-size: clamp(44px, 9vw, 84px);
        margin: 0 0 8px;
        letter-spacing: 0.5px;
        text-shadow: 0 0 40px rgba(255, 194, 122, 0.35);
      }
      .tagline {
        font-size: clamp(18px, 3.2vw, 24px);
        line-height: 1.45;
        color: var(--muted);
        margin: 0 auto 28px;
        max-width: 30ch;
      }
      ol {
        list-style: none;
        padding: 0;
        margin: 0 auto 32px;
        display: grid;
        gap: 14px;
        text-align: left;
        max-width: 460px;
      }
      li {
        display: grid;
        grid-template-columns: 40px 1fr;
        gap: 14px;
        align-items: center;
        font-size: 18px;
        line-height: 1.4;
      }
      .n {
        width: 40px;
        height: 40px;
        border-radius: 50%;
        display: grid;
        place-items: center;
        background: rgba(255, 194, 122, 0.14);
        color: var(--glow);
        font-weight: 700;
      }
      #start {
        font: inherit;
        font-size: 22px;
        font-weight: 700;
        color: #26170c;
        background: var(--glow);
        border: 0;
        border-radius: 999px;
        padding: 18px 40px;
        min-width: 260px;
        min-height: 64px;
        cursor: pointer;
        transition:
          transform 0.15s ease,
          box-shadow 0.3s ease;
      }
      #start:hover,
      #start:focus-visible {
        transform: translateY(-1px);
        box-shadow: 0 0 36px 4px rgba(255, 194, 122, 0.45);
        outline: none;
      }
      .note {
        margin-top: 18px;
        font-size: 15px;
        color: var(--muted);
      }
      .fine {
        margin-top: 28px;
        font-size: 13px;
        color: rgba(217, 195, 163, 0.75);
      }
      @media (prefers-reduced-motion: reduce) {
        #start {
          transition: none;
        }
      }
    </style>
  </head>
  <body>
    <div id="scene-container"></div>
    <main id="landing">
      <div class="card">
        <h1>Shadow Zoo</h1>
        <p class="tagline">Make shadow puppets with your hands on your real wall, and watch them come alive.</p>
        <ol>
          <li><span class="n">1</span><span>Sit facing a wall in a lit room and put your controllers down.</span></li>
          <li><span class="n">2</span><span>Shape your hand until its shadow fits the glowing outline.</span></li>
          <li><span class="n">3</span><span>Pinch for fireflies, rest your shadow to pet, and come back tomorrow.</span></li>
        </ol>
        <button id="start" type="button">Light the lantern</button>
        <p class="note" id="support">Made for Meta Quest 3 and 3S. Hands only, seated.</p>
        <p class="fine">Your zoo is saved only on this device. No accounts, no tracking.</p>
      </div>
    </main>
    <script type="module" src="/src/index.ts"></script>
  </body>
</html>
```

**File: `src/ui/landing.ts`**
```ts
import { VisibilityState, type World } from '@iwsdk/core';

interface XRSystemLike {
  isSessionSupported(mode: string): Promise<boolean>;
}

/** Shows the 2D welcome page outside XR and starts the AR session from its button. */
export function mountLanding(world: World): void {
  const landing = document.getElementById('landing');
  const start = document.getElementById('start');
  const support = document.getElementById('support');
  if (!landing || !start) return;
  start.addEventListener('click', () => world.launchXR());
  world.visibilityState.subscribe((state) => {
    landing.hidden = state !== VisibilityState.NonImmersive;
  });
  const xr = (navigator as Navigator & { xr?: XRSystemLike }).xr;
  const supported = xr ? xr.isSessionSupported('immersive-ar').catch(() => false) : Promise.resolve(false);
  void supported.then((ok) => {
    if (!ok && support) support.textContent = 'Open this page in Meta Quest Browser to play. This browser cannot start mixed reality.';
  });
}
```

Edit `src/index.ts`: import `{ mountLanding } from './ui/landing.js'` and call `mountLanding(world);` after the `registerSystem` chain inside `.then`.

- [ ] **Step 2: Verify**

Run: `npm run typecheck && npm test && npm run build`. Then reload the managed browser and capture a screenshot outside XR: `docs/evidence/p3-landing.png`. The title, steps and button must be readable and centered.

- [ ] **Step 3: Commit**

```bash
git add index.html src/ui/landing.ts src/index.ts docs/evidence/p3-landing.png
git commit -m "feat: add the landing page with a start button and support note"
```

---

### Task 2: README, Devpost draft, Pages workflow

**Files:**
- Create: `README.md`, `docs/devpost.md`, `.github/workflows/deploy.yml`

- [ ] **Step 1: Write the files**

These are prose plus a standard GitHub Pages workflow:
- `actions/checkout@v4`, `actions/setup-node@v4` (Node 22, npm cache), `npm ci`, `npm test`, `npm run build`, `actions/upload-pages-artifact@v3` (path `dist`), `actions/deploy-pages@v4`;
- permissions `pages: write`, `id-token: write`;
- triggers: push to `main` and `workflow_dispatch`.

The README covers:
- what the game is and how to play;
- running locally (`npm install`, `npm run dev`, emulator workflow);
- tests;
- architecture (core, game, systems, render);
- privacy (local storage only);
- honest limits (emulator-tested, no physical headset).

`docs/devpost.md` holds:
- name, tagline (140 characters or fewer), track Gaming, division New Experience;
- the description (about 450 words);
- inspiration, how it was built, challenges, accomplishments, what we learned, what's next.

It must not claim "first", and it must state that it was tested in the IWSDK emulator.

- [ ] **Step 2: Verify**

Run: `npx --no-install prettier --check README.md docs/devpost.md` if Prettier is present; otherwise skip. Check the tagline length is 140 characters or fewer with a one-line `node -e` script.

- [ ] **Step 3: Commit**

```bash
git add README.md docs/devpost.md .github/workflows/deploy.yml
git commit -m "docs: add README, Devpost draft and GitHub Pages workflow"
```

---

### Task 3: Emulator pose drill (robustness and demo)

**Files:**
- Create: `scripts/drill.sh`, `docs/checkpoint-phase3.md`

- [ ] **Step 1: Write the drill**

`scripts/drill.sh` uses `./node_modules/.bin/iwsdk` to:
1. reload;
2. enter XR;
3. switch to hand input;
4. for each creature in order, set an approximating built-in pose with finger blends and place the right hand at the comfortable point with the creature's facing (mirrored for the right hand), then wait up to 25 s for the `reveal` sound event in `browser logs`;
5. take one screenshot per creature;
6. print the time to match.

Built-in approximations:
- rabbit: `peace`
- dog: `flat` with thumb from `thumbs-up`
- crocodile: `flat` with thumb from `open`
- peacock: `open`
- spider: `claw` with thumb from `open`
- turtle: `thumbs-up`

Because progress persists, the drill begins with a fresh zoo by pressing Reset twice through the menu, or by running in a fresh profile after a dev-server restart.

- [ ] **Step 2: Run it and record**

Run `bash scripts/drill.sh`. Record the time to match for each creature and its screenshot in `docs/checkpoint-phase3.md`. A creature that never matches with its approximation shows where real hands may struggle. Respond by tuning that creature's pose or facing, or the assist relaxation, and rerun the library tests.

- [ ] **Step 3: Commit**

```bash
git add scripts/drill.sh docs
git commit -m "test: emulator pose drill for all six creatures"
```
