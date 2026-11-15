import { describe, expect, it } from 'vitest';
import { CREATURES } from '../../src/core/library.js';
import { cameraFor, enclosureAt, poolAt, walkLayout, walkToward } from '../../src/ui/zoowalk/layout.js';

const layout = walkLayout();

describe('the zoo walk', () => {
  it('runs from outside the gate, past an enclosure for every creature, to the lantern house', () => {
    expect(layout.enclosures.map((e) => e.species)).toEqual(CREATURES.map((c) => c.id));
    expect(layout.start).toBeLessThan(layout.gate);
    expect(layout.gate).toBeLessThan(layout.enclosures[0].x);
    for (let i = 1; i < layout.enclosures.length; i++) expect(layout.enclosures[i].x).toBeGreaterThan(layout.enclosures[i - 1].x);
    expect(layout.house).toBeGreaterThan(layout.enclosures.at(-1)!.x);
    expect(layout.end).toBeGreaterThanOrEqual(layout.house);
  });

  it("knows which enclosure the visitor stands at, and none between them", () => {
    const [rabbit, dog] = layout.enclosures;
    expect(enclosureAt(layout, rabbit.x)?.species).toBe('rabbit');
    expect(enclosureAt(layout, dog.x - 0.2)?.species).toBe('dog');
    expect(enclosureAt(layout, (rabbit.x + dog.x) / 2)).toBeNull();
    expect(enclosureAt(layout, layout.start)).toBeNull();
  });

  it("finds the enclosure lit at a point on the wall, in that enclosure's own coordinates", () => {
    const croc = layout.enclosures[2];
    const hit = poolAt(layout, croc.x + 0.3, layout.poolY - 0.1);
    expect(hit?.enclosure.species).toBe('crocodile');
    expect(hit?.x).toBeCloseTo(0.3);
    expect(hit?.y).toBeCloseTo(-0.1);
    // Outside the light: above it, or on the dark wall between enclosures.
    expect(poolAt(layout, croc.x, layout.poolY + layout.pool.v * 1.4)).toBeNull();
    expect(poolAt(layout, (croc.x + layout.enclosures[3].x) / 2, layout.poolY)).toBeNull();
  });

  it('walks at a steady pace, stops on its target and never leaves the path', () => {
    const x = walkToward(layout, 0, 10, 0.5, 2);
    expect(x).toBeCloseTo(1);
    expect(walkToward(layout, 0, 0.3, 0.5, 2)).toBeCloseTo(0.3);
    expect(walkToward(layout, layout.end - 0.1, layout.end + 50, 1, 2)).toBe(layout.end);
    expect(walkToward(layout, layout.start + 0.1, layout.start - 50, 1, 2)).toBe(layout.start);
  });

  it('keeps the camera on the scenery at either end', () => {
    expect(cameraFor(layout, layout.enclosures[3].x, 1.5)).toBeCloseTo(layout.enclosures[3].x);
    expect(cameraFor(layout, layout.start, 1.5)).toBeGreaterThan(layout.start);
    expect(cameraFor(layout, layout.end, 1.5)).toBeLessThan(layout.end);
  });
});
