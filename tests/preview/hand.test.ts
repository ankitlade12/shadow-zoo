import { describe, expect, it } from 'vitest';
import { CREATURES } from '../../src/core/library.js';
import { buildJointSet, handFrame, jointPos, jointSetFromHandPose, orientJointSet, type JointSet } from '../../src/core/poses.js';
import { ShadowProjector } from '../../src/core/projector.js';
import { buildStage, chooseWall, type PlaneInfo } from '../../src/core/stage.js';
import { add, dot, length, sub, type Vec3 } from '../../src/core/vec.js';
import { poseFor, REST_POSE } from '../../src/preview/controls.js';
import { centroid, cursorOnWall, handPoint, placeHand, rotate, type RigidPose } from '../../src/preview/hand.js';
import { previewHandPoses } from '../../src/preview/poses.js';

const head = { position: [0, 1.6, 0] as Vec3, forward: [0, 0, -1] as Vec3 };
const plane: PlaneInfo = {
  center: [0, 1.3, -2.2],
  normal: [0, 0, 1],
  vertical: true,
  polygon: [[-2, 0, -2.2], [2, 0, -2.2], [2, 2.6, -2.2], [-2, 2.6, -2.2]],
};
const stage = buildStage(head, chooseWall([plane], head), { narrow: false });
const close = (a: Vec3, b: Vec3, digits = 5) => a.forEach((x, i) => expect(x).toBeCloseTo(b[i], digits));
const stagePoint = (x: number, y: number): Vec3 => add(stage.origin, add([stage.u[0] * x, stage.u[1] * x, stage.u[2] * x], [stage.v[0] * y, stage.v[1] * y, stage.v[2] * y]));
const shadowOf = (p: Vec3): [number, number] => {
  const projector = new ShadowProjector();
  projector.setup(stage.lantern, stage);
  expect(projector.project(p[0], p[1], p[2])).toBe(true);
  return [projector.x, projector.y];
};
const posed = (local: JointSet, pose: RigidPose): Vec3[] =>
  Array.from({ length: local.rad.length }, (_, i) => add(rotate(pose.quaternion, jointPos(local, i)), pose.position));
const toWorld = (c: Vec3): Vec3 => add(add([stage.u[0] * c[0], stage.u[1] * c[0], stage.u[2] * c[0]], [stage.v[0] * c[1], stage.v[1] * c[1], stage.v[2] * c[1]]), [stage.n[0] * c[2], stage.n[1] * c[2], stage.n[2] * c[2]]);

describe('cursorOnWall', () => {
  it('finds where the cursor ray meets the wall', () => {
    const target = stagePoint(0.2, -0.1);
    close(cursorOnWall(head.position, sub(target, head.position), stage)!, target);
  });

  it('holds the shadow just inside the edge of the light pool', () => {
    const far = stagePoint(5, 3);
    const hit = cursorOnWall(head.position, sub(far, head.position), stage)!;
    const offset = sub(hit, stage.origin);
    expect(dot(offset, stage.u)).toBeCloseTo(stage.poolU * 1.1);
    expect(dot(offset, stage.v)).toBeCloseTo(stage.poolV * 1.1);
  });

  it('misses when the cursor points away from the wall', () => {
    expect(cursorOnWall(head.position, [0, 0, 1], stage)).toBeNull();
    expect(cursorOnWall(head.position, [1, 0, 0], stage)).toBeNull();
  });
});

describe('handPoint', () => {
  it("puts the hand at the stage's comfortable point when the shadow is centered", () => {
    close(handPoint(stage, stage.origin, 1), stage.hand);
  });

  it('casts its shadow right where the cursor is, at any reach', () => {
    for (const [x, y] of [[0, 0], [0.4, 0.2], [-0.5, -0.3]] as const) {
      for (const reach of [0.6, 1, 1.25]) {
        const [sx, sy] = shadowOf(handPoint(stage, stagePoint(x, y), reach));
        expect(sx).toBeCloseTo(x, 5);
        expect(sy).toBeCloseTo(y, 5);
      }
    }
  });

  it('moves nearer the light for a smaller reach, making the shadow bigger', () => {
    const near = length(sub(handPoint(stage, stage.origin, 0.6), stage.lantern));
    const far = length(sub(handPoint(stage, stage.origin, 1.2), stage.lantern));
    expect(near).toBeLessThan(far);
  });
});

describe('placeHand', () => {
  const center: Vec3 = [0.05, 1.3, -0.4];

  it('turns each creature pose to face the wall as the game expects, centered on the hand point', () => {
    for (const def of CREATURES) {
      const local = buildJointSet(def.angles);
      const target = { fingers: toWorld(def.facing.fingers), palm: toWorld(def.facing.palm) };
      const pose = placeHand(local, 'left', target, center);
      const joints = posed(local, pose);
      // Same joints as the game's own orientation of the shape, moved so their centroid is the hand point.
      const expected = orientJointSet(local, 'left', target, [0, 0, 0]);
      const shift = sub(center, centroid(expected));
      joints.forEach((p, i) => close(p, add(jointPos(expected, i), shift)));
    }
  });

  it('returns a unit rotation that matches the hand frame to the target', () => {
    const local = buildJointSet(CREATURES[0].angles);
    const target = { fingers: [0.3, 1, 0.1] as Vec3, palm: [0, 0, -1] as Vec3 };
    const pose = placeHand(local, 'left', target, center);
    expect(Math.hypot(...pose.quaternion)).toBeCloseTo(1, 6);
    const frame = handFrame(local, 'left');
    const fingers = rotate(pose.quaternion, frame.fingers);
    const f = Math.hypot(...target.fingers);
    close(fingers, [target.fingers[0] / f, target.fingers[1] / f, target.fingers[2] / f]);
    expect(dot(rotate(pose.quaternion, frame.palm), [0, 0, -1])).toBeGreaterThan(0.9);
  });
});

describe('previewHandPoses', () => {
  const poses = previewHandPoses();

  it('builds a rest pose and every creature with its action pose', () => {
    expect(poses.has(REST_POSE)).toBe(true);
    for (const def of CREATURES) {
      expect(poses.has(poseFor({ shape: def.id, act: false }))).toBe(true);
      expect(poses.has(poseFor({ shape: def.id, act: true }))).toBe(true);
    }
  });

  it("gives the emulated hand exactly the game's creature shapes", () => {
    for (const def of CREATURES) {
      const fromPose = jointSetFromHandPose(poses.get(poseFor({ shape: def.id, act: false }))!);
      expect(Array.from(fromPose.pos)).toEqual(Array.from(buildJointSet(def.angles).pos));
    }
  });
});
