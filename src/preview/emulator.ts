import { previewHandPoses } from './poses.js';

/** The parts of an IWER emulated hand the desktop preview drives (the runtime bundles its own IWER). */
export interface EmulatedHand {
  connected: boolean;
  poseId: string;
  readonly pinchValue: number;
  updatePinchValue(value: number): void;
  setPin(pin: null): void;
  readonly position: { set(x: number, y: number, z: number): unknown };
  readonly quaternion: { set(x: number, y: number, z: number, w: number): unknown };
}

/** The parts of the IWER emulated headset the desktop preview drives. */
export interface EmulatedDevice {
  primaryInputMode: 'controller' | 'hand';
  stereoEnabled: boolean;
  /** Vertical field of view, radians. */
  fovy: number;
  readonly position: { readonly x: number; readonly y: number; readonly z: number; set(x: number, y: number, z: number): unknown };
  readonly quaternion: {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly w: number;
    set(x: number, y: number, z: number, w: number): unknown;
  };
  readonly hands: { readonly left?: EmulatedHand; readonly right?: EmulatedHand };
}

/** IWER keeps a hand's pose table under this private symbol. */
const HAND_INPUT_SYMBOL = '@iwer/xr-hand-input';
const DEG = Math.PI / 180;
/**
 * Head 1.6 m above the floor, looking 14 degrees down with a 70 degree view: the light pool and its
 * caption fill the top half, and the hand (drawn like a hand in passthrough) shows above the controls.
 */
const HEAD_HEIGHT = 1.6;
const HEAD_PITCH = -14 * DEG;
const FOV = 70 * DEG;

/**
 * Starts Meta's WebXR emulator (IWER, as IWSDK's dev server runs it) in a virtual living room, for
 * computers that can't start mixed reality. It replaces navigator.xr, so call it before World.create.
 * The developer overlay is left out: the preview has its own mouse and keyboard controls.
 */
export async function startEmulator(): Promise<EmulatedDevice> {
  const { startIwsdkDevRuntime } = await import('iwsdk-emulator-runtime');
  const page = window as Window & { __IWER_MCP_MANAGED?: boolean; IWER_DEVICE?: EmulatedDevice };
  // With ai.devUI false, a "managed" page skips the developer overlay; nothing else reads the flag.
  page.__IWER_MCP_MANAGED = true;
  try {
    startIwsdkDevRuntime({
      device: 'metaQuest3',
      activation: 'always',
      verbose: false,
      sem: { defaultScene: 'sunlit_living_room' },
      ai: { devUI: false },
      workspace: null,
      userAgentException: '/OculusBrowser/',
      iwer: true,
      nativeXRControl: false,
    });
  } finally {
    delete page.__IWER_MCP_MANAGED;
  }
  const device = page.IWER_DEVICE;
  if (!device?.hands.left || !device.hands.right) throw new Error('The WebXR emulator did not start.');
  device.primaryInputMode = 'hand';
  device.stereoEnabled = false;
  device.fovy = FOV;
  device.position.set(0, HEAD_HEIGHT, 0);
  device.quaternion.set(Math.sin(HEAD_PITCH / 2), 0, 0, Math.cos(HEAD_PITCH / 2));
  // One hand, the left: the creature shapes and their outlines are left-handed, so its shadow fits them exactly.
  device.hands.right.connected = false;
  device.hands.left.connected = false;
  device.hands.left.setPin(null);
  addPoses(device.hands.left);
  return device;
}

/** Adds the preview's poses to the hand's pose table, which IWER only fills from its device profile. */
function addPoses(hand: EmulatedHand): void {
  const key = Object.getOwnPropertySymbols(hand).find((s) => s.description === HAND_INPUT_SYMBOL);
  const state = key ? (hand as unknown as Record<symbol, { poses?: Record<string, unknown> } | undefined>)[key] : undefined;
  if (!state?.poses) throw new Error('The emulated hand has no pose table.');
  for (const [id, pose] of previewHandPoses()) state.poses[id] = pose;
}
