import type { CreatureId } from '../core/library.js';
import type { PlaceId } from '../core/world.js';

/** Things that happened this frame; positions are stage coordinates (meters). */
export type GameEvent =
  | { readonly type: 'reveal'; readonly species: CreatureId; readonly x: number; readonly y: number }
  | { readonly type: 'voice'; readonly species: CreatureId; readonly x: number; readonly y: number }
  | { readonly type: 'eat'; readonly species: CreatureId; readonly x: number; readonly y: number }
  | { readonly type: 'pet'; readonly species: CreatureId; readonly x: number; readonly y: number }
  | { readonly type: 'flee'; readonly species: CreatureId; readonly x: number; readonly y: number }
  | { readonly type: 'firefly'; readonly x: number; readonly y: number }
  /** A pinch picked a creature up. */
  | { readonly type: 'grab'; readonly species: CreatureId; readonly x: number; readonly y: number }
  /** A held creature was thrown. */
  | { readonly type: 'fling'; readonly species: CreatureId; readonly x: number; readonly y: number }
  /** A creature was knocked flying; `combo` counts hits in quick succession (1 for the first). */
  | { readonly type: 'bonk'; readonly species: CreatureId; readonly x: number; readonly y: number; readonly combo: number }
  /** A tumbling creature landed hard and sits dizzy. */
  | { readonly type: 'land'; readonly species: CreatureId; readonly x: number; readonly y: number }
  /** The player clapped and the whole zoo jumped. */
  | { readonly type: 'clap'; readonly x: number; readonly y: number }
  /** The World Tour's globe opened on the wall. */
  | { readonly type: 'globe'; readonly x: number; readonly y: number }
  /** The zoo traveled to a place. */
  | { readonly type: 'travel'; readonly place: PlaceId; readonly x: number; readonly y: number }
  /** A first visit earned a passport stamp. */
  | { readonly type: 'stamp'; readonly place: PlaceId; readonly x: number; readonly y: number };

/** A visitor that matched: where its shadow was and how big. */
export interface Revealed {
  readonly species: CreatureId;
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly scale: number;
}
