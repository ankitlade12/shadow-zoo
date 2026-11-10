# Shadow Zoo Phase 2A (living zoo) — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Creatures that have come alive behave like characters:
- Each has a motion style and a signature action, plus blinking eyes.
- The player pets them with their hand's shadow and pinches to release fireflies, which the creatures chase and eat. Both earn hearts.
- The player can "wear" an unlocked creature and puppeteer its voice; the zoo reacts.
- Everything has synthesized, spatialized sound.

**Architecture:**
- New pure modules, all with unit tests:
  - in `src/core`: `animate`, `creature` (rewrite), `fireflies`, `particles`, `interact`, `puppet`, `voices`;
  - in `src/game`: `hands`, `Visitors`, `Puppeteer`, `Zoo`.
- `GameSystem` becomes a thin orchestrator. A new `AudioSystem` turns game events into WebAudio sounds placed on the wall.
- Creature animation blends precomputed base and action capsules, so there is no per-frame pose building.

**Tech stack:** as in Phase 1 (IWSDK 1.1.0-rc.2, TypeScript, Vitest), plus the Web Audio API.

**Spec:** `docs/superpowers/specs/2026-11-09-shadow-zoo-design.md` §2.3 (play), §2.2 (behaviors and puppet actions), §3.3 (`creatures.ts`, `puppet.ts`, `AudioSystem`).

**Conventions:** as in Phase 1. Stage coordinates: `u` right, `v` up, meters. Events are plain objects pushed to `store.events` and consumed by `AudioSystem` once per frame.

---

## File structure

| File | Responsibility |
|---|---|
| `src/core/poses.ts` (append) | `jointDistance` |
| `src/core/library.ts` (rewrite) | Creature definitions plus `act` pose, `motion`, `actuator`; shapes with `actCaps`, `actJoints`, actuator distances |
| `src/core/animate.ts` | Blend and place capsules and points (allocation-free) |
| `src/core/creature.ts` (rewrite) | `Creature` behaviors: appear, rest, wander, chase, eat, happy, flee; gaits; blink; bounds |
| `src/core/fireflies.ts` | Firefly spawn, drift, lifetime, lookup |
| `src/core/particles.ts` | Sparks and hearts in fixed-size typed arrays |
| `src/core/interact.ts` | `PinchDetector` (hysteresis); `capsulesNear` (touch test) |
| `src/core/puppet.ts` | `openness` (actuator); `WornState` (wear and voice edges) |
| `src/core/voices.ts` | `VoiceLimiter` (repeat gap and polyphony cap) |
| `src/game/events.ts` | `GameEvent`, `Revealed` |
| `src/game/hands.ts` | `HandShadow` per hand: capsules, fingertip and palm shadows, speed, pinch |
| `src/game/Visitors.ts` | Visitor queue, matching, reveal |
| `src/game/Puppeteer.ts` | Wear detection against unlocked creatures; worn eye, tip and voice |
| `src/game/Zoo.ts` | Creatures, fireflies, particles; feed, pet, voice reactions; events |
| `src/audio/recipes.ts` | Synthesized sound recipes |
| `src/audio/AudioEngine.ts` | Context unlock, master gain, spatial panners, ambience, limiter |
| `src/systems/AudioSystem.ts` | Unlock on gesture and XR start; listener pose; plays `store.events` |
| `src/systems/GameSystem.ts` (rewrite) | Orchestrates hands, visitors, puppeteer, zoo; draws everything |
| `src/runtime/store.ts` (modify) | Adds `events` |
| `src/index.ts` (modify) | Registers `AudioSystem` |

---

### Task 1: Creature actions, motion styles and actuators

**Files:**
- Modify: `src/core/poses.ts` (append), `src/core/library.ts` (rewrite), `tests/core/library.test.ts` (append one test)

- [ ] **Step 1: Write the failing test** (append inside the `describe('creature library', …)` block, before its closing `});`)

**File: `tests/core/library.test.ts#actions`**
```ts
  it.each(ids)('%s has an action pose and an actuator that closes', (id) => {
    const s = shapes.get(id)!;
    expect(s.actCaps.length).toBe(s.caps.length);
    expect(s.actuator.open - s.actuator.closed).toBeGreaterThan(0.01);
    expect(['hop', 'trot', 'slither', 'strut', 'dangle', 'creep']).toContain(s.def.motion);
  });
```

Insert it with the Edit tool directly after the `'%s still reads after a 10 degree turn toward the wall'` test.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/library.test.ts`
Expected: FAIL. TypeScript/runtime error: `actCaps` is undefined.

- [ ] **Step 3: Implement**

**File: `src/core/poses.ts#distance`** (append)
```ts

/** Distance in meters between two joints of a set. */
export function jointDistance(js: JointSet, a: number, b: number): number {
  const p = js.pos;
  return Math.hypot(p[a * 3] - p[b * 3], p[a * 3 + 1] - p[b * 3 + 1], p[a * 3 + 2] - p[b * 3 + 2]);
}
```

**File: `src/core/library.ts#2a`**
```ts
import { BONES, J } from './joints.js';
import {
  buildJointSet,
  builtinAngles,
  jointDistance,
  orientJointSet,
  type HandPoseAngles,
  type JointSet,
} from './poses.js';
import { CAPSULE_STRIDE, ShadowProjector, type StagePlane } from './projector.js';
import { Silhouettes, TargetShape } from './silhouette.js';
import type { Vec3 } from './vec.js';

export type CreatureId = 'rabbit' | 'dog' | 'crocodile' | 'peacock' | 'spider' | 'turtle';
/** How a living creature moves around the light pool. */
export type Motion = 'hop' | 'trot' | 'slither' | 'strut' | 'dangle' | 'creep';

export interface CreatureDef {
  readonly id: CreatureId;
  readonly name: string;
  /** Base hand pose (IWER joint angles, left-hand convention): the shape players match. */
  readonly angles: HandPoseAngles;
  /** Signature action pose: ears fold, jaw snaps shut, tail folds, legs curl, head tucks. */
  readonly act: HandPoseAngles;
  readonly motion: Motion;
  /** Canonical hand orientation in stage axes: x = right (u), y = up (v), z = toward the player (n). */
  readonly facing: { readonly fingers: Vec3; readonly palm: Vec3 };
  /** Eye glint: a joint plus an offset in silhouette-size units (x right, y up). */
  readonly eye: { readonly joint: number; readonly dx: number; readonly dy: number };
  /** Joints whose distance is "open" in the base pose and "closed" in the act pose. */
  readonly actuator: { readonly a: number; readonly b: number };
}

const B = builtinAngles;

// Sideways V: two tall ears leaning back; folded fingers and thumb form the head.
const RABBIT: HandPoseAngles = {
  ...B.peace,
  index: { mcp: 0, pip: 6, dip: 4, yaw: -12 },
  middle: { mcp: 0, pip: 6, dip: 4, yaw: 12 },
};
// Flat snout forward, thumb up as the ear, pinky spread down as the open jaw.
const DOG: HandPoseAngles = { ...B.flat, thumb: B['thumbs-up'].thumb, pinky: { mcp: 15, pip: 8, dip: 4, yaw: 32 } };
// Fingers together as the upper jaw, straight thumb swung down as the wide-open lower jaw.
const CROCODILE: HandPoseAngles = { ...B.flat, thumb: { ...B.flat.thumb, cmc: [-58, -4.8, -67.7], mcp: 0, ip: 0 } };
// Back of the hand to the light, fingers spread and curled down as legs.
const SPIDER: HandPoseAngles = {
  ...B.claw,
  thumb: B.open.thumb,
  index: { mcp: 12, pip: 30, dip: 20, yaw: -32 },
  middle: { mcp: 12, pip: 30, dip: 20, yaw: -10 },
  ring: { mcp: 14, pip: 30, dip: 20, yaw: 12 },
  pinky: { mcp: 18, pip: 32, dip: 20, yaw: 34 },
};
// Fist as the shell seen end-on, short bent thumb as the head.
const TURTLE: HandPoseAngles = { ...B['thumbs-up'], thumb: { ...B['thumbs-up'].thumb, mcp: 25, ip: 20 } };

export const CREATURES: readonly CreatureDef[] = [
  {
    id: 'rabbit',
    name: 'Rabbit',
    angles: RABBIT,
    act: { ...RABBIT, index: { mcp: 24, pip: 40, dip: 20, yaw: -14 }, middle: { mcp: 24, pip: 40, dip: 20, yaw: 14 } },
    motion: 'hop',
    facing: { fingers: [-0.45, 1, 0], palm: [0, 0, -1] },
    eye: { joint: J.thumbTip, dx: 0.1, dy: 0.12 },
    actuator: { a: J.indexTip, b: J.thumbTip },
  },
  {
    id: 'dog',
    name: 'Dog',
    angles: DOG,
    act: { ...DOG, pinky: { mcp: 6, pip: 4, dip: 2, yaw: -4 } },
    motion: 'trot',
    facing: { fingers: [1, 0.1, 0], palm: [0, 0, 1] },
    eye: { joint: J.indexProx, dx: 0.05, dy: 0.1 },
    actuator: { a: J.pinkyTip, b: J.ringTip },
  },
  {
    id: 'crocodile',
    name: 'Crocodile',
    angles: CROCODILE,
    act: { ...CROCODILE, thumb: { ...B.flat.thumb, cmc: [-20, -4.8, -67.7], mcp: 0, ip: 0 } },
    motion: 'slither',
    facing: { fingers: [1, 0.05, 0], palm: [0, 0, -1] },
    eye: { joint: J.indexProx, dx: 0, dy: 0.12 },
    actuator: { a: J.thumbTip, b: J.indexTip },
  },
  {
    // Open hand: fingers fanned up as the tail, thumb out front as the head and beak.
    id: 'peacock',
    name: 'Peacock',
    angles: B.open,
    act: {
      ...B.open,
      index: { ...B.open.index, yaw: -4 },
      middle: { ...B.open.middle, yaw: 0 },
      ring: { ...B.open.ring, yaw: 6 },
      pinky: { ...B.open.pinky, yaw: 8 },
    },
    motion: 'strut',
    facing: { fingers: [-0.2, 1, 0], palm: [0, 0, -1] },
    eye: { joint: J.thumbProx, dx: 0.02, dy: 0.06 },
    actuator: { a: J.indexTip, b: J.pinkyTip },
  },
  {
    id: 'spider',
    name: 'Spider',
    angles: SPIDER,
    act: {
      ...SPIDER,
      index: { mcp: 35, pip: 70, dip: 40, yaw: -28 },
      middle: { mcp: 35, pip: 70, dip: 40, yaw: -8 },
      ring: { mcp: 35, pip: 70, dip: 40, yaw: 10 },
      pinky: { mcp: 38, pip: 70, dip: 40, yaw: 30 },
    },
    motion: 'dangle',
    facing: { fingers: [0, -1, 0], palm: [0, 0, -1] },
    eye: { joint: J.middleMeta, dx: 0, dy: 0.05 },
    actuator: { a: J.middleTip, b: J.wrist },
  },
  {
    id: 'turtle',
    name: 'Turtle',
    angles: TURTLE,
    act: { ...TURTLE, thumb: B.fist.thumb },
    motion: 'creep',
    facing: { fingers: [0, -0.3, -1], palm: [0, -1, 0] },
    eye: { joint: J.thumbTip, dx: -0.03, dy: 0.06 },
    actuator: { a: J.thumbTip, b: J.indexProx },
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
export function canonicalJoints(def: CreatureDef, angles: HandPoseAngles = def.angles): JointSet {
  return orientJointSet(buildJointSet(angles), 'left', def.facing, CANON_WRIST);
}

export function canonicalCapsules(joints: JointSet, out = new Float32Array(BONES.length * CAPSULE_STRIDE)): { caps: Float32Array; count: number } {
  const projector = new ShadowProjector();
  projector.setup(CANON_LIGHT, CANON_STAGE);
  return { caps: out, count: projector.projectBones(joints, out, 0) };
}

export interface CreatureShape {
  readonly def: CreatureDef;
  readonly joints: JointSet;
  readonly actJoints: JointSet;
  readonly caps: Float32Array;
  /** Capsules of the act pose, same layout as `caps`. */
  readonly actCaps: Float32Array;
  readonly count: number;
  readonly target: TargetShape;
  /** Eye position in canonical stage space. */
  readonly eye: readonly [number, number];
  /** Actuator joints and their distances (meters) in the base (open) and act (closed) poses. */
  readonly actuator: { readonly a: number; readonly b: number; readonly open: number; readonly closed: number };
}

export function buildCreatureShapes(sil = new Silhouettes()): Map<CreatureId, CreatureShape> {
  const shapes = new Map<CreatureId, CreatureShape>();
  const projector = new ShadowProjector();
  projector.setup(CANON_LIGHT, CANON_STAGE);
  for (const def of CREATURES) {
    const joints = canonicalJoints(def);
    const actJoints = canonicalJoints(def, def.act);
    const { caps, count } = canonicalCapsules(joints);
    const act = canonicalCapsules(actJoints);
    if (act.count !== count) throw new Error(`${def.id}: the action pose lost bones`);
    const target = new TargetShape(caps, count, sil);
    const e = def.eye.joint * 3;
    projector.project(joints.pos[e], joints.pos[e + 1], joints.pos[e + 2]);
    const eye: [number, number] = [projector.x + def.eye.dx * target.frame.size, projector.y + def.eye.dy * target.frame.size];
    const { a, b } = def.actuator;
    const actuator = { a, b, open: jointDistance(joints, a, b), closed: jointDistance(actJoints, a, b) };
    shapes.set(def.id, { def, joints, actJoints, caps, actCaps: act.caps, count, target, eye, actuator });
  }
  return shapes;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/core/library.test.ts && npm run sheet`
