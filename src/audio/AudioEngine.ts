import type { Vec3 } from '../core/vec.js';
import { VoiceLimiter } from '../core/voices.js';
import type { PlaceId } from '../core/world.js';
import { AMBIENCE, buildAmbience, createChorus, createNoise } from './ambience.js';
import { playRecipe, type SoundName } from './recipes.js';
import { createRoomEcho } from './room.js';

/** Owns the AudioContext: unlock, master volume, spatial one-shots in the room's echo, and the night ambience. */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buffer: AudioBuffer | null = null;
  /** The room's echo, which every one-shot also plays into. */
  private echo: AudioNode | null = null;
  private ambient: { stop(): void } | null = null;
  /** Each place's cricket chorus, rendered the first time the zoo is there. */
  private readonly choruses = new Map<PlaceId, AudioBuffer | null>();
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
      const buffer = createNoise(ctx);
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
    let chorus = this.choruses.get(place);
    if (chorus === undefined) this.choruses.set(place, (chorus = createChorus(ctx, place, Math.random)));
    const insects = AMBIENCE[place].crickets > 0 ? this.panner(at) : undefined;
    const night = buildAmbience(ctx, master, place, buffer, Math.random, { insects, chorus });
    this.ambient = {
      stop: () => {
        night.stop();
        insects?.disconnect();
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
