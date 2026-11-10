# Shadow Zoo Phase 1 (vertical slice) — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the IWSDK emulator's living room, the player's tracked hand casts a soft shadow on the real wall, inside a warm pool of lantern light. A glowing rabbit outline appears, and when the hand's shadow matches it, a living shadow rabbit hops away. After a pause, the other five creatures appear in turn as visitors. This meets the spec's Nov 11 checkpoint.

**Architecture:**
- Pure TypeScript modules in `src/core/` do all the work:
  - hand joints and poses (IWER's skeleton);
  - point-light projection onto the wall;
  - silhouette rasterizing and IoU matching;
  - wall choice, the match state machine and creature motion.
- These modules are unit-tested with Vitest and have no IWSDK imports.
- Four thin IWSDK systems connect them to WebXR: Hand → Stage → Game → Render.
- Rendering draws signed-distance capsules into a small 2D mask once per frame, then composites the mask over passthrough with one wall-aligned quad.

**Tech stack:** IWSDK 1.1.0-rc.2 (`@iwsdk/core`, `@iwsdk/cli`, `@iwsdk/vite-plugin-dev`), `three` as `super-three@0.185.0` (imported only through `@iwsdk/core`), `iwer` 2.8.0 (pose builder), TypeScript 5, Vite 7, Vitest 3.

**Spec:** `docs/superpowers/specs/2026-11-09-shadow-zoo-design.md`

**Conventions:**
- All commands run in `shadow-zoo/`.
- Import Three.js classes from `@iwsdk/core`, never from `three`.
- No allocation inside per-frame hot loops (projector, rasterizer, systems).
- Stage coordinates: `u` is right, `v` is up, `n` points out of the wall toward the player; units are meters.

---

## File structure

| File | Responsibility |
|---|---|
| `package.json`, `iwsdk.config.json`, `vite.config.ts`, `vitest.config.ts`, `tsconfig.json`, `index.html`, `.gitignore`, `.nvmrc` | Project and tool configuration (IWSDK manifest is the authority) |
| `public/scenes/main.iwsdk.scene.json` | Empty AR scene |
| `src/index.ts` | `World.create` and system registration (explicit priorities) |
| `src/assets.ts`, `src/components.ts` | Empty IWSDK asset and component catalogs |
| `src/core/vec.ts` | Tuple vector helpers for setup-time math |
| `src/core/rng.ts` | Seeded RNG (`mulberry32`) |
| `src/core/joints.ts` | WebXR joint names and indices; bone list (capsule pairs) |
| `src/core/poses.ts` | IWER pose building, joint sets, hand frame, orientation, mirroring |
| `src/core/projector.ts` | Point-light projection of joints and bones onto the stage plane |
| `src/core/silhouette.ts` | Capsule rasterizer, shape measurement, IoU, target shapes, match score |
| `src/core/library.ts` | The six creature definitions and canonical silhouettes |
| `src/core/matcher.ts` | Assist tuning and the match state machine |
| `src/core/stage.ts` | Wall choice, stage basis, light pool, lantern, fallback screen |
| `src/core/creature.ts` | Hopping shadow creature (wander within the light pool) |
| `src/render/ShadowCanvas.ts` | Mask render target, capsule instancing, composite shader |
| `src/runtime/store.ts` | Shared per-frame state between systems |
| `src/runtime/testpose.ts` | Dev-only synthetic hand pose hook (`VITE_TESTPOSE` / `?testpose=`) |
| `src/systems/HandSystem.ts` | WebXR joints to `store.hands` (hides virtual hands) |
| `src/systems/StageSystem.ts` | `XRPlane` entities to `store.stage` (with fallback) |
| `src/systems/GameSystem.ts` | Projection, visitors, matching, reveal, creatures; fills the canvas |
| `src/systems/RenderSystem.ts` | Owns the canvas entity; renders the mask each frame |
| `tests/core/*.test.ts` | Unit tests per core module |
| `tests/support/png.ts`, `tests/sheet.gen.test.ts` | PNG encoder and silhouette contact-sheet generator |
| `docs/checkpoint-phase1.md` | Checkpoint evidence (screenshots, test results, limits) |

---

### Task 1: Scaffold the IWSDK project

**Files:** create every file listed below.

- [ ] **Step 1: Write the configuration files**

**File: `package.json`**
```json
{
  "name": "shadow-zoo",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "iwsdk dev restart --open --foreground",
    "dev:runtime": "vite",
    "dev:down": "iwsdk dev down",
    "dev:status": "iwsdk dev status",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "sheet": "SHEET=1 vitest run tests/sheet.gen.test.ts",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "@iwsdk/core": "1.1.0-rc.2",
    "@pmndrs/uikit": "^1.0.74",
    "@pmndrs/uikit-horizon": "^1.0.74",
    "@pmndrs/uikit-lucide": "^1.0.74",
    "iwer": "2.8.0",
    "three": "npm:super-three@0.185.0"
  },
  "devDependencies": {
    "@iwsdk/cli": "1.1.0-rc.2",
    "@iwsdk/vite-plugin-dev": "1.1.0-rc.2",
    "@types/node": "^22.10.0",
    "@types/three": "^0.185.0",
    "typescript": "^5.5.0",
    "vite": "^7.1.4",
    "vitest": "^3.2.4"
  },
  "overrides": {
    "sharp": "0.35.4",
    "three": "npm:super-three@0.185.0"
  },
  "engines": {
    "node": ">=20.19.0 <21.0.0-0 || >=22.12.0 <23.0.0-0 || >=24.0.0"
  }
}
```

**File: `iwsdk.config.json`**
```json
{
  "$schema": "./node_modules/@iwsdk/core/dist/schemas/iwsdk-project.v1.schema.json",
  "version": "iwsdk.project.v1",
  "scene": "./public/scenes/main.iwsdk.scene.json",
  "assets": { "module": "./src/assets" },
  "components": { "module": "./src/components" },
  "world": {
    "xr": {
      "mode": "ar",
      "offer": "always",
      "features": {
        "handTracking": { "required": true },
        "planeDetection": true
      }
    },
    "input": { "canvasPointerEvents": true },
    "render": {
      "fov": 70,
      "near": 0.01,
      "far": 50,
      "camera": { "position": [0, 1.6, 0], "lookAt": [0, 1.5, -2] }
    },
    "features": {
      "locomotion": false,
      "grabbing": false,
      "physics": false,
      "sceneUnderstanding": true,
      "environmentRaycast": false,
      "spatialUI": { "kit": "horizon", "preferredColorScheme": "dark" }
    }
  },
  "dev": {
    "emulator": { "device": "metaQuest3", "environment": "sunlit_living_room" }
  }
}
```

**File: `vite.config.ts`**
```ts
import { iwsdkDev } from '@iwsdk/vite-plugin-dev';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [iwsdkDev()],
  server: { host: '0.0.0.0', port: 8081, open: false },
  build: {
    outDir: 'dist',
    sourcemap: process.env.NODE_ENV !== 'production',
    target: 'esnext',
    rollupOptions: { input: './index.html' },
  },
  esbuild: { target: 'esnext' },
  resolve: {
    dedupe: ['three', '@pmndrs/uikit', '@pmndrs/uikit-horizon', '@pmndrs/uikit-lucide'],
  },
  optimizeDeps: {
    exclude: ['@babylonjs/havok'],
    include: ['three', '@pmndrs/uikit', '@pmndrs/uikit-horizon', '@pmndrs/uikit-lucide'],
    esbuildOptions: { target: 'esnext' },
  },
  publicDir: 'public',
  base: './',
});
```

**File: `vitest.config.ts`**
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
```

**File: `tsconfig.json`**
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["@iwsdk/vite-plugin-dev/client", "node"]
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

**File: `index.html`**
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
    <link rel="icon" href="data:," />
    <title>Shadow Zoo</title>
  </head>
  <body style="margin: 0; background: #120d0a">
    <div id="scene-container"></div>
    <script type="module" src="/src/index.ts"></script>
  </body>
</html>
```

**File: `.gitignore`**
```
node_modules/
dist/
.env
.env.local
.DS_Store
coverage/
.tmp/
.iwsdk/
.mcp.json
.cursor/mcp.json
.vscode/mcp.json
.codex/config.toml
```

**File: `.nvmrc`**
```
24
```

**File: `public/scenes/main.iwsdk.scene.json`**
```json
{
  "version": "iwsdk.scene.v1",
  "units": "meters",
  "components": {},
  "environment": { "toneMapping": "aces", "exposure": 1, "shadows": false },
  "resources": {},
  "nodes": []
}
```

**File: `src/vite-env.d.ts`**
```ts
/// <reference types="vite/client" />
/// <reference types="@iwsdk/vite-plugin-dev/client" />
```

**File: `src/assets.ts`**
```ts
import { defineAssets } from '@iwsdk/core';

export default defineAssets({});
```

**File: `src/components.ts`**
```ts
import { defineComponents } from '@iwsdk/core';

export default defineComponents([]);
```

**File: `src/index.ts`**
```ts
import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';

World.create(document.getElementById('scene-container') as HTMLDivElement, projectOptions);
```

- [ ] **Step 2: Install dependencies**

Run: `npm install`
Expected: completes without errors.
- Check that `npm ls iwer` shows a single `iwer@2.8.0`. If `@iwsdk/vite-plugin-dev` pins a different `iwer`, change the `iwer` version in `package.json` to match and run `npm install` again.

- [ ] **Step 3: Typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: no TypeScript errors; Vite prints `✓ built in` and writes `dist/index.html`.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json iwsdk.config.json vite.config.ts vitest.config.ts tsconfig.json index.html .gitignore .nvmrc public src
git commit -m "chore: scaffold IWSDK AR project for Shadow Zoo"
```

---

### Task 2: Vector helpers and seeded RNG

**Files:**
- Create: `src/core/vec.ts`, `src/core/rng.ts`
- Test: `tests/core/vec.test.ts`

- [ ] **Step 1: Write the failing test**

**File: `tests/core/vec.test.ts`**
```ts
import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../src/core/rng.js';
import { add, cross, dot, length, normalize, scale, sub } from '../../src/core/vec.js';

describe('vec', () => {
  it('does basic arithmetic', () => {
    expect(add([1, 2, 3], [1, 1, 1])).toEqual([2, 3, 4]);
    expect(sub([1, 2, 3], [1, 1, 1])).toEqual([0, 1, 2]);
    expect(scale([1, 2, 3], 2)).toEqual([2, 4, 6]);
    expect(dot([1, 2, 3], [4, 5, 6])).toBe(32);
    expect(cross([1, 0, 0], [0, 1, 0])).toEqual([0, 0, 1]);
    expect(length([3, 4, 0])).toBe(5);
  });

  it('normalizes and survives zero vectors', () => {
    const n = normalize([0, 3, 4]);
    expect(n[1]).toBeCloseTo(0.6);
    expect(n[2]).toBeCloseTo(0.8);
    expect(normalize([0, 0, 0])).toEqual([0, 0, 0]);
  });
});

describe('mulberry32', () => {
  it('is deterministic and in [0, 1)', () => {
    const a = mulberry32(5);
    const b = mulberry32(5);
    for (let i = 0; i < 100; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/vec.test.ts`
Expected: FAIL. The error says it can't resolve `../../src/core/rng.js`.

- [ ] **Step 3: Write minimal implementation**

**File: `src/core/vec.ts`**
```ts
/** Minimal 3D vector helpers for setup-time math. Hot loops use scalar code instead. */
export type Vec3 = readonly [number, number, number];

export const UP: Vec3 = [0, 1, 0];

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const length = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export const normalize = (a: Vec3): Vec3 => {
  const l = length(a);
  return l > 1e-9 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
};
```

**File: `src/core/rng.ts`**
```ts
/** Small, fast, seeded PRNG returning values in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/vec.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/vec.ts src/core/rng.ts tests/core/vec.test.ts
git commit -m "feat(core): add vector helpers and seeded RNG"
```

---

### Task 3: Joint table and bone list

**Files:**
- Create: `src/core/joints.ts`
- Test: `tests/core/joints.test.ts`

- [ ] **Step 1: Write the failing test**

**File: `tests/core/joints.test.ts`**
```ts
import { describe, expect, it } from 'vitest';
import { BONES, J, JOINT_COUNT, JOINT_INDEX, JOINT_NAMES } from '../../src/core/joints.js';

describe('joints', () => {
  it('lists the 25 WebXR hand joints in spec order', () => {
    expect(JOINT_COUNT).toBe(25);
    expect(JOINT_NAMES[0]).toBe('wrist');
    expect(JOINT_NAMES[24]).toBe('pinky-finger-tip');
    expect(JOINT_INDEX['index-finger-tip']).toBe(J.indexTip);
  });

  it('builds bones between valid, distinct joints', () => {
    expect(BONES.length).toBe(24);
    for (const bone of BONES) {
      expect(bone.a).not.toBe(bone.b);
      expect(bone.a).toBeGreaterThanOrEqual(0);
      expect(bone.b).toBeLessThan(JOINT_COUNT);
    }
  });

  it('reaches every fingertip', () => {
    const tips = [J.thumbTip, J.indexTip, J.middleTip, J.ringTip, J.pinkyTip];
    for (const tip of tips) expect(BONES.some((b) => b.b === tip)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/joints.test.ts`
Expected: FAIL. The error says it can't resolve `../../src/core/joints.js`.

- [ ] **Step 3: Write minimal implementation**

**File: `src/core/joints.ts`**
```ts
/** WebXR hand joints, in the order defined by the WebXR Hand Input spec. */
export const JOINT_NAMES = [
  'wrist',
  'thumb-metacarpal',
  'thumb-phalanx-proximal',
  'thumb-phalanx-distal',
  'thumb-tip',
  'index-finger-metacarpal',
  'index-finger-phalanx-proximal',
  'index-finger-phalanx-intermediate',
  'index-finger-phalanx-distal',
  'index-finger-tip',
  'middle-finger-metacarpal',
  'middle-finger-phalanx-proximal',
  'middle-finger-phalanx-intermediate',
  'middle-finger-phalanx-distal',
  'middle-finger-tip',
  'ring-finger-metacarpal',
  'ring-finger-phalanx-proximal',
  'ring-finger-phalanx-intermediate',
  'ring-finger-phalanx-distal',
  'ring-finger-tip',
  'pinky-finger-metacarpal',
  'pinky-finger-phalanx-proximal',
  'pinky-finger-phalanx-intermediate',
  'pinky-finger-phalanx-distal',
  'pinky-finger-tip',
] as const;

export type JointName = (typeof JOINT_NAMES)[number];
export const JOINT_COUNT = JOINT_NAMES.length;
export const JOINT_INDEX: Readonly<Record<string, number>> = Object.fromEntries(
  JOINT_NAMES.map((name, i) => [name, i]),
);

export const J = {
  wrist: 0,
  thumbMeta: 1,
  thumbProx: 2,
  thumbDist: 3,
  thumbTip: 4,
  indexMeta: 5,
  indexProx: 6,
  indexInter: 7,
  indexDist: 8,
  indexTip: 9,
  middleMeta: 10,
  middleProx: 11,
  middleInter: 12,
  middleDist: 13,
  middleTip: 14,
  ringMeta: 15,
  ringProx: 16,
  ringInter: 17,
  ringDist: 18,
  ringTip: 19,
  pinkyMeta: 20,
  pinkyProx: 21,
  pinkyInter: 22,
  pinkyDist: 23,
  pinkyTip: 24,
} as const;

/** A tapered capsule between two joints. `radius` (meters) overrides the joint radii. */
export interface Bone {
  readonly a: number;
  readonly b: number;
  readonly radius?: number;
}

const chain = (...idx: number[]): Bone[] => idx.slice(1).map((b, i) => ({ a: idx[i], b }));

/** Capsules that together cover a hand: four bones per digit plus a filled palm. */
export const BONES: readonly Bone[] = [
  ...chain(J.thumbMeta, J.thumbProx, J.thumbDist, J.thumbTip),
  ...chain(J.indexProx, J.indexInter, J.indexDist, J.indexTip),
  ...chain(J.middleProx, J.middleInter, J.middleDist, J.middleTip),
  ...chain(J.ringProx, J.ringInter, J.ringDist, J.ringTip),
  ...chain(J.pinkyProx, J.pinkyInter, J.pinkyDist, J.pinkyTip),
  { a: J.wrist, b: J.thumbMeta, radius: 0.02 },
  { a: J.wrist, b: J.indexProx, radius: 0.017 },
  { a: J.wrist, b: J.middleProx, radius: 0.022 },
  { a: J.wrist, b: J.ringProx, radius: 0.02 },
  { a: J.wrist, b: J.pinkyProx, radius: 0.017 },
  { a: J.indexProx, b: J.middleProx, radius: 0.012 },
  { a: J.middleProx, b: J.ringProx, radius: 0.012 },
  { a: J.ringProx, b: J.pinkyProx, radius: 0.011 },
  { a: J.thumbMeta, b: J.indexProx, radius: 0.012 },
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/joints.test.ts`
Expected: PASS (3 tests). The bone count is 3 for the thumb, 3 for each of four fingers, plus 9 for the palm: 3 + 12 + 9 = 24.

- [ ] **Step 5: Commit**

```bash
git add src/core/joints.ts tests/core/joints.test.ts
git commit -m "feat(core): add WebXR joint table and hand bone list"
```

---

### Task 4: Poses built on IWER's skeleton

**Files:**
- Create: `src/core/poses.ts`
- Test: `tests/core/poses.test.ts`

- [ ] **Step 1: Write the failing test**

**File: `tests/core/poses.test.ts`**
```ts
import { describe, expect, it } from 'vitest';
import { J, JOINT_COUNT } from '../../src/core/joints.js';
import {
  buildJointSet,
  builtinAngles,
  handFrame,
  jointPos,
  mirrorJointSet,
  orientJointSet,
} from '../../src/core/poses.js';
import { dot, length, sub } from '../../src/core/vec.js';

describe('poses', () => {
  it('builds a 25-joint hand of plausible size', () => {
    const js = buildJointSet(builtinAngles.flat);
    expect(js.pos.length).toBe(JOINT_COUNT * 3);
    const reach = length(sub(jointPos(js, J.middleTip), jointPos(js, J.wrist)));
    expect(reach).toBeGreaterThan(0.14);
    expect(reach).toBeLessThan(0.24);
    expect(js.rad[J.indexTip]).toBeGreaterThan(0.003);
  });

  it('a fist is more compact than a flat hand', () => {
    const tip = (name: string) => {
      const js = buildJointSet(builtinAngles[name]);
      return length(sub(jointPos(js, J.middleTip), jointPos(js, J.wrist)));
    };
    expect(tip('fist')).toBeLessThan(tip('flat') * 0.7);
  });

  it('orients a hand to the requested axes with the wrist at the anchor', () => {
    const out = orientJointSet(buildJointSet(builtinAngles.flat), 'left', { fingers: [0, 1, 0], palm: [0, 0, 1] }, [1, 2, 3]);
    const f = handFrame(out, 'left');
    expect(dot(f.fingers, [0, 1, 0])).toBeGreaterThan(0.999);
    expect(dot(f.palm, [0, 0, 1])).toBeGreaterThan(0.999);
    const w = jointPos(out, J.wrist);
    expect(w[0]).toBeCloseTo(1);
    expect(w[1]).toBeCloseTo(2);
    expect(w[2]).toBeCloseTo(3);
  });

  it('IWER poses are left hands: palm down and fingers forward puts the thumb on the right', () => {
    const js = orientJointSet(buildJointSet(builtinAngles.flat), 'left', { fingers: [0, 0, -1], palm: [0, -1, 0] }, [0, 0, 0]);
    expect(jointPos(js, J.thumbTip)[0]).toBeGreaterThan(0.02);
  });

  it('mirroring yields a right hand with a consistent frame', () => {
    const left = orientJointSet(buildJointSet(builtinAngles.flat), 'left', { fingers: [0, 0, -1], palm: [0, -1, 0] }, [0, 0, 0]);
    const right = handFrame(mirrorJointSet(left), 'right');
    expect(dot(right.palm, [0, -1, 0])).toBeGreaterThan(0.99);
    expect(dot(right.fingers, [0, 0, -1])).toBeGreaterThan(0.99);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/poses.test.ts`
Expected: FAIL. The error says it can't resolve `../../src/core/poses.js`.

- [ ] **Step 3: Write minimal implementation**

**File: `src/core/poses.ts`**
```ts
import { buildHandPose, type HandPoseAngles } from 'iwer/lib/device/configs/hand/builder.js';
import { handPoseAngles } from 'iwer/lib/device/configs/hand/library.js';
import { pinchHandPose } from 'iwer/lib/device/configs/hand/pinch.js';
import { relaxedHandPose } from 'iwer/lib/device/configs/hand/relaxed.js';
import type { HandPose } from 'iwer/lib/device/XRHandInput.js';
import { J, JOINT_COUNT, JOINT_NAMES } from './joints.js';
import { cross, dot, normalize, sub, type Vec3 } from './vec.js';

export type { HandPoseAngles };
export type Handedness = 'left' | 'right';

/** 25 joint positions (xyz, meters) and radii, all in one coordinate space. */
export interface JointSet {
  readonly pos: Float32Array;
  readonly rad: Float32Array;
}

export const createJointSet = (): JointSet => ({
  pos: new Float32Array(JOINT_COUNT * 3),
  rad: new Float32Array(JOINT_COUNT),
});

/** IWER's built-in pose angles (open, flat, fist, thumbs-up, peace, claw, ...). */
export const builtinAngles = handPoseAngles as Readonly<Record<string, HandPoseAngles>>;

type JointTransforms = Record<string, { offsetMatrix: ArrayLike<number>; radius: number }>;

export function jointSetFromHandPose(pose: HandPose, out: JointSet = createJointSet()): JointSet {
  const transforms = pose.jointTransforms as unknown as JointTransforms;
  for (let i = 0; i < JOINT_COUNT; i++) {
    const t = transforms[JOINT_NAMES[i]];
    out.pos[i * 3] = t.offsetMatrix[12];
    out.pos[i * 3 + 1] = t.offsetMatrix[13];
    out.pos[i * 3 + 2] = t.offsetMatrix[14];
    out.rad[i] = t.radius;
  }
  return out;
}

/** Builds a left-hand joint set from joint angles on IWER's captured skeleton. */
export function buildJointSet(angles: HandPoseAngles): JointSet {
  return jointSetFromHandPose(buildHandPose(angles, relaxedHandPose, pinchHandPose));
}

export const jointPos = (js: JointSet, i: number): Vec3 => [js.pos[i * 3], js.pos[i * 3 + 1], js.pos[i * 3 + 2]];

export function copyJointSet(src: JointSet, out: JointSet = createJointSet()): JointSet {
  out.pos.set(src.pos);
  out.rad.set(src.rad);
  return out;
}

/** Mirrors across x (left-hand data to right hand and back). */
export function mirrorJointSet(src: JointSet, out: JointSet = createJointSet()): JointSet {
  for (let i = 0; i < JOINT_COUNT; i++) {
    out.pos[i * 3] = -src.pos[i * 3];
    out.pos[i * 3 + 1] = src.pos[i * 3 + 1];
    out.pos[i * 3 + 2] = src.pos[i * 3 + 2];
    out.rad[i] = src.rad[i];
  }
  return out;
}

/** Orthonormal hand axes. fingers: along the middle metacarpal. palm: out of the palm. side: palm × fingers. */
export interface HandFrame {
  readonly wrist: Vec3;
  readonly fingers: Vec3;
  readonly palm: Vec3;
  readonly side: Vec3;
}

export function handFrame(js: JointSet, handedness: Handedness): HandFrame {
  const wrist = jointPos(js, J.wrist);
  const fingers = normalize(sub(jointPos(js, J.middleProx), jointPos(js, J.middleMeta)));
  const across = sub(jointPos(js, J.indexProx), jointPos(js, J.pinkyProx));
  const rawPalm = normalize(handedness === 'left' ? cross(fingers, across) : cross(across, fingers));
  const side = normalize(cross(rawPalm, fingers));
  const palm = cross(fingers, side);
  return { wrist, fingers, palm, side };
}

/** Rigidly rotates a hand so its frame matches `target`, with the wrist moved to `anchor`. */
export function orientJointSet(
  src: JointSet,
  handedness: Handedness,
  target: { readonly fingers: Vec3; readonly palm: Vec3 },
  anchor: Vec3,
  out: JointSet = createJointSet(),
): JointSet {
  const from = handFrame(src, handedness);
  const f = normalize(target.fingers);
  const s = normalize(cross(normalize(target.palm), f));
  const p = cross(f, s);
  for (let i = 0; i < JOINT_COUNT; i++) {
    const d = sub(jointPos(src, i), from.wrist);
    const cf = dot(d, from.fingers);
    const cs = dot(d, from.side);
    const cp = dot(d, from.palm);
    for (let k = 0; k < 3; k++) out.pos[i * 3 + k] = anchor[k] + f[k] * cf + s[k] * cs + p[k] * cp;
    out.rad[i] = src.rad[i];
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/poses.test.ts`
Expected: PASS (5 tests).

If the thumb-side test fails, IWER's data is right-handed, not left-handed. In that case:
1. Swap the two `cross` branches in `handFrame`.
2. Change the test's expectation to `toBeLessThan(-0.02)`.
3. Re-run the tests.

- [ ] **Step 5: Commit**

```bash
git add src/core/poses.ts tests/core/poses.test.ts
git commit -m "feat(core): build hand joint sets on IWER skeleton with orient and mirror"
```

---

### Task 5: Point-light shadow projector

**Files:**
- Create: `src/core/projector.ts`
- Test: `tests/core/projector.test.ts`

- [ ] **Step 1: Write the failing test**

**File: `tests/core/projector.test.ts`**
```ts
import { describe, expect, it } from 'vitest';
import { BONES } from '../../src/core/joints.js';
import { buildJointSet, builtinAngles, orientJointSet } from '../../src/core/poses.js';
import { CAPSULE_STRIDE, ShadowProjector, type StagePlane } from '../../src/core/projector.js';

const stage: StagePlane = { origin: [0, 0, -1], u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] };

describe('ShadowProjector', () => {
  it('projects a point through the light onto the stage', () => {
    const p = new ShadowProjector();
    p.setup([0, 0, 1], stage);
    expect(p.project(0.1, 0.05, 0)).toBe(true);
    expect(p.x).toBeCloseTo(0.2);
    expect(p.y).toBeCloseTo(0.1);
    expect(p.t).toBeCloseTo(2);
  });

  it('rejects points behind the light or beyond the wall', () => {
    const p = new ShadowProjector();
    p.setup([0, 0, 1], stage);
    expect(p.project(0, 0, 2)).toBe(false);
    expect(p.project(0, 0, -1.5)).toBe(false);
  });

  it('projects every bone of a hand held between light and wall', () => {
    const p = new ShadowProjector();
    p.setup([0, 0, 1], stage);
    const hand = orientJointSet(buildJointSet(builtinAngles.flat), 'left', { fingers: [0, 1, 0], palm: [0, 0, 1] }, [0, 0, 0]);
    const out = new Float32Array((BONES.length + 1) * CAPSULE_STRIDE);
    const n = p.projectBones(hand, out, 0);
    expect(n).toBe(BONES.length);
    for (let i = 0; i < n; i++) {
      expect(out[i * CAPSULE_STRIDE + 2]).toBeGreaterThan(0.01);
      expect(out[i * CAPSULE_STRIDE + 5]).toBeGreaterThan(0.01);
    }
    expect(p.projectForearm(hand, out, n)).toBe(1);
    const fy = out[n * CAPSULE_STRIDE + 4];
    expect(fy).toBeLessThan(out[n * CAPSULE_STRIDE + 1]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/projector.test.ts`
Expected: FAIL. The error says it can't resolve `../../src/core/projector.js`.

- [ ] **Step 3: Write minimal implementation**

**File: `src/core/projector.ts`**
```ts
import { BONES, J } from './joints.js';
import type { JointSet } from './poses.js';
import type { Vec3 } from './vec.js';

/** One projected capsule: ax, ay, ar, bx, by, br (stage meters). */
export const CAPSULE_STRIDE = 6;

/** The stage plane: origin on the wall; u right, v up, n toward the player. */
export interface StagePlane {
  readonly origin: Vec3;
  readonly u: Vec3;
  readonly v: Vec3;
  readonly n: Vec3;
}

const MIN_RADIUS = 0.006;

/** Projects world points from a point light onto the stage plane. Allocation-free after setup. */
export class ShadowProjector {
  private lx = 0;
  private ly = 0;
  private lz = 0;
  private ox = 0;
  private oy = 0;
  private oz = 0;
  private ux = 1;
  private uy = 0;
  private uz = 0;
  private vx = 0;
  private vy = 1;
  private vz = 0;
  private nx = 0;
  private ny = 0;
  private nz = 1;
  private planeDist = 0;
  /** Last projected point in stage meters and its magnification. */
  x = 0;
  y = 0;
  t = 0;

  setup(light: Vec3, stage: StagePlane): void {
    this.lx = light[0];
    this.ly = light[1];
    this.lz = light[2];
    this.ox = stage.origin[0];
    this.oy = stage.origin[1];
    this.oz = stage.origin[2];
    this.ux = stage.u[0];
    this.uy = stage.u[1];
    this.uz = stage.u[2];
    this.vx = stage.v[0];
    this.vy = stage.v[1];
    this.vz = stage.v[2];
    this.nx = stage.n[0];
    this.ny = stage.n[1];
    this.nz = stage.n[2];
    this.planeDist = (this.ox - this.lx) * this.nx + (this.oy - this.ly) * this.ny + (this.oz - this.lz) * this.nz;
  }

  /** Projects world point P. False when P is not between the light and the wall. */
  project(px: number, py: number, pz: number): boolean {
    const dx = px - this.lx;
    const dy = py - this.ly;
    const dz = pz - this.lz;
    const dn = dx * this.nx + dy * this.ny + dz * this.nz;
    if (dn > -1e-6 || this.planeDist > -1e-6) return false;
    const t = this.planeDist / dn;
    if (t < 1) return false;
    const wx = this.lx + dx * t - this.ox;
    const wy = this.ly + dy * t - this.oy;
    const wz = this.lz + dz * t - this.oz;
    this.x = wx * this.ux + wy * this.uy + wz * this.uz;
    this.y = wx * this.vx + wy * this.vy + wz * this.vz;
    this.t = t;
    return true;
  }

  /** Writes one capsule per visible bone starting at capsule index `start`. Returns the count written. */
  projectBones(joints: JointSet, out: Float32Array, start: number): number {
    const { pos, rad } = joints;
    const max = Math.floor(out.length / CAPSULE_STRIDE);
    let n = 0;
    for (let k = 0; k < BONES.length; k++) {
      if (start + n >= max) break;
      const bone = BONES[k];
      const a = bone.a * 3;
      const b = bone.b * 3;
      if (!this.project(pos[a], pos[a + 1], pos[a + 2])) continue;
      const ax = this.x;
      const ay = this.y;
      const at = this.t;
      if (!this.project(pos[b], pos[b + 1], pos[b + 2])) continue;
      const o = (start + n) * CAPSULE_STRIDE;
      out[o] = ax;
      out[o + 1] = ay;
      out[o + 2] = Math.max(MIN_RADIUS, bone.radius ?? rad[bone.a]) * at;
      out[o + 3] = this.x;
      out[o + 4] = this.y;
      out[o + 5] = Math.max(MIN_RADIUS, bone.radius ?? rad[bone.b]) * this.t;
      n++;
    }
    return n;
  }

  /** A forearm stub from the wrist away from the middle knuckle (drawn, never matched). */
  projectForearm(joints: JointSet, out: Float32Array, start: number, length = 0.16): number {
    if ((start + 1) * CAPSULE_STRIDE > out.length) return 0;
    const p = joints.pos;
    const w = J.wrist * 3;
    const m = J.middleProx * 3;
    let dx = p[w] - p[m];
    let dy = p[w + 1] - p[m + 1];
    let dz = p[w + 2] - p[m + 2];
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-6) return 0;
    dx /= len;
    dy /= len;
    dz /= len;
    if (!this.project(p[w], p[w + 1], p[w + 2])) return 0;
    const ax = this.x;
    const ay = this.y;
    const at = this.t;
    if (!this.project(p[w] + dx * length, p[w + 1] + dy * length, p[w + 2] + dz * length)) return 0;
    const o = start * CAPSULE_STRIDE;
    out[o] = ax;
    out[o + 1] = ay;
    out[o + 2] = 0.026 * at;
    out[o + 3] = this.x;
    out[o + 4] = this.y;
    out[o + 5] = 0.033 * this.t;
    return 1;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/projector.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/projector.ts tests/core/projector.test.ts
git commit -m "feat(core): project hand bones from a point light onto the stage"
```

---

### Task 6: Silhouette rasterizer and matching

**Files:**
- Create: `src/core/silhouette.ts`
- Test: `tests/core/silhouette.test.ts`

- [ ] **Step 1: Write the failing test**

**File: `tests/core/silhouette.test.ts`**
```ts
import { describe, expect, it } from 'vitest';
import { createFrame, iou, matchScore, Silhouettes, TargetShape } from '../../src/core/silhouette.js';

const caps = (list: number[][]) => Float32Array.from(list.flat());
const transform = (src: Float32Array, k: number, dx: number, dy: number, deg: number) => {
  const c = Math.cos((deg * Math.PI) / 180);
  const s = Math.sin((deg * Math.PI) / 180);
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i += 6) {
    for (const [x, y, r] of [[i, i + 1, i + 2], [i + 3, i + 4, i + 5]]) {
      out[x] = (src[x] * c - src[y] * s) * k + dx;
      out[y] = (src[x] * s + src[y] * c) * k + dy;
      out[r] = src[r] * k;
    }
  }
  return out;
};
// An "L": long horizontal bar plus a short vertical bar at its right end.
const ell = caps([[-0.1, 0, 0.018, 0.1, 0, 0.018], [0.1, 0, 0.018, 0.1, 0.09, 0.016]]);
const bar = caps([[-0.15, 0, 0.012, 0.15, 0, 0.012]]);
const ring = caps(
  Array.from({ length: 8 }, (_, i) => {
    const a0 = (i / 8) * Math.PI * 2;
    const a1 = ((i + 1) / 8) * Math.PI * 2;
    return [Math.cos(a0) * 0.1, Math.sin(a0) * 0.1, 0.01, Math.cos(a1) * 0.1, Math.sin(a1) * 0.1, 0.01];
  }),
);

describe('silhouettes', () => {
  const sil = new Silhouettes();

  it('iou is 1 for identical masks and 0 for disjoint ones', () => {
    const a = new Uint8Array([1, 1, 0, 0]);
    expect(iou(a, a)).toBe(1);
    expect(iou(a, new Uint8Array([0, 0, 1, 1]))).toBe(0);
  });

  it('measures the centroid and area of a capsule', () => {
    const f = createFrame();
    const single = caps([[-0.1, 0, 0.02, 0.1, 0, 0.02]]);
    expect(sil.measure(single, 0, 1, f)).toBe(true);
    expect(Math.abs(f.cx)).toBeLessThan(0.005);
    expect(Math.abs(f.cy)).toBeLessThan(0.005);
    const expected = Math.sqrt(0.2 * 0.04 + Math.PI * 0.02 * 0.02);
    expect(Math.abs(f.size - expected) / expected).toBeLessThan(0.08);
  });

  it('is invariant to translation and scale', () => {
    const target = new TargetShape(ell, 2, sil);
    expect(matchScore(sil, transform(ell, 1.7, 0.3, -0.2, 0), 0, 2, target, createFrame())).toBeGreaterThan(0.9);
  });

  it('tolerates small rotations through the search', () => {
    const target = new TargetShape(ell, 2, sil);
    expect(matchScore(sil, transform(ell, 1, 0, 0, 10), 0, 2, target, createFrame())).toBeGreaterThan(0.8);
  });

  it('accepts the mirrored silhouette', () => {
    const target = new TargetShape(ell, 2, sil);
    const mirrored = caps([[0.1, 0, 0.018, -0.1, 0, 0.018], [-0.1, 0, 0.018, -0.1, 0.09, 0.016]]);
    expect(matchScore(sil, mirrored, 0, 2, target, createFrame())).toBeGreaterThan(0.95);
  });

  it('rejects clearly different shapes', () => {
    const target = new TargetShape(ring, 8, sil);
    expect(matchScore(sil, bar, 0, 1, target, createFrame())).toBeLessThan(0.35);
  });

  it('scores zero when there is nothing to match', () => {
    const target = new TargetShape(ell, 2, sil);
    expect(matchScore(sil, ell, 0, 0, target, createFrame())).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/silhouette.test.ts`
Expected: FAIL. The error says it can't resolve `../../src/core/silhouette.js`.

- [ ] **Step 3: Write minimal implementation**

**File: `src/core/silhouette.ts`**
```ts
import { CAPSULE_STRIDE } from './projector.js';

export const GRID = 48;
/** Fraction of the grid spanned by one sqrt(area) of the normalized shape. */
const SPAN = 0.28;
export const ROTATION_SEARCH: readonly number[] = [-24, -12, 0, 12, 24].map((d) => (d * Math.PI) / 180);

/** Centroid (stage meters) and sqrt(area) of a shape. */
export interface ShapeFrame {
  cx: number;
  cy: number;
  size: number;
}
export const createFrame = (): ShapeFrame => ({ cx: 0, cy: 0, size: 0 });

export function iou(a: Uint8Array, b: Uint8Array): number {
  let inter = 0;
  let union = 0;
  for (let i = 0; i < a.length; i++) {
    inter += a[i] & b[i];
    union += a[i] | b[i];
  }
  return union > 0 ? inter / union : 0;
}

/** Rasterizes unions of tapered capsules into square binary masks. */
export class Silhouettes {
  readonly grid: number;
  readonly scratch: Uint8Array;
  private readonly coarse: Uint8Array;

  constructor(grid = GRID) {
    this.grid = grid;
    this.scratch = new Uint8Array(grid * grid);
    this.coarse = new Uint8Array(grid * grid);
  }

  /** Centroid and sqrt(area) of the capsule union, from a raster over its bounding square. */
  measure(caps: Float32Array, start: number, count: number, out: ShapeFrame): boolean {
    if (count <= 0) return false;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < count; i++) {
      const o = (start + i) * CAPSULE_STRIDE;
      minX = Math.min(minX, caps[o] - caps[o + 2], caps[o + 3] - caps[o + 5]);
      maxX = Math.max(maxX, caps[o] + caps[o + 2], caps[o + 3] + caps[o + 5]);
      minY = Math.min(minY, caps[o + 1] - caps[o + 2], caps[o + 4] - caps[o + 5]);
      maxY = Math.max(maxY, caps[o + 1] + caps[o + 2], caps[o + 4] + caps[o + 5]);
    }
    const side = Math.max(maxX - minX, maxY - minY) * 1.04;
    if (!(side > 1e-6)) return false;
    const s = this.grid / side;
    const bx = (minX + maxX) / 2;
    const by = (minY + maxY) / 2;
    const g0 = this.grid / 2;
    const filled = this.fill(caps, start, count, bx, by, s, 0, false, this.coarse);
    if (filled === 0) return false;
    let sx = 0;
    let sy = 0;
    for (let py = 0; py < this.grid; py++) {
      for (let px = 0; px < this.grid; px++) {
        if (this.coarse[py * this.grid + px]) {
          sx += px + 0.5;
          sy += py + 0.5;
        }
      }
    }
    out.cx = (sx / filled - g0) / s + bx;
    out.cy = (sy / filled - g0) / s + by;
    out.size = Math.sqrt(filled) / s;
    return true;
  }

  /** Normalized raster: centered on the frame, scaled by its size, rotated by theta, optionally mirrored in x. */
  rasterize(caps: Float32Array, start: number, count: number, frame: ShapeFrame, theta: number, mirror: boolean, out: Uint8Array): number {
    const s = (this.grid * SPAN) / Math.max(frame.size, 1e-6);
    return this.fill(caps, start, count, frame.cx, frame.cy, s, theta, mirror, out);
  }

  /** grid = R(theta) * (mirror ? flipX : I) * (p - c) * s + grid / 2. Returns filled pixels. */
  private fill(caps: Float32Array, start: number, count: number, cx: number, cy: number, s: number, theta: number, mirror: boolean, out: Uint8Array): number {
    out.fill(0);
    const g = this.grid;
    const g0 = g / 2;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    const mx = mirror ? -1 : 1;
    let filled = 0;
    for (let i = 0; i < count; i++) {
      const o = (start + i) * CAPSULE_STRIDE;
      const ax0 = (caps[o] - cx) * mx;
      const ay0 = caps[o + 1] - cy;
      const bx0 = (caps[o + 3] - cx) * mx;
      const by0 = caps[o + 4] - cy;
      const ax = (ax0 * cos - ay0 * sin) * s + g0;
      const ay = (ax0 * sin + ay0 * cos) * s + g0;
      const bx = (bx0 * cos - by0 * sin) * s + g0;
      const by = (bx0 * sin + by0 * cos) * s + g0;
      const ra = caps[o + 2] * s;
      const rb = caps[o + 5] * s;
      const r = Math.max(ra, rb);
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - r));
      const x1 = Math.min(g - 1, Math.ceil(Math.max(ax, bx) + r));
      const y0 = Math.max(0, Math.floor(Math.min(ay, by) - r));
      const y1 = Math.min(g - 1, Math.ceil(Math.max(ay, by) + r));
      const ex = bx - ax;
      const ey = by - ay;
      const ee = ex * ex + ey * ey;
      for (let py = y0; py <= y1; py++) {
        for (let px = x0; px <= x1; px++) {
          const idx = py * g + px;
          if (out[idx]) continue;
          const qx = px + 0.5 - ax;
          const qy = py + 0.5 - ay;
          let h = ee > 1e-12 ? (qx * ex + qy * ey) / ee : 0;
          h = h < 0 ? 0 : h > 1 ? 1 : h;
          const dx = qx - ex * h;
          const dy = qy - ey * h;
          const rr = ra + (rb - ra) * h;
          if (dx * dx + dy * dy <= rr * rr) {
            out[idx] = 1;
            filled++;
          }
        }
      }
    }
    return filled;
  }
}

/** A target silhouette rasterized once, in both facings. */
export class TargetShape {
  readonly mask: Uint8Array;
  readonly mirrored: Uint8Array;
  readonly frame: ShapeFrame = createFrame();

  constructor(caps: Float32Array, count: number, sil: Silhouettes) {
    this.mask = new Uint8Array(sil.grid * sil.grid);
    this.mirrored = new Uint8Array(sil.grid * sil.grid);
    if (!sil.measure(caps, 0, count, this.frame)) throw new Error('TargetShape: empty silhouette');
    sil.rasterize(caps, 0, count, this.frame, 0, false, this.mask);
    sil.rasterize(caps, 0, count, this.frame, 0, true, this.mirrored);
  }
}

/** Best IoU of the player's capsules against either facing of the target over the rotation search. */
export function matchScore(sil: Silhouettes, caps: Float32Array, start: number, count: number, target: TargetShape, frame: ShapeFrame): number {
  if (!sil.measure(caps, start, count, frame)) return 0;
  let best = 0;
  for (let k = 0; k < ROTATION_SEARCH.length; k++) {
    sil.rasterize(caps, start, count, frame, ROTATION_SEARCH[k], false, sil.scratch);
    const a = iou(sil.scratch, target.mask);
    const b = iou(sil.scratch, target.mirrored);
    if (a > best) best = a;
    if (b > best) best = b;
  }
  return best;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/silhouette.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/silhouette.ts tests/core/silhouette.test.ts
git commit -m "feat(core): rasterize capsule silhouettes and score normalized IoU"
```

---

### Task 7: Creature library and silhouette sheet

**Files:**
- Create: `src/core/library.ts`, `tests/support/png.ts`, `tests/sheet.gen.test.ts`
- Test: `tests/core/library.test.ts`

- [ ] **Step 1: Write the failing test**

**File: `tests/core/library.test.ts`**
```ts
import { describe, expect, it } from 'vitest';
import { J, JOINT_COUNT } from '../../src/core/joints.js';
import { buildCreatureShapes, canonicalCapsules, CREATURES } from '../../src/core/library.js';
import { TUNING } from '../../src/core/matcher.js';
import { createJointSet, type JointSet } from '../../src/core/poses.js';
import { mulberry32 } from '../../src/core/rng.js';
import { createFrame, matchScore, Silhouettes, type TargetShape } from '../../src/core/silhouette.js';

const sil = new Silhouettes();
const shapes = buildCreatureShapes(sil);
const frame = createFrame();
const score = (caps: Float32Array, count: number, target: TargetShape) => matchScore(sil, caps, 0, count, target, frame);

const mapJoints = (src: JointSet, fn: (x: number, y: number, z: number) => [number, number, number]): JointSet => {
  const out = createJointSet();
  const wx = src.pos[J.wrist * 3];
  const wy = src.pos[J.wrist * 3 + 1];
  const wz = src.pos[J.wrist * 3 + 2];
  for (let i = 0; i < JOINT_COUNT; i++) {
    const [x, y, z] = fn(src.pos[i * 3] - wx, src.pos[i * 3 + 1] - wy, src.pos[i * 3 + 2] - wz);
    out.pos[i * 3] = x + wx;
    out.pos[i * 3 + 1] = y + wy;
    out.pos[i * 3 + 2] = z + wz;
    out.rad[i] = src.rad[i];
  }
  return out;
};
const rotZ = (deg: number) => (x: number, y: number, z: number): [number, number, number] => {
  const c = Math.cos((deg * Math.PI) / 180);
  const s = Math.sin((deg * Math.PI) / 180);
  return [x * c - y * s, x * s + y * c, z];
};
const rotY = (deg: number) => (x: number, y: number, z: number): [number, number, number] => {
  const c = Math.cos((deg * Math.PI) / 180);
  const s = Math.sin((deg * Math.PI) / 180);
  return [x * c + z * s, y, -x * s + z * c];
};

const ids = CREATURES.map((c) => c.id);
const normal = TUNING.normal;

describe('creature library', () => {
  it('defines six one-handed creatures', () => {
    expect(ids).toEqual(['rabbit', 'dog', 'crocodile', 'swan', 'spider', 'turtle']);
  });

  it.each(ids)('%s matches its own silhouette', (id) => {
    const s = shapes.get(id)!;
    expect(score(s.caps, s.count, s.target)).toBeGreaterThan(0.95);
  });

  it.each(ids)('%s survives hand size, in-plane rotation and joint noise', (id) => {
    const s = shapes.get(id)!;
    for (const k of [0.85, 1.15]) {
      const { caps, count } = canonicalCapsules(mapJoints(s.joints, (x, y, z) => [x * k, y * k, z * k]));
      expect(score(caps, count, s.target)).toBeGreaterThan(normal.threshold);
    }
    for (const deg of [-12, 12]) {
      const { caps, count } = canonicalCapsules(mapJoints(s.joints, rotZ(deg)));
      expect(score(caps, count, s.target)).toBeGreaterThan(normal.threshold);
    }
    const rng = mulberry32(42);
    const noisy = mapJoints(s.joints, (x, y, z) => [x + (rng() - 0.5) * 0.008, y + (rng() - 0.5) * 0.008, z + (rng() - 0.5) * 0.008]);
    const { caps, count } = canonicalCapsules(noisy);
    expect(score(caps, count, s.target)).toBeGreaterThan(normal.threshold);
  });

  it.each(ids)('%s still reads after a 10 degree turn toward the wall', (id) => {
    const s = shapes.get(id)!;
    for (const deg of [-10, 10]) {
      const { caps, count } = canonicalCapsules(mapJoints(s.joints, rotY(deg)));
      expect(score(caps, count, s.target)).toBeGreaterThan(normal.floor);
    }
  });

  it('different creatures do not match each other', () => {
    const report: string[] = [];
    for (const a of ids) {
      for (const b of ids) {
        if (a === b) continue;
        const sa = shapes.get(a)!;
        const value = score(sa.caps, sa.count, shapes.get(b)!.target);
        if (value >= normal.threshold - 0.05) report.push(`${a} vs ${b}: ${value.toFixed(3)}`);
      }
    }
    expect(report).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/library.test.ts`
Expected: FAIL. The error says it can't resolve `../../src/core/library.js`.

- [ ] **Step 3: Write the library and the matcher tuning it depends on**

**File: `src/core/library.ts`**
```ts
import { BONES, J } from './joints.js';
import { buildJointSet, builtinAngles, orientJointSet, type HandPoseAngles, type JointSet } from './poses.js';
import { CAPSULE_STRIDE, ShadowProjector, type StagePlane } from './projector.js';
import { Silhouettes, TargetShape } from './silhouette.js';
import type { Vec3 } from './vec.js';

export type CreatureId = 'rabbit' | 'dog' | 'crocodile' | 'swan' | 'spider' | 'turtle';

export interface CreatureDef {
  readonly id: CreatureId;
  readonly name: string;
  /** IWER joint angles, left-hand convention. */
  readonly angles: HandPoseAngles;
  /** Canonical hand orientation in stage axes: x = right (u), y = up (v), z = toward the player (n). */
  readonly facing: { readonly fingers: Vec3; readonly palm: Vec3 };
  /** Eye glint: a joint plus an offset in silhouette-size units (x right, y up). */
  readonly eye: { readonly joint: number; readonly dx: number; readonly dy: number };
}

const B = builtinAngles;

export const CREATURES: readonly CreatureDef[] = [
  {
    id: 'rabbit',
    name: 'Rabbit',
    angles: { ...B.peace, index: { mcp: 0, pip: 8, dip: 6, yaw: -9 }, middle: { mcp: 0, pip: 8, dip: 6, yaw: 9 } },
    facing: { fingers: [-0.3, 1, 0], palm: [0, 0, -1] },
    eye: { joint: J.thumbTip, dx: 0.1, dy: 0.12 },
  },
  {
    id: 'dog',
    name: 'Dog',
    angles: { ...B.flat, thumb: B['thumbs-up'].thumb, pinky: { mcp: 62, pip: 12, dip: 6, yaw: -12 } },
    facing: { fingers: [1, 0.15, 0], palm: [0, 0, 1] },
    eye: { joint: J.indexProx, dx: 0.05, dy: 0.1 },
  },
  {
    id: 'crocodile',
    name: 'Crocodile',
    angles: { ...B.flat, thumb: { ...B.flat.thumb, cmc: [-34, -4.8, -67.7] } },
    facing: { fingers: [1, 0.05, 0], palm: [0, 0, -1] },
    eye: { joint: J.indexProx, dx: 0, dy: 0.12 },
  },
  {
    id: 'swan',
    name: 'Swan',
    angles: { ...B.tripod, ring: { mcp: 45, pip: 55, dip: 30, yaw: 5 }, pinky: { mcp: 50, pip: 55, dip: 30, yaw: 5 } },
    facing: { fingers: [0.55, -1, 0], palm: [0, 0, -1] },
    eye: { joint: J.indexProx, dx: 0.02, dy: 0.08 },
  },
  {
    id: 'spider',
    name: 'Spider',
    angles: {
      ...B.claw,
      index: { ...B.claw.index, yaw: -24 },
      middle: { ...B.claw.middle, yaw: -6 },
      ring: { ...B.claw.ring, yaw: 12 },
      pinky: { ...B.claw.pinky, yaw: 28 },
    },
    facing: { fingers: [0, -1, 0], palm: [0, 0, -1] },
    eye: { joint: J.middleMeta, dx: 0, dy: 0.05 },
  },
  {
    id: 'turtle',
    name: 'Turtle',
    angles: B['thumbs-up'],
    facing: { fingers: [0, -0.3, -1], palm: [0, -1, 0] },
    eye: { joint: J.thumbTip, dx: -0.03, dy: 0.06 },
  },
];

export const creatureDef = (id: CreatureId): CreatureDef => {
  const def = CREATURES.find((c) => c.id === id);
  if (!def) throw new Error(`Unknown creature ${id}`);
  return def;
};

const CANON_STAGE: StagePlane = { origin: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] };
const CANON_LIGHT: Vec3 = [0, 0, 40];
const CANON_WRIST: Vec3 = [0, 0, 0.45];

/** The creature's left hand in canonical stage space (a distant light makes the view almost orthographic). */
export function canonicalJoints(def: CreatureDef): JointSet {
  return orientJointSet(buildJointSet(def.angles), 'left', def.facing, CANON_WRIST);
}

export function canonicalCapsules(joints: JointSet, out = new Float32Array(BONES.length * CAPSULE_STRIDE)): { caps: Float32Array; count: number } {
  const projector = new ShadowProjector();
  projector.setup(CANON_LIGHT, CANON_STAGE);
  return { caps: out, count: projector.projectBones(joints, out, 0) };
}

export interface CreatureShape {
  readonly def: CreatureDef;
  readonly joints: JointSet;
  readonly caps: Float32Array;
  readonly count: number;
  readonly target: TargetShape;
  /** Eye position in canonical stage space. */
  readonly eye: readonly [number, number];
}

export function buildCreatureShapes(sil = new Silhouettes()): Map<CreatureId, CreatureShape> {
  const shapes = new Map<CreatureId, CreatureShape>();
  const projector = new ShadowProjector();
  projector.setup(CANON_LIGHT, CANON_STAGE);
  for (const def of CREATURES) {
    const joints = canonicalJoints(def);
    const { caps, count } = canonicalCapsules(joints);
    const target = new TargetShape(caps, count, sil);
    const e = def.eye.joint * 3;
    projector.project(joints.pos[e], joints.pos[e + 1], joints.pos[e + 2]);
    const eye: [number, number] = [projector.x + def.eye.dx * target.frame.size, projector.y + def.eye.dy * target.frame.size];
    shapes.set(def.id, { def, joints, caps, count, target, eye });
  }
  return shapes;
}
```

**File: `src/core/matcher.ts`** (only the tuning table is needed now; Task 8 adds the state machine)
```ts
export type AssistLevel = 'gentle' | 'normal' | 'expert';

export interface MatchTuning {
  /** IoU needed at the start of an attempt. */
  readonly threshold: number;
  /** Lowest IoU the threshold can relax to. */
  readonly floor: number;
  /** Seconds before relaxing begins. */
  readonly relaxAfter: number;
  /** Threshold drop per second once relaxing. */
  readonly relaxRate: number;
  /** Seconds the smoothed score must stay above threshold. */
  readonly hold: number;
  /** Score smoothing time constant (seconds). */
  readonly tau: number;
}

export const TUNING: Readonly<Record<AssistLevel, MatchTuning>> = {
  gentle: { threshold: 0.56, floor: 0.42, relaxAfter: 6, relaxRate: 0.012, hold: 0.45, tau: 0.2 },
  normal: { threshold: 0.62, floor: 0.5, relaxAfter: 12, relaxRate: 0.008, hold: 0.6, tau: 0.2 },
  expert: { threshold: 0.72, floor: 0.72, relaxAfter: Infinity, relaxRate: 0, hold: 0.8, tau: 0.2 },
};
```

- [ ] **Step 4: Write the silhouette sheet generator**

**File: `tests/support/png.ts`**
```ts
import { deflateSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), Buffer.from(data)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** Encodes 8-bit RGBA pixels as a PNG. */
export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', new Uint8Array(0)),
  ]);
}
```

**File: `tests/sheet.gen.test.ts`**
```ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import { buildCreatureShapes, CREATURES } from '../src/core/library.js';
import { createFrame, Silhouettes } from '../src/core/silhouette.js';
import { encodePng } from './support/png.js';

// Contact sheet, 3 x 2: rabbit, dog, crocodile / swan, spider, turtle.
describe.runIf(process.env.SHEET === '1')('silhouette sheet', () => {
  it('writes docs/silhouettes.png', () => {
    const cell = 200;
    const cols = 3;
    const rows = Math.ceil(CREATURES.length / cols);
    const width = cols * cell;
    const height = rows * cell;
    const rgba = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) rgba.set([250, 214, 160, 255], i * 4);
    const sil = new Silhouettes(cell);
    const shapes = buildCreatureShapes();
    CREATURES.forEach((def, index) => {
      const shape = shapes.get(def.id)!;
      const frame = createFrame();
      sil.measure(shape.caps, 0, shape.count, frame);
      sil.rasterize(shape.caps, 0, shape.count, frame, 0, false, sil.scratch);
      const ox = (index % cols) * cell;
      const oy = Math.floor(index / cols) * cell;
      for (let y = 0; y < cell; y++) {
        for (let x = 0; x < cell; x++) {
          if (!sil.scratch[(cell - 1 - y) * cell + x]) continue;
          rgba.set([28, 18, 12, 255], ((oy + y) * width + ox + x) * 4);
        }
      }
    });
    mkdirSync('docs', { recursive: true });
    writeFileSync('docs/silhouettes.png', encodePng(width, height, rgba));
  });
});
```

- [ ] **Step 5: Generate the sheet and look at it**

Run: `npm run sheet`
Expected: one test passes and `docs/silhouettes.png` is written.

Open `docs/silhouettes.png` (a Read of the PNG shows it). The grid is 3 × 2: rabbit, dog, crocodile on the top row, then swan, spider, turtle. Each cell must read as its animal:

| Creature | Must show |
|---|---|
| Rabbit | Two ears up and a head |
| Dog | A forward snout, the thumb as a raised ear, the dropped pinky as an open jaw |
| Crocodile | Long jaws with a gap |
| Swan | A down-pointing beak head |
| Spider | Spread legs below a body |
| Turtle | A round shell with the head sticking out |

For any cell that doesn't read correctly, adjust that creature's `angles` (joint degrees) or `facing` in `src/core/library.ts` and rerun `npm run sheet`. Repeat until all six read correctly.

- [ ] **Step 6: Run the library tests**

Run: `npx vitest run tests/core/library.test.ts`
Expected: PASS (21 tests: the list check, then six each for self-match, robustness and 10° turn, plus the cross-creature check).

If the cross-creature check lists pairs, separate those shapes by changing `facing` or the distinguishing digit, keeping each one recognizable on the sheet. Then rerun both `npm run sheet` and this test.

- [ ] **Step 7: Commit**

```bash
git add src/core/library.ts src/core/matcher.ts tests/core/library.test.ts tests/support/png.ts tests/sheet.gen.test.ts docs/silhouettes.png
git commit -m "feat(core): add six creature hand shapes with canonical silhouettes"
```

---

### Task 8: Match state machine

**Files:**
- Modify: `src/core/matcher.ts` (append the `Matcher` class)
- Test: `tests/core/matcher.test.ts`

- [ ] **Step 1: Write the failing test**

**File: `tests/core/matcher.test.ts`**
```ts
import { describe, expect, it } from 'vitest';
import { Matcher, TUNING } from '../../src/core/matcher.js';

const run = (m: Matcher, seconds: number, score: number | null, dt = 1 / 15) => {
  const events: string[] = [];
  for (let t = 0; t < seconds; t += dt) events.push(m.update(dt, score));
  return events;
};

describe('Matcher', () => {
  it('matches once after holding above threshold', () => {
    const m = new Matcher(TUNING.normal);
    const events = run(m, 2, 0.9);
    expect(events.filter((e) => e === 'matched')).toHaveLength(1);
    expect(m.matched).toBe(true);
  });

  it('does not match below threshold', () => {
    const m = new Matcher(TUNING.normal);
    expect(run(m, 3, 0.4)).not.toContain('matched');
  });

  it('lost tracking resets the smoothed score and the hold', () => {
    const m = new Matcher(TUNING.normal);
    run(m, 0.5, 0.9);
    run(m, 0.2, null);
    expect(m.smoothed).toBe(0);
    expect(m.held).toBe(0);
  });

  it('relaxes the threshold after a while but never below the floor', () => {
    const m = new Matcher(TUNING.normal);
    run(m, TUNING.normal.relaxAfter + 5, 0.1);
    expect(m.threshold()).toBeCloseTo(TUNING.normal.threshold - 5 * TUNING.normal.relaxRate, 2);
    run(m, 200, 0.1);
    expect(m.threshold()).toBe(TUNING.normal.floor);
  });

  it('expert never relaxes', () => {
    const m = new Matcher(TUNING.expert);
    run(m, 60, 0.1);
    expect(m.threshold()).toBe(TUNING.expert.threshold);
  });

  it('reports progress toward the threshold and can be reset', () => {
    const m = new Matcher(TUNING.normal);
    run(m, 1, 0.31);
    expect(m.progress()).toBeGreaterThan(0.4);
    expect(m.progress()).toBeLessThan(0.6);
    m.reset();
    expect(m.progress()).toBe(0);
    expect(m.matched).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/matcher.test.ts`
Expected: FAIL. The error is `Matcher is not a constructor`, or the import of `Matcher` doesn't resolve.

- [ ] **Step 3: Append the implementation to `src/core/matcher.ts`**

**File: `src/core/matcher.ts#machine`** (append below `TUNING`)
```ts

export type MatchEvent = 'none' | 'matched';

/** Smooths per-tick scores, requires a short hold, and relaxes the threshold for players who are stuck. */
export class Matcher {
  smoothed = 0;
  held = 0;
  elapsed = 0;
  matched = false;

  constructor(private tuning: MatchTuning) {}

  setTuning(tuning: MatchTuning): void {
    this.tuning = tuning;
  }

  reset(): void {
    this.smoothed = 0;
    this.held = 0;
    this.elapsed = 0;
    this.matched = false;
  }

  threshold(): number {
    const t = this.tuning;
    const over = Math.max(0, this.elapsed - t.relaxAfter);
    return Math.max(t.floor, t.threshold - over * t.relaxRate);
  }

  /** score: best IoU this tick, or null when no hand is tracked. */
  update(dt: number, score: number | null): MatchEvent {
    if (this.matched) return 'none';
    this.elapsed += dt;
    if (score === null) {
      this.smoothed = 0;
      this.held = 0;
      return 'none';
    }
    this.smoothed += (score - this.smoothed) * (1 - Math.exp(-dt / this.tuning.tau));
    if (this.smoothed >= this.threshold()) {
      this.held += dt;
      if (this.held >= this.tuning.hold) {
        this.matched = true;
        return 'matched';
      }
    } else {
      this.held = Math.max(0, this.held - dt);
    }
    return 'none';
  }

  /** 0..1 closeness to the current threshold, for feedback glow. */
  progress(): number {
    return Math.min(1, this.smoothed / this.threshold());
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/matcher.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/matcher.ts tests/core/matcher.test.ts
git commit -m "feat(core): add match state machine with hold and assist relaxation"
```

---

### Task 9: Stage — wall choice, light pool and lantern

**Files:**
- Create: `src/core/stage.ts`
- Test: `tests/core/stage.test.ts`

- [ ] **Step 1: Write the failing test**

**File: `tests/core/stage.test.ts`**
```ts
import { describe, expect, it } from 'vitest';
import { ShadowProjector } from '../../src/core/projector.js';
import { buildStage, chooseWall, type PlaneInfo } from '../../src/core/stage.js';
import type { Vec3 } from '../../src/core/vec.js';

const head = { position: [0, 1.2, 0] as Vec3, forward: [0, 0, -1] as Vec3 };
const wall = (z: number, normal: Vec3 = [0, 0, 1], halfWidth = 2): PlaneInfo => ({
  center: [0, 1.3, z],
  normal,
  vertical: true,
  polygon: [[-halfWidth, 0, z], [halfWidth, 0, z], [halfWidth, 2.6, z], [-halfWidth, 2.6, z]],
});
const close = (a: Vec3, b: Vec3) => a.forEach((x, i) => expect(x).toBeCloseTo(b[i], 5));

describe('chooseWall', () => {
  it('chooses the wall straight ahead', () => {
    const w = chooseWall([wall(-2)], head)!;
    expect(w.distance).toBeCloseTo(2);
    close(w.normal, [0, 0, 1]);
  });

  it('flips a normal that points away from the player', () => {
    close(chooseWall([wall(-2, [0, 0, -1])], head)!.normal, [0, 0, 1]);
  });

  it('ignores floors, walls behind, walls out of range and walls missed by the gaze', () => {
    const floor: PlaneInfo = { ...wall(-2), vertical: false };
    expect(chooseWall([floor], head)).toBeNull();
    expect(chooseWall([wall(2, [0, 0, -1])], head)).toBeNull();
    expect(chooseWall([wall(-6)], head)).toBeNull();
    const offToSide: PlaneInfo = { ...wall(-2), polygon: [[1, 0, -2], [3, 0, -2], [3, 2.6, -2], [1, 2.6, -2]] };
    expect(chooseWall([offToSide], head)).toBeNull();
  });

  it('prefers the nearest wall along the gaze', () => {
    expect(chooseWall([wall(-3.5), wall(-1.5)], head)!.distance).toBeCloseTo(1.5);
  });
});

describe('buildStage', () => {
  it('puts the stage on the wall just below eye height with a right-handed basis', () => {
    const s = buildStage(head, chooseWall([wall(-2)], head), { narrow: false });
    expect(s.fallback).toBe(false);
    close(s.origin, [0, 1.1, -2]);
    close(s.u, [1, 0, 0]);
    close(s.v, [0, 1, 0]);
    close(s.n, [0, 0, 1]);
  });

  it('falls back to a paper screen when no wall qualifies', () => {
    const s = buildStage(head, null, { narrow: false });
    expect(s.fallback).toBe(true);
    close(s.origin, [0, 1.1, -1.6]);
    close(s.n, [0, 0, 1]);
  });

  it('places the lantern so the comfortable hand point shadows the stage center', () => {
    const s = buildStage(head, chooseWall([wall(-2)], head), { narrow: false });
    const p = new ShadowProjector();
    p.setup(s.lantern, s);
    expect(p.project(s.hand[0], s.hand[1], s.hand[2])).toBe(true);
    expect(Math.hypot(p.x, p.y)).toBeLessThan(1e-6);
    expect(p.t).toBeGreaterThan(2);
    expect(p.t).toBeLessThan(4);
  });

  it('shrinks the light pool in narrow view and keeps it on the wall', () => {
    const wide = buildStage(head, chooseWall([wall(-2)], head), { narrow: false });
    const narrow = buildStage(head, chooseWall([wall(-2)], head), { narrow: true });
    expect(narrow.poolU).toBeLessThan(wide.poolU);
    expect(narrow.poolV).toBeLessThan(wide.poolV);
    const thin = buildStage(head, chooseWall([wall(-2, [0, 0, 1], 0.5)], head), { narrow: false });
    expect(thin.poolU).toBeLessThanOrEqual(0.5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/stage.test.ts`
Expected: FAIL. The error says it can't resolve `../../src/core/stage.js`.

- [ ] **Step 3: Write minimal implementation**

**File: `src/core/stage.ts`**
```ts
import type { StagePlane } from './projector.js';
import { add, cross, dot, length, normalize, scale, sub, UP, type Vec3 } from './vec.js';

/** A detected plane in world space. */
export interface PlaneInfo {
  readonly center: Vec3;
  readonly normal: Vec3;
  readonly polygon: readonly Vec3[];
  readonly vertical: boolean;
}

export interface HeadPose {
  readonly position: Vec3;
  readonly forward: Vec3;
}

export interface WallHit {
  readonly plane: PlaneInfo;
  readonly hit: Vec3;
  /** Horizontal unit normal facing the player. */
  readonly normal: Vec3;
  readonly distance: number;
}

export interface Stage extends StagePlane {
  /** Point light behind the player's hands. */
  readonly lantern: Vec3;
  /** Comfortable hand point whose shadow lands on the stage center. */
  readonly hand: Vec3;
  /** Light pool half-extents (meters) along u and v. */
  readonly poolU: number;
  readonly poolV: number;
  readonly distance: number;
  readonly fallback: boolean;
}

export interface StageOptions {
  readonly narrow: boolean;
}

const MIN_DIST = 0.6;
const MAX_DIST = 4.5;
const FALLBACK_DIST = 1.6;
const EYE_DROP = 0.1;
const HAND_FORWARD = 0.4;
const HAND_DROP = 0.3;
const LANTERN_BEHIND_HAND = 0.75;
const EDGE_MARGIN = 0.1;
const DEG = Math.PI / 180;

export function horizontalForward(forward: Vec3): Vec3 {
  const f = normalize([forward[0], 0, forward[2]]);
  return length(f) > 0 ? f : [0, 0, -1];
}

function extents(polygon: readonly Vec3[], origin: Vec3, axis: Vec3): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const q of polygon) {
    const x = dot(sub(q, origin), axis);
    lo = Math.min(lo, x);
    hi = Math.max(hi, x);
  }
  return [lo, hi];
}

/** The nearest vertical plane that the horizontal gaze ray hits, facing the player, 0.6–4.5 m away. */
export function chooseWall(planes: readonly PlaneInfo[], head: HeadPose): WallHit | null {
  const f = horizontalForward(head.forward);
  let best: WallHit | null = null;
  for (const plane of planes) {
    if (!plane.vertical) continue;
    let n = normalize([plane.normal[0], 0, plane.normal[2]]);
    if (length(n) === 0) continue;
    if (dot(n, sub(head.position, plane.center)) < 0) n = scale(n, -1);
    const along = dot(f, n);
    if (-along < 0.5) continue;
    const distance = dot(sub(plane.center, head.position), n) / along;
    if (!(distance >= MIN_DIST && distance <= MAX_DIST)) continue;
    const hit = add(head.position, scale(f, distance));
    const [lo, hi] = extents(plane.polygon, hit, normalize(cross(UP, n)));
    if (lo > -EDGE_MARGIN || hi < EDGE_MARGIN) continue;
    if (!best || distance < best.distance) best = { plane, hit, normal: n, distance };
  }
  return best;
}

/** Builds the stage on the chosen wall, or on a paper screen in front of the player. */
export function buildStage(head: HeadPose, wall: WallHit | null, options: StageOptions): Stage {
  const f = horizontalForward(head.forward);
  const halfU = (options.narrow ? 14 : 20) * DEG;
  const halfV = (options.narrow ? 10 : 15) * DEG;
  const n: Vec3 = wall ? wall.normal : scale(f, -1);
  const distance = wall ? wall.distance : FALLBACK_DIST;
  const u = normalize(cross(UP, n));
  const v = cross(n, u);
  let poolU = Math.min(1.2, distance * Math.tan(halfU));
  let poolV = Math.min(0.9, distance * Math.tan(halfV));
  let origin: Vec3 = wall
    ? [wall.hit[0], head.position[1] - EYE_DROP, wall.hit[2]]
    : add(head.position, add(scale(f, FALLBACK_DIST), [0, -EYE_DROP, 0]));
  if (wall) {
    const [uLo, uHi] = extents(wall.plane.polygon, origin, u);
    const [vLo, vHi] = extents(wall.plane.polygon, origin, v);
    poolU = Math.max(0.15, Math.min(poolU, (uHi - uLo) / 2));
    poolV = Math.max(0.12, Math.min(poolV, (vHi - vLo) / 2));
    const shiftU = Math.min(Math.max(0, uLo + poolU), uHi - poolU);
    const shiftV = Math.min(Math.max(0, vLo + poolV), vHi - poolV);
    origin = add(origin, add(scale(u, shiftU), scale(v, shiftV)));
  }
  const hand = add(head.position, add(scale(f, HAND_FORWARD), [0, -HAND_DROP, 0]));
  const lantern = add(hand, scale(normalize(sub(hand, origin)), LANTERN_BEHIND_HAND));
  return { origin, u, v, n, lantern, hand, poolU, poolV, distance, fallback: !wall };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/stage.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/stage.ts tests/core/stage.test.ts
git commit -m "feat(core): choose the wall and build the lantern-lit stage"
```

---

### Task 10: Hopping shadow creature

**Files:**
- Create: `src/core/creature.ts`
- Test: `tests/core/creature.test.ts`

- [ ] **Step 1: Write the failing test**

**File: `tests/core/creature.test.ts`**
```ts
import { describe, expect, it } from 'vitest';
import { HopperCreature } from '../../src/core/creature.js';
import { mulberry32 } from '../../src/core/rng.js';

const pool = { u: 0.6, v: 0.4 };

describe('HopperCreature', () => {
  it('stays inside the light pool while wandering', () => {
    const c = new HopperCreature('rabbit', 0, 0, 1, 0.25, mulberry32(1));
    for (let i = 0; i < 6000; i++) {
      c.update(1 / 60, pool);
      expect((c.x / pool.u) ** 2 + (c.y / pool.v) ** 2).toBeLessThanOrEqual(1.0001);
    }
  });

  it('hops while moving, faces its direction and sometimes rests', () => {
    const c = new HopperCreature('rabbit', 0, 0, 1, 0.25, mulberry32(3));
    let hopped = false;
    let rested = false;
    for (let i = 0; i < 1200; i++) {
      c.update(1 / 60, pool);
      if (c.hop > 0.01) hopped = true;
      if (c.resting) rested = true;
    }
    expect(hopped).toBe(true);
    expect(rested).toBe(true);
    expect([1, -1]).toContain(c.facing);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/creature.test.ts`
Expected: FAIL. The error says it can't resolve `../../src/core/creature.js`.

- [ ] **Step 3: Write minimal implementation**

**File: `src/core/creature.ts`**
```ts
import type { CreatureId } from './library.js';

/** Ellipse half-axes (stage meters) the creature must stay inside. */
export interface PoolBounds {
  readonly u: number;
  readonly v: number;
}

/** A living shadow that wanders the light pool in hops and rests between them. */
export class HopperCreature {
  facing: 1 | -1 = 1;
  hop = 0;
  resting = false;
  private targetX: number;
  private targetY: number;
  private phase = 0;
  private rest = 0.8;

  constructor(
    readonly id: CreatureId,
    public x: number,
    public y: number,
    /** Scale from canonical silhouette meters to stage meters. */
    public scale: number,
    /** Typical silhouette size on the wall (meters), sets speed and hop height. */
    readonly size: number,
    private readonly rng: () => number,
  ) {
    this.targetX = x;
    this.targetY = y;
  }

  update(dt: number, pool: PoolBounds): void {
    this.clampInside(pool);
    if (this.rest > 0) {
      this.resting = true;
      this.hop = 0;
      this.rest -= dt;
      if (this.rest <= 0) this.pickTarget(pool);
      return;
    }
    this.resting = false;
    const dx = this.targetX - this.x;
    const dy = this.targetY - this.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.005) {
      this.rest = 0.6 + this.rng() * 1.6;
      return;
    }
    const step = Math.min(dist, this.size * 1.4 * dt);
    this.x += (dx / dist) * step;
    this.y += (dy / dist) * step;
    if (Math.abs(dx) > 1e-4) this.facing = dx > 0 ? 1 : -1;
    this.phase += dt * 6;
    this.hop = Math.abs(Math.sin(this.phase)) * this.size * 0.3;
  }

  private pickTarget(pool: PoolBounds): void {
    const angle = this.rng() * Math.PI * 2;
    const radius = Math.sqrt(this.rng()) * 0.7;
    this.targetX = Math.cos(angle) * radius * pool.u;
    this.targetY = Math.sin(angle) * radius * pool.v;
  }

  private clampInside(pool: PoolBounds): void {
    const e = (this.x / pool.u) ** 2 + (this.y / pool.v) ** 2;
    if (e > 1) {
      const k = 1 / Math.sqrt(e);
      this.x *= k;
      this.y *= k;
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/creature.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the whole suite and commit**

Run: `npm test && npm run typecheck`
Expected: every test file passes; no type errors.

```bash
git add src/core/creature.ts tests/core/creature.test.ts
git commit -m "feat(core): add hopping shadow creature that stays in the light pool"
```

---

### Task 11: Shadow canvas renderer

**Files:**
- Create: `src/render/ShadowCanvas.ts`

This is GPU code. It has no unit test; Task 13 verifies it in the emulator. TypeScript is checked here.

- [ ] **Step 1: Write the renderer**

**File: `src/render/ShadowCanvas.ts`**
```ts
import {
  Color,
  CustomBlending,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Matrix4,
  MaxEquation,
  Mesh,
  OneFactor,
  OneMinusSrcAlphaFactor,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  type WebGLRenderer,
} from '@iwsdk/core';
import { CAPSULE_STRIDE } from '../core/projector.js';
import type { Stage } from '../core/stage.js';

export const CH_SHADOW = 0;
export const CH_GLOW = 1;
export const CH_TARGET = 2;

const MAX_INSTANCES = 1024;

const MASK_VERTEX = /* glsl */ `
attribute vec3 aA;
attribute vec3 aB;
attribute vec4 aChan;
uniform float uFeather;
varying vec2 vP;
varying vec3 vA;
varying vec3 vB;
varying vec4 vChan;
void main() {
  float r = max(aA.z, aB.z) + uFeather;
  vec2 lo = min(aA.xy, aB.xy) - vec2(r);
  vec2 hi = max(aA.xy, aB.xy) + vec2(r);
  vec2 p = mix(lo, hi, position.xy + 0.5);
  vP = p;
  vA = aA;
  vB = aB;
  vChan = aChan;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 0.0, 1.0);
}`;

const MASK_FRAGMENT = /* glsl */ `
uniform float uFeather;
varying vec2 vP;
varying vec3 vA;
varying vec3 vB;
varying vec4 vChan;
void main() {
  vec2 e = vB.xy - vA.xy;
  vec2 q = vP - vA.xy;
  float h = clamp(dot(q, e) / max(dot(e, e), 1e-10), 0.0, 1.0);
  float d = length(q - e * h) - mix(vA.z, vB.z, h);
  float c = 1.0 - smoothstep(-uFeather, uFeather, d);
  if (c <= 0.0) discard;
  gl_FragColor = vChan * c;
}`;

const COMPOSITE_VERTEX = /* glsl */ `
uniform vec2 uHalf;
varying vec2 vS;
void main() {
  vS = position.xy * 2.0 * uHalf;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const COMPOSITE_FRAGMENT = /* glsl */ `
uniform sampler2D uMask;
uniform vec2 uHalf;
uniform vec2 uPool;
uniform vec3 uWarm;
uniform float uLight;
uniform float uShadow;
uniform float uFade;
varying vec2 vS;
void main() {
  vec4 m = texture2D(uMask, vS / (2.0 * uHalf) + 0.5);
  float e = length(vS / uPool);
  float pool = 1.0 - smoothstep(0.8, 1.0, e);
  float lit = pool * (0.8 + 0.2 * (1.0 - e * e));
  float shadow = m.r * pool;
  float target = m.b * pool * (1.0 - m.r);
  float glow = m.g;
  vec3 color = uWarm * uLight * lit * (1.0 - m.r)
    + vec3(1.0, 0.78, 0.42) * target * 0.55
    + vec3(1.0, 0.9, 0.65) * glow;
  float alpha = uLight * 0.55 * lit * (1.0 - m.r) + shadow * uShadow + target * 0.3 + glow * 0.8;
  gl_FragColor = vec4(color, clamp(alpha, 0.0, 1.0)) * uFade;
}`;

/**
 * Draws every shadow on the stage. Capsules are rendered into a 2D mask (r = shadow, g = glow,
 * b = target) once per frame. A single wall-aligned quad then composites the light pool,
 * shadows, target and glints over passthrough with premultiplied alpha.
 */
export class ShadowCanvas {
  readonly composite: Mesh;
  private readonly maskScene = new Scene();
  private readonly maskCamera = new OrthographicCamera(-1, 1, 1, -1, -1, 1);
  private readonly target = new WebGLRenderTarget(512, 384);
  private readonly geometry = new InstancedBufferGeometry();
  private readonly aA = new InstancedBufferAttribute(new Float32Array(MAX_INSTANCES * 3), 3);
  private readonly aB = new InstancedBufferAttribute(new Float32Array(MAX_INSTANCES * 3), 3);
  private readonly aChan = new InstancedBufferAttribute(new Float32Array(MAX_INSTANCES * 4), 4);
  private readonly maskMaterial: ShaderMaterial;
  private readonly compositeMaterial: ShaderMaterial;
  private readonly basis = new Matrix4();
  private readonly prevClear = new Color();
  private count = 0;

  constructor() {
    const quad = new PlaneGeometry(1, 1);
    this.geometry.index = quad.index;
    this.geometry.setAttribute('position', quad.getAttribute('position'));
    this.geometry.setAttribute('aA', this.aA);
    this.geometry.setAttribute('aB', this.aB);
    this.geometry.setAttribute('aChan', this.aChan);
    this.geometry.instanceCount = 0;
    this.maskMaterial = new ShaderMaterial({
      vertexShader: MASK_VERTEX,
      fragmentShader: MASK_FRAGMENT,
      uniforms: { uFeather: { value: 0.004 } },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: CustomBlending,
      blendEquation: MaxEquation,
      blendEquationAlpha: MaxEquation,
      blendSrc: OneFactor,
      blendDst: OneFactor,
    });
    const capsules = new Mesh(this.geometry, this.maskMaterial);
    capsules.frustumCulled = false;
    this.maskScene.add(capsules);

    this.compositeMaterial = new ShaderMaterial({
      vertexShader: COMPOSITE_VERTEX,
      fragmentShader: COMPOSITE_FRAGMENT,
      uniforms: {
        uMask: { value: this.target.texture },
        uHalf: { value: new Vector2(1, 1) },
        uPool: { value: new Vector2(1, 1) },
        uWarm: { value: new Color(1.0, 0.76, 0.48) },
        uLight: { value: 0.24 },
        uShadow: { value: 0.78 },
        uFade: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      premultipliedAlpha: true,
      blending: CustomBlending,
      blendSrc: OneFactor,
      blendDst: OneMinusSrcAlphaFactor,
    });
    this.composite = new Mesh(new PlaneGeometry(1, 1), this.compositeMaterial);
    this.composite.frustumCulled = false;
    this.composite.renderOrder = 10;
  }

  /** Sizes the mask and places the composite quad on the stage. */
  configure(stage: Stage): void {
    const hu = stage.poolU * 1.08;
    const hv = stage.poolV * 1.08;
    this.maskCamera.left = -hu;
    this.maskCamera.right = hu;
    this.maskCamera.top = hv;
    this.maskCamera.bottom = -hv;
    this.maskCamera.updateProjectionMatrix();
    this.target.setSize(512, Math.max(64, Math.round((512 * hv) / hu)));
    this.maskMaterial.uniforms.uFeather.value = 0.004 * Math.max(1, stage.distance / 2);
    (this.compositeMaterial.uniforms.uHalf.value as Vector2).set(hu, hv);
    (this.compositeMaterial.uniforms.uPool.value as Vector2).set(stage.poolU, stage.poolV);
    this.basis.makeBasis(new Vector3(...stage.u), new Vector3(...stage.v), new Vector3(...stage.n));
    this.composite.quaternion.setFromRotationMatrix(this.basis);
    this.composite.position.set(
      stage.origin[0] + stage.n[0] * 0.003,
      stage.origin[1] + stage.n[1] * 0.003,
      stage.origin[2] + stage.n[2] * 0.003,
    );
    this.composite.scale.set(2 * hu, 2 * hv, 1);
  }

  setFade(value: number): void {
    this.compositeMaterial.uniforms.uFade.value = value;
  }

  begin(): void {
    this.count = 0;
  }

  addCapsule(ax: number, ay: number, ar: number, bx: number, by: number, br: number, channel: number, strength = 1): void {
    if (this.count >= MAX_INSTANCES) return;
    const i = this.count++;
    const a = this.aA.array as Float32Array;
    const b = this.aB.array as Float32Array;
    const c = this.aChan.array as Float32Array;
    a[i * 3] = ax;
    a[i * 3 + 1] = ay;
    a[i * 3 + 2] = ar;
    b[i * 3] = bx;
    b[i * 3 + 1] = by;
    b[i * 3 + 2] = br;
    c[i * 4] = channel === CH_SHADOW ? strength : 0;
    c[i * 4 + 1] = channel === CH_GLOW ? strength : 0;
    c[i * 4 + 2] = channel === CH_TARGET ? strength : 0;
    c[i * 4 + 3] = 0;
  }

  addCapsules(caps: Float32Array, start: number, count: number, channel: number, strength = 1): void {
    for (let i = 0; i < count; i++) {
      const o = (start + i) * CAPSULE_STRIDE;
      this.addCapsule(caps[o], caps[o + 1], caps[o + 2], caps[o + 3], caps[o + 4], caps[o + 5], channel, strength);
    }
  }

  addDot(x: number, y: number, r: number, channel: number, strength = 1): void {
    this.addCapsule(x, y, r, x, y, r, channel, strength);
  }

  end(): void {
    this.geometry.instanceCount = this.count;
    this.aA.needsUpdate = true;
    this.aB.needsUpdate = true;
    this.aChan.needsUpdate = true;
  }

  /** Renders the mask. Call once per frame before the main render. */
  render(renderer: WebGLRenderer): void {
    const xrEnabled = renderer.xr.enabled;
    const previous = renderer.getRenderTarget();
    renderer.getClearColor(this.prevClear);
    const previousAlpha = renderer.getClearAlpha();
    renderer.xr.enabled = false;
    renderer.setRenderTarget(this.target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, false, false);
    renderer.render(this.maskScene, this.maskCamera);
    renderer.setRenderTarget(previous);
    renderer.setClearColor(this.prevClear, previousAlpha);
    renderer.xr.enabled = xrEnabled;
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

If `@iwsdk/core` doesn't re-export one of these names, the error names it. Import that class from the `three` types under the same name through `@iwsdk/core`'s exports (check with `grep -n "ClassName" node_modules/@iwsdk/core/dist/index.d.ts`), then rerun.

- [ ] **Step 3: Commit**

```bash
git add src/render/ShadowCanvas.ts
git commit -m "feat(render): add mask-and-composite shadow canvas"
```

---

### Task 12: Systems — hands, stage, game, render

**Files:**
- Create: `src/runtime/store.ts`, `src/runtime/testpose.ts`, `src/systems/HandSystem.ts`, `src/systems/StageSystem.ts`, `src/systems/GameSystem.ts`, `src/systems/RenderSystem.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Shared state and the dev test-pose hook**

**File: `src/runtime/store.ts`**
```ts
import { createJointSet, type Handedness, type JointSet } from '../core/poses.js';
import type { Stage } from '../core/stage.js';
import type { ShadowCanvas } from '../render/ShadowCanvas.js';

export interface HandSample {
  tracked: boolean;
  readonly joints: JointSet;
}

export const SIDES: readonly Handedness[] = ['left', 'right'];

/** Per-frame state shared between systems (written by Hand/Stage, read by Game/Render). */
export const store = {
  stage: null as Stage | null,
  stageVersion: 0,
  narrow: false,
  relightRequested: false,
  canvas: null as ShadowCanvas | null,
  hands: {
    left: { tracked: false, joints: createJointSet() },
    right: { tracked: false, joints: createJointSet() },
  } as Record<Handedness, HandSample>,
};
```

**File: `src/runtime/testpose.ts`**
```ts
import { CREATURES, type CreatureId } from '../core/library.js';
import { buildJointSet, orientJointSet, type JointSet } from '../core/poses.js';
import type { Stage } from '../core/stage.js';
import type { Vec3 } from '../core/vec.js';
import type { HandSample } from './store.js';

/** Dev-only synthetic hand: VITE_TESTPOSE=<creature> or ?testpose=<creature>, optional testhand=left|right. */
export interface TestPose {
  readonly creature: CreatureId;
  readonly side: 'left' | 'right';
  readonly joints: JointSet;
}

export function readTestPose(search: string, envPose: string | undefined): TestPose | null {
  const params = new URLSearchParams(search);
  const id = params.get('testpose') ?? envPose ?? '';
  const def = CREATURES.find((c) => c.id === id);
  if (!def) return null;
  return { creature: def.id, side: params.get('testhand') === 'left' ? 'left' : 'right', joints: buildJointSet(def.angles) };
}

const toWorld = (stage: Stage, c: Vec3): Vec3 => [
  stage.u[0] * c[0] + stage.v[0] * c[1] + stage.n[0] * c[2],
  stage.u[1] * c[0] + stage.v[1] * c[1] + stage.n[1] * c[2],
  stage.u[2] * c[0] + stage.v[2] * c[1] + stage.n[2] * c[2],
];

/** Places the test pose's canonical shape at the stage's comfortable hand point. */
export function placeTestPose(test: TestPose, stage: Stage, out: HandSample): void {
  const def = CREATURES.find((c) => c.id === test.creature)!;
  orientJointSet(test.joints, 'left', { fingers: toWorld(stage, def.facing.fingers), palm: toWorld(stage, def.facing.palm) }, stage.hand, out.joints);
  out.tracked = true;
}
```

- [ ] **Step 2: Hand and stage systems**

**File: `src/systems/HandSystem.ts`**
```ts
import { createSystem } from '@iwsdk/core';
import { JOINT_COUNT, JOINT_INDEX } from '../core/joints.js';
import { placeTestPose, readTestPose } from '../runtime/testpose.js';
import { SIDES, store } from '../runtime/store.js';

/** Copies tracked hand joints (world space) into the store and hides the virtual hand meshes. */
export class HandSystem extends createSystem({}) {
  private readonly poses = new Float32Array(JOINT_COUNT * 16);
  private readonly radii = new Float32Array(JOINT_COUNT);
  private readonly test = readTestPose(globalThis.location?.search ?? '', import.meta.env.VITE_TESTPOSE as string | undefined);

  update(): void {
    if (this.test) {
      for (const side of SIDES) store.hands[side].tracked = false;
      if (store.stage) placeTestPose(this.test, store.stage, store.hands[this.test.side]);
      return;
    }
    const frame = this.xrFrame;
    const ref = this.xrManager.getReferenceSpace();
    const m = this.player.matrixWorld.elements;
    for (const side of SIDES) {
      const sample = store.hands[side];
      sample.tracked = false;
      const adapter = this.input.xr.visualAdapters.hand[side];
      if (!frame || !ref || !adapter || adapter.jointSpaces.length !== JOINT_COUNT) continue;
      adapter.toggleVisual(false);
      if (!frame.fillPoses?.(adapter.jointSpaces, ref, this.poses)) continue;
      const hasRadii = frame.fillJointRadii?.(adapter.jointSpaces, this.radii) ?? false;
      const { pos, rad } = sample.joints;
      for (let k = 0; k < JOINT_COUNT; k++) {
        const i = JOINT_INDEX[adapter.jointSpaces[k].jointName];
        if (i === undefined) continue;
        const x = this.poses[k * 16 + 12];
        const y = this.poses[k * 16 + 13];
        const z = this.poses[k * 16 + 14];
        pos[i * 3] = m[0] * x + m[4] * y + m[8] * z + m[12];
        pos[i * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
        pos[i * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
        rad[i] = hasRadii ? this.radii[k] : 0;
      }
      sample.tracked = true;
    }
  }
}
```

**File: `src/systems/StageSystem.ts`**
```ts
import { createSystem, Quaternion, Vector3, XRPlane } from '@iwsdk/core';
import { buildStage, chooseWall, type HeadPose, type PlaneInfo } from '../core/stage.js';
import type { Vec3 } from '../core/vec.js';
import { store } from '../runtime/store.js';

interface XRPlaneLike {
  readonly orientation?: string;
  readonly polygon: ReadonlyArray<{ x: number; y: number; z: number }>;
}

/** Seconds to wait for plane detection before falling back to the paper screen. */
const PLANE_WAIT = 2;

/** Chooses the wall in front of the player once per XR session (or on Re-light). */
export class StageSystem extends createSystem({ planes: { required: [XRPlane] } }) {
  private waited = 0;
  private readonly v = new Vector3();
  private readonly q = new Quaternion();

  update(delta: number): void {
    if (!this.renderer.xr.isPresenting) {
      if (store.stage) {
        store.stage = null;
        store.stageVersion++;
      }
      this.waited = 0;
      return;
    }
    if (store.stage && !store.relightRequested) return;
    const head = this.headPose();
    const wall = chooseWall(this.collectPlanes(), head);
    this.waited += delta;
    if (!wall && this.waited < PLANE_WAIT && !store.relightRequested) return;
    store.stage = buildStage(head, wall, { narrow: store.narrow });
    store.stageVersion++;
    store.relightRequested = false;
    this.waited = 0;
  }

  private headPose(): HeadPose {
    this.player.head.getWorldPosition(this.v);
    const position: Vec3 = [this.v.x, this.v.y, this.v.z];
    this.player.head.getWorldQuaternion(this.q);
    this.v.set(0, 0, -1).applyQuaternion(this.q);
    return { position, forward: [this.v.x, this.v.y, this.v.z] };
  }

  private collectPlanes(): PlaneInfo[] {
    const planes: PlaneInfo[] = [];
    for (const entity of this.queries.planes.entities) {
      const plane = entity.getValue(XRPlane, '_plane') as XRPlaneLike | undefined;
      const object = entity.object3D;
      if (!plane || !object) continue;
      object.updateWorldMatrix(true, false);
      const m = object.matrixWorld;
      const c = new Vector3().setFromMatrixPosition(m);
      const n = new Vector3(0, 1, 0).transformDirection(m);
      const polygon = plane.polygon.map((p): Vec3 => {
        const w = new Vector3(p.x, p.y, p.z).applyMatrix4(m);
        return [w.x, w.y, w.z];
      });
      planes.push({ center: [c.x, c.y, c.z], normal: [n.x, n.y, n.z], polygon, vertical: plane.orientation === 'vertical' });
    }
    return planes;
  }
}
```

- [ ] **Step 3: Game and render systems**

**File: `src/systems/GameSystem.ts`**
```ts
import { createSystem } from '@iwsdk/core';
import { HopperCreature } from '../core/creature.js';
import { BONES } from '../core/joints.js';
import { buildCreatureShapes, CREATURES, type CreatureShape } from '../core/library.js';
import { Matcher, TUNING } from '../core/matcher.js';
import { CAPSULE_STRIDE, ShadowProjector } from '../core/projector.js';
import { mulberry32 } from '../core/rng.js';
import { createFrame, matchScore, Silhouettes, type ShapeFrame } from '../core/silhouette.js';
import type { Stage } from '../core/stage.js';
import { CH_GLOW, CH_SHADOW, CH_TARGET, type ShadowCanvas } from '../render/ShadowCanvas.js';
import { SIDES, store } from '../runtime/store.js';

const MATCH_INTERVAL = 1 / 15;
const NEXT_VISITOR_DELAY = 2.5;
const HAND_CAPACITY = BONES.length + 1;

/** Visitors, matching, reveals and the living zoo. Fills the shadow canvas each frame. */
export class GameSystem extends createSystem({}) {
  private readonly sil = new Silhouettes();
  private readonly shapes = buildCreatureShapes(this.sil);
  private readonly projector = new ShadowProjector();
  private readonly handCaps = {
    left: new Float32Array(HAND_CAPACITY * CAPSULE_STRIDE),
    right: new Float32Array(HAND_CAPACITY * CAPSULE_STRIDE),
  };
  private readonly handCount = { left: 0, right: 0 };
  private readonly frame = createFrame();
  private readonly bestFrame: ShapeFrame = createFrame();
  private readonly drawCaps = new Float32Array(BONES.length * CAPSULE_STRIDE);
  private readonly matcher = new Matcher(TUNING.normal);
  private readonly rng = mulberry32(20261109);
  private readonly creatures: HopperCreature[] = [];
  private visitorIndex = 0;
  private visitor: CreatureShape | null = null;
  private nextVisitorIn = 1.2;
  private pending = 0;
  private time = 0;
  private stageVersion = -1;
  private magnification = 3;

  update(delta: number): void {
    const canvas = store.canvas;
    const stage = store.stage;
    if (!canvas || !stage) return;
    if (this.stageVersion !== store.stageVersion) this.onStage(stage);
    this.time += delta;
    this.projector.setup(stage.lantern, stage);
    canvas.begin();
    this.drawHands(canvas);
    this.updateVisitor(canvas, delta);
    this.updateZoo(canvas, stage, delta);
    canvas.end();
  }

  private onStage(stage: Stage): void {
    this.stageVersion = store.stageVersion;
    const toLantern = Math.hypot(stage.lantern[0] - stage.origin[0], stage.lantern[1] - stage.origin[1], stage.lantern[2] - stage.origin[2]);
    const toHand = Math.hypot(stage.lantern[0] - stage.hand[0], stage.lantern[1] - stage.hand[1], stage.lantern[2] - stage.hand[2]);
    this.magnification = toLantern / toHand;
    this.creatures.length = 0;
    this.visitor = null;
    this.visitorIndex = 0;
    this.nextVisitorIn = 1.2;
    this.matcher.reset();
  }

  private drawHands(canvas: ShadowCanvas): void {
    for (const side of SIDES) {
      const hand = store.hands[side];
      const caps = this.handCaps[side];
      this.handCount[side] = 0;
      if (!hand.tracked) continue;
      const n = this.projector.projectBones(hand.joints, caps, 0);
      const arm = this.projector.projectForearm(hand.joints, caps, n);
      this.handCount[side] = n;
      canvas.addCapsules(caps, 0, n + arm, CH_SHADOW, 1);
    }
  }

  private updateVisitor(canvas: ShadowCanvas, delta: number): void {
    if (!this.visitor) {
      this.nextVisitorIn -= delta;
      if (this.nextVisitorIn <= 0) {
        this.visitor = this.shapes.get(CREATURES[this.visitorIndex % CREATURES.length].id)!;
        this.matcher.reset();
      }
      return;
    }
    const pulse = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(this.time * 2.6)) * (0.6 + 0.4 * this.matcher.progress());
    this.drawShape(canvas, this.visitor, 0, 0, this.magnification, 1, CH_TARGET, pulse);
    this.pending += delta;
    if (this.pending < MATCH_INTERVAL) return;
    const dt = this.pending;
    this.pending = 0;
    let best: number | null = null;
    for (const side of SIDES) {
      if (this.handCount[side] === 0) continue;
      const score = matchScore(this.sil, this.handCaps[side], 0, this.handCount[side], this.visitor.target, this.frame);
      if (best === null || score > best) {
        best = score;
        this.bestFrame.cx = this.frame.cx;
        this.bestFrame.cy = this.frame.cy;
        this.bestFrame.size = this.frame.size;
      }
    }
    if (this.matcher.update(dt, best) === 'matched') this.reveal(this.visitor);
  }

  private reveal(shape: CreatureShape): void {
    const scale = this.bestFrame.size / shape.target.frame.size;
    this.creatures.push(new HopperCreature(shape.def.id, this.bestFrame.cx, this.bestFrame.cy, scale, this.bestFrame.size, this.rng));
    this.visitor = null;
    this.visitorIndex++;
    this.nextVisitorIn = NEXT_VISITOR_DELAY;
  }

  private updateZoo(canvas: ShadowCanvas, stage: Stage, delta: number): void {
    const pool = { u: stage.poolU * 0.8, v: stage.poolV * 0.7 };
    for (const creature of this.creatures) {
      creature.update(delta, pool);
      const shape = this.shapes.get(creature.id)!;
      this.drawShape(canvas, shape, creature.x, creature.y + creature.hop, creature.scale, creature.facing, CH_SHADOW, 1);
      const ex = (shape.eye[0] - shape.target.frame.cx) * creature.scale * creature.facing + creature.x;
      const ey = (shape.eye[1] - shape.target.frame.cy) * creature.scale + creature.y + creature.hop;
      canvas.addDot(ex, ey, 0.006 * creature.scale, CH_GLOW, 1);
    }
  }

  /** Draws a canonical silhouette centered at (x, y) with the given scale and facing (-1 mirrors). */
  private drawShape(canvas: ShadowCanvas, shape: CreatureShape, x: number, y: number, scale: number, facing: number, channel: number, strength: number): void {
    const { cx, cy } = shape.target.frame;
    const src = shape.caps;
    const out = this.drawCaps;
    for (let i = 0; i < shape.count; i++) {
      const o = i * CAPSULE_STRIDE;
      out[o] = (src[o] - cx) * scale * facing + x;
      out[o + 1] = (src[o + 1] - cy) * scale + y;
      out[o + 2] = src[o + 2] * scale;
      out[o + 3] = (src[o + 3] - cx) * scale * facing + x;
      out[o + 4] = (src[o + 4] - cy) * scale + y;
      out[o + 5] = src[o + 5] * scale;
    }
    canvas.addCapsules(out, 0, shape.count, channel, strength);
  }
}
```

**File: `src/systems/RenderSystem.ts`**
```ts
import { createSystem } from '@iwsdk/core';
import { ShadowCanvas } from '../render/ShadowCanvas.js';
import { store } from '../runtime/store.js';

/** Owns the shadow canvas entity and renders its mask once per frame. */
export class RenderSystem extends createSystem({}) {
  private canvas!: ShadowCanvas;
  private version = -1;
  private fade = 0;

  init(): void {
    this.canvas = new ShadowCanvas();
    this.world.createTransformEntity(this.canvas.composite);
    this.canvas.composite.visible = false;
    store.canvas = this.canvas;
  }

  update(delta: number): void {
    const stage = store.stage;
    if (!stage) {
      this.canvas.composite.visible = false;
      this.version = -1;
      this.fade = 0;
      return;
    }
    if (this.version !== store.stageVersion) {
      this.canvas.configure(stage);
      this.canvas.composite.visible = true;
      this.version = store.stageVersion;
      this.fade = 0;
    }
    this.fade = Math.min(1, this.fade + delta / 1.2);
    this.canvas.setFade(this.fade);
    this.canvas.render(this.renderer);
  }
}
```

- [ ] **Step 4: Register the systems**

**File: `src/index.ts#systems`**
```ts
import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { GameSystem } from './systems/GameSystem.js';
import { HandSystem } from './systems/HandSystem.js';
import { RenderSystem } from './systems/RenderSystem.js';
import { StageSystem } from './systems/StageSystem.js';

World.create(document.getElementById('scene-container') as HTMLDivElement, projectOptions).then((world) => {
  world
    .registerSystem(HandSystem, { priority: 0 })
    .registerSystem(StageSystem, { priority: 1 })
    .registerSystem(GameSystem, { priority: 10 })
    .registerSystem(RenderSystem, { priority: 25 });
});
```

- [ ] **Step 5: Typecheck, test and build**

Run: `npm run typecheck && npm test && npm run build`
Expected: no type errors, all tests pass, and Vite reports `✓ built in`.

If typecheck flags an IWSDK member such as `this.xrFrame`, `this.xrManager` or `entity.object3D`, look up the real name:
```bash
grep -n "xrFrame\|xrManager\|object3D\|visualAdapters" node_modules/@iwsdk/core/dist/ecs/*.d.ts node_modules/@iwsdk/core/dist/input/*.d.ts
```
Fix the call to match the declaration, then rerun.

- [ ] **Step 6: Commit**

```bash
git add src/runtime src/systems src/index.ts
git commit -m "feat: wire hand, stage, game and render systems for the shadow loop"
```

---

### Task 13: Emulator checkpoint (spec checkpoint, Nov 11)

**Files:**
- Create: `docs/checkpoint-phase1.md`, `docs/evidence/` (screenshots)

- [ ] **Step 1: Start the managed dev server with a synthetic rabbit hand**

Run in the background: `VITE_TESTPOSE=rabbit npm run dev`
Then run: `npx iwsdk dev status`
Expected: the status shows `browserCommandReady: true`, and `data.runtimeUrls` lists the local URL.

- [ ] **Step 2: Enter XR and capture the stage**

Run: `npx iwsdk xr enter` and wait 3 s. Then run `npx iwsdk xr status`.
Expected: the status shows an active `immersive-ar` session.

Find the screenshot action with `npx iwsdk browser --help`, then capture to `docs/evidence/p1-rabbit-target.png`.
Expected in the screenshot:
- a warm light pool on the living-room wall;
- a dark hand shadow (the rabbit shape) inside it;
- a glowing target outline;
- within about 2 s, a hopping rabbit shadow with a glowing eye.

Capture `docs/evidence/p1-rabbit-alive.png` once the rabbit is visible.

- [ ] **Step 3: Exercise the real emulator hand path (no synthetic pose)**

1. Stop the server: `npx iwsdk dev down`.
2. Start it again without the variable: `npm run dev` in the background.
3. Run `npx iwsdk xr enter`.
4. Run `npx iwsdk xr set-input-mode --input-json '{"mode":"hands"}'`. If the mode name is rejected, check `npx iwsdk xr set-input-mode --help` for the accepted name.
5. Find the hand-pose action with `npx iwsdk xr --help`. Use it to set `device: "hand-right"` to pose `peace`, the closest built-in to the rabbit. If no hand-pose action exists, record that in the checkpoint notes and rely on Step 2.
6. Use `npx iwsdk xr set-transform` (see its `--help`) to move `hand-right` about 0.35 m in front of the head and 0.3 m below it.
7. Capture `docs/evidence/p1-emulated-hand.png`.

Expected: the dark shadow follows the emulated hand. A rabbit should appear if the emulated pose scores above the relaxing threshold within 20 s.

- [ ] **Step 4: Write the checkpoint record**

**File: `docs/checkpoint-phase1.md`**
```markdown
# Phase 1 checkpoint — shadow loop

Date: (fill in the actual date and time of the run)

| Check | Result |
| --- | --- |
| Unit tests | (paste the `npm test` summary line) |
| Typecheck and build | (pass or fail, with the first error if any) |
| Stage on the emulator living-room wall | (yes/no, plus screenshot path) |
| Synthetic rabbit pose matched and came alive | (yes/no, plus screenshot path) |
| Emulated hand shadow follows the hand | (yes/no, plus screenshot path) |
| Emulated built-in pose matched a visitor | (yes/no, with which pose and the time it took) |

Limits: emulator only. There are no physical-headset results, and no performance numbers beyond the desktop frame time.

Decision: continue to Phase 2, or fall back to ComfortPass (with the reason).
```

Write the actual observed values into each row. Don't leave any parenthetical text in the committed file.

- [ ] **Step 5: Commit**

```bash
git add docs/checkpoint-phase1.md docs/evidence
git commit -m "docs: record Phase 1 emulator checkpoint"
```

---

## Self-review notes

- **Spec coverage, Phase 1 slice:** §3.1 is in Task 1; §3.2 is in Tasks 5 and 9; §3.3's pure modules are in Tasks 2–10; §3.4 and §3.5 are in Tasks 11 and 12; §3.6's fallback and tracking-loss handling are in Tasks 8, 9 and 12; §3.7's unit, pose and sheet tests are in Tasks 2–10, with emulator evidence in Task 13; §5's checkpoint is Task 13.
- **Phase 2 plan (written after the checkpoint):** everything else in §2, §3.3 and §4:
  - creature behaviors beyond hopping;
  - pet, feed and wear;
  - procedural audio;
  - progression, save, the daily visitor and the streak;
  - the menu and Re-light;
  - onboarding and the ghost hand;
  - the assist and narrow-view settings;
  - hosting.
- **Type consistency checked:**
  - `CAPSULE_STRIDE` and `StagePlane` come from `projector.ts`.
  - `Stage` extends `StagePlane` and adds `lantern`, `hand`, `poolU`, `poolV`, `distance` and `fallback`.
  - `TargetShape.frame` is a `ShapeFrame`.
  - `CreatureShape.eye` is a canonical point.
  - `HopperCreature` is constructed as `(id, x, y, scale, size, rng)` and `GameSystem` calls it that way.
  - `TUNING.normal.threshold` is shared by the library tests and the game.
