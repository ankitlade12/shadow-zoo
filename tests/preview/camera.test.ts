import { describe, expect, it } from 'vitest';
import { J, JOINT_COUNT } from '../../src/core/joints.js';
import { buildCreatureShapes, canonicalPair, CREATURES, creatureDef } from '../../src/core/library.js';
import { buildJointSet, createJointSet, jointPos, orientJointSet, type JointSet } from '../../src/core/poses.js';
import { TUNING } from '../../src/core/matcher.js';
import { CAPSULE_STRIDE, ShadowProjector } from '../../src/core/projector.js';
import { createFrame, matchScore, Silhouettes } from '../../src/core/silhouette.js';
import { buildStage, chooseWall, type PlaneInfo } from '../../src/core/stage.js';
import { dot, length, sub, type Vec3 } from '../../src/core/vec.js';
import { handFromLabel, LANDMARK_OF_JOINT, MP, OneEuro, placeCameraHand, REFERENCE_SIZE, type CameraHand, type Point3 } from '../../src/preview/camera/landmarks.js';
import { stageToWorld } from '../../src/runtime/testpose.js';

const head = { position: [0, 1.6, 0] as Vec3, forward: [0, 0, -1] as Vec3 };
const plane: PlaneInfo = {
  center: [0, 1.3, -2.4],
  normal: [0, 0, 1],
  vertical: true,
  polygon: [[-2, 0, -2.4], [2, 0, -2.4], [2, 2.6, -2.4], [-2, 2.6, -2.4]],
};
const stage = buildStage(head, chooseWall([plane], head), { narrow: false });
const ASPECT = 4 / 3;
const PALM = [J.wrist, J.indexProx, J.middleProx, J.ringProx, J.pinkyProx];

/** A player's perfect creature shape, held at the stage's comfortable point. */
const posed = (id: string): JointSet => {
  const def = CREATURES.find((c) => c.id === id)!;
  return orientJointSet(buildJointSet(def.angles), 'left', { fingers: stageToWorld(stage, def.facing.fingers), palm: stageToWorld(stage, def.facing.palm) }, stage.hand);
};

const palmCenterOf = (js: JointSet): Vec3 => {
  const c = [0, 0, 0];
  for (const j of PALM) for (let a = 0; a < 3; a++) c[a] += js.pos[j * 3 + a] / PALM.length;
  return c as unknown as Vec3;
};

/**
 * What the camera reports for a hand: landmarks in camera axes (the camera sits at the wall facing the
 * player: x is the player's left, y down, z toward the player), and the picture position of each.
 */
function seenByCamera(js: JointSet, at: { x: number; y: number }, size = REFERENCE_SIZE): CameraHand {
  const world: Point3[] = [];
  for (let k = 0; k < 21; k++) {
    const p = jointPos(js, LANDMARK_OF_JOINT.indexOf(k));
    world.push({ x: -dot(p, stage.u), y: -dot(p, stage.v), z: dot(p, stage.n) });
  }
  const palm = Math.hypot(world[MP.middleMcp].x - world[MP.wrist].x, world[MP.middleMcp].y - world[MP.wrist].y);
  const k = size / palm;
  const palmPoints: number[] = [MP.wrist, MP.indexMcp, MP.middleMcp, MP.ringMcp, MP.pinkyMcp];
  const mean = (pick: (p: Point3) => number) => palmPoints.reduce((s, i) => s + pick(world[i]) / 5, 0);
  const cx = mean((p) => p.x);
  const cy = mean((p) => p.y);
  const image = world.map((p) => ({ x: at.x + ((p.x - cx) * k) / ASPECT, y: at.y + (p.y - cy) * k, z: 0 }));
  return { world, image };
}

const shadowAt = (p: Vec3): [number, number] => {
  const projector = new ShadowProjector();
  projector.setup(stage.lantern, stage);
  expect(projector.project(p[0], p[1], p[2])).toBe(true);
  return [projector.x, projector.y];
};

