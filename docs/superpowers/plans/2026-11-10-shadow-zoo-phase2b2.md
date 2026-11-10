# Shadow Zoo Phase 2B-2 (menu and settings) — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A hands-operable menu.
- A "Menu" chip sits on the wall at the bottom-left of the light pool.
- Pinching it opens a settings panel near the player with: assist level (Gentle, Normal, Expert), hand (Auto, Left, Right), sound (On, Off), motion (Full, Reduced), view (Wide, Narrow), Re-light the wall I face, Reset zoo (two-tap confirmation), and Close.
- Settings persist through the save and take effect immediately.
- Pinches aimed at the UI don't release fireflies.

**Architecture:** a pure `Settings` model with tests (cycling values, labels, the two-tap guard); two UIKitML panels registered as assets; a `MenuSystem` that instantiates, places and wires them. Small edits make `GameSystem`, `StageSystem` and `SoundSystem` honor the settings.

**Spec:** §2.5 (assist, hand, sound, reduced motion, narrow view, Re-light, reset with confirmation).

**IWSDK UI facts used:**
- Panels are single-sided and face +Z.
- UIKit units are centimeters.
- Copy uses ASCII punctuation only.
- Clicks need `RayInteractable` on the panel entity, and `Hovered` marks a hovered entity.
- `world.assets.instantiate<UIKitMLAsset>(id)` returns an `Object3D` for `createTransformEntity`.
- `requireElementById(id).addEventListener('click', fn)` wires a button, and `setProperties({ text })` relabels it.

---

### Task 1: Settings model

**Files:**
- Create: `src/game/Settings.ts`
- Test: `tests/game/settings.test.ts`

- [ ] **Step 1: Write the failing test**

**File: `tests/game/settings.test.ts`**
```ts
import { describe, expect, it } from 'vitest';
import { freshSave } from '../../src/core/save.js';
import { ConfirmGuard, cycleSetting, settingLabel } from '../../src/game/Settings.js';

describe('settings', () => {
  it('cycles every setting and labels it in plain ASCII', () => {
    const s = freshSave().settings;
    expect(settingLabel(s, 'assist')).toBe('Assist: Normal');
    cycleSetting(s, 'assist');
    expect(s.assist).toBe('expert');
    cycleSetting(s, 'assist');
    expect(settingLabel(s, 'assist')).toBe('Assist: Gentle');
    cycleSetting(s, 'hand');
    expect(settingLabel(s, 'hand')).toBe('Hand: Left');
    cycleSetting(s, 'sound');
    expect(settingLabel(s, 'sound')).toBe('Sound: Off');
    cycleSetting(s, 'motion');
    expect(settingLabel(s, 'motion')).toBe('Motion: Reduced');
    cycleSetting(s, 'view');
    expect(settingLabel(s, 'view')).toBe('View: Narrow');
    for (const key of ['assist', 'hand', 'sound', 'motion', 'view'] as const) expect(settingLabel(s, key)).toMatch(/^[\x20-\x7e]+$/);
  });

  it('confirms a destructive action only on a second tap within the window', () => {
    const g = new ConfirmGuard(4);
    expect(g.tap(10)).toBe('armed');
    expect(g.isArmed(13)).toBe(true);
    expect(g.tap(13)).toBe('confirmed');
    expect(g.isArmed(13.5)).toBe(false);
    expect(g.tap(20)).toBe('armed');
    expect(g.tap(30)).toBe('armed');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/game/settings.test.ts`
Expected: FAIL. The error says it can't resolve `../../src/game/Settings.js`.

- [ ] **Step 3: Implement**