Expected: PASS. 26 library tests, because the 6 new action tests join the 20 existing ones. The sheet is unchanged because the base poses are the same.

If an actuator test fails for one creature, increase that creature's `act` difference on the actuator joints by about 10° and rerun.

- [ ] **Step 5: Commit**

```bash
git add src/core/poses.ts src/core/library.ts tests/core/library.test.ts docs/silhouettes.png
git commit -m "feat(core): give each creature an action pose, motion style and actuator"
```

---

### Task 2: Animation helpers

**Files:**
- Create: `src/core/animate.ts`
- Test: `tests/core/animate.test.ts`

- [ ] **Step 1: Write the failing test**

**File: `tests/core/animate.test.ts`**
```ts
import { describe, expect, it } from 'vitest';
import { blendCapsules, placeCapsules, placePoint } from '../../src/core/animate.js';

describe('animate', () => {
  it('blends capsules between the base and act poses', () => {
    const base = Float32Array.from([0, 0, 1, 2, 2, 1]);
    const act = Float32Array.from([2, 2, 3, 4, 4, 3]);
    const out = new Float32Array(6);
    blendCapsules(base, act, 0.5, 1, out);
    expect(Array.from(out)).toEqual([1, 1, 2, 3, 3, 2]);
    blendCapsules(base, act, 0, 1, out);
    expect(Array.from(out)).toEqual(Array.from(base));
  });

  it('places capsules and points with scale, offset and mirroring', () => {
    const src = Float32Array.from([1, 0, 0.1, 2, 1, 0.2]);
    const out = new Float32Array(6);
    placeCapsules(src, 1, 1, 0, 10, 20, 2, -1, out);
    expect(Array.from(out).map((v) => +v.toFixed(5))).toEqual([10, 20, 0.2, 8, 22, 0.4]);
    const p = { x: 0, y: 0 };
    placePoint(2, 1, 1, 0, 10, 20, 2, -1, p);
    expect(p).toEqual({ x: 8, y: 22 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/animate.test.ts`
Expected: FAIL. The error says it can't resolve `../../src/core/animate.js`.

- [ ] **Step 3: Implement**

**File: `src/core/animate.ts`**
```ts
import { CAPSULE_STRIDE } from './projector.js';

export interface Point {
  x: number;
  y: number;
}

/** out = base + (act − base) · w for `count` capsules with identical layout. */
export function blendCapsules(base: Float32Array, act: Float32Array, w: number, count: number, out: Float32Array): void {
  const n = count * CAPSULE_STRIDE;
  for (let i = 0; i < n; i++) out[i] = base[i] + (act[i] - base[i]) * w;
}

/** Moves capsules from canonical space (centered on cx, cy) to (x, y) on the stage; facing −1 mirrors. */
export function placeCapsules(
  src: Float32Array,
  count: number,
  cx: number,
  cy: number,
  x: number,
  y: number,
  scale: number,
  facing: number,
  out: Float32Array,
): void {
  for (let i = 0; i < count; i++) {
    const o = i * CAPSULE_STRIDE;
    out[o] = (src[o] - cx) * scale * facing + x;
    out[o + 1] = (src[o + 1] - cy) * scale + y;
    out[o + 2] = src[o + 2] * scale;
    out[o + 3] = (src[o + 3] - cx) * scale * facing + x;
    out[o + 4] = (src[o + 4] - cy) * scale + y;
    out[o + 5] = src[o + 5] * scale;
  }
}

/** Transforms one canonical point the same way as `placeCapsules`. */
export function placePoint(px: number, py: number, cx: number, cy: number, x: number, y: number, scale: number, facing: number, out: Point): void {
  out.x = (px - cx) * scale * facing + x;
  out.y = (py - cy) * scale + y;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/animate.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/animate.ts tests/core/animate.test.ts
git commit -m "feat(core): add capsule blending and placement helpers"
```

---

### Task 3: Creature behaviors

**Files:**
- Rewrite: `src/core/creature.ts`, `tests/core/creature.test.ts`

- [ ] **Step 1: Write the failing test**

**File: `tests/core/creature.test.ts#2a`**
```ts
import { describe, expect, it } from 'vitest';
import { Creature, groundY, type CreatureEvent } from '../../src/core/creature.js';
import type { Motion } from '../../src/core/library.js';
import { mulberry32 } from '../../src/core/rng.js';

const pool = { u: 0.7, v: 0.5 };
const make = (motion: Motion = 'hop', x = 0, y = 0.2, seed = 1) => new Creature(1, 'rabbit', motion, x, y, 1, 0.3, mulberry32(seed));
const run = (c: Creature, seconds: number, events: CreatureEvent[] = []) => {
  for (let t = 0; t < seconds; t += 1 / 60) c.update(1 / 60, pool, events);
  return events;
};

describe('Creature', () => {
  it('appears with a bounce and settles onto the ground line', () => {
    const c = make();
    run(c, 1);
    expect(c.mode).not.toBe('appear');
    expect(Math.abs(c.y - groundY(pool))).toBeLessThan(0.01);
  });

  it.each<Motion>(['hop', 'trot', 'slither', 'strut', 'dangle', 'creep'])('%s wanders without leaving the pool', (motion) => {
    const c = make(motion, 0, 0, 7);
    for (let i = 0; i < 60 * 60; i++) {
      c.update(1 / 60, pool, []);
      expect((c.x / pool.u) ** 2 + (c.y / pool.v) ** 2).toBeLessThanOrEqual(1);
    }
  });

  it('chases a target until it is reached', () => {
    const c = make('trot');
    run(c, 1);
    c.chase(9, 0.4, groundY(pool) + 0.1);
    let reached = false;
    for (let i = 0; i < 600 && !reached; i++) {
      c.update(1 / 60, pool, []);
      reached = c.reached();
    }
    expect(reached).toBe(true);
  });

  it('the spider reaches targets above the ground', () => {
    const c = make('dangle', 0, 0.3);
    run(c, 1);
    c.chase(9, 0.2, 0.1);
    let reached = false;
    for (let i = 0; i < 900 && !reached; i++) {
      c.update(1 / 60, pool, []);
      reached = c.reached();
    }
    expect(reached).toBe(true);
  });

  it('eating emits one ate event and then cheers', () => {
    const c = make();
    run(c, 1);
    c.startEat();
    const events = run(c, 1);
    expect(events).toHaveLength(1);
    expect(events[0].creature).toBe(c);
    expect(c.mode).toBe('happy');
  });

  it('flees away from a threat and can be calmed', () => {
    const c = make('trot');
    run(c, 1);
    c.x = 0;
    c.flee(-0.1);
    run(c, 0.3);
    expect(c.x).toBeGreaterThan(0.1);
    c.calm();
    expect(c.mode).toBe('rest');
  });

  it('blinks now and then', () => {
    const c = make();
    let blinked = false;
    for (let i = 0; i < 60 * 10; i++) {
      c.update(1 / 60, pool, []);
      if (c.eyeOpen === 0) blinked = true;
    }
    expect(blinked).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/creature.test.ts`
Expected: FAIL. `Creature` (or `groundY`) is not exported.

- [ ] **Step 3: Implement**

