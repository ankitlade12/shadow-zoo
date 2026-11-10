// Records the managed browser's page as JPEG frames through the Chrome DevTools screencast,
// for an honest emulator-footage video. Requires a dev server started with
// --allow-browser-automation. Usage (with the demo choreography running in parallel):
//   RECORD_SECONDS=150 ./node_modules/.bin/iwsdk browser run scripts/record.mjs --timeout 200000
// Then encode with scripts/encode.sh.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export default async function run({ cdp, workspaceRoot }) {
  const seconds = Number(process.env.RECORD_SECONDS ?? 150);
  const dir = join(workspaceRoot, 'docs/video/frames');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const times = [];
  cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
    writeFileSync(join(dir, `f${String(times.length).padStart(5, '0')}.jpg`), Buffer.from(data, 'base64'));
    times.push(metadata.timestamp);
    try {
      await cdp.send('Page.screencastFrameAck', { sessionId });
    } catch {
      // The screencast may already be stopping.
    }
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: 1280, maxHeight: 1024, everyNthFrame: 1 });
  await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
  await cdp.send('Page.stopScreencast');
  writeFileSync(join(dir, 'times.json'), JSON.stringify(times));
  return { frames: times.length, seconds };
}
