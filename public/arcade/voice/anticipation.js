/**
 * Anticipation, then payoff: the one crowd moment that matters most.
 *
 * As a ball tracks at the hole (and time slows), the gallery rises: a climbing
 * "aaaaAAAHHH" that peaks on the exact frame the outcome is known. Then the payoff
 * replaces it: a roar on top of the cup rattle if it drops, a groan if it burns the edge,
 * warm applause if it only finishes close.
 *
 * This file is the arithmetic, free of Web Audio so it is tested under Node:
 *   planSwell()         which recorded swell fits a window, and when to start it
 *   planAnticipation()  what to call, and when, for one shot (app.js runs the timers)
 * audio.js does the playing: ArcadeAudio.anticipate() and ArcadeAudio.resolve().
 */

/** The mp3 decoder's own delay before a file's audio starts (seconds). */
export const DECODE_LEAD_S = 0.025;

/**
 * Fit a swell to a window. `lengths` are the takes' rise lengths (seconds from the start of
 * the file to its peak); `seconds` is how long until the peak must land.
 * Returns { index, startIn, offset }: play take `index`, starting `startIn` seconds from
 * now, from `offset` seconds into the file. The swell is never stretched: the longest take
 * that fits is started late, and when even the shortest is too long its head is skipped.
 * In every case  startIn - offset + lengths[index] + lead === seconds.
 */
export function planSwell(lengths, seconds, lead = DECODE_LEAD_S) {
  const list = (Array.isArray(lengths) ? lengths : []).map(Number);
  if (!list.length || !list.every((v) => v > 0)) return null;
  const want = Math.max(0.2, Number(seconds) || 0);
  let index = -1;
  for (let i = 0; i < list.length; i++) {
    if (list[i] + lead <= want + 0.001 && (index < 0 || list[i] > list[index])) index = i;
  }
  if (index < 0) {
    // nothing fits: the shortest take, entering part-way up its rise
    index = 0;
    for (let i = 1; i < list.length; i++) if (list[i] < list[index]) index = i;
  }
  const ideal = want - (list[index] + lead);   // when the file would have to start for its peak to land on time
  const MIN = 0.005;                           // nothing can start sooner than this
  if (ideal >= MIN - 1e-9) return { index, startIn: Math.max(MIN, ideal), offset: 0 };
  return { index, startIn: MIN, offset: MIN - ideal };
}

/** How near the hole a ball that was never going in must finish to earn applause (feet). */
export const CLOSE_FT = 2.5;

/**
 * The anticipation and payoff of one shot, as steps for a timer:
 *   [{ at, do: 'anticipate', seconds }, { at, do: 'resolve', outcome: 'in' | 'out' | 'close' }]
 * `at` and `seconds` are playback seconds from the strike (the re-timed shot of feel.js).
 *
 * sim.slowmo      [{ t0, t1, rate, reason }]: 'holing' (it is going in), 'lip' (it passes the cup)
 * sim.cupDropT    the moment the ball is down in the cup
 * shot            { holed, distToPinYd } from the server's result
 *
 *  - holing: the swell starts with the window and peaks at cupDropT, where 'in' fires.
 *  - lip:    the swell peaks as the ball reaches the cup's edge, and 'out' fires just after.
 *  - neither, but the ball stops within CLOSE_FT: a short swell into 'close' (applause).
 * One swell a shot. A shot nowhere near the hole gets nothing: silence is the default.
 */
export function planAnticipation(sim, shot = {}) {
  const steps = [];
  if (!sim) return steps;
  const windows = Array.isArray(sim.slowmo) ? sim.slowmo : [];
  const playS = Number.isFinite(sim.playS) ? sim.playS : Number.isFinite(sim.flightTime) ? sim.flightTime : 0;
  const drop = Number.isFinite(sim.cupDropT) ? sim.cupDropT : null;

  if (drop != null) {
    const w = windows.find((x) => x && x.reason === 'holing' && x.t0 < drop);
    const from = w ? Math.max(0, w.t0) : null;
    if (from != null && drop - from >= 0.3) steps.push({ at: from, do: 'anticipate', seconds: drop - from });
    steps.push({ at: drop, do: 'resolve', outcome: 'in' });
    return steps;
  }

  const lip = windows.find((x) => x && x.reason === 'lip' && x.t1 > x.t0);
  if (lip && !shot.holed) {
    // feel.js opens the window 0.7 s of shot time before the ball's closest approach and
    // closes it 0.45 s after: the cup is 61 % of the way through
    const pass = lip.t0 + (lip.t1 - lip.t0) * (0.7 / 1.15);
    if (pass - lip.t0 >= 0.3) steps.push({ at: lip.t0, do: 'anticipate', seconds: pass - lip.t0 });
    steps.push({ at: Math.min(lip.t1, pass + 0.1), do: 'resolve', outcome: 'out' });
    return steps;
  }

  const ft = Number.isFinite(shot.distToPinYd) ? shot.distToPinYd * 3 : Infinity;
  const pts = Array.isArray(sim.points) ? sim.points : [];
  const travelled = pts.length > 1 ? Math.hypot(pts[pts.length - 1].x - pts[0].x, pts[pts.length - 1].y - pts[0].y) : 0;
  if (!shot.holed && ft <= CLOSE_FT && playS >= 1.6 && travelled >= 3) {
    steps.push({ at: playS - 1.3, do: 'anticipate', seconds: 1.25 });
    steps.push({ at: playS - 0.05, do: 'resolve', outcome: 'close' });
  }
  return steps;
}
