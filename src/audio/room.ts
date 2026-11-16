import { mulberry32 } from '../core/rng.js';

/** How long the room rings: about half a second, a furnished living room (-60 dB by the end). */
const ROOM_SECONDS = 0.5;
/** The echo sits about 15 dB under the dry sound, so sounds feel in the room rather than in your ears. */
const ECHO_LEVEL = 10 ** (-15 / 20);
/** The send to the room drops the lows below this (Hz), so thuds and claps don't boom. */
const ECHO_HIGHPASS = 180;
/**
 * The first reflections, off the nearest wall, the floor, the ceiling and the furniture: when (s),
 * how strong (a minus sign flips the wave), and how much later the right ear hears it (s).
 */
const REFLECTIONS: readonly (readonly [number, number, number])[] = [
  [0.0068, 0.7, 0.0005],
  [0.0105, -0.55, -0.0007],
  [0.0151, 0.46, 0.0009],
  [0.0213, -0.37, -0.0004],
  [0.0279, 0.3, 0.0008],
  [0.0348, -0.24, -0.0006],
];
/** Share of the room's energy in those first reflections; the diffuse tail carries the rest. */
const EARLY_SHARE = 0.35;
/** The tail builds up over this long after the first reflection (s). */
const TAIL_ONSET = 0.015;
/** The tail darkens as it decays: a low-pass sweeping from BRIGHT (Hz) at its start to DARK at the end. */
const BRIGHT = 7000;
const DARK = 800;
/** The game's sounds live between these (Hz): the room returns them at the level it is sent. */
const BAND_LOW = 250;
const BAND_HIGH = 4000;
/** A fixed seed: the same room every night, and in an offline render of the game's sound. */
const ROOM_SEED = 0x2f6b;

function energy(x: Float32Array): number {
  let e = 0;
  for (let i = 0; i < x.length; i++) e += x[i] * x[i];
  return e;
}

/** Energy of x between BAND_LOW and BAND_HIGH, through two-stage high- and low-passes (left to ring out). */
function bandEnergy(x: Float32Array, sampleRate: number): number {
  const keep = Math.exp((-2 * Math.PI * BAND_LOW) / sampleRate);
  const follow = 1 - Math.exp((-2 * Math.PI * BAND_HIGH) / sampleRate);
  let in1 = 0;
  let high1 = 0;
  let in2 = 0;
  let high2 = 0;
  let low1 = 0;
  let low2 = 0;
  let e = 0;
  for (let i = 0; i < x.length + sampleRate * 0.02; i++) {
    const v = i < x.length ? x[i] : 0;
    high1 = keep * (high1 + v - in1);
    in1 = v;
    high2 = keep * (high2 + high1 - in2);
    in2 = high1;
    low1 += follow * (high2 - low1);
    low2 += follow * (low1 - low2);
    e += low2 * low2;
  }
  return e;
}

/**
 * A small room's impulse response for the left and right ears, generated in code: a few early
 * reflections that reach the two ears a little apart, then a diffuse tail that darkens as it
 * decays. Each ear has unit gain across the game's sounds (a dark room keeps its energy there),
 * so the level the room is fed at alone sets how loud it is.
 */
export function roomImpulse(sampleRate: number, rng: () => number = mulberry32(ROOM_SEED)): [Float32Array, Float32Array] {
  const n = Math.round(ROOM_SECONDS * sampleRate);
  // Amplitude falls by 1000 (60 dB) over the room's length.
  const decay = ROOM_SECONDS / Math.log(1000);
  const onset = REFLECTIONS[0][0];
  const fade = Math.round(0.005 * sampleRate);
  const flat = new Float32Array(1);
  flat[0] = 1;
  const unit = bandEnergy(flat, sampleRate);
  const ears: [Float32Array, Float32Array] = [new Float32Array(n), new Float32Array(n)];
  for (let ear = 0; ear < 2; ear++) {
    // Each reflection is softened over three samples: walls and furniture take the edge off.
    const early = new Float32Array(n);
    for (const [time, level, lag] of REFLECTIONS) {
      const i = Math.round((time + (ear === 1 ? lag : 0)) * sampleRate);
      early[i - 1] += 0.25 * level;
      early[i] += 0.5 * level;
      early[i + 1] += 0.25 * level;
    }
    const tail = new Float32Array(n);
    let low = 0;
    for (let i = Math.ceil(onset * sampleRate); i < n; i++) {
      const t = i / sampleRate;
      const cutoff = BRIGHT * (DARK / BRIGHT) ** (t / ROOM_SECONDS);
      low += (1 - Math.exp((-2 * Math.PI * cutoff) / sampleRate)) * (rng() * 2 - 1 - low);
      tail[i] = low * Math.min(1, (t - onset) / TAIL_ONSET) * Math.exp(-(t - onset) / decay);
    }
    const e = Math.sqrt(EARLY_SHARE / energy(early));
    const d = Math.sqrt((1 - EARLY_SHARE) / energy(tail));
    const out = ears[ear];
    for (let i = 0; i < n; i++) out[i] = early[i] * e + tail[i] * d;
    // Ends on silence, without a click.
    for (let i = 0; i < fade; i++) out[n - 1 - i] *= i / fade;
    const k = Math.sqrt(unit / bandEnergy(out, sampleRate));
    for (let i = 0; i < n; i++) out[i] *= k;
  }
  return ears;
}

/**
 * The room's echo, built once on `ctx` and mixed into `destination`: connect any sound (a one-shot's
 * panner) to the returned node to place it in the room. The send drops the lows, each ear of the
 * sound rings through its own ear of the room (so even a sound straight ahead echoes wide), and the
 * echo plays back about 15 dB under the dry sound. Works the same in an OfflineAudioContext.
 */
export function createRoomEcho(ctx: BaseAudioContext, destination: AudioNode, rng?: () => number): AudioNode {
  const [left, right] = roomImpulse(ctx.sampleRate, rng);
  const impulse = ctx.createBuffer(2, left.length, ctx.sampleRate);
  impulse.getChannelData(0).set(left);
  impulse.getChannelData(1).set(right);
  const send = ctx.createBiquadFilter();
  send.type = 'highpass';
  send.frequency.value = ECHO_HIGHPASS;
  send.Q.value = Math.SQRT1_2;
  const room = ctx.createConvolver();
  // Set before the buffer: the impulse is already scaled to unit gain across the game's sounds.
  room.normalize = false;
  room.buffer = impulse;
  const wet = ctx.createGain();
  wet.gain.value = ECHO_LEVEL;
  send.connect(room).connect(wet).connect(destination);
  return send;
}
