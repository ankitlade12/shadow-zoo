import { placeCapsules, rotateCapsules } from '../core/animate.js';
import { Creature, groundY, type CreatureEvent, type Pool } from '../core/creature.js';
import { canonicalCapsules, canonicalJoints, canonicalPair, canonicalPairCapsules, CREATURES, creatureDef, type CreatureId } from '../core/library.js';
import { CAPSULE_STRIDE } from '../core/projector.js';
import { mulberry32 } from '../core/rng.js';
import { parseSave, SAVE_KEY, type SaveData } from '../core/save.js';
import { WeatherField } from '../core/weather.js';
import { GLOBE_DOTS, markerAt, PLACE_IDS, placeMarkers, placeOf, projectGlobe, yawFacing, type GlobeView, type Marker, type PlaceId, type Projected } from '../core/world.js';
import { STAMPABLE } from '../game/rewards.js';

/** Each zoo's wash on the night atlas; the chosen zoo's is the page's one accent. */
export const ZOO_WASH: Readonly<Record<PlaceId, string>> = {
  home: '#f2a65a',
  arctic: '#9cc9f0',
  sahara: '#e88a3a',
  amazon: '#6cc08e',
  outback: '#e0683f',
  moon: '#d3dbe9',
};

/** Each zoo's legend: its light and weather, and the rule its live demo plays out. */
export const ZOO_LEGEND: Readonly<Record<PlaceId, { readonly scene: string; readonly rule: string; readonly hint: string }>> = {
  home: {
    scene: 'Your own wall in warm lantern light.',
    rule: 'Toss a creature and it tumbles, bounces and lands dizzy.',
    hint: 'Tap the wall to toss the rabbit.',
  },
  arctic: { scene: 'Icy blue light and falling snow.', rule: 'On the ice, a thrown creature slides.', hint: 'Tap the wall to toss the rabbit.' },
  sahara: { scene: 'A deep orange glow and blowing sand.', rule: 'The wind carries everything east.', hint: 'Tap the wall to toss the rabbit.' },
  amazon: { scene: 'Green light and rain.', rule: 'Every pinch releases a swarm of fireflies.', hint: 'Tap the wall to release a swarm.' },
  outback: { scene: 'Red dusk.', rule: 'Everything bounces sky-high.', hint: 'Tap the wall to toss the rabbit.' },
  moon: { scene: 'Silver light and drifting dust.', rule: 'Low gravity: throw a creature and watch it float.', hint: 'Tap the wall to toss the rabbit.' },
};

/**
 * How the legend tosses its rabbit in each zoo to show off the zoo's rule, in the physics' own unit
 * (light-pool half-heights per second). The Sahara's toss goes into the wind, so the wind brings it back.
 */
const TOSS: Readonly<Record<PlaceId, { readonly vx: number; readonly vy: number; readonly upwind?: boolean }>> = {
  home: { vx: 1.1, vy: 3.2 },
  arctic: { vx: 1.3, vy: 2.2 },
  sahara: { vx: 0.5, vy: 3.3, upwind: true },
  amazon: { vx: 0.6, vy: 2.6 },
  outback: { vx: 0.8, vy: 3.4 },
  moon: { vx: 0.6, vy: 2.1 },
};

const TILT = 0.38;
/** The globe's slow turn while nobody has spun it (radians per second). */
const IDLE_SPIN = 0.09;
/** How quickly a flick's spin dies away (per second). */
const SPIN_DRAG = 1.8;
/** Land is drawn in this many brightness steps, one path each. */
const SHADES = 6;
/** Seconds the chosen zoo's leader line takes to reach its seal. */
const REVEAL_SECONDS = 0.6;

const reducedMotion = (): boolean => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const easeOut = (t: number): number => 1 - (1 - t) ** 3;
const isPlace = (value: string | undefined): value is PlaceId => !!value && (PLACE_IDS as readonly string[]).includes(value);
const isCreature = (value: string | undefined): value is CreatureId => !!value && CREATURES.some((c) => c.id === value);

/** The shortest turn from one angle to another (radians). */
export const shortestTurn = (from: number, to: number): number => Math.atan2(Math.sin(to - from), Math.cos(to - from));