**File: `src/core/creature.ts#2a`**
```ts
import type { CreatureId, Motion } from './library.js';

/** Light-pool ellipse half-axes on the stage (meters). */
export interface Pool {
  readonly u: number;
  readonly v: number;
}

export type Mode = 'appear' | 'rest' | 'wander' | 'chase' | 'eat' | 'happy' | 'flee';

export interface CreatureEvent {
  readonly type: 'ate';
  readonly creature: Creature;
}

/** Walking speed per motion style, in body sizes per second. */
const SPEED: Readonly<Record<Motion, number>> = { hop: 1.2, trot: 1.5, slither: 0.8, strut: 0.7, dangle: 0.9, creep: 0.3 };
const APPEAR_TIME = 0.8;

/** The line that walking creatures' silhouette centers follow, below the middle of the pool. */
export const groundY = (pool: Pool): number => -0.5 * pool.v;

/** Usable half-width of the pool at height y, kept clear of the soft edge. */
export function halfWidthAt(pool: Pool, y: number): number {
  const k = 1 - (y / pool.v) ** 2;
  return k > 0 ? pool.u * Math.sqrt(k) * 0.82 : 0;
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const easeOut = (k: number): number => 1 - (1 - k) ** 3;

function gaitLift(motion: Motion, t: number, size: number): number {
  switch (motion) {
    case 'hop':
      return Math.abs(Math.sin(t * 6.5)) * 0.32 * size;
    case 'trot':
      return Math.abs(Math.sin(t * 12)) * 0.04 * size;
    case 'strut':
      return Math.abs(Math.sin(t * 6)) * 0.05 * size;
    case 'creep':
      return Math.abs(Math.sin(t * 3)) * 0.015 * size;
    default:
      return 0;
  }
}

function gaitAct(motion: Motion, t: number): number {
  switch (motion) {
    case 'hop':
      return 0.3 * Math.abs(Math.sin(t * 6.5));
    case 'trot':
      return 0.25 * Math.abs(Math.sin(t * 12));
    case 'slither':
      return 0.3 + 0.3 * Math.sin(t * 6);
    case 'strut':
      return Math.max(0, Math.sin(t * 0.9) - 0.8) * 5;
    default:
      return 0;
  }
}

/** Occasional idle action (ear twitch, jaw, tail) while resting. */
function idleTwitch(t: number, id: number): number {
  const s = Math.sin(t * 1.7 + id * 1.3);
  return s > 0.93 ? (s - 0.93) / 0.07 : 0;
}

/** A living shadow creature on the stage. Pure simulation: no rendering, no IWSDK. */
export class Creature {
  mode: Mode = 'appear';
  facing: 1 | -1 = 1;
  /** Height above the path from hops and bobs (stage meters). */
  lift = 0;
  /** Blend 0..1 toward the creature's act pose. */
  act = 0;
  /** Scale multiplier during the appear bounce. */
  bounce = 1;
  /** 1 while the eye shows, 0 during a blink. */
  eyeOpen = 1;
  /** Hearts earned (0–5). */
  bond = 0;
  fireflyId = -1;
  private timer = APPEAR_TIME;
  private phase = 0;
  private targetX: number;
  private targetY: number;
  private readonly startY: number;
  private blinkIn: number;
  private blinkLeft = 0;
  private fleeFrom = 0;

  constructor(
    readonly id: number,
    readonly species: CreatureId,
    readonly motion: Motion,
    public x: number,
    public y: number,
    /** Canonical silhouette meters to stage meters. */
    public scale: number,
    /** Silhouette size on the wall (sqrt of area, meters). */
    readonly size: number,
    private readonly rng: () => number,
  ) {
    this.targetX = x;
    this.targetY = y;
    this.startY = y;
    this.blinkIn = 2 + rng() * 3;
  }

  /** Busy creatures ignore new fireflies and petting. */
  get busy(): boolean {
    return this.mode === 'appear' || this.mode === 'chase' || this.mode === 'eat' || this.mode === 'flee';
  }

  chase(fireflyId: number, x: number, y: number): void {
    this.mode = 'chase';
    this.fireflyId = fireflyId;
    this.targetX = x;
    this.targetY = y;
  }

  updateChaseTarget(x: number, y: number): void {
    this.targetX = x;
    this.targetY = y;
  }

  /** Close enough to eat the chased firefly. */
  reached(): boolean {
    if (Math.abs(this.targetX - this.x) >= this.size * 0.3) return false;
    const reachY = this.motion === 'dangle' ? 0.3 : 0.9;
    return Math.abs(this.targetY - this.y) < this.size * reachY;
  }

  pet(): void {
    if (this.mode === 'rest' || this.mode === 'wander' || this.mode === 'happy') {
      this.mode = 'happy';
      this.timer = 1.1;
    }
  }

  flee(fromX: number): void {
    if (this.mode === 'appear' || this.mode === 'eat') return;
    this.mode = 'flee';
    this.timer = 1.2;
    this.fleeFrom = fromX;
    this.fireflyId = -1;
  }

  /** Stops chasing or fleeing. */
  calm(): void {
    if (this.mode === 'chase' || this.mode === 'flee') this.settle();
  }

  startEat(): void {
    this.mode = 'eat';
    this.timer = 0.75;
    this.fireflyId = -1;
  }

  update(dt: number, pool: Pool, events: CreatureEvent[]): void {
    this.phase += dt;
    this.blink(dt);
    switch (this.mode) {
      case 'appear':
        this.appear(dt, pool);
        break;
      case 'rest':
        this.lift = 0;
        this.act = idleTwitch(this.phase, this.id);
        this.timer -= dt;
        if (this.timer <= 0) this.wander(pool);
        break;
      case 'eat':
        this.timer -= dt;
        this.lift = 0;
        this.act = Math.abs(Math.sin(this.timer * 22));
        if (this.timer <= 0) {
          this.act = 0;
          this.mode = 'happy';
          this.timer = 0.8;
          events.push({ type: 'ate', creature: this });
        }
        break;
      case 'happy':
        this.timer -= dt;
        this.lift = Math.abs(Math.sin(this.phase * 11)) * 0.1 * this.size;
        this.act = 0.5 + 0.5 * Math.sin(this.phase * 14);
        if (this.timer <= 0) this.settle();
        break;
      default:
        this.move(dt, pool);
    }
    this.keepInside(pool);
  }

  private appear(dt: number, pool: Pool): void {
    this.timer -= dt;
    const k = 1 - Math.max(0, this.timer) / APPEAR_TIME;
    this.bounce = 1 + 0.2 * Math.sin(Math.PI * k) * (1 - k);
    const goal = this.motion === 'dangle' ? this.startY : groundY(pool);
    this.y = this.startY + (goal - this.startY) * easeOut(k);
    this.act = 0.5 * Math.sin(k * Math.PI * 3) ** 2;
    this.lift = 0;
    if (this.timer <= 0) {
      this.bounce = 1;
      this.settle();
    }
  }

  private settle(): void {
    this.mode = 'rest';
    this.timer = 0.6 + this.rng() * 1.6;
    this.act = 0;
    this.lift = 0;
    this.fireflyId = -1;
  }

  private wander(pool: Pool): void {
    this.mode = 'wander';
    if (this.motion === 'dangle') {
      this.targetX = (this.rng() * 2 - 1) * halfWidthAt(pool, 0.3 * pool.v);
      this.targetY = -0.4 * pool.v + this.rng() * 0.9 * pool.v;
    } else {
      this.targetX = (this.rng() * 2 - 1) * halfWidthAt(pool, groundY(pool));
      this.targetY = groundY(pool);
    }
  }

  private move(dt: number, pool: Pool): void {
    let goalX = this.targetX;
    let mult = 1;
    if (this.mode === 'chase') mult = 1.7;
    else if (this.mode === 'flee') {
      mult = 2.4;
      goalX = this.x + (this.x >= this.fleeFrom ? 1 : -1) * pool.u;
      this.timer -= dt;
      if (this.timer <= 0) {
        this.settle();
        return;
      }
    }
    const step = SPEED[this.motion] * this.size * mult * dt;
    const dx = goalX - this.x;
    this.x += clamp(dx, -step, step);
    if (Math.abs(dx) > 1e-4) this.facing = dx > 0 ? 1 : -1;
    if (this.motion === 'dangle') {
      const goalY = this.mode === 'flee' ? 0.5 * pool.v : this.targetY;
      const dy = goalY - this.y;
      this.y += clamp(dy, -step, step);
      const moving = Math.abs(dx) > 0.004 || Math.abs(dy) > 0.004;
      this.lift = 0;
      this.act = moving ? 0.5 + 0.5 * Math.sin(this.phase * 16) : 0.1;
      if (this.mode === 'wander' && !moving) this.settle();
      return;
    }
    this.y += (groundY(pool) - this.y) * Math.min(1, dt * 4);
    const moving = Math.abs(dx) > 0.004;
    this.lift = moving ? gaitLift(this.motion, this.phase * mult, this.size) : 0;
    this.act = moving ? gaitAct(this.motion, this.phase) : 0;
    if (this.mode === 'wander' && !moving) this.settle();
  }

  private blink(dt: number): void {
    if (this.blinkLeft > 0) {
      this.blinkLeft -= dt;
      this.eyeOpen = this.blinkLeft > 0 ? 0 : 1;
      return;
    }
    this.blinkIn -= dt;
    if (this.blinkIn <= 0) {
      this.blinkLeft = 0.12;
      this.eyeOpen = 0;
      this.blinkIn = 2.5 + this.rng() * 3;
    }
  }

  private keepInside(pool: Pool): void {
    this.y = clamp(this.y, -0.85 * pool.v, 0.85 * pool.v);
    const hw = halfWidthAt(pool, this.y);
    this.x = clamp(this.x, -hw, hw);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/creature.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/creature.ts tests/core/creature.test.ts
git commit -m "feat(core): give creatures motion styles, chase, eat, cheer, flee and blink"
```

---

### Task 4: Fireflies and particles

**Files:**
- Create: `src/core/fireflies.ts`, `src/core/particles.ts`
- Test: `tests/core/fireflies.test.ts`

- [ ] **Step 1: Write the failing test**

**File: `tests/core/fireflies.test.ts`**
```ts
import { describe, expect, it } from 'vitest';
import { groundY } from '../../src/core/creature.js';
import { Fireflies } from '../../src/core/fireflies.js';
import { HEART, Particles, SPARK } from '../../src/core/particles.js';
import { mulberry32 } from '../../src/core/rng.js';

const pool = { u: 0.7, v: 0.5 };

describe('Fireflies', () => {
  it('spawns inside the pool, at most six at a time', () => {
    const ff = new Fireflies();
    const rng = mulberry32(1);
    for (let i = 0; i < 8; i++) ff.spawn(5, 5, pool, rng);
    expect(ff.list).toHaveLength(6);
    for (const f of ff.list) expect((f.x / pool.u) ** 2 + (f.y / pool.v) ** 2).toBeLessThanOrEqual(1);
  });

  it('drifts down toward the creatures and expires', () => {
    const ff = new Fireflies();
    const f = ff.spawn(0, 0.3, pool, mulberry32(2))!;
    for (let i = 0; i < 60 * 5; i++) ff.update(1 / 60, pool);
    expect(f.y).toBeLessThan(0.3);
    expect(f.y).toBeGreaterThan(groundY(pool));
    for (let i = 0; i < 60 * 25; i++) ff.update(1 / 60, pool);
    expect(ff.list).toHaveLength(0);
  });

  it('finds the nearest firefly, optionally only free ones, and removes by id', () => {
    const ff = new Fireflies();
    const rng = mulberry32(3);
    const a = ff.spawn(-0.3, 0, pool, rng)!;
    const b = ff.spawn(0.3, 0, pool, rng)!;
    expect(ff.nearest(0.25, 0)!.id).toBe(b.id);
    b.claimed = true;
    expect(ff.nearest(0.25, 0, Infinity, true)!.id).toBe(a.id);
    ff.remove(a.id);
    expect(ff.get(a.id)).toBeNull();
    expect(ff.nearest(0.25, 0, 0.01)).toBeNull();
  });
});

describe('Particles', () => {
  it('emits, lets hearts rise and expires everything', () => {
    const p = new Particles();
    const rng = mulberry32(4);
    p.emit(HEART, 0, 0, 3, 0.2, rng);
    p.emit(SPARK, 0, 0, 5, 0.2, rng);
    expect(p.count).toBe(8);
    for (let i = 0; i < 30; i++) p.update(1 / 60);
    for (let i = 0; i < p.count; i++) if (p.kind[i] === HEART) expect(p.y[i]).toBeGreaterThan(0);
    for (let i = 0; i < 120; i++) p.update(1 / 60);
    expect(p.count).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/fireflies.test.ts`
Expected: FAIL. The error says it can't resolve `../../src/core/fireflies.js`.

- [ ] **Step 3: Implement**

**File: `src/core/fireflies.ts`**
```ts
import { groundY, halfWidthAt, type Pool } from './creature.js';

export interface Firefly {
  readonly id: number;
  x: number;
  y: number;
  age: number;
  claimed: boolean;
  readonly seed: number;
}

const MAX_FIREFLIES = 6;
const LIFETIME = 25;
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** Glowing snacks released by a pinch; they sink gently toward the creatures. */
export class Fireflies {
  readonly list: Firefly[] = [];
  private nextId = 1;

  spawn(x: number, y: number, pool: Pool, rng: () => number): Firefly | null {
    if (this.list.length >= MAX_FIREFLIES) return null;
    const firefly: Firefly = { id: this.nextId++, x, y, age: 0, claimed: false, seed: rng() * 10 };
    this.keepInside(firefly, pool);
    this.list.push(firefly);
    return firefly;
  }

  get(id: number): Firefly | null {
    for (const f of this.list) if (f.id === id) return f;
    return null;
  }

  remove(id: number): void {
    for (let i = 0; i < this.list.length; i++) {
      if (this.list[i].id === id) {
        this.list.splice(i, 1);
        return;
      }
    }
  }

  /** Nearest firefly within `radius`; with `freeOnly`, ignores claimed ones. */
  nearest(x: number, y: number, radius = Infinity, freeOnly = false): Firefly | null {
    let best: Firefly | null = null;
    let bestDist = radius;
    for (const f of this.list) {
      if (freeOnly && f.claimed) continue;
      const d = Math.hypot(f.x - x, f.y - y);
      if (d <= bestDist) {
        bestDist = d;
        best = f;
      }
    }
    return best;
  }

  update(dt: number, pool: Pool): void {
    const settle = groundY(pool) + 0.18 * pool.v;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const f = this.list[i];
      f.age += dt;
      if (f.age > LIFETIME) {
        this.list.splice(i, 1);
        continue;
      }
      f.y += (settle - f.y) * Math.min(1, dt * 0.35);
      f.x += Math.sin(f.age * 1.7 + f.seed) * 0.03 * dt;
      this.keepInside(f, pool);
    }
  }

  private keepInside(f: Firefly, pool: Pool): void {
    f.y = clamp(f.y, -0.85 * pool.v, 0.85 * pool.v);
    const hw = halfWidthAt(pool, f.y);
    f.x = clamp(f.x, -hw, hw);
  }
}
```

