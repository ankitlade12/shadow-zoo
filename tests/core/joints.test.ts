import { describe, expect, it } from 'vitest';
import { BONES, J, JOINT_COUNT, JOINT_INDEX, JOINT_NAMES } from '../../src/core/joints.js';

describe('joints', () => {
  it('lists the 25 WebXR hand joints in spec order', () => {
    expect(JOINT_COUNT).toBe(25);
    expect(JOINT_NAMES[0]).toBe('wrist');
    expect(JOINT_NAMES[24]).toBe('pinky-finger-tip');
    expect(JOINT_INDEX['index-finger-tip']).toBe(J.indexTip);
  });

  it('builds bones between valid, distinct joints', () => {
    expect(BONES.length).toBe(24);
    for (const bone of BONES) {
      expect(bone.a).not.toBe(bone.b);
      expect(bone.a).toBeGreaterThanOrEqual(0);
      expect(bone.b).toBeLessThan(JOINT_COUNT);
    }
  });

  it('reaches every fingertip', () => {
    const tips = [J.thumbTip, J.indexTip, J.middleTip, J.ringTip, J.pinkyTip];
    for (const tip of tips) expect(BONES.some((b) => b.b === tip)).toBe(true);
  });
});
