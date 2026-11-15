import { VisibilityState, type World } from '@iwsdk/core';
import type { PlaceId } from '../core/world.js';
import type { XRMode } from '../preview/detect.js';
import type { PreviewControls } from '../preview/overlay.js';
import { store } from '../runtime/store.js';

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

/** How the start plaque names each zoo: "Light the lantern in the Sahara". */
export const PLACE_PHRASE: Readonly<Record<PlaceId, string>> = {
  home: 'at home',
  arctic: 'in the Arctic',
  sahara: 'in the Sahara',
  amazon: 'in the Amazon',
  outback: 'in the Outback',
  moon: 'on the Moon',
};

const elements = () => ({
  landing: document.getElementById('landing'),
  start: document.getElementById('start') as HTMLButtonElement | null,
  startCamera: document.getElementById('start-camera') as HTMLButtonElement | null,
  support: document.getElementById('support'),
});

const canOpenCamera = (): boolean => typeof navigator.mediaDevices?.getUserMedia === 'function';

/** The zoo the game starts in, and whether real hands through the camera lead (the mouse second). */
let zoo: PlaceId = 'home';
let cameraFirst = false;

/** A zoo's seal for a start plaque: its glyph, taken from its cartouche on the atlas. */
function seal(place: PlaceId): HTMLSpanElement {
  const mark = document.createElement('span');
  mark.className = 'seal';
  mark.setAttribute('aria-hidden', 'true');
  const glyph = document.querySelector(`label.zoo[data-place="${place}"] svg`);
  if (glyph) mark.append(glyph.cloneNode(true));
  return mark;
}

const lightIn = (place: PlaceId): HTMLSpanElement => {
  const text = document.createElement('span');
  text.textContent = `Light the lantern ${PLACE_PHRASE[place]}`;
  return text;
};

/** Labels a plaque "Light the lantern in <zoo>", sealed with the zoo's glyph. */
export function labelPlaque(button: HTMLButtonElement, place: PlaceId): void {
  button.replaceChildren(seal(place), lightIn(place));
}

/** Names the chosen zoo on the start buttons, sealed with its glyph. */
function label(): void {
  const { start, startCamera } = elements();
  if (startCamera) {
    const how = document.createElement('small');
    how.textContent = 'with my real hands, through the camera';
    // The space keeps the two lines apart in the button's accessible name.
    startCamera.replaceChildren(seal(zoo), lightIn(zoo), ' ', how);
  }
  if (!start) return;
  if (cameraFirst) start.textContent = 'or play with the mouse';
  else labelPlaque(start, zoo);
}

/**
 * Starts the game in a zoo from elsewhere on the page (the zoo walk's lantern house), the way the
 * homepage's own start does: real hands first where a camera leads. False when this browser can't start.
 */
export function startGame(place: PlaceId): boolean {
  setLandingZoo(place);
  const { start, startCamera } = elements();
  const primary = startCamera && !startCamera.hidden ? startCamera : start;
  if (!primary || primary.disabled || getComputedStyle(primary).display === 'none') return false;
  primary.click();
  return true;
}

/** What the homepage says about playing in this browser. */
export const startNote = (): string => elements().support?.textContent ?? '';

/** The zoo chosen on the atlas: the game starts there. */
export function setLandingZoo(id: PlaceId): void {
  zoo = id;
  label();
}

/** Shows how this browser will play while the world loads; the start buttons wait for the world. */
export function prepareLanding(mode: XRMode): void {
  const { start, startCamera, support } = elements();
  document.body.dataset.xr = mode;
  cameraFirst = mode === 'preview' && canOpenCamera();
  if (start) start.disabled = true;
  if (startCamera) {
    startCamera.disabled = true;
    startCamera.hidden = !cameraFirst;
  }
  label();
  if (support) support.textContent = mode === 'preview' ? LOADING : NOTES[mode];
}

/** The desktop preview could not start: say so, and leave the start buttons off. */
export function previewUnavailable(): void {
  prepareLanding('unsupported');
  const { support } = elements();
  if (support) support.textContent = NO_PREVIEW;
}

/**
 * Shows the 2D homepage outside XR and starts the session from its buttons in the zoo chosen on the
 * atlas, saying so if it can't. In the desktop preview, `controls` offers real hands through the camera first.
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
    store.session?.startAt(zoo);
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
  cameraFirst = !!(startCamera && controls && camera);
  if (startCamera && controls && camera) {
    startCamera.hidden = false;
    startCamera.disabled = false;
    startCamera.addEventListener('click', () => {
      launch();
      void controls.useCamera();
    });
  } else if (startCamera) startCamera.hidden = true;
  label();
}

/** Waits for a session request to settle; true when a session started. */
async function settled(world: World): Promise<boolean> {
  while (world.sessionRequestPending) await new Promise((resolve) => setTimeout(resolve, 100));
  return world.session != null;
}
