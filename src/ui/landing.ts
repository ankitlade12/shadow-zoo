import { VisibilityState, type World } from '@iwsdk/core';
import type { XRMode } from '../preview/detect.js';
import type { PreviewControls } from '../preview/overlay.js';

const NOTES: Record<XRMode, string> = {
  native: 'Made for Meta Quest 3 and 3S. Hands only, seated.',
  preview:
    "No headset here, so this is the desktop preview: Meta's WebXR emulator with a virtual living room and a hand you steer with the mouse. For the real game, open this page in Meta Quest Browser.",
  unsupported: 'Open this page in Meta Quest Browser to play, or on a computer for the desktop preview.',
};
const PREVIEW_WITH_CAMERA =
  "No headset here, so this is the desktop preview: Meta's WebXR emulator with a virtual living room, and your real hands through your camera. For the real game, open this page in Meta Quest Browser.";
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
  startCamera: document.getElementById('start-camera') as HTMLButtonElement | null,
  support: document.getElementById('support'),
});

const canOpenCamera = (): boolean => typeof navigator.mediaDevices?.getUserMedia === 'function';

/** Shows how this browser will play while the world loads; the start buttons wait for the world. */
export function prepareLanding(mode: XRMode): void {
  const { start, startCamera, support } = elements();
  document.body.dataset.xr = mode;
  const camera = mode === 'preview' && canOpenCamera();
  if (start) {
    start.disabled = true;
    start.textContent = camera ? 'or play with the mouse' : 'Light the lantern';
  }
  if (startCamera) {
    startCamera.disabled = true;
    startCamera.hidden = !camera;
    startCamera.innerHTML = 'Light the lantern<small>with my real hands</small>';
  }
  if (support) support.textContent = mode === 'preview' ? LOADING : NOTES[mode];
}

/** The desktop preview could not start: say so, and leave the start buttons off. */
export function previewUnavailable(): void {
  prepareLanding('unsupported');
  const { support } = elements();
  if (support) support.textContent = NO_PREVIEW;
}

/**
 * Shows the 2D welcome page outside XR and starts the session from its buttons, saying so if it
 * can't. In the desktop preview, `controls` offers real hands through the camera first.
 */
export function mountLanding(world: World, mode: XRMode, controls?: PreviewControls): void {
  const { landing, start, startCamera, support } = elements();
  if (!landing || !start) return;
  world.visibilityState.subscribe((state) => {
    landing.hidden = state !== VisibilityState.NonImmersive;
  });
  if (mode === 'unsupported') return;
  const camera = !!controls?.cameraAvailable;
  if (support) support.textContent = mode === 'preview' && camera ? PREVIEW_WITH_CAMERA : NOTES[mode];
  const launch = (): void => {
    if (world.session || world.sessionRequestPending) return;
    try {
      world.launchXR();
    } catch (error) {
      console.error('[ShadowZoo] Could not start XR:', error);
    }
    void settled(world).then((started) => {
      if (!started && support) support.textContent = FAILED[mode];
    });
  };
  start.disabled = false;
  start.addEventListener('click', launch);
  if (startCamera && controls && camera) {
    startCamera.hidden = false;
    startCamera.disabled = false;
    startCamera.addEventListener('click', () => {
      launch();
      void controls.useCamera();
    });
  } else if (startCamera) {
    startCamera.hidden = true;
    start.textContent = 'Light the lantern';
  }
}

/** Waits for a session request to settle; true when a session started. */
async function settled(world: World): Promise<boolean> {
  while (world.sessionRequestPending) await new Promise((resolve) => setTimeout(resolve, 100));
  return world.session != null;
}