**File: `src/core/particles.ts`**
```ts
export const SPARK = 0;
export const HEART = 1;

const CAPACITY = 160;

/** Short-lived glow particles in fixed typed arrays (no per-frame allocation). */
export class Particles {
  readonly x = new Float32Array(CAPACITY);
  readonly y = new Float32Array(CAPACITY);
  readonly vx = new Float32Array(CAPACITY);
  readonly vy = new Float32Array(CAPACITY);
  readonly life = new Float32Array(CAPACITY);
  readonly max = new Float32Array(CAPACITY);
  readonly kind = new Uint8Array(CAPACITY);
  count = 0;

  emit(kind: number, x: number, y: number, n: number, speed: number, rng: () => number): void {
    for (let i = 0; i < n && this.count < CAPACITY; i++) {
      const k = this.count++;
      const a = rng() * Math.PI * 2;
      const s = speed * (0.4 + 0.6 * rng());
      this.x[k] = x;
      this.y[k] = y;
      this.vx[k] = Math.cos(a) * s * (kind === HEART ? 0.4 : 1);
      this.vy[k] = kind === HEART ? speed * (0.4 + 0.3 * rng()) : Math.sin(a) * s;
      this.max[k] = this.life[k] = kind === HEART ? 1.4 : 0.7 + 0.4 * rng();
      this.kind[k] = kind;
    }
  }

  update(dt: number): void {
    for (let i = this.count - 1; i >= 0; i--) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.removeAt(i);
        continue;
      }
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      const drag = this.kind[i] === SPARK ? 2 : 3;
      this.vx[i] *= Math.max(0, 1 - dt * drag);
      if (this.kind[i] === SPARK) this.vy[i] *= Math.max(0, 1 - dt * drag);
    }
  }

  private removeAt(i: number): void {
    const last = --this.count;
    this.x[i] = this.x[last];
    this.y[i] = this.y[last];
    this.vx[i] = this.vx[last];
    this.vy[i] = this.vy[last];
    this.life[i] = this.life[last];
    this.max[i] = this.max[last];
    this.kind[i] = this.kind[last];
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/fireflies.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/fireflies.ts src/core/particles.ts tests/core/fireflies.test.ts
git commit -m "feat(core): add fireflies and glow particles"
```

---

### Task 5: Pinch, touch, wearing and voice limits

**Files:**
- Create: `src/core/interact.ts`, `src/core/puppet.ts`, `src/core/voices.ts`
- Test: `tests/core/interact.test.ts`

- [ ] **Step 1: Write the failing test**

**File: `tests/core/interact.test.ts`**
```ts
import { describe, expect, it } from 'vitest';
import { capsulesNear, PinchDetector } from '../../src/core/interact.js';
import { buildCreatureShapes } from '../../src/core/library.js';
import { openness, WEAR_ON, WornState } from '../../src/core/puppet.js';
import { VoiceLimiter } from '../../src/core/voices.js';

describe('PinchDetector', () => {
  it('starts below the on distance and ends above the off distance', () => {
    const p = new PinchDetector(0.02, 0.035);
    expect(p.update(0.05, true)).toBeNull();
    expect(p.update(0.015, true)).toBe('start');
    expect(p.update(0.03, true)).toBeNull();
    expect(p.update(0.04, true)).toBe('end');
  });

  it('ends a pinch when tracking is lost', () => {
    const p = new PinchDetector();
    p.update(0.01, true);
    expect(p.update(0.01, false)).toBe('end');
    expect(p.update(0.01, false)).toBeNull();
  });
});

describe('capsulesNear', () => {
  const caps = Float32Array.from([0, 0, 0.02, 0.2, 0, 0.02]);
  it('detects points near a capsule, including an extra radius', () => {
    expect(capsulesNear(caps, 0, 1, 0.1, 0.03, 0)).toBe(false);
    expect(capsulesNear(caps, 0, 1, 0.1, 0.03, 0.02)).toBe(true);
    expect(capsulesNear(caps, 0, 1, 0.5, 0, 0.1)).toBe(false);
  });
});

describe('puppet', () => {
  const shapes = buildCreatureShapes();

  it('openness is 1 in the base pose and 0 in the act pose', () => {
    for (const shape of shapes.values()) {
      expect(openness(shape.joints, shape.actuator)).toBeCloseTo(1, 5);
      expect(openness(shape.actJoints, shape.actuator)).toBeCloseTo(0, 5);
    }
  });

  it('wears a creature after a short hold and lets go after it is lost', () => {
    const w = new WornState();
    const tick = 1 / 6;
    w.updateMatch(tick, 'dog', WEAR_ON + 0.1);
    w.updateMatch(tick, 'dog', WEAR_ON + 0.1);
    expect(w.species).toBeNull();
    w.updateMatch(tick, 'dog', WEAR_ON + 0.1);
    expect(w.species).toBe('dog');
    for (let i = 0; i < 3; i++) w.updateMatch(tick, null, 0);
    expect(w.species).toBe('dog');
    w.updateMatch(tick, null, 0);
    expect(w.species).toBeNull();
  });

  it('voices once per snap shut, with a cooldown', () => {
    const w = new WornState();
    let voices = 0;
    const hold = (open: number) => {
      for (let i = 0; i < 30; i++) if (w.updateAction(1 / 60, open)) voices++;
    };
    hold(1);
    hold(0);
    expect(voices).toBe(1);
    hold(1);
    hold(0);
    expect(voices).toBe(2);
  });
});

describe('VoiceLimiter', () => {
  it('limits rapid repeats and polyphony', () => {
    const v = new VoiceLimiter(0.08, 2);
    expect(v.allow('a', 0, 1)).toBe(true);
    expect(v.allow('a', 0.05, 1)).toBe(false);
    expect(v.allow('b', 0.05, 1)).toBe(true);
    expect(v.allow('c', 0.1, 1)).toBe(false);
    expect(v.allow('c', 1.2, 1)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/interact.test.ts`
Expected: FAIL. The error says it can't resolve `../../src/core/interact.js`.

- [ ] **Step 3: Implement**

**File: `src/core/interact.ts`**
```ts
import { CAPSULE_STRIDE } from './projector.js';

/** Thumb–index pinch with hysteresis so it doesn't flicker at the threshold. */
export class PinchDetector {
  pinched = false;

  constructor(
    private readonly on = 0.022,
    private readonly off = 0.035,
  ) {}

  update(distance: number, tracked: boolean): 'start' | 'end' | null {
    if (!tracked) {
      if (this.pinched) {
        this.pinched = false;
        return 'end';
      }
      return null;
    }
    if (!this.pinched && distance < this.on) {
      this.pinched = true;
      return 'start';
    }
    if (this.pinched && distance > this.off) {
      this.pinched = false;
      return 'end';
    }
    return null;
  }
}

/** True when (x, y) lies within `radius` of the edge of any capsule (or inside one). */
export function capsulesNear(caps: Float32Array, start: number, count: number, x: number, y: number, radius: number): boolean {
  for (let i = 0; i < count; i++) {
    const o = (start + i) * CAPSULE_STRIDE;
    const ax = caps[o];
    const ay = caps[o + 1];
    const ex = caps[o + 3] - ax;
    const ey = caps[o + 4] - ay;
    const ee = ex * ex + ey * ey;
    let h = ee > 1e-12 ? ((x - ax) * ex + (y - ay) * ey) / ee : 0;
    h = h < 0 ? 0 : h > 1 ? 1 : h;
    const dx = x - ax - ex * h;
    const dy = y - ay - ey * h;
    const r = caps[o + 2] + (caps[o + 5] - caps[o + 2]) * h + radius;
    if (dx * dx + dy * dy <= r * r) return true;
  }
  return false;
}
```

**File: `src/core/puppet.ts`**
```ts
import type { CreatureId } from './library.js';
import { jointDistance, type JointSet } from './poses.js';

/** Match score needed to start wearing a creature, and the score that keeps it on. */
export const WEAR_ON = 0.66;
export const WEAR_OFF = 0.5;
const WEAR_HOLD = 0.3;
const WEAR_LOSE = 0.6;

export interface Actuator {
  readonly a: number;
  readonly b: number;
  readonly open: number;
  readonly closed: number;
}

/** 1 when the actuator joints are as far apart as in the base pose, 0 when as close as in the act pose. */
export function openness(js: JointSet, act: Actuator): number {
  const span = act.open - act.closed;
  if (Math.abs(span) < 1e-6) return 1;
  const v = (jointDistance(js, act.a, act.b) - act.closed) / span;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Wear state for one hand: which creature it is wearing, and voice triggers from its action. */
export class WornState {
  species: CreatureId | null = null;
  private candidate: CreatureId | null = null;
  private hold = 0;
  private lose = 0;
  private open = 1;
  private armed = true;
  private cooldown = 0;

  /** Call at the scoring rate with the best-matching unlocked creature and its score. */
  updateMatch(dt: number, best: CreatureId | null, score: number): void {
    if (this.species) {
      if (best === this.species && score >= WEAR_OFF) this.lose = 0;
      else {
        this.lose += dt;
        if (this.lose >= WEAR_LOSE) this.clear();
      }
      return;
    }
    if (best && score >= WEAR_ON) {
      if (best === this.candidate) {
        this.hold += dt;
        if (this.hold >= WEAR_HOLD) {
          this.species = best;
          this.lose = 0;
          this.open = 1;
          this.armed = true;
        }
      } else {
        this.candidate = best;
        this.hold = 0;
      }
    } else {
      this.candidate = null;
      this.hold = 0;
    }
  }

  /** Call every frame with the actuator openness; true when the action snaps shut (a voice). */
  updateAction(dt: number, open: number): boolean {
    this.cooldown -= dt;
    this.open += (open - this.open) * Math.min(1, dt * 18);
    if (this.open >= 0.6) this.armed = true;
    if (this.armed && this.open <= 0.4 && this.cooldown <= 0) {
      this.armed = false;
      this.cooldown = 0.2;
      return true;
    }
    return false;
  }

  clear(): void {
    this.species = null;
    this.candidate = null;
    this.hold = 0;
    this.lose = 0;
  }
}
```

**File: `src/core/voices.ts`**
```ts
/** Keeps sound playback pleasant: no rapid repeats of one sound and a cap on overlapping voices. */
export class VoiceLimiter {
  private readonly last = new Map<string, number>();
  private readonly ends: number[] = [];

  constructor(
    private readonly minGap = 0.08,
    private readonly maxVoices = 8,
  ) {}

  allow(name: string, now: number, duration: number): boolean {
    for (let i = this.ends.length - 1; i >= 0; i--) if (this.ends[i] <= now) this.ends.splice(i, 1);
    if (this.ends.length >= this.maxVoices) return false;
    const previous = this.last.get(name);
    if (previous !== undefined && now - previous < this.minGap) return false;
    this.last.set(name, now);
    this.ends.push(now + duration);
    return true;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/interact.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/interact.ts src/core/puppet.ts src/core/voices.ts tests/core/interact.test.ts
git commit -m "feat(core): add pinch, touch, wear-state and voice-limiter primitives"
```

---

### Task 6: Game modules — hands, visitors, puppeteer, zoo

**Files:**
- Create: `src/game/events.ts`, `src/game/hands.ts`, `src/game/Visitors.ts`, `src/game/Puppeteer.ts`, `src/game/Zoo.ts`
- Test: `tests/game/game.test.ts`

- [ ] **Step 1: Write the failing test**

