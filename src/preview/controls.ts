import { CREATURES, type CreatureId } from '../core/library.js';

/** What the desktop player is doing with the emulated hand, from the mouse and keyboard. */
export interface PreviewInput {
  /** The creature shape the hand holds, or null for a resting open hand. */
  shape: CreatureId | null;
  /** Space held: the shape's signature action (a jaw snapping shut, ears folding). */
  act: boolean;
  /** Mouse button held over the view: the hand pinches. */
  pinch: boolean;
  /** Hand distance from the lantern, relative to the comfortable distance (smaller casts a bigger shadow). */
  reach: number;
  /** Cursor over the view in normalized device coordinates, or null when it is elsewhere. */
  cursor: { x: number; y: number } | null;
}

export const REACH_MIN = 0.55;
export const REACH_MAX = 1.3;
const REACH_STEP = 1.08;

export const createPreviewInput = (): PreviewInput => ({ shape: null, act: false, pinch: false, reach: 1, cursor: null });

/** Keys 1 to 6 make the creatures' shapes in library order and 0 opens the hand; undefined for any other key. */
export function shapeForKey(key: string): CreatureId | null | undefined {
  if (key === '0') return null;
  if (!/^[1-9]$/.test(key)) return undefined;
  return CREATURES[Number(key) - 1]?.id;
}

/** Moves the hand toward the light (negative steps) or away from it (positive), within reach. */
export function nudgeReach(reach: number, steps: number): number {
  return Math.min(REACH_MAX, Math.max(REACH_MIN, reach * REACH_STEP ** steps));
}

/** The emulated hand's resting pose, and the ids of each creature's shape and action poses. */
export const REST_POSE = 'shadowzoo-rest';
export const creaturePoseId = (shape: CreatureId, act: boolean): string => `shadowzoo-${shape}${act ? '-act' : ''}`;

export function poseFor(input: Pick<PreviewInput, 'shape' | 'act'>): string {
  return input.shape ? creaturePoseId(input.shape, input.act) : REST_POSE;
}
