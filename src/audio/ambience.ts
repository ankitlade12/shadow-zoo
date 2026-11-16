import type { PlaceId } from '../core/world.js';

/** A place's night sounds: gains for each layer (0 leaves it out), the insects' pitch (Hz) and chirps per second. */
export interface Ambience {
  readonly crickets: number;
  readonly cricketFreq: number;
  readonly chirpRate: number;
  readonly wind: number;
  readonly windFreq: number;
  readonly rain: number;
  readonly hum: number;
  readonly room: number;
}

/** Seconds of white noise behind every hiss, rustle and room tone: long enough that a layer's loop goes unnoticed. */
const NOISE_SECONDS = 6;

/** The white noise that wind, rain, room tone and the one-shots' hisses are filtered from. Make it once. */
export function createNoise(ctx: BaseAudioContext): AudioBuffer {
  const buffer = ctx.createBuffer(1, ctx.sampleRate * NOISE_SECONDS, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

/** A house cricket chirps about 1.6 times a second; every place's insects sing its song, faster or slower. */
const HOUSE_CHIRP_RATE = 1.6;

const QUIET = { crickets: 0, cricketFreq: 4400, chirpRate: HOUSE_CHIRP_RATE, wind: 0, windFreq: 500, rain: 0, hum: 0, room: 0.02 };

/** Crickets at home, wind on the ice and the sand, rain and frogs in the Amazon, a hush on the Moon. */
export const AMBIENCE: Readonly<Record<PlaceId, Ambience>> = {
  home: { ...QUIET, crickets: 0.014, room: 0.025 },
  arctic: { ...QUIET, wind: 0.03, windFreq: 420 },
  sahara: { ...QUIET, crickets: 0.005, cricketFreq: 3600, chirpRate: 0.75, wind: 0.04, windFreq: 850, room: 0.015 },
  amazon: { ...QUIET, crickets: 0.012, cricketFreq: 2600, chirpRate: 0.6, rain: 0.022, room: 0.015 },
  outback: { ...QUIET, crickets: 0.016, cricketFreq: 5200, chirpRate: 2 },
  moon: { ...QUIET, hum: 0.018, room: 0.006 },
};

/** One cricket in a chorus: its own pitch, loudness and song, and when it chirps within the loop. */
export interface Cricket {
  /** Hz: a pure tone, as a cricket's wing resonates. */
  readonly pitch: number;
  /** 0..1: near crickets are loud, far ones faint. */
  readonly level: number;
  /** Pulses in each chirp. */
  readonly pulses: number;
  /** Each pulse's length, and the silence between pulses (s). */
  readonly on: number;
  readonly off: number;
  /** Seconds between its chirps, before each one's jitter. */
  readonly period: number;
  /** When each chirp starts within the loop (s). */
  readonly chirps: readonly number[];
}

/** A chorus of crickets that loops every `seconds`. */
export interface Chorus {
  readonly seconds: number;
  readonly crickets: readonly Cricket[];
}

/** A house cricket's song: 3-4 pulses of 11-18 ms, 8-13 ms apart, a chirp every 0.42-0.85 s. */
const PULSES = [3, 4] as const;
const PULSE_ON = [0.011, 0.018] as const;
const PULSE_OFF = [0.008, 0.013] as const;
const CHIRP_PERIOD = [0.42, 0.85] as const;
/** Each chirp comes this share of its period early or late. */
const CHIRP_JITTER = 0.05;
/** Six or seven crickets, each pitched up to this share above or below the place's pitch. */
const CHORUS_SIZE = [6, 7] as const;
const PITCH_SPREAD = 0.07;
/** The faintest cricket, against the nearest at 1. */
const FARTHEST = 0.3;
/** How long the chorus runs before it repeats (s). */
const LOOP_SECONDS = 7;
/** The chorus is rendered at this RMS, so each place's cricket gain keeps the loudness it was tuned to. */
const CHORUS_RMS = 0.08;

const between = (range: readonly [number, number], rng: () => number): number => range[0] + (range[1] - range[0]) * rng();

/**
 * The place's insects as a chorus of unsynchronized crickets: each its own pitch, loudness and song
 * (sung faster or slower with the place's chirp rate), its chirps a whole number of times round
 * the loop, so the loop repeats without a seam.
 */
export function cricketChorus(spec: Pick<Ambience, 'cricketFreq' | 'chirpRate'>, rng: () => number): Chorus {
  const slow = HOUSE_CHIRP_RATE / spec.chirpRate;
  const count = rng() < 0.5 ? CHORUS_SIZE[0] : CHORUS_SIZE[1];
  // The whole numbers of chirps that keep a cricket's period within its song's range.
  const fewest = Math.ceil(LOOP_SECONDS / (CHIRP_PERIOD[1] * slow));
  const most = Math.floor(LOOP_SECONDS / (CHIRP_PERIOD[0] * slow));
  const crickets: Cricket[] = [];
  for (let i = 0; i < count; i++) {
    const n = Math.min(most, Math.max(fewest, Math.round(LOOP_SECONDS / (between(CHIRP_PERIOD, rng) * slow))));
    const period = LOOP_SECONDS / n;
    const offset = rng() * period;
    const chirps: number[] = [];
    for (let k = 0; k < n; k++) {
      const t = offset + period * (k + CHIRP_JITTER * (rng() * 2 - 1));
      chirps.push(((t % LOOP_SECONDS) + LOOP_SECONDS) % LOOP_SECONDS);
    }
    crickets.push({
      pitch: spec.cricketFreq * (1 + PITCH_SPREAD * (rng() * 2 - 1)),
      level: FARTHEST + (1 - FARTHEST) * rng() ** 2,
      pulses: rng() < 0.5 ? PULSES[0] : PULSES[1],
      on: between(PULSE_ON, rng) * slow,
      off: between(PULSE_OFF, rng) * slow,
      period,
      chirps,
    });
  }
  return { seconds: LOOP_SECONDS, crickets };
}

/**
 * The chorus as one loop of samples, at a steady level: every pulse a short tone burst that rises
 * quickly and dies away, laid in wherever its cricket chirps, wrapping round the end of the loop.
 */
export function renderChorus(chorus: Chorus, sampleRate: number): Float32Array {
  const n = Math.round(chorus.seconds * sampleRate);
  const out = new Float32Array(n);
  for (const c of chorus.crickets) {
    const m = Math.max(1, Math.round(c.on * sampleRate));
    const pulse = new Float32Array(m);
    for (let j = 0; j < m; j++) {
      const k = j / m;
      const swell = k < 0.3 ? Math.sin((Math.PI / 2) * (k / 0.3)) : Math.cos((Math.PI / 2) * ((k - 0.3) / 0.7));
      pulse[j] = Math.sin((2 * Math.PI * c.pitch * j) / sampleRate) * swell * c.level;
    }
    for (const t of c.chirps) {
      for (let p = 0; p < c.pulses; p++) {
        const start = Math.round((t + p * (c.on + c.off)) * sampleRate);
        for (let j = 0; j < m; j++) out[(start + j) % n] += pulse[j];
      }
    }
  }
  let power = 0;
  for (let i = 0; i < n; i++) power += out[i] * out[i];
  const k = power > 0 ? CHORUS_RMS / Math.sqrt(power / n) : 0;
  for (let i = 0; i < n; i++) out[i] *= k;
  return out;
}

/** The place's cricket chorus as a buffer ready to loop, or null where the place has no insects. Render it once. */
export function createChorus(ctx: BaseAudioContext, place: PlaceId, rng: () => number): AudioBuffer | null {
  const spec = AMBIENCE[place];
  if (spec.crickets <= 0) return null;
  const samples = renderChorus(cricketChorus(spec, rng), ctx.sampleRate);
  const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
  buffer.getChannelData(0).set(samples);
  return buffer;
}

/** A night that is playing. */
export interface Night {
  /** Ends it at `when` (an offline render's cut); without it, ends it now and lets go of its nodes. */
  stop(when?: number): void;
}

export interface NightOptions {
  /** Where the insects sing from (a panner at the stage); the destination when left out. */
  readonly insects?: AudioNode;
  /** When it starts, in the context's time (0: now, or the start of an offline render). */
  readonly when?: number;
  /** The place's chorus from createChorus, if already rendered; rendered here when left out. */
  readonly chorus?: AudioBuffer | null;
}

/**
 * A place's night on `ctx`: its cricket chorus into `options.insects`, and its wind, rain, hum and
 * room tone into `destination`. Every noise layer plays the noise buffer from its own random point
 * (and the chorus from a random point in its loop), so no two layers repeat in step. The game's
 * AudioEngine and an offline render of its sound both build their nights here.
 */
export function buildAmbience(ctx: BaseAudioContext, destination: AudioNode, place: PlaceId, noise: AudioBuffer, rng: () => number, options: NightOptions = {}): Night {
  const spec = AMBIENCE[place];
  const when = options.when ?? 0;
  const sources: AudioScheduledSourceNode[] = [];
  const outs: AudioNode[] = [];
  const loop = (buffer: AudioBuffer): AudioBufferSourceNode => {
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.start(when, rng() * buffer.duration);
    sources.push(src);
    return src;
  };
  const filter = (type: BiquadFilterType, frequency: number, q = 1): BiquadFilterNode => {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = frequency;
    f.Q.value = q;
    return f;
  };
  const gain = (value: number): GainNode => {
    const g = ctx.createGain();
    g.gain.value = value;
    outs.push(g);
    return g;
  };
  /** A slow wobble added to a gain. */
  const wobble = (target: AudioParam, rate: number, depth: number): void => {
    const osc = ctx.createOscillator();
    osc.frequency.value = rate;
    const amount = ctx.createGain();
    amount.gain.value = depth;
    osc.connect(amount).connect(target);
    osc.start(when);
    sources.push(osc);
  };
  const chorus = options.chorus === undefined ? createChorus(ctx, place, rng) : options.chorus;
  if (spec.crickets > 0 && chorus) {
    const level = gain(spec.crickets);
    // A slow swell, out of step with the loop, so the chorus never comes round quite the same.
    wobble(level.gain, 0.09, spec.crickets * 0.3);
    loop(chorus).connect(level).connect(options.insects ?? destination);
  }
  if (spec.wind > 0) {
    const level = gain(spec.wind);
    wobble(level.gain, 0.11, spec.wind * 0.6);
    loop(noise).connect(filter('bandpass', spec.windFreq, 0.7)).connect(level).connect(destination);
  }
  if (spec.rain > 0) loop(noise).connect(filter('highpass', 2200)).connect(gain(spec.rain)).connect(destination);
  if (spec.hum > 0) {
    const osc = ctx.createOscillator();
    osc.frequency.value = 55;
    const level = gain(spec.hum);
    wobble(level.gain, 0.07, spec.hum * 0.5);
    osc.connect(level).connect(destination);
    osc.start(when);
    sources.push(osc);
  }
  loop(noise).connect(filter('lowpass', 220)).connect(gain(spec.room)).connect(destination);
  return {
    stop: (at?: number) => {
      for (const s of sources) s.stop(at);
      if (at === undefined) for (const o of outs) o.disconnect();
    },
  };
}