**File: `tests/game/game.test.ts`**
```ts
import { describe, expect, it } from 'vitest';
import { J } from '../../src/core/joints.js';
import { buildCreatureShapes } from '../../src/core/library.js';
import { buildJointSet, builtinAngles, copyJointSet, orientJointSet } from '../../src/core/poses.js';
import { ShadowProjector, type StagePlane } from '../../src/core/projector.js';
import { mulberry32 } from '../../src/core/rng.js';
import { Silhouettes } from '../../src/core/silhouette.js';
import type { GameEvent } from '../../src/game/events.js';
import { createHandShadow, updateHandShadow, type HandShadow } from '../../src/game/hands.js';
import type { Worn } from '../../src/game/Puppeteer.js';
import { Visitors } from '../../src/game/Visitors.js';
import { Zoo } from '../../src/game/Zoo.js';

const sil = new Silhouettes();
const shapes = buildCreatureShapes(sil);
const pool = { u: 0.8, v: 0.6 };
const stage: StagePlane = { origin: [0, 0, -1], u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] };

const shaped = (id: 'rabbit' | 'dog'): HandShadow => {
  const hand = createHandShadow('right');
  const shape = shapes.get(id)!;
  hand.caps.set(shape.caps);
  hand.count = shape.count;
  hand.drawCount = shape.count;
  hand.tracked = true;
  return hand;
};
const pinchAt = (x: number, y: number): HandShadow => {
  const hand = createHandShadow('right');
  hand.tracked = true;
  hand.tipX = x;
  hand.tipY = y;
  hand.pinch = 'start';
  return hand;
};
const freshZoo = (species: 'rabbit' | 'dog' = 'rabbit', x = 0) => {
  const zoo = new Zoo(shapes, mulberry32(11));
  const events: GameEvent[] = [];
  const creature = zoo.add({ species, x, y: 0, size: 0.3, scale: 1 }, events);
  return { zoo, events, creature };
};
const step = (zoo: Zoo, seconds: number, hands: HandShadow[], events: GameEvent[], worn: Worn | null = null) => {
  for (let t = 0; t < seconds; t += 1 / 60) zoo.update(1 / 60, pool, hands, worn, events);
};

describe('updateHandShadow', () => {
  it('projects a tracked hand, finds its fingertip shadow and detects a pinch', () => {
    const projector = new ShadowProjector();
    projector.setup([0, 0, 1], stage);
    const joints = orientJointSet(buildJointSet(builtinAngles.flat), 'left', { fingers: [0, 1, 0], palm: [0, 0, 1] }, [0, 0, 0]);
    const hand = createHandShadow('left');
    updateHandShadow(hand, joints, projector, 1 / 60);
    expect(hand.tracked).toBe(true);
    expect(hand.count).toBeGreaterThan(20);
    expect(hand.drawCount).toBe(hand.count + 1);
    expect(hand.tipY).toBeGreaterThan(hand.palmY);
    expect(hand.pinch).toBeNull();
    const pinched = copyJointSet(joints);
    pinched.pos.set(joints.pos.subarray(J.indexTip * 3, J.indexTip * 3 + 3), J.thumbTip * 3);
    updateHandShadow(hand, pinched, projector, 1 / 60);
    expect(hand.pinch).toBe('start');
    updateHandShadow(hand, null, projector, 1 / 60);
    expect(hand.tracked).toBe(false);
    expect(hand.pinch).toBe('end');
  });
});

describe('Visitors', () => {
  it('reveals the visitor once the hand shadow matches it, then brings the next', () => {
    const visitors = new Visitors(shapes, sil, ['rabbit', 'dog'], 0.5);
    const hands = [shaped('rabbit')];
    let revealed = null;
    for (let t = 0; t < 5 && !revealed; t += 1 / 60) revealed = visitors.update(1 / 60, hands);
    expect(revealed?.species).toBe('rabbit');
    expect(revealed!.scale).toBeCloseTo(1, 1);
    for (let t = 0; t < 3; t += 1 / 60) visitors.update(1 / 60, hands);
    expect(visitors.current?.def.id).toBe('dog');
  });

  it('never reveals without a tracked hand', () => {
    const visitors = new Visitors(shapes, sil, ['rabbit'], 0);
    const hand = shaped('rabbit');
    hand.tracked = false;
    for (let t = 0; t < 5; t += 1 / 60) expect(visitors.update(1 / 60, [hand])).toBeNull();
  });
});

describe('Zoo', () => {
  it('reveals a creature with an event and unlocks its species', () => {
    const { zoo, events } = freshZoo();
    expect(events[0]).toMatchObject({ type: 'reveal', species: 'rabbit' });
    expect(zoo.unlocked.has('rabbit')).toBe(true);
  });

  it('a pinch releases a firefly that a creature chases and eats', () => {
    const { zoo, events, creature } = freshZoo();
    step(zoo, 1.5, [], events);
    const hand = pinchAt(0.3, 0.1);
    zoo.update(1 / 60, pool, [hand], null, events);
    expect(events.some((e) => e.type === 'firefly')).toBe(true);
    hand.pinch = null;
    step(zoo, 8, [hand], events);
    expect(events.some((e) => e.type === 'eat')).toBe(true);
    expect(creature.bond).toBeGreaterThanOrEqual(1);
    expect(zoo.fireflies.list).toHaveLength(0);
  });

  it('resting your hand shadow on a creature pets it', () => {
    const { zoo, events, creature } = freshZoo('dog');
    step(zoo, 1.5, [], events);
    const hand = createHandShadow('left');
    hand.tracked = true;
    hand.count = 1;
    for (let t = 0; t < 1.3; t += 1 / 60) {
      const y = creature.y + creature.lift;
      hand.caps.set([creature.x - 0.02, y, 0.03, creature.x + 0.02, y, 0.03]);
      zoo.update(1 / 60, pool, [hand], null, events);
    }
    expect(events.some((e) => e.type === 'pet')).toBe(true);
    expect(creature.bond).toBe(1);
  });

  it('wearing the dog and barking makes rabbits flee', () => {
    const { zoo, events, creature } = freshZoo('rabbit', 0.1);
    step(zoo, 1.5, [], events);
    const worn: Worn = { species: 'dog', side: 'right', eyeX: 0, eyeY: 0, tipX: 0, tipY: 0, voice: true };
    zoo.update(1 / 60, pool, [], worn, events);
    expect(creature.mode).toBe('flee');
    expect(events.some((e) => e.type === 'voice' && e.species === 'dog')).toBe(true);
    expect(events.some((e) => e.type === 'flee' && e.species === 'rabbit')).toBe(true);
  });

  it('a worn crocodile can snap up a nearby firefly', () => {
    const { zoo, events } = freshZoo('dog', -0.5);
    step(zoo, 1.5, [], events);
    zoo.update(1 / 60, pool, [pinchAt(0.3, 0.2)], null, events);
    const f = zoo.fireflies.list[0];
    const worn: Worn = { species: 'crocodile', side: 'left', eyeX: f.x, eyeY: f.y, tipX: f.x, tipY: f.y, voice: true };
    zoo.update(1 / 60, pool, [], worn, events);
    expect(zoo.fireflies.list).toHaveLength(0);
    expect(events.filter((e) => e.type === 'eat' && e.species === 'crocodile')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/game/game.test.ts`
Expected: FAIL. The error says it can't resolve `../../src/game/events.js` (or `hands.js`).

- [ ] **Step 3: Implement**

**File: `src/game/events.ts`**
```ts
import type { CreatureId } from '../core/library.js';

/** Things that happened this frame; positions are stage coordinates (meters). */
export type GameEvent =
  | { readonly type: 'reveal'; readonly species: CreatureId; readonly x: number; readonly y: number }
  | { readonly type: 'voice'; readonly species: CreatureId; readonly x: number; readonly y: number }
  | { readonly type: 'eat'; readonly species: CreatureId; readonly x: number; readonly y: number }
  | { readonly type: 'pet'; readonly species: CreatureId; readonly x: number; readonly y: number }
  | { readonly type: 'flee'; readonly species: CreatureId; readonly x: number; readonly y: number }
  | { readonly type: 'firefly'; readonly x: number; readonly y: number };

/** A visitor that matched: where its shadow was and how big. */
export interface Revealed {
  readonly species: CreatureId;
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly scale: number;
}
```

**File: `src/game/hands.ts`**
```ts
import { BONES, J } from '../core/joints.js';
import { PinchDetector } from '../core/interact.js';
import { jointDistance, type Handedness, type JointSet } from '../core/poses.js';
import { CAPSULE_STRIDE, type ShadowProjector } from '../core/projector.js';

/** One hand's shadow on the stage this frame. */
export interface HandShadow {
  readonly side: Handedness;
  tracked: boolean;
  /** Bone capsules followed by the forearm capsule. */
  readonly caps: Float32Array;
  /** Bone capsules only (matching and touch). */
  count: number;
  /** Bones plus forearm (drawing). */
  drawCount: number;
  tipX: number;
  tipY: number;
  palmX: number;
  palmY: number;
  /** Palm shadow speed on the stage (m/s). */
  speed: number;
  pinch: 'start' | 'end' | null;
  joints: JointSet | null;
  readonly detector: PinchDetector;
}

export const createHandShadow = (side: Handedness): HandShadow => ({
  side,
  tracked: false,
  caps: new Float32Array((BONES.length + 1) * CAPSULE_STRIDE),
  count: 0,
  drawCount: 0,
  tipX: 0,
  tipY: 0,
  palmX: 0,
  palmY: 0,
  speed: 0,
  pinch: null,
  joints: null,
  detector: new PinchDetector(),
});

/** Projects a tracked hand (or clears it when `joints` is null) and updates its stage features. */
export function updateHandShadow(hand: HandShadow, joints: JointSet | null, projector: ShadowProjector, dt: number): void {
  const wasTracked = hand.tracked;
  const prevX = hand.palmX;
  const prevY = hand.palmY;
  hand.count = joints ? projector.projectBones(joints, hand.caps, 0) : 0;
  hand.tracked = hand.count > 0;
  hand.joints = hand.tracked ? joints : null;
  if (!hand.tracked || !joints) {
    hand.drawCount = 0;
    hand.speed = 0;
    hand.pinch = hand.detector.update(1, false);
    return;
  }
  hand.drawCount = hand.count + projector.projectForearm(joints, hand.caps, hand.count);
  const p = joints.pos;
  const t = J.indexTip * 3;
  const m = J.middleProx * 3;
  if (projector.project(p[t], p[t + 1], p[t + 2])) {
    hand.tipX = projector.x;
    hand.tipY = projector.y;
  }
  if (projector.project(p[m], p[m + 1], p[m + 2])) {
    hand.palmX = projector.x;
    hand.palmY = projector.y;
  }
  hand.speed = wasTracked && dt > 0 ? Math.hypot(hand.palmX - prevX, hand.palmY - prevY) / dt : 0;
  hand.pinch = hand.detector.update(jointDistance(joints, J.thumbTip, J.indexTip), true);
}
```

**File: `src/game/Visitors.ts`**
```ts
import { CREATURES, type CreatureId, type CreatureShape } from '../core/library.js';
import { Matcher, TUNING, type MatchTuning } from '../core/matcher.js';
import { createFrame, matchScore, type Silhouettes } from '../core/silhouette.js';
import type { Revealed } from './events.js';
import type { HandShadow } from './hands.js';

const MATCH_INTERVAL = 1 / 15;
const NEXT_VISITOR_DELAY = 2.5;

/** Creature outlines waiting to be matched, one at a time. */
export class Visitors {
  current: CreatureShape | null = null;
  readonly matcher: Matcher;
  private readonly queue: CreatureId[];
  private readonly frame = createFrame();
  private readonly best = createFrame();
  private wait: number;
  private pending = 0;

  constructor(
    private readonly shapes: ReadonlyMap<CreatureId, CreatureShape>,
    private readonly sil: Silhouettes,
    order: readonly CreatureId[] = CREATURES.map((c) => c.id),
    firstDelay = 1.2,
    tuning: MatchTuning = TUNING.normal,
  ) {
    this.queue = [...order];
    this.wait = firstDelay;
    this.matcher = new Matcher(tuning);
  }

  enqueue(id: CreatureId): void {
    this.queue.push(id);
  }

  update(dt: number, hands: readonly HandShadow[]): Revealed | null {
    if (!this.current) {
      if (this.queue.length === 0) return null;
      this.wait -= dt;
      if (this.wait > 0) return null;
      this.current = this.shapes.get(this.queue.shift()!) ?? null;
      this.matcher.reset();
      this.pending = 0;
      return null;
    }
    this.pending += dt;
    if (this.pending < MATCH_INTERVAL) return null;
    const tick = this.pending;
    this.pending = 0;
    let bestScore: number | null = null;
    for (const hand of hands) {
      if (!hand.tracked || hand.count === 0) continue;
      const score = matchScore(this.sil, hand.caps, 0, hand.count, this.current.target, this.frame);
      if (bestScore === null || score > bestScore) {
        bestScore = score;
        this.best.cx = this.frame.cx;
        this.best.cy = this.frame.cy;
        this.best.size = this.frame.size;
      }
    }
    if (this.matcher.update(tick, bestScore) !== 'matched') return null;
    const shape = this.current;
    this.current = null;
    this.wait = NEXT_VISITOR_DELAY;
    return {
      species: shape.def.id,
      x: this.best.cx,
      y: this.best.cy,
      size: this.best.size,
      scale: this.best.size / shape.target.frame.size,
    };
  }
}
```

