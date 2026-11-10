import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import { buildCreatureShapes, CREATURES } from '../src/core/library.js';
import { createFrame, Silhouettes } from '../src/core/silhouette.js';
import { encodePng } from './support/png.js';

// Contact sheet, 3 x 2: rabbit, dog, crocodile / swan, spider, turtle.
describe.runIf(process.env.SHEET === '1')('silhouette sheet', () => {
  it('writes docs/silhouettes.png', () => {
    const cell = 200;
    const cols = 3;
    const rows = Math.ceil(CREATURES.length / cols);
    const width = cols * cell;
    const height = rows * cell;
    const rgba = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) rgba.set([250, 214, 160, 255], i * 4);
    const sil = new Silhouettes(cell);
    const shapes = buildCreatureShapes();
    CREATURES.forEach((def, index) => {
      const shape = shapes.get(def.id)!;
      const frame = createFrame();
      sil.measure(shape.caps, 0, shape.count, frame);
      sil.rasterize(shape.caps, 0, shape.count, frame, 0, false, sil.scratch);
      const ox = (index % cols) * cell;
      const oy = Math.floor(index / cols) * cell;
      for (let y = 0; y < cell; y++) {
        for (let x = 0; x < cell; x++) {
          if (!sil.scratch[(cell - 1 - y) * cell + x]) continue;
          rgba.set([28, 18, 12, 255], ((oy + y) * width + ox + x) * 4);
        }
      }
    });
    mkdirSync('docs', { recursive: true });
    writeFileSync('docs/silhouettes.png', encodePng(width, height, rgba));
  });
});
