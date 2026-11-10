# Shadow Zoo Phase 2B-1 (game flow) — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the living zoo into a full game loop:
- Progress is saved and restored.
- First-time players are taught with short captions and a glowing 3D ghost hand.
- The first three creatures come back to back; later ones arrive after a little play.
- Quick matches earn stars, and a creature with 3+ hearts does a trick when petted.
- Returning players are welcomed back, their streak warms the lantern, and once the zoo is complete a daily visitor with a twist earns an ember shown on the lantern rim.

**Architecture:**
- New pure modules, all with unit tests:
  - `save`: versioned schema with validation and a storage port;
  - `daily`: local day, streak and the daily visitor;
  - `Progression`: unlock order, play gates, stars, embers;
  - `Onboarding`: steps, captions and ghost visibility;
  - `Session`: owns save, progression, onboarding, visitors, puppeteer and zoo.
- `GameSystem` keeps only hand projection, the session call and drawing.
- Two render helpers, `Caption` (canvas text on the wall) and `GhostHand` (instanced 3D hand), are verified in the emulator.

**Tech stack:** as before.

**Spec:** §2.1 (first minute), §2.3 (progress, stars, tricks), §2.4 (daily visitor, streak, welcome back), §2.5 (reduced motion), §3.6 (storage robustness).

**Conventions:** as before. **Plan-sequencing rule (lesson from 2A):** a task that changes an API also updates every caller in the same task, so each commit typechecks.

---

## File structure

| File | Responsibility |
|---|---|
| `src/core/save.ts` | `SaveData` v1, `Settings`, `parseSave` (validate and sanitize), `SaveStore` (storage port, corrupt backup, in-memory fallback) |
| `src/core/daily.ts` | `localDay`, `dayDiff`, `visitToday` (streak), `dailyVisitor` (seeded species and twist) |
| `src/core/animate.ts` (append) | `rotateCapsules`, `rotatePoint` |
| `src/core/creature.ts` (edit) | `spin` trick at 3+ hearts, `motionScale` (reduced motion) |
| `src/game/Zoo.ts` (edit) | `add` options (silent restore, bond), `cheer`, `celebrate`, `setMotionScale`; the heart counts before the pet reaction |
| `src/game/Visitors.ts` (rewrite) | Queue entries with twists (`hold`, `minSize`), `busy`, `elapsed`, `lastElapsed`, `setTuning` |
| `src/game/Progression.ts` | Visitor plans: guided first three, play gates, daily; stars and embers |
| `src/game/Onboarding.ts` | Onboarding steps, `captionFor`, `showGhost` |
| `src/game/Session.ts` | Session orchestration (pure); restores the zoo; persists |
| `src/render/ShadowCanvas.ts` (edit) | `setLight` |
| `src/render/Caption.ts` | Canvas text on the stage with cross-fade |
| `src/render/GhostHand.ts` | Instanced 3D demonstration hand |
| `src/runtime/store.ts` (edit) | `session` reference |
| `src/systems/GameSystem.ts` (rewrite) | Hands, then the session, then drawing (including tricks and embers), caption and ghost |

---

### Task 1: Save data

**Files:**
- Create: `src/core/save.ts`
- Test: `tests/core/save.test.ts`

- [ ] **Step 1: Write the failing test**

**File: `tests/core/save.test.ts`**
```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, freshSave, parseSave, SAVE_KEY, SaveStore, type StoragePort } from '../../src/core/save.js';

class MemoryStorage implements StoragePort {
  readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

describe('parseSave', () => {
  it('round-trips a save', () => {
    const save = freshSave();
    save.unlocked = ['rabbit', 'dog'];
    save.bonds = { rabbit: 3 };
    save.stars = { dog: 2 };
    save.embers = 4;
    save.streak = 2;
    save.lastDay = '2026-11-10';
    save.settings.assist = 'gentle';
    expect(parseSave(JSON.stringify(save))).toEqual(save);
  });

  it('sanitizes unknown, duplicate and out-of-range values', () => {
    const parsed = parseSave(
      JSON.stringify({
        version: 1,
        unlocked: ['rabbit', 'unicorn', 'rabbit', 7, 'turtle'],
        bonds: { rabbit: 99, dragon: 2, dog: -4 },
        stars: { rabbit: 2.7 },
        embers: 'many',
        streak: 3,
        lastDay: 'yesterday',
        dailyDone: '2026-11-09',
        settings: { assist: 'cheat', hand: 'left', sound: 'yes', reducedMotion: true },
      }),
    )!;
    expect(parsed.unlocked).toEqual(['rabbit', 'turtle']);
    expect(parsed.bonds).toEqual({ rabbit: 5, dog: 0 });
    expect(parsed.stars).toEqual({ rabbit: 2 });
    expect(parsed.embers).toBe(0);
    expect(parsed.lastDay).toBeNull();
    expect(parsed.dailyDone).toBe('2026-11-09');
    expect(parsed.settings).toEqual({ ...DEFAULT_SETTINGS, hand: 'left', reducedMotion: true });
  });

  it('rejects unreadable text and other versions', () => {
    expect(parseSave('not json')).toBeNull();
    expect(parseSave(JSON.stringify({ version: 2 }))).toBeNull();
    expect(parseSave('[]')).toBeNull();
  });
});

describe('SaveStore', () => {
  it('saves and loads through the storage port', () => {
    const storage = new MemoryStorage();
    const a = new SaveStore(storage);
    a.data.unlocked.push('rabbit');
    expect(a.save()).toBe(true);
    expect(new SaveStore(storage).data.unlocked).toEqual(['rabbit']);
  });

  it('backs up an unreadable save and starts fresh with a notice', () => {
    const storage = new MemoryStorage();
    storage.setItem(SAVE_KEY, '{broken');
    const store = new SaveStore(storage);
    expect(store.notice).not.toBeNull();
    expect(store.data).toEqual(freshSave());
    expect(storage.getItem(`${SAVE_KEY}.corrupt`)).toBe('{broken');
  });

  it('keeps working in memory when storage throws', () => {
    const broken: StoragePort = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    const store = new SaveStore(broken);
    store.data.unlocked.push('dog');
    expect(store.save()).toBe(false);
    expect(new SaveStore(null).save()).toBe(false);
  });

  it('reset erases progress but keeps settings', () => {
    const storage = new MemoryStorage();
    const store = new SaveStore(storage);
    store.data.unlocked.push('rabbit');
    store.data.settings.sound = false;
    store.reset();
    expect(store.data.unlocked).toEqual([]);
    expect(store.data.settings.sound).toBe(false);
    expect(new SaveStore(storage).data.settings.sound).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/save.test.ts`
Expected: FAIL. The error says it can't resolve `../../src/core/save.js`.

- [ ] **Step 3: Implement**

