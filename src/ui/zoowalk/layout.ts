import type { Pool } from '../../core/creature.js';
import type { CreatureId } from '../../core/library.js';

/** One enclosure on the zoo walk: a pool of lantern light on the zoo wall where its creatures live. */
export interface Enclosure {
  readonly species: CreatureId;
  readonly name: string;
  /** One true line about it, shown on its sign. */
  readonly fact: string;
  /** How many of its creatures live here. */
  readonly count: number;
  /** The middle of its pool of light, in meters along the walk. */
  readonly x: number;
}

export interface WalkLayout {
  /** Where the visitor starts, outside the gate. */
  readonly start: number;
  readonly gate: number;
  readonly enclosures: readonly Enclosure[];
  /** The lantern house at the end, where the zoo goes home with you. */
  readonly house: number;
  /** The farthest the visitor walks. */
  readonly end: number;
  /** Every enclosure's pool of light: half its width and half its height on the wall (meters). */
  readonly pool: Pool;
  /** Height of the pools' middle on the wall (meters above the wall's middle). */
  readonly poolY: number;
}

/** The enclosures in walking order: every creature in the game, in the order they join a zoo. */
export const ENCLOSURES: readonly Omit<Enclosure, 'x'>[] = [
  { species: 'rabbit', name: 'Rabbit Warren', fact: 'Index and middle fingers up, the others folded: a rabbit. It hops.', count: 3 },
  { species: 'dog', name: 'Dog Yard', fact: 'Dogs trot about. Wear the dog at home and snap its jaw: it barks.', count: 2 },
  { species: 'crocodile', name: 'Crocodile Pool', fact: 'Crocodiles slither along the bank, jaws first.', count: 2 },
  { species: 'peacock', name: 'Peacock Garden', fact: 'Peacocks strut with their tails spread wide.', count: 2 },
  { species: 'spider', name: 'Spider House', fact: 'Spiders dangle on a thread from the top of the light.', count: 2 },
  { species: 'turtle', name: 'Turtle Beach', fact: 'Turtles creep along and tuck their heads in.', count: 3 },
  { species: 'bird', name: 'Bird Aviary', fact: 'The bird takes two hands: hook your thumbs and spread your fingers.', count: 2 },
];

const START = -2.2;
const GATE = 0;
const FIRST = 2.6;
const SPACING = 2.5;
const HOUSE_GAP = 3;
/** The scenery runs this far past either end of the walk. */
const SCENERY_MARGIN = 1;

/** The walk from the gate past every enclosure to the lantern house (meters along the zoo wall). */
export function walkLayout(): WalkLayout {
  const enclosures = ENCLOSURES.map((e, i) => ({ ...e, x: FIRST + i * SPACING }));
  const house = enclosures[enclosures.length - 1].x + HOUSE_GAP;
  return { start: START, gate: GATE, enclosures, house, end: house + 0.4, pool: { u: 0.9, v: 0.6 }, poolY: 0.1 };
}

/** The enclosure the visitor stands at: the nearest one within reach, or none between enclosures. */
export function enclosureAt(layout: WalkLayout, x: number, reach = layout.pool.u * 1.25): Enclosure | null {
  let best: Enclosure | null = null;
  let bestDist = reach;
  for (const e of layout.enclosures) {
    const d = Math.abs(e.x - x);
    if (d <= bestDist) {
      bestDist = d;
      best = e;
    }
  }
  return best;
}

/** A point on the wall inside an enclosure's light, in that enclosure's own pool coordinates. */
export interface PoolHit {
  readonly enclosure: Enclosure;
  readonly x: number;
  readonly y: number;
}

/** The enclosure lit at a point on the wall, if any, with the point in its pool's coordinates. */
export function poolAt(layout: WalkLayout, wx: number, wy: number): PoolHit | null {
  const y = wy - layout.poolY;
  if (Math.abs(y) > layout.pool.v * 1.05) return null;
  for (const enclosure of layout.enclosures) {
    const x = wx - enclosure.x;
    if (Math.abs(x) <= layout.pool.u * 1.05) return { enclosure, x, y };
  }
  return null;
}

/** One step of walking toward a target at a steady pace, never past it and never off the path. */
export function walkToward(layout: WalkLayout, from: number, to: number, dt: number, speed: number): number {
  const gap = to - from;
  const step = Math.sign(gap) * Math.min(Math.abs(gap), speed * dt);
  return Math.min(layout.end, Math.max(layout.start, from + step));
}

/** Where the camera looks: at the visitor, kept on the scenery at either end of the walk. */
export function cameraFor(layout: WalkLayout, visitorX: number, halfView: number): number {
  const lo = layout.start - SCENERY_MARGIN + halfView;
  const hi = layout.end + SCENERY_MARGIN - halfView;
  if (lo > hi) return (layout.start + layout.end) / 2;
  return Math.min(hi, Math.max(lo, visitorX));
}
