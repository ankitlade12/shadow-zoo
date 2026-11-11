import { describe, expect, it } from 'vitest';
import { CREATURES } from '../../src/core/library.js';
import {
  createPreviewInput,
  nudgeReach,
  poseFor,
  REACH_MAX,
  REACH_MIN,
  REST_POSE,
  shapeForKey,
} from '../../src/preview/controls.js';

describe('preview keys', () => {
  it('makes the creature shapes with keys 1 to 7, in library order (7 is the two-handed bird)', () => {
    expect(['1', '2', '3', '4', '5', '6', '7'].map(shapeForKey)).toEqual(CREATURES.map((c) => c.id));
    expect(shapeForKey('7')).toBe('bird');
  });

  it('opens the hand with 0 and ignores other keys', () => {
    expect(shapeForKey('0')).toBeNull();
    for (const key of ['8', '9', 'a', ' ', 'Enter']) expect(shapeForKey(key)).toBeUndefined();
  });
});

describe('poseFor', () => {
  it('rests the hand until a shape is chosen', () => {
    expect(poseFor(createPreviewInput())).toBe(REST_POSE);
    expect(poseFor({ shape: null, act: true })).toBe(REST_POSE);
  });

  it("holds the creature's shape, and its action pose while snapping", () => {
    expect(poseFor({ shape: 'dog', act: false })).toBe('shadowzoo-dog');
    expect(poseFor({ shape: 'dog', act: true })).toBe('shadowzoo-dog-act');
  });
});

describe('nudgeReach', () => {
  it('scrolling up brings the hand toward the light (a bigger shadow), down takes it away', () => {
    expect(nudgeReach(1, -1)).toBeLessThan(1);
    expect(nudgeReach(1, 1)).toBeGreaterThan(1);
  });

  it('keeps the hand within reach of the light', () => {
    expect(nudgeReach(1, -100)).toBe(REACH_MIN);
    expect(nudgeReach(1, 100)).toBe(REACH_MAX);
  });
});