**File: `src/core/save.ts`**
```ts
import { CREATURES, type CreatureId } from './library.js';
import type { AssistLevel } from './matcher.js';

export const SAVE_KEY = 'shadowzoo.save.v1';
export type HandPreference = 'auto' | 'left' | 'right';

export interface Settings {
  assist: AssistLevel;
  hand: HandPreference;
  sound: boolean;
  reducedMotion: boolean;
  narrow: boolean;
}

export interface SaveData {
  version: 1;
  /** Creatures brought to life, in order. */
  unlocked: CreatureId[];
  bonds: Partial<Record<CreatureId, number>>;
  stars: Partial<Record<CreatureId, number>>;
  embers: number;
  streak: number;
  /** Local date (YYYY-MM-DD) of the most recent session. */
  lastDay: string | null;
  /** Local date when the daily visitor was last matched. */
  dailyDone: string | null;
  settings: Settings;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = { assist: 'normal', hand: 'auto', sound: true, reducedMotion: false, narrow: false };

export const freshSave = (settings: Settings = { ...DEFAULT_SETTINGS }): SaveData => ({
  version: 1,
  unlocked: [],
  bonds: {},
  stars: {},
  embers: 0,
  streak: 0,
  lastDay: null,
  dailyDone: null,
  settings: { ...settings },
});

const IDS = new Set<string>(CREATURES.map((c) => c.id));
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const count = (v: unknown, max = Infinity): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(max, Math.floor(v))) : 0);
const day = (v: unknown): string | null => (typeof v === 'string' && DAY.test(v) ? v : null);
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
function pick<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(v as T) ? (v as T) : fallback;
}

function perCreature(v: unknown, max: number): Partial<Record<CreatureId, number>> {
  const out: Partial<Record<CreatureId, number>> = {};
  if (!isRecord(v)) return out;
  for (const [key, value] of Object.entries(v)) if (IDS.has(key)) out[key as CreatureId] = count(value, max);
  return out;
}

/** Parses saved JSON. Invalid fields fall back to defaults; null when unreadable or another version. */
export function parseSave(text: string): SaveData | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(raw) || raw.version !== 1) return null;
  const unlocked: CreatureId[] = [];
  if (Array.isArray(raw.unlocked)) {
    for (const id of raw.unlocked) if (typeof id === 'string' && IDS.has(id) && !unlocked.includes(id as CreatureId)) unlocked.push(id as CreatureId);
  }
  const s = isRecord(raw.settings) ? raw.settings : {};
  return {
    version: 1,
    unlocked,
    bonds: perCreature(raw.bonds, 5),
    stars: perCreature(raw.stars, 3),
    embers: count(raw.embers),
    streak: count(raw.streak),
    lastDay: day(raw.lastDay),
    dailyDone: day(raw.dailyDone),
    settings: {
      assist: pick(s.assist, ['gentle', 'normal', 'expert'] as const, DEFAULT_SETTINGS.assist),
      hand: pick(s.hand, ['auto', 'left', 'right'] as const, DEFAULT_SETTINGS.hand),
      sound: bool(s.sound, DEFAULT_SETTINGS.sound),
      reducedMotion: bool(s.reducedMotion, DEFAULT_SETTINGS.reducedMotion),
      narrow: bool(s.narrow, DEFAULT_SETTINGS.narrow),
    },
  };
}

/** The localStorage subset the game needs. */
export interface StoragePort {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Loads, holds and writes the save. Storage failures never throw; progress continues in memory. */
export class SaveStore {
  data: SaveData;
  /** Set when saved progress existed but could not be read. */
  readonly notice: string | null;

  constructor(private readonly storage: StoragePort | null) {
    let text: string | null = null;
    try {
      text = storage?.getItem(SAVE_KEY) ?? null;
    } catch {
      text = null;
    }
    const parsed = text === null ? null : parseSave(text);
    this.notice = text !== null && parsed === null ? 'Saved progress could not be read, so the zoo starts fresh.' : null;
    if (this.notice && text !== null) {
      try {
        storage?.setItem(`${SAVE_KEY}.corrupt`, text);
      } catch {
        // The backup is best effort; play continues in memory.
      }
    }
    this.data = parsed ?? freshSave();
  }

  save(): boolean {
    if (!this.storage) return false;
    try {
      this.storage.setItem(SAVE_KEY, JSON.stringify(this.data));
      return true;
    } catch {
      return false;
    }
  }

  /** Erases progress but keeps settings. */
  reset(): void {
    this.data = freshSave(this.data.settings);
    this.save();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/save.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/save.ts tests/core/save.test.ts
git commit -m "feat(core): add a versioned, validated save with a safe storage port"
```

---

### Task 2: Days, streak and the daily visitor

**Files:**
- Create: `src/core/daily.ts`
- Test: `tests/core/daily.test.ts`

- [ ] **Step 1: Write the failing test**

**File: `tests/core/daily.test.ts`**
```ts
import { describe, expect, it } from 'vitest';
import { dailyVisitor, dayDiff, localDay, visitToday } from '../../src/core/daily.js';
import type { CreatureId } from '../../src/core/library.js';
import { freshSave } from '../../src/core/save.js';

describe('days', () => {
  it('formats local dates and counts days between them', () => {
    expect(localDay(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
    expect(dayDiff('2026-12-31', '2027-01-01')).toBe(1);
    expect(dayDiff('2026-11-01', '2026-11-10')).toBe(9);
  });

  it('starts, keeps, grows and resets the streak', () => {
    const save = freshSave();
    expect(visitToday(save, '2026-11-10')).toBe('first');
    expect(save.streak).toBe(1);
    expect(visitToday(save, '2026-11-10')).toBe('same-day');
    expect(save.streak).toBe(1);
    expect(visitToday(save, '2026-11-11')).toBe('next-day');
    expect(save.streak).toBe(2);
    expect(visitToday(save, '2026-11-15')).toBe('returning');
    expect(save.streak).toBe(1);
    expect(save.lastDay).toBe('2026-11-15');
  });
});

describe('dailyVisitor', () => {
  const zoo: CreatureId[] = ['rabbit', 'dog', 'crocodile', 'peacock', 'spider', 'turtle'];

  it('is null without creatures and stable within a day', () => {
    expect(dailyVisitor('2026-11-10', [])).toBeNull();
    expect(dailyVisitor('2026-11-10', zoo)).toEqual(dailyVisitor('2026-11-10', zoo));
  });

  it('varies across days and uses both twists', () => {
    const species = new Set<string>();
    const twists = new Set<string>();
    for (let d = 1; d <= 30; d++) {
      const v = dailyVisitor(`2026-11-${String(d).padStart(2, '0')}`, zoo)!;
      expect(zoo).toContain(v.species);
      species.add(v.species);
      twists.add(v.twist);
    }
    expect(species.size).toBeGreaterThan(2);
    expect(twists).toEqual(new Set(['steady', 'big']));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/daily.test.ts`
Expected: FAIL. The error says it can't resolve `../../src/core/daily.js`.

- [ ] **Step 3: Implement**

**File: `src/core/daily.ts`**
```ts
import type { CreatureId } from './library.js';
import type { SaveData } from './save.js';

const pad = (n: number): string => String(n).padStart(2, '0');

/** The player's local calendar day as YYYY-MM-DD. */
export const localDay = (date: Date): string => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/** Whole days from day a to day b (YYYY-MM-DD). */
export function dayDiff(a: string, b: string): number {
  const t = (s: string): number => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
  return Math.round((t(b) - t(a)) / 86_400_000);
}

export type Greeting = 'first' | 'same-day' | 'next-day' | 'returning';

/** Records today's visit and updates the lantern streak. */
export function visitToday(save: SaveData, today: string): Greeting {
  const last = save.lastDay;
  save.lastDay = today;
  if (!last) {
    save.streak = 1;
    return 'first';
  }
  const diff = dayDiff(last, today);
  if (diff <= 0) {
    save.streak = Math.max(1, save.streak);
    return 'same-day';
  }
  if (diff === 1) {
    save.streak += 1;
    return 'next-day';
  }
  save.streak = 1;
  return 'returning';
}

/** "steady": hold the shape longer. "big": cast a bigger shadow by moving the hand toward the light. */
export type Twist = 'steady' | 'big';

export interface DailyVisitor {
  readonly species: CreatureId;
  readonly twist: Twist;
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Today's special visitor: one of the player's creatures with a twist, the same all day. */
export function dailyVisitor(today: string, unlocked: readonly CreatureId[]): DailyVisitor | null {
  if (unlocked.length === 0) return null;
  const h = hash(today);
  return { species: unlocked[h % unlocked.length], twist: (h >>> 8) % 2 === 0 ? 'steady' : 'big' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/daily.test.ts`
Expected: PASS (4 tests).

If the twist set misses one value across those 30 days, change the twist bit to `(h >>> 4) % 2` and rerun.

- [ ] **Step 5: Commit**

```bash
git add src/core/daily.ts tests/core/daily.test.ts
git commit -m "feat(core): add local days, lantern streak and the daily visitor"
```

---

### Task 3: Tricks, reduced motion and the zoo hooks the session needs

**Files:**
- Modify: `src/core/animate.ts` (append), `src/core/creature.ts` (edits), `src/game/Zoo.ts` (edits)
- Test: `tests/core/animate.test.ts`, `tests/core/creature.test.ts` (append inside their describe blocks)

- [ ] **Step 1: Write the failing tests**

Append inside `describe('animate', …)`:

**File: `tests/core/animate.test.ts#rotate`**
```ts
  it('rotates capsules and points around a center', () => {
    const caps = Float32Array.from([2, 1, 0.1, 1, 1, 0.1]);
    rotateCapsules(caps, 1, Math.PI / 2, 1, 1);
    expect(Array.from(caps).map((v) => +v.toFixed(5))).toEqual([1, 2, 0.1, 1, 1, 0.1]);
    const p = { x: 2, y: 1 };
    rotatePoint(p, Math.PI, 1, 1);
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(1);
  });
```
Also extend the import to `import { blendCapsules, placeCapsules, placePoint, rotateCapsules, rotatePoint } from '../../src/core/animate.js';`.

Append inside `describe('Creature', …)`:

**File: `tests/core/creature.test.ts#trick`**
```ts
  it('does a spin trick when petted with three or more hearts', () => {
    const c = make('trot');
    run(c, 1);
    c.mode = 'rest';
    c.bond = 3;
    c.pet();
    run(c, 0.45);
    expect(c.spin).toBeGreaterThan(0.5);
    expect(c.spin).toBeLessThan(Math.PI * 2);
    run(c, 0.6);
    expect(c.spin).toBe(0);
  });

  it('hops lower with reduced motion', () => {
    const peak = (scale: number) => {
      const c = make('hop', 0, 0, 5);
      c.motionScale = scale;
      let max = 0;
      for (let i = 0; i < 60 * 20; i++) {
        c.update(1 / 60, pool, []);
        max = Math.max(max, c.lift);
      }
      return max;
    };
    expect(peak(0.35)).toBeLessThan(peak(1) * 0.5);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/core/animate.test.ts tests/core/creature.test.ts`