**File: `src/game/Puppeteer.ts`**
```ts
import type { CreatureId, CreatureShape } from '../core/library.js';
import type { Handedness } from '../core/poses.js';
import type { ShadowProjector } from '../core/projector.js';
import { openness, WornState } from '../core/puppet.js';
import { createFrame, matchScore, type Silhouettes } from '../core/silhouette.js';
import type { HandShadow } from './hands.js';

const SCORE_INTERVAL = 1 / 6;

/** The creature a hand is wearing this frame, with its eye and fingertip on the stage. */
export interface Worn {
  species: CreatureId;
  side: Handedness;
  eyeX: number;
  eyeY: number;
  tipX: number;
  tipY: number;
  /** True on the frame the creature's action snaps shut. */
  voice: boolean;
}

/** Detects when a hand's shadow becomes an unlocked creature, then turns its finger motion into a voice. */
export class Puppeteer {
  private readonly states: Record<Handedness, WornState> = { left: new WornState(), right: new WornState() };
  private readonly sizes: Record<Handedness, number> = { left: 0, right: 0 };
  private readonly frame = createFrame();
  private readonly worn: Worn = { species: 'rabbit', side: 'right', eyeX: 0, eyeY: 0, tipX: 0, tipY: 0, voice: false };
  private pending = 0;

  constructor(
    private readonly shapes: ReadonlyMap<CreatureId, CreatureShape>,
    private readonly sil: Silhouettes,
  ) {}

  update(dt: number, hands: readonly HandShadow[], unlocked: ReadonlySet<CreatureId>, exclude: CreatureId | null, projector: ShadowProjector): Worn | null {
    this.pending += dt;
    const tick = this.pending >= SCORE_INTERVAL ? this.pending : 0;
    if (tick > 0) this.pending = 0;
    let result: Worn | null = null;
    for (const hand of hands) {
      const state = this.states[hand.side];
      if (!hand.tracked || !hand.joints) {
        state.clear();
        continue;
      }
      if (tick > 0) {
        let best: CreatureId | null = null;
        let bestScore = 0;
        for (const id of unlocked) {
          if (id === exclude) continue;
          const shape = this.shapes.get(id);
          if (!shape) continue;
          const score = matchScore(this.sil, hand.caps, 0, hand.count, shape.target, this.frame);
          if (score > bestScore) {
            bestScore = score;
            best = id;
            this.sizes[hand.side] = this.frame.size;
          }
        }
        state.updateMatch(tick, best, bestScore);
      }
      if (!state.species || result) continue;
      const shape = this.shapes.get(state.species)!;
      const voice = state.updateAction(dt, openness(hand.joints, shape.actuator));
      const e = shape.def.eye.joint * 3;
      const p = hand.joints.pos;
      if (!projector.project(p[e], p[e + 1], p[e + 2])) continue;
      const w = this.worn;
      w.species = state.species;
      w.side = hand.side;
      w.voice = voice;
      w.eyeX = projector.x + shape.def.eye.dx * this.sizes[hand.side];
      w.eyeY = projector.y + shape.def.eye.dy * this.sizes[hand.side];
      w.tipX = hand.tipX;
      w.tipY = hand.tipY;
      result = w;
    }
    return result;
  }
}
```

**File: `src/game/Zoo.ts`**
```ts
import { Creature, type CreatureEvent, type Pool } from '../core/creature.js';
import { Fireflies } from '../core/fireflies.js';
import { capsulesNear } from '../core/interact.js';
import type { CreatureId, CreatureShape } from '../core/library.js';
import { HEART, Particles, SPARK } from '../core/particles.js';
import type { GameEvent, Revealed } from './events.js';
import type { HandShadow } from './hands.js';
import type { Worn } from './Puppeteer.js';

const PET_SECONDS = 1;
const PET_COOLDOWN = 2;
const PET_MAX_SPEED = 0.9;
const MAX_BOND = 5;
/** Creatures that scatter when the player's dog barks. */
const PREY: ReadonlySet<CreatureId> = new Set<CreatureId>(['rabbit', 'peacock', 'turtle']);

/** The living zoo: creatures, fireflies, particles and every hand interaction. Pure game logic. */
export class Zoo {
  readonly creatures: Creature[] = [];
  readonly fireflies = new Fireflies();
  readonly particles = new Particles();
  private readonly unlockedSet = new Set<CreatureId>();
  private readonly petTimers = new Map<number, number>();
  private readonly creatureEvents: CreatureEvent[] = [];
  private nextId = 1;

  constructor(
    private readonly shapes: ReadonlyMap<CreatureId, CreatureShape>,
    private readonly rng: () => number,
  ) {}

  get unlocked(): ReadonlySet<CreatureId> {
    return this.unlockedSet;
  }

  add(revealed: Revealed, events: GameEvent[]): Creature {
    const def = this.shapes.get(revealed.species)!.def;
    const creature = new Creature(this.nextId++, revealed.species, def.motion, revealed.x, revealed.y, revealed.scale, revealed.size, this.rng);
    this.creatures.push(creature);
    this.unlockedSet.add(revealed.species);
    this.particles.emit(SPARK, revealed.x, revealed.y, 16, revealed.size * 0.9, this.rng);
    events.push({ type: 'reveal', species: revealed.species, x: revealed.x, y: revealed.y });
    return creature;
  }

  update(dt: number, pool: Pool, hands: readonly HandShadow[], worn: Worn | null, events: GameEvent[]): void {
    this.feed(hands, worn, pool, events);
    if (worn?.voice) this.onVoice(worn, pool, events);
    this.assignFireflies();
    this.creatureEvents.length = 0;
    for (const creature of this.creatures) {
      if (creature.mode === 'chase') this.followFirefly(creature);
      this.updatePet(creature, dt, hands, events);
      creature.update(dt, pool, this.creatureEvents);
    }
    for (const event of this.creatureEvents) {
      const c = event.creature;
      c.bond = Math.min(MAX_BOND, c.bond + 1);
      this.particles.emit(HEART, c.x, c.y + c.size * 0.4, 2, c.size * 0.5, this.rng);
      events.push({ type: 'eat', species: c.species, x: c.x, y: c.y });
    }
    this.fireflies.update(dt, pool);
    this.particles.update(dt);
  }

  private feed(hands: readonly HandShadow[], worn: Worn | null, pool: Pool, events: GameEvent[]): void {
    for (const hand of hands) {
      if (hand.pinch !== 'start' || (worn && worn.side === hand.side)) continue;
      const firefly = this.fireflies.spawn(hand.tipX, hand.tipY, pool, this.rng);
      if (!firefly) continue;
      this.particles.emit(SPARK, firefly.x, firefly.y, 5, 0.12, this.rng);
      events.push({ type: 'firefly', x: firefly.x, y: firefly.y });
    }
  }

  private assignFireflies(): void {
    for (const firefly of this.fireflies.list) {
      if (firefly.claimed) continue;
      let best: Creature | null = null;
      let bestDist = Infinity;
      for (const c of this.creatures) {
        if (c.busy) continue;
        const d = Math.abs(c.x - firefly.x) + Math.abs(c.y - firefly.y) * 0.5;
        if (d < bestDist) {
          bestDist = d;
          best = c;
        }
      }
      if (!best) return;
      firefly.claimed = true;
      best.chase(firefly.id, firefly.x, firefly.y);
    }
  }

  private followFirefly(c: Creature): void {
    const firefly = this.fireflies.get(c.fireflyId);
    if (!firefly) {
      c.calm();
      return;
    }
    c.updateChaseTarget(firefly.x, firefly.y);
    if (c.reached()) {
      this.fireflies.remove(firefly.id);
      c.startEat();
    }
  }

  private updatePet(c: Creature, dt: number, hands: readonly HandShadow[], events: GameEvent[]): void {
    let t = this.petTimers.get(c.id) ?? 0;
    if (t < 0) {
      this.petTimers.set(c.id, Math.min(0, t + dt));
      return;
    }
    let touching = false;
    if (c.mode === 'rest' || c.mode === 'wander') {
      const cy = c.y + c.lift;
      const radius = c.size * 0.45;
      for (const hand of hands) {
        if (hand.tracked && hand.speed < PET_MAX_SPEED && capsulesNear(hand.caps, 0, hand.count, c.x, cy, radius)) {
          touching = true;
          break;
        }
      }
    }
    t = touching ? t + dt : 0;
    if (t >= PET_SECONDS) {
      c.pet();
      c.bond = Math.min(MAX_BOND, c.bond + 1);
      this.particles.emit(HEART, c.x, c.y + c.size * 0.45, 3, c.size * 0.5, this.rng);
      events.push({ type: 'pet', species: c.species, x: c.x, y: c.y });
      t = -PET_COOLDOWN;
    }
    this.petTimers.set(c.id, t);
  }

  private onVoice(worn: Worn, pool: Pool, events: GameEvent[]): void {
    events.push({ type: 'voice', species: worn.species, x: worn.eyeX, y: worn.eyeY });
    this.particles.emit(SPARK, worn.eyeX, worn.eyeY, 4, 0.1, this.rng);
    for (const c of this.creatures) {
      if (worn.species === 'dog' && PREY.has(c.species) && Math.abs(c.x - worn.tipX) < pool.u) {
        c.flee(worn.tipX);
        events.push({ type: 'flee', species: c.species, x: c.x, y: c.y });
      } else if (c.species === worn.species) {
        c.pet();
      }
    }
    if (worn.species === 'crocodile') {
      const firefly = this.fireflies.nearest(worn.tipX, worn.tipY, 0.2);
      if (firefly) {
        this.fireflies.remove(firefly.id);
        this.particles.emit(SPARK, firefly.x, firefly.y, 8, 0.15, this.rng);
        events.push({ type: 'eat', species: 'crocodile', x: firefly.x, y: firefly.y });
      }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/game/game.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/game tests/game
git commit -m "feat(game): add hand shadows, visitor queue, puppeteer and the living zoo"
```

---

### Task 7: Synthesized, spatial audio

**Files:**
- Create: `src/audio/recipes.ts`, `src/audio/AudioEngine.ts`, `src/systems/AudioSystem.ts`

Browser-only code, verified by typecheck here and by the emulator in Task 9. The `VoiceLimiter` logic is already unit-tested.

- [ ] **Step 1: Write the code**