**File: `src/game/Settings.ts`**
```ts
import type { AssistLevel } from '../core/matcher.js';
import type { HandPreference, Settings } from '../core/save.js';

export type SettingKey = 'assist' | 'hand' | 'sound' | 'motion' | 'view';

const ASSISTS: readonly AssistLevel[] = ['gentle', 'normal', 'expert'];
const HANDS: readonly HandPreference[] = ['auto', 'left', 'right'];
const next = <T>(list: readonly T[], value: T): T => list[(list.indexOf(value) + 1) % list.length];
const title = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);

/** Advances one setting to its next value. */
export function cycleSetting(s: Settings, key: SettingKey): void {
  switch (key) {
    case 'assist':
      s.assist = next(ASSISTS, s.assist);
      break;
    case 'hand':
      s.hand = next(HANDS, s.hand);
      break;
    case 'sound':
      s.sound = !s.sound;
      break;
    case 'motion':
      s.reducedMotion = !s.reducedMotion;
      break;
    case 'view':
      s.narrow = !s.narrow;
      break;
  }
}

/** The button label for one setting (plain ASCII for the UI font). */
export function settingLabel(s: Settings, key: SettingKey): string {
  switch (key) {
    case 'assist':
      return `Assist: ${title(s.assist)}`;
    case 'hand':
      return `Hand: ${title(s.hand)}`;
    case 'sound':
      return `Sound: ${s.sound ? 'On' : 'Off'}`;
    case 'motion':
      return `Motion: ${s.reducedMotion ? 'Reduced' : 'Full'}`;
    case 'view':
      return `View: ${s.narrow ? 'Narrow' : 'Wide'}`;
  }
}

/** Two taps within `window` seconds confirm a destructive action. */
export class ConfirmGuard {
  private armedAt = -Infinity;

  constructor(private readonly window = 4) {}

  isArmed(now: number): boolean {
    return now - this.armedAt <= this.window;
  }

  tap(now: number): 'armed' | 'confirmed' {
    if (this.isArmed(now)) {
      this.armedAt = -Infinity;
      return 'confirmed';
    }
    this.armedAt = now;
    return 'armed';
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/game/settings.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/game/Settings.ts tests/game/settings.test.ts
git commit -m "feat(game): add the settings model with labels and a two-tap guard"
```

---

### Task 2: Menu panels, menu system and settings wiring

**Files:**
- Create: `public/ui/menu.uikitml`, `public/ui/menu-chip.uikitml`, `src/systems/MenuSystem.ts`
- Modify: `src/assets.ts`, `src/runtime/store.ts`, `src/systems/GameSystem.ts`, `src/systems/StageSystem.ts`, `src/systems/SoundSystem.ts`, `src/index.ts`

- [ ] **Step 1: UIKitML panels**

**File: `public/ui/menu.uikitml`**
```html
<style>
  .menu {
    flex-direction: column;
    width: 440px;
  }

  .head {
    flex-direction: column;
    gap: 4px;
    padding-left: 24px;
    padding-right: 24px;
    padding-top: 22px;
    padding-bottom: 10px;
  }

  .title {
    color: #1c1d20;
    font-size: 30px;
    font-weight: 700;
  }

  .title:dark {
    color: #ffe9c7;
  }

  .sub {
    color: #3a3b40;
    font-size: 18px;
  }

  .sub:dark {
    color: #dccfb8;
  }

  .rows {
    flex-direction: column;
    gap: 10px;
    padding-left: 22px;
    padding-right: 22px;
    padding-bottom: 22px;
  }

  .row {
    justify-content: flex-start;
  }
</style>
<Panel class="menu">
  <div class="head">
    <div class="title">Shadow Zoo</div>
    <div class="sub">Pinch a button to change it</div>
  </div>
  <div class="rows">
    <Button id="assist" class="row"><ButtonLabel id="assist-label">Assist: Normal</ButtonLabel></Button>
    <Button id="hand" class="row"><ButtonLabel id="hand-label">Hand: Auto</ButtonLabel></Button>
    <Button id="sound" class="row"><ButtonLabel id="sound-label">Sound: On</ButtonLabel></Button>
    <Button id="motion" class="row"><ButtonLabel id="motion-label">Motion: Full</ButtonLabel></Button>
    <Button id="view" class="row"><ButtonLabel id="view-label">View: Wide</ButtonLabel></Button>
    <Button id="relight" class="row"><ButtonLabel id="relight-label">Re-light the wall I face</ButtonLabel></Button>
    <Button id="reset" class="row"><ButtonLabel id="reset-label">Reset zoo</ButtonLabel></Button>
    <Button id="close" class="row"><ButtonLabel id="close-label">Close</ButtonLabel></Button>
  </div>
</Panel>
```

**File: `public/ui/menu-chip.uikitml`**
```html
<style>
  .chip {
    flex-direction: row;
    padding-left: 8px;
    padding-right: 8px;
    padding-top: 8px;
    padding-bottom: 8px;
  }
</style>
<Panel class="chip">
  <Button id="open"><ButtonLabel id="open-label">Menu</ButtonLabel></Button>
</Panel>
```

**File: `src/assets.ts#2b2`**
```ts
import { AssetType, defineAssets } from '@iwsdk/core';

const ui = (fileName: string, name: string) => ({
  url: `${import.meta.env.BASE_URL}ui/${fileName}`,
  type: AssetType.UIKitML,
  name,
});

export default defineAssets({
  'menu-panel': ui('menu.uikitml', 'Settings Menu'),
  'menu-chip': ui('menu-chip.uikitml', 'Menu Chip'),
});
```

