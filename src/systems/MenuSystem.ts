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