**File: `src/audio/recipes.ts`**
```ts
import type { CreatureId } from '../core/library.js';

export type SoundName = 'reveal' | 'firefly' | 'eat' | 'pet' | 'flee' | `voice-${CreatureId}`;

interface ToneSpec {
  readonly type: OscillatorType;
  readonly f0: number;
  readonly f1: number;
  readonly dur: number;
  readonly gain: number;
  readonly delay?: number;
  readonly attack?: number;
}

interface NoiseSpec {
  readonly dur: number;
  readonly gain: number;
  readonly filter: BiquadFilterType;
  readonly freq: number;
  readonly q?: number;
  readonly delay?: number;
}

function tone(ctx: AudioContext, out: AudioNode, t0: number, s: ToneSpec): void {
  const t = t0 + (s.delay ?? 0);
  const osc = ctx.createOscillator();
  osc.type = s.type;
  osc.frequency.setValueAtTime(s.f0, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, s.f1), t + s.dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(s.gain, t + (s.attack ?? 0.01));
  g.gain.exponentialRampToValueAtTime(0.0001, t + s.dur);
  osc.connect(g).connect(out);
  osc.start(t);
  osc.stop(t + s.dur + 0.02);
}

function noise(ctx: AudioContext, out: AudioNode, t0: number, buffer: AudioBuffer, s: NoiseSpec): void {
  const t = t0 + (s.delay ?? 0);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = s.filter;
  filter.frequency.value = s.freq;
  filter.Q.value = s.q ?? 1;
  const g = ctx.createGain();
  g.gain.setValueAtTime(s.gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + s.dur);
  src.connect(filter).connect(g).connect(out);
  src.start(t, Math.random() * 1.5);
  src.stop(t + s.dur + 0.02);
}

/** Schedules one synthesized sound into `out` at time `t`. */
export function playRecipe(name: SoundName, ctx: AudioContext, out: AudioNode, t: number, buffer: AudioBuffer): void {
  switch (name) {
    case 'reveal':
      tone(ctx, out, t, { type: 'sine', f0: 660, f1: 660, dur: 0.7, gain: 0.22 });
      tone(ctx, out, t, { type: 'sine', f0: 990, f1: 990, dur: 0.6, gain: 0.16, delay: 0.07 });
      tone(ctx, out, t, { type: 'sine', f0: 1320, f1: 1320, dur: 0.55, gain: 0.12, delay: 0.14 });
      noise(ctx, out, t, buffer, { dur: 0.4, gain: 0.05, filter: 'highpass', freq: 6000 });
      break;
    case 'firefly':
      tone(ctx, out, t, { type: 'sine', f0: 1800, f1: 2400, dur: 0.15, gain: 0.1 });
      tone(ctx, out, t, { type: 'sine', f0: 2600, f1: 3000, dur: 0.12, gain: 0.07, delay: 0.05 });
      break;
    case 'eat':
      for (let k = 0; k < 3; k++) noise(ctx, out, t, buffer, { dur: 0.05, gain: 0.25, filter: 'lowpass', freq: 900, delay: k * 0.09 });
      break;
    case 'pet':
      tone(ctx, out, t, { type: 'triangle', f0: 330, f1: 392, dur: 0.28, gain: 0.14, attack: 0.04 });
      tone(ctx, out, t, { type: 'triangle', f0: 392, f1: 494, dur: 0.3, gain: 0.1, delay: 0.12, attack: 0.04 });
      break;
    case 'flee':
      tone(ctx, out, t, { type: 'sine', f0: 900, f1: 500, dur: 0.18, gain: 0.08 });
      break;
    case 'voice-rabbit':
      tone(ctx, out, t, { type: 'sine', f0: 900, f1: 1500, dur: 0.09, gain: 0.18 });
      tone(ctx, out, t, { type: 'sine', f0: 950, f1: 1600, dur: 0.09, gain: 0.15, delay: 0.12 });
      break;
    case 'voice-dog':
      tone(ctx, out, t, { type: 'square', f0: 260, f1: 170, dur: 0.13, gain: 0.12, attack: 0.005 });
      noise(ctx, out, t, buffer, { dur: 0.07, gain: 0.18, filter: 'bandpass', freq: 520, q: 2 });
      break;
    case 'voice-crocodile':
      tone(ctx, out, t, { type: 'sine', f0: 140, f1: 60, dur: 0.14, gain: 0.32, attack: 0.003 });
      noise(ctx, out, t, buffer, { dur: 0.025, gain: 0.2, filter: 'highpass', freq: 2500 });
      break;
    case 'voice-peacock':
      tone(ctx, out, t, { type: 'sawtooth', f0: 700, f1: 1100, dur: 0.12, gain: 0.07 });
      tone(ctx, out, t, { type: 'sawtooth', f0: 1100, f1: 600, dur: 0.16, gain: 0.06, delay: 0.12 });
      break;
    case 'voice-spider':
      for (let k = 0; k < 4; k++) noise(ctx, out, t, buffer, { dur: 0.015, gain: 0.14, filter: 'highpass', freq: 3000, delay: k * 0.035 });
      break;
    case 'voice-turtle':
      tone(ctx, out, t, { type: 'triangle', f0: 520, f1: 600, dur: 0.1, gain: 0.16 });
      break;
  }
}
```

**File: `src/audio/AudioEngine.ts`**
```ts
import type { Vec3 } from '../core/vec.js';
import { VoiceLimiter } from '../core/voices.js';
import { playRecipe, type SoundName } from './recipes.js';

/** Owns the AudioContext: unlock, master volume, spatial one-shots and the night ambience. */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buffer: AudioBuffer | null = null;
  private ambient: { stop(): void } | null = null;
  private readonly limiter = new VoiceLimiter();
  private volume = 0.8;
  private muted = false;

  get ready(): boolean {
    return this.ctx?.state === 'running';
  }

  /** Creates or resumes the context. Call from a user gesture or XR session start. */
  unlock(): void {
    if (!this.ctx) {
      const Ctor = globalThis.AudioContext;
      if (!Ctor) return;
      const ctx = new Ctor();
      const master = ctx.createGain();
      master.gain.value = this.muted ? 0 : this.volume;
      master.connect(ctx.destination);
      const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      this.ctx = ctx;
      this.master = master;
      this.buffer = buffer;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : this.volume;
  }

  setListener(px: number, py: number, pz: number, fx: number, fy: number, fz: number): void {
    const listener = this.ctx?.listener;
    if (!listener) return;
    listener.positionX.value = px;
    listener.positionY.value = py;
    listener.positionZ.value = pz;
    listener.forwardX.value = fx;
    listener.forwardY.value = fy;
    listener.forwardZ.value = fz;
    listener.upX.value = 0;
    listener.upY.value = 1;
    listener.upZ.value = 0;
  }

  play(name: SoundName, at: Vec3): void {
    const ctx = this.ctx;
    if (!ctx || !this.buffer || this.muted || ctx.state !== 'running') return;
    if (!this.limiter.allow(name, ctx.currentTime, 0.6)) return;
    const panner = this.panner(at);
    playRecipe(name, ctx, panner, ctx.currentTime + 0.005, this.buffer);
    setTimeout(() => panner.disconnect(), 1500);
  }

  /** Crickets from the stage and a low room tone. */
  startAmbient(at: Vec3): void {
    const ctx = this.ctx;
    if (!ctx || !this.buffer || !this.master || this.ambient) return;
    const panner = this.panner(at);
    const crickets = ctx.createBufferSource();
    crickets.buffer = this.buffer;
    crickets.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 4400;
    band.Q.value = 9;
    const gate = ctx.createGain();
    gate.gain.value = 0.5;
    const chirp = ctx.createOscillator();
    chirp.type = 'square';
    chirp.frequency.value = 19;
    const chirpDepth = ctx.createGain();
    chirpDepth.gain.value = 0.5;
    const level = ctx.createGain();
    level.gain.value = 0.014;
    const swell = ctx.createOscillator();
    swell.frequency.value = 0.35;
    const swellDepth = ctx.createGain();
    swellDepth.gain.value = 0.012;
    chirp.connect(chirpDepth).connect(gate.gain);
    swell.connect(swellDepth).connect(level.gain);
    crickets.connect(band).connect(gate).connect(level).connect(panner);
    const room = ctx.createBufferSource();
    room.buffer = this.buffer;
    room.loop = true;
    const low = ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = 220;
    const roomLevel = ctx.createGain();
    roomLevel.gain.value = 0.025;
    room.connect(low).connect(roomLevel).connect(this.master);
    const sources = [crickets, chirp, swell, room];
    for (const s of sources) s.start();
    this.ambient = {
      stop: () => {
        for (const s of sources) s.stop();
        panner.disconnect();
        roomLevel.disconnect();
      },
    };
  }

  stopAmbient(): void {
    this.ambient?.stop();
    this.ambient = null;
  }

  private panner(at: Vec3): PannerNode {
    const ctx = this.ctx!;
    const p = ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = 1;
    p.rolloffFactor = 0.6;
    p.positionX.value = at[0];
    p.positionY.value = at[1];
    p.positionZ.value = at[2];
    p.connect(this.master!);
    return p;
  }
}
```

**File: `src/systems/AudioSystem.ts`**
```ts
import { createSystem, Quaternion, Vector3 } from '@iwsdk/core';
import { AudioEngine } from '../audio/AudioEngine.js';
import type { SoundName } from '../audio/recipes.js';
import type { Stage } from '../core/stage.js';
import type { Vec3 } from '../core/vec.js';
import type { GameEvent } from '../game/events.js';
import { store } from '../runtime/store.js';

function soundFor(event: GameEvent): SoundName {
  switch (event.type) {
    case 'voice':
      return `voice-${event.species}`;
    case 'reveal':
      return 'reveal';
    case 'eat':
      return 'eat';
    case 'pet':
      return 'pet';
    case 'flee':
      return 'flee';
    case 'firefly':
      return 'firefly';
  }
}

const stageToWorld = (s: Stage, x: number, y: number): Vec3 => [
  s.origin[0] + s.u[0] * x + s.v[0] * y,
  s.origin[1] + s.u[1] * x + s.v[1] * y,
  s.origin[2] + s.u[2] * x + s.v[2] * y,
];

/** Plays game events as spatial sounds on the wall and keeps the listener on the player's head. */
export class AudioSystem extends createSystem({}) {
  private readonly engine = new AudioEngine();
  private readonly v = new Vector3();
  private readonly f = new Vector3();
  private readonly q = new Quaternion();
  private ambientFor = -1;

  init(): void {
    const unlock = (): void => this.engine.unlock();
    document.addEventListener('pointerdown', unlock, { capture: true });
    document.addEventListener('keydown', unlock, { capture: true });
    this.renderer.xr.addEventListener('sessionstart', () => {
      unlock();
      this.renderer.xr.getSession()?.addEventListener('selectstart', unlock);
    });
    this.renderer.xr.addEventListener('sessionend', () => {
      this.engine.stopAmbient();
      this.ambientFor = -1;
    });
  }

  update(): void {
    const stage = store.stage;
    if (!stage) {
      store.events.length = 0;
      return;
    }
    if (this.engine.ready && this.ambientFor !== store.stageVersion) {
      this.engine.stopAmbient();
      this.engine.startAmbient(stage.origin);
      this.ambientFor = store.stageVersion;
    }
    this.player.head.getWorldPosition(this.v);
    this.player.head.getWorldQuaternion(this.q);
    this.f.set(0, 0, -1).applyQuaternion(this.q);
    this.engine.setListener(this.v.x, this.v.y, this.v.z, this.f.x, this.f.y, this.f.z);
    for (const event of store.events) this.engine.play(soundFor(event), stageToWorld(stage, event.x, event.y));
    store.events.length = 0;
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/audio src/systems/AudioSystem.ts
git commit -m "feat(audio): synthesize spatial creature voices, effects and night ambience"
```

---

### Task 8: Wire the living zoo into the systems

**Files:**
- Modify: `src/runtime/store.ts`, `src/index.ts`
- Rewrite: `src/systems/GameSystem.ts`

- [ ] **Step 1: Add the event queue to the store**

**File: `src/runtime/store.ts#2a`**
```ts
import { createJointSet, type Handedness, type JointSet } from '../core/poses.js';
import type { Stage } from '../core/stage.js';
import type { GameEvent } from '../game/events.js';
import type { ShadowCanvas } from '../render/ShadowCanvas.js';

export interface HandSample {
  tracked: boolean;
  readonly joints: JointSet;
}

export const SIDES: readonly Handedness[] = ['left', 'right'];

/** Per-frame state shared between systems (Hand/Stage write; Game/Render/Audio read). */
export const store = {
  stage: null as Stage | null,
  stageVersion: 0,
  narrow: false,
  relightRequested: false,
  canvas: null as ShadowCanvas | null,
  /** Game events this frame; AudioSystem plays and clears them. */
  events: [] as GameEvent[],
  hands: {
    left: { tracked: false, joints: createJointSet() },
    right: { tracked: false, joints: createJointSet() },
  } as Record<Handedness, HandSample>,
};
```