- [ ] **Step 2: Menu system**

**File: `src/systems/MenuSystem.ts`**
```ts
import { Box3, createSystem, Hovered, RayInteractable, Vector3, type Entity, type UIKitMLAsset } from '@iwsdk/core';
import type { Stage } from '../core/stage.js';
import { ConfirmGuard, cycleSetting, settingLabel, type SettingKey } from '../game/Settings.js';
import { store } from '../runtime/store.js';

const KEYS: readonly SettingKey[] = ['assist', 'hand', 'sound', 'motion', 'view'];
/** World width of the settings panel near the player (meters). */
const MENU_WIDTH = 0.36;
/** Chip width as a fraction of the wall distance (about 4 degrees). */
const CHIP_ANGLE = 0.07;

/** The wall "Menu" chip and the settings panel it opens near the player. */
export class MenuSystem extends createSystem({}) {
  private chip: UIKitMLAsset | null = null;
  private menu: UIKitMLAsset | null = null;
  private chipEntity: Entity | null = null;
  private menuEntity: Entity | null = null;
  private chipWidth = 1;
  private menuWidth = 1;
  private readonly guard = new ConfirmGuard(4);
  private readonly head = new Vector3();
  private readonly forward = new Vector3();
  private stageVersion = -1;
  private time = 0;
  private open = false;
  private resetArmed = false;

  init(): void {
    void this.build();
  }

  private async build(): Promise<void> {
    const chip = await this.world.assets.instantiate<UIKitMLAsset>('menu-chip');
    const menu = await this.world.assets.instantiate<UIKitMLAsset>('menu-panel');
    this.chipWidth = Math.max(0.01, new Box3().setFromObject(chip).getSize(new Vector3()).x);
    this.menuWidth = Math.max(0.01, new Box3().setFromObject(menu).getSize(new Vector3()).x);
    this.chipEntity = this.world.createTransformEntity(chip);
    this.chipEntity.addComponent(RayInteractable);
    this.menuEntity = this.world.createTransformEntity(menu);
    this.menuEntity.addComponent(RayInteractable);
    chip.visible = false;
    menu.visible = false;
    chip.requireElementById('open').addEventListener('click', () => this.setOpen(!this.open));
    for (const key of KEYS) menu.requireElementById(key).addEventListener('click', () => this.change(key));
    menu.requireElementById('relight').addEventListener('click', () => {
      store.relightRequested = true;
      this.setOpen(false);
    });
    menu.requireElementById('reset').addEventListener('click', () => this.reset());
    menu.requireElementById('close').addEventListener('click', () => this.setOpen(false));
    this.chip = chip;
    this.menu = menu;
    this.refreshLabels();
  }

  update(delta: number): void {
    this.time += delta;
    const stage = store.stage;
    const chip = this.chip;
    const menu = this.menu;
    if (!chip || !menu || !this.chipEntity || !this.menuEntity) return;
    if (!stage) {
      chip.visible = false;
      menu.visible = false;
      this.open = false;
      store.uiHovered = false;
      return;
    }
    if (this.stageVersion !== store.stageVersion) {
      this.stageVersion = store.stageVersion;
      this.placeChip(stage);
    }
    chip.visible = true;
    if (this.resetArmed && !this.guard.isArmed(this.time)) {
      this.resetArmed = false;
      this.label('reset-label', 'Reset zoo');
    }
    store.uiHovered = this.chipEntity.hasComponent(Hovered) || (this.open && this.menuEntity.hasComponent(Hovered));
  }

  private placeChip(stage: Stage): void {
    const chip = this.chip!;
    const x = -stage.poolU * 0.72;
    const y = -stage.poolV * 0.8;
    chip.position.set(
      stage.origin[0] + stage.u[0] * x + stage.v[0] * y + stage.n[0] * 0.02,
      stage.origin[1] + stage.u[1] * x + stage.v[1] * y + stage.n[1] * 0.02,
      stage.origin[2] + stage.u[2] * x + stage.v[2] * y + stage.n[2] * 0.02,
    );
    chip.rotation.set(0, Math.atan2(stage.n[0], stage.n[2]), 0);
    chip.scale.setScalar((CHIP_ANGLE * stage.distance) / this.chipWidth);
  }

  private setOpen(open: boolean): void {
    const menu = this.menu;
    if (!menu) return;
    this.open = open;
    menu.visible = open;
    if (!open) return;
    this.player.head.getWorldPosition(this.head);
    this.player.head.getWorldDirection(this.forward);
    this.forward.y = 0;
    if (this.forward.lengthSq() < 1e-6) this.forward.set(0, 0, -1);
    this.forward.normalize();
    // Object3D.getWorldDirection returns +Z; the head looks along -Z.
    this.forward.multiplyScalar(-1);
    menu.position.set(this.head.x + this.forward.x * 0.55, this.head.y - 0.18, this.head.z + this.forward.z * 0.55);
    menu.rotation.set(0, Math.atan2(this.head.x - menu.position.x, this.head.z - menu.position.z), 0);
    menu.scale.setScalar(MENU_WIDTH / this.menuWidth);
    this.refreshLabels();
  }

  private change(key: SettingKey): void {
    const session = store.session;
    if (!session) return;
    cycleSetting(session.settings, key);
    session.applySettings();
    if (key === 'view') {
      store.narrow = session.settings.narrow;
      store.relightRequested = true;
    }
    this.refreshLabels();
  }

  private reset(): void {
    if (this.guard.tap(this.time) === 'armed') {
      this.resetArmed = true;
      this.label('reset-label', 'Tap again to erase the zoo');
      return;
    }
    store.session?.saves.reset();
    globalThis.location?.reload();
  }

  private refreshLabels(): void {
    const session = store.session;
    if (!session) return;
    for (const key of KEYS) this.label(`${key}-label`, settingLabel(session.settings, key));
  }

  private label(id: string, text: string): void {
    this.menu?.requireElementById(id).setProperties({ text });
  }
}
```