/** The save in this browser, or null when there is none (or it can't be read). */
export function readSave(): SaveData | null {
  try {
    const text = globalThis.localStorage?.getItem(SAVE_KEY);
    return text ? parseSave(text) : null;
  } catch {
    return null;
  }
}

/** The passport's summary line for a save: stamps first, then creatures. */
export function passportSummary(save: SaveData | null): string {
  const stamps = save?.stamps.length ?? 0;
  const found = save?.unlocked.length ?? 0;
  if (stamps === 0 && found === 0) {
    return `Your passport is empty. ${STAMPABLE} stamps wait around the world: pick a zoo on the globe and light the lantern to earn your first.`;
  }
  const passport = stamps === 0 ? 'No stamps yet' : stamps === STAMPABLE ? `All ${STAMPABLE} stamps collected` : `${stamps} of ${STAMPABLE} stamps collected`;
  const zoo = found === 0 ? 'no creatures found yet' : `${found} of ${CREATURES.length} creatures found`;
  return `${passport}, ${zoo}.`;
}

/** What a zoo's legend says about its passport stamp. */
export function stampLine(id: PlaceId, save: SaveData | null): string {
  if (id === 'home') return 'No stamp here: home is where every trip begins.';
  return save?.stamps.includes(id) ? 'Stamped in your passport.' : 'Your first visit earns a passport stamp.';
}

interface Silhouette {
  readonly caps: Float32Array;
  readonly count: number;
  readonly cx: number;
  readonly cy: number;
  readonly w: number;
  readonly h: number;
}

