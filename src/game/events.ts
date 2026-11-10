import type { CreatureId } from '../core/library.js';

/** Things that happened this frame; positions are stage coordinates (meters). */
export type GameEvent =
  | { readonly type: 'reveal'; readonly species: CreatureId; readonly x: number; readonly y: number }
  | { readonly type: 'voice'; readonly species: CreatureId; readonly x: number; readonly y: number }
  | { readonly type: 'eat'; readonly species: CreatureId; readonly x: number; readonly y: number }
  | { readonly type: 'pet'; readonly species: CreatureId; readonly x: number; readonly y: number }
  | { readonly type: 'flee'; readonly species: CreatureId; readonly x: number; readonly y: number }
  | { readonly type: 'firefly'; readonly x: number; readonly y: number };

/** A visitor that matched: where its shadow was and how big. */
export interface Revealed {
  readonly species: CreatureId;
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly scale: number;
}
