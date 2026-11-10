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
    this.mesh.renderOrder = -9;
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