/** A creature's canonical hand-shadow capsules (the bird takes both hands) and their bounds. */
function silhouette(id: CreatureId): Silhouette {
  const def = creatureDef(id);
  const { caps, count } = def.pair ? canonicalPairCapsules(canonicalPair(def)) : canonicalCapsules(canonicalJoints(def));
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < count; i++) {
    for (const end of [i * CAPSULE_STRIDE, i * CAPSULE_STRIDE + 3]) {
      const r = caps[end + 2];
      x0 = Math.min(x0, caps[end] - r);
      x1 = Math.max(x1, caps[end] + r);
      y0 = Math.min(y0, caps[end + 1] - r);
      y1 = Math.max(y1, caps[end + 1] + r);
    }
  }
  return { caps, count, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Draws a creature's hand shadow into an SVG: one round-capped stroke per bone. */
function drawSilhouette(svg: SVGSVGElement, id: CreatureId): void {
  const s = silhouette(id);
  const pad = 0.03 * Math.max(s.w, s.h);
  const f = (v: number): string => v.toFixed(4);
  svg.setAttribute('viewBox', `${f(s.cx - s.w / 2 - pad)} ${f(-s.cy - s.h / 2 - pad)} ${f(s.w + 2 * pad)} ${f(s.h + 2 * pad)}`);
  const lines: SVGLineElement[] = [];
  for (let i = 0; i < s.count; i++) {
    const o = i * CAPSULE_STRIDE;
    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('x1', f(s.caps[o]));
    line.setAttribute('y1', f(-s.caps[o + 1]));
    line.setAttribute('x2', f(s.caps[o + 3]));
    line.setAttribute('y2', f(-s.caps[o + 4]));
    line.setAttribute('stroke-width', f(s.caps[o + 2] + s.caps[o + 5]));
    lines.push(line);
  }
  svg.replaceChildren(...lines);
}

/** Sizes a canvas's backing store to its box and device pixels; returns its size in CSS pixels. */
function fitCanvas(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D | null): { w: number; h: number } {
  const box = canvas.getBoundingClientRect();
  const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
  canvas.width = Math.max(1, Math.round(box.width * dpr));
  canvas.height = Math.max(1, Math.round(box.height * dpr));
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { w: box.width, h: box.height };
}

/**
 * The night atlas's globe: land engraved in gold dots on indigo, the graticule, a seal in each zoo's wash,
 * home's lantern and the Moon beside it. Drag spins it with inertia. Choosing a zoo turns the globe to it,
 * dims the rest, and draws a leader line from its cartouche to its seal. Where it sits on the canvas comes
 * from CSS (--gx, --gy, --gr, --leaders), so the layout owns it at every width.
 */
class AtlasGlobe {
  yaw = yawFacing(15);
  /** The zoo under the pointer, on the globe or on its cartouche. */
  hover: PlaceId | null = null;
  private chosen: PlaceId = 'home';
  /** It turns by itself until the visitor spins it. */
  private idle = true;
  private spin = 0;
  private target: number | null = null;
  private dragging = false;
  private lastX = 0;
  private lastT = 0;
  private time = 0;
  /** 0 to 1 while the chosen zoo's leader line draws in. */
  private reveal = 1;
  private w = 0;
  private h = 0;
  private gx = 0.5;
  private gy = 0.5;
  private gr = 0.34;
  private leaders = false;
  private readonly markers: Marker[] = [];
  private readonly p: Projected = { x: 0, y: 0, depth: 0 };
  /** Projected land dots this frame: x, y, depth. */
  private readonly dots = new Float32Array(GLOBE_DOTS.length * 3);
  private readonly ctx: CanvasRenderingContext2D | null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly cartouche: (id: PlaceId) => Element | null,
    private readonly onPick: (id: PlaceId) => void,
  ) {
    this.ctx = canvas.getContext('2d');
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.move(e));
    canvas.addEventListener('pointerup', (e) => this.up(e));
    canvas.addEventListener('pointercancel', () => (this.dragging = false));
    canvas.addEventListener('pointerleave', () => {
      if (!this.dragging) this.hover = null;
    });
  }

  resize(): void {
    ({ w: this.w, h: this.h } = fitCanvas(this.canvas, this.ctx));
    const style = getComputedStyle(this.canvas);
    const read = (name: string, fallback: number): number => {
      const v = parseFloat(style.getPropertyValue(name));
      return Number.isFinite(v) ? v : fallback;
    };
    this.gx = read('--gx', 0.5);
    this.gy = read('--gy', 0.5);
    this.gr = read('--gr', 0.34);
    this.leaders = read('--leaders', 0) > 0;
  }

  /** The globe on the canvas, y up (as the shared globe math expects). */
  view(): GlobeView {
    return { cx: this.gx * this.w, cy: (1 - this.gy) * this.h, r: this.gr * this.w, yaw: this.yaw, tilt: TILT };
  }

  choose(id: PlaceId, instant: boolean): void {
    this.chosen = id;
    this.spin = 0;
    const still = instant || reducedMotion();
    this.reveal = still ? 1 : 0;
    const at = placeOf(id).at;
    if (!at) {
      this.target = null;
      return;
    }
    const goal = yawFacing(at.lon);
    if (still) {
      this.yaw = goal;
      this.target = null;
    } else this.target = this.yaw + shortestTurn(this.yaw, goal);
  }

  private local(e: PointerEvent): [number, number] {
    const box = this.canvas.getBoundingClientRect();
    return [e.clientX - box.left, e.clientY - box.top];
  }

  private pick(x: number, y: number): PlaceId | null {
    const view = this.view();
    return markerAt(placeMarkers(view, this.time, this.markers), x, this.h - y, view.r * 0.16);
  }

  private down(e: PointerEvent): void {
    const [x, y] = this.local(e);
    const hit = this.pick(x, y);
    if (hit) {
      this.onPick(hit);
      return;
    }
    this.dragging = true;
    this.idle = false;
    this.target = null;
    this.spin = 0;
    this.lastX = x;
    this.lastT = e.timeStamp;
    this.canvas.setPointerCapture(e.pointerId);
    this.canvas.dataset.dragging = 'true';
  }

  private move(e: PointerEvent): void {
    const [x, y] = this.local(e);
    if (!this.dragging) {
      this.hover = this.pick(x, y);
      this.canvas.dataset.over = this.hover ? 'zoo' : 'globe';
      return;
    }
    // The surface follows the pointer: one radius of drag turns the globe one radian.
    const turn = -(x - this.lastX) / this.view().r;
    this.yaw += turn;
    const dt = Math.max(0.008, (e.timeStamp - this.lastT) / 1000);
    this.spin += (turn / dt - this.spin) * 0.5;
    this.lastX = x;
    this.lastT = e.timeStamp;
  }

  private up(e: PointerEvent): void {
    if (!this.dragging) return;
    this.dragging = false;
    delete this.canvas.dataset.dragging;
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    if (reducedMotion()) this.spin = 0;
  }

  update(dt: number): void {
    this.time += dt;
    if (this.reveal < 1) this.reveal = Math.min(1, this.reveal + dt / REVEAL_SECONDS);
    if (this.dragging) return;
    if (this.target !== null) {
      // Turn to the chosen zoo, easing out.
      this.yaw += (this.target - this.yaw) * Math.min(1, dt * 5);
      if (Math.abs(this.target - this.yaw) < 0.001) {
        this.yaw = this.target;
        this.target = null;
      }
      return;
    }
    if (reducedMotion()) {
      this.spin = 0;
      return;
    }
    this.spin *= Math.exp(-SPIN_DRAG * dt);
    // Before anyone spins it, it turns slowly, unless a zoo on it is chosen or the pointer is on a zoo.
    const drift = this.idle && !placeOf(this.chosen).at && !this.hover ? IDLE_SPIN : 0;
    this.yaw += (this.spin - drift) * dt;
  }

  draw(): void {
    const ctx = this.ctx;
    if (!ctx || this.w === 0) return;
    const { w, h } = this;
    ctx.clearRect(0, 0, w, h);
    const view = this.view();
    const { cx, r } = view;
    const cy = h - view.cy;
    // The sphere: deep indigo, lit from the lantern's side.
    const sea = ctx.createRadialGradient(cx - r * 0.38, cy - r * 0.42, r * 0.08, cx, cy, r);
    sea.addColorStop(0, '#2b4479');
    sea.addColorStop(0.7, '#162649');
    sea.addColorStop(1, '#0e1832');
    ctx.fillStyle = sea;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    // The graticule: meridians and parallels every 30 degrees, near side only.
    ctx.strokeStyle = 'rgba(201,162,74,0.3)';
    ctx.lineWidth = 0.8;
    for (let lon = -180; lon < 180; lon += 30) this.curve(ctx, view, (t) => [-84 + 168 * t, lon]);
    for (let lat = -60; lat <= 60; lat += 30) this.curve(ctx, view, (t) => [lat, -180 + 360 * t]);
    this.land(ctx, view);
    // A double gold rim, as on an engraved globe.
    ctx.strokeStyle = '#c9a24a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.arc(cx, cy, r + 7, 0, Math.PI * 2);
    ctx.stroke();
    const markers = placeMarkers(view, this.time, this.markers);
    this.leader(ctx, markers, this.chosen, easeOut(this.reveal), 1);
    if (this.hover && this.hover !== this.chosen) this.leader(ctx, markers, this.hover, 1, 0.45);
    // The zoos: the chosen one isolated in its wash, the rest dimmed.
    for (const m of markers) {
      if (!m.visible) continue;
      const on = m.id === this.chosen;
      const lit = on || m.id === this.hover;
      // The Moon dims by shading, never by fading, so the graticule never shows through it.
      ctx.globalAlpha = lit || m.id === 'moon' ? 1 : 0.42;
      const swell = on ? 1 + 0.35 * Math.sin(Math.PI * this.reveal) : 1;
      const x = m.x;
      const y = h - m.y;
      if (m.id === 'moon') this.moon(ctx, x, y, r * 0.14, on, lit);
      else if (m.id === 'home') this.lantern(ctx, x, y, r * 0.085 * swell, on);
      else this.seal(ctx, x, y, r * (on ? 0.07 : 0.05) * (0.7 + 0.3 * m.facing) * swell, ZOO_WASH[m.id], on);
    }
    ctx.globalAlpha = 1;
  }

  /** Land, engraved in gold: dots grow and brighten toward the middle of the globe. */
  private land(ctx: CanvasRenderingContext2D, view: GlobeView): void {
    const d = this.dots;
    const p = this.p;
    let n = 0;
    for (const dot of GLOBE_DOTS) {
      projectGlobe(dot.lat, dot.lon, view, p);
      if (p.depth <= 0) continue;
      d[n++] = p.x;
      d[n++] = this.h - p.y;
      d[n++] = p.depth;
    }
    for (let s = 0; s < SHADES; s++) {
      const lo = s / SHADES;
      const hi = s === SHADES - 1 ? 1.01 : (s + 1) / SHADES;
      ctx.fillStyle = `rgba(236,208,138,${(0.28 + (0.68 * (s + 0.5)) / SHADES).toFixed(3)})`;
      ctx.beginPath();
      for (let i = 0; i < n; i += 3) {
        const depth = d[i + 2];
        if (depth < lo || depth >= hi) continue;
        const rad = view.r * 0.019 * (0.55 + 0.45 * depth);
        ctx.moveTo(d[i] + rad, d[i + 1]);
        ctx.arc(d[i], d[i + 1], rad, 0, Math.PI * 2);
      }
      ctx.fill();
    }
  }

  /** A line of latitude or longitude, drawn only where it faces the viewer. */
  private curve(ctx: CanvasRenderingContext2D, view: GlobeView, at: (t: number) => [number, number]): void {
    const p = this.p;
    let drawing = false;
    ctx.beginPath();
    for (let i = 0; i <= 48; i++) {
      const [lat, lon] = at(i / 48);
      projectGlobe(lat, lon, view, p);
      if (p.depth <= 0) {
        drawing = false;
        continue;
      }
      if (drawing) ctx.lineTo(p.x, this.h - p.y);
      else ctx.moveTo(p.x, this.h - p.y);
      drawing = true;
    }
    ctx.stroke();
  }

  /** The hairline from a zoo's cartouche to its seal, as on an engraved map; `k` is how far it has drawn. */
  private leader(ctx: CanvasRenderingContext2D, markers: readonly Marker[], id: PlaceId, k: number, alpha: number): void {
    if (!this.leaders) return;
    const m = markers.find((mk) => mk.id === id);
    const label = this.cartouche(id);
    if (!m?.visible || !label) return;
    const box = label.getBoundingClientRect();
    const own = this.canvas.getBoundingClientRect();
    const mx = m.x;
    const my = this.h - m.y;
    // From the nearest point of the cartouche's edge.
    const ax = Math.min(Math.max(mx, box.left - own.left), box.right - own.left);
    const ay = Math.min(Math.max(my, box.top - own.top), box.bottom - own.top);
    if (Math.hypot(mx - ax, my - ay) < 4) return;
    const ex = ax + (mx - ax) * k;
    const ey = ay + (my - ay) * k;
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = id === this.chosen ? ZOO_WASH[id] : '#ecd08a';
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(ax, ay, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  private seal(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, wash: string, on: boolean): void {
    if (on) {
      const halo = ctx.createRadialGradient(x, y, s, x, y, s * 3.4);
      halo.addColorStop(0, `${wash}99`);
      halo.addColorStop(1, `${wash}00`);
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(x, y, s * 3.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = wash;
    ctx.beginPath();
    ctx.arc(x, y, s, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#f3dc9c';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  private moon(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, on: boolean, lit: boolean): void {
    if (on) {
      const halo = ctx.createRadialGradient(x, y, s, x, y, s * 2.2);
      halo.addColorStop(0, 'rgba(211,219,233,0.45)');
      halo.addColorStop(1, 'rgba(211,219,233,0)');
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(x, y, s * 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    const face = ctx.createRadialGradient(x - s * 0.3, y - s * 0.3, s * 0.1, x, y, s);
    face.addColorStop(0, lit ? '#f6f2e6' : '#8f98ad');
    face.addColorStop(1, lit ? '#a9b3c9' : '#3d4762');
    ctx.fillStyle = face;
    ctx.beginPath();
    ctx.arc(x, y, s, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = lit ? 'rgba(70,80,105,0.33)' : 'rgba(20,26,44,0.35)';
    for (const [dx, dy, k] of [
      [-0.3, 0.2, 0.22],
      [0.35, -0.1, 0.15],
      [0.05, 0.45, 0.12],
    ] as const) {
      ctx.beginPath();
      ctx.arc(x + dx * s, y + dy * s, k * s, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private lantern(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, on: boolean): void {
    // Its light stays inside the canvas, so it never ends on a straight edge.
    const reach = Math.min(s * (on ? 4.6 : 3), x, this.w - x, y, this.h - y);
    const glow = ctx.createRadialGradient(x, y, 0, x, y, reach);
    glow.addColorStop(0, 'rgba(255,179,92,0.75)');
    glow.addColorStop(1, 'rgba(255,179,92,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, reach, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#f3dc9c';
    ctx.fillStyle = '#ffd08a';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(x - s * 0.6, y - s * 0.8, s * 1.2, s * 1.6, s * 0.3);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y - s * 0.95, s * 0.4, Math.PI, 0);
    ctx.stroke();
  }
}

interface Firefly {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  readonly seed: number;
}

/**
 * A zoo's legend: a little wall in that zoo's light and weather where a rabbit's shadow is tossed under the
 * zoo's own rules, by the game's own physics. Tapping the wall tosses it and releases the zoo's fireflies.
 */
class LegendWall {
  private readonly pool: Pool = { u: 1, v: 9 / 16 };
  private readonly rng = mulberry32(7);
  private readonly weather = new WeatherField(mulberry32(3));
  private readonly shape = silhouette('rabbit');
  private readonly buf: Float32Array;
  private readonly events: CreatureEvent[] = [];
  private readonly fireflies: Firefly[] = [];
  private creature: Creature;
  private place: PlaceId = 'home';
  /** Seconds of rest before the next toss, and how many tosses are left (one under reduced motion). */
  private wait = 1;
  private tosses = Infinity;
  /** Whether the rabbit has greeted the visitor since this zoo was chosen. */
  private greeted = false;
  private w = 0;
  private h = 0;
  private readonly ctx: CanvasRenderingContext2D | null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d');
    this.buf = new Float32Array(this.shape.caps.length);
    this.creature = this.cast();
    canvas.addEventListener('pointerdown', (e) => this.tap(e));
  }

  resize(): void {
    ({ w: this.w, h: this.h } = fitCanvas(this.canvas, this.ctx));
  }

  show(place: PlaceId): void {
    this.place = place;
    this.weather.set(placeOf(place).weather, this.pool);
    this.creature = this.cast();
    this.fireflies.length = 0;
    this.wait = 0.35;
    this.tosses = reducedMotion() ? 1 : Infinity;
    this.greeted = reducedMotion();
  }

  private cast(): Creature {
    const size = 0.8 * this.pool.v;
    return new Creature(1, 'rabbit', 'hop', -0.4 * this.pool.u, groundY(this.pool), size / Math.max(this.shape.w, this.shape.h), size, this.rng);
  }

  private tap(e: PointerEvent): void {
    const box = this.canvas.getBoundingClientRect();
    const x = (((e.clientX - box.left) / box.width) * 2 - 1) * this.pool.u;
    const y = (1 - ((e.clientY - box.top) / box.height) * 2) * this.pool.v;
    this.release(x, y);
    this.toss(x);
  }

  /** A pinch's fireflies (one at home, a swarm in the Amazon). */
  private release(x: number, y: number): void {
    const n = placeOf(this.place).rules.fireflies;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + this.rng() * 1.2;
      const speed = (0.12 + 0.18 * this.rng()) * this.pool.v;
      this.fireflies.push({ x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, life: 2.6 + this.rng(), seed: this.rng() * 10 });
    }
  }

  /** Tosses the rabbit toward the middle of the wall, or away from a tap. */
  private toss(from?: number): void {
    const c = this.creature;
    const t = TOSS[this.place];
    const away = from === undefined ? (c.x <= 0 ? 1 : -1) : c.x >= from ? 1 : -1;
    const vx = t.upwind ? -t.vx : away * t.vx;
    c.knock(vx * this.pool.v, t.vy * this.pool.v, this.pool);
  }

  update(dt: number): void {
    const rules = placeOf(this.place).rules;
    const c = this.creature;
    const resting = c.mode === 'rest' || c.mode === 'wander';
    if (resting && !this.greeted) {
      // A chosen zoo's creature first turns toward the page and greets you with a happy hop.
      this.greeted = true;
      c.facing = -1;
      c.pet();
    } else if (resting && this.tosses > 0) {
      this.wait -= dt;
      if (this.wait <= 0) {
        if (this.place === 'amazon') this.release(c.x * 0.5, 0.3 * this.pool.v);
        this.toss();
        this.tosses -= 1;
        this.wait = 2.2;
      }
    }
    c.update(dt, this.pool, this.events, rules);
    this.events.length = 0;
    for (const f of this.fireflies) {
      f.vx = f.vx * Math.exp(-1.2 * dt) + Math.sin(f.life * 3 + f.seed) * 0.05 * this.pool.v * dt;
      f.vy = f.vy * Math.exp(-1.2 * dt) + Math.cos(f.life * 2.3 + f.seed) * 0.04 * this.pool.v * dt;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.life -= dt;
    }
    for (let i = this.fireflies.length - 1; i >= 0; i--) if (this.fireflies[i].life <= 0) this.fireflies.splice(i, 1);
    this.weather.update(dt, this.pool, rules.wind);
  }

  draw(): void {
    const ctx = this.ctx;
    const { w, h } = this;
    if (!ctx || w === 0) return;
    const place = placeOf(this.place);
    const [r, g, b] = place.light.map((v) => Math.round(v * 255));
    // The dark room, and the lantern's pool of light on the wall.
    ctx.fillStyle = '#120c08';
    ctx.fillRect(0, 0, w, h);
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(1, h / w);
    const light = ctx.createRadialGradient(0, 0, 0, 0, 0, w * 0.52);
    light.addColorStop(0, `rgba(${r},${g},${b},0.95)`);
    light.addColorStop(0.62, `rgba(${r},${g},${b},0.62)`);
    light.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = light;
    ctx.fillRect(-w / 2, -w / 2, w, w);
    ctx.restore();
    const k = w / 2 / this.pool.u;
    const sx = (x: number): number => w / 2 + x * k;
    const sy = (y: number): number => h / 2 - y * k;
    this.drawWeather(ctx, sx, sy, k, place.rules.wind);
    for (const f of this.fireflies) {
      const a = Math.min(1, f.life / 0.6) * (0.75 + 0.25 * Math.sin(f.life * 9 + f.seed));
      const x = sx(f.x);
      const y = sy(f.y);
      const glow = ctx.createRadialGradient(x, y, 0, x, y, 7);
      glow.addColorStop(0, `rgba(255,246,190,${a.toFixed(3)})`);
      glow.addColorStop(1, 'rgba(255,230,140,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, Math.PI * 2);
      ctx.fill();
    }
    // The rabbit's shadow, as the game draws it.
    const c = this.creature;
    const y = c.y + c.lift;
    placeCapsules(this.shape.caps, this.shape.count, this.shape.cx, this.shape.cy, c.x, y, c.scale * c.bounce, c.facing, this.buf);
    if (!reducedMotion() && c.spin !== 0) rotateCapsules(this.buf, this.shape.count, -c.facing * c.spin, c.x, y);
    ctx.strokeStyle = 'rgba(22,13,7,0.9)';
    ctx.lineCap = 'round';
    for (let i = 0; i < this.shape.count; i++) {
      const o = i * CAPSULE_STRIDE;
      ctx.lineWidth = Math.max(1, (this.buf[o + 2] + this.buf[o + 5]) * k);
      ctx.beginPath();
      ctx.moveTo(sx(this.buf[o]), sy(this.buf[o + 1]));
      ctx.lineTo(sx(this.buf[o + 3]), sy(this.buf[o + 4]));
      ctx.stroke();
    }
  }

  /** Weather as in the game: snow and dust glint, rain and sand streak in shadow. */
  private drawWeather(ctx: CanvasRenderingContext2D, sx: (x: number) => number, sy: (y: number) => number, k: number, wind: number): void {
    const wf = this.weather;
    for (let i = 0; i < wf.count; i++) {
      const x = sx(wf.x[i]);
      const y = sy(wf.y[i]);
      if (wf.kind === 'snow' || wf.kind === 'dust') {
        ctx.fillStyle = wf.kind === 'snow' ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.55)';
        ctx.beginPath();
        ctx.arc(x, y, wf.kind === 'snow' ? 1.7 : 1, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      const [vx, vy] = wf.velocity(i, this.pool, wind);
      const s = wf.kind === 'rain' ? 0.03 : 0.05;
      ctx.strokeStyle = wf.kind === 'rain' ? 'rgba(20,14,10,0.32)' : 'rgba(70,34,10,0.32)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - vx * s * k, y + vy * s * k);
      ctx.stroke();
    }
  }
}

export interface Atlas {
  /** The zoo chosen on the atlas. */
  chosen(): PlaceId;
  /** Reads the save again after a game: where the zoo is now, and the passport's stamps. */
  refresh(): void;
}

/**
 * Mounts the homepage atlas: the globe, the zoo cartouches, the chosen zoo's legend, the hand-shadow key
 * and the passport. It animates only while the homepage shows and the globe is on screen.
 */
export function mountAtlas(onChange: (id: PlaceId) => void): Atlas | null {
  const landing = document.getElementById('landing');
  const globeCanvas = document.getElementById('globe');
  const wallCanvas = document.getElementById('legend-wall');
  if (!landing || !(globeCanvas instanceof HTMLCanvasElement) || !(wallCanvas instanceof HTMLCanvasElement)) return null;
  for (const svg of document.querySelectorAll<SVGSVGElement>('svg[data-creature]')) {
    if (isCreature(svg.dataset.creature)) drawSilhouette(svg, svg.dataset.creature);
  }
  const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="zoo"]')).filter((i) => isPlace(i.value));
  const labelOf = (id: PlaceId): HTMLLabelElement | null => inputs.find((i) => i.value === id)?.closest('label') ?? null;
  const text = (id: string, value: string): void => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };
  let save = readSave();
  let chosen: PlaceId = save?.place ?? 'home';
  const select = (id: PlaceId, instant: boolean): void => {
    chosen = id;
    globe.choose(id, instant);
    wall.show(id);
    landing.style.setProperty('--zoo', ZOO_WASH[id]);
    for (const input of inputs) input.checked = input.value === id;
    const legend = ZOO_LEGEND[id];
    text('legend-name', placeOf(id).name);
    text('legend-scene', legend.scene);
    text('legend-rule', legend.rule);
    text('legend-stamp', stampLine(id, save));
    text('legend-hint', legend.hint);
    // Screen readers hear a choice as it is made, not the one the page opens with.
    text('legend-live', instant ? '' : `${placeOf(id).name}. ${legend.rule}`);
    wallCanvas.setAttribute('aria-label', `A rabbit's shadow tossed on a wall under the rules of ${id === 'home' ? 'home' : placeOf(id).name.replace(/^The /, 'the ')}.`);
    const glyph = labelOf(id)?.querySelector('svg');
    const legendGlyph = document.getElementById('legend-glyph');
    if (glyph && legendGlyph) legendGlyph.replaceChildren(...Array.from(glyph.childNodes, (n) => n.cloneNode(true)));
    onChange(id);
  };
  const globe = new AtlasGlobe(globeCanvas, labelOf, (id) => select(id, false));
  const wall = new LegendWall(wallCanvas);
  for (const input of inputs) {
    const id = input.value as PlaceId;
    input.addEventListener('change', () => {
      if (input.checked) select(id, false);
    });
    const label = input.closest('label');
    label?.addEventListener('pointerenter', () => (globe.hover = id));
    label?.addEventListener('pointerleave', () => {
      if (globe.hover === id) globe.hover = null;
    });
  }
  const resize = (): void => {
    globe.resize();
    wall.resize();
  };
  const sizes = new ResizeObserver(resize);
  sizes.observe(globeCanvas);
  sizes.observe(wallCanvas);
  resize();
  renderPassport(save);
  select(chosen, true);
  // Animate only what can be seen: the homepage is showing and the atlas is on screen.
  let onScreen = true;
  const sheet = globeCanvas.closest('section');
  if (sheet) new IntersectionObserver(([entry]) => (onScreen = entry.isIntersecting)).observe(sheet);
  let last = performance.now();
  const frame = (now: number): void => {
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    if (!landing.hidden && onScreen) {
      globe.update(dt);
      globe.draw();
      wall.update(dt);
      wall.draw();
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  return {
    chosen: () => chosen,
    refresh: () => {
      save = readSave();
      renderPassport(save);
      select(save?.place ?? chosen, true);
    },
  };
}

/** The passport: a stamp for every place visited, and how far the zoo has come. */
function renderPassport(save: SaveData | null): void {
  const summary = document.getElementById('passport-summary');
  if (summary) summary.textContent = passportSummary(save);
  for (const el of document.querySelectorAll<HTMLElement>('[data-stamp]')) {
    const visited = isPlace(el.dataset.stamp) && !!save?.stamps.includes(el.dataset.stamp);
    el.dataset.visited = String(visited);
    const state = el.querySelector('.stamp-state');
    if (state) state.textContent = visited ? 'Stamped' : 'Not yet';
  }
}
