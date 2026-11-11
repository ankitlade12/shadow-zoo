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
varying float vSoft;
void main() {
  // aChan.w: this capsule's own soft edge (meters), on top of the base feather.
  vSoft = uFeather + aChan.w;
  float r = max(aA.z, aB.z) + vSoft;
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
varying vec2 vP;
varying vec3 vA;
varying vec3 vB;
varying vec4 vChan;
varying float vSoft;
void main() {
  vec2 e = vB.xy - vA.xy;
  vec2 q = vP - vA.xy;
  float h = clamp(dot(q, e) / max(dot(e, e), 1e-10), 0.0, 1.0);
  float d = length(q - e * h) - mix(vA.z, vB.z, h);
  float c = 1.0 - smoothstep(-vSoft, vSoft, d);
  if (c <= 0.0) discard;
  gl_FragColor = vec4(vChan.rgb * c, 0.0);
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
uniform float uFlicker;
uniform vec2 uSway;
varying vec2 vS;
void main() {
  vec4 m = texture2D(uMask, vS / (2.0 * uHalf) + 0.5);
  // Shadows sway a few millimeters with the flame; outlines and glints stay put.
  float sh = texture2D(uMask, (vS - uSway) / (2.0 * uHalf) + 0.5).r;
  float e = length(vS / uPool);
  float pool = 1.0 - smoothstep(0.78, 1.0, e);
  // Brightest at the center, falling off toward a deeper amber edge, breathing with the flame.
  float lit = pool * (0.72 + 0.28 * (1.0 - e * e) + 0.12 * exp(-e * e * 7.0)) * uFlicker;
  vec3 warm = mix(uWarm, uWarm * vec3(1.0, 0.8, 0.58), smoothstep(0.25, 1.0, e));
  float shadow = sh * pool;
  float target = m.b * pool * (1.0 - sh);
  float glow = m.g;
  vec3 color = warm * uLight * lit * (1.0 - sh)
    + vec3(0.016, 0.022, 0.04) * shadow * uShadow
    + vec3(1.0, 0.78, 0.42) * target * 0.55
    + vec3(1.0, 0.9, 0.65) * glow;
  float alpha = uLight * 0.55 * lit * (1.0 - sh) + shadow * uShadow + target * 0.3 + glow * 0.8;
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
        uFlicker: { value: 1 },
        uSway: { value: new Vector2(0, 0) },
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
    // Drawn before other transparent objects so spatial UI panels always land on top of the stage.
    this.composite.renderOrder = -10;
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

  /** Lantern brightness (0.24 by default; a longer streak glows warmer). */
  setLight(value: number): void {
    this.compositeMaterial.uniforms.uLight.value = value;
  }

  /** A golden lantern, once the whole zoo is found; the usual warm amber otherwise. */
  setGolden(golden: boolean): void {
    (this.compositeMaterial.uniforms.uWarm.value as Color).setRGB(1.0, golden ? 0.83 : 0.76, golden ? 0.38 : 0.48);
  }

  /** The flame's flicker: light-pool brightness (around 1) and shadow sway on the wall (meters). */
  setFlicker(brightness: number, swayX: number, swayY: number): void {
    this.compositeMaterial.uniforms.uFlicker.value = brightness;
    (this.compositeMaterial.uniforms.uSway.value as Vector2).set(swayX, swayY);
  }

  begin(): void {
    this.count = 0;
  }

  /** Adds one capsule. `soft` widens its edge (meters): shadows blur with distance from the wall. */
  addCapsule(ax: number, ay: number, ar: number, bx: number, by: number, br: number, channel: number, strength = 1, soft = 0): void {
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
    c[i * 4 + 3] = soft;
  }

  addCapsules(caps: Float32Array, start: number, count: number, channel: number, strength = 1, soft = 0): void {
    for (let i = 0; i < count; i++) {
      const o = (start + i) * CAPSULE_STRIDE;
      this.addCapsule(caps[o], caps[o + 1], caps[o + 2], caps[o + 3], caps[o + 4], caps[o + 5], channel, strength, soft);
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