describe('placeCameraHand', () => {
  it('rebuilds the hand the camera sees with its real shape and handedness, at the comfortable point', () => {
    for (const def of CREATURES.filter((c) => !c.pair)) {
      const original = posed(def.id);
      const out = createJointSet();
      placeCameraHand(seenByCamera(original, { x: 0.5, y: 0.5 }), stage, ASPECT, out);
      const shift = sub(palmCenterOf(out), palmCenterOf(original));
      expect(length(sub(palmCenterOf(out), stage.hand))).toBeLessThan(1e-6);
      for (let j = 0; j < JOINT_COUNT; j++) {
        if (LANDMARK_OF_JOINT[j] < 0) continue;
        const a = jointPos(out, j);
        const b = jointPos(original, j);
        for (let i = 0; i < 3; i++) expect(a[i]).toBeCloseTo(b[i] + shift[i], 6);
      }
    }
  });

  it('casts a shadow the game scores exactly like the same hand tracked by a headset', () => {
    const sil = new Silhouettes();
    const shapes = buildCreatureShapes(sil);
    const projector = new ShadowProjector();
    projector.setup(stage.lantern, stage);
    const caps = new Float32Array(64 * CAPSULE_STRIDE);
    const score = (js: JointSet, id: string) => matchScore(sil, caps, 0, projector.projectBones(js, caps, 0), shapes.get(id as never)!.target, createFrame());
    for (const def of CREATURES.filter((c) => !c.pair)) {
      const original = posed(def.id);
      const out = createJointSet();
      placeCameraHand(seenByCamera(original, { x: 0.5, y: 0.5 }), stage, ASPECT, out);
      const seen = score(out, def.id);
      // Only the joint radii differ: the camera gives none, so they come from IWER's hand, scaled.
      expect(Math.abs(seen - score(original, def.id))).toBeLessThan(0.03);
      expect(seen).toBeGreaterThan(TUNING.normal.threshold);
    }
  });

  it('keeps two hands as far apart as they really are, so the two-handed bird holds its shape', () => {
    // The bird held at the comfortable point: canonical stage space to the room around stage.hand.
    const { left, right } = canonicalPair(creatureDef('bird'));
    const both = [left, right];
    const c = [0, 0, 0];
    for (const js of both) for (let j = 0; j < JOINT_COUNT; j++) for (let a = 0; a < 3; a++) c[a] += js.pos[j * 3 + a] / (2 * JOINT_COUNT);
    const room = both.map((js) => {
      const out = createJointSet();
      for (let j = 0; j < JOINT_COUNT; j++) {
        const [x, y, z] = [js.pos[j * 3] - c[0], js.pos[j * 3 + 1] - c[1], js.pos[j * 3 + 2] - c[2]];
        for (let a = 0; a < 3; a++) out.pos[j * 3 + a] = stage.hand[a] + stage.u[a] * x + stage.v[a] * y + stage.n[a] * z;
        out.rad[j] = js.rad[j];
      }
      return out;
    });
    // Where each hand appears in the picture: its offset from the pair's center, at the picture's scale.
    const palm = Math.hypot(...sub(jointPos(left, J.middleProx), jointPos(left, J.wrist)).slice(0, 2));
    const k = REFERENCE_SIZE / palm;
    const at = room.map((js) => {
      const d = sub(palmCenterOf(js), stage.hand);
      return { x: 0.5 - (dot(d, stage.u) * k) / ASPECT, y: 0.5 - dot(d, stage.v) * k };
    });
    const anchor = { x: (at[0].x + at[1].x) / 2, y: (at[0].y + at[1].y) / 2 };
    const seen = room.map((js, i) => {
      const out = createJointSet();
      placeCameraHand(seenByCamera(js, at[i]), stage, ASPECT, out, anchor);
      return out;
    });
    const sil = new Silhouettes();
    const target = buildCreatureShapes(sil).get('bird')!.target;
    const projector = new ShadowProjector();
    projector.setup(stage.lantern, stage);
    const caps = new Float32Array(128 * CAPSULE_STRIDE);
    const cast = (pair: JointSet[]) => {
      const n = projector.projectBones(pair[0], caps, 0);
      return matchScore(sil, caps, 0, n + projector.projectBones(pair[1], caps, n), target, createFrame());
    };
    const direct = cast(room);
    expect(Math.abs(cast(seen) - direct)).toBeLessThan(0.03);
    expect(cast(seen)).toBeGreaterThan(TUNING.normal.threshold);
  });

  it("moves the shadow the way the player moves their hand", () => {
    const at = (x: number, y: number) => {
      const out = createJointSet();
      placeCameraHand(seenByCamera(posed('dog'), { x, y }), stage, ASPECT, out);
      return shadowAt(palmCenterOf(out));
    };
    const [cx, cy] = at(0.5, 0.5);
    expect(Math.hypot(cx, cy)).toBeLessThan(1e-6);
    // The camera's picture is unmirrored: the player's right is the picture's left.
    expect(at(0.3, 0.5)[0]).toBeGreaterThan(0.1);
    expect(at(0.7, 0.5)[0]).toBeLessThan(-0.1);
    expect(at(0.5, 0.3)[1]).toBeGreaterThan(0.1);
  });

  it('gives a bigger shadow as the hand moves back toward the player (away from the camera)', () => {
    const distanceFromLantern = (size: number) => {
      const out = createJointSet();
      placeCameraHand(seenByCamera(posed('rabbit'), { x: 0.5, y: 0.5 }, size), stage, ASPECT, out);
      return length(sub(palmCenterOf(out), stage.lantern));
    };
    expect(distanceFromLantern(REFERENCE_SIZE * 0.7)).toBeLessThan(distanceFromLantern(REFERENCE_SIZE));
    expect(distanceFromLantern(REFERENCE_SIZE * 1.2)).toBeGreaterThan(distanceFromLantern(REFERENCE_SIZE));
    expect(distanceFromLantern(REFERENCE_SIZE * 10)).toBeCloseTo(distanceFromLantern(REFERENCE_SIZE * 20), 9);
  });

  it('scales joint radii with the size of the hand', () => {
    const small = posed('rabbit');
    for (let i = 0; i < small.pos.length; i++) small.pos[i] *= 0.8;
    const big = createJointSet();
    const little = createJointSet();
    placeCameraHand(seenByCamera(posed('rabbit'), { x: 0.5, y: 0.5 }), stage, ASPECT, big);
    placeCameraHand(seenByCamera(small, { x: 0.5, y: 0.5 }), stage, ASPECT, little);
    expect(little.rad[J.wrist] / big.rad[J.wrist]).toBeCloseTo(0.8, 5);
  });
});

