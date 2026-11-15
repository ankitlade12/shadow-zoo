import { describe, expect, it } from 'vitest';
import { WeatherField } from '../../src/core/weather.js';
import { mulberry32 } from '../../src/core/rng.js';
import { GLOBE_DOTS, HOME_RULES, isLand, markerAt, placeMarkers, placeOf, PLACES, projectGlobe, yawFacing, type GlobeView, type Projected } from '../../src/core/world.js';

const view = (lon: number): GlobeView => ({ cx: 0, cy: 0, r: 0.3, yaw: yawFacing(lon), tilt: 0.38 });
const p: Projected = { x: 0, y: 0, depth: 0 };

describe('World map', () => {
  it('knows land from sea', () => {
    expect(isLand(23, 8)).toBe(true); // the Sahara
    expect(isLand(-3, -62)).toBe(true); // the Amazon
    expect(isLand(-25, 133)).toBe(true); // the Outback
    expect(isLand(40, -100)).toBe(true); // North America
    expect(isLand(0, -150)).toBe(false); // the Pacific
    expect(isLand(30, -40)).toBe(false); // the Atlantic
    expect(isLand(-20, 75)).toBe(false); // the Indian Ocean
  });

  it('draws the globe from evenly spaced land dots', () => {
    expect(GLOBE_DOTS.length).toBeGreaterThan(300);
    expect(GLOBE_DOTS.length).toBeLessThan(1000);
    for (const d of GLOBE_DOTS) expect(isLand(d.lat, d.lon)).toBe(true);
  });

  it('turns a place to the front, and hides it on the far side', () => {
    projectGlobe(0, 30, view(30), p);
    expect(p.x).toBeCloseTo(0, 6);
    expect(p.depth).toBeGreaterThan(0.9);
    projectGlobe(0, 30, view(210), p);
    expect(p.depth).toBeLessThan(-0.9);
  });

  it('every place speaks in one short line and changes the zoo its own way', () => {
    for (const place of PLACES) {
      expect(place.hover.length).toBeLessThanOrEqual(46);
      expect(place.arrival.length).toBeLessThanOrEqual(46);
    }
    expect(placeOf('home').rules).toBe(HOME_RULES);
    expect(placeOf('moon').rules.gravity).toBeLessThan(0.5);
    expect(placeOf('arctic').rules.slide).toBeGreaterThan(0);
    expect(placeOf('sahara').rules.wind).toBeGreaterThan(0);
    expect(placeOf('amazon').rules.fireflies).toBeGreaterThan(1);
    expect(placeOf('outback').rules.bounce).toBeGreaterThan(HOME_RULES.bounce);
  });
});

describe('Place markers', () => {
  it('a place on the near side can be picked where it shows; turned away, it cannot', () => {
    const near = placeMarkers(view(8), 0);
    const sahara = near.find((m) => m.id === 'sahara')!;
    expect(sahara.visible).toBe(true);
    expect(markerAt(near, sahara.x + 0.005, sahara.y, 0.04)).toBe('sahara');
    const far = placeMarkers(view(188), 0);
    expect(far.find((m) => m.id === 'sahara')!.visible).toBe(false);
    expect(markerAt(far, sahara.x, sahara.y, 0.04)).not.toBe('sahara');
  });

  it('home and the Moon float beside the globe, always within reach', () => {
    for (const lon of [0, 120, 240]) {
      const markers = placeMarkers(view(lon), lon);
      for (const id of ['home', 'moon'] as const) {
        const m = markers.find((k) => k.id === id)!;
        expect(m.visible).toBe(true);
        expect(Math.hypot(m.x, m.y)).toBeGreaterThan(0.3);
        expect(markerAt(markers, m.x, m.y, 0.04)).toBe(id);
      }
    }
  });
});

describe('WeatherField', () => {
  const pool = { u: 0.8, v: 0.6 };
  const run = (kind: 'snow' | 'rain' | 'sand' | 'dust', wind = 0) => {
    const w = new WeatherField(mulberry32(3));
    w.set(kind, pool);
    let fall = 0;
    let drift = 0;
    for (let f = 0; f < 30; f++) {
      const xs = Array.from(w.x);
      const ys = Array.from(w.y);
      w.update(1 / 60, pool, wind);
      for (let i = 0; i < w.count; i++) {
        if (Math.abs(w.y[i] - ys[i]) < pool.v) fall += ys[i] - w.y[i];
        if (Math.abs(w.x[i] - xs[i]) < pool.u) drift += w.x[i] - xs[i];
        expect(Math.abs(w.x[i])).toBeLessThanOrEqual(pool.u);
        expect(Math.abs(w.y[i])).toBeLessThanOrEqual(pool.v);
      }
    }
    return { fall, drift };
  };

  it('stays in the light: rain falls faster than snow, sand streaks along, dust barely moves', () => {
    const snow = run('snow');
    const rain = run('rain');
    const sand = run('sand', 1.4);
    const dust = run('dust');
    expect(rain.fall).toBeGreaterThan(snow.fall * 5);
    expect(snow.fall).toBeGreaterThan(0);
    expect(sand.drift).toBeGreaterThan(Math.abs(sand.fall));
    expect(Math.abs(dust.fall) + Math.abs(dust.drift)).toBeLessThan(snow.fall);
  });

  it('shows nothing where there is no weather', () => {
    const w = new WeatherField(mulberry32(3));
    w.set('none', pool);
    expect(w.count).toBe(0);
  });
});
