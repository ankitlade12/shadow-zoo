import { describe, expect, it } from 'vitest';
import { buildCreatureShapes, type CreatureId } from '../../src/core/library.js';
import { ShadowProjector } from '../../src/core/projector.js';
import { mulberry32 } from '../../src/core/rng.js';
import { freshSave, SAVE_KEY, type SaveData, type StoragePort } from '../../src/core/save.js';
import { Silhouettes } from '../../src/core/silhouette.js';
import type { GameEvent } from '../../src/game/events.js';
import { createHandShadow, type HandShadow } from '../../src/game/hands.js';
import { Session } from '../../src/game/Session.js';

const sil = new Silhouettes();
const shapes = buildCreatureShapes(sil);
const pool = { u: 0.8, v: 0.6 };
const projector = new ShadowProjector();
projector.setup([0, 0, 1], { origin: [0, 0, -1], u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] });

class MemoryStorage implements StoragePort {
  readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

const hand = (id: CreatureId | null): HandShadow => {
  const h = createHandShadow('right');
  if (!id) return h;
  const s = shapes.get(id)!;
  h.caps.set(s.caps);
  h.count = s.count;
  h.drawCount = s.count;
  h.tracked = true;
  return h;
};
const run = (session: Session, seconds: number, hands: HandShadow[], events: GameEvent[] = []) => {
  let view = session.update(0, hands, projector, pool, events);
  for (let t = 0; t < seconds; t += 1 / 30) view = session.update(1 / 30, hands, projector, pool, events);
  return view;
};
const at = (iso: string) => new Date(`${iso}T20:00:00`);
const withSave = (save: SaveData) => {
  const storage = new MemoryStorage();
  storage.setItem(SAVE_KEY, JSON.stringify(save));
  return storage;
};

describe('Session', () => {
  it('teaches a first-time player with the rabbit, then feeding, and saves progress', () => {
    const storage = new MemoryStorage();
    const session = new Session(shapes, sil, storage, at('2026-11-10'), mulberry32(1));
    session.onStage(pool, 1);
    let view = run(session, 1.5, [hand(null)]);
    expect(session.visitors.current?.def.id).toBe('rabbit');
    expect(view.caption).toBe('Make a rabbit with your hand');
    expect(view.ghost).toBe('rabbit');
    view = run(session, 2.5, [hand('rabbit')]);
    expect(session.zoo.unlocked.has('rabbit')).toBe(true);
    expect(view.caption).toBe('Rabbit joins your zoo! ★★★');
    view = run(session, 3, [hand('rabbit')]);
    expect(view.caption).toBe('Pinch to give it a firefly');
    expect(view.ghost).toBeNull();
    const saved = JSON.parse(storage.getItem(SAVE_KEY)!) as SaveData;
    expect(saved.unlocked).toEqual(['rabbit']);
    expect(saved.stars.rabbit).toBe(3);
    run(session, 5, [hand(null)]);
    expect(session.visitors.current).toBeNull();
  });

  it("brings back a returning player's zoo with a welcome, then today's visitor", () => {
    const save = freshSave();
    save.unlocked = ['rabbit', 'dog', 'crocodile', 'bird', 'peacock', 'spider', 'turtle'];
    save.bonds = { rabbit: 3 };
    save.streak = 2;
    save.lastDay = '2026-11-09';
    const session = new Session(shapes, sil, withSave(save), at('2026-11-10'), mulberry32(2));
    expect(session.greeting).toBe('next-day');
    session.onStage(pool, 1);
    expect(session.zoo.creatures).toHaveLength(7);
    expect(session.zoo.creatures.find((c) => c.species === 'rabbit')!.bond).toBe(3);
    expect(run(session, 1, [hand(null)]).caption).toBe('Welcome back! 3 nights in a row');
    run(session, 5, [hand(null)]);
    expect(session.visitors.current).not.toBeNull();
  });

  it('celebrates the last creature found: the zoo is complete', () => {
    const save = freshSave();
    save.unlocked = ['rabbit', 'dog', 'crocodile', 'bird', 'peacock', 'spider'];
    save.streak = 1;
    save.lastDay = '2026-11-10';
    const session = new Session(shapes, sil, withSave(save), at('2026-11-10'), mulberry32(4));
    session.onStage(pool, 1);
    expect(session.complete).toBe(false);
    run(session, 47, [hand(null)]);
    expect(session.visitors.current?.def.id).toBe('turtle');
    const view = run(session, 1.5, [hand('turtle')]);
    expect(view.caption).toBe('Your zoo is complete! ★★★');
    expect(session.complete).toBe(true);
    expect(session.zoo.creatures.every((c) => c.mode === 'happy' || c.mode === 'appear')).toBe(true);
  });

  it('restores a returning zoo already at its fitted size, spread across the ground', () => {
    const save = freshSave();
    save.unlocked = ['rabbit', 'dog', 'crocodile', 'peacock', 'spider', 'turtle'];
    save.lastDay = '2026-11-10';
    const session = new Session(shapes, sil, withSave(save), at('2026-11-10'), mulberry32(4));
    const wide = { u: 1.2, v: 0.9 };
    session.onStage(wide, 5);
    session.update(1 / 30, [hand(null)], projector, wide, []);
    const xs = session.zoo.creatures.map((c) => c.x);
    for (const c of session.zoo.creatures) expect(c.size).toBeLessThan(0.21);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(1.2);
  });

  it('asks for a little play before each visitor after the first three', () => {
    const save = freshSave();
    save.unlocked = ['rabbit', 'dog', 'crocodile'];
    save.streak = 1;
    save.lastDay = '2026-11-10';
    const session = new Session(shapes, sil, withSave(save), at('2026-11-10'), mulberry32(3));
    session.onStage(pool, 1);
    run(session, 30, [hand(null)]);
    expect(session.visitors.current).toBeNull();
    run(session, 20, [hand(null)]);
    expect(session.visitors.current?.def.id).toBe('bird');
  });
});