- [ ] **Step 2: Rewrite the game system as an orchestrator**

**File: `src/systems/GameSystem.ts#2a`**
```ts
import { createSystem } from '@iwsdk/core';
import { blendCapsules, placeCapsules, placePoint, type Point } from '../core/animate.js';
import type { Creature, Pool } from '../core/creature.js';
import { BONES } from '../core/joints.js';
import { buildCreatureShapes } from '../core/library.js';
import { HEART } from '../core/particles.js';
import { CAPSULE_STRIDE, ShadowProjector } from '../core/projector.js';
import { mulberry32 } from '../core/rng.js';
import { Silhouettes } from '../core/silhouette.js';
import type { Stage } from '../core/stage.js';
import { createHandShadow, updateHandShadow, type HandShadow } from '../game/hands.js';
import { Puppeteer, type Worn } from '../game/Puppeteer.js';
import { Visitors } from '../game/Visitors.js';
import { Zoo } from '../game/Zoo.js';
import { CH_GLOW, CH_SHADOW, CH_TARGET, type ShadowCanvas } from '../render/ShadowCanvas.js';
import { store } from '../runtime/store.js';

/** Runs the game each frame (hands, visitors, wearing, the zoo) and draws it into the shadow canvas. */
export class GameSystem extends createSystem({}) {
  private readonly sil = new Silhouettes();
  private readonly shapes = buildCreatureShapes(this.sil);
  private readonly projector = new ShadowProjector();
  private readonly hands: readonly HandShadow[] = [createHandShadow('left'), createHandShadow('right')];
  private readonly rng = mulberry32(20261109);
  private readonly visitors = new Visitors(this.shapes, this.sil);
  private readonly zoo = new Zoo(this.shapes, this.rng);
  private readonly puppeteer = new Puppeteer(this.shapes, this.sil);
  private readonly blendBuf = new Float32Array(BONES.length * CAPSULE_STRIDE);
  private readonly drawBuf = new Float32Array(BONES.length * CAPSULE_STRIDE);
  private readonly point: Point = { x: 0, y: 0 };
  private pool: Pool = { u: 1, v: 1 };
  private stageVersion = -1;
  private time = 0;
  private magnification = 3;

  update(delta: number): void {
    const canvas = store.canvas;
    const stage = store.stage;
    if (!canvas || !stage) return;
    if (this.stageVersion !== store.stageVersion) this.onStage(stage);
    this.time += delta;
    this.projector.setup(stage.lantern, stage);
    for (const hand of this.hands) {
      const sample = store.hands[hand.side];
      updateHandShadow(hand, sample.tracked ? sample.joints : null, this.projector, delta);
    }
    const revealed = this.visitors.update(delta, this.hands);
    if (revealed) this.zoo.add(revealed, store.events);
    const worn = this.puppeteer.update(delta, this.hands, this.zoo.unlocked, this.visitors.current?.def.id ?? null, this.projector);
    this.zoo.update(delta, this.pool, this.hands, worn, store.events);
    canvas.begin();
    this.drawHands(canvas, worn);
    this.drawVisitor(canvas);
    this.drawZoo(canvas, stage);
    canvas.end();
  }

  private onStage(stage: Stage): void {
    this.stageVersion = store.stageVersion;
    const toLantern = Math.hypot(stage.lantern[0] - stage.origin[0], stage.lantern[1] - stage.origin[1], stage.lantern[2] - stage.origin[2]);
    const toHand = Math.hypot(stage.lantern[0] - stage.hand[0], stage.lantern[1] - stage.hand[1], stage.lantern[2] - stage.hand[2]);
    this.magnification = toLantern / toHand;
    this.pool = { u: stage.poolU, v: stage.poolV };
  }

  private drawHands(canvas: ShadowCanvas, worn: Worn | null): void {
    for (const hand of this.hands) if (hand.tracked) canvas.addCapsules(hand.caps, 0, hand.drawCount, CH_SHADOW, 1);
    if (worn) canvas.addDot(worn.eyeX, worn.eyeY, 0.004 * this.magnification, CH_GLOW, 1);
  }

  private drawVisitor(canvas: ShadowCanvas): void {
    const visitor = this.visitors.current;
    if (!visitor) return;
    const progress = this.visitors.matcher.progress();
    const pulse = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(this.time * 2.6)) * (0.6 + 0.4 * progress);
    const { cx, cy } = visitor.target.frame;
    placeCapsules(visitor.caps, visitor.count, cx, cy, 0, 0, this.magnification, 1, this.drawBuf);
    canvas.addCapsules(this.drawBuf, 0, visitor.count, CH_TARGET, pulse);
  }

  private drawZoo(canvas: ShadowCanvas, stage: Stage): void {
    for (const creature of this.zoo.creatures) this.drawCreature(canvas, creature, stage);
    for (const f of this.zoo.fireflies.list) {
      const flicker = 0.65 + 0.35 * Math.sin(f.age * 9 + f.seed);
      canvas.addDot(f.x, f.y, 0.011, CH_GLOW, flicker);
      canvas.addDot(f.x, f.y, 0.03, CH_GLOW, 0.18 * flicker);
    }
    const p = this.zoo.particles;
    for (let i = 0; i < p.count; i++) {
      const k = p.life[i] / p.max[i];
      if (p.kind[i] === HEART) this.drawHeart(canvas, p.x[i], p.y[i], 0.02, k);
      else canvas.addDot(p.x[i], p.y[i], 0.002 + 0.008 * k, CH_GLOW, k);
    }
  }

  private drawCreature(canvas: ShadowCanvas, c: Creature, stage: Stage): void {
    const shape = this.shapes.get(c.species)!;
    const { cx, cy } = shape.target.frame;
    const y = c.y + c.lift;
    const scale = c.scale * c.bounce;
    blendCapsules(shape.caps, shape.actCaps, c.act, shape.count, this.blendBuf);
    placeCapsules(this.blendBuf, shape.count, cx, cy, c.x, y, scale, c.facing, this.drawBuf);
    canvas.addCapsules(this.drawBuf, 0, shape.count, CH_SHADOW, 1);
    if (c.motion === 'dangle') {
      const top = stage.poolV * Math.sqrt(Math.max(0, 1 - (c.x / stage.poolU) ** 2));
      canvas.addCapsule(c.x, y + c.size * 0.35, 0.0022, c.x, top, 0.0022, CH_SHADOW, 0.85);
    }
    if (c.eyeOpen > 0) {
      placePoint(shape.eye[0], shape.eye[1], cx, cy, c.x, y, scale, c.facing, this.point);
      canvas.addDot(this.point.x, this.point.y, 0.026 * c.size, CH_GLOW, 1);
    }
  }

  /** Two tapered capsules from round lobes to a point make a small heart. */
  private drawHeart(canvas: ShadowCanvas, x: number, y: number, r: number, alpha: number): void {
    canvas.addCapsule(x - r * 0.5, y + r * 0.35, r * 0.42, x, y - r * 0.55, r * 0.2, CH_GLOW, alpha);
    canvas.addCapsule(x + r * 0.5, y + r * 0.35, r * 0.42, x, y - r * 0.55, r * 0.2, CH_GLOW, alpha);
  }
}
```

- [ ] **Step 3: Register the audio system**

**File: `src/index.ts#2a`**
```ts
import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { AudioSystem } from './systems/AudioSystem.js';
import { GameSystem } from './systems/GameSystem.js';
import { HandSystem } from './systems/HandSystem.js';
import { RenderSystem } from './systems/RenderSystem.js';
import { StageSystem } from './systems/StageSystem.js';

World.create(document.getElementById('scene-container') as HTMLDivElement, projectOptions).then((world) => {
  world
    .registerSystem(HandSystem, { priority: 0 })
    .registerSystem(StageSystem, { priority: 1 })
    .registerSystem(GameSystem, { priority: 10 })
    .registerSystem(RenderSystem, { priority: 25 })
    .registerSystem(AudioSystem, { priority: 30 });
});
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm test && npm run build`
Expected: no type errors; every test passes; `✓ built in`.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/store.ts src/systems/GameSystem.ts src/index.ts
git commit -m "feat: wire visitors, puppeteer, living zoo and audio into the frame loop"
```

---

### Task 9: Emulator verification of the living zoo

**Files:**
- Create: `docs/evidence/p2a-*.png`, `docs/checkpoint-phase2a.md`

- [ ] **Step 1: Run the real hand path and meet the rabbit**

The dev server keeps running; Vite reloads on change.
1. Run `./node_modules/.bin/iwsdk browser reload`.
2. Poll `./node_modules/.bin/iwsdk dev status` until `data.state.browserCommandReady` is true.
3. Run `./node_modules/.bin/iwsdk xr enter`.
4. Switch the emulator to hands: `./node_modules/.bin/iwsdk xr set-input-mode --input-json '{"mode":"hand"}'`.
5. Pose the right hand as the rabbit: `xr set-hand-pose` with `{"device":"hand-right","poseId":"peace"}`.
6. Place it with `xr set-transform` and `{"device":"hand-right","anchor":"wrist","position":{"x":0.05,"y":1.3,"z":-0.4},"orientation":{"fingers":[0.45,1,0],"palm":[0,0,-1]}}`.

Expected: within about 5 s a living rabbit hops along the lower part of the pool, and the next visitor appears.

- [ ] **Step 2: Feed it**

Move the hand to the left of the stage with `xr set-transform` (x −0.1). Then run `./node_modules/.bin/iwsdk xr select --input-json '{"device":"hand-right"}'` three times; each is a pinch.

Capture `docs/evidence/p2a-fireflies.png` while fireflies glow and the rabbit chases.
Expected: the browser logs show no errors.

- [ ] **Step 3: Wear the rabbit and check sound**

1. Set the hand pose back to `peace` and hold it for 1 s; the rabbit is unlocked now, so the hand starts wearing it.
2. Capture `docs/evidence/p2a-worn.png`. Expected: an eye glint on the player's shadow.
3. Run `./node_modules/.bin/iwsdk browser logs` and confirm there are no errors. Audio playback can't be confirmed headless; record that.

- [ ] **Step 4: Write `docs/checkpoint-phase2a.md`**

Record:
- the test count;
- the three observations above, with screenshot paths;
- any issues fixed during verification;
- the limits: audio is only verified to run without errors, and real hand jitter is untested.

- [ ] **Step 5: Commit**

```bash
git add docs/evidence docs/checkpoint-phase2a.md
git commit -m "docs: record Phase 2A emulator verification"
```

---

## Self-review notes

- **Spec coverage, Phase 2A:**
  - §2.2 living behaviors and puppet actions: Tasks 1, 3, 5, 6.
  - §2.3 play (pet, feed, wear): Task 6.
  - Bond hearts: Tasks 3 and 6. Persistence comes in 2B.
  - §3.3 `AudioSystem` (procedural audio placed at the stage): Task 7.
  - §3.6 tracking loss clearing pinch and wear state: `updateHandShadow` and `Puppeteer`.
- **Phase 2B, next:**
  - onboarding and the ghost hand;
  - hints and the controllers-down panel;
  - progression (play goals between visitors, tricks at 3 hearts, stars, daily visitor, streak, embers);
  - save/load;
  - the menu and settings (assist, hand, sound, reduced motion, narrow view, Re-light, reset).
- **Type consistency checked:**
  - `Creature` is constructed as `(id, species, motion, x, y, scale, size, rng)` in both `Zoo.add` and the tests.
  - `Worn` fields are the same in `Puppeteer`, `Zoo` and the tests.
  - `CreatureShape.actJoints` is used by the `openness` test.
  - `store.events` is `GameEvent[]`.
  - `HandShadow.side` is used in `Zoo.feed`.
  - `blendCapsules`, `placeCapsules` and `placePoint` signatures match their use in `GameSystem`.
