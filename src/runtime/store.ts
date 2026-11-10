import { createJointSet, type Handedness, type JointSet } from '../core/poses.js';
import type { Stage } from '../core/stage.js';
import type { GameEvent } from '../game/events.js';
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
  canvas: null as ShadowCanvas | null,
  /** Game events this frame; AudioSystem plays and clears them. */
  events: [] as GameEvent[],
  hands: {
    left: { tracked: false, joints: createJointSet() },
    right: { tracked: false, joints: createJointSet() },
  } as Record<Handedness, HandSample>,
};
