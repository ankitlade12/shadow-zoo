import { describe, expect, it } from 'vitest';
import { J, JOINT_COUNT } from '../../src/core/joints.js';
import {
  buildJointSet,
  builtinAngles,
  handFrame,
  jointPos,
  mirrorJointSet,
  orientJointSet,
} from '../../src/core/poses.js';
import { dot, length, sub } from '../../src/core/vec.js';

describe('poses', () => {
  it('builds a 25-joint hand of plausible size', () => {
    const js = buildJointSet(builtinAngles.flat);
    expect(js.pos.length).toBe(JOINT_COUNT * 3);
    const reach = length(sub(jointPos(js, J.middleTip), jointPos(js, J.wrist)));
    expect(reach).toBeGreaterThan(0.14);
    expect(reach).toBeLessThan(0.24);
    expect(js.rad[J.indexTip]).toBeGreaterThan(0.003);
  });

  it('a fist is more compact than a flat hand', () => {
    const tip = (name: string) => {
      const js = buildJointSet(builtinAngles[name]);
      return length(sub(jointPos(js, J.middleTip), jointPos(js, J.wrist)));
    };
    expect(tip('fist')).toBeLessThan(tip('flat') * 0.7);
  });

  it('orients a hand to the requested axes with the wrist at the anchor', () => {
    const out = orientJointSet(buildJointSet(builtinAngles.flat), 'left', { fingers: [0, 1, 0], palm: [0, 0, 1] }, [1, 2, 3]);
    const f = handFrame(out, 'left');
    expect(dot(f.fingers, [0, 1, 0])).toBeGreaterThan(0.999);
    expect(dot(f.palm, [0, 0, 1])).toBeGreaterThan(0.999);
    const w = jointPos(out, J.wrist);
    expect(w[0]).toBeCloseTo(1);
    expect(w[1]).toBeCloseTo(2);
    expect(w[2]).toBeCloseTo(3);
  });

  it('IWER poses are left hands: palm down and fingers forward puts the thumb on the right', () => {
    const js = orientJointSet(buildJointSet(builtinAngles.flat), 'left', { fingers: [0, 0, -1], palm: [0, -1, 0] }, [0, 0, 0]);
    expect(jointPos(js, J.thumbTip)[0]).toBeGreaterThan(0.02);
  });

  it('mirroring yields a right hand with a consistent frame', () => {
    const left = orientJointSet(buildJointSet(builtinAngles.flat), 'left', { fingers: [0, 0, -1], palm: [0, -1, 0] }, [0, 0, 0]);
    const right = handFrame(mirrorJointSet(left), 'right');
    expect(dot(right.palm, [0, -1, 0])).toBeGreaterThan(0.99);
    expect(dot(right.fingers, [0, 0, -1])).toBeGreaterThan(0.99);
  });
});