- [ ] **Step 3: Honor the settings in the other systems**

1. Edit `src/runtime/store.ts`: after `relightRequested: false,`, add the line `uiHovered: false,`.
2. Edit `src/systems/GameSystem.ts`: after the `for (const hand of this.hands) { … updateHandShadow(…); }` loop, add:
```ts
    // A pinch aimed at the menu is a click, not a firefly.
    if (store.uiHovered) for (const hand of this.hands) hand.pinch = null;
```
3. Edit `src/systems/StageSystem.ts`: replace `store.stage = buildStage(head, wall, { narrow: store.narrow });` with `store.stage = buildStage(head, wall, { narrow: store.session?.settings.narrow ?? store.narrow });`.
4. Edit `src/systems/SoundSystem.ts`: in `update()`, after `const stage = store.stage;`, add `this.engine.setMuted(!(store.session?.settings.sound ?? true));`.
5. Edit `src/index.ts`: import `{ MenuSystem } from './systems/MenuSystem.js'` and register `.registerSystem(MenuSystem, { priority: 5 })` after `StageSystem`.

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm test && npm run build`
Expected: no errors; all tests pass; `✓ built in`.

If an import such as `Hovered`, `RayInteractable` or `Box3` is not exported by `@iwsdk/core`, the compiler names it. Use the closest documented export from the IWSDK API reference, for example `Pressed` or `Hovered`, then rerun.

- [ ] **Step 5: Commit**

```bash
git add public/ui src/assets.ts src/systems/MenuSystem.ts src/runtime/store.ts src/systems/GameSystem.ts src/systems/StageSystem.ts src/systems/SoundSystem.ts src/index.ts
git commit -m "feat: hands-operable menu with assist, hand, sound, motion, view, re-light and reset"
```

---

### Task 3: Emulator verification

- [ ] **Step 1: Confirm the panels are registered and render**

1. Run `./node_modules/.bin/iwsdk ui assets --raw` and confirm `menu-panel` and `menu-chip` are listed.
2. Render previews:
   - `./node_modules/.bin/iwsdk ui render-preview --input-json '{"assetId":"menu-panel","width":800,"height":900}' --output-file docs/evidence/p2b2-menu-preview.png`
   - the same for `menu-chip`.
3. Look at both images. The labels must be readable and the dark theme must look right.

- [ ] **Step 2: Open the menu with the hand in XR**

1. Enter XR in hand mode and take a screenshot. Expected: the "Menu" chip at the bottom-left of the light pool.
2. Run `xr list-targets`. If the chip's `open` button is listed, run `xr run-sequence` with a `press` step on it. Otherwise aim the right hand's ray at the chip with `xr look-at`/`set-transform` and use `xr select`.
3. Capture `docs/evidence/p2b2-menu-open.png`. Expected: the settings panel about 0.55 m in front of the player.
4. Press "Sound: On" and confirm it changes to "Sound: Off". Press Close.

- [ ] **Step 3: Record and commit**

Write `docs/checkpoint-phase2b2.md` with the observations (including any targeting limits of the emulator), then:
```bash
git add docs
git commit -m "docs: record Phase 2B-2 verification"
```
