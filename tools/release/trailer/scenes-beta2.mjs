// The scenes 1.0.0-beta.2 added to the trailer (scenes.mjs lists them after its own): the
// course gadgets, each met by a real swing; the game's own hole flyover on the rebuilt
// stages; the party lobby and a skins hole; Bullseye in the stadium.
//
// A gadget clip is free play on one stage. The swing that meets the gadget is FOUND by the
// scene, off camera, before the page is opened: every candidate is played as a test shot
// (the server plays one at once) and taken back with a mulligan, which puts the ball, the lie
// and the wind back as they were; the first that does what the clip is for is then filmed
// for real. Nothing in a gadget or a flight is random, so the take is the proof again.
import { forDistance, putt, launchAt } from './lib.mjs';

// the instant replay marks itself in a clip ('replay-in' / 'replay-out'): the page's root
// element carries 'rp-on' while one plays (public/arcade/replay.js)
export const WATCH_REPLAY = "(() => { if (window.__trailerReplay) return true; let on = false; window.__trailerReplay = new MutationObserver(() => { const now = document.documentElement.classList.contains('rp-on'); if (now !== on) { on = now; try { window.__trailer.mark(now ? 'replay-in' : 'replay-out'); } catch (_) { /* not recording */ } } }); window.__trailerReplay.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] }); return true; })()";
// only the 3D picture: every layer of the page but the canvas is hidden (the flyovers)
const HUD_OFF = 'body > *:not(#scene), #scene > *:not(canvas) { visibility: hidden !important; }';
const hud = (c, on) => c.evaluate(`(() => { let st = document.getElementById('trailer-hud'); if (!st) { st = document.createElement('style'); st.id = 'trailer-hud'; document.head.appendChild(st); } st.textContent = ${on ? "''" : JSON.stringify(HUD_OFF)}; return true; })()`);

const stageOf = async (c, id) => {
  const t = (await c.get('/api/match')).tour;
  const s = [...t.stages, ...t.tiebreaks].find((x) => x.id === id);
  if (!s) throw new Error(`no stage '${id}'`);
  return s;
};
const hits = (shot, id) => Boolean(shot && (shot.gadgets || []).some((g) => g.id === id || g.kind === id));
const calls = (shot, id) => Boolean(shot && shot.arcade && shot.arcade.callout && shot.arcade.callout.id === id);
const dry = (shot) => Boolean(shot && !shot.penalty && !['water', 'hazard', 'ob', 'lava'].includes(shot.lie));
const tell = (shot) => (shot ? `${shot.lie}, ${shot.distToPinYd} yd left${shot.arcade ? ` [${shot.arcade.grade}${shot.arcade.callout ? ` "${shot.arcade.callout.text}"` : ''}]` : ''} gadgets: ${[...new Set((shot.gadgets || []).map((g) => `${g.id}:${g.effect}`))].join(' ') || '-'}` : 'not played');
// swings along the club curve (lib.mjs): every speed, each launch-angle offset, each aim
// (an aim is in half degrees, as the page's aim keys and slider move it: every aim here is one a player can set)
const half = (deg) => Math.round(deg * 2) / 2;
const grid = (speeds, { vla = [0], aims = [0] } = {}) => speeds.flatMap((sp) => vla.flatMap((dv) => [...new Set(aims.map(half))].map((aim) => { const l = launchAt(sp); return { speed: sp, vla: +(l.vla + dv).toFixed(1), hla: 0, spin: l.spin, spinAxis: 0, aim }; })));
const range = (a, b, step = 1) => { const out = []; for (let v = a; v <= b + 1e-9; v += step) out.push(+v.toFixed(2)); return out; };
// how long a shot is on screen: its own clock (flight and roll), then the callout
const screenS = (shot, extra = 6.5) => { const pts = shot && shot.sim && shot.sim.points; return (pts && pts.length ? pts[pts.length - 1].t : 8) + extra; };