Expected: FAIL. `rotateCapsules` is not exported; `spin` and `motionScale` are undefined.

- [ ] **Step 3: Implement**

**File: `src/core/animate.ts#rotate`** (append)
```ts

/** Rotates capsule endpoints in place by `angle` around (ox, oy); radii are unchanged. */
export function rotateCapsules(caps: Float32Array, count: number, angle: number, ox: number, oy: number): void {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  for (let i = 0; i < count; i++) {
    const o = i * CAPSULE_STRIDE;
    let x = caps[o] - ox;
    let y = caps[o + 1] - oy;
    caps[o] = x * c - y * s + ox;
    caps[o + 1] = x * s + y * c + oy;
    x = caps[o + 3] - ox;
    y = caps[o + 4] - oy;
    caps[o + 3] = x * c - y * s + ox;
    caps[o + 4] = x * s + y * c + oy;
  }
}

/** Rotates a point in place by `angle` around (ox, oy). */
export function rotatePoint(p: Point, angle: number, ox: number, oy: number): void {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const x = p.x - ox;
  const y = p.y - oy;
  p.x = x * c - y * s + ox;
  p.y = x * s + y * c + oy;
}
```

Edit `src/core/creature.ts` (exact replacements):

1. `const APPEAR_TIME = 0.8;` becomes `const APPEAR_TIME = 0.8;` followed by a new line `const TRICK_TIME = 0.9;`.
2. After `const easeOut = (k: number): number => 1 - (1 - k) ** 3;`, add `const easeInOut = (k: number): number => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2);`.
3. Replace `  fireflyId = -1;\n  private timer = APPEAR_TIME;` with:
```ts
  fireflyId = -1;
  /** Trick rotation in radians (0 when not performing). */
  spin = 0;
  /** 1 = full motion; lower values calm hops and bounces (reduced motion). */
  motionScale = 1;
  private trickTime = 0;
  private timer = APPEAR_TIME;
```
4. In `pet()`, after `this.timer = 1.1;`, add the line `if (this.bond >= 3) this.trickTime = TRICK_TIME;`.
5. In `update()`, after `this.blink(dt);`, add:
```ts
    if (this.trickTime > 0) {
      this.trickTime = Math.max(0, this.trickTime - dt);
      this.spin = this.trickTime > 0 ? Math.PI * 2 * easeInOut(1 - this.trickTime / TRICK_TIME) : 0;
    }
```
6. Replace `    this.keepInside(pool);\n  }\n\n  private appear(` with:
```ts
    this.lift *= this.motionScale;
    this.bounce = 1 + (this.bounce - 1) * this.motionScale;
    this.keepInside(pool);
  }

  private appear(
```

Edit `src/game/Zoo.ts` (exact replacements):

1. Replace the whole `add(...)` method with:
```ts
  add(revealed: Revealed, events: GameEvent[], options: { readonly silent?: boolean; readonly bond?: number } = {}): Creature {
    const def = this.shapes.get(revealed.species)!.def;
    const creature = new Creature(this.nextId++, revealed.species, def.motion, revealed.x, revealed.y, revealed.scale, revealed.size, this.rng);
    creature.bond = options.bond ?? 0;
    creature.motionScale = this.motionScale;
    this.creatures.push(creature);
    this.unlockedSet.add(revealed.species);
    if (!options.silent) {
      this.particles.emit(SPARK, revealed.x, revealed.y, 16, revealed.size * 0.9, this.rng);
      events.push({ type: 'reveal', species: revealed.species, x: revealed.x, y: revealed.y });
    }
    return creature;
  }

  /** Today's visitor matched: the zoo's creature of that species cheers. */
  cheer(species: CreatureId, x: number, y: number, events: GameEvent[]): void {
    for (const c of this.creatures) {
      if (c.species !== species) continue;
      c.pet();
      this.particles.emit(HEART, c.x, c.y + c.size * 0.45, 4, c.size * 0.5, this.rng);
    }
    this.particles.emit(SPARK, x, y, 16, 0.3, this.rng);
    events.push({ type: 'reveal', species, x, y });
  }

  /** Star sparkles for a matched visitor: more stars, more sparkle. */
  celebrate(x: number, y: number, stars: number, size: number): void {
    this.particles.emit(SPARK, x, y, stars * 5, size * 0.7, this.rng);
  }

  /** Reduced motion: scales hops and bounces for every creature, present and future. */
  setMotionScale(scale: number): void {
    this.motionScale = scale;
    for (const c of this.creatures) c.motionScale = scale;
  }
```
2. Add the field `private motionScale = 1;` after `private nextId = 1;`.
3. In `updatePet`, swap the two lines `c.pet();` and `c.bond = Math.min(MAX_BOND, c.bond + 1);` so the heart counts before the pet reaction, which lets the third heart trigger the trick.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run && npm run typecheck`
Expected: every test passes (101 or more); no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/core/animate.ts src/core/creature.ts src/game/Zoo.ts tests/core/animate.test.ts tests/core/creature.test.ts
git commit -m "feat: spin tricks at three hearts, reduced motion, and zoo restore/cheer hooks"
```

---

### Task 4: Visitor twists

**Files:**
- Rewrite: `src/game/Visitors.ts`
- Test: `tests/game/game.test.ts` (append inside `describe('Visitors', …)`)

- [ ] **Step 1: Write the failing test**

**File: `tests/game/game.test.ts#big`**
```ts
  it('a big visitor needs a bigger shadow, and timing is reported', () => {
    const visitors = new Visitors(shapes, sil, [], 0);
    const size = shapes.get('rabbit')!.target.frame.size;
    visitors.enqueue('rabbit', { minSize: size * 1.4 });
    expect(visitors.busy).toBe(true);
    const small = [shaped('rabbit')];
    for (let t = 0; t < 3; t += 1 / 60) expect(visitors.update(1 / 60, small)).toBeNull();
    const big = shaped('rabbit');
    for (let i = 0; i < big.caps.length; i++) big.caps[i] *= 1.6;
    let revealed = null;
    for (let t = 0; t < 3 && !revealed; t += 1 / 60) revealed = visitors.update(1 / 60, [big]);
    expect(revealed?.species).toBe('rabbit');
    expect(visitors.lastElapsed).toBeGreaterThan(3);
    expect(visitors.busy).toBe(false);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/game/game.test.ts`
Expected: FAIL. `busy` and `lastElapsed` are undefined, and `enqueue` ignores the options.

- [ ] **Step 3: Implement**

**File: `src/game/Visitors.ts#2b`**
```ts
import { CREATURES, type CreatureId, type CreatureShape } from '../core/library.js';
import { Matcher, TUNING, type MatchTuning } from '../core/matcher.js';
import { createFrame, matchScore, type Silhouettes } from '../core/silhouette.js';
import type { Revealed } from './events.js';
import type { HandShadow } from './hands.js';

const MATCH_INTERVAL = 1 / 15;
const NEXT_VISITOR_DELAY = 2.5;
/** A too-small shadow can't score above this for a "big" visitor. */
const SMALL_SHADOW_CAP = 0.3;

/** Per-visitor twists: hold the shape longer, or cast a bigger shadow. */
export interface VisitorOptions {
  readonly hold?: number;
  readonly minSize?: number;
}

interface Entry {
  readonly species: CreatureId;
  readonly options: VisitorOptions;
}

/** Creature outlines waiting to be matched, one at a time. */
export class Visitors {
  current: CreatureShape | null = null;
  options: VisitorOptions = {};
  /** Seconds the current visitor has been showing. */
  elapsed = 0;
  /** How long the last revealed visitor took to match (seconds). */
  lastElapsed = 0;
  readonly matcher: Matcher;
  private readonly queue: Entry[];
  private readonly frame = createFrame();
  private readonly best = createFrame();
  private wait: number;
  private pending = 0;

  constructor(
    private readonly shapes: ReadonlyMap<CreatureId, CreatureShape>,
    private readonly sil: Silhouettes,
    order: readonly CreatureId[] = CREATURES.map((c) => c.id),
    firstDelay = 1.2,
    private tuning: MatchTuning = TUNING.normal,
  ) {
    this.queue = order.map((species) => ({ species, options: {} }));
    this.wait = firstDelay;
    this.matcher = new Matcher(tuning);
  }

  /** True while a visitor is showing or waiting to appear. */
  get busy(): boolean {
    return this.current !== null || this.queue.length > 0;
  }

  enqueue(species: CreatureId, options: VisitorOptions = {}): void {
    this.queue.push({ species, options });
  }

  /** Changes the assist level; a visitor's own hold twist still applies. */
  setTuning(tuning: MatchTuning): void {
    this.tuning = tuning;
    this.matcher.setTuning(this.options.hold ? { ...tuning, hold: this.options.hold } : tuning);
  }

  update(dt: number, hands: readonly HandShadow[]): Revealed | null {
    if (!this.current) {
      if (this.queue.length === 0) return null;
      this.wait -= dt;
      if (this.wait > 0) return null;
      const entry = this.queue.shift()!;
      this.current = this.shapes.get(entry.species) ?? null;
      this.options = entry.options;
      this.setTuning(this.tuning);
      this.matcher.reset();
      this.pending = 0;
      this.elapsed = 0;
      return null;
    }
    this.elapsed += dt;
    this.pending += dt;
    if (this.pending < MATCH_INTERVAL) return null;
    const tick = this.pending;
    this.pending = 0;
    let bestScore: number | null = null;
    for (const hand of hands) {
      if (!hand.tracked || hand.count === 0) continue;
      let score = matchScore(this.sil, hand.caps, 0, hand.count, this.current.target, this.frame);
      if (this.options.minSize && this.frame.size < this.options.minSize) score = Math.min(score, SMALL_SHADOW_CAP);
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
    this.options = {};
    this.lastElapsed = this.elapsed;
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

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run && npm run typecheck`
Expected: PASS; no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/game/Visitors.ts tests/game/game.test.ts
git commit -m "feat(game): visitor twists (steady hold, big shadow) with match timing"
```

---

### Task 5: Progression and onboarding

**Files:**
- Create: `src/game/Progression.ts`, `src/game/Onboarding.ts`
- Test: `tests/game/flow.test.ts`

- [ ] **Step 1: Write the failing test**

**File: `tests/game/flow.test.ts`**
```ts
import { describe, expect, it } from 'vitest';
import { freshSave } from '../../src/core/save.js';
import { captionFor, Onboarding, showGhost, type CaptionInput } from '../../src/game/Onboarding.js';
import { Progression, starsFor } from '../../src/game/Progression.js';

