import { mulberry32 } from '../../core/rng.js';
import type { WeatherField } from '../../core/weather.js';
import { placeOf, type PlaceId } from '../../core/world.js';
import type { WalkLayout } from './layout.js';
import { glow, sx, sy, type View } from './painter.js';

/** Heights on the zoo wall (meters): the path, the wall's foot and top, the railing. */
export const LEVEL = { path: -0.98, wallFoot: -0.75, wallTop: 0.98, railTop: -0.48, railLow: -0.66 } as const;
/** The band of the scene the camera always shows (meters), sky above the wall included. */
export const BAND = { bottom: -1.12, top: 1.86 } as const;

interface Palette {
  readonly skyTop: string;
  readonly horizon: string;
  readonly far: string;
  readonly ground: string;
  readonly groundEdge: string;
}

/** Each zoo's night: its sky, its skyline's ink and its path. */
const PALETTE: Readonly<Record<PlaceId, Palette>> = {
  home: { skyTop: '#070b1c', horizon: '#2b2338', far: '#0c0d18', ground: '#2a2320', groundEdge: '#3b312b' },
  arctic: { skyTop: '#040d22', horizon: '#1b3656', far: '#0a172b', ground: '#7d93b3', groundEdge: '#a9bdd6' },
  sahara: { skyTop: '#100a20', horizon: '#5c3122', far: '#170d13', ground: '#6a4a2f', groundEdge: '#86613f' },
  amazon: { skyTop: '#04110d', horizon: '#163126', far: '#030d08', ground: '#1d2a1c', groundEdge: '#2c3d29' },
  outback: { skyTop: '#140a1c', horizon: '#6a291b', far: '#18090b', ground: '#5a2a18', groundEdge: '#74391f' },
  moon: { skyTop: '#000004', horizon: '#0d0f18', far: '#26282f', ground: '#4b4d55', groundEdge: '#62656e' },
};

const rgb = (light: readonly [number, number, number]): string => light.map((c) => Math.round(c * 255)).join(',');

/** Seeded stars across the sky, and the far skyline's shapes, made once per zoo. */
export class Scenery {
  readonly palette: Palette;
  private readonly stars: { x: number; y: number; r: number; tw: number }[] = [];
  private readonly far: ((ctx: CanvasRenderingContext2D, m: (x: number, y: number) => [number, number], k: number) => void)[] = [];

  constructor(
    readonly place: PlaceId,
    private readonly layout: WalkLayout,
  ) {
    this.palette = PALETTE[place];
    const rng = mulberry32(17 + ['home', 'arctic', 'sahara', 'amazon', 'outback', 'moon'].indexOf(place) * 101);
    const starCount = place === 'moon' ? 260 : place === 'amazon' ? 70 : 150;
    for (let i = 0; i < starCount; i++) this.stars.push({ x: rng(), y: rng(), r: 0.4 + rng() * (rng() < 0.08 ? 1.6 : 0.9), tw: rng() * 6 });
    buildSkyline(place, rng, this.far);
  }

