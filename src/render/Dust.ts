import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, Points, ShaderMaterial } from '@iwsdk/core';
import { mulberry32 } from '../core/rng.js';
import type { Stage } from '../core/stage.js';

const COUNT = 64;

const VERTEX = /* glsl */ `
attribute float aSize;
attribute float aGlow;
uniform float uHalfHeight;
varying float vGlow;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  // aSize is meters: projected to pixels for this eye's view.
  gl_PointSize = clamp(aSize * projectionMatrix[1][1] * uHalfHeight / -mv.z, 1.5, 14.0);
  vGlow = aGlow;
  gl_Position = projectionMatrix * mv;
}`;

const FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uFade;
varying float vGlow;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float a = 1.0 - dot(c, c) * 4.0;
  if (a <= 0.0) discard;
  a = a * a * vGlow * uFade;
  // Additive blending multiplies by alpha itself: color is not premultiplied here.
  gl_FragColor = vec4(uColor, a);
}`;

/** One mote, in beam coordinates: `s` from the lantern (0) to the wall (1), `a` and `b` across the beam (-1 to 1). */
interface Mote {
  s: number;
  a: number;
  b: number;
  da: number;
  db: number;
  phase: number;
  rate: number;
  glow: number;
}

/**
 * Dust drifting in the lantern's beam, between the player's hands and the wall: warm specks that
 * catch the light and twinkle, brightest at the beam's center. One additive point draw.
 */
export class Dust {
  readonly points: Points;
  private readonly positions = new Float32Array(COUNT * 3);
  private readonly glow = new Float32Array(COUNT);
  private readonly motes: Mote[] = [];
  private readonly material: ShaderMaterial;
  private readonly rng = mulberry32(7);
  private stage: Stage | null = null;
  private time = 0;

  constructor() {
    const sizes = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) {
      this.motes.push(this.spawn(this.rng() * 0.7 + 0.25));
      sizes[i] = 0.007 + this.rng() * 0.009;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(this.positions, 3));
    geometry.setAttribute('aSize', new BufferAttribute(sizes, 1));
    geometry.setAttribute('aGlow', new BufferAttribute(this.glow, 1));
    this.material = new ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: { uColor: { value: new Color(1.0, 0.84, 0.6) }, uFade: { value: 0 }, uHalfHeight: { value: 900 } },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.points = new Points(geometry, this.material);
    this.points.frustumCulled = false;
    this.points.visible = false;
  }

  configure(stage: Stage): void {
    this.stage = stage;
    this.points.visible = true;
  }

  hide(): void {
    this.stage = null;
    this.points.visible = false;
  }

  /** Drifts the motes; `calm` (reduced motion) slows them; `halfHeight` is the view's half height in pixels. */
  update(delta: number, fade: number, brightness: number, calm: boolean, halfHeight: number): void {
    const stage = this.stage;
    if (!stage) return;
    this.time += delta;
    const speed = calm ? 0.2 : 1;
    const { lantern, origin, u, v, poolU, poolV } = stage;
    for (let i = 0; i < COUNT; i++) {
      const m = this.motes[i];
      // A slow wander with a gentle rise, like dust in warm air.
      m.da += (this.rng() - 0.5) * 0.06 * delta;
      m.db += (this.rng() - 0.5) * 0.06 * delta + 0.004 * delta;
      m.da *= 1 - 0.4 * delta;
      m.db *= 1 - 0.4 * delta;
      m.a += m.da * speed * delta;
      m.b += m.db * speed * delta;
      if (m.a * m.a + m.b * m.b > 1) this.motes[i] = this.spawn(m.s);
      const n = this.motes[i];
      const k = n.s;
      for (let j = 0; j < 3; j++) {
        this.positions[i * 3 + j] = lantern[j] + (origin[j] - lantern[j]) * k + (u[j] * n.a * poolU + v[j] * n.b * poolV) * k;
      }
      const twinkle = calm ? 0.8 : 0.55 + 0.45 * Math.sin(this.time * n.rate + n.phase);
      this.glow[i] = n.glow * twinkle * (1 - (n.a * n.a + n.b * n.b)) * brightness;
    }
    (this.points.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
    (this.points.geometry.getAttribute('aGlow') as BufferAttribute).needsUpdate = true;
    this.material.uniforms.uFade.value = fade;
    this.material.uniforms.uHalfHeight.value = halfHeight;
  }

  private spawn(s: number): Mote {
    const r = Math.sqrt(this.rng()) * 0.9;
    const angle = this.rng() * Math.PI * 2;
    return {
      s,
      a: Math.cos(angle) * r,
      b: Math.sin(angle) * r,
      da: 0,
      db: 0,
      phase: this.rng() * Math.PI * 2,
      rate: 0.8 + this.rng() * 2.2,
      glow: 0.3 + this.rng() * 0.5,
    };
  }
}