describe('handFromLabel', () => {
  it("swaps MediaPipe's mirrored-picture handedness for the camera's own picture", () => {
    expect(handFromLabel('Left')).toBe('right');
    expect(handFromLabel('Right')).toBe('left');
  });
});

describe('OneEuro', () => {
  it('smooths a trembling hand at rest', () => {
    const filter = new OneEuro(1);
    const out = [0];
    let maxDev = 0;
    for (let i = 0; i < 300; i++) {
      filter.filter([0.5 + (i % 2 ? 0.003 : -0.003)], i / 30, out);
      if (i > 30) maxDev = Math.max(maxDev, Math.abs(out[0] - 0.5));
    }
    expect(maxDev).toBeLessThan(0.0015);
  });

  it('follows a moving hand closely', () => {
    const filter = new OneEuro(1);
    const out = [0];
    for (let i = 0; i <= 60; i++) filter.filter([i * 0.02], i / 60, out);
    expect(1.2 - out[0]).toBeLessThan(0.05);
  });

  it('starts from the first sample and holds when time does not advance', () => {
    const filter = new OneEuro(2);
    const out = [0, 0];
    filter.filter([1, 2], 0, out);
    expect(out).toEqual([1, 2]);
    filter.filter([5, 5], 0, out);
    expect(out).toEqual([1, 2]);
  });
});