const today = '2026-11-10';

describe('Progression', () => {
  it('sends the first three creatures back to back, in order', () => {
    const save = freshSave();
    const p = new Progression(save, today);
    for (const id of ['rabbit', 'dog', 'crocodile'] as const) {
      const plan = p.nextVisitor()!;
      expect(plan).toEqual({ species: id, kind: 'new', twist: null });
      p.onRevealed(plan, 4);
    }
    expect(save.unlocked).toEqual(['rabbit', 'dog', 'crocodile']);
  });

  it('holds later creatures until 45 s of play or three feedings', () => {
    const save = freshSave();
    save.unlocked = ['rabbit', 'dog', 'crocodile'];
    const byTime = new Progression(save, today);
    expect(byTime.nextVisitor()).toBeNull();
    byTime.tick(45);
    expect(byTime.nextVisitor()?.species).toBe('peacock');
    const byFeeding = new Progression(save, today);
    for (let i = 0; i < 3; i++) byFeeding.onEat();
    expect(byFeeding.nextVisitor()?.species).toBe('peacock');
  });

  it('offers a daily visitor with a twist once the zoo is complete, once a day', () => {
    const save = freshSave();
    save.unlocked = ['rabbit', 'dog', 'crocodile', 'peacock', 'spider', 'turtle'];
    const p = new Progression(save, today);
    const plan = p.nextVisitor()!;
    expect(plan.kind).toBe('daily');
    expect(['steady', 'big']).toContain(plan.twist);
    p.onRevealed(plan, 20);
    expect(save.embers).toBe(1);
    expect(save.dailyDone).toBe(today);
    expect(p.nextVisitor()).toBeNull();
  });

  it('awards one to three stars by speed and keeps the best', () => {
    expect([starsFor(4), starsFor(10), starsFor(40)]).toEqual([3, 2, 1]);
    const save = freshSave();
    const p = new Progression(save, today);
    p.onRevealed({ species: 'rabbit', kind: 'new', twist: null }, 4);
    p.onRevealed({ species: 'rabbit', kind: 'daily', twist: 'big' }, 40);
    expect(save.stars.rabbit).toBe(3);
  });
});

