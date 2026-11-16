import { blendCapsules, placeCapsules, placePoint, rotateCapsules, rotatePoint, type Point } from '../../core/animate.js';
import type { Creature, Pool } from '../../core/creature.js';
import type { CreatureId, CreatureShape } from '../../core/library.js';
import { HEART, STAR, type Particles } from '../../core/particles.js';
import { CAPSULE_STRIDE } from '../../core/projector.js';
import type { Firefly } from '../../core/fireflies.js';

/** Where the camera looks: screen pixels per meter, and where the wall's x and y origins land on screen. */
export interface View {
  readonly w: number;
  readonly h: number;
  /** Pixels per meter. */
  readonly scale: number;
  /** The wall x (meters) at the middle of the screen. */
  readonly camX: number;
  /** The screen y (pixels) of wall height 0. */
  readonly originY: number;
}

export const sx = (v: View, x: number): number => v.w / 2 + (x - v.camX) * v.scale;
export const sy = (v: View, y: number): number => v.originY - y * v.scale;

/** Shadow ink on the lit wall: a warm near-black, like the game's. */
const SHADOW = '#160d07';
const SHADOW_ALPHA = 0.9;

/**
 * Draws shadows opaque onto an offscreen layer, then lays the layer onto the wall in one pass, so bones
 * that overlap never darken twice and every shadow shares one soft edge.
 */
export class ShadowLayer {
  readonly canvas = document.createElement('canvas');
  readonly ctx: CanvasRenderingContext2D;

  constructor() {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('No 2D canvas');
    this.ctx = ctx;
  }

  begin(width: number, height: number, dpr: number): void {
    const w = Math.round(width * dpr);
    const h = Math.round(height * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.clearRect(0, 0, width, height);
    this.ctx.fillStyle = SHADOW;
    this.ctx.strokeStyle = SHADOW;
  }

  /** Capsules (in an enclosure's pool coordinates, offset to the wall by ox, oy) as one filled shape. */
  capsules(caps: Float32Array, start: number, count: number, ox: number, oy: number, v: View): void {
    const ctx = this.ctx;
    ctx.beginPath();
    for (let i = start; i < start + count; i++) {
      const o = i * CAPSULE_STRIDE;
      capsulePath(ctx, sx(v, ox + caps[o]), sy(v, oy + caps[o + 1]), caps[o + 2] * v.scale, sx(v, ox + caps[o + 3]), sy(v, oy + caps[o + 4]), caps[o + 5] * v.scale);
    }
    ctx.fill('nonzero');
  }

  /** A thin line of shadow (the spider's thread). */
  line(x0: number, y0: number, x1: number, y1: number, width: number, v: View): void {
    const ctx = this.ctx;
    ctx.lineWidth = Math.max(1, width * v.scale);
    ctx.beginPath();
    ctx.moveTo(sx(v, x0), sy(v, y0));
    ctx.lineTo(sx(v, x1), sy(v, y1));
    ctx.stroke();
  }

  /** Lays the layer onto the screen, softened like a lantern's shadow when the browser can blur. */
  composite(target: CanvasRenderingContext2D, width: number, height: number, soft: number): void {
    target.save();
    target.globalAlpha = SHADOW_ALPHA;
    if ('filter' in target && soft > 0) target.filter = `blur(${soft.toFixed(2)}px)`;
    target.drawImage(this.canvas, 0, 0, width, height);
    target.restore();
  }
}

/**
 * Adds one capsule (two discs joined by their tangent band) to the current path, every part wound the
 * same way, so a nonzero fill unions them without holes.
 */
function capsulePath(ctx: CanvasRenderingContext2D, ax: number, ay: number, ar: number, bx: number, by: number, br: number): void {
  ctx.moveTo(ax + ar, ay);
  ctx.arc(ax, ay, ar, 0, Math.PI * 2);
  ctx.moveTo(bx + br, by);
  ctx.arc(bx, by, br, 0, Math.PI * 2);
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (len < 1e-3) return;
  const nx = -dy / len;
  const ny = dx / len;
  // Clockwise on screen, like the arcs.
  const pts = [
    [ax + nx * ar, ay + ny * ar],
    [bx + nx * br, by + ny * br],
    [bx - nx * br, by - ny * br],
    [ax - nx * ar, ay - ny * ar],
  ];
  const area = (pts[1][0] - pts[0][0]) * (pts[2][1] - pts[0][1]) - (pts[2][0] - pts[0][0]) * (pts[1][1] - pts[0][1]);
  if (area < 0) pts.reverse();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < 4; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}

/**
 * The game's creature drawing, on a 2D wall: the shape blended toward its action pose, placed, turned
 * by its spin, plus the spider's thread and the eye's glint. Returns the eye (screen pixels) if open.
 */
export class CreaturePainter {
  private readonly blend: Float32Array;
  private readonly placed: Float32Array;
  private readonly point: Point = { x: 0, y: 0 };