  /** The sky, its stars and moon (or Earth), and the zoo's skyline beyond the wall. */
  drawSky(ctx: CanvasRenderingContext2D, v: View, time: number): void {
    const p = this.palette;
    const horizonY = sy(v, LEVEL.wallTop);
    const sky = ctx.createLinearGradient(0, 0, 0, horizonY);
    sky.addColorStop(0, p.skyTop);
    sky.addColorStop(1, p.horizon);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, v.w, horizonY + 2);
    // The land below the skyline, behind the wall and beyond either end of it.
    ctx.fillStyle = p.far;
    ctx.fillRect(0, horizonY, v.w, v.h - horizonY);
    // Stars drift a little with the camera, far away.
    const drift = (v.camX * v.scale * 0.04) % v.w;
    for (const s of this.stars) {
      const x = (((s.x * v.w * 1.2 - drift) % v.w) + v.w) % v.w;
      const y = s.y * horizonY * 0.92;
      const a = 0.45 + 0.35 * Math.sin(time * 1.3 + s.tw);
      ctx.fillStyle = `rgba(240,236,220,${a.toFixed(3)})`;
      ctx.fillRect(x, y, s.r, s.r);
    }
    if (this.place === 'arctic') aurora(ctx, v, horizonY, time);
    // The Moon's zoo looks up at Earth; every other zoo at the moon.
    const ox = v.w * 0.8 - v.camX * v.scale * 0.03;
    // On a narrow screen the walk's header spans the top, so the sky's light sits below it.
    const oy = v.w < 700 ? Math.max(150, horizonY * 0.5) : Math.max(48, horizonY * 0.28);
    const r = Math.max(16, Math.min(46, v.scale * 0.11));
    if (this.place === 'moon') earth(ctx, ox, oy, r * 1.15);
    else moonDisc(ctx, ox, oy, r);
    // The skyline, smaller and slower than the wall: it is far away.
    const k = 0.55;
    const m = (x: number, y: number): [number, number] => [v.w / 2 + (x - v.camX * 0.42) * v.scale * k, horizonY - (y * v.scale * k)];
    ctx.fillStyle = p.far;
    ctx.strokeStyle = p.far;
    for (const draw of this.far) draw(ctx, m, v.scale * k);
  }

  /**
   * The zoo wall from the gate to the lantern house, each enclosure's pool of lantern light on it, its
   * lamp and its hanging name board.
   */
  drawWall(ctx: CanvasRenderingContext2D, v: View, time: number, names: readonly string[]): void {
    const L = this.layout;
    const x0 = sx(v, L.gate + 0.78);
    const x1 = sx(v, L.house - 0.72);
    const top = sy(v, LEVEL.wallTop);
    const foot = sy(v, LEVEL.wallFoot);
    if (x1 < 0 || x0 > v.w) return;
    const left = Math.max(0, x0);
    const right = Math.min(v.w, x1);
    ctx.fillStyle = '#231b17';
    ctx.fillRect(left, top, right - left, foot - top);
    // Coursed stone: mortar lines and staggered joints.
    ctx.strokeStyle = 'rgba(0,0,0,0.28)';
    ctx.lineWidth = 1;
    const course = 0.21 * v.scale;
    ctx.beginPath();
    for (let y = top + course, row = 0; y < foot; y += course, row++) {
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      const step = 0.44 * v.scale;
      const shift = (row % 2) * step * 0.5 - ((v.camX * v.scale) % step);
      for (let x = shift; x < v.w; x += step) {
        if (x < left || x > right) continue;
        ctx.moveTo(x, y - course);
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
    // The coping along the top.
    ctx.fillStyle = '#30261f';
    ctx.fillRect(left, top - 0.05 * v.scale, right - left, 0.06 * v.scale);
    ctx.fillStyle = 'rgba(255,220,170,0.08)';
    ctx.fillRect(left, top - 0.05 * v.scale, right - left, 1.5);
    const light = rgb(placeOf(this.place).light);
    L.enclosures.forEach((e, i) => {
      const cx = sx(v, e.x);
      const reach = L.pool.u * 1.6 * v.scale;
      if (cx + reach < 0 || cx - reach > v.w) return;
      const cy = sy(v, L.poolY);
      const flicker = 0.96 + 0.04 * Math.sin(time * 7.3 + i * 1.7) * Math.sin(time * 3.1 + i);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(1, L.pool.v / L.pool.u);
      const r = L.pool.u * 1.18 * v.scale;
      const pool = ctx.createRadialGradient(-0.12 * r, -0.1 * r, 0, 0, 0, r);
      pool.addColorStop(0, `rgba(${light},${(0.95 * flicker).toFixed(3)})`);
      pool.addColorStop(0.55, `rgba(${light},${(0.72 * flicker).toFixed(3)})`);
      pool.addColorStop(0.82, `rgba(${light},0.28)`);
      pool.addColorStop(1, `rgba(${light},0)`);
      ctx.fillStyle = pool;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      // Its light spills onto the path below.
      const spill = ctx.createRadialGradient(cx, foot, 0, cx, foot, L.pool.u * 1.2 * v.scale);
      spill.addColorStop(0, `rgba(${light},0.16)`);
      spill.addColorStop(1, `rgba(${light},0)`);
      ctx.fillStyle = spill;
      ctx.fillRect(cx - L.pool.u * 1.2 * v.scale, foot, L.pool.u * 2.4 * v.scale, (LEVEL.wallFoot - BAND.bottom) * v.scale);
      this.lamp(ctx, v, e.x - L.pool.u * 1.2, 0.7, light, flicker);
      board(ctx, v, e.x, LEVEL.wallTop - 0.05, names[i], 0.075);
    });
  }

  /** A lantern on a bracket from the wall: the light each enclosure's shadows are cast by. */
  private lamp(ctx: CanvasRenderingContext2D, v: View, x: number, y: number, light: string, flicker: number): void {
    const bx = sx(v, x);
    const by = sy(v, y);
    const s = v.scale;
    ctx.strokeStyle = '#0d0a08';
    ctx.lineWidth = Math.max(1.5, 0.012 * s);
    ctx.beginPath();
    ctx.moveTo(bx - 0.06 * s, by);
    ctx.lineTo(bx + 0.05 * s, by);
    ctx.lineTo(bx + 0.05 * s, by + 0.04 * s);
    ctx.stroke();
    glow(ctx, bx + 0.05 * s, by + 0.1 * s, 0.32 * s, 0.32 * flicker, light);
    ctx.fillStyle = '#0d0a08';
    ctx.fillRect(bx + 0.02 * s, by + 0.04 * s, 0.06 * s, 0.012 * s);
    ctx.fillStyle = `rgba(${light},${(0.95 * flicker).toFixed(3)})`;
    ctx.fillRect(bx + 0.028 * s, by + 0.052 * s, 0.044 * s, 0.07 * s);
    ctx.fillStyle = '#0d0a08';
    ctx.fillRect(bx + 0.02 * s, by + 0.122 * s, 0.06 * s, 0.012 * s);
  }

  /** The railing in front of the enclosures. */
  drawRailing(ctx: CanvasRenderingContext2D, v: View): void {
    const L = this.layout;
    const s = v.scale;
    ctx.fillStyle = '#0b0807';
    const from = L.gate + 0.9;
    const to = L.house - 0.85;
    const left = Math.max(sx(v, from), 0);
    const right = Math.min(sx(v, to), v.w);
    if (right <= left) return;
    ctx.fillRect(left, sy(v, LEVEL.railTop), right - left, 0.022 * s);
    ctx.fillRect(left, sy(v, LEVEL.railLow), right - left, 0.016 * s);
    const step = 0.55;
    for (let x = Math.ceil(from / step) * step; x <= to; x += step) {
      const px = sx(v, x);
      if (px < -10 || px > v.w + 10) continue;
      ctx.fillRect(px - 0.012 * s, sy(v, LEVEL.railTop + 0.03), 0.024 * s, (LEVEL.railTop + 0.03 - LEVEL.wallFoot) * s);
      ctx.beginPath();
      ctx.arc(px, sy(v, LEVEL.railTop + 0.035), 0.02 * s, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** The path the visitor walks, in the zoo's own ground: cobbles, snow, sand, mud, red earth or dust. */
  drawPath(ctx: CanvasRenderingContext2D, v: View): void {
    const p = this.palette;
    const top = sy(v, LEVEL.wallFoot);
    ctx.fillStyle = p.ground;
    ctx.fillRect(0, top, v.w, v.h - top);
    ctx.fillStyle = p.groundEdge;
    ctx.fillRect(0, top, v.w, Math.max(1.5, 0.012 * v.scale));
    // A darker band where the light fades toward the viewer.
    const fade = ctx.createLinearGradient(0, top, 0, v.h);
    fade.addColorStop(0, 'rgba(0,0,0,0)');
    fade.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = fade;
    ctx.fillRect(0, top, v.w, v.h - top);
  }

  /** Weather across the whole night: snow and dust glint, rain and blowing sand streak. */
  drawWeather(ctx: CanvasRenderingContext2D, v: View, wf: WeatherField, field: { u: number; v: number }, wind: number, cy: number): void {
    for (let i = 0; i < wf.count; i++) {
      const x = v.w / 2 + wf.x[i] * v.scale;
      const y = sy(v, cy + wf.y[i]);
      if (wf.kind === 'snow' || wf.kind === 'dust') {
        ctx.fillStyle = wf.kind === 'snow' ? 'rgba(240,246,255,0.85)' : 'rgba(220,224,235,0.45)';
        ctx.beginPath();
        ctx.arc(x, y, wf.kind === 'snow' ? Math.max(1.2, 0.006 * v.scale) : 1, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      const [vx, vy] = wf.velocity(i, field, wind);
      const t = wf.kind === 'rain' ? 0.035 : 0.06;
      ctx.strokeStyle = wf.kind === 'rain' ? 'rgba(200,220,240,0.32)' : 'rgba(240,200,150,0.3)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - vx * t * v.scale, y + vy * t * v.scale);
      ctx.stroke();
    }
  }

  /** The gate: two pillars with lanterns, the zoo's name on the arch, and its doors opening (0 to 1). */
  drawGate(ctx: CanvasRenderingContext2D, v: View, open: number, title: string, subtitle: string, time: number): void {
    const s = v.scale;
    const gx = this.layout.gate;
    if (sx(v, gx + 1.2) < 0 || sx(v, gx - 1.2) > v.w) return;
    const light = rgb(placeOf(this.place).light);
    ctx.fillStyle = '#0e0a08';
    for (const side of [-1, 1]) {
      const px = sx(v, gx + side * 0.78);
      ctx.fillRect(px - 0.11 * s, sy(v, 1.22), 0.22 * s, (1.22 - LEVEL.path) * s);
      ctx.fillRect(px - 0.14 * s, sy(v, 1.26), 0.28 * s, 0.06 * s);
      glow(ctx, px, sy(v, 1.34), 0.36 * s, 0.4 + 0.05 * Math.sin(time * 6 + side), light);
      ctx.fillStyle = `rgba(${light},0.95)`;
      ctx.fillRect(px - 0.035 * s, sy(v, 1.4), 0.07 * s, 0.09 * s);
      ctx.fillStyle = '#0e0a08';
    }
    // The arch and its name board.
    ctx.beginPath();
    ctx.moveTo(sx(v, gx - 0.78), sy(v, 1.02));
    ctx.quadraticCurveTo(sx(v, gx), sy(v, 1.36), sx(v, gx + 0.78), sy(v, 1.02));
    ctx.lineWidth = 0.05 * s;
    ctx.strokeStyle = '#0e0a08';
    ctx.stroke();
    board(ctx, v, gx, 1.1, title, 0.1, subtitle);
    // The doors swing open toward the visitor: each narrows as it turns on its hinge.
    const leaf = 0.66 * Math.cos((Math.min(1, Math.max(0, open)) * Math.PI) / 2);
    ctx.strokeStyle = '#0e0a08';
    ctx.lineWidth = Math.max(1.5, 0.014 * s);
    for (const side of [-1, 1]) {
      const hinge = gx + side * 0.67;
      const edge = hinge - side * leaf;
      const t = sy(v, 0.42);
      const b = sy(v, LEVEL.path + 0.02);
      ctx.beginPath();
      ctx.moveTo(sx(v, hinge), t);
      ctx.lineTo(sx(v, edge), t);
      ctx.moveTo(sx(v, hinge), sy(v, -0.25));
      ctx.lineTo(sx(v, edge), sy(v, -0.25));
      for (let k = 0; k <= 6; k++) {
        const x = sx(v, hinge - side * leaf * (k / 6));
        ctx.moveTo(x, t);
        ctx.lineTo(x, b);
      }
      ctx.stroke();
    }
  }

  /** The lantern house at the end of the walk, where the zoo goes home with you. */
  drawHouse(ctx: CanvasRenderingContext2D, v: View, time: number): void {
    const s = v.scale;
    const hx = this.layout.house;
    if (sx(v, hx + 1.4) < 0 || sx(v, hx - 1.4) > v.w) return;
    const warm = '255,186,104';
    ctx.fillStyle = '#120d0a';
    const l = sx(v, hx - 0.7);
    const r = sx(v, hx + 0.7);
    const eave = 0.42;
    ctx.fillRect(l, sy(v, eave), r - l, (eave - LEVEL.path) * s);
    ctx.beginPath();
    ctx.moveTo(sx(v, hx - 0.84), sy(v, eave));
    ctx.lineTo(sx(v, hx), sy(v, 0.9));
    ctx.lineTo(sx(v, hx + 0.84), sy(v, eave));
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(sx(v, hx + 0.36), sy(v, 0.86), 0.1 * s, 0.24 * s);
    // Lit windows either side of the door.
    for (const side of [-1, 1]) {
      const wx = sx(v, hx + side * 0.45 - 0.11);
      ctx.fillStyle = `rgba(${warm},0.85)`;
      ctx.fillRect(wx, sy(v, 0.1), 0.22 * s, 0.24 * s);
      ctx.fillStyle = '#120d0a';
      ctx.fillRect(wx + 0.1 * s, sy(v, 0.1), 0.02 * s, 0.24 * s);
      ctx.fillRect(wx, sy(v, 0.1) + 0.11 * s, 0.22 * s, 0.02 * s);
    }
    const door = ctx.createLinearGradient(0, sy(v, 0.02), 0, sy(v, LEVEL.path));
    door.addColorStop(0, `rgba(${warm},0.95)`);
    door.addColorStop(1, `rgba(${warm},0.55)`);
    ctx.fillStyle = door;
    ctx.fillRect(sx(v, hx - 0.17), sy(v, 0.02), 0.34 * s, (0.02 - LEVEL.path) * s);
    glow(ctx, sx(v, hx), sy(v, 0.28), 0.8 * s, 0.34 + 0.04 * Math.sin(time * 5), warm);
    ctx.fillStyle = `rgba(${warm},1)`;
    ctx.fillRect(sx(v, hx - 0.045), sy(v, 0.33), 0.09 * s, 0.11 * s);
    board(ctx, v, hx, 0.62, 'Take the zoo home', 0.065);
  }

  /** The visitor: a keeper in a cap and long coat, carrying a lantern on a pole, legs striding as they walk. */
  drawVisitor(ctx: CanvasRenderingContext2D, v: View, x: number, facing: number, stride: number, moving: boolean): void {
    const s = v.scale;
    const px = sx(v, x);
    const foot = sy(v, LEVEL.path + 0.02);
    const h = 0.62 * s;
    const swing = moving ? Math.sin(stride * 8) : 0.35;
    const bob = moving ? Math.abs(Math.cos(stride * 8)) * 0.012 * s : 0;
    ctx.save();
    ctx.translate(px, foot - bob);
    ctx.scale(facing, 1);
    glow(ctx, 0.36 * h, -0.62 * h, 0.6 * s, 0.24, '255,190,110');
    ctx.fillStyle = '#080605';
    ctx.strokeStyle = '#080605';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // Legs, striding (or standing a little apart).
    ctx.lineWidth = 0.075 * h;
    ctx.beginPath();
    ctx.moveTo(0.02 * h, -0.36 * h);
    ctx.lineTo(0.12 * h * swing, 0);
    ctx.moveTo(-0.02 * h, -0.36 * h);
    ctx.lineTo(-0.12 * h * swing, 0);
    ctx.stroke();
    // Boots.
    for (const k of [swing, -swing]) {
      ctx.beginPath();
      ctx.ellipse(0.12 * h * k + 0.03 * h, -0.012 * h, 0.06 * h, 0.025 * h, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // A long coat, flared at the hem.
    ctx.beginPath();
    ctx.moveTo(-0.075 * h, -0.8 * h);
    ctx.quadraticCurveTo(-0.12 * h, -0.55 * h, -0.16 * h, -0.3 * h);
    ctx.lineTo(0.15 * h, -0.3 * h);
    ctx.quadraticCurveTo(0.11 * h, -0.55 * h, 0.075 * h, -0.8 * h);
    ctx.closePath();
    ctx.fill();
    // Head and a keeper's cap with its brim forward.
    ctx.beginPath();
    ctx.arc(0, -0.88 * h, 0.075 * h, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(0, -0.94 * h, 0.08 * h, 0.045 * h, 0, Math.PI, 0);
    ctx.fill();
    ctx.fillRect(0, -0.95 * h, 0.13 * h, 0.022 * h);
    // The arm and the lantern pole held out in front.
    ctx.lineWidth = 0.05 * h;
    ctx.beginPath();
    ctx.moveTo(0.04 * h, -0.74 * h);
    ctx.lineTo(0.2 * h, -0.62 * h);
    ctx.lineTo(0.3 * h, -0.8 * h);
    ctx.stroke();
    ctx.lineWidth = 0.022 * h;
    ctx.beginPath();
    ctx.moveTo(0.3 * h, -0.8 * h);
    ctx.lineTo(0.36 * h, -0.86 * h);
    ctx.lineTo(0.36 * h, -0.76 * h);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,200,120,1)';
    ctx.fillRect(0.32 * h, -0.76 * h, 0.08 * h, 0.1 * h);
    ctx.restore();
  }
}

/** A hanging board, gold-lettered and double-ruled like the atlas's cartouches. */
function board(ctx: CanvasRenderingContext2D, v: View, x: number, y: number, text: string, size: number, small?: string): void {
  const s = v.scale;
  const px = Math.max(12, size * s);
  ctx.font = `${px}px 'IM Fell English', Georgia, serif`;
  const w = Math.max(ctx.measureText(text).width, small ? ctx.measureText(small).width * 0.6 : 0) + px * 1.4;
  const h = px * (small ? 2.3 : 1.55);
  const cx = sx(v, x);
  const cy = sy(v, y);
  ctx.fillStyle = '#1b1410';
  ctx.fillRect(cx - w / 2, cy - h / 2, w, h);
  ctx.strokeStyle = 'rgba(201,162,74,0.9)';
  ctx.lineWidth = 1;
  ctx.strokeRect(cx - w / 2 + 0.5, cy - h / 2 + 0.5, w - 1, h - 1);
  ctx.strokeStyle = 'rgba(201,162,74,0.45)';
  ctx.strokeRect(cx - w / 2 + 3.5, cy - h / 2 + 3.5, w - 7, h - 7);
  ctx.fillStyle = '#ecd08a';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (small) {
    ctx.font = `italic ${Math.round(px * 0.6)}px 'IM Fell English', Georgia, serif`;
    ctx.fillText(small, cx, cy - h * 0.2);
    ctx.font = `${px}px 'IM Fell English', Georgia, serif`;
    ctx.fillText(text, cx, cy + h * 0.16);
  } else ctx.fillText(text, cx, cy + px * 0.04);
}

function moonDisc(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  glow(ctx, x, y, r * 3, 0.18, '230,232,240');
  const face = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
  face.addColorStop(0, '#f4f1e6');
  face.addColorStop(1, '#b9c0cf');
  ctx.fillStyle = face;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(80,88,110,0.25)';
  for (const [dx, dy, k] of [
    [-0.3, 0.2, 0.22],
    [0.35, -0.1, 0.15],
    [0.05, 0.45, 0.12],
  ] as const) {
    ctx.beginPath();
    ctx.arc(x + dx * r, y + dy * r, k * r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function earth(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  glow(ctx, x, y, r * 2.6, 0.22, '120,170,255');
  const sea = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
  sea.addColorStop(0, '#6fa8e8');
  sea.addColorStop(1, '#1d3f7a');
  ctx.fillStyle = sea;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = 'rgba(110,170,110,0.85)';
  for (const [dx, dy, rx, ry] of [
    [-0.35, -0.2, 0.32, 0.22],
    [0.25, 0.25, 0.28, 0.18],
    [0.4, -0.45, 0.18, 0.12],
  ] as const) {
    ctx.beginPath();
    ctx.ellipse(x + dx * r, y + dy * r, rx * r, ry * r, 0.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath();
  ctx.ellipse(x - 0.1 * r, y + 0.05 * r, 0.7 * r, 0.12 * r, -0.3, 0, Math.PI * 2);
  ctx.fill();
  // Night falls on half of it.
  const shade = ctx.createLinearGradient(x - r, y, x + r, y);
  shade.addColorStop(0.45, 'rgba(0,0,8,0)');
  shade.addColorStop(1, 'rgba(0,0,8,0.75)');
  ctx.fillStyle = shade;
  ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
  ctx.restore();
}

function aurora(ctx: CanvasRenderingContext2D, v: View, horizonY: number, time: number): void {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let band = 0; band < 2; band++) {
    const g = ctx.createLinearGradient(0, horizonY * 0.1, 0, horizonY * 0.75);
    g.addColorStop(0, 'rgba(90,255,170,0)');
    g.addColorStop(0.5, `rgba(90,255,170,${band ? 0.07 : 0.1})`);
    g.addColorStop(1, 'rgba(90,255,170,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, horizonY * 0.75);
    for (let x = 0; x <= v.w; x += 24) {
      const y = horizonY * (0.32 + band * 0.12) + Math.sin(x * 0.006 + time * 0.35 + band * 2) * horizonY * 0.1;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(v.w, horizonY * 0.75);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

type Map2D = (x: number, y: number) => [number, number];
type Draw = (ctx: CanvasRenderingContext2D, m: Map2D, k: number) => void;

/** Each zoo's skyline beyond the wall, in its own shapes. Coordinates in far meters (x along, y up). */
function buildSkyline(place: PlaceId, rng: () => number, out: Draw[]): void {
  const span = { from: -14, to: 26 };
  const hills = (amp: number, base: number, freq: number, phase: number): Draw => (ctx, m) => {
    ctx.beginPath();
    const [x0, y0] = m(span.from, 0);
    ctx.moveTo(x0, y0);
    for (let x = span.from; x <= span.to; x += 0.25) {
      const y = base + amp * (0.6 * Math.sin(x * freq + phase) + 0.4 * Math.sin(x * freq * 2.3 + phase * 1.7));
      const [px, py] = m(x, Math.max(0, y));
      ctx.lineTo(px, py);
    }
    const [x1, y1] = m(span.to, 0);
    ctx.lineTo(x1, y1);
    ctx.closePath();
    ctx.fill();
  };
  const each = (step: number, jitter: number, make: (x: number) => Draw | null): void => {
    for (let x = span.from; x < span.to; x += step * (0.6 + rng() * 0.8)) {
      const d = make(x + (rng() - 0.5) * jitter);
      if (d) out.push(d);
    }
  };
  if (place === 'home') {
    each(1.1, 0.4, (x) => {
      const w = 0.7 + rng() * 0.7;
      const h = 0.45 + rng() * 0.6;
      const lit = Array.from({ length: 4 }, () => rng() < 0.4);
      const chimney = rng() < 0.6;
      return (ctx, m, k) => {
        const [l, b] = m(x - w / 2, 0);
        const [r, t] = m(x + w / 2, h);
        ctx.fillRect(l, t, r - l, b - t);
        const [, roof] = m(x, h + w * 0.45);
        ctx.beginPath();
        ctx.moveTo(l - 2, t);
        ctx.lineTo((l + r) / 2, roof);
        ctx.lineTo(r + 2, t);
        ctx.fill();
        if (chimney) {
          const [cl, ct] = m(x + w * 0.2, h + w * 0.42);
          ctx.fillRect(cl, ct, 0.08 * k, 0.2 * k);
        }
        lit.forEach((on, i) => {
          if (!on) return;
          const [wx, wy] = m(x - w / 2 + (0.18 + (i % 2) * 0.42) * w, h * (0.35 + Math.floor(i / 2) * 0.35));
          ctx.fillStyle = 'rgba(255,200,120,0.75)';
          ctx.fillRect(wx, wy, 0.07 * k, 0.09 * k);
          ctx.fillStyle = PALETTE.home.far;
        });
      };
    });
  } else if (place === 'arctic') {
    out.push(hills(0.35, 0.45, 0.9, 1.3));
    each(0.9, 0.5, (x) => {
      const h = 0.4 + rng() * 0.5;
      return (ctx, m) => {
        for (let tier = 0; tier < 3; tier++) {
          const w = h * (0.5 - tier * 0.12);
          const base = tier * h * 0.28;
          const [l, b] = m(x - w / 2, base);
          const [r] = m(x + w / 2, base);
          const [, t] = m(x, base + h * 0.45);
          ctx.beginPath();
          ctx.moveTo(l, b);
          ctx.lineTo((l + r) / 2, t);
          ctx.lineTo(r, b);
          ctx.fill();
        }
      };
    });
    out.push((ctx, m) => {
      const [cx, cy] = m(6, 0);
      const [rx] = m(6.6, 0);
      ctx.beginPath();
      ctx.arc(cx, cy, rx - cx, Math.PI, 0);
      ctx.fill();
    });
  } else if (place === 'sahara') {
    out.push(hills(0.25, 0.3, 0.55, 0.4));
    out.push(hills(0.18, 0.12, 0.9, 2.1));
    each(2.6, 1, (x) => {
      const h = 0.7 + rng() * 0.4;
      const lean = (rng() - 0.5) * 0.3;
      return (ctx, m, k) => {
        const [bx, by] = m(x, 0.1);
        const [tx, ty] = m(x + lean, h);
        ctx.lineWidth = 0.035 * k;
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.quadraticCurveTo(bx + (tx - bx) * 0.2, (by + ty) / 2, tx, ty);
        ctx.stroke();
        for (let f = 0; f < 6; f++) {
          const a = (f / 6) * Math.PI * 2;
          const fx = tx + Math.cos(a) * 0.32 * k;
          const fy = ty + Math.sin(a) * 0.12 * k + 0.08 * k;
          ctx.lineWidth = 0.025 * k;
          ctx.beginPath();
          ctx.moveTo(tx, ty);
          ctx.quadraticCurveTo((tx + fx) / 2, ty - 0.08 * k, fx, fy);
          ctx.stroke();
        }
      };
    });
  } else if (place === 'amazon') {
    out.push(hills(0.15, 0.55, 1.2, 0.2));
    each(0.55, 0.3, (x) => {
      const h = 0.8 + rng() * 0.8;
      const crown = 0.3 + rng() * 0.3;
      const blobs = Array.from({ length: 5 }, () => [(rng() - 0.5) * crown * 1.6, (rng() - 0.3) * crown, crown * (0.5 + rng() * 0.5)] as const);
      const vine = rng() < 0.5;
      return (ctx, m, k) => {
        const [bx, by] = m(x, 0);
        const [, ty] = m(x, h);
        ctx.fillRect(bx - 0.03 * k, ty, 0.06 * k, by - ty);
        for (const [dx, dy, r] of blobs) {
          const [px, py] = m(x + dx, h + dy);
          ctx.beginPath();
          ctx.arc(px, py, r * k, 0, Math.PI * 2);
          ctx.fill();
        }
        if (vine) {
          const [vx, vy] = m(x + crown * 0.6, h - crown * 0.2);
          ctx.lineWidth = 0.012 * k;
          ctx.beginPath();
          ctx.moveTo(vx, vy);
          ctx.quadraticCurveTo(vx + 0.05 * k, vy + 0.3 * k, vx - 0.02 * k, vy + 0.55 * k);
          ctx.stroke();
        }
      };
    });
  } else if (place === 'outback') {
    each(3.2, 1, (x) => {
      const w = 1.2 + rng() * 1.6;
      const h = 0.35 + rng() * 0.35;
      return (ctx, m) => {
        const [l, b] = m(x - w / 2, 0);
        const [r] = m(x + w / 2, 0);
        const [tl, t] = m(x - w * 0.32, h);
        const [tr] = m(x + w * 0.3, h);
        ctx.beginPath();
        ctx.moveTo(l, b);
        ctx.lineTo(tl, t);
        ctx.lineTo(tr, t);
        ctx.lineTo(r, b);
        ctx.closePath();
        ctx.fill();
      };
    });
    each(1.4, 0.6, (x) =>
      rng() < 0.6
        ? (ctx, m, k) => {
            const [bx, by] = m(x, 0);
            const [, ty] = m(x, 0.55);
            ctx.lineWidth = 0.02 * k;
            ctx.beginPath();
            ctx.moveTo(bx, by);
            ctx.lineTo(bx + 0.03 * k, ty);
            ctx.stroke();
            for (const [dx, dy] of [
              [-0.12, 0],
              [0.1, 0.05],
              [0, 0.12],
            ] as const) {
              ctx.beginPath();
              ctx.arc(bx + dx * k, ty - dy * k, 0.1 * k, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        : null,
    );
    out.push((ctx, m, k) => {
      const [bx, by] = m(9, 0);
      const [, ty] = m(9, 0.9);
      ctx.lineWidth = 0.02 * k;
      ctx.beginPath();
      ctx.moveTo(bx - 0.12 * k, by);
      ctx.lineTo(bx, ty);
      ctx.lineTo(bx + 0.12 * k, by);
      ctx.stroke();
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(bx, ty);
        ctx.lineTo(bx + Math.cos(a) * 0.18 * k, ty + Math.sin(a) * 0.18 * k);
        ctx.stroke();
      }
    });
  } else {
    out.push(hills(0.12, 0.22, 0.5, 0.9));
    each(1.6, 0.8, (x) => {
      const r = 0.12 + rng() * 0.25;
      return (ctx, m, k) => {
        const [cx, cy] = m(x, 0.2);
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.22)';
        ctx.beginPath();
        ctx.ellipse(cx, cy, r * k, r * 0.28 * k, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      };
    });
  }
}
