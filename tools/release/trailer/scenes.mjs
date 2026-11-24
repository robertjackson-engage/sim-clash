// The trailer's scene script: which stage, which players, which swings, which key presses
// and API calls, and when the recording starts and stops. Run by shoot.mjs / recorder.cjs:
//
//   node tools/release/trailer/shoot.mjs                 film every scene
//   node tools/release/trailer/shoot.mjs --only rocket   film one
//   node tools/release/trailer/shoot.mjs --fast          rehearse: no recording, no waiting
//                                                        for the picture; prints what each swing did
//
// Every scene starts a FRESH private server with its own wind seed, so the winds, and so
// the flights, are the same on every take (the coin flip and the sudden-death arena are the
// game's own dice: the script reads the match state and plays whoever is up).
// The swings were found by rehearsing with --fast and reading the results; the numbers are
// ordinary ball data (ball speed mph, launch deg, start direction deg, spin rpm, spin axis deg).
import { players, forDistance, putt } from './lib.mjs';
import { beta2Scenes, WATCH_REPLAY } from './scenes-beta2.mjs';

// ---------- small helpers ----------
const BANNER = "(() => { const b = document.querySelector('.mt-banner'); return b && !b.classList.contains('hidden') && b.classList.contains('mt-b-turn') ? (b.innerText || '').replace(/\\s+/g, ' ').trim() : ''; })()";
const SCREEN = "(() => { const s = document.querySelector('.mt-screen'); return s && !s.classList.contains('hidden') ? ([...s.classList].find((k) => k.startsWith('mt-k-')) || 'mt-k-?').slice(5) : ''; })()";
const who = (m) => (m && m.players.find((p) => p.id === m.currentPlayerId)) || null;
const line = (m) => (m ? `${m.phase}${m.tiebreak ? ` r${m.tiebreak.round}` : ''} up=${(who(m) || {}).name || '-'} ${m.players.map((p) => `${p.name}:${p.strokes}${p.holed ? ' IN' : ` ${p.lie} ${p.distToPinYd}yd`}`).join(' | ')}` : 'no match');

async function fresh(c, seed, { tapInFt = 8, names = ['Alex', 'Sam'] } = {}) {
  await c.restartServer(seed);
  await c.api('/api/arcade/reset', {});
  await c.api('/api/arcade/settings', { enabled: true, assist: { tapInFt } });   // SETTINGS > TAP-INS GIVEN (8 ft is the default)
  c.P = await players(c, names);
  await c.monitor.connect();
  await c.realSleep(300);
}

// wait until the match is in play (the page readies itself when its intro screens are over)
async function untilPlay(c, since = 0) {
  if (c.fast) {
    for (let i = 0; i < 100; i++) {
      const m = c.matchNow();
      if (m && (m.phase === 'play' || m.phase === 'tiebreak')) return m;
      if (m && m.phase === 'intro') await c.api('/api/match/ready', {});
      await c.realSleep(100);
    }
    throw new Error('the match did not come into play');
  }
  const e = await c.waitEvent((x) => x.event === 'match' && x.data && (x.data.phase === 'play' || x.data.phase === 'tiebreak'), { since, timeoutMs: 45000 });
  if (!e) throw new Error('the match did not come into play');
  return e.data;
}
// the turn banner ("ALEX, YOU'RE UP", "PUTT IN TO WIN"): wait for it to come and go
async function turnBanner(c, { timeoutMs = 45000 } = {}) {
  if (c.fast) { await c.realSleep(120); return ''; }
  const text = await c.waitFor(BANNER, { timeoutMs });
  await c.mark('banner', { text });
  await c.waitFor(`!(${BANNER})`, { timeoutMs: 9000 });
  await c.mark('banner-out');
  return text || '';
}
// the winner screen (its REMATCH button is on it), then `holdMs` of it
async function winnerScreen(c, holdMs = 8000) {
  if (c.fast) return;
  await c.waitFor("document.querySelector('[data-mt=\"rematch\"]')", { timeoutMs: 30000 });
  await c.mark('winner');
  await c.sleep(holdMs);
}
// one swing by whoever is up; says what it did
async function play(c, launch, label, { aim = null } = {}) {
  const before = c.matchNow();
  const me = who(before);
  // Aim: every full swing is played straight at the pin (key 0), so a take does not depend
  // on where the auto aim happened to point; a putt is left to the game's own line.
  // (aim: a route of the stage that is not the flag's line, set as the aim keys would set it)
  if (me && me.lie !== 'green' && aim != null) {
    await c.api('/api/aim', { offset: aim });
    await c.sleep(1100);
  } else if (me && me.lie !== 'green') {
    if (!c.fast) { await c.key('0'); await c.sleep(700); }
    const st = await c.get('/api/state');
    if (st && st.aimOffset) { c.say(`   (aim was ${st.aimOffset}: set to 0)`); await c.api('/api/aim', { offset: 0 }); }
  }
  const shot = await c.swing(launch, label);
  await c.realSleep(200);   // the match state that follows the shot
  const m = c.matchNow();
  const a = shot && shot.arcade;
  const mine = m && me ? m.players.find((p) => p.id === me.id) : null;
  c.say(`   ${label}: ${me ? me.name : '?'} ${JSON.stringify(launch)} -> ${mine ? (mine.holed ? 'IN' : `${mine.lie}, ${mine.distToPinYd} yd left`) : '?'}`
    + `${shot && shot.match && shot.match.ft != null ? ` (${shot.match.ft} ft)` : ''}${shot && shot.match && shot.match.miss ? ` MISS ${shot.match.miss}` : ''}`
    + `${a && a.callout ? ` "${a.callout.text}"` : ''}${a ? ` ${a.grade}` : ''}${shot && shot.match && shot.match.event !== 'shot' ? ` => ${shot.match.event}` : ''}  [${line(m)}]`);
  return { shot, m, me: mine };
}
const startQuick = (c, stage) => c.api('/api/match/start', { playerIds: c.P.map((p) => p.id), format: 'quick', stage });
// arm a ball from the dock of whoever is up (a real click on the dock; the route when rehearsing)
async function arm(c, id) {
  const m = c.matchNow();
  if (c.fast) return c.api('/api/match/arm', { playerId: m.currentPlayerId, id });
  await c.click(`#arcade [data-id="${id}"]`).catch(async () => { await c.api('/api/match/arm', { playerId: m.currentPlayerId, id }); });
  await c.mark(`arm:${id}`);
  await c.mouseAway();
}

