import type { Vec3 } from '../core/vec.js';
import { VoiceLimiter } from '../core/voices.js';
import { playRecipe, type SoundName } from './recipes.js';

/** Owns the AudioContext: unlock, master volume, spatial one-shots and the night ambience. */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buffer: AudioBuffer | null = null;
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
    if (!ctx || !this.buffer || this.muted || ctx.state !== 'running') return;
    if (!this.limiter.allow(name, ctx.currentTime, 0.6)) return;
    const panner = this.panner(at);
    playRecipe(name, ctx, panner, ctx.currentTime + 0.005, this.buffer);
    setTimeout(() => panner.disconnect(), 1500);
  }

  /** Crickets from the stage and a low room tone. */
  startAmbient(at: Vec3): void {
    const ctx = this.ctx;
    if (!ctx || !this.buffer || !this.master || this.ambient) return;
    const panner = this.panner(at);
    const crickets = ctx.createBufferSource();
    crickets.buffer = this.buffer;
    crickets.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 4400;
    band.Q.value = 9;
    const gate = ctx.createGain();
    gate.gain.value = 0.5;
    const chirp = ctx.createOscillator();
    chirp.type = 'square';
    chirp.frequency.value = 19;
    const chirpDepth = ctx.createGain();
    chirpDepth.gain.value = 0.5;
    const level = ctx.createGain();
    level.gain.value = 0.014;
    const swell = ctx.createOscillator();
    swell.frequency.value = 0.35;
    const swellDepth = ctx.createGain();
    swellDepth.gain.value = 0.012;
    chirp.connect(chirpDepth).connect(gate.gain);
    swell.connect(swellDepth).connect(level.gain);
    crickets.connect(band).connect(gate).connect(level).connect(panner);
    const room = ctx.createBufferSource();
    room.buffer = this.buffer;
    room.loop = true;
    const low = ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = 220;
    const roomLevel = ctx.createGain();
    roomLevel.gain.value = 0.025;
    room.connect(low).connect(roomLevel).connect(this.master);
    const sources = [crickets, chirp, swell, room];
    for (const s of sources) s.start();
    this.ambient = {
      stop: () => {
        for (const s of sources) s.stop();
        panner.disconnect();
        roomLevel.disconnect();
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
    p.positionX.value = at[0];
    p.positionY.value = at[1];
    p.positionZ.value = at[2];
    p.connect(this.master!);
    return p;
  }
}
