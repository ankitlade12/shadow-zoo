import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioEngine } from '../../src/audio/AudioEngine.js';

const param = () => ({ value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn(), setTargetAtTime: vi.fn() });

/** A node of the fake graph: what it is, its settings, and what it feeds. */
interface FakeNode {
  readonly kind: string;
  readonly feeds: FakeNode[];
  [setting: string]: unknown;
}

/**
 * A stand-in AudioContext that records the graph it is asked to build; `paramListener` false gives
 * Firefox's listener, which has only setPosition and setOrientation.
 */
function fakeContext(paramListener: boolean, made: FakeNode[]) {
  const listener = paramListener
    ? { positionX: param(), positionY: param(), positionZ: param(), forwardX: param(), forwardY: param(), forwardZ: param(), upX: param(), upY: param(), upZ: param() }
    : { setPosition: vi.fn(), setOrientation: vi.fn() };
  const node = (kind: string, settings: Record<string, unknown> = {}): FakeNode => {
    const n: FakeNode = {
      kind,
      feeds: [],
      ...settings,
      connect: (target: FakeNode) => {
        n.feeds.push(target);
        return target;
      },
      disconnect: vi.fn(),
    };
    made.push(n);
    return n;
  };
  const scheduled = () => ({ start: vi.fn(), stop: vi.fn() });
  return class {
    state = 'running';
    sampleRate = 48000;
    currentTime = 0;
    destination = node('destination');
    listener = listener;
    createGain = () => node('gain', { gain: param() });
    createBiquadFilter = () => node('filter', { type: 'lowpass', frequency: param(), Q: param() });
    createConvolver = () => node('convolver', { normalize: true, buffer: null });
    createPanner = () => node('panner', { positionX: param(), positionY: param(), positionZ: param() });
    createOscillator = () => node('oscillator', { type: 'sine', frequency: param(), ...scheduled() });
    createBufferSource = () => node('source', { buffer: null, loop: false, ...scheduled() });
    createBuffer = (channels: number, length: number, sampleRate: number) => {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return { numberOfChannels: channels, length, sampleRate, duration: length / sampleRate, getChannelData: (c: number) => data[c] };
    };
    resume = vi.fn();
  };
}

const unlocked = (paramListener = true) => {
  const made: FakeNode[] = [];
  vi.stubGlobal('AudioContext', fakeContext(paramListener, made));
  const engine = new AudioEngine();
  engine.unlock();
  return { engine, made };
};
const listenerOf = (engine: AudioEngine) => (engine as unknown as { ctx: { listener: Record<string, unknown> } }).ctx.listener;
const only = (made: FakeNode[], kind: string) => {
  const all = made.filter((n) => n.kind === kind);
  expect(all).toHaveLength(1);
  return all[0];
};

describe('AudioEngine.setListener', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('moves the listener through its AudioParams where the browser has them', () => {
    const { engine } = unlocked(true);
    engine.setListener(1, 1.6, -2, 0, 0, -1);
    const l = listenerOf(engine) as Record<string, { value: number }>;
    expect([l.positionX.value, l.positionY.value, l.positionZ.value]).toEqual([1, 1.6, -2]);
    expect([l.forwardX.value, l.forwardY.value, l.forwardZ.value, l.upY.value]).toEqual([0, 0, -1, 1]);
  });

  it("falls back to setPosition and setOrientation in browsers without them (Firefox)", () => {
    const { engine } = unlocked(false);
    expect(() => engine.setListener(1, 1.6, -2, 0, 0, -1)).not.toThrow();
    const l = listenerOf(engine) as { setPosition: ReturnType<typeof vi.fn>; setOrientation: ReturnType<typeof vi.fn> };
    expect(l.setPosition).toHaveBeenCalledWith(1, 1.6, -2);
    expect(l.setOrientation).toHaveBeenCalledWith(0, 0, -1, 0, 1, 0);
  });
});

describe('AudioEngine room echo', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('sends every one-shot, dry and through one shared room, quietly and without the lows', () => {
    vi.useFakeTimers();
    const { engine, made } = unlocked();
    engine.play('pet', [0, 1.4, -2]);
    engine.play('eat', [0.3, 1.2, -2]);
    const master = made.find((n) => n.kind === 'gain' && n.feeds.some((f) => f.kind === 'destination'))!;
    const room = only(made, 'convolver');
    const send = made.find((n) => n.feeds.includes(room))!;
    const panners = made.filter((n) => n.kind === 'panner');
    expect(panners).toHaveLength(2);
    for (const p of panners) expect(p.feeds).toEqual([master, send]);
    expect(send.kind).toBe('filter');
    expect(send.type).toBe('highpass');
    expect((send.frequency as { value: number }).value).toBeCloseTo(180, -1);
    // The room's own two ears, at a level set by the send alone.
    const impulse = room.buffer as { numberOfChannels: number; duration: number };
    expect(impulse.numberOfChannels).toBe(2);
    expect(impulse.duration).toBeCloseTo(0.5, 1);
    expect(room.normalize).toBe(false);
    const [wet] = room.feeds;
    const db = 20 * Math.log10((wet.gain as { value: number }).value);
    expect(db).toBeGreaterThan(-18);
    expect(db).toBeLessThan(-12);
    expect(wet.feeds).toEqual([master]);
  });
});
