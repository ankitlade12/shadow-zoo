import { VisibilityState, type World } from '@iwsdk/core';
import type { XRMode } from '../preview/detect.js';

const NOTES: Record<XRMode, string> = {
  native: 'Made for Meta Quest 3 and 3S. Hands only, seated.',
  preview:
    "No headset here, so this is the desktop preview: Meta's WebXR emulator with a virtual living room and a hand you steer with the mouse. For the real game, open this page in Meta Quest Browser.",
  unsupported: 'Open this page in Meta Quest Browser to play, or on a computer for the desktop preview.',
};
const LOADING = 'Loading the desktop preview…';
const FAILED: Record<XRMode, string> = {
  native: "Mixed reality didn't start. In Meta Quest Browser, allow hand tracking and spatial data when asked, then try again.",
  preview: "The desktop preview didn't start in this browser. Try a current Chrome, Edge or Firefox, or open the page in Meta Quest Browser.",
  unsupported: NOTES.unsupported,
};
const NO_PREVIEW = "This browser can't run the desktop preview. Try a current Chrome, Edge or Firefox, or open the page in Meta Quest Browser.";

const elements = () => ({
  landing: document.getElementById('landing'),
  start: document.getElementById('start') as HTMLButtonElement | null,
  support: document.getElementById('support'),
});

/** Shows how this browser will play while the world loads; the start button waits for the world. */
export function prepareLanding(mode: XRMode): void {
  const { start, support } = elements();
  document.body.dataset.xr = mode;
  if (start) start.disabled = true;
  if (support) support.textContent = mode === 'preview' ? LOADING : NOTES[mode];
}

/** The desktop preview could not start: say so, and leave the start button off. */
export function previewUnavailable(): void {
  prepareLanding('unsupported');
  const { support } = elements();
  if (support) support.textContent = NO_PREVIEW;
}

/** Shows the 2D welcome page outside XR and starts the session from its button, saying so if it can't. */
export function mountLanding(world: World, mode: XRMode): void {
  const { landing, start, support } = elements();
  if (!landing || !start) return;
  world.visibilityState.subscribe((state) => {
    landing.hidden = state !== VisibilityState.NonImmersive;
  });
  if (mode === 'unsupported') return;
  if (support) support.textContent = NOTES[mode];
  start.disabled = false;
  start.addEventListener('click', () => {
    if (world.session || world.sessionRequestPending) return;
    try {
      world.launchXR();
    } catch (error) {
      console.error('[ShadowZoo] Could not start XR:', error);
    }
    void settled(world).then((started) => {
      if (!started && support) support.textContent = FAILED[mode];
    });
  });
}

/** Waits for a session request to settle; true when a session started. */
async function settled(world: World): Promise<boolean> {
  while (world.sessionRequestPending) await new Promise((resolve) => setTimeout(resolve, 100));
  return world.session != null;
}