describe('onboarding and captions', () => {
  const base: CaptionInput = { step: 'done', visitor: null, twist: null, visitorElapsed: 0, visitorProgress: 0, handsMissing: 0, welcome: 0, streak: 1 };

  it('walks a first-time player through rabbit, feeding and petting', () => {
    const o = new Onboarding(true);
    expect(o.step).toBe('make');
    o.onEat();
    expect(o.step).toBe('make');
    o.onReveal();
    expect(o.step).toBe('feed');
    o.onEat();
    expect(o.step).toBe('pet');
    o.onPet();
    expect(o.step).toBe('done');
    expect(new Onboarding(false).step).toBe('done');
  });

  it('shows the first rabbit with a caption and the ghost hand', () => {
    const input = { ...base, step: 'make' as const, visitor: 'rabbit' as const };
    expect(captionFor(input)).toBe('Make a rabbit with your hand');
    expect(showGhost(input)).toBe(true);
  });

  it('hints only after six seconds without progress', () => {
    const input = { ...base, visitor: 'dog' as const, visitorElapsed: 3 };
    expect(captionFor(input)).toBeNull();
    expect(showGhost(input)).toBe(false);
    const stuck = { ...input, visitorElapsed: 7, visitorProgress: 0.3 };
    expect(captionFor(stuck)).toBe('Copy the glowing shape');
    expect(showGhost(stuck)).toBe(true);
    expect(showGhost({ ...stuck, visitorProgress: 0.8 })).toBe(false);
  });

  it('prioritizes missing hands, then the welcome, then twists', () => {
    expect(captionFor({ ...base, handsMissing: 4, welcome: 2 })).toBe('Show your hands to the lantern');
    expect(captionFor({ ...base, welcome: 2, streak: 3 })).toBe('Welcome back! 3 nights in a row');
    expect(captionFor({ ...base, welcome: 2 })).toBe('Welcome back!');
    expect(captionFor({ ...base, visitor: 'rabbit', twist: 'big' })).toBe('A big visitor! Move your hand toward the light');
    expect(captionFor({ ...base, visitor: 'rabbit', twist: 'steady' })).toBe('A shy visitor. Hold the shape steady');
    expect(captionFor({ ...base, step: 'feed' })).toBe('Pinch to give it a firefly');
    expect(captionFor({ ...base, step: 'pet' })).toBe('Rest your shadow on it');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/game/flow.test.ts`
Expected: FAIL. The error says it can't resolve `../../src/game/Onboarding.js`.

- [ ] **Step 3: Implement**

**File: `src/game/Progression.ts`**
```ts
import { dailyVisitor, type Twist } from '../core/daily.js';
import type { CreatureId } from '../core/library.js';
import type { SaveData } from '../core/save.js';

/** The order creatures come to life. */
export const ORDER: readonly CreatureId[] = ['rabbit', 'dog', 'crocodile', 'peacock', 'spider', 'turtle'];
/** The first visitors arrive back to back; later ones after a little play. */
const GUIDED = 3;
const PLAY_SECONDS = 45;
const PLAY_EATS = 3;

export interface VisitorPlan {
  readonly species: CreatureId;
  readonly kind: 'new' | 'daily';
  readonly twist: Twist | null;
}

/** Stars for a match by how quickly it happened. */
export const starsFor = (seconds: number): number => (seconds <= 6 ? 3 : seconds <= 15 ? 2 : 1);

/** Decides which visitor comes next and records what each match earns. */
export class Progression {
  private sinceUnlock = 0;
  private eatsSinceUnlock = 0;

  constructor(
    private readonly save: SaveData,
    private readonly today: string,
  ) {}

  tick(dt: number): void {
    this.sinceUnlock += dt;
  }

  onEat(): void {
    this.eatsSinceUnlock++;
  }

  /** The next visitor, or null when the player should play a little first (or today's visitor is done). */
  nextVisitor(): VisitorPlan | null {
    const next = ORDER.find((id) => !this.save.unlocked.includes(id));
    if (next) {
      const ready = this.save.unlocked.length < GUIDED || this.sinceUnlock >= PLAY_SECONDS || this.eatsSinceUnlock >= PLAY_EATS;
      return ready ? { species: next, kind: 'new', twist: null } : null;
    }
    if (this.save.dailyDone === this.today) return null;
    const daily = dailyVisitor(this.today, this.save.unlocked);
    return daily ? { species: daily.species, kind: 'daily', twist: daily.twist } : null;
  }

  /** Records a matched visitor and returns the stars it earned. */
  onRevealed(plan: VisitorPlan, seconds: number): number {
    if (plan.kind === 'new') {
      if (!this.save.unlocked.includes(plan.species)) this.save.unlocked.push(plan.species);
      this.sinceUnlock = 0;
      this.eatsSinceUnlock = 0;
    } else {
      this.save.dailyDone = this.today;
      this.save.embers += 1;
    }
    const stars = starsFor(seconds);
    this.save.stars[plan.species] = Math.max(this.save.stars[plan.species] ?? 0, stars);
    return stars;
  }
}
```

**File: `src/game/Onboarding.ts`**
```ts
import type { Twist } from '../core/daily.js';
import type { CreatureId } from '../core/library.js';

/** First-time teaching steps: make the rabbit, feed it, pet it. */
export type Step = 'make' | 'feed' | 'pet' | 'done';

/** Seconds without progress before a hint appears. */
const HINT_AFTER = 6;
const HINT_BELOW = 0.6;

export class Onboarding {
  step: Step;

  constructor(firstTime: boolean) {
    this.step = firstTime ? 'make' : 'done';
  }

  onReveal(): void {
    if (this.step === 'make') this.step = 'feed';
  }

  onEat(): void {
    if (this.step === 'feed') this.step = 'pet';
  }

  onPet(): void {
    if (this.step === 'pet') this.step = 'done';
  }
}

export interface CaptionInput {
  readonly step: Step;
  readonly visitor: CreatureId | null;
  readonly twist: Twist | null;
  readonly visitorElapsed: number;
  readonly visitorProgress: number;
  readonly handsMissing: number;
  readonly welcome: number;
  readonly streak: number;
}

const stuck = (s: CaptionInput): boolean => s.visitorElapsed > HINT_AFTER && s.visitorProgress < HINT_BELOW;

/** The one short line shown on the wall right now, or null. */
export function captionFor(s: CaptionInput): string | null {
  if (s.handsMissing > 3) return 'Show your hands to the lantern';
  if (s.welcome > 0) return s.streak > 1 ? `Welcome back! ${s.streak} nights in a row` : 'Welcome back!';
  if (s.visitor) {
    if (s.twist === 'big') return 'A big visitor! Move your hand toward the light';
    if (s.twist === 'steady') return 'A shy visitor. Hold the shape steady';
    if (s.step === 'make') return 'Make a rabbit with your hand';
    return stuck(s) ? 'Copy the glowing shape' : null;
  }
  if (s.step === 'feed') return 'Pinch to give it a firefly';
  if (s.step === 'pet') return 'Rest your shadow on it';
  return null;
}

/** Whether the glowing ghost hand should demonstrate the visitor's shape. */
export const showGhost = (s: CaptionInput): boolean => s.visitor !== null && (s.step === 'make' || stuck(s));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/game/flow.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/game/Progression.ts src/game/Onboarding.ts tests/game/flow.test.ts
git commit -m "feat(game): progression gates, stars, daily embers, onboarding captions"
```

---

### Task 6: Session

**Files:**
- Create: `src/game/Session.ts`
- Test: `tests/game/session.test.ts`

- [ ] **Step 1: Write the failing test**

**File: `tests/game/session.test.ts`**
```ts
import { describe, expect, it } from 'vitest';
import { buildCreatureShapes, type CreatureId } from '../../src/core/library.js';
import { ShadowProjector } from '../../src/core/projector.js';
import { mulberry32 } from '../../src/core/rng.js';
import { freshSave, SAVE_KEY, type SaveData, type StoragePort } from '../../src/core/save.js';
import { Silhouettes } from '../../src/core/silhouette.js';
import type { GameEvent } from '../../src/game/events.js';
import { createHandShadow, type HandShadow } from '../../src/game/hands.js';
import { Session } from '../../src/game/Session.js';

const sil = new Silhouettes();
const shapes = buildCreatureShapes(sil);
const pool = { u: 0.8, v: 0.6 };
const projector = new ShadowProjector();
projector.setup([0, 0, 1], { origin: [0, 0, -1], u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] });

class MemoryStorage implements StoragePort {
  readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

const hand = (id: CreatureId | null): HandShadow => {
  const h = createHandShadow('right');
  if (!id) return h;
  const s = shapes.get(id)!;
  h.caps.set(s.caps);
  h.count = s.count;
  h.drawCount = s.count;
  h.tracked = true;
  return h;
};
const run = (session: Session, seconds: number, hands: HandShadow[], events: GameEvent[] = []) => {
  let view = session.update(0, hands, projector, pool, events);
  for (let t = 0; t < seconds; t += 1 / 30) view = session.update(1 / 30, hands, projector, pool, events);
  return view;
};
const at = (iso: string) => new Date(`${iso}T20:00:00`);
const withSave = (save: SaveData) => {
  const storage = new MemoryStorage();
  storage.setItem(SAVE_KEY, JSON.stringify(save));
  return storage;
};

describe('Session', () => {
  it('teaches a first-time player with the rabbit, then feeding, and saves progress', () => {
    const storage = new MemoryStorage();
    const session = new Session(shapes, sil, storage, at('2026-11-10'), mulberry32(1));
    session.onStage(pool, 1);
    let view = run(session, 1.5, [hand(null)]);
    expect(session.visitors.current?.def.id).toBe('rabbit');
    expect(view.caption).toBe('Make a rabbit with your hand');
    expect(view.ghost).toBe('rabbit');
    view = run(session, 2.5, [hand('rabbit')]);
    expect(session.zoo.unlocked.has('rabbit')).toBe(true);
    expect(view.caption).toBe('Pinch to give it a firefly');
    expect(view.ghost).toBeNull();
    const saved = JSON.parse(storage.getItem(SAVE_KEY)!) as SaveData;
    expect(saved.unlocked).toEqual(['rabbit']);
    expect(saved.stars.rabbit).toBe(3);
    run(session, 5, [hand(null)]);
    expect(session.visitors.current).toBeNull();
  });

  it("brings back a returning player's zoo with a welcome, then today's visitor", () => {
    const save = freshSave();
    save.unlocked = ['rabbit', 'dog', 'crocodile', 'peacock', 'spider', 'turtle'];
    save.bonds = { rabbit: 3 };
    save.streak = 2;
    save.lastDay = '2026-11-09';
    const session = new Session(shapes, sil, withSave(save), at('2026-11-10'), mulberry32(2));
    expect(session.greeting).toBe('next-day');
    session.onStage(pool, 1);
    expect(session.zoo.creatures).toHaveLength(6);
    expect(session.zoo.creatures.find((c) => c.species === 'rabbit')!.bond).toBe(3);
    expect(run(session, 1, [hand(null)]).caption).toBe('Welcome back! 3 nights in a row');
    run(session, 5, [hand(null)]);
    expect(session.visitors.current).not.toBeNull();
  });

  it('asks for a little play before each visitor after the first three', () => {
    const save = freshSave();
    save.unlocked = ['rabbit', 'dog', 'crocodile'];
    save.streak = 1;
    save.lastDay = '2026-11-10';
    const session = new Session(shapes, sil, withSave(save), at('2026-11-10'), mulberry32(3));
    session.onStage(pool, 1);
    run(session, 30, [hand(null)]);
    expect(session.visitors.current).toBeNull();
    run(session, 20, [hand(null)]);
    expect(session.visitors.current?.def.id).toBe('peacock');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/game/session.test.ts`
Expected: FAIL. The error says it can't resolve `../../src/game/Session.js`.

- [ ] **Step 3: Implement**

**File: `src/game/Session.ts`**
```ts
import type { Pool } from '../core/creature.js';
import { localDay, visitToday, type Greeting } from '../core/daily.js';
import type { CreatureId, CreatureShape } from '../core/library.js';
import { TUNING } from '../core/matcher.js';
import type { ShadowProjector } from '../core/projector.js';
import { SaveStore, type HandPreference, type Settings, type StoragePort } from '../core/save.js';
import type { Silhouettes } from '../core/silhouette.js';
import type { GameEvent, Revealed } from './events.js';
import type { HandShadow } from './hands.js';
import { captionFor, Onboarding, showGhost, type CaptionInput, type Step } from './Onboarding.js';
import { Progression, type VisitorPlan } from './Progression.js';
import { Puppeteer, type Worn } from './Puppeteer.js';
import { Visitors } from './Visitors.js';
import { Zoo } from './Zoo.js';

const WELCOME_SECONDS = 4;
/** Seconds an onboarding step may hold back the next visitor. */
const ONBOARDING_PATIENCE = 20;
/** A "big" visitor needs a shadow this much larger than the usual size. */
const BIG_FACTOR = 1.3;
const STEADY_HOLD = 2;
const REDUCED_MOTION_SCALE = 0.35;

export interface SessionView {
  caption: string | null;
  ghost: CreatureId | null;
  worn: Worn | null;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** One play session: save, progression, onboarding, visitors, wearing and the zoo. Pure game logic. */
export class Session {
  readonly saves: SaveStore;
  readonly progression: Progression;
  readonly onboarding: Onboarding;
  readonly visitors: Visitors;
  readonly zoo: Zoo;
  readonly greeting: Greeting;
  private readonly puppeteer: Puppeteer;
  private readonly view: SessionView = { caption: null, ghost: null, worn: null };
  private readonly input: Mutable<CaptionInput>;
  private readonly handSets: Record<HandPreference, HandShadow[]> = { auto: [], left: [], right: [] };
  private plan: VisitorPlan | null = null;
  private restored = false;
  private magnification = 3;
  private handsMissing = 0;
  private welcome = 0;
  private stepTime = 0;
  private lastStep: Step;

  constructor(
    private readonly shapes: ReadonlyMap<CreatureId, CreatureShape>,
    sil: Silhouettes,
    storage: StoragePort | null,
    now: Date,
    rng: () => number,
  ) {
    this.saves = new SaveStore(storage);
    const today = localDay(now);
    this.greeting = visitToday(this.saves.data, today);
    this.saves.save();
    const data = this.saves.data;
    this.progression = new Progression(data, today);
    this.onboarding = new Onboarding(data.unlocked.length === 0);
    this.lastStep = this.onboarding.step;
    this.visitors = new Visitors(shapes, sil, [], 1.2, TUNING[data.settings.assist]);
    this.zoo = new Zoo(shapes, rng);
    this.zoo.setMotionScale(data.settings.reducedMotion ? REDUCED_MOTION_SCALE : 1);
    this.puppeteer = new Puppeteer(shapes, sil);
    if (data.unlocked.length > 0 && this.greeting !== 'same-day') this.welcome = WELCOME_SECONDS;
    this.input = { step: this.onboarding.step, visitor: null, twist: null, visitorElapsed: 0, visitorProgress: 0, handsMissing: 0, welcome: 0, streak: data.streak };
  }

  get settings(): Settings {
    return this.saves.data.settings;
  }

  /** Re-applies settings after a change and saves them. */
  applySettings(): void {
    this.visitors.setTuning(TUNING[this.settings.assist]);
    this.zoo.setMotionScale(this.settings.reducedMotion ? REDUCED_MOTION_SCALE : 1);
    this.saves.save();
  }

  /** Called whenever a stage exists; the first time it restores the saved zoo along the ground line. */
  onStage(pool: Pool, magnification: number): void {
    this.magnification = magnification;
    if (this.restored) return;
    this.restored = true;
    const data = this.saves.data;
    const n = data.unlocked.length;
    data.unlocked.forEach((species, i) => {
      const shape = this.shapes.get(species);
      if (!shape) return;
      const x = ((i + 0.5) / n - 0.5) * pool.u * 1.2;
      this.zoo.add({ species, x, y: 0, size: shape.target.frame.size * magnification, scale: magnification }, [], { silent: true, bond: data.bonds[species] ?? 0 });
    });
  }

  update(dt: number, hands: readonly HandShadow[], projector: ShadowProjector, pool: Pool, events: GameEvent[]): SessionView {
    const active = this.activeHands(hands);
    this.progression.tick(dt);
    this.updateTimers(dt, active);
    this.schedule();
    const revealed = this.visitors.update(dt, active);
    if (revealed && this.plan) this.onReveal(revealed, events);
    const worn = this.puppeteer.update(dt, active, this.zoo.unlocked, this.visitors.current?.def.id ?? null, projector);
    const before = events.length;
    this.zoo.update(dt, pool, active, worn, events);
    this.afterZoo(events, before);
    const input = this.input;
    input.step = this.onboarding.step;
    input.visitor = this.visitors.current?.def.id ?? null;
    input.twist = input.visitor ? (this.plan?.twist ?? null) : null;
    input.visitorElapsed = this.visitors.elapsed;
    input.visitorProgress = this.visitors.current ? this.visitors.matcher.progress() : 0;
    input.handsMissing = this.handsMissing;
    input.welcome = this.welcome;
    input.streak = this.saves.data.streak;
    this.view.caption = captionFor(input);
    this.view.ghost = showGhost(input) ? input.visitor : null;
    this.view.worn = worn;
    return this.view;
  }

  private activeHands(hands: readonly HandShadow[]): readonly HandShadow[] {
    const preference = this.settings.hand;
    if (preference === 'auto') return hands;
    const set = this.handSets[preference];
    if (set.length === 0) for (const h of hands) if (h.side === preference) set.push(h);
    return set;
  }

  private updateTimers(dt: number, hands: readonly HandShadow[]): void {
    let tracked = false;
    for (const h of hands) if (h.tracked) tracked = true;
    this.handsMissing = tracked ? 0 : this.handsMissing + dt;
    this.welcome = Math.max(0, this.welcome - dt);
    if (this.onboarding.step !== this.lastStep) {
      this.lastStep = this.onboarding.step;
      this.stepTime = 0;
    } else {
      this.stepTime += dt;
    }
  }

  private schedule(): void {
    if (this.visitors.busy || this.welcome > 0) return;
    const step = this.onboarding.step;
    if ((step === 'feed' || step === 'pet') && this.stepTime < ONBOARDING_PATIENCE) return;
    const plan = this.progression.nextVisitor();
    if (!plan) return;
    this.plan = plan;
    if (plan.twist === 'steady') this.visitors.enqueue(plan.species, { hold: STEADY_HOLD });
    else if (plan.twist === 'big') {
      const size = this.shapes.get(plan.species)!.target.frame.size * this.magnification;
      this.visitors.enqueue(plan.species, { minSize: size * BIG_FACTOR });
    } else this.visitors.enqueue(plan.species);
  }

  private onReveal(revealed: Revealed, events: GameEvent[]): void {
    const plan = this.plan!;
    this.plan = null;
    const stars = this.progression.onRevealed(plan, this.visitors.lastElapsed);
    if (plan.kind === 'new') this.zoo.add(revealed, events);
    else this.zoo.cheer(plan.species, revealed.x, revealed.y, events);
    this.zoo.celebrate(revealed.x, revealed.y, stars, revealed.size);
    this.onboarding.onReveal();
    this.saves.save();
  }

  private afterZoo(events: readonly GameEvent[], from: number): void {
    let changed = false;
    for (let i = from; i < events.length; i++) {
      const e = events[i];
      if (e.type === 'eat') {
        this.progression.onEat();
        this.onboarding.onEat();
        changed = true;
      } else if (e.type === 'pet') {
        this.onboarding.onPet();
        changed = true;
      }
    }
    if (!changed) return;
    const bonds = this.saves.data.bonds;
    for (const c of this.zoo.creatures) bonds[c.species] = Math.max(bonds[c.species] ?? 0, c.bond);
    this.saves.save();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/game/session.test.ts && npm run typecheck`
Expected: PASS (3 tests); no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/game/Session.ts tests/game/session.test.ts
git commit -m "feat(game): add the session (save, onboarding, progression, daily visitor)"
```

---

### Task 7: Caption, ghost hand and the rewired game system

**Files:**
- Create: `src/render/Caption.ts`, `src/render/GhostHand.ts`
- Modify: `src/render/ShadowCanvas.ts`, `src/runtime/store.ts`
- Rewrite: `src/systems/GameSystem.ts`

- [ ] **Step 1: Renderers**

**File: `src/render/Caption.ts`**
```ts
import { CanvasTexture, Matrix4, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace, Vector3 } from '@iwsdk/core';
import type { Stage } from '../core/stage.js';

const W = 1024;
const H = 128;

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

/** One short line of text near the top of the light pool, cross-fading when it changes. */
export class Caption {
  readonly mesh: Mesh;
  private readonly context: CanvasRenderingContext2D;
  private readonly texture: CanvasTexture;
  private readonly material: MeshBasicMaterial;
  private readonly basis = new Matrix4();
  private text: string | null = null;
  private wanted: string | null = null;
  private alpha = 0;

  constructor() {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    this.context = canvas.getContext('2d')!;
    this.texture = new CanvasTexture(canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.material = new MeshBasicMaterial({ map: this.texture, transparent: true, depthWrite: false, opacity: 0 });
    this.mesh = new Mesh(new PlaneGeometry(1, 1), this.material);
    this.mesh.renderOrder = 11;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  place(stage: Stage): void {
    const width = Math.min(1.6, stage.poolU * 1.5);
    this.basis.makeBasis(new Vector3(...stage.u), new Vector3(...stage.v), new Vector3(...stage.n));
    this.mesh.quaternion.setFromRotationMatrix(this.basis);
    const y = stage.poolV * 0.78;
    this.mesh.position.set(
      stage.origin[0] + stage.v[0] * y + stage.n[0] * 0.006,
      stage.origin[1] + stage.v[1] * y + stage.n[1] * 0.006,
      stage.origin[2] + stage.v[2] * y + stage.n[2] * 0.006,
    );
    this.mesh.scale.set(width, (width * H) / W, 1);
  }

  show(text: string | null): void {
    this.wanted = text;
  }

  update(dt: number): void {
    if (this.wanted !== this.text) {
      this.alpha = Math.max(0, this.alpha - dt * 4);
      if (this.alpha === 0) {
        this.text = this.wanted;
        if (this.text) this.draw(this.text);
      }
    } else if (this.text) {
      this.alpha = Math.min(1, this.alpha + dt * 3);
    }
    this.material.opacity = this.alpha;
    this.mesh.visible = this.alpha > 0.01;
  }

  private draw(text: string): void {
    const c = this.context;
    c.clearRect(0, 0, W, H);
    let size = 54;
    do {
      c.font = `600 ${size}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
      size -= 2;
    } while (c.measureText(text).width > W - 110 && size > 28);
    const w = Math.min(W - 8, c.measureText(text).width + 76);
    c.fillStyle = 'rgba(24, 16, 10, 0.62)';
    roundRect(c, (W - w) / 2, 12, w, H - 24, 50);
    c.fill();
    c.fillStyle = '#ffe9c7';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(text, W / 2, H / 2 + 2);
    this.texture.needsUpdate = true;
  }
}
```

**File: `src/render/GhostHand.ts`**
```ts
import {
  AdditiveBlending,
  Color,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
} from '@iwsdk/core';
import { BONES, JOINT_COUNT } from '../core/joints.js';
import type { CreatureDef } from '../core/library.js';
import { buildJointSet, createJointSet, mirrorJointSet, orientJointSet } from '../core/poses.js';
import type { Stage } from '../core/stage.js';
import type { Vec3 } from '../core/vec.js';

/** A soft glowing 3D hand near the player's hands that demonstrates the visitor's shape. */
export class GhostHand {
  readonly group = new Group();
  private readonly material = new MeshBasicMaterial({
    color: new Color(1, 0.82, 0.55),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  private readonly joints = new InstancedMesh(new SphereGeometry(1, 12, 8), this.material, JOINT_COUNT);
  private readonly bones = new InstancedMesh(new CylinderGeometry(1, 1, 1, 10, 1, true), this.material, BONES.length);
  private readonly pose = createJointSet();
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly a = new Vector3();
  private readonly b = new Vector3();
  private readonly mid = new Vector3();
  private readonly dir = new Vector3();
  private readonly size = new Vector3();
  private readonly up = new Vector3(0, 1, 0);
  private species: string | null = null;
  private wanted = false;
  private alpha = 0;
  private time = 0;

  constructor() {
    this.joints.frustumCulled = false;
    this.bones.frustumCulled = false;
    this.group.add(this.joints, this.bones);
    this.group.visible = false;
  }

  /** Demonstrates `def` with the right hand (or the left), a little to the left of the comfortable hand point. */
  show(def: CreatureDef, stage: Stage, left: boolean): void {
    this.wanted = true;
    const key = `${def.id}:${left ? 'L' : 'R'}`;
    if (key === this.species) return;
    this.species = key;
    const toWorld = (c: Vec3): Vec3 => {
      const x = left ? c[0] : -c[0];
      return [
        stage.u[0] * x + stage.v[0] * c[1] + stage.n[0] * c[2],
        stage.u[1] * x + stage.v[1] * c[1] + stage.n[1] * c[2],
        stage.u[2] * x + stage.v[2] * c[1] + stage.n[2] * c[2],
      ];
    };
    const anchor: Vec3 = [stage.hand[0] - stage.u[0] * 0.16, stage.hand[1] + 0.06, stage.hand[2] - stage.u[2] * 0.16];
    const base = buildJointSet(def.angles);
    const hand = left ? base : mirrorJointSet(base);
    orientJointSet(hand, left ? 'left' : 'right', { fingers: toWorld(def.facing.fingers), palm: toWorld(def.facing.palm) }, anchor, this.pose);
    this.layout();
  }

  hide(): void {
    this.wanted = false;
  }

  update(dt: number): void {
    this.time += dt;
    this.alpha = this.wanted ? Math.min(1, this.alpha + dt * 2.5) : Math.max(0, this.alpha - dt * 3);
    this.material.opacity = 0.32 * this.alpha * (0.85 + 0.15 * Math.sin(this.time * 3));
    this.group.position.y = 0.008 * Math.sin(this.time * 1.6);
    this.group.visible = this.alpha > 0.01;
    if (!this.wanted && this.alpha === 0) this.species = null;
  }

  private layout(): void {
    const p = this.pose.pos;
    const r = this.pose.rad;
    for (let i = 0; i < JOINT_COUNT; i++) {
      const radius = Math.max(0.006, r[i]) * 1.05;
      this.m.makeScale(radius, radius, radius).setPosition(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
      this.joints.setMatrixAt(i, this.m);
    }
    for (let k = 0; k < BONES.length; k++) {
      const bone = BONES[k];
      this.a.set(p[bone.a * 3], p[bone.a * 3 + 1], p[bone.a * 3 + 2]);
      this.b.set(p[bone.b * 3], p[bone.b * 3 + 1], p[bone.b * 3 + 2]);
      this.dir.subVectors(this.b, this.a);
      const length = Math.max(1e-4, this.dir.length());
      this.dir.multiplyScalar(1 / length);
      const radius = bone.radius ?? Math.max(0.006, (r[bone.a] + r[bone.b]) / 2);
      this.q.setFromUnitVectors(this.up, this.dir);
      this.mid.addVectors(this.a, this.b).multiplyScalar(0.5);
      this.size.set(radius, length, radius);
      this.m.compose(this.mid, this.q, this.size);
      this.bones.setMatrixAt(k, this.m);
    }
    this.joints.instanceMatrix.needsUpdate = true;
    this.bones.instanceMatrix.needsUpdate = true;
  }
}
```

Edit `src/render/ShadowCanvas.ts`: after the `setFade` method, add:
```ts

  /** Lantern brightness (0.24 by default; a longer streak glows warmer). */
  setLight(value: number): void {
    this.compositeMaterial.uniforms.uLight.value = value;
  }
```

Edit `src/runtime/store.ts`:
- Add `import type { Session } from '../game/Session.js';`.
- Inside `store`, after `canvas: null as ShadowCanvas | null,`, add `/** The running game session (menu and audio read settings from it). */` and `session: null as Session | null,`.

- [ ] **Step 2: Rewire the game system**

**File: `src/systems/GameSystem.ts#2b`**
```ts
import { createSystem } from '@iwsdk/core';
import { blendCapsules, placeCapsules, placePoint, rotateCapsules, rotatePoint, type Point } from '../core/animate.js';
import type { Creature, Pool } from '../core/creature.js';
import { BONES } from '../core/joints.js';
import { buildCreatureShapes } from '../core/library.js';
import { HEART } from '../core/particles.js';
import { CAPSULE_STRIDE, ShadowProjector } from '../core/projector.js';
import { mulberry32 } from '../core/rng.js';
import type { StoragePort } from '../core/save.js';
import { Silhouettes } from '../core/silhouette.js';
import type { Stage } from '../core/stage.js';
import { createHandShadow, updateHandShadow, type HandShadow } from '../game/hands.js';
import type { Worn } from '../game/Puppeteer.js';
import { Session } from '../game/Session.js';
import { Caption } from '../render/Caption.js';
import { GhostHand } from '../render/GhostHand.js';
import { CH_GLOW, CH_SHADOW, CH_TARGET, type ShadowCanvas } from '../render/ShadowCanvas.js';
import { store } from '../runtime/store.js';

function browserStorage(): StoragePort | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Projects the hands, runs the session and draws everything: shadows, visitors, zoo, embers, caption, ghost. */
export class GameSystem extends createSystem({}) {
  private readonly sil = new Silhouettes();
  private readonly shapes = buildCreatureShapes(this.sil);
  private readonly projector = new ShadowProjector();
  private readonly hands: readonly HandShadow[] = [createHandShadow('left'), createHandShadow('right')];
  private readonly session = new Session(this.shapes, this.sil, browserStorage(), new Date(), mulberry32(Date.now() >>> 0));
  private readonly caption = new Caption();
  private readonly ghost = new GhostHand();
  private readonly blendBuf = new Float32Array(BONES.length * CAPSULE_STRIDE);
  private readonly drawBuf = new Float32Array(BONES.length * CAPSULE_STRIDE);
  private readonly point: Point = { x: 0, y: 0 };
  private pool: Pool = { u: 1, v: 1 };
  private stageVersion = -1;
  private time = 0;
  private magnification = 3;

  init(): void {
    this.world.createTransformEntity(this.caption.mesh);
    this.world.createTransformEntity(this.ghost.group);
    store.session = this.session;
  }

  update(delta: number): void {
    const canvas = store.canvas;
    const stage = store.stage;
    if (!canvas || !stage) {
      this.caption.show(null);
      this.caption.update(delta);
      this.ghost.hide();
      this.ghost.update(delta);
      return;
    }
    if (this.stageVersion !== store.stageVersion) this.onStage(stage, canvas);
    this.time += delta;
    this.projector.setup(stage.lantern, stage);
    for (const hand of this.hands) {
      const sample = store.hands[hand.side];
      updateHandShadow(hand, sample.tracked ? sample.joints : null, this.projector, delta);
    }
    const view = this.session.update(delta, this.hands, this.projector, this.pool, store.events);
    this.caption.show(view.caption);
    this.caption.update(delta);
    if (view.ghost) this.ghost.show(this.shapes.get(view.ghost)!.def, stage, this.session.settings.hand === 'left');
    else this.ghost.hide();
    this.ghost.update(delta);
    canvas.begin();
    this.drawHands(canvas, view.worn);
    this.drawVisitor(canvas);
    this.drawZoo(canvas, stage);
    this.drawEmbers(canvas, stage);
    canvas.end();
  }

  private onStage(stage: Stage, canvas: ShadowCanvas): void {
    this.stageVersion = store.stageVersion;
    const toLantern = Math.hypot(stage.lantern[0] - stage.origin[0], stage.lantern[1] - stage.origin[1], stage.lantern[2] - stage.origin[2]);
    const toHand = Math.hypot(stage.lantern[0] - stage.hand[0], stage.lantern[1] - stage.hand[1], stage.lantern[2] - stage.hand[2]);
    this.magnification = toLantern / toHand;
    this.pool = { u: stage.poolU, v: stage.poolV };
    this.session.onStage(this.pool, this.magnification);
    this.caption.place(stage);
    canvas.setLight(0.24 + 0.015 * Math.min(8, this.session.saves.data.streak));
  }

  private drawHands(canvas: ShadowCanvas, worn: Worn | null): void {
    for (const hand of this.hands) if (hand.tracked) canvas.addCapsules(hand.caps, 0, hand.drawCount, CH_SHADOW, 1);
    if (worn) canvas.addDot(worn.eyeX, worn.eyeY, 0.004 * this.magnification, CH_GLOW, 1);
  }

  private drawVisitor(canvas: ShadowCanvas): void {
    const visitors = this.session.visitors;
    const visitor = visitors.current;
    if (!visitor) return;
    const pulse = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(this.time * 2.6)) * (0.6 + 0.4 * visitors.matcher.progress());
    const { cx, cy } = visitor.target.frame;
    const scale = this.magnification * (visitors.options.minSize ? 1.3 : 1);
    placeCapsules(visitor.caps, visitor.count, cx, cy, 0, 0, scale, 1, this.drawBuf);
    canvas.addCapsules(this.drawBuf, 0, visitor.count, CH_TARGET, pulse);
  }

  private drawZoo(canvas: ShadowCanvas, stage: Stage): void {
    const zoo = this.session.zoo;
    for (const creature of zoo.creatures) this.drawCreature(canvas, creature, stage);
    const m = this.magnification;
    for (const f of zoo.fireflies.list) {
      const flicker = 0.65 + 0.35 * Math.sin(f.age * 9 + f.seed);
      canvas.addDot(f.x, f.y, 0.0034 * m, CH_GLOW, flicker);
      canvas.addDot(f.x, f.y, 0.009 * m, CH_GLOW, 0.18 * flicker);
    }
    const p = zoo.particles;
    for (let i = 0; i < p.count; i++) {
      const k = p.life[i] / p.max[i];
      if (p.kind[i] === HEART) this.drawHeart(canvas, p.x[i], p.y[i], 0.006 * m, k);
      else canvas.addDot(p.x[i], p.y[i], (0.0006 + 0.0024 * k) * m, CH_GLOW, k);
    }
  }

  private drawCreature(canvas: ShadowCanvas, c: Creature, stage: Stage): void {
    const shape = this.shapes.get(c.species)!;
    const { cx, cy } = shape.target.frame;
    const y = c.y + c.lift;
    const scale = c.scale * c.bounce;
    const spin = this.session.settings.reducedMotion ? 0 : -c.facing * c.spin;
    blendCapsules(shape.caps, shape.actCaps, c.act, shape.count, this.blendBuf);
    placeCapsules(this.blendBuf, shape.count, cx, cy, c.x, y, scale, c.facing, this.drawBuf);
    if (spin !== 0) rotateCapsules(this.drawBuf, shape.count, spin, c.x, y);
    canvas.addCapsules(this.drawBuf, 0, shape.count, CH_SHADOW, 1);
    if (c.motion === 'dangle') {
      const top = stage.poolV * Math.sqrt(Math.max(0, 1 - (c.x / stage.poolU) ** 2));
      const thread = 0.0007 * this.magnification;
      canvas.addCapsule(c.x, y + c.size * 0.35, thread, c.x, top, thread, CH_SHADOW, 0.85);
    }
    if (c.eyeOpen > 0) {
      placePoint(shape.eye[0], shape.eye[1], cx, cy, c.x, y, scale, c.facing, this.point);
      if (spin !== 0) rotatePoint(this.point, spin, c.x, y);
      canvas.addDot(this.point.x, this.point.y, 0.026 * c.size, CH_GLOW, 1);
    }
  }

  /** Embers earned from daily visitors glow along the top of the lantern's pool. */
  private drawEmbers(canvas: ShadowCanvas, stage: Stage): void {
    const n = Math.min(12, this.session.saves.data.embers);
    for (let i = 0; i < n; i++) {
      const theta = Math.PI / 2 + (i - (n - 1) / 2) * 0.13;
      const x = Math.cos(theta) * stage.poolU * 0.9;
      const y = Math.sin(theta) * stage.poolV * 0.9;
      canvas.addDot(x, y, 0.0028 * this.magnification, CH_GLOW, 0.75 + 0.25 * Math.sin(this.time * 2 + i));
    }
  }

  /** Two tapered capsules from round lobes to a point make a small heart. */
  private drawHeart(canvas: ShadowCanvas, x: number, y: number, r: number, alpha: number): void {
    canvas.addCapsule(x - r * 0.5, y + r * 0.35, r * 0.42, x, y - r * 0.55, r * 0.2, CH_GLOW, alpha);
    canvas.addCapsule(x + r * 0.5, y + r * 0.35, r * 0.42, x, y - r * 0.55, r * 0.2, CH_GLOW, alpha);
  }
}
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npm test && npm run build`
Expected: no errors; all tests pass; `✓ built in`.

- [ ] **Step 4: Commit**

```bash
git add src/render src/runtime/store.ts src/systems/GameSystem.ts
git commit -m "feat: captions, ghost hand, tricks and embers drawn from the session"
```

---

### Task 8: Emulator verification of the first-time flow

- [ ] **Step 1: Make it a first-time player**

Clear storage. In the managed browser, run trusted workspace code with `./node_modules/.bin/iwsdk browser run --help` (see the accepted parameters). If `run` isn't enabled, reload with a fresh profile by restarting the dev server, since the managed profile is temporary. Then reload, enter XR and switch to hand mode.

- [ ] **Step 2: Observe the first minute**

1. Capture a screenshot within about 3 s. Expected: the caption "Make a rabbit with your hand", a glowing ghost hand near the bottom-left of the view, and the rabbit outline.
2. Pose `peace` at the comfortable point. Expected: a reveal, then the caption "Pinch to give it a firefly". Capture it.
3. Use `point` and `xr select`. Expected: the caption becomes "Rest your shadow on it" after the rabbit eats.
4. Read the browser logs: no errors, and `[ShadowZoo] sound` lines for reveal, firefly and eat.

- [ ] **Step 3: Reload and confirm the zoo is restored**

Run `browser reload` and enter XR. Expected: the rabbit is already present (restored) and there is no "Make a rabbit" onboarding. Same day, so no welcome-back. Capture it.

- [ ] **Step 4: Record and commit**

Write `docs/checkpoint-phase2b1.md` with the observations and screenshot paths, then:
```bash
git add docs
git commit -m "docs: record Phase 2B-1 emulator verification"
```

---

## Self-review notes

- **Spec coverage:**
  - §2.1 first minute: captions, ghost hand, rabbit, feed, pet (Tasks 5–7).
  - §2.3 progress: play gates, stars, tricks at 3 hearts (Tasks 3 and 5).
  - §2.4 daily visitor with twist, embers, streak-warmed lantern, welcome back, restored zoo (Tasks 2, 5–7).
  - §2.5 reduced motion (Tasks 3 and 6); hand preference used by the session (Task 6).
  - §3.6 storage robustness (Task 1).
- **Phase 2B-2, next:** the menu and settings UI (assist, hand, sound, reduced motion, narrow view, Re-light, reset with confirmation), and AudioSystem honoring `sound`.
- **Type consistency:**
  - `Zoo.add(revealed, events, options?)` is used by `Session`.
  - `Visitors.enqueue(species, options?)`, `busy`, `elapsed`, `lastElapsed`, `options` and `setTuning` are used by `Session` and `GameSystem`.
  - `Session.saves`, `settings`, `visitors` and `zoo` are used by `GameSystem`.
  - `store.session` is typed through a type-only import.
