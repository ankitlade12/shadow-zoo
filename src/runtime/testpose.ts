import { CREATURES, type CreatureId } from '../core/library.js';
import { buildJointSet, orientJointSet, type JointSet } from '../core/poses.js';
import type { Stage } from '../core/stage.js';
import type { Vec3 } from '../core/vec.js';
import type { HandSample } from './store.js';

/** Dev-only synthetic hand: VITE_TESTPOSE=<creature> or ?testpose=<creature>, optional testhand=left|right. */
export interface TestPose {
  readonly creature: CreatureId;
  readonly side: 'left' | 'right';
  readonly joints: JointSet;
}

export function readTestPose(search: string, envPose: string | undefined): TestPose | null {
  const params = new URLSearchParams(search);
  const id = params.get('testpose') ?? envPose ?? '';
  const def = CREATURES.find((c) => c.id === id);
  if (!def) return null;
  return { creature: def.id, side: params.get('testhand') === 'left' ? 'left' : 'right', joints: buildJointSet(def.angles) };
}

const toWorld = (stage: Stage, c: Vec3): Vec3 => [
  stage.u[0] * c[0] + stage.v[0] * c[1] + stage.n[0] * c[2],
  stage.u[1] * c[0] + stage.v[1] * c[1] + stage.n[1] * c[2],
  stage.u[2] * c[0] + stage.v[2] * c[1] + stage.n[2] * c[2],
];

/** Places the test pose's canonical shape at the stage's comfortable hand point. */
export function placeTestPose(test: TestPose, stage: Stage, out: HandSample): void {
  const def = CREATURES.find((c) => c.id === test.creature)!;
  orientJointSet(test.joints, 'left', { fingers: toWorld(stage, def.facing.fingers), palm: toWorld(stage, def.facing.palm) }, stage.hand, out.joints);
  out.tracked = true;
}