export function beta2Scenes({ fresh, who, line, untilPlay, turnBanner }) {
  // a stage in the bay for free play, on a fresh server (the wind is the seed's)
  async function freePlay(c, id, seed) {
    await fresh(c, seed);
    const s = await stageOf(c, id);
    await c.api('/api/load-course', { cached: s.file });
    await c.realSleep(250);
    c.geo = await c.get('/api/course-geometry');
    return s;
  }
  // the aim (degrees off the flag) that points from where the ball lies at a gadget
  async function aimAt(c, gadgetId) {
    const st = await c.get('/api/state');
    const g = (c.geo.gadgets || []).find((x) => x.id === gadgetId);
    if (!g) throw new Error(`no gadget '${gadgetId}' on this stage`);
    const p = g.points ? { x: g.points[Math.floor(g.points.length / 2)][0], y: g.points[Math.floor(g.points.length / 2)][1] } : g;
    const pin = Array.isArray(st.pin) ? { x: st.pin[0], y: st.pin[1] } : st.pin;
    const brg = (a, b) => Math.atan2(b.x - a.x, b.y - a.y) * 180 / Math.PI;
    let off = brg(st.ball, p) - brg(st.ball, pin);
    if (off > 180) off -= 360;
    if (off < -180) off += 360;
    return { aim: half(off), yd: Math.round(Math.hypot(p.x - st.ball.x, p.y - st.ball.y) / 0.9144), toPinYd: st.distToPinYd };
  }
  // one swing played off camera: the shot it made
  async function offCamera(c, cand) {
    await c.api('/api/aim', { offset: cand.aim || 0 });
    const since = Date.now();
    await c.api('/api/test-shot', cand);
    const e = await c.waitEvent((x) => x.event === 'shot', { since, timeoutMs: 3000 });
    await c.realSleep(60);
    return e ? e.data : null;
  }
  const wipe = async (c) => { await c.api('/api/arcade/reset', {}); await c.api('/api/arcade/settings', { enabled: true }); };
  // the arcade wallet and streak are wiped before each candidate, so the callout is the one
  // a first swing gets (a streak's shout is louder than a gadget's)
  async function prove(c, label, candidates, want) {
    let n = 0;
    for (const cand of candidates) {
      n++;
      await wipe(c);
      const shot = await offCamera(c, cand);
      const ok = Boolean(shot && want(shot));
      if (process.env.TRAILER_DEBUG) c.say(`      ${JSON.stringify(cand)} -> ${tell(shot)}`);   // every candidate, when a sweep finds nothing
      await c.api('/api/mulligan', {});
      if (ok) {
        await wipe(c);
        c.say(`   ${label}: swing ${n} of ${candidates.length} ${JSON.stringify(cand)} -> ${tell(shot)}`);
        return { cand, shot };
      }
    }
    throw new Error(`${label}: none of ${candidates.length} swings did it`);
  }
  // film one proven swing in free play: the address view, the swing, its result
  async function film(c, name, cand, { stage, pre = 2600, extra = 6.5 } = {}) {
    await c.goto('/?menu=0', { settleMs: 9000 });
    await c.mouseAway();
    await c.evaluate(WATCH_REPLAY);
    // The aim is set on the page, as a player sets it (the page aims by itself at every new
    // lie, AUTO, and an aim moved by hand then stays put), and checked before the swing.
    const aim = cand.aim || 0;
    const setAim = async () => { await c.evaluate(`(window.__birdie.lineup.setAim(${aim}), true)`); await c.realSleep(650); return ((await c.get('/api/state')) || {}).aimOffset; };
    await c.sleep(1500);
    await setAim();
    await c.rec.start(name, { info: { stage } });
    await c.sleep(pre);
    for (let i = 0; i < 4; i++) { const now = ((await c.get('/api/state')) || {}).aimOffset; if (Math.abs((now || 0) - aim) < 0.01) break; c.say(`   (the aim was ${now}: set to ${aim})`); await setAim(); }
    const shot = await c.swing(cand, 'swing');
    c.say(`   ${name}: ${JSON.stringify(cand)} -> ${tell(shot)}`);
    for (const g of (shot && shot.gadgets) || []) if (g.effect !== 'coin') await c.mark(`hit:${g.kind}`, { at: g.t, id: g.id, effect: g.effect });
    await c.sleep(Math.min(42000, screenS(shot, extra) * 1000));
    await c.rec.stop();
    return shot;
  }
  // one gadget, one clip: the stage, the swings that get the ball there (off camera), the proof, the take
  function gadget({ id, stage, seed, title, lead = [], candidates, want, target = null, extra }) {
    return {
      id, title,
      async run(c) {
        // the wind is the game's own dice (one roll a seed): a wind that leaves no swing
        // that does it is passed over for the next seed
        let cand = null;
        for (const sd of [].concat(seed)) {
          await freePlay(c, stage, sd);
          const cond = ((await c.get('/api/state')) || {}).conditions || (await c.get('/api/conditions')) || {};
          c.say(`   wind seed ${sd}: ${cond.windMph ?? '?'} mph from ${cond.windFromDeg ?? '?'} deg`);
          try {
            for (const l of lead) {
              const k = typeof l === 'function' ? await l(c, { aimAt, prove, offCamera }) : l;
              const shot = await offCamera(c, k);
              c.say(`   lead-in ${JSON.stringify(k)} -> ${tell(shot)}`);
            }
            const at = target ? await aimAt(c, target) : null;
            if (at) c.say(`   ${target}: ${at.yd} yd away, ${at.aim} deg off the flag (${at.toPinYd} yd to the pin)`);
            ({ cand } = await prove(c, id, typeof candidates === 'function' ? candidates(at) : candidates, want));
            break;
          } catch (error) { c.say(`   ${error.message}`); }
        }
        if (!cand) throw new Error(`${id}: no wind seed of ${[].concat(seed).join(', ')} gave a swing that does it`);
        if (c.fast) return;
        await film(c, id, cand, { stage, extra });
      },
    };
  }

  const FLY = ['thunder-dome', 'temple-run', 'sakura-garden', 'lagoon-island', 'volcano-drop', 'midnight-mile', 'frostbite-ridge', 'canyon-run', 'lighthouse-point'];

  return [
    // ------------------------------------------------------------------------------------
    gadget({
      id: 'g-wall', stage: 'canyon-run', seed: 11, title: 'Canyon Run: through the 150 mph wall and the boost ring behind it, SMASHED IT! (free play; the match scene has it too)',
      candidates: grid(range(152, 160, 1), { vla: [0, 0.5] }),
      want: (s) => hits(s, 'barricade') && hits(s, 'mesa-ring') && calls(s, 'smashed-it') && s.lie === 'green',
    }),
    gadget({
      id: 'g-denied', stage: 'canyon-run', seed: 11, title: 'Canyon Run: 148 mph comes back off the 150 wall, DENIED!',
      candidates: grid([148, 147, 149, 146]),
      want: (s) => calls(s, 'denied'),
    }),
    gadget({
      id: 'g-ring', stage: 'frostbite-ridge', seed: [34, 37, 38, 39, 40], title: 'Frostbite Ridge: the boost ring over the ice, RING IT!',
      candidates: grid(range(124, 146, 1), { vla: [0, 1.5, -1.5], aims: [0, 1, -1, 2, -2, 3, -3] }),   // the ring is 12 m across, 164 yd out: the aim allows for the wind
      want: (s) => hits(s, 'lake-ring') && calls(s, 'ring-it') && dry(s),
    }),
    gadget({
      id: 'g-pad', stage: 'lagoon-island', seed: 13, title: 'Lagoon Island: short in the sand, the bounce pad throws it onto the green, BOING!', target: 'turtle-shell',
      candidates: (at) => grid(range(74, 100, 1), { vla: [0, -3, 3, -6, 6], aims: [at.aim, at.aim + 0.5, at.aim - 0.5] }),
      want: (s) => hits(s, 'turtle-shell') && calls(s, 'boing') && dry(s),
    }),
    gadget({
      id: 'g-strip', stage: 'midnight-mile', seed: 14, title: 'Midnight Mile: the speed strip up the Boulevard, TURBO!', target: 'neon-mile',
      candidates: (at) => grid(range(132, 148, 1), { aims: [at.aim, at.aim + 1, at.aim - 1] }),
      want: (s) => hits(s, 'neon-mile') && calls(s, 'turbo') && dry(s),
      extra: 7.5,
    }),
    gadget({
      id: 'g-bumper', stage: 'midnight-mile', seed: 14, title: 'Midnight Mile: long into the stadium green, off the bumpers, PINBALL WIZARD!', target: 'bumper-mid',
      // the way there, off camera: the strip (TURBO!), then the approach is the take
      lead: [async (c, t) => (await t.prove(c, 'the drive up the strip', grid(range(132, 148, 1), { aims: [22, 23, 21] }), (s) => hits(s, 'neon-mile') && dry(s))).cand],
      candidates: (at) => [at.yd, at.yd + 4, at.yd - 4, at.yd + 8, at.yd - 8, at.yd + 12, at.yd - 12, at.yd + 16, at.yd - 16].flatMap((yd) => [0, 0.5, -0.5, 1, -1, 1.5, -1.5, 2, -2].map((da) => ({ ...forDistance(yd), aim: at.aim + da }))),
      want: (s) => hits(s, 'bumper') && calls(s, 'pinball') && dry(s),
    }),
    gadget({
      id: 'g-warp', stage: 'temple-run', seed: 15, title: 'Temple Run: into the serpent pipe at the foot of the stairs, fired onto the green, WARP SPEED!', target: 'serpents-mouth',
      // the way there, off camera: a drive short of the mud, a lay-up over the first river
      lead: [
        async (c, t) => (await t.prove(c, 'the drive', grid(range(140, 156, 2)), (s) => s.lie === 'fairway' && s.distToPinYd < 290 && s.distToPinYd > 215)).cand,
        async (c, t) => { const at = await t.aimAt(c, 'serpents-mouth'); return (await t.prove(c, 'the lay-up', [70, 60, 80, 50, 90, 100].map((left) => ({ ...forDistance(at.yd - left), aim: at.aim })), (s) => (s.lie === 'fairway' || s.lie === 'rough') && s.distToPinYd > 45 && s.distToPinYd < 140)).cand; },
      ],
      candidates: (at) => range(-14, 14, 1).flatMap((dy) => [0, 0.5, -0.5, 1, -1].map((da) => ({ ...forDistance(Math.max(20, at.yd + dy)), aim: at.aim + da }))),
      want: (s) => hits(s, 'serpents-mouth') && calls(s, 'warp-speed'),
      extra: 8,
    }),
    gadget({
      id: 'g-coins', stage: 'canyon-run', seed: 17, title: 'Canyon Run: the coin trail over the gorge, every coin, FULL TRAIL!', target: 'gorge-coins',
      candidates: (at) => grid(range(138, 156, 1), { vla: [0, 1, -1, 2, -2], aims: [13, 13.5, 12.5, 14] }),
      want: (s) => calls(s, 'full-trail') && dry(s),
    }),
    gadget({
      id: 'g-coins-dome', stage: 'thunder-dome', seed: 18, title: 'Thunder Dome: the coin trail to the flag, every coin, FULL TRAIL!',
      candidates: grid(range(94, 101, 0.5), { vla: [0, 0.6, -0.6] }),
      want: (s) => calls(s, 'full-trail') && s.lie === 'green',
    }),
    // ------------------------------------------------------------------------------------
    {
      id: 'fly',
      title: "the game's own hole flyover (key F) on the rebuilt stages, the picture only",
      async run(c) {
        if (c.fast) return;
        await fresh(c, 4);
        for (const id of FLY) {
          const s = await stageOf(c, id);
          await c.api('/api/load-course', { cached: s.file });
          await c.goto('/?menu=0', { settleMs: 11000 });
          await c.mouseAway();
          await hud(c, false);
          await c.sleep(400);
          await c.rec.start(`fly-${id}`, { info: { stage: id } });
          await c.sleep(1500);                               // the address view
          await c.key('F');
          await c.mark('fly');
          await c.sleep(1200);
          const t = Date.now();
          await c.waitFor("window.__birdie.scene.camMode !== 'flyover'", { timeoutMs: 45000, everyMs: 100 });
          await c.mark('fly-end');
          c.say(`   ${id}: the flyover ran ${((Date.now() - t) / 1000 + 1.2).toFixed(1)} s`);
          await c.sleep(1200);
          await c.rec.stop();
        }
      },
    },
    // ------------------------------------------------------------------------------------
    {
      id: 'party',
      title: 'PARTY: the lobby fills to four, SKINS, START, the field and the draw; then the putt that takes the skin and the hole result',
      async run(c) {
        await fresh(c, 21, { tapInFt: 3, names: ['Alex', 'Sam', 'Jo', 'Max'] });
        const t0 = Date.now();
        if (c.fast) await c.api('/api/match/start', { playerIds: c.P.map((p) => p.id), format: 'skins', holes: 3 });
        else {
          await c.goto('/?party=1', { settleMs: 7000 });
          await c.mouseAway();
          await c.rec.start('party-lobby');
          await c.sleep(1800);
          await c.click('[data-pt="add-slot"]:not([disabled])').catch(() => c.say('   (the lobby already has four)'));
          await c.mark('four');
          await c.mouseAway();
          await c.sleep(2200);
          await c.click('[data-pt="format"][data-val="skins"]');
          await c.mouseAway();
          await c.sleep(1400);
          await c.click('[data-mt="start"]');
        }
        await c.mark('start');
        await untilPlay(c, t0);
        await c.mark('play');
        if (!c.fast) { await turnBanner(c); await c.sleep(1500); await c.rec.stop(); }
        // The hole, off camera (test shots: the server plays each at once). Everybody finds
        // the green; the player nearest the flag is left with a putt for the skin while the
        // three others putt first and miss.
        const tee = [104, 96, 100, 92];
        let n = 0, hero = null;
        for (let guard = 0; guard < 16; guard++) {
          await c.realSleep(350);
          const m = c.matchNow();
          if (!m || m.phase !== 'play') break;
          const me = who(m);
          const others = m.players.filter((p) => p.id !== me.id);
          if (me.lie === 'green' && others.every((p) => p.strokes >= 2) && me.strokes === 1) { hero = me; break; }
          const launch = me.lie === 'green'
            ? { ...putt(me.distToPinYd), speed: +(putt(me.distToPinYd).speed * 0.7).toFixed(1), hla: 3.6 }   // short and wide of the line
            : (me.strokes === 0 ? launchAt(tee[n++ % tee.length]) : forDistance(me.distToPinYd));
          await c.api('/api/test-shot', launch);
          await c.realSleep(250);
          c.say(`   off camera: ${me.name} ${JSON.stringify(launch)}  [${line(c.matchNow())}]`);
        }
        if (!hero) throw new Error(`the hole did not come down to one putt for the skin: ${line(c.matchNow())}`);
        c.say(`   ${hero.name} has ${Math.round(hero.distToPinYd * 3)} ft for the skin`);
        if (c.fast) { await c.api('/api/test-shot', putt(hero.distToPinYd)); await c.realSleep(300); c.say(`   result: ${line(c.matchNow())} ${JSON.stringify((c.matchNow() || {}).lastResult || null)}`); await c.api('/api/match/abort', {}); return; }
        // the page joins the hole as it stands
        await c.goto('/?menu=0', { settleMs: 9000 });
        await c.mouseAway();
        await c.evaluate(WATCH_REPLAY);
        await c.rec.start('party-skin');
        await c.sleep(2500);
        const t1 = Date.now();
        await c.swing(putt(hero.distToPinYd), 'putt');
        const res = await c.waitEvent((x) => x.event === 'match' && x.data && x.data.phase !== 'play', { since: t1, timeoutMs: 40000 });
        c.say(`   result: ${line(c.matchNow())} ${JSON.stringify((c.matchNow() || {}).lastResult || null)}`);
        await c.waitFor("(() => { const s = document.querySelector('.mt-screen'); return s && !s.classList.contains('hidden') && /SKIN/.test(s.innerText || ''); })()", { timeoutMs: 40000 });
        await c.mark('result', { phase: res && res.data && res.data.phase });
        await c.sleep(6500);
        await c.rec.stop();
        await c.api('/api/match/abort', {});
      },
    },
    // ------------------------------------------------------------------------------------
    {
      id: 'bullseye',
      title: 'BULLSEYE in the stadium (Thunder Dome): a ball in the bullseye, the next one, the board',
      async run(c) {
        await fresh(c, 22);
        const ids = c.P.map((p) => p.id);
        await c.api('/api/bullseye/start', { playerIds: ids, arena: 'thunder-dome', variant: 'high', rounds: 3 });
        const game = async () => ((await c.get('/api/bullseye')) || {}).bullseye;
        for (let i = 0; i < 100; i++) { const b = await game(); if (b && b.phase === 'play' && b.teed) break; await c.realSleep(150); if (i % 10 === 9) await c.api('/api/bullseye/next', {}); }
        // off camera: the swing that finishes in the bullseye, found and taken back (UNDO LAST BALL)
        const throwOne = async (launch) => {
          const since = Date.now();
          await c.api('/api/test-shot', launch);
          const e = await c.waitEvent((x) => x.event === 'shot', { since, timeoutMs: 3000 });
          await c.realSleep(80);
          return e ? e.data : null;
        };
        const find = async (label, want, cands) => {
          for (const cand of cands) {
            const shot = await throwOne(cand);
            const dart = shot && shot.bullseye && shot.bullseye.dart;
            await c.api('/api/bullseye/undo', {});
            for (let i = 0; i < 40; i++) { const b = await game(); if (b && b.teed) break; await c.api('/api/bullseye/next', {}); await c.realSleep(100); }
            if (dart && want(dart)) { c.say(`   ${label}: ${JSON.stringify(cand)} -> ${dart.name}, ${dart.ft} ft, ${dart.score}`); return cand; }
          }
          throw new Error(`bullseye: no swing for ${label}`);
        };
        const cands = grid(range(94, 101, 0.5), { vla: [0, 0.6, -0.6, 1.2, -1.2] }).flatMap((k) => [0, 0.4, -0.4, 0.8, -0.8].map((hla) => ({ speed: k.speed, vla: k.vla, hla, spin: k.spin, spinAxis: 0 })));
        const bull = await find('the bullseye', (d) => d.value === 50 && !d.holed, cands);
        if (c.fast) { await c.api('/api/bullseye/abort', {}); return; }
        await c.goto('/?menu=0', { settleMs: 9000 });
        await c.mouseAway();
        await c.evaluate(WATCH_REPLAY);
        await c.rec.start('bullseye');
        await c.sleep(2600);
        let shot = await c.swing(bull, 'ball-1');
        c.say(`   ball 1: ${JSON.stringify(shot && shot.bullseye && shot.bullseye.dart)}`);
        await c.sleep(Math.min(30000, screenS(shot, 7) * 1000));
        for (let i = 0; i < 60; i++) { const b = await game(); if (b && b.teed) break; await c.realSleep(250); }
        await c.mark('teed-2');
        await c.sleep(1800);
        shot = await c.swing({ ...bull, speed: +(bull.speed + 2.5).toFixed(1), hla: bull.hla + 1.2 }, 'ball-2');
        c.say(`   ball 2: ${JSON.stringify(shot && shot.bullseye && shot.bullseye.dart)}`);
        await c.sleep(Math.min(30000, screenS(shot, 6) * 1000));
        await c.key('B');                                  // the board, big
        await c.mark('board');
        await c.sleep(4500);
        await c.rec.stop();
        await c.api('/api/bullseye/abort', {});
      },
    },
  ];
}
