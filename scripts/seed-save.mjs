// Seeds the game's save in the managed browser, for demos and emulator checks, then reloads the page.
// Requires a dev server started with --allow-browser-automation. Usage:
//   SEED=returning ./node_modules/.bin/iwsdk browser run scripts/seed-save.mjs
// SEED values:
//   fresh      no save: a first-time player
//   returning  all six creatures, last played yesterday on a two-night streak, so the game opens
//              with "Welcome back!" and today's visitor
//   full       all six creatures, today's visitor already matched: just the zoo
const KEY = 'shadowzoo.save.v1';

/** Writes the save for `mode` into the page's localStorage and reloads the page. */
export async function seed(page, mode) {
  const result = await page.evaluate(
    ([key, mode]) => {
      const pad = (n) => String(n).padStart(2, '0');
      const day = (offset) => {
        const d = new Date();
        d.setDate(d.getDate() + offset);
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      };
      if (mode === 'fresh') {
        localStorage.removeItem(key);
        return { seed: mode };
      }
      const today = mode === 'full';
      const save = {
        version: 1,
        unlocked: ['rabbit', 'dog', 'crocodile', 'peacock', 'spider', 'turtle'],
        bonds: { rabbit: 3, dog: 3, crocodile: 3, peacock: 3, spider: 3, turtle: 3 },
        stars: { rabbit: 3, dog: 3, crocodile: 2, peacock: 2, spider: 3, turtle: 2 },
        embers: today ? 3 : 2,
        streak: today ? 3 : 2,
        lastDay: day(today ? 0 : -1),
        dailyDone: day(today ? 0 : -1),
        settings: { assist: 'normal', hand: 'auto', sound: true, reducedMotion: false, narrow: false },
      };
      localStorage.setItem(key, JSON.stringify(save));
      return { seed: mode, lastDay: save.lastDay };
    },
    [KEY, mode],
  );
  await page.reload();
  return result;
}

export default async function run({ page }) {
  return seed(page, process.env.SEED ?? 'returning');
}