// ---------- the swings (found with --fast) ----------
const TUNE = process.env.TR_TUNE ? JSON.parse(process.env.TR_TUNE) : {};   // rehearsing: TR_TUNE='{"drive":{...}}' tries another swing
const SW = {
  drive: { speed: 158, vla: 13, hla: 0, spin: 2600, spinAxis: 0 },            // at the flag: through the 150 mph wall and the boost ring behind it, onto the green
  safe: { speed: 132, vla: 14.8, hla: 0, spin: 4300, spinAxis: 0 },           // the other way round, 22.5 degrees left of the flag: the Switchback, onto the speed strip at the turn
  slice: { speed: 150, vla: 13, hla: 7, spin: 3200, spinAxis: 28 },           // a real slice: starts right and keeps going
  rocket: { speed: 165, vla: 13.5, hla: 0, spin: 2500, spinAxis: 0 },         // the same drive, with the free Rocket under it
  lava: { speed: 100, vla: 18, hla: 2, spin: 6500, spinAxis: 5 },             // a 7-iron caught thin: short of the island
};

const DRAGON = { seed: 2, first: { speed: 166, vla: 13.5, hla: 0, spin: 2500, spinAxis: 0 }, second: { speed: 150, vla: 13.5, hla: 0, spin: 2500, spinAxis: 0 } };   // wind seed 2: 8 mph, helping

