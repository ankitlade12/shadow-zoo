import { describe, expect, it } from 'vitest';
import { buildCreatureShapes, CREATURES } from '../../src/core/library.js';
import { mulberry32 } from '../../src/core/rng.js';
import { freshSave } from '../../src/core/save.js';
import { Silhouettes } from '../../src/core/silhouette.js';
import { captionFor } from '../../src/game/Onboarding.js';
import { revealMessage, starText, zooComplete, zooProgress } from '../../src/game/rewards.js';
import { Zoo } from '../../src/game/Zoo.js';

describe('rewards', () => {
  it('shows the stars a match earned, out of three', () => {
    expect(starText(3)).toBe('★★★');
    expect(starText(2)).toBe('★★☆');
    expect(starText(1)).toBe('★☆☆');
  });

  it('names the creature that joins, or comes back to visit, with its stars', () => {
    expect(revealMessage('Rabbit', 'new', 3, false)).toBe('Rabbit joins your zoo! ★★★');
    expect(revealMessage('Dog', 'daily', 2, false)).toBe('Dog came back to visit! ★★☆');
  });

  it('celebrates the last creature as a complete zoo', () => {
    expect(revealMessage('Turtle', 'new', 1, true)).toBe('Your zoo is complete! ★☆☆');
  });

  it('counts the creatures found and the stars earned', () => {
    const save = freshSave();
    expect(zooProgress(save)).toBe(`0 of ${CREATURES.length} creatures found`);
    save.unlocked = ['rabbit', 'dog', 'bird'];
    save.stars = { rabbit: 3, dog: 2, bird: 1 };
    expect(zooProgress(save)).toBe(`3 of ${CREATURES.length} creatures found, 6 stars`);
    expect(zooComplete(save)).toBe(false);
    save.unlocked = CREATURES.map((c) => c.id);
    expect(zooComplete(save)).toBe(true);
  });

  it('announcements outrank every other caption for their moment', () => {
    const base = { step: 'feed', visitor: null, twist: null, visitorElapsed: 0, visitorProgress: 0, handsMissing: 9, welcome: 0, streak: 1 } as const;
    expect(captionFor({ ...base, announce: 'Rabbit joins your zoo! ★★★' })).toBe('Rabbit joins your zoo! ★★★');
    expect(captionFor({ ...base, announce: null })).toBe('Show your hands to the lantern');
  });
});

describe('the finale', () => {
  it('sets every creature in the zoo celebrating with a trick', () => {
    const sil = new Silhouettes();
    const zoo = new Zoo(buildCreatureShapes(sil), mulberry32(5));
    const pool = { u: 0.8, v: 0.6 };
    CREATURES.forEach((def, i) => zoo.add({ species: def.id, x: -0.5 + i * 0.15, y: 0, size: 0.2, scale: 1 }, [], { silent: true }));
    // Let them finish appearing; the finale doesn't cut an entrance short.
    for (let t = 0; t < 1; t += 1 / 60) zoo.update(1 / 60, pool, [], null, []);
    zoo.finale(pool);
    for (let t = 0; t < 0.3; t += 1 / 60) zoo.update(1 / 60, pool, [], null, []);
    for (const c of zoo.creatures) {
      expect(c.mode).toBe('happy');
      expect(c.spin).toBeGreaterThan(0);
    }
  });
});
