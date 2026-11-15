import { describe, expect, it } from 'vitest';
import { freshSave, type SaveData } from '../../src/core/save.js';
import type { PlaceId } from '../../src/core/world.js';
import { passportSummary, shortestTurn, stampLine } from '../../src/ui/atlas.js';

const save = (stamps: PlaceId[], unlocked: SaveData['unlocked'] = []): SaveData => ({ ...freshSave(), stamps, unlocked });

describe('the homepage passport', () => {
  it('invites a first visit when nothing is saved yet', () => {
    expect(passportSummary(null)).toMatch(/^Your passport is empty\. 5 stamps wait around the world/);
    expect(passportSummary(save([]))).toBe(passportSummary(null));
  });

  it('counts stamps first, then creatures', () => {
    expect(passportSummary(save(['sahara']))).toBe('1 of 5 stamps collected, no creatures found yet.');
    expect(passportSummary(save(['sahara', 'moon'], ['rabbit', 'dog', 'crocodile']))).toBe('2 of 5 stamps collected, 3 of 7 creatures found.');
    expect(passportSummary(save([], ['rabbit']))).toBe('No stamps yet, 1 of 7 creatures found.');
  });

  it('celebrates a full passport', () => {
    const all = save(['arctic', 'sahara', 'amazon', 'outback', 'moon'], ['rabbit', 'dog', 'crocodile', 'peacock', 'spider', 'turtle', 'bird']);
    expect(passportSummary(all)).toBe('All 5 stamps collected, 7 of 7 creatures found.');
  });

  it("says whether the chosen zoo's stamp is earned; home never has one", () => {
    expect(stampLine('home', save(['moon']))).toMatch(/^No stamp here/);
    expect(stampLine('moon', save(['moon']))).toBe('Stamped in your passport.');
    expect(stampLine('arctic', save(['moon']))).toBe('Your first visit earns a passport stamp.');
    expect(stampLine('arctic', null)).toBe('Your first visit earns a passport stamp.');
  });
});

describe('the homepage globe', () => {
  it('turns the short way round to a zoo', () => {
    expect(shortestTurn(0, 1)).toBeCloseTo(1);
    // From just short of half a turn one way to just short of it the other: across the back, not all the way round.
    expect(shortestTurn(3, -3)).toBeCloseTo(2 * Math.PI - 6);
    expect(shortestTurn(-3, 3)).toBeCloseTo(6 - 2 * Math.PI);
  });
});
