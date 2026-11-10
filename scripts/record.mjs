// Records the demo video from the emulator's browser page over the Chrome DevTools Protocol. It
// connects straight to the managed browser's automation endpoint, so it has no time limit and
// doesn't hold the IWSDK browser lease the CLI commands need. scripts/demo.sh steers it with files
// in docs/video/:
//   resume  start a new segment: screencast frames go to frames/<n>/ (30 fps)
//   pause   end the segment: writes frames/<n>/times.json, events.json and segment.json
//   stop    end any segment and exit
// Recording in segments keeps the dev server's loading screens out of the video.
// While it runs, every "[ShadowZoo]" console line goes to docs/video/live.log as
// "<epoch seconds>\t<text>", even between segments; scripts/demo.sh waits on it. A segment's
// events.json keeps the sound and ambience traces and page loads, so scripts/render-audio.mjs can
// rebuild the soundtrack (the screencast has no audio). The dev server's workspace toolbar is
// hidden; it isn't part of the game.
// Needs Node 22+ and a dev server started with --allow-browser-automation. Usage: node scripts/record.mjs
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const video = join(root, 'docs/video');
const control = (name) => join(video, name);
const live = join(video, 'live.log');
const TRACE = /^\[ShadowZoo\] (sound|ambient) /;
const HIDE_TOOLBAR = `(() => {
  const add = () => {
    if (document.getElementById('demo-hide-toolbar')) return;
    const style = document.createElement('style');
    style.id = 'demo-hide-toolbar';
    style.textContent = '.workspace-view-switcher, .workspace-icon-button { display: none !important; }';
    (document.head || document.documentElement).appendChild(style);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add);
  else add();
})();`;

function automation() {
  const out = spawnSync(join(root, 'node_modules/.bin/iwsdk'), ['dev', 'status'], { cwd: root, encoding: 'utf8' });
  const a = JSON.parse(out.stdout).data.state.session?.browserAutomation;
  if (!a?.enabled) throw new Error('start the dev server with --allow-browser-automation');
  return a;
}

async function connect() {
  const { endpoint, targetId } = automation();
  const targets = await (await fetch(`${endpoint}/json/list`)).json();
  const page = targets.find((t) => t.id === targetId) ?? targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  let nextId = 1;
  const pending = new Map();
  const handlers = new Map();
  ws.onmessage = ({ data }) => {
    const msg = JSON.parse(data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    } else if (msg.method) handlers.get(msg.method)?.(msg.params);
  };
  return {
    send: (method, params = {}) =>
      new Promise((resolve) => {
        const id = nextId++;
        pending.set(id, resolve);
        ws.send(JSON.stringify({ id, method, params }));
      }),
    on: (method, fn) => handlers.set(method, fn),
    close: () => ws.close(),
  };
}

const cdp = await connect();
for (const name of ['resume', 'pause', 'stop']) rmSync(control(name), { force: true });
rmSync(join(video, 'frames'), { recursive: true, force: true });
writeFileSync(live, '');
const started = Date.now() / 1000;
let segment = null; // { n, dir, times, events, start }
let count = 0;

const note = (t, text) => {
  if (t < started) return; // replayed from before the recorder started
  appendFileSync(live, `${t.toFixed(3)}\t${text}\n`);
  if (segment && (TRACE.test(text) || text.startsWith('[record]'))) segment.events.push({ t, text });
};

cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
  void cdp.send('Page.screencastFrameAck', { sessionId });
  if (!segment) return;
  writeFileSync(join(segment.dir, `f${String(segment.times.length).padStart(5, '0')}.jpg`), Buffer.from(data, 'base64'));
  segment.times.push(metadata.timestamp);
});
cdp.on('Runtime.consoleAPICalled', ({ args, timestamp }) => {
  const text = String(args?.[0]?.value ?? '');
  if (text.startsWith('[ShadowZoo]')) note(timestamp / 1000, text);
});
cdp.on('Page.frameNavigated', ({ frame }) => {
  if (!frame.parentId) note(Date.now() / 1000, '[record] navigated');
});
await cdp.send('Runtime.enable');
await cdp.send('Page.enable');
await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: HIDE_TOOLBAR });
await cdp.send('Runtime.evaluate', { expression: HIDE_TOOLBAR });

async function resume() {
  count += 1;
  const dir = join(video, 'frames', String(count));
  mkdirSync(dir, { recursive: true });
  segment = { n: count, dir, times: [], events: [], start: Date.now() / 1000 };
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: 1280, maxHeight: 720, everyNthFrame: 2 });
}

async function pause() {
  if (!segment) return;
  await cdp.send('Page.stopScreencast');
  const s = segment;
  segment = null;
  const stop = Date.now() / 1000;
  writeFileSync(join(s.dir, 'times.json'), JSON.stringify(s.times));
  writeFileSync(join(s.dir, 'events.json'), JSON.stringify(s.events, null, 1));
  writeFileSync(join(s.dir, 'segment.json'), JSON.stringify({ start: s.start, stop }));
  console.log(JSON.stringify({ segment: s.n, frames: s.times.length, events: s.events.length, seconds: Math.round((stop - (s.times[0] ?? stop)) * 10) / 10 }));
}

console.log('listening');
for (;;) {
  if (existsSync(control('resume'))) {
    await pause();
    await resume();
    rmSync(control('resume'), { force: true });
  }
  if (existsSync(control('pause'))) {
    await pause();
    rmSync(control('pause'), { force: true });
  }
  if (existsSync(control('stop'))) {
    await pause();
    rmSync(control('stop'), { force: true });
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 50));
}
cdp.close();