export const scenes = [
  // ------------------------------------------------------------------------------------
  {
    id: 'match',
    title: 'title > VERSUS > lobby > VS + coin flip > stage intro > the drive through the 150 mph wall (and its replay), the safe route onto the speed strip, armed approach, the putt to win, the winner',
    async run(c) {
      await fresh(c, 2, { tapInFt: 3 });        // wind seed 2: Canyon Run plays 7 mph, helping
      await c.goto(c.fast ? '/?menu=0' : '/', { settleMs: 10000 });
      await c.mouseAway();
      await c.evaluate(WATCH_REPLAY);
      await c.rec.start('match');
      if (c.fast) await startQuick(c, 'canyon-run');
      else {
        await c.sleep(4200);                                   // the title and its wordmark
        await c.key('Enter'); await c.mark('menu');            // any key: the main menu
        await c.sleep(2300);
        await c.key('Enter'); await c.mark('lobby');           // VERSUS is the first item: the lobby
        await c.sleep(2300);
        await c.click('[data-stage="canyon-run"]');
        await c.sleep(1100);
        await c.click('[data-mt="start"]');
      }
      await c.mark('start');
      const t = Date.now();
      await untilPlay(c, t);
      await c.mark('play');
      await c.mouseAway();
      await turnBanner(c);
      await c.sleep(900);
      const hero = who(c.matchNow());
      // 1: the drive at the flag, in ball cam: 156 mph goes through the 150 wall and the ring
      // (SMASHED IT!, and the game replays it by itself from another camera)
      await play(c, TUNE.drive || SW.drive, 'drive');
      await turnBanner(c);
      await c.sleep(700);
      // 2: the other player goes round: the safe route, and the speed strip runs it up the ramp
      await play(c, TUNE.safe || SW.safe, 'safe', { aim: TUNE.safeAim ?? -22.5 });
      await turnBanner(c);
      await c.sleep(600);
      // then whoever is up, until the hole is decided: the hero arms a Sticky ball for the
      // approach and holes the putt; the other player's putt stays out
      for (let guard = 0, armed = false; guard < 10; guard++) {
        const m = c.matchNow();
        if (!m || m.phase !== 'play') break;
        const me = who(m);
        const isHero = me.id === hero.id;
        let launch, label;
        if (me.lie === 'green') {
          label = isHero ? 'putt-hero' : 'putt-foil';
          launch = isHero ? putt(me.distToPinYd) : { ...putt(me.distToPinYd), speed: +(putt(me.distToPinYd).speed * 0.74).toFixed(1), hla: 3.4 };   // the other player's: short and wide of the line
        } else {
          label = isHero ? 'approach-hero' : 'approach-foil';
          launch = { ...forDistance(me.distToPinYd), hla: 0 };
          if (!armed) { armed = true; await c.sleep(500); await arm(c, 'sticky'); await c.sleep(2600); }
        }
        const r = await play(c, launch, label);
        if (!r.m || r.m.phase !== 'play') break;
        await turnBanner(c);
        await c.sleep(600);
      }
      c.say(`   result: ${line(c.matchNow())} ${JSON.stringify((c.matchNow() || {}).lastResult || null)}`);
      // the stamp, the knockout screen, the winner and the confetti
      await winnerScreen(c);
      await c.rec.stop();
      await c.api('/api/match/abort', {});
    },
  },
  // ------------------------------------------------------------------------------------
  {
    id: 'rocket',
    title: 'Sky Fortress (a rocket hole): the stage intro with the free Rocket, both tee shots',
    async run(c) {
      await fresh(c, 1);
      await c.goto('/?menu=0', { settleMs: 8000 });
      await c.mouseAway();
      await c.evaluate(WATCH_REPLAY);
      await c.rec.start('rocket');
      await c.sleep(800);
      const t = Date.now();
      await startQuick(c, 'sky-fortress');
      await c.mark('start');
      await untilPlay(c, t);
      await c.mark('play');
      await turnBanner(c);
      await c.sleep(1200);
      await play(c, { ...SW.rocket, speed: 172 }, 'rocket-1');
      await turnBanner(c);
      await c.sleep(900);
      await play(c, { ...SW.rocket, speed: 156 }, 'rocket-2');
      await turnBanner(c);
      await c.sleep(1500);
      await c.rec.stop();
      await c.api('/api/match/abort', {});
    },
  },
  // ------------------------------------------------------------------------------------
  {
    id: 'dragon',
    title: "Dragon's Spine (a rocket hole, 604 yd over the lava): the stage intro with the free Rocket, both tee shots",
    async run(c) {
      await fresh(c, DRAGON.seed);
      await c.goto('/?menu=0', { settleMs: 8000 });
      await c.mouseAway();
      await c.evaluate(WATCH_REPLAY);
      await c.rec.start('dragon');
      await c.sleep(800);
      const t = Date.now();
      await startQuick(c, 'dragons-spine');
      await c.mark('start');
      await untilPlay(c, t);
      await c.mark('play');
      await turnBanner(c);
      await c.sleep(1200);
      await play(c, DRAGON.first, 'rocket-1');
      await turnBanner(c);
      await c.sleep(900);
      await play(c, DRAGON.second, 'rocket-2');
      await turnBanner(c);
      await c.sleep(1500);
      await c.rec.stop();
      await c.api('/api/match/abort', {});
    },
  },
  // ------------------------------------------------------------------------------------
  {
    id: 'volcano',
    title: 'Volcano Drop: one finds the island, one finds the lava',
    async run(c) {
      await fresh(c, 1);
      await c.goto('/?menu=0', { settleMs: 8000 });
      await c.mouseAway();
      await c.evaluate(WATCH_REPLAY);
      await c.rec.start('volcano');
      await c.sleep(800);
      const t = Date.now();
      await startQuick(c, 'volcano-drop');
      await c.mark('start');
      const m = await untilPlay(c, t);
      await c.mark('play');
      await turnBanner(c);
      await c.sleep(900);
      await play(c, { speed: 124, vla: 16.3, hla: 0, spin: 5290, spinAxis: 0 }, 'island');
      await turnBanner(c);
      await c.sleep(700);
      await play(c, SW.lava, 'lava');
      await turnBanner(c);
      await c.sleep(1200);
      await c.rec.stop();
      await c.api('/api/match/abort', {});
    },
  },
  // ------------------------------------------------------------------------------------
  {
    id: 'sudden',
    title: 'a tied hole > SUDDEN DEATH in the night stadium (Thunder Dome), closest to the pin, the winner',
    async run(c) {
      // The arena is the game's own pick (one of three): play a tied hole, off camera, until
      // it is the stadium. Both players hit the same two shots on Sakura Garden.
      let m = null;
      for (let attempt = 1; attempt <= 12; attempt++) {
        await fresh(c, 3);
        await startQuick(c, 'sakura-garden');
        for (let i = 0; i < 100; i++) { m = c.matchNow(); if (m && m.phase === 'play') break; if (m && m.phase === 'intro') await c.api('/api/match/ready', {}); await c.realSleep(100); }
        for (let guard = 0; guard < 8 && (m = c.matchNow()) && m.phase === 'play'; guard++) {
          const me = who(m);
          await c.api('/api/test-shot', me.lie === 'green' ? putt(me.distToPinYd) : forDistance(me.distToPinYd));
          await c.realSleep(250);
        }
        m = c.matchNow();
        const next = m && m.nextStage ? m.nextStage.id : null;
        c.say(`   attempt ${attempt}: ${m && m.lastResult ? m.lastResult.reason : m && m.phase}, sudden death at ${next}`);
        if (m && m.phase === 'hole-result' && m.lastResult.reason === 'tied' && next === 'thunder-dome') break;
        await c.api('/api/match/abort', {});
        m = null;
      }
      if (!m) throw new Error('no tied hole with the stadium next, in 12 attempts');
      // the page joins the match on its tied result ("ALL SQUARE"), and moves on by itself
      // eight seconds later: SUDDEN DEATH. Recording starts as soon as the page is up.
      const t = Date.now();
      await c.goto('/?menu=0', { settleMs: 2200 });
      await c.mouseAway();
      await c.evaluate(WATCH_REPLAY);
      await c.rec.start('sudden');
      if (c.fast) await c.api('/api/match/continue', {});
      const cont = await c.waitEvent((x) => x.event === 'match' && x.data && (x.data.phase === 'loading' || x.data.phase === 'intro') && x.data.tiebreak, { since: t, timeoutMs: 20000 });
      await c.mark('sudden');
      if (!cont) c.say('   !! the page did not move on to the sudden death by itself');
      m = await untilPlay(c, t);
      await c.mark('play');
      await turnBanner(c);
      await c.sleep(900);
      // first ball: on the green, a fair way off. Second ball: inside it.
      await play(c, { speed: 94, vla: 23, hla: 1.6, spin: 8300, spinAxis: 0 }, 'sd-1');
      await turnBanner(c);
      await c.sleep(900);
      await play(c, { speed: 97, vla: 23, hla: 0.8, spin: 8300, spinAxis: 0 }, 'sd-2');
      c.say(`   result: ${line(c.matchNow())} ${JSON.stringify((c.matchNow() || {}).lastResult || null)}`);
      await winnerScreen(c);
      await c.rec.stop();
      await c.api('/api/match/abort', {});
    },
  },
  // ------------------------------------------------------------------------------------
  {
    id: 'worlds',
    title: 'five other worlds, a tee shot in ball cam on each (free play)',
    async run(c) {
      await fresh(c, 4);
      const tour = (await c.get('/api/match')).tour;
      const shots = {
        'frostbite-ridge': { speed: 160, vla: 13, hla: 0, spin: 2500, spinAxis: 0 },
        'sakura-garden': null,
        'pharaohs-gate': { speed: 162, vla: 13, hla: 0, spin: 2500, spinAxis: 0 },
        'midnight-mile': { speed: 166, vla: 12.5, hla: 0, spin: 2400, spinAxis: 0 },
        'dragons-spine': { speed: 165, vla: 13.5, hla: 0, spin: 2500, spinAxis: 0 },
        'temple-run': { speed: 164, vla: 13, hla: 0, spin: 2500, spinAxis: 0 },
      };
      for (const id of Object.keys(shots)) {
        const s = tour.stages.find((x) => x.id === id);
        await c.api('/api/load-course', { cached: s.file });
        await c.goto('/?menu=0', { settleMs: 9000 });
        await c.mouseAway();
        const st = await c.get('/api/state');
        await c.rec.start(`world-${id}`, { info: { stage: id } });
        await c.sleep(2500);
        const launch = shots[id] || forDistance(st.distToPinYd || s.lengthYd);
        const shot = await c.swing(launch, 'tee');
        c.say(`   ${id}: ${JSON.stringify(launch)} -> ${shot ? `${shot.lie}, ${shot.distToPinYd} yd left${shot.arcade && shot.arcade.callout ? ` "${shot.arcade.callout.text}"` : ''}` : 'not played'}`);
        await c.sleep(15000);
        await c.rec.stop();
      }
    },
  },
  // ---------- 1.0.0-beta.2: gadgets, flyovers, party, Bullseye (scenes-beta2.mjs) ----------
  ...beta2Scenes({ fresh, who, line, untilPlay, turnBanner }),
];
