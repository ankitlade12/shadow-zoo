import type { CreatureId } from '../core/library.js';

export type SoundName = 'reveal' | 'firefly' | 'eat' | 'pet' | 'flee' | `voice-${CreatureId}`;

interface ToneSpec {
  readonly type: OscillatorType;
  readonly f0: number;
  readonly f1: number;
  readonly dur: number;
  readonly gain: number;
  readonly delay?: number;
  readonly attack?: number;
}

interface NoiseSpec {
  readonly dur: number;
  readonly gain: number;
  readonly filter: BiquadFilterType;
  readonly freq: number;
  readonly q?: number;
  readonly delay?: number;
}

function tone(ctx: AudioContext, out: AudioNode, t0: number, s: ToneSpec): void {
  const t = t0 + (s.delay ?? 0);
  const osc = ctx.createOscillator();
  osc.type = s.type;
  osc.frequency.setValueAtTime(s.f0, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, s.f1), t + s.dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(s.gain, t + (s.attack ?? 0.01));
  g.gain.exponentialRampToValueAtTime(0.0001, t + s.dur);
  osc.connect(g).connect(out);
  osc.start(t);
  osc.stop(t + s.dur + 0.02);
}

function noise(ctx: AudioContext, out: AudioNode, t0: number, buffer: AudioBuffer, s: NoiseSpec): void {
  const t = t0 + (s.delay ?? 0);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = s.filter;
  filter.frequency.value = s.freq;
  filter.Q.value = s.q ?? 1;
  const g = ctx.createGain();
  g.gain.setValueAtTime(s.gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + s.dur);
  src.connect(filter).connect(g).connect(out);
  src.start(t, Math.random() * 1.5);
  src.stop(t + s.dur + 0.02);
}

/** Schedules one synthesized sound into `out` at time `t`. */
export function playRecipe(name: SoundName, ctx: AudioContext, out: AudioNode, t: number, buffer: AudioBuffer): void {
  switch (name) {
    case 'reveal':
      tone(ctx, out, t, { type: 'sine', f0: 660, f1: 660, dur: 0.7, gain: 0.22 });
      tone(ctx, out, t, { type: 'sine', f0: 990, f1: 990, dur: 0.6, gain: 0.16, delay: 0.07 });
      tone(ctx, out, t, { type: 'sine', f0: 1320, f1: 1320, dur: 0.55, gain: 0.12, delay: 0.14 });
      noise(ctx, out, t, buffer, { dur: 0.4, gain: 0.05, filter: 'highpass', freq: 6000 });
      break;
    case 'firefly':
      tone(ctx, out, t, { type: 'sine', f0: 1800, f1: 2400, dur: 0.15, gain: 0.1 });
      tone(ctx, out, t, { type: 'sine', f0: 2600, f1: 3000, dur: 0.12, gain: 0.07, delay: 0.05 });
      break;
    case 'eat':
      for (let k = 0; k < 3; k++) noise(ctx, out, t, buffer, { dur: 0.05, gain: 0.25, filter: 'lowpass', freq: 900, delay: k * 0.09 });
      break;
    case 'pet':
      tone(ctx, out, t, { type: 'triangle', f0: 330, f1: 392, dur: 0.28, gain: 0.14, attack: 0.04 });
      tone(ctx, out, t, { type: 'triangle', f0: 392, f1: 494, dur: 0.3, gain: 0.1, delay: 0.12, attack: 0.04 });
      break;
    case 'flee':
      tone(ctx, out, t, { type: 'sine', f0: 900, f1: 500, dur: 0.18, gain: 0.08 });
      break;
    case 'voice-rabbit':
      tone(ctx, out, t, { type: 'sine', f0: 900, f1: 1500, dur: 0.09, gain: 0.18 });
      tone(ctx, out, t, { type: 'sine', f0: 950, f1: 1600, dur: 0.09, gain: 0.15, delay: 0.12 });
      break;
    case 'voice-dog':
      tone(ctx, out, t, { type: 'square', f0: 260, f1: 170, dur: 0.13, gain: 0.12, attack: 0.005 });
      noise(ctx, out, t, buffer, { dur: 0.07, gain: 0.18, filter: 'bandpass', freq: 520, q: 2 });
      break;
    case 'voice-crocodile':
      tone(ctx, out, t, { type: 'sine', f0: 140, f1: 60, dur: 0.14, gain: 0.32, attack: 0.003 });
      noise(ctx, out, t, buffer, { dur: 0.025, gain: 0.2, filter: 'highpass', freq: 2500 });
      break;
    case 'voice-peacock':
      tone(ctx, out, t, { type: 'sawtooth', f0: 700, f1: 1100, dur: 0.12, gain: 0.07 });
      tone(ctx, out, t, { type: 'sawtooth', f0: 1100, f1: 600, dur: 0.16, gain: 0.06, delay: 0.12 });
      break;
    case 'voice-spider':
      for (let k = 0; k < 4; k++) noise(ctx, out, t, buffer, { dur: 0.015, gain: 0.14, filter: 'highpass', freq: 3000, delay: k * 0.035 });
      break;
    case 'voice-turtle':
      tone(ctx, out, t, { type: 'triangle', f0: 520, f1: 600, dur: 0.1, gain: 0.16 });
      break;
  }
}
