import { describe, expect, it } from 'vitest';
import { freshSave } from '../../src/core/save.js';
import { captionFor, Onboarding, showGhost, type CaptionInput } from '../../src/game/Onboarding.js';
import { Progression, starsFor } from '../../src/game/Progression.js';

const today = '2026-11-10';

describe('Progression', () => {
  it('sends the first three creatures back to back, in order', () => {
    const save = freshSave();
    const p = new Progression(save, today);
    for (const id of ['rabbit', 'dog', 'crocodile'] as const) {
      const plan = p.nextVisitor()!;
      expect(plan).toEqual({ species: id, kind: 'new', twist: null });
      p.onRevealed(plan, 4);
    }
    expect(save.unlocked).toEqual(['rabbit', 'dog', 'crocodile']);
  });

  it('holds later creatures until 45 s of play or three feedings', () => {
    const save = freshSave();
    save.unlocked = ['rabbit', 'dog', 'crocodile'];
    const byTime = new Progression(save, today);
    expect(byTime.nextVisitor()).toBeNull();
    byTime.tick(45);
    expect(byTime.nextVisitor()?.species).toBe('peacock');
    const byFeeding = new Progression(save, today);
    for (let i = 0; i < 3; i++) byFeeding.onEat();
    expect(byFeeding.nextVisitor()?.species).toBe('peacock');
  });

  it('offers a daily visitor with a twist once the zoo is complete, once a day', () => {
    const save = freshSave();
    save.unlocked = ['rabbit', 'dog', 'crocodile', 'peacock', 'spider', 'turtle'];
    const p = new Progression(save, today);
    const plan = p.nextVisitor()!;
    expect(plan.kind).toBe('daily');
    expect(['steady', 'big']).toContain(plan.twist);
    p.onRevealed(plan, 20);
    expect(save.embers).toBe(1);
    expect(save.dailyDone).toBe(today);
    expect(p.nextVisitor()).toBeNull();
  });

  it('awards one to three stars by speed and keeps the best', () => {
    expect([starsFor(4), starsFor(10), starsFor(40)]).toEqual([3, 2, 1]);
    const save = freshSave();
    const p = new Progression(save, today);
    p.onRevealed({ species: 'rabbit', kind: 'new', twist: null }, 4);
    p.onRevealed({ species: 'rabbit', kind: 'daily', twist: 'big' }, 40);
    expect(save.stars.rabbit).toBe(3);
  });
});

describe('onboarding and captions', () => {
  const base: CaptionInput = { step: 'done', visitor: null, twist: null, visitorElapsed: 0, visitorProgress: 0, handsMissing: 0, welcome: 0, streak: 1 };

  it('walks a first-time player through rabbit, feeding and petting', () => {
    const o = new Onboarding(true);
    expect(o.step).toBe('make');
    o.onEat();
    expect(o.step).toBe('make');
    o.onReveal();
    expect(o.step).toBe('feed');
    o.onEat();
    expect(o.step).toBe('pet');
    o.onPet();
    expect(o.step).toBe('done');
    expect(new Onboarding(false).step).toBe('done');
  });

  it('shows the first rabbit with a caption and the ghost hand', () => {
    const input = { ...base, step: 'make' as const, visitor: 'rabbit' as const };
    expect(captionFor(input)).toBe('Make a rabbit with your hand');
    expect(showGhost(input)).toBe(true);
  });

  it('hints only after six seconds without progress', () => {
    const input = { ...base, visitor: 'dog' as const, visitorElapsed: 3 };
    expect(captionFor(input)).toBeNull();
    expect(showGhost(input)).toBe(false);
    const stuck = { ...input, visitorElapsed: 7, visitorProgress: 0.3 };
    expect(captionFor(stuck)).toBe('Copy the glowing shape');
    expect(showGhost(stuck)).toBe(true);
    expect(showGhost({ ...stuck, visitorProgress: 0.8 })).toBe(false);
  });

  it('prioritizes missing hands, then the welcome, then twists', () => {
    expect(captionFor({ ...base, handsMissing: 4, welcome: 2 })).toBe('Show your hands to the lantern');
    expect(captionFor({ ...base, welcome: 2, streak: 3 })).toBe('Welcome back! 3 nights in a row');
    expect(captionFor({ ...base, welcome: 2 })).toBe('Welcome back!');
    expect(captionFor({ ...base, visitor: 'rabbit', twist: 'big' })).toBe('A big visitor! Move your hand toward the light');
    expect(captionFor({ ...base, visitor: 'rabbit', twist: 'steady' })).toBe('A shy visitor. Hold the shape steady');
    expect(captionFor({ ...base, step: 'feed' })).toBe('Pinch to give it a firefly');
    expect(captionFor({ ...base, step: 'pet' })).toBe('Rest your shadow on it');
  });
});
