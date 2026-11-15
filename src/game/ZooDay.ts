/** What the keeper calls in a zoo day: feeding time, or show time. */
export type ZooMoment = 'feeding' | 'show';

/** Seconds of play (while the zoo is ready) before the first feeding time. */
export const FIRST_MOMENT = 40;
/** Seconds of play between one moment and the next. */
export const BETWEEN_MOMENTS = 70;

/**
 * A zoo's day, like a real zoo's timetable: once the tutorial is over, feeding time and show time take
 * turns. The clock only runs while the zoo is ready for them (creatures to play with, nothing else on
 * the wall), so a moment never interrupts. Pure game logic.
 */
export class ZooDay {
  private wait = FIRST_MOMENT;
  private next: ZooMoment = 'feeding';

  /** Advances the clock; returns the moment that falls due this frame, if any. */
  update(dt: number, ready: boolean): ZooMoment | null {
    if (!ready) return null;
    this.wait -= dt;
    if (this.wait > 0) return null;
    const moment = this.next;
    this.next = moment === 'feeding' ? 'show' : 'feeding';
    this.wait = BETWEEN_MOMENTS;
    return moment;
  }
}
