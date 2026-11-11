import { describe, expect, it } from 'vitest';
import { chooseXRMode, type XREnvironment } from '../../src/preview/detect.js';

const MAC_CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
const QUEST_BROWSER =
  'Mozilla/5.0 (X11; Linux x86_64; Quest 3) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/41.0 SamsungBrowser/4.0 Chrome/140.0.0.0 VR Safari/537.36';

const laptop: XREnvironment = { userAgent: MAC_CHROME, nativeAR: false, emulated: false, finePointer: true };

describe('chooseXRMode', () => {
  it('plays natively where the browser can start mixed reality', () => {
    expect(chooseXRMode({ ...laptop, userAgent: QUEST_BROWSER, nativeAR: true })).toBe('native');
    expect(chooseXRMode({ ...laptop, nativeAR: true })).toBe('native');
  });

  it("never swaps a headset browser's own WebXR for the emulator", () => {
    expect(chooseXRMode({ ...laptop, userAgent: QUEST_BROWSER, nativeAR: false, finePointer: false })).toBe('native');
  });

  it("keeps the dev server's emulator rather than starting a second one", () => {
    expect(chooseXRMode({ ...laptop, emulated: true })).toBe('native');
  });

  it('offers the desktop preview on a computer that cannot start mixed reality', () => {
    expect(chooseXRMode(laptop)).toBe('preview');
  });

  it('turns away touch-only devices, which have no mouse to steer the emulated hand', () => {
    expect(chooseXRMode({ ...laptop, finePointer: false })).toBe('unsupported');
  });
});
