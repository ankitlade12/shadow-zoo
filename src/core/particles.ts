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
