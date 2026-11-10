import { describe, expect, it } from 'vitest';
import { dailyVisitor, dayDiff, localDay, visitToday } from '../../src/core/daily.js';
import type { CreatureId } from '../../src/core/library.js';
import { freshSave } from '../../src/core/save.js';

describe('days', () => {
  it('formats local dates and counts days between them', () => {
    expect(localDay(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
    expect(dayDiff('2026-12-31', '2027-01-01')).toBe(1);
    expect(dayDiff('2026-11-01', '2026-11-10')).toBe(9);
  });

  it('starts, keeps, grows and resets the streak', () => {
    const save = freshSave();
    expect(visitToday(save, '2026-11-10')).toBe('first');
    expect(save.streak).toBe(1);
    expect(visitToday(save, '2026-11-10')).toBe('same-day');
    expect(save.streak).toBe(1);
    expect(visitToday(save, '2026-11-11')).toBe('next-day');
    expect(save.streak).toBe(2);
    expect(visitToday(save, '2026-11-15')).toBe('returning');
    expect(save.streak).toBe(1);
    expect(save.lastDay).toBe('2026-11-15');
  });
});

describe('dailyVisitor', () => {
  const zoo: CreatureId[] = ['rabbit', 'dog', 'crocodile', 'peacock', 'spider', 'turtle'];

  it('is null without creatures and stable within a day', () => {
    expect(dailyVisitor('2026-11-10', [])).toBeNull();
    expect(dailyVisitor('2026-11-10', zoo)).toEqual(dailyVisitor('2026-11-10', zoo));
  });

  it('varies across days and uses both twists', () => {
    const species = new Set<string>();
    const twists = new Set<string>();
    for (let d = 1; d <= 30; d++) {
      const v = dailyVisitor(`2026-11-${String(d).padStart(2, '0')}`, zoo)!;
      expect(zoo).toContain(v.species);
      species.add(v.species);
      twists.add(v.twist);
    }
    expect(species.size).toBeGreaterThan(2);
    expect(twists).toEqual(new Set(['steady', 'big']));
  });
});
