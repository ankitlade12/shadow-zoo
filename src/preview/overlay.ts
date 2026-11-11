import { VisibilityState, type World } from '@iwsdk/core';
import type { CreatureId } from '../core/library.js';
import { store } from '../runtime/store.js';
import type { CameraTracker } from './camera/tracker.js';
import { nudgeReach, shapeForKey } from './controls.js';
import { preview } from './state.js';

/** Pixels of scrolling per reach step, and pixels per line for wheels that scroll by lines. */
const SCROLL_STEP = 120;
const LINE_HEIGHT = 33;

/** What the landing page needs from the preview controls. */
export interface PreviewControls {
  /** True when the browser can open a camera, so real hands are offered first. */
  readonly cameraAvailable: boolean;
  /** Turns on real hands from the camera; falls back to the mouse, with a note, if it can't. */
  useCamera(): Promise<void>;
}

/**
 * Desktop preview controls. With the camera, the player's real hands cast the shadows. With the
 * mouse, an emulated hand's shadow follows the cursor: keys 1 to 6 shape it (0 opens it), a click
 * pinches, Space holds the creature's action and the wheel moves the hand nearer the light. Escape
 * leaves. A bar along the bottom lists the controls while the preview runs.
 */
export function mountPreviewControls(world: World): PreviewControls {
  const bar = document.getElementById('preview-bar');
  const cameraView = document.getElementById('camera-view');
  const cameraNote = document.getElementById('camera-note');
  const video = cameraView?.querySelector('video') ?? null;
  const overlay = cameraView?.querySelector('canvas') ?? null;
  const toggle = bar?.querySelector<HTMLButtonElement>('button[data-action="camera"]') ?? null;
  const canvas = world.renderer.domElement;
  const input = preview.input;
  const playing = (): boolean => world.visibilityState.value !== VisibilityState.NonImmersive;
  const chips = bar ? Array.from(bar.querySelectorAll<HTMLButtonElement>('button[data-shape]')) : [];
  const cameraAvailable = typeof navigator.mediaDevices?.getUserMedia === 'function' && !!video && !!overlay;

  let tracker: CameraTracker | null = null;
  let starting = false;
  let noteTimer = 0;
  let countTimer = 0;

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
  const note = (text: string): void => {
    if (cameraNote) cameraNote.textContent = text;
  };
  const showInput = (): void => {
    const camera = tracker !== null || starting;
    if (bar) bar.dataset.input = camera ? 'camera' : 'mouse';
    if (toggle) toggle.textContent = camera ? 'Use the mouse' : 'Use my camera';
    if (toggle) toggle.hidden = !cameraAvailable;
  };

  const stopCamera = (): void => {
    window.clearInterval(countTimer);
    tracker?.stop();
    tracker = null;
    store.handSource = null;
    if (cameraView) cameraView.hidden = true;
    showInput();
  };

  const useCamera = async (): Promise<void> => {
    if (!cameraAvailable || tracker || starting || !video || !overlay || !cameraView) return;
    starting = true;
    window.clearTimeout(noteTimer);
    cameraView.hidden = false;
    showInput();
    try {
      const { startCameraTracker } = await import('./camera/tracker.js');
      const started = await startCameraTracker({ video, overlay }, note);
      starting = false;
      if (!playing()) {
        started.stop();
        stopCamera();
        return;
      }
      tracker = started;
      store.handSource = (side, stage, out) => started.sample(side, stage, out);
      countTimer = window.setInterval(() => {
        const n = started.count;
        note(n === 0 ? 'Hold a hand up to the camera' : n === 1 ? 'Tracking your hand' : 'Tracking both hands');
      }, 300);
    } catch (error) {
      starting = false;
      console.warn('[ShadowZoo] Camera hands unavailable:', error);
      const name = (error as { name?: string } | null)?.name;
      note(
        name === 'NotAllowedError'
          ? 'Camera access was declined, so the mouse steers the hand.'
          : name === 'NotFoundError' || name === 'OverconstrainedError'
            ? 'No camera found, so the mouse steers the hand.'
            : "The camera didn't start, so the mouse steers the hand.",
      );
      // The mouse takes over at once; the note stays up a moment before the camera view closes.
      noteTimer = window.setTimeout(stopCamera, 4000);
    }
    showInput();
  };

  for (const chip of chips) {
    // Keep focus on the page, so Space snaps the jaw instead of pressing the button again.
    chip.addEventListener('mousedown', (event) => event.preventDefault());
    chip.addEventListener('click', () => setShape((chip.dataset.shape || null) as CreatureId | null));
  }
  toggle?.addEventListener('mousedown', (event) => event.preventDefault());
  toggle?.addEventListener('click', () => {
    if (tracker || starting) stopCamera();
    else void useCamera();
  });
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
      // The camera is only on while playing.
      window.clearTimeout(noteTimer);
      stopCamera();
    }
  });
  showShape();
  showInput();
  return { cameraAvailable, useCamera };
}
