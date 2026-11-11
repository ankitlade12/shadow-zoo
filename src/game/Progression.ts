import { dailyVisitor, type Twist } from '../core/daily.js';
import type { CreatureId } from '../core/library.js';
import type { SaveData } from '../core/save.js';

/** The order creatures come to life: the two-handed bird right after the three guided ones. */
export const ORDER: readonly CreatureId[] = ['rabbit', 'dog', 'crocodile', 'bird', 'peacock', 'spider', 'turtle'];
/** The first visitors arrive back to back; later ones after a little play. */
const GUIDED = 3;
const PLAY_SECONDS = 45;
const PLAY_EATS = 3;

export interface VisitorPlan {
  readonly species: CreatureId;
  readonly kind: 'new' | 'daily';
  readonly twist: Twist | null;
}

/** Stars for a match by how quickly it happened. */
export const starsFor = (seconds: number): number => (seconds <= 6 ? 3 : seconds <= 15 ? 2 : 1);

/** Decides which visitor comes next and records what each match earns. */
export class Progression {
  private sinceUnlock = 0;
  private eatsSinceUnlock = 0;

  constructor(
    private readonly save: SaveData,
    private readonly today: string,
  ) {}

  tick(dt: number): void {
    this.sinceUnlock += dt;
  }

  onEat(): void {
    this.eatsSinceUnlock++;
  }

  /** The next visitor, or null when the player should play a little first (or today's visitor is done). */
  nextVisitor(): VisitorPlan | null {
    const next = ORDER.find((id) => !this.save.unlocked.includes(id));
    if (next) {
      const ready = this.save.unlocked.length < GUIDED || this.sinceUnlock >= PLAY_SECONDS || this.eatsSinceUnlock >= PLAY_EATS;
      return ready ? { species: next, kind: 'new', twist: null } : null;
    }
    if (this.save.dailyDone === this.today) return null;
    const daily = dailyVisitor(this.today, this.save.unlocked);
    return daily ? { species: daily.species, kind: 'daily', twist: daily.twist } : null;
  }

  /** Records a matched visitor and returns the stars it earned. */
  onRevealed(plan: VisitorPlan, seconds: number): number {
    if (plan.kind === 'new') {
      if (!this.save.unlocked.includes(plan.species)) this.save.unlocked.push(plan.species);
      this.sinceUnlock = 0;
      this.eatsSinceUnlock = 0;
    } else {
      this.save.dailyDone = this.today;
      this.save.embers += 1;
    }
    const stars = starsFor(seconds);
    this.save.stars[plan.species] = Math.max(this.save.stars[plan.species] ?? 0, stars);
    return stars;
  }
}
