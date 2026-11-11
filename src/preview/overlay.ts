import { VisibilityState, type World } from '@iwsdk/core';
import type { CreatureId } from '../core/library.js';
import { store } from '../runtime/store.js';
import { nudgeReach, shapeForKey } from './controls.js';
import { preview } from './state.js';

/** Pixels of scrolling per reach step, and pixels per line for wheels that scroll by lines. */
const SCROLL_STEP = 120;
const LINE_HEIGHT = 33;

/**
 * Desktop preview controls: the mouse moves the emulated hand's shadow and pinches, keys 1 to 6 shape
 * the hand (0 opens it), Space holds the creature's action, the wheel moves the hand nearer the light
 * and Escape leaves. A bar along the bottom lists them while the preview runs.
 */
export function mountPreviewControls(world: World): void {
  const bar = document.getElementById('preview-bar');
  const canvas = world.renderer.domElement;
  const input = preview.input;
  const playing = (): boolean => world.visibilityState.value !== VisibilityState.NonImmersive;
  const chips = bar ? Array.from(bar.querySelectorAll<HTMLButtonElement>('button[data-shape]')) : [];

  const showShape = (): void => {
    for (const chip of chips) chip.setAttribute('aria-pressed', String(chip.dataset.shape === (input.shape ?? '')));
  };
  const setShape = (shape: CreatureId | null): void => {
    input.shape = shape;
    input.act = false;
    showShape();
  };
  const release = (): void => {
    input.pinch = false;
    input.act = false;
  };

  for (const chip of chips) {
    // Keep focus on the page, so Space snaps the jaw instead of pressing the button again.
    chip.addEventListener('mousedown', (event) => event.preventDefault());
    chip.addEventListener('click', () => setShape((chip.dataset.shape || null) as CreatureId | null));
  }
  bar?.querySelector<HTMLButtonElement>('button[data-action="leave"]')?.addEventListener('click', () => world.exitXR());

  window.addEventListener('keydown', (event) => {
    if (!playing() || event.metaKey || event.ctrlKey || event.altKey) return;
    const shape = shapeForKey(event.key);
    if (shape !== undefined) setShape(shape);
    else if (event.key === ' ') input.act = input.shape !== null;
    else if (event.key === '+' || event.key === '=') input.reach = nudgeReach(input.reach, -1);
    else if (event.key === '-' || event.key === '_') input.reach = nudgeReach(input.reach, 1);
    else if (event.key === 'Escape') world.exitXR();
    else return;
    event.preventDefault();
  });
  window.addEventListener('keyup', (event) => {
    if (event.key === ' ') input.act = false;
  });
  window.addEventListener('blur', release);

  canvas.addEventListener('pointermove', (event) => {
    const r = canvas.getBoundingClientRect();
    input.cursor = { x: ((event.clientX - r.left) / r.width) * 2 - 1, y: 1 - ((event.clientY - r.top) / r.height) * 2 };
  });
  canvas.addEventListener('pointerleave', () => {
    input.cursor = null;
    input.pinch = false;
  });
  // A click on the menu is a click; anywhere else the hand pinches (a firefly).
  canvas.addEventListener('pointerdown', (event) => {
    if (playing() && event.button === 0 && !store.uiHovered) input.pinch = true;
  });
  window.addEventListener('pointerup', () => {
    input.pinch = false;
  });
  canvas.addEventListener(
    'wheel',
    (event) => {
      if (!playing()) return;
      event.preventDefault();
      const pixels = event.deltaMode === 1 ? event.deltaY * LINE_HEIGHT : event.deltaY;
      input.reach = nudgeReach(input.reach, pixels / SCROLL_STEP);
    },
    { passive: false },
  );

  world.visibilityState.subscribe((state) => {
    const on = state !== VisibilityState.NonImmersive;
    if (bar) bar.hidden = !on;
    canvas.style.cursor = on ? 'crosshair' : '';
    if (!on) {
      release();
      input.cursor = null;
    }
  });
  showShape();
}