  constructor(private readonly shapes: ReadonlyMap<CreatureId, CreatureShape>) {
    let max = 0;
    for (const s of shapes.values()) max = Math.max(max, s.caps.length);
    this.blend = new Float32Array(max);
    this.placed = new Float32Array(max);
  }

  draw(layer: ShadowLayer, c: Creature, ox: number, oy: number, pool: Pool, v: View, still: boolean): { x: number; y: number } | null {
    const shape = this.shapes.get(c.species)!;
    const { cx, cy } = shape.target.frame;
    const y = c.y + c.lift;
    const scale = c.scale * c.bounce;
    const spin = still ? 0 : -c.heading * c.spin;
    blendCapsules(shape.caps, shape.actCaps, c.act, shape.count, this.blend);
    placeCapsules(this.blend, shape.count, cx, cy, c.x, y, scale, c.facing, this.placed);
    if (spin !== 0) rotateCapsules(this.placed, shape.count, spin, c.x, y);
    layer.capsules(this.placed, 0, shape.count, ox, oy, v);
    if (c.motion === 'dangle') {
      const top = pool.v * Math.sqrt(Math.max(0, 1 - (c.x / pool.u) ** 2));
      layer.line(ox + c.x, oy + y + c.size * 0.35, ox + c.x, oy + top, 0.004, v);
    }
    if (c.eyeOpen <= 0) return null;
    placePoint(shape.eye[0], shape.eye[1], cx, cy, c.x, y, scale, c.facing, this.point);
    if (spin !== 0) rotatePoint(this.point, spin, c.x, y);
    return { x: sx(v, ox + this.point.x), y: sy(v, oy + this.point.y) };
  }
}

const GLOW = '255,236,186';

/** A soft round glow (fireflies, sparks, eyes). */
export function glow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, alpha: number, rgb = GLOW): void {
  if (alpha <= 0 || r <= 0) return;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(${rgb},${alpha.toFixed(3)})`);
  g.addColorStop(0.35, `rgba(${rgb},${(alpha * 0.55).toFixed(3)})`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

/** Fireflies flicker with a warm halo, as on the game's wall. */
export function drawFireflies(ctx: CanvasRenderingContext2D, list: readonly Firefly[], ox: number, oy: number, v: View): void {
  for (const f of list) {
    const flicker = 0.65 + 0.35 * Math.sin(f.age * 9 + f.seed);
    const x = sx(v, ox + f.x);
    const y = sy(v, oy + f.y);
    glow(ctx, x, y, 0.03 * v.scale, 0.35 * flicker);
    glow(ctx, x, y, 0.009 * v.scale, flicker, '255,250,220');
  }
}

/** Hearts, twinkling stars and sparks, in light. */
export function drawParticles(ctx: CanvasRenderingContext2D, p: Particles, ox: number, oy: number, v: View, time: number): void {
  for (let i = 0; i < p.count; i++) {
    const k = p.life[i] / p.max[i];
    const x = sx(v, ox + p.x[i]);
    const y = sy(v, oy + p.y[i]);
    if (p.kind[i] === HEART) heart(ctx, x, y, 0.018 * v.scale, k);
    else if (p.kind[i] === STAR) star(ctx, x, y, 0.016 * v.scale, k, time * 5 + i);
    else glow(ctx, x, y, (0.004 + 0.009 * k) * v.scale, k);
  }
}

function heart(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, alpha: number): void {
  ctx.fillStyle = `rgba(255,214,190,${alpha.toFixed(3)})`;
  ctx.beginPath();
  ctx.moveTo(x, y + r * 0.9);
  ctx.bezierCurveTo(x - r * 1.4, y - r * 0.1, x - r * 0.7, y - r * 1.2, x, y - r * 0.45);
  ctx.bezierCurveTo(x + r * 0.7, y - r * 1.2, x + r * 1.4, y - r * 0.1, x, y + r * 0.9);
  ctx.fill();
}

function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, alpha: number, turn: number): void {
  const c = Math.cos(turn) * r;
  const s = Math.sin(turn) * r;
  ctx.strokeStyle = `rgba(255,240,200,${alpha.toFixed(3)})`;
  ctx.lineWidth = Math.max(1, r * 0.34);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x - c, y - s);
  ctx.lineTo(x + c, y + s);
  ctx.moveTo(x + s, y - c);
  ctx.lineTo(x - s, y + c);
  ctx.stroke();
}
