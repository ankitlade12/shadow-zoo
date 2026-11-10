import { CREATURES, type CreatureId } from './library.js';
import type { AssistLevel } from './matcher.js';

export const SAVE_KEY = 'shadowzoo.save.v1';
export type HandPreference = 'auto' | 'left' | 'right';

export interface Settings {
  assist: AssistLevel;
  hand: HandPreference;
  sound: boolean;
  reducedMotion: boolean;
  narrow: boolean;
}

export interface SaveData {
  version: 1;
  /** Creatures brought to life, in order. */
  unlocked: CreatureId[];
  bonds: Partial<Record<CreatureId, number>>;
  stars: Partial<Record<CreatureId, number>>;
  embers: number;
  streak: number;
  /** Local date (YYYY-MM-DD) of the most recent session. */
  lastDay: string | null;
  /** Local date when the daily visitor was last matched. */
  dailyDone: string | null;
  settings: Settings;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = { assist: 'normal', hand: 'auto', sound: true, reducedMotion: false, narrow: false };

export const freshSave = (settings: Settings = { ...DEFAULT_SETTINGS }): SaveData => ({
  version: 1,
  unlocked: [],
  bonds: {},
  stars: {},
  embers: 0,
  streak: 0,
  lastDay: null,
  dailyDone: null,
  settings: { ...settings },
});

const IDS = new Set<string>(CREATURES.map((c) => c.id));
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const count = (v: unknown, max = Infinity): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(max, Math.floor(v))) : 0);
const day = (v: unknown): string | null => (typeof v === 'string' && DAY.test(v) ? v : null);
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
function pick<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(v as T) ? (v as T) : fallback;
}

function perCreature(v: unknown, max: number): Partial<Record<CreatureId, number>> {
  const out: Partial<Record<CreatureId, number>> = {};
  if (!isRecord(v)) return out;
  for (const [key, value] of Object.entries(v)) if (IDS.has(key)) out[key as CreatureId] = count(value, max);
  return out;
}

/** Parses saved JSON. Invalid fields fall back to defaults; null when unreadable or another version. */
export function parseSave(text: string): SaveData | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(raw) || raw.version !== 1) return null;
  const unlocked: CreatureId[] = [];
  if (Array.isArray(raw.unlocked)) {
    for (const id of raw.unlocked) if (typeof id === 'string' && IDS.has(id) && !unlocked.includes(id as CreatureId)) unlocked.push(id as CreatureId);
  }
  const s = isRecord(raw.settings) ? raw.settings : {};
  return {
    version: 1,
    unlocked,
    bonds: perCreature(raw.bonds, 5),
    stars: perCreature(raw.stars, 3),
    embers: count(raw.embers),
    streak: count(raw.streak),
    lastDay: day(raw.lastDay),
    dailyDone: day(raw.dailyDone),
    settings: {
      assist: pick(s.assist, ['gentle', 'normal', 'expert'] as const, DEFAULT_SETTINGS.assist),
      hand: pick(s.hand, ['auto', 'left', 'right'] as const, DEFAULT_SETTINGS.hand),
      sound: bool(s.sound, DEFAULT_SETTINGS.sound),
      reducedMotion: bool(s.reducedMotion, DEFAULT_SETTINGS.reducedMotion),
      narrow: bool(s.narrow, DEFAULT_SETTINGS.narrow),
    },
  };
}

/** The localStorage subset the game needs. */
export interface StoragePort {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Loads, holds and writes the save. Storage failures never throw; progress continues in memory. */
export class SaveStore {
  data: SaveData;
  /** Set when saved progress existed but could not be read. */
  readonly notice: string | null;

  constructor(private readonly storage: StoragePort | null) {
    let text: string | null = null;
    try {
      text = storage?.getItem(SAVE_KEY) ?? null;
    } catch {
      text = null;
    }
    const parsed = text === null ? null : parseSave(text);
    this.notice = text !== null && parsed === null ? 'Saved progress could not be read, so the zoo starts fresh.' : null;
    if (this.notice && text !== null) {
      try {
        storage?.setItem(`${SAVE_KEY}.corrupt`, text);
      } catch {
        // The backup is best effort; play continues in memory.
      }
    }
    this.data = parsed ?? freshSave();
  }

  save(): boolean {
    if (!this.storage) return false;
    try {
      this.storage.setItem(SAVE_KEY, JSON.stringify(this.data));
      return true;
    } catch {
      return false;
    }
  }

  /** Erases progress but keeps settings. */
  reset(): void {
    this.data = freshSave(this.data.settings);
    this.save();
  }
}
