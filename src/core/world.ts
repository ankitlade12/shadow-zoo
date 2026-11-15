/**
 * The World Tour: the places to travel to, how each one changes the zoo, and the globe of light and
 * shadow they are picked from. Pure data and math, no rendering.
 */

export type PlaceId = 'home' | 'arctic' | 'sahara' | 'amazon' | 'outback' | 'moon';
export type Weather = 'none' | 'snow' | 'sand' | 'rain' | 'dust';

/** How a place changes the zoo's physics and play. */
export interface Rules {
  /** Gravity on tumbling walkers, as a share of the usual pull. */
  readonly gravity: number;
  /** Share of its falling speed a tumbling walker keeps when it hits the ground. */
  readonly bounce: number;
  /** On ice: share of its sliding speed a landed walker keeps per second (0: it stops where it lands). */
  readonly slide: number;
  /** A steady wind along the wall, in light-pool half-heights per second squared (positive blows right). */
  readonly wind: number;
  /** Fireflies one pinch releases. */
  readonly fireflies: number;
}

export const HOME_RULES: Rules = { gravity: 1, bounce: 0.42, slide: 0, wind: 0, fireflies: 1 };

export interface Place {
  readonly id: PlaceId;
  readonly name: string;
  /** Where it sits on the globe (degrees). Home and the Moon float beside the globe instead. */
  readonly at: { readonly lat: number; readonly lon: number } | null;
  /** The lantern's color there (RGB, 0 to 1). */
  readonly light: readonly [number, number, number];
  readonly weather: Weather;
  readonly rules: Rules;
  /** The caption while a hand shadow hovers over it on the globe. */
  readonly hover: string;
  /** The caption on arrival. */
  readonly arrival: string;
}

export const PLACES: readonly Place[] = [
  {
    id: 'home',
    name: 'Home',
    at: null,
    light: [1, 0.76, 0.48],
    weather: 'none',
    rules: HOME_RULES,
    hover: 'Home: your own wall. Pinch to go back',
    arrival: 'Home again: your lantern, your wall',
  },
  {
    id: 'arctic',
    name: 'The Arctic',
    at: { lat: 78, lon: 16 },
    light: [0.6, 0.8, 1],
    weather: 'snow',
    rules: { ...HOME_RULES, bounce: 0.25, slide: 0.45 },
    hover: 'The Arctic: an ice zoo. Pinch to travel',
    arrival: 'The Arctic! On the ice, everything slides',
  },
  {
    id: 'sahara',
    name: 'The Sahara',
    at: { lat: 23, lon: 8 },
    light: [1, 0.6, 0.3],
    weather: 'sand',
    rules: { ...HOME_RULES, wind: 1.4 },
    hover: 'The Sahara: a windy zoo. Pinch to travel',
    arrival: 'The Sahara! The wind blows everything east',
  },
  {
    id: 'amazon',
    name: 'The Amazon',
    at: { lat: -3, lon: -62 },
    light: [0.62, 0.95, 0.55],
    weather: 'rain',
    rules: { ...HOME_RULES, fireflies: 3 },
    hover: 'The Amazon: a firefly zoo. Pinch to travel',
    arrival: 'The Amazon! Pinch for a swarm of fireflies',
  },
  {
    id: 'outback',
    name: 'The Outback',
    at: { lat: -25, lon: 133 },
    light: [1, 0.5, 0.32],
    weather: 'none',
    rules: { ...HOME_RULES, bounce: 0.8 },
    hover: 'The Outback: a bouncy zoo. Pinch to travel',
    arrival: 'The Outback! Everything bounces sky-high',
  },
  {
    id: 'moon',
    name: 'The Moon',
    at: null,
    light: [0.8, 0.86, 1],
    weather: 'dust',
    rules: { ...HOME_RULES, gravity: 0.18, bounce: 0.55 },
    hover: 'The Moon: low gravity. Pinch to travel',
    arrival: 'The Moon! Throw them and watch them float',
  },
];

export const PLACE_IDS: readonly PlaceId[] = PLACES.map((p) => p.id);

export const placeOf = (id: PlaceId): Place => PLACES.find((p) => p.id === id) ?? PLACES[0];

/**
 * Land on a 5-degree grid, rasterized from Natural Earth's 1:110m land polygons (public domain): 36
 * rows from the North Pole down, 72 columns from 180 degrees west, four columns per hex digit.
 */
