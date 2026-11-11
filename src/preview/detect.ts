/**
 * How this browser plays:
 * - native: its own WebXR starts mixed reality (Meta Quest Browser), or the dev server's emulator
 *   already stands in for it.
 * - preview: a computer that can't start mixed reality, so the page runs Meta's WebXR emulator with a
 *   mouse-steered hand (the desktop preview).
 * - unsupported: a touch-only device, which has no mouse to steer that hand.
 */
export type XRMode = 'native' | 'preview' | 'unsupported';

export interface XREnvironment {
  readonly userAgent: string;
  /** navigator.xr.isSessionSupported('immersive-ar') before any emulator is installed. */
  readonly nativeAR: boolean;
  /** The IWSDK dev server's emulator is already running (local development). */
  readonly emulated: boolean;
  /** Some pointer is precise, such as a mouse or trackpad. */
  readonly finePointer: boolean;
}

export function chooseXRMode(env: XREnvironment): XRMode {
  if (env.nativeAR || env.emulated) return 'native';
  // A headset browser keeps its own WebXR even if it reports no AR: the emulator would hide the real hands.
  if (/OculusBrowser/i.test(env.userAgent)) return 'native';
  return env.finePointer ? 'preview' : 'unsupported';
}

interface XRSystemLike {
  isSessionSupported(mode: string): Promise<boolean>;
}

/** Gives up on a browser that never answers whether it supports AR. */
const SUPPORT_TIMEOUT_MS = 2000;

/** Reads this browser's environment and chooses how to play. */
export async function detectXRMode(): Promise<XRMode> {
  const xr = (navigator as Navigator & { xr?: XRSystemLike }).xr;
  const timeout = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), SUPPORT_TIMEOUT_MS));
  const nativeAR = xr ? await Promise.race([xr.isSessionSupported('immersive-ar').catch(() => false), timeout]) : false;
  const profile = (window as Window & { __IWSDK_EMULATION_PROFILE?: { active?: boolean } }).__IWSDK_EMULATION_PROFILE;
  return chooseXRMode({
    userAgent: navigator.userAgent,
    nativeAR,
    emulated: profile?.active === true,
    finePointer: matchMedia('(any-pointer: fine)').matches,
  });
}
