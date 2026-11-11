import { createPreviewInput } from './controls.js';
import type { EmulatedDevice } from './emulator.js';

/** Desktop preview state: the emulated headset (null when the browser plays natively) and the player's input. */
export const preview = {
  device: null as EmulatedDevice | null,
  input: createPreviewInput(),
};
