import { createSystem } from '@iwsdk/core';
import { createFlicker, lanternFlicker } from '../core/lantern.js';
import { Dust } from '../render/Dust.js';
import { ShadowCanvas } from '../render/ShadowCanvas.js';
import { store } from '../runtime/store.js';

/** Owns the shadow canvas and the dust in the lantern's beam; renders the mask once per frame. */
export class RenderSystem extends createSystem({}) {
  private canvas!: ShadowCanvas;
  private dust!: Dust;
  private version = -1;
  private fade = 0;
  private time = 0;
  private readonly flicker = createFlicker();

  init(): void {
    this.canvas = new ShadowCanvas();
    this.world.createTransformEntity(this.canvas.composite);
    this.canvas.composite.visible = false;
    store.canvas = this.canvas;
    this.dust = new Dust();
    this.world.createTransformEntity(this.dust.points);
  }

  update(delta: number): void {
    const stage = store.stage;
    if (!stage) {
      this.canvas.composite.visible = false;
      this.dust.hide();
      this.version = -1;
      this.fade = 0;
      return;
    }
    if (this.version !== store.stageVersion) {
      this.canvas.configure(stage);
      this.canvas.composite.visible = true;
      this.dust.configure(stage);
      this.version = store.stageVersion;
      this.fade = 0;
    }
    this.fade = Math.min(1, this.fade + delta / 1.2);
    this.canvas.setFade(this.fade);
    this.time += delta;
    const calm = store.session?.settings.reducedMotion ?? false;
    const f = lanternFlicker(this.time, calm, this.flicker);
    this.canvas.setFlicker(f.brightness, f.swayX, f.swayY);
    this.dust.update(delta, this.fade, f.brightness, calm, this.viewHalfHeight());
    this.canvas.render(this.renderer);
  }

  /** Half the height, in pixels, of the view being rendered (one eye's in XR). */
  private viewHalfHeight(): number {
    if (this.renderer.xr.isPresenting) {
      const viewport = this.renderer.xr.getCamera().cameras[0]?.viewport;
      if (viewport && viewport.w > 0) return viewport.w / 2;
    }
    return this.renderer.domElement.height / 2;
  }
}
