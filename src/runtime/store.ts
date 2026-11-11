import { createJointSet, type Handedness, type JointSet } from '../core/poses.js';
import type { Stage } from '../core/stage.js';
import type { GameEvent } from '../game/events.js';
import type { Session } from '../game/Session.js';
import type { ShadowCanvas } from '../render/ShadowCanvas.js';

export interface HandSample {
  tracked: boolean;
  readonly joints: JointSet;
}

export const SIDES: readonly Handedness[] = ['left', 'right'];

/** Per-frame state shared between systems (Hand/Stage write; Game/Render/Audio read). */
export const store = {
  stage: null as Stage | null,
  stageVersion: 0,
  narrow: false,
  relightRequested: false,
  /** True while a hand ray hovers the menu: pinches are clicks, not fireflies. */
  uiHovered: false,
  canvas: null as ShadowCanvas | null,
  /** The running game session (menu and audio read settings from it). */
  session: null as Session | null,
  /** Game events this frame; AudioSystem plays and clears them. */
  events: [] as GameEvent[],
  /** Hands from somewhere other than WebXR (the desktop preview's camera); null reads the tracked hands. */
  handSource: null as ((side: Handedness, stage: Stage, out: HandSample) => void) | null,
  hands: {
    left: { tracked: false, joints: createJointSet() },
    right: { tracked: false, joints: createJointSet() },
  } as Record<Handedness, HandSample>,
};