const LAND: readonly string[] = [
  '000000000000000000',
  '00003fff8000000000',
  '00037bff030081c000',
  '081efc7f00437fffe0',
  'dffff67e81ffffffff',
  '1fffde3087ffffffff',
  '0c7fcf0017ffffff18',
  '003fff803fffffff90',
  '001fff001fffffff80',
  '001ffc003ffffffe80',
  '001ff8003cfffff500',
  '000ff0003efffff200',
  '000790007ffffff000',
  '000180007fff3fe000',
  '0001e000fffe39c000',
  '000034007ffc11c800',
  '00000f807ffc000000',
  '00000fc003fc01b800',
  '00000ff003f000b980',
  '00000ff803f00000c0',
  '00000ff803f0000280',
  '000007f003f4000f80',
  '000003f001ec001fc0',
  '000003c001e0001fe0',
  '000007c001c0001fe0',
  '0000078000000000c0',
  '000007000000000002',
  '000006000000000000',
  '000006000000000000',
  '000000000000000000',
  '000000000000000000',
  '00000200000fcfffe0',
  '0000ff007ffffffffc',
  '07fffc27fffffffff8',
  '03fffffffffffffffc',
  'ffffffffffffffffff',
];

/** Whether a point on Earth is land, on the 5-degree grid. */
export function isLand(lat: number, lon: number): boolean {
  const row = Math.min(35, Math.max(0, Math.floor((90 - lat) / 5)));
  const col = (((Math.floor((lon + 180) / 5) % 72) + 72) % 72);
  return ((parseInt(LAND[row][col >> 2], 16) >> (3 - (col & 3))) & 1) === 1;
}

export interface LatLon {
  readonly lat: number;
  readonly lon: number;
}

/** The globe's land dots: grid cell centers, thinned toward the poles so the dots stay evenly spaced. */
export const GLOBE_DOTS: readonly LatLon[] = (() => {
  const dots: LatLon[] = [];
  for (let row = 0; row < 36; row++) {
    const lat = 87.5 - row * 5;
    const step = Math.max(1, Math.round(1 / Math.cos((lat * Math.PI) / 180)));
    for (let col = 0; col < 72; col += step) {
      const lon = -177.5 + col * 5;
      if (isLand(lat, lon)) dots.push({ lat, lon });
    }
  }
  return dots;
})();

/** Where the globe sits on the stage (meters), how big, and how it is turned (radians). */
export interface GlobeView {
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
  /** Turn about the poles: the longitude facing the player. */
  readonly yaw: number;
  /** How far the North Pole tips toward the player. */
  readonly tilt: number;
}

export interface Projected {
  x: number;
  y: number;
  /** -1 (far side) to 1 (facing the player); visible above 0. */
  depth: number;
}

const DEG = Math.PI / 180;

/** Orthographic projection of a point on the globe onto the stage. */
export function projectGlobe(lat: number, lon: number, view: GlobeView, out: Projected): Projected {
  const phi = lat * DEG;
  const lambda = lon * DEG - view.yaw;
  const x = Math.cos(phi) * Math.sin(lambda);
  const y = Math.sin(phi);
  const z = Math.cos(phi) * Math.cos(lambda);
  const ct = Math.cos(view.tilt);
  const st = Math.sin(view.tilt);
  out.x = view.cx + x * view.r;
  out.y = view.cy + (y * ct - z * st) * view.r;
  out.depth = y * st + z * ct;
  return out;
}

/** The yaw that brings a longitude to the front of the globe. */
export const yawFacing = (lon: number): number => lon * DEG;

export interface Marker {
  readonly id: PlaceId;
  x: number;
  y: number;
  /** Visible and pickable (on the near side of the globe, or floating beside it). */
  visible: boolean;
  /** 0 to 1: how much it faces the player (markers near the rim shrink). */
  facing: number;
}

/**
 * Every place's marker this moment: globe places where the globe turns them, home's lantern below
 * left of the globe and the Moon slowly orbiting above right.
 */
export function placeMarkers(view: GlobeView, time: number, out: Marker[] = []): Marker[] {
  const p: Projected = { x: 0, y: 0, depth: 0 };
  PLACES.forEach((place, i) => {
    let m = out[i];
    if (!m) m = out[i] = { id: place.id, x: 0, y: 0, visible: false, facing: 0 };
    if (place.at) {
      projectGlobe(place.at.lat, place.at.lon, view, p);
      m.x = p.x;
      m.y = p.y;
      m.facing = Math.max(0, p.depth);
      m.visible = p.depth > 0.12;
    } else {
      const angle = place.id === 'moon' ? (40 + 18 * Math.sin(time * 0.25)) * DEG : 215 * DEG;
      m.x = view.cx + Math.cos(angle) * view.r * 1.38;
      m.y = view.cy + Math.sin(angle) * view.r * 1.12;
      m.facing = 1;
      m.visible = true;
    }
  });
  out.length = PLACES.length;
  return out;
}

/** The place whose marker is within reach of a point, nearest first; null if none. */
export function markerAt(markers: readonly Marker[], x: number, y: number, reach: number): PlaceId | null {
  let best: PlaceId | null = null;
  let bestDist = reach;
  for (const m of markers) {
    if (!m.visible) continue;
    const d = Math.hypot(m.x - x, m.y - y);
    if (d <= bestDist) {
      bestDist = d;
      best = m.id;
    }
  }
  return best;
}
