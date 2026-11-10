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
