import { CREATURES } from '../core/library.js';
import type { SaveData } from '../core/save.js';
import { PLACES, type PlaceId } from '../core/world.js';

/** The places a passport can be stamped for: everywhere but home. */
export const STAMPABLE = PLACES.length - 1;

/** A match's stars out of three, as the wall shows them. */
export const starText = (stars: number): string => '★'.repeat(stars) + '☆'.repeat(Math.max(0, 3 - stars));

/** The callout for hits in quick succession (from the second hit on). */
export function comboMessage(combo: number): string {
  if (combo <= 2) return 'Double bonk!';
  if (combo === 3) return 'Triple bonk!';
  if (combo === 4) return 'Zoo-quake!';
  return `Shadow stampede! ×${combo}`;
}

/** Once the basics are learned, the wild side, one tip at a time. */
export const CHAOS_TIPS: readonly string[] = ['Pinch a creature to grab it. Now throw it!', 'Swipe fast to bonk them, or clap your hands!'];

/** Then the World Tour. */
export const TOUR_TIP = 'Open the Menu to visit zoos around the world!';

/** The line after a first visit somewhere new. */
export const passportMessage = (stamps: number): string => `Passport stamp ${stamps} of ${STAMPABLE}!`;

/** The line on the wall when a visitor comes alive: who joined (or visited), with the stars it earned. */
export function revealMessage(name: string, kind: 'new' | 'daily', stars: number, complete: boolean): string {
  if (complete) return `Your zoo is complete! ${starText(stars)}`;
  return kind === 'new' ? `${name} joins your zoo! ${starText(stars)}` : `${name} came back to visit! ${starText(stars)}`;
}

/** Every creature has been found. */
export const zooComplete = (save: SaveData): boolean => CREATURES.every((c) => save.unlocked.includes(c.id));

/**
 * How far along the zoo is: creatures found out of all, and the stars earned so far. Plain words, for
 * the menu's font, which has no star glyph.
 */
export function zooProgress(save: SaveData): string {
  const found = `${save.unlocked.length} of ${CREATURES.length} creatures found`;
  const stars = Object.values(save.stars).reduce((sum, n) => sum + (n ?? 0), 0);
  const line = stars > 0 ? `${found}, ${stars} ${stars === 1 ? 'star' : 'stars'}` : found;
  const places = save.stamps.length;
  return places > 0 ? `${line}, ${places} of ${STAMPABLE} places` : line;
}

/** Each zoo's name on its gate: what the wall says as the lantern lights there. */
const ZOO_NAME: Readonly<Record<PlaceId, string>> = {
  home: 'Shadow Zoo',
  arctic: 'the Arctic Shadow Zoo',
  sahara: 'the Sahara Shadow Zoo',
  amazon: 'the Amazon Shadow Zoo',
  outback: 'the Outback Shadow Zoo',
  moon: 'the Shadow Zoo on the Moon',
};

/** The welcome as the gate swings open. */
export const welcomeMessage = (place: PlaceId): string => `Welcome to ${ZOO_NAME[place]}`;

/** The keeper's calls in a zoo day. */
export const FEEDING_CALL = 'Feeding time!';
export const ALL_FED = 'Everyone is fed!';
export const SHOW_CALL = 'Show time! Every creature does a trick';

/** A petted creature's name plaque: its name and its hearts. */
export const plaqueMessage = (name: string, hearts: number): string => `${name} ${'♥'.repeat(Math.max(1, Math.min(5, hearts)))}`;
