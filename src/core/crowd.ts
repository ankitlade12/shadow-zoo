import { airborne, groundY, halfWidthAt, type Creature, type Pool } from './creature.js';

/** Ground-line width one creature needs, in body sizes: silhouettes run 1.1–1.8 sizes wide, plus a little air. */
const WIDTH_PER_SIZE = 1.5;
/** The zoo never shrinks creatures below this share of the pool's half-width. */
const MIN_SIZE = 0.17;
/** How far from the middle of its gap a walker may settle, as a share of the gap. */
const JITTER = 0.25;

/** The silhouette size (sqrt of area, meters) at which `count` creatures fit side by side on the ground line. */
export function zooSize(pool: Pool, count: number): number {
  const ground = 2 * halfWidthAt(pool, groundY(pool));
  return Math.max(MIN_SIZE * pool.u, ground / (Math.max(1, count) * WIDTH_PER_SIZE));
}

/**
 * Where a walker wanders to: near the middle of its own gap between its neighbors on the ground
 * line, so the zoo spreads out evenly and nobody walks through anybody. The pool's edges act as
 * mirrors, so the outermost walkers settle toward the edge. A lone walker roams the whole line.
 * `jitter` (-1..1) keeps the spacing from looking drilled.
 */
export function spreadSpot(self: Creature, creatures: readonly Creature[], halfWidth: number, jitter: number): number {
  let left = -Infinity;
  let right = Infinity;
  for (const c of creatures) {
    if (c === self || airborne(c.motion)) continue;
    const x = c.spotX;
    if (x < self.x || (x === self.x && c.id < self.id)) left = Math.max(left, x);
    else right = Math.min(right, x);
  }
  if (left === -Infinity && right === Infinity) return jitter * halfWidth;
  if (left === -Infinity) left = -2 * halfWidth - right;
  if (right === Infinity) right = 2 * halfWidth - left;
  const x = (left + right) / 2 + jitter * JITTER * (right - left);
  return Math.min(halfWidth, Math.max(-halfWidth, x));
}
