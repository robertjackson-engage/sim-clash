// Helpers shared by the scene scripts: the swing "bot" (a club for a distance, a putt at the
// right pace: the same curve tools/arcade-dev/match-e2e.mjs plays whole matches with),
// the roster, and bursts of stills for looking at what a scene will film.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
export const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const { simulateShot } = require(path.join(repo, 'lib', 'physics.js'));

// launch numbers along a driver-to-wedge curve: [ball speed mph, launch deg, spin rpm]
const CURVE = [[6, 30, 1000], [10, 30, 1500], [20, 30, 2500], [40, 30, 4000], [60, 30, 7000], [80, 27, 9000], [105, 21, 7900], [111, 19, 7000], [130, 15, 4500], [150, 13, 2700], [175, 12, 2500]];
export function launchAt(speed) {
  for (let i = 0; i + 1 < CURVE.length; i++) {
    const a = CURVE[i], b = CURVE[i + 1];
    if (speed <= b[0]) {
      const f = Math.max(0, (speed - a[0]) / (b[0] - a[0]));
      return { speed, vla: +(a[1] + (b[1] - a[1]) * f).toFixed(1), hla: 0, spin: Math.round(a[2] + (b[2] - a[2]) * f), spinAxis: 0 };
    }
  }
  return { speed, vla: 12, hla: 0, spin: 2500, spinAxis: 0 };
}
const TABLE = [];
for (let s = 6; s <= 175; s += 1) {
  const l = launchAt(s);
  const sim = simulateShot({ speedMph: l.speed, vla: l.vla, hla: 0, totalSpin: l.spin, spinAxis: 0 }, { x: 0, y: 0 }, 0, () => 'fairway', {});
  TABLE.push([sim.totalYd, s]);
}
/** A swing that goes about `yd` yards on flat ground in still air. */
export const forDistance = (yd) => launchAt((TABLE.find(([total]) => total >= yd) || TABLE[TABLE.length - 1])[1]);
/** A putt at about the right pace for `yd` yards (the putting assist takes it from there). */
export const putt = (yd, hla = 0) => ({ speed: +Math.max(2, Math.sqrt(2 * 0.6 * (yd * 0.9144 + 0.35)) / 0.44704).toFixed(1), vla: 0.5, hla, spin: 100, spinAxis: 0 });

/** The two players of the trailer, made on the private server when they are not there. */
export async function players(c, names = ['Alex', 'Sam']) {
  const roster = async () => ((await c.get('/api/leagues')) || {}).players || [];
  for (const p of await roster()) if (!names.includes(p.name)) await c.api('/api/players/remove', { id: p.id });
  for (const name of names) if (!(await roster()).some((p) => p.name === name)) await c.api('/api/players', { name });
  const all = await roster();
  return names.map((n) => all.find((p) => p.name === n));
}

/** `count` stills `everyMs` apart, and a contact sheet of them (sharp, when it is installed). */
export async function burst(c, name, count, everyMs) {
  const files = [];
  for (let i = 0; i < count; i++) {
    const t = Date.now();
    files.push(await c.snap(`${name}-${String(i).padStart(2, '0')}`));
    await c.sleep(Math.max(0, everyMs - (Date.now() - t)));
  }
  return sheet(path.join(path.dirname(files[0]), `_sheet-${name}.jpg`), files);
}
export async function sheet(out, files, { cols = 4, tw = 480, th = 270 } = {}) {
  let sharp;
  try { sharp = require('sharp'); } catch (_) { return null; }
  const rows = Math.ceil(files.length / cols);
  const tiles = await Promise.all(files.map(async (f, i) => ({ input: await sharp(f).resize(tw, th).toBuffer(), left: (i % cols) * tw, top: Math.floor(i / cols) * th })));
  await sharp({ create: { width: cols * tw, height: rows * th, channels: 3, background: '#000' } }).composite(tiles).jpeg({ quality: 82 }).toFile(out);
  for (const f of files) { try { fs.unlinkSync(f); } catch (_) { /* gone */ } }
  return out;
}
