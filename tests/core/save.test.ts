import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, freshSave, parseSave, SAVE_KEY, SaveStore, type StoragePort } from '../../src/core/save.js';

class MemoryStorage implements StoragePort {
  readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

describe('parseSave', () => {
  it('round-trips a save', () => {
    const save = freshSave();
    save.unlocked = ['rabbit', 'dog'];
    save.bonds = { rabbit: 3 };
    save.stars = { dog: 2 };
    save.embers = 4;
    save.streak = 2;
    save.lastDay = '2026-11-10';
    save.settings.assist = 'gentle';
    expect(parseSave(JSON.stringify(save))).toEqual(save);
  });

  it('sanitizes unknown, duplicate and out-of-range values', () => {
    const parsed = parseSave(
      JSON.stringify({
        version: 1,
        unlocked: ['rabbit', 'unicorn', 'rabbit', 7, 'turtle'],
        bonds: { rabbit: 99, dragon: 2, dog: -4 },
        stars: { rabbit: 2.7 },
        embers: 'many',
        streak: 3,
        lastDay: 'yesterday',
        dailyDone: '2026-11-09',
        settings: { assist: 'cheat', hand: 'left', sound: 'yes', reducedMotion: true },
      }),
    )!;
    expect(parsed.unlocked).toEqual(['rabbit', 'turtle']);
    expect(parsed.bonds).toEqual({ rabbit: 5, dog: 0 });
    expect(parsed.stars).toEqual({ rabbit: 2 });
    expect(parsed.embers).toBe(0);
    expect(parsed.lastDay).toBeNull();
    expect(parsed.dailyDone).toBe('2026-11-09');
    expect(parsed.settings).toEqual({ ...DEFAULT_SETTINGS, hand: 'left', reducedMotion: true });
  });

  it('rejects unreadable text and other versions', () => {
    expect(parseSave('not json')).toBeNull();
    expect(parseSave(JSON.stringify({ version: 2 }))).toBeNull();
    expect(parseSave('[]')).toBeNull();
  });
});

describe('SaveStore', () => {
  it('saves and loads through the storage port', () => {
    const storage = new MemoryStorage();
    const a = new SaveStore(storage);
    a.data.unlocked.push('rabbit');
    expect(a.save()).toBe(true);
    expect(new SaveStore(storage).data.unlocked).toEqual(['rabbit']);
  });

  it('backs up an unreadable save and starts fresh with a notice', () => {
    const storage = new MemoryStorage();
    storage.setItem(SAVE_KEY, '{broken');
    const store = new SaveStore(storage);
    expect(store.notice).not.toBeNull();
    expect(store.data).toEqual(freshSave());
    expect(storage.getItem(`${SAVE_KEY}.corrupt`)).toBe('{broken');
  });

  it('keeps working in memory when storage throws', () => {
    const broken: StoragePort = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    const store = new SaveStore(broken);
    store.data.unlocked.push('dog');
    expect(store.save()).toBe(false);
    expect(new SaveStore(null).save()).toBe(false);
  });

  it('reset erases progress but keeps settings', () => {
    const storage = new MemoryStorage();
    const store = new SaveStore(storage);
    store.data.unlocked.push('rabbit');
    store.data.settings.sound = false;
    store.reset();
    expect(store.data.unlocked).toEqual([]);
    expect(store.data.settings.sound).toBe(false);
    expect(new SaveStore(storage).data.settings.sound).toBe(false);
  });
});
