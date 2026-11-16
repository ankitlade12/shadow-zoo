import type { Vec3 } from '../core/vec.js';
import { VoiceLimiter } from '../core/voices.js';
import type { PlaceId } from '../core/world.js';
import { playRecipe, type SoundName } from './recipes.js';
import { createRoomEcho } from './room.js';

/** A place's night sounds: gains for each layer (0 leaves it out), and the insects' pitch and chirp rate. */
interface Ambience {
  readonly crickets: number;
  readonly cricketFreq: number;
  readonly chirpRate: number;
  readonly wind: number;
  readonly windFreq: number;
  readonly rain: number;
  readonly hum: number;
  readonly room: number;
}

const QUIET = { crickets: 0, cricketFreq: 4400, chirpRate: 19, wind: 0, windFreq: 500, rain: 0, hum: 0, room: 0.02 };

/** Crickets at home, wind on the ice and the sand, rain and frogs in the Amazon, a hush on the Moon. */
export const AMBIENCE: Readonly<Record<PlaceId, Ambience>> = {
  home: { ...QUIET, crickets: 0.014, room: 0.025 },
  arctic: { ...QUIET, wind: 0.03, windFreq: 420 },
  sahara: { ...QUIET, crickets: 0.005, cricketFreq: 3600, chirpRate: 9, wind: 0.04, windFreq: 850, room: 0.015 },
  amazon: { ...QUIET, crickets: 0.012, cricketFreq: 2600, chirpRate: 7, rain: 0.022, room: 0.015 },
  outback: { ...QUIET, crickets: 0.016, cricketFreq: 5200, chirpRate: 24 },
  moon: { ...QUIET, hum: 0.018, room: 0.006 },
};

/** Owns the AudioContext: unlock, master volume, spatial one-shots in the room's echo, and the night ambience. */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buffer: AudioBuffer | null = null;
  /** The room's echo, which every one-shot also plays into. */
  private echo: AudioNode | null = null;
  private ambient: { stop(): void } | null = null;
  private readonly limiter = new VoiceLimiter();
  private volume = 0.8;
  private muted = false;

  get ready(): boolean {
    return this.ctx?.state === 'running';
  }

  /** Creates or resumes the context. Call from a user gesture or XR session start. */
  unlock(): void {
    if (!this.ctx) {
      const Ctor = globalThis.AudioContext;
      if (!Ctor) return;
      const ctx = new Ctor();
      const master = ctx.createGain();
      master.gain.value = this.muted ? 0 : this.volume;
      master.connect(ctx.destination);
      const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      this.ctx = ctx;
      this.master = master;
      this.buffer = buffer;
      this.echo = createRoomEcho(ctx, master);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : this.volume;
  }

  setListener(px: number, py: number, pz: number, fx: number, fy: number, fz: number): void {
    const listener = this.ctx?.listener;
    if (!listener) return;
    // Firefox has no listener AudioParams, only the older setters.
    if (!listener.positionX) {
      listener.setPosition(px, py, pz);
      listener.setOrientation(fx, fy, fz, 0, 1, 0);
      return;
    }
    listener.positionX.value = px;
    listener.positionY.value = py;
    listener.positionZ.value = pz;
    listener.forwardX.value = fx;
    listener.forwardY.value = fy;
    listener.forwardZ.value = fz;
    listener.upX.value = 0;
    listener.upY.value = 1;
    listener.upZ.value = 0;
  }

  play(name: SoundName, at: Vec3): void {
    const ctx = this.ctx;
    if (!ctx || !this.buffer || !this.echo || this.muted || ctx.state !== 'running') return;
    if (!this.limiter.allow(name, ctx.currentTime, 0.6)) return;
    const panner = this.panner(at);
    panner.connect(this.echo);
    playRecipe(name, ctx, panner, ctx.currentTime + 0.005, this.buffer);
    setTimeout(() => panner.disconnect(), 1500);
  }

  /** The place's night: insects from the stage, plus its wind, rain or hum, and a low room tone. */
  startAmbient(at: Vec3, place: PlaceId = 'home'): void {
    const ctx = this.ctx;
    const buffer = this.buffer;
    const master = this.master;
    if (!ctx || !buffer || !master || this.ambient) return;
    const spec = AMBIENCE[place];
    const sources: AudioScheduledSourceNode[] = [];
    const outs: AudioNode[] = [];
    const noise = (): AudioBufferSourceNode => {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
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
      return g;
    };
    /** A slow (or, for chirps, fast square) wobble added to a gain. */
    const wobble = (target: AudioParam, rate: number, depth: number, type: OscillatorType = 'sine'): void => {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = rate;
      osc.connect(gain(depth)).connect(target);
      sources.push(osc);
    };
    if (spec.crickets > 0) {
      const panner = this.panner(at);
      const gate = gain(0.5);
      const level = gain(spec.crickets);
      wobble(gate.gain, spec.chirpRate, 0.5, 'square');
      wobble(level.gain, 0.35, spec.crickets * 0.86);
      noise().connect(filter('bandpass', spec.cricketFreq, 9)).connect(gate).connect(level).connect(panner);
      outs.push(panner);
    }
    if (spec.wind > 0) {
      const level = gain(spec.wind);
      wobble(level.gain, 0.11, spec.wind * 0.6);
      noise().connect(filter('bandpass', spec.windFreq, 0.7)).connect(level).connect(master);
      outs.push(level);
    }
    if (spec.rain > 0) {
      const level = gain(spec.rain);
      noise().connect(filter('highpass', 2200)).connect(level).connect(master);
      outs.push(level);
    }
    if (spec.hum > 0) {
      const osc = ctx.createOscillator();
      osc.frequency.value = 55;
      const level = gain(spec.hum);
      wobble(level.gain, 0.07, spec.hum * 0.5);
      osc.connect(level).connect(master);
      sources.push(osc);
      outs.push(level);
    }
    const roomLevel = gain(spec.room);
    noise().connect(filter('lowpass', 220)).connect(roomLevel).connect(master);
    outs.push(roomLevel);
    for (const s of sources) s.start();
    this.ambient = {
      stop: () => {
        for (const s of sources) s.stop();
        for (const o of outs) o.disconnect();
      },
    };
  }

  stopAmbient(): void {
    this.ambient?.stop();
    this.ambient = null;
  }

  private panner(at: Vec3): PannerNode {
    const ctx = this.ctx!;
    const p = ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = 1;
    p.rolloffFactor = 0.6;
    if (p.positionX) {
      p.positionX.value = at[0];
      p.positionY.value = at[1];
      p.positionZ.value = at[2];
    } else {
      p.setPosition(at[0], at[1], at[2]);
    }
    p.connect(this.master!);
    return p;
  }
}
