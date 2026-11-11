import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioEngine } from '../../src/audio/AudioEngine.js';

const param = () => ({ value: 0 });

/** A stand-in AudioContext; `paramListener` false gives Firefox's listener, which has only setPosition and setOrientation. */
function fakeContext(paramListener: boolean) {
  const listener = paramListener
    ? { positionX: param(), positionY: param(), positionZ: param(), forwardX: param(), forwardY: param(), forwardZ: param(), upX: param(), upY: param(), upZ: param() }
    : { setPosition: vi.fn(), setOrientation: vi.fn() };
  const node = () => ({ gain: param(), connect: vi.fn(), disconnect: vi.fn() });
  return class {
    state = 'running';
    sampleRate = 48000;
    destination = {};
    listener = listener;
    createGain = node;
    createBuffer = (_channels: number, length: number) => ({ getChannelData: () => new Float32Array(length) });
    resume = vi.fn();
  };
}

const unlocked = (paramListener: boolean) => {
  vi.stubGlobal('AudioContext', fakeContext(paramListener));
  const engine = new AudioEngine();
  engine.unlock();
  return engine;
};
const listenerOf = (engine: AudioEngine) => (engine as unknown as { ctx: { listener: Record<string, unknown> } }).ctx.listener;

describe('AudioEngine.setListener', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('moves the listener through its AudioParams where the browser has them', () => {
    const engine = unlocked(true);
    engine.setListener(1, 1.6, -2, 0, 0, -1);
    const l = listenerOf(engine) as Record<string, { value: number }>;
    expect([l.positionX.value, l.positionY.value, l.positionZ.value]).toEqual([1, 1.6, -2]);
    expect([l.forwardX.value, l.forwardY.value, l.forwardZ.value, l.upY.value]).toEqual([0, 0, -1, 1]);
  });

  it("falls back to setPosition and setOrientation in browsers without them (Firefox)", () => {
    const engine = unlocked(false);
    expect(() => engine.setListener(1, 1.6, -2, 0, 0, -1)).not.toThrow();
    const l = listenerOf(engine) as { setPosition: ReturnType<typeof vi.fn>; setOrientation: ReturnType<typeof vi.fn> };
    expect(l.setPosition).toHaveBeenCalledWith(1, 1.6, -2);
    expect(l.setOrientation).toHaveBeenCalledWith(0, 0, -1, 0, 1, 0);
  });
});
