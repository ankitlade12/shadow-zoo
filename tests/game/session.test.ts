import { describe, expect, it } from 'vitest';
import { buildCreatureShapes, type CreatureId } from '../../src/core/library.js';
import { ShadowProjector } from '../../src/core/projector.js';
import { mulberry32 } from '../../src/core/rng.js';
import { freshSave, SAVE_KEY, type SaveData, type StoragePort } from '../../src/core/save.js';
import { Silhouettes } from '../../src/core/silhouette.js';
import type { GameEvent } from '../../src/game/events.js';
import { createHandShadow, type HandShadow } from '../../src/game/hands.js';
import { J } from '../../src/core/joints.js';
import { createJointSet } from '../../src/core/poses.js';
import { CHAOS_TIPS } from '../../src/game/rewards.js';
import { placeOf, type PlaceId } from '../../src/core/world.js';
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

describe('Session chaos', () => {
  const returning = () => {
    const save = freshSave();
    save.unlocked = ['rabbit', 'dog'];
    save.streak = 1;
    save.lastDay = '2026-11-10';
    const session = new Session(shapes, sil, withSave(save), at('2026-11-10'), mulberry32(4));
    session.onStage(pool, 1);
    return session;
  };

  it('keeps grabbing and its tips for after the tutorial', () => {
    const session = new Session(shapes, sil, new MemoryStorage(), at('2026-11-10'), mulberry32(1));
    session.onStage(pool, 1);
    for (let t = 0; t < 8; t += 1) {
      const view = run(session, 1, [hand(null)]);
      expect(CHAOS_TIPS).not.toContain(view.caption);
    }
    expect(session.zoo.chaos).toBe(false);
  });

  it('teaches a returning player to grab, then to swipe and clap, one tip at a time', () => {
    const session = returning();
    expect(run(session, 3, [hand(null)]).caption).toBe(CHAOS_TIPS[0]);
    expect(session.zoo.chaos).toBe(true);
    expect(run(session, 17, [hand(null)]).caption).toBe(CHAOS_TIPS[1]);
  });

  it('a clap puts a callout on the wall', () => {
    const session = returning();
    const left = createHandShadow('left');
    const right = createHandShadow('right');
    for (const h of [left, right]) {
      h.tracked = true;
      h.joints = createJointSet();
    }
    const gapOf = (gap: number) => {
      left.joints!.pos[J.middleProx * 3] = -gap / 2;
      right.joints!.pos[J.middleProx * 3] = gap / 2;
    };
    const events: GameEvent[] = [];
    gapOf(0.3);
    session.update(1 / 30, [left, right], projector, pool, events);
    gapOf(0.05);
    const view = session.update(1 / 30, [left, right], projector, pool, events);
    expect(events.some((e) => e.type === 'clap')).toBe(true);
    expect(view.caption).toBe('Thunderclap!');
  });
});

describe('Session World Tour', () => {
  const returning = (place: PlaceId = 'home', stamps: PlaceId[] = []) => {
    const save = freshSave();
    save.unlocked = ['rabbit', 'dog'];
    save.streak = 1;
    save.lastDay = '2026-11-10';
    save.place = place;
    save.stamps = stamps;
    const session = new Session(shapes, sil, withSave(save), at('2026-11-10'), mulberry32(4));
    session.onStage(pool, 1);
    return session;
  };
  /** Opens the globe and pinches a place's marker (it must face the player). */
  const travelTo = (session: Session, id: PlaceId, events: GameEvent[]) => {
    session.openTour(events);
    session.update(1 / 30, [hand(null)], projector, pool, events);
    const marker = session.tour.markers(pool).find((m) => m.id === id)!;
    expect(marker.visible).toBe(true);
    const h = createHandShadow('right');
    h.tracked = true;
    h.pinchX = marker.x;
    h.pinchY = marker.y;
    // The view is one object, updated every frame, so keep what it said at each moment.
    const hovering = session.update(1 / 30, [h], projector, pool, events).caption;
    h.pinch = 'start';
    const view = session.update(1 / 30, [h], projector, pool, events);
    return { hovering, arrived: { caption: view.caption, tour: view.tour } };
  };

  it('opens the globe while the zoo waits, then travels to a picked place with a passport stamp', () => {
    const session = returning();
    const events: GameEvent[] = [];
    run(session, 1, [hand(null)]);
    session.openTour(events);
    expect(events.some((e) => e.type === 'globe')).toBe(true);
    const open = session.update(1 / 30, [hand(null)], projector, pool, events);
    expect(open.tour).toBe(true);
    expect(open.caption).toBe('Spin the globe. Pinch a place to travel');
    const { hovering, arrived } = travelTo(session, 'arctic', events);
    expect(hovering).toBe(placeOf('arctic').hover);
    expect(arrived.tour).toBe(false);
    expect(arrived.caption).toBe(placeOf('arctic').arrival);
    expect(session.saves.data.place).toBe('arctic');
    expect(session.saves.data.stamps).toEqual(['arctic']);
    expect(session.zoo.rules).toBe(placeOf('arctic').rules);
    expect(events.filter((e) => e.type === 'travel')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'stamp')).toHaveLength(1);
    expect(run(session, 4, [hand(null)]).caption).toBe('Passport stamp 1 of 5!');
  });

  it('going home never stamps, and a second visit stamps nothing new', () => {
    const session = returning();
    const events: GameEvent[] = [];
    travelTo(session, 'arctic', events);
    travelTo(session, 'home', events);
    expect(session.saves.data.place).toBe('home');
    expect(session.zoo.rules).toBe(placeOf('home').rules);
    travelTo(session, 'arctic', events);
    expect(session.saves.data.stamps).toEqual(['arctic']);
    expect(events.filter((e) => e.type === 'stamp')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'travel')).toHaveLength(3);
  });

  it('a returning player wakes up where the zoo was, under its rules', () => {
    const session = returning('moon', ['moon']);
    expect(session.saves.data.place).toBe('moon');
    expect(session.zoo.rules).toBe(placeOf('moon').rules);
  });

  it('starts in the zoo chosen on the homepage, arriving once the wall is lit', () => {
    const session = returning();
    const events: GameEvent[] = [];
    session.startAt('sahara');
    // Nothing moves until the game runs on the wall, so the arrival is heard there.
    expect(session.saves.data.place).toBe('home');
    const view = session.update(1 / 30, [hand(null)], projector, pool, events);
    expect(view.caption).toBe(placeOf('sahara').arrival);
    expect(session.saves.data.place).toBe('sahara');
    expect(session.saves.data.stamps).toEqual(['sahara']);
    expect(session.zoo.rules).toBe(placeOf('sahara').rules);
    run(session, 1, [hand(null)], events);
    expect(events.filter((e) => e.type === 'travel')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'stamp')).toHaveLength(1);
  });

  it('starting in the zoo it is already in changes nothing', () => {
    const session = returning('moon', ['moon']);
    const events: GameEvent[] = [];
    session.startAt('moon');
    run(session, 1, [hand(null)], events);
    expect(events.some((e) => e.type === 'travel' || e.type === 'stamp')).toBe(false);
    expect(session.saves.data.stamps).toEqual(['moon']);
  });

  it('a first-time player who starts somewhere new arrives there, then meets the rabbit', () => {
    const session = new Session(shapes, sil, new MemoryStorage(), at('2026-11-10'), mulberry32(2));
    session.onStage(pool, 1);
    session.startAt('amazon');
    expect(run(session, 0.5, [hand('dog')]).caption).toBe(placeOf('amazon').arrival);
    expect(run(session, 7, [hand('dog')]).caption).toBe('Make a rabbit with your hand');
  });
});
