// Seeds the game's save in the managed browser, for demos and emulator checks, then reloads the page.
// Requires a dev server started with --allow-browser-automation. Usage:
//   SEED=returning ./node_modules/.bin/iwsdk browser run scripts/seed-save.mjs
// SEED values:
//   fresh      no save: a first-time player
//   returning  all six creatures, last played yesterday on a two-night streak, so the game opens
//              with "Welcome back!" and today's visitor
//   full       all six creatures, today's visitor already matched: just the zoo
const KEY = 'shadowzoo.save.v1';

export default async function run({ page }) {
  const seed = process.env.SEED ?? 'returning';
  const result = await page.evaluate(
    ([key, seed]) => {
      const pad = (n) => String(n).padStart(2, '0');
      const day = (offset) => {
        const d = new Date();
        d.setDate(d.getDate() + offset);
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      };
      if (seed === 'fresh') {
        localStorage.removeItem(key);
        return { seed };
      }
      const today = seed === 'full';
      const save = {
        version: 1,
        unlocked: ['rabbit', 'dog', 'crocodile', 'peacock', 'spider', 'turtle'],
        bonds: { rabbit: 3, dog: 2, crocodile: 1, peacock: 1, spider: 1, turtle: 2 },
        stars: { rabbit: 3, dog: 3, crocodile: 2, peacock: 2, spider: 3, turtle: 2 },
        embers: today ? 3 : 2,
        streak: today ? 3 : 2,
        lastDay: day(today ? 0 : -1),
        dailyDone: today ? day(0) : day(-1),
        settings: { assist: 'normal', hand: 'auto', sound: true, reducedMotion: false, narrow: false },
      };
      localStorage.setItem(key, JSON.stringify(save));
      return { seed, lastDay: save.lastDay };
    },
    [KEY, seed],
  );
  await page.reload();
  return result;
}
