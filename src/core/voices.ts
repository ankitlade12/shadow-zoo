/** Keeps sound playback pleasant: no rapid repeats of one sound and a cap on overlapping voices. */
export class VoiceLimiter {
  private readonly last = new Map<string, number>();
  private readonly ends: number[] = [];

  constructor(
    private readonly minGap = 0.08,
    private readonly maxVoices = 8,
  ) {}

  allow(name: string, now: number, duration: number): boolean {
    for (let i = this.ends.length - 1; i >= 0; i--) if (this.ends[i] <= now) this.ends.splice(i, 1);
    if (this.ends.length >= this.maxVoices) return false;
    const previous = this.last.get(name);
    if (previous !== undefined && now - previous < this.minGap) return false;
    this.last.set(name, now);
    this.ends.push(now + duration);
    return true;
  }
}
