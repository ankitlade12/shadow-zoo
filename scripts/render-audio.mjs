// Rebuilds a recording's soundtrack, because the DevTools screencast captures pictures only. In
// the page it renders, offline, the game's own sound recipes (src/audio/recipes.ts) and night
// ambience at the moments and wall positions the game traced. It uses the same HRTF panning and
// voice limiter, with the listener at the emulated head. It joins the segments that
// scripts/record.mjs wrote to docs/video/frames/<n>/ end to end, as scripts/encode.py does, and
// writes docs/video/audio.wav (48 kHz stereo).
// Usage: ./node_modules/.bin/iwsdk browser run scripts/render-audio.mjs --timeout 110000
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const CHUNK = 4 * 1024 * 1024;

export default async function run({ page, workspaceRoot }) {
  const root = join(workspaceRoot, 'docs/video');
  const frames = join(root, 'frames');
  const segments = readdirSync(frames)
    .filter((name) => existsSync(join(frames, name, 'times.json')))
    .sort((a, b) => Number(a) - Number(b));
  // The live log covers the pauses between segments too: it tells whether the night ambience was
  // already playing when a segment began (it starts with the stage, often while paused).
  const livePath = join(root, 'live.log');
  const live = existsSync(livePath)
    ? readFileSync(livePath, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [t, ...rest] = line.split('\t');
          return { t: Number(t), text: rest.join('\t') };
        })
    : [];
  const ambienceAt = (t) => {
    let state = null;
    for (const e of live) {
      if (e.t >= t) break;
      if (e.text.startsWith('[ShadowZoo] ambient start')) state = e.text;
      else if (e.text === '[ShadowZoo] ambient stop' || e.text === '[record] navigated') state = null;
    }
    return state;
  };
  const events = [];
  let offset = 0;
  for (const [i, name] of segments.entries()) {
    const times = JSON.parse(readFileSync(join(frames, name, 'times.json'), 'utf8'));
    const traced = JSON.parse(readFileSync(join(frames, name, 'events.json'), 'utf8'));
    if (times.length === 0) continue;
    const meta = join(frames, name, 'segment.json');
    // A static page sends no new frames, so the segment lasts until the recorder paused it.
    const stop = Math.max(existsSync(meta) ? JSON.parse(readFileSync(meta, 'utf8')).stop : 0, times[times.length - 1] + 1 / 30);
    // Each segment carries its own ambience: end the previous one at the cut, and resume it if it
    // was playing when this segment began.
    if (i > 0) events.push({ t: offset, text: '[record] navigated' });
    const playing = ambienceAt(existsSync(meta) ? JSON.parse(readFileSync(meta, 'utf8')).start : times[0]);
    if (playing) events.push({ t: offset, text: playing });
    for (const e of traced) events.push({ t: Math.max(0, e.t - times[0]) + offset, text: e.text });
    offset += stop - times[0];
  }
  const duration = offset + 0.5;
  const pitch = Number(process.env.HEAD_PITCH_DEG ?? -8);

  const info = await page.evaluate(
    async ({ events, duration, pitch }) => {
      const { playRecipe } = await import('/src/audio/recipes.ts');
      const { VoiceLimiter } = await import('/src/core/voices.ts');
      const rate = 48000;
      const ctx = new OfflineAudioContext(2, Math.ceil(duration * rate), rate);
      const master = ctx.createGain();
      master.gain.value = 0.8;
      master.connect(ctx.destination);
      const noise = ctx.createBuffer(1, rate * 2, rate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      const l = ctx.listener;
      const p = (pitch * Math.PI) / 180;
      l.positionX.value = 0;
      l.positionY.value = 1.6;
      l.positionZ.value = 0;
      l.forwardX.value = 0;
      l.forwardY.value = Math.sin(p);
      l.forwardZ.value = -Math.cos(p);
      l.upX.value = 0;
      l.upY.value = 1;
      l.upZ.value = 0;
      const panner = (at) => {
        const n = ctx.createPanner();
        n.panningModel = 'HRTF';
        n.distanceModel = 'inverse';
        n.refDistance = 1;
        n.rolloffFactor = 0.6;
        n.positionX.value = at[0];
        n.positionY.value = at[1];
        n.positionZ.value = at[2];
        n.connect(master);
        return n;
      };
      // Same graph as AudioEngine.startAmbient: crickets from the stage and a low room tone.
      const ambient = (from, to, at) => {
        const out = panner(at);
        const crickets = ctx.createBufferSource();
        crickets.buffer = noise;
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
        crickets.connect(band).connect(gate).connect(level).connect(out);
        const room = ctx.createBufferSource();
        room.buffer = noise;
        room.loop = true;
        const low = ctx.createBiquadFilter();
        low.type = 'lowpass';
        low.frequency.value = 220;
        const roomLevel = ctx.createGain();
        roomLevel.gain.value = 0.025;
        room.connect(low).connect(roomLevel).connect(master);
        for (const s of [crickets, chirp, swell, room]) {
          s.start(from);
          s.stop(to);
        }
      };

      const limiter = new VoiceLimiter();
      let open = null;
      let sounds = 0;
      let ambiences = 0;
      for (const e of events) {
        const start = /^\[ShadowZoo\] ambient start @ (\S+) (\S+) (\S+)/.exec(e.text);
        if (start) {
          if (open) ambient(open.t, e.t, open.at);
          open = { t: e.t, at: start.slice(1, 4).map(Number) };
          ambiences++;
          continue;
        }
        if (e.text === '[ShadowZoo] ambient stop' || e.text === '[record] navigated') {
          if (open) ambient(open.t, e.t, open.at);
          open = null;
          continue;
        }
        const sound = /^\[ShadowZoo\] sound (\S+) \(audio (\w+)\) @ (\S+) (\S+) (\S+)/.exec(e.text);
        if (!sound || sound[2] === 'muted' || !limiter.allow(sound[1], e.t, 0.6)) continue;
        playRecipe(sound[1], ctx, panner(sound.slice(3, 6).map(Number)), e.t + 0.005, noise);
        sounds++;
      }
      if (open) ambient(open.t, duration, open.at);

      const out = await ctx.startRendering();
      const left = out.getChannelData(0);
      const right = out.getChannelData(1);
      let peak = 0;
      for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
      // Bring the loudest moment to -1 dBFS (at most 10x), as a video player expects.
      const gain = peak > 0 ? Math.min(10, 0.89 / peak) : 1;
      const n = out.length;
      const bytes = new Uint8Array(44 + n * 4);
      const view = new DataView(bytes.buffer);
      const tag = (o, s) => {
        for (let i = 0; i < s.length; i++) bytes[o + i] = s.charCodeAt(i);
      };
      tag(0, 'RIFF');
      view.setUint32(4, 36 + n * 4, true);
      tag(8, 'WAVE');
      tag(12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 2, true);
      view.setUint32(24, rate, true);
      view.setUint32(28, rate * 4, true);
      view.setUint16(32, 4, true);
      view.setUint16(34, 16, true);
      tag(36, 'data');
      view.setUint32(40, n * 4, true);
      const pcm = (v) => {
        const s = Math.max(-1, Math.min(1, v * gain));
        return s < 0 ? s * 0x8000 : s * 0x7fff;
      };
      for (let i = 0, o = 44; i < n; i++, o += 4) {
        view.setInt16(o, pcm(left[i]), true);
        view.setInt16(o + 2, pcm(right[i]), true);
      }
      window.__demoWav = bytes;
      return { bytes: bytes.length, sounds, ambiences, peak, gain };
    },
    { events, duration, pitch },
  );

  const parts = [];
  for (let start = 0; start < info.bytes; start += CHUNK) {
    const b64 = await page.evaluate(
      ([s, e]) => {
        const u8 = window.__demoWav.subarray(s, e);
        let str = '';
        for (let i = 0; i < u8.length; i += 0x8000) str += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
        return btoa(str);
      },
      [start, Math.min(info.bytes, start + CHUNK)],
    );
    parts.push(Buffer.from(b64, 'base64'));
  }
  await page.evaluate(() => {
    delete window.__demoWav;
  });
  writeFileSync(join(root, 'audio.wav'), Buffer.concat(parts));
  return { segments: segments.length, seconds: Math.round(duration * 10) / 10, ...info };
}
