import { describe, expect, it } from 'vitest';
import { createHandShadow, type HandShadow } from '../../src/game/hands.js';
import { Tour } from '../../src/game/Tour.js';

const pool = { u: 0.8, v: 0.6 };
const hand = (x: number, y: number): HandShadow => {
  const h = createHandShadow('right');
  h.tracked = true;
  h.pinchX = x;
  h.pinchY = y;
  return h;
};
const opened = () => {
  const tour = new Tour();
  tour.show('home');
  return tour;
};

describe('Tour', () => {
  it('a pinch on a place travels there', () => {
    const tour = opened();
    const sahara = tour.markers(pool).find((m) => m.id === 'sahara')!;
    expect(sahara.visible).toBe(true);
    const h = hand(sahara.x, sahara.y);
    expect(tour.update(1 / 60, [h], pool)).toBeNull();
    expect(tour.hover).toBe('sahara');
    h.pinch = 'start';
    expect(tour.update(1 / 60, [h], pool)).toEqual({ type: 'travel', place: 'sahara' });
  });

  it('turns slowly by itself, but holds still under a hovering hand', () => {
    const tour = opened();
    const yaw0 = tour.yaw;
    tour.update(1, [], pool);
    expect(tour.yaw).not.toBeCloseTo(yaw0, 3);
    const moon = tour.markers(pool).find((m) => m.id === 'moon')!;
    const held = tour.yaw;
    tour.update(1 / 60, [hand(moon.x, moon.y)], pool);
    expect(tour.hover).toBe('moon');
    expect(tour.yaw).toBe(held);
  });

  it('a pinch-drag on the globe spins it with the hand, and it coasts after letting go', () => {
    const tour = opened();
    const view = tour.view(pool);
    const h = hand(view.cx - view.r * 0.3, view.cy - view.r * 0.5);
    h.pinch = 'start';
    h.detector.pinched = true;
    tour.update(1 / 60, [h], pool);
    h.pinch = null;
    const before = tour.yaw;
    for (let i = 0; i < 10; i++) {
      h.pinchX += 0.01;
      tour.update(1 / 60, [h], pool);
    }
    // Dragging right turns the surface right, one radius of drag per radian: the longitude facing the player moves west.
    expect(tour.yaw).toBeCloseTo(before - 0.1 / view.r, 3);
    h.detector.pinched = false;
    const released = tour.yaw;
    tour.update(0.1, [], pool);
    expect(tour.yaw).toBeLessThan(released - 0.05);
  });

  it('a pinch off the globe closes it', () => {
    const tour = opened();
    const view = tour.view(pool);
    const h = hand(view.cx + view.r * 1.2, view.cy - view.r * 0.9);
    h.pinch = 'start';
    expect(tour.update(1 / 60, [h], pool)).toEqual({ type: 'close' });
  });

  it('does nothing while it is closed', () => {
    const tour = new Tour();
    const h = hand(0, 0);
    h.pinch = 'start';
    expect(tour.update(1 / 60, [h], pool)).toBeNull();
  });
});
