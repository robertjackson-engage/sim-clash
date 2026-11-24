// Match v2 in the HUD (docs/dev/arcade-v2-contract.md, section 4): the 1v1 game as a set of
// full-bleed arcade screens, driven by the server's match state.
//
//   lobby        two player slots, format cards, stage picker, options drawer, START
//   vs           first intro of a match: both names slam in, the format, the coin flip
//   stage        every hole: hole number, stage name, par, yards, blurb, series score
//   sudden       the SUDDEN DEATH intro before a closest-to-the-pin tiebreak
//   (in play)    VS header (strokes, distance, pips, whose turn), turn banner, ticker;
//                in a tiebreak the header becomes the duel board (feet, MISS, AGAIN!)
//   result       KNOCKOUT! / ALEX WINS THE HOLE / ALL SQUARE, the series, what is next
//   winner       ALEX WINS!, confetti, awards, trophies, the chest, rematch
//
// The server owns the match: every action is POSTed and the new state comes back through
// onMatch(state) (the 'match' SSE event, held by app.js while a ball is in the air).
// Screens follow state.phase; state.events are played once each, by seq.
//
// Everything is built inside the hud element given, classes prefixed .mt-, styled by
// public/arcade/match.css. The pure helpers at the top are exported for the tests and the
// demo page (public/arcade/match-demo.html), which doubles as the living spec.

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => Number(n || 0).toLocaleString('en-US');
const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));

// ---------------------------------------------------------------- pure helpers (exported)

// Player one is always the hot orange-red, player two the electric blue: the same two colours
// as the arcade HUD's ball dock.
export const SLOT_COLORS = { 1: '#ff5a36', 2: '#2e9bff' };
export function playerColor(slot) { return SLOT_COLORS[slot === 2 ? 2 : 1]; }

// Stage art colours per course theme (course.arcade.theme): a to b is the poster gradient.
export const THEMES = {
  tropical: { a: '#16d9c2', b: '#0b62d6', glow: '#aef7ff' },
  canyon: { a: '#ff8a3a', b: '#8a2a12', glow: '#ffd9a6' },
  links: { a: '#7ed957', b: '#17705a', glow: '#e4ffc4' },
  volcano: { a: '#ff4416', b: '#3b0a0a', glow: '#ffc04a' },
  alpine: { a: '#bfeeff', b: '#2b6fc0', glow: '#ffffff' },
  sakura: { a: '#ff9ccb', b: '#a8327a', glow: '#ffe3f1' },
  jungle: { a: '#3ed06a', b: '#0b4a2c', glow: '#d5ff9a' },
  desert: { a: '#ffcb5c', b: '#b5651d', glow: '#fff1c4' },
  neon: { a: '#d640ff', b: '#0c1a72', glow: '#3df5ff' },
  stadium: { a: '#ffd21f', b: '#1b2b55', glow: '#fff6c9' },
  current: { a: '#5ad17a', b: '#1c5f46', glow: '#e4ffc4' },
};
export const themeOf = (stage) => THEMES[stage && stage.theme] || THEMES.current;

// One bold silhouette per theme (viewBox 0 0 400 200), drawn in currentColor.
const SIL = {
  tropical: '<path d="M0 200Q90 150 200 150T400 200z"/><path d="M250 154q-6-50 6-92l9 2q-10 42-4 90z"/><path d="M258 62q-40-22-74 2 38-10 74-2zM258 62q10-40 52-46-32 14-52 46zM258 62q44-14 72 14-36-14-72-14zM258 62q-24-34-62-30 34 6 62 30zM258 62q32 10 40 46-18-30-40-46z"/>',
  canyon: '<path d="M0 200v-80h40V80h70v50h40V60h90v80h50v-40h60v40h50v60z"/>',
  links: '<path d="M0 200v-50q80-20 160-10l40-8 200 20v48z"/><path d="M286 146l8-96h24l8 96z"/><path d="M290 50h32V36h-32zM296 36l10-14 10 14z"/>',
  volcano: '<path d="M0 200L130 60q20-14 36 0 14 12 30 0 18-12 34 4L400 200z"/><circle cx="198" cy="32" r="11"/><circle cx="226" cy="12" r="7"/>',
  alpine: '<path d="M0 200L90 70l40 50 60-100 70 110 40-40 100 110z"/>',
  sakura: '<path d="M90 60q110-24 220 0l-6 20q-104-18-208 0zM110 96h180v14H110zM132 80h18v120h-18zM250 80h18v120h-18z"/>',
  jungle: '<path d="M60 200v-30h30v-30h30v-30h30V80h30V50h40v30h30v30h30v30h30v30h30v30z"/>',
  desert: '<path d="M20 200L150 50l130 150z"/><path d="M220 200l90-100 90 100z"/>',
  neon: '<path d="M0 200v-80h36V80h30v40h20V40h44v90h24V70h36v60h22V20h40v110h26V90h34v40h20V60h36v70h32v70z"/>',
  stadium: '<path d="M0 200v-50q200-70 400 0v50z"/><path d="M40 140V40h8v100zM352 140V40h8v100zM28 28h32v16H28zM340 28h32v16h-32z"/>',
  current: '<path d="M0 200q100-70 200-40t200-20v60z"/><path d="M296 150V40h5v110z"/><path d="M301 42l44 16-44 18z"/>',
};
export const silhouette = (theme) => `<svg class="mt-sil" viewBox="0 0 400 200" preserveAspectRatio="xMidYMax meet" aria-hidden="true">${SIL[theme] || SIL.current}</svg>`;

export const FORMATS = [
  { id: 'quick', label: 'QUICK MATCH', sub: 'ONE HOLE', blurb: 'One hole. Winner takes it.', target: 1, holes: 1, voice: 'm-quick-match' },
  { id: 'bo3', label: 'BEST OF 3', sub: 'FIRST TO 2', blurb: 'Three stages. First to two.', target: 2, holes: 3, voice: 'm-best-of-3' },
  { id: 'bo9', label: 'TOURNAMENT', sub: 'BEST OF 9', blurb: 'The whole Clash Tour. First to five.', target: 5, holes: 9, voice: 'm-best-of-9' },
];
export const formatOf = (id) => FORMATS.find((f) => f.id === id) || FORMATS[0];

const TIER_FALLBACK = [
  { id: 'rookie', label: 'Rookie', entryFee: 50 },
  { id: 'amateur', label: 'Amateur', entryFee: 200 },
  { id: 'pro', label: 'Pro', entryFee: 1000 },
  { id: 'master', label: 'Master', entryFee: 5000 },
];

// BIRDIE, PAR ... for a number of strokes on a par.
export function scoreName(strokes, par) {
  if (strokes == null || par == null) return '';
  if (strokes === 1) return 'ACE';
  const d = strokes - par;
  if (d <= -3) return 'ALBATROSS';
  if (d === -2) return 'EAGLE';
  if (d === -1) return 'BIRDIE';
  if (d === 0) return 'PAR';
  if (d === 1) return 'BOGEY';
  if (d === 2) return 'DOUBLE BOGEY';
  if (d === 3) return 'TRIPLE BOGEY';
  return `${d} OVER`;
}
// what is left to the hole: feet once it is a putt or a chip, else yards
export const toGoText = (yd) => (yd == null ? '–' : yd < 30 ? `${Math.max(1, Math.round(yd * 3))} FT` : `${Math.round(yd)} YD`);
export const ftText = (ft) => (ft == null ? '–' : ft < 1 ? `${Math.max(1, Math.round(ft * 12))} IN` : `${ft < 100 ? (Math.round(ft * 10) / 10).toFixed(1) : Math.round(ft)} FT`);
export function initialsOf(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  return (words.length > 1 ? words[0][0] + words[words.length - 1][0] : words[0].slice(0, 2)).toUpperCase();
}
// A name as it is shouted on a banner: the whole name when it is short, else the first name.
export function shout(name) {
  const n = String(name || 'Player').trim().replace(/\s+/g, ' ');
  return (n.length <= 12 ? n : n.split(' ')[0]).toUpperCase();
}
export const slotOf = (m, id) => {
  const i = m.players.findIndex((p) => p.id === id);
  return i < 0 ? 1 : (m.players[i].slot === 2 || m.players[i].slot === 1 ? m.players[i].slot : i + 1);
};
export const bySlot = (m) => [...m.players].sort((a, b) => slotOf(m, a.id) - slotOf(m, b.id));
export const playerOf = (m, id) => m.players.find((p) => p.id === id) || null;
export const otherOf = (m, id) => m.players.find((p) => p.id !== id) || null;
const voiceName = (m, p) => ({ name: p.name, fallback: `m-player-${slotOf(m, p.id)}` });

// A rank as text, whatever the ledger keeps: 'Gold', 3, { label }.
export function rankText(rank) {
  if (rank == null || rank === '') return '';
  if (typeof rank === 'number') return `RANK ${rank}`;
  if (typeof rank === 'object') return String(rank.label || rank.name || rank.id || '').toUpperCase();
  return String(rank).toUpperCase();
}

// The stage an intro is about. While the course is loading, the stage being loaded is
// nextStage (the contract keeps it set during 'hole-result' and 'loading'), else stage.
export function introStage(m) {
  if (!m) return null;
  return (m.phase === 'loading' && m.nextStage) || m.stage || m.nextStage || null;
}
// The hole of the match an intro announces (holeNumber may still be the old hole's while
// the next stage loads; the results list is one entry per hole played).
export function introHoleNumber(m) {
  const played = (m.holeResults || []).length;
  if (m.phase === 'loading' && m.nextStage && m.nextStage.kind !== 'tiebreak') return played + 1;
  return m.holeNumber || played + 1;
}
// One intro per stage visit: a new key means "play the intro screens".
export function introKey(m) {
  const st = introStage(m);
  return `${m.id}|${st && st.kind === 'tiebreak' ? 'tiebreak' : 'match'}|${(m.holeResults || []).length}`;
}

// v2:stake The stake of the swing of the player who is up, from the server's shotFor /
// shotKind (lib/match.js shotStake): PUTT IN TO WIN, CHIP IN TO TIE ... or null when the
// swing is for neither. A putt or a chip always gets its line. A full shot gets it when it
// is the last word (HOLE IT TO TIE: the must-make) or when holing it beats a score that is
// already in (HOLE IT TO WIN); not for the mere arithmetic of a hole-out from the fairway
// or the tee that would knock out a player who has taken more strokes.
export function stakeView(m, p) {
  if (!m || !p || m.phase !== 'play') return null;
  const f = p.shotFor;
  if (f !== 'win' && f !== 'tie') return null;
  const kind = p.shotKind === 'putt' || p.shotKind === 'chip' ? p.shotKind : 'shot';
  const opp = otherOf(m, p.id);
  if (kind === 'shot' && f === 'win' && !(opp && opp.holed)) return null;
  const verb = kind === 'putt' ? 'PUTT IN' : kind === 'chip' ? 'CHIP IN' : 'HOLE IT';
  return { for: f, kind, text: `${verb} TO ${f === 'win' ? 'WIN' : 'TIE'}`, voice: f === 'win' ? 'm-for-the-win' : 'm-to-tie' };
}

// What the next swing is for: the second line of the turn banner.
// tone: 'must' (make it or lose), 'win', 'score', 'info'
export function shotNeed(m, p) {
  const stake = stakeView(m, p);   // v2:stake to win or to tie comes before everything else
  if (stake) return { text: stake.text, tone: `stake-${stake.for}`, stake };
  const opp = otherOf(m, p.id);
  const par = m.stage && m.stage.par;
  if (m.phase === 'tiebreak') {
    const tb = m.tiebreak || {};
    const theirs = (tb.results || []).find((r) => r.round === tb.round && r.playerId === (opp && opp.id));
    if (theirs && theirs.holed) return { text: 'HOLE IT TO STAY ALIVE', tone: 'must' };
    if (theirs && (theirs.miss || theirs.ft == null)) return { text: `${shout(opp.name)} MISSED: JUST FIND LAND`, tone: 'win' };
    if (theirs) return { text: `BEAT ${ftText(theirs.ft)}`, tone: 'win' };
    return { text: 'CLOSEST TO THE PIN', tone: 'info' };
  }
  const next = (p.strokes || 0) + 1;
  const fog = p.cursedWith === 'fog';   // the fog trick: no yardage is given away
  if (p.mustHole) return { text: 'MUST MAKE THIS', tone: 'must' };
  const close = p.lie === 'green' || (p.distToPinYd != null && p.distToPinYd <= 30);
  if (opp && opp.holed) {
    if (next < opp.strokes && close) return { text: 'TO WIN THE HOLE', tone: 'win' };
    if (next === opp.strokes) return { text: 'TO TIE', tone: 'must' };
  }
  if (close && par != null) return { text: `FOR ${scoreName(next, par)}`, tone: 'score' };
  if (!p.strokes) {
    const st = m.stage || {};
    // a rocket hole: everybody's tee shot is a free ball, already loaded
    const len = fog ? '???' : st.lengthYd ? `${Math.round(st.lengthYd)} YD` : '';
    if (st.freeBall && m.phase === 'play') return { text: `${ballWord(st.freeBall)} LOADED${len ? ` · ${len}` : ''}`, tone: 'rocket' };
    return { text: ['TEE SHOT', len, par ? `PAR ${par}` : ''].filter(Boolean).join(' · '), tone: 'info' };
  }
  return { text: `SHOT ${next}${fog ? ' · ??? TO THE PIN' : p.distToPinYd != null ? ` · ${toGoText(p.distToPinYd)} TO THE PIN` : ''}`, tone: 'info' };
}

// 'rocket' -> 'ROCKET', 'tiny-cup' -> 'TINY CUP'
export const ballWord = (id) => String(id || '').replace(/[-_]/g, ' ').trim().toUpperCase();

// The ways to play a stage (hole.routes), as the three chips of the stage intro: SAFE, RISKY,
// ROCKET, in that order, one of each at most.
const ROUTE_LABEL = { safe: 'SAFE', risky: 'RISKY', rocket: 'ROCKET' };
export function stageRoutes(stage) {
  const list = Array.isArray(stage && stage.routes) ? stage.routes : [];
  return Object.keys(ROUTE_LABEL)
    .map((id) => { const r = list.find((x) => x && x.id === id); return r ? { id, label: ROUTE_LABEL[id], name: String(r.name || r.note || '').trim() } : null; })
    .filter((r) => r && r.name);
}

// v2:wind The hole's wind (stage.wind, lib/arcade-wind.js) as the intro's WIND chip and the
// header's badge show it. The wind is rolled when the stage's course comes up, so a stage
// that is still loading has its range only (mph null): the chip shows that until the roll
// lands. arrowDeg turns an arrow that points UP THE SCREEN = TOWARD THE PIN: 0 the wind is
// behind (helping), 90 it blows left to right, 180 into the player's face.
// tone: 'calm' (green) | 'moderate' (amber) | 'strong' (red) | 'pending'
export function windView(wind) {
  if (!wind || typeof wind !== 'object') return null;
  const n = (v) => typeof v === 'number' && Number.isFinite(v);
  if (!n(wind.mph)) {
    if (!n(wind.min) || !n(wind.max)) return null;
    return { known: false, tone: 'pending', num: wind.min === wind.max ? String(wind.min) : `${wind.min}–${wind.max}`, arrowDeg: null, lines: ['ROLLING THE WIND'], text: wind.label || '' };
  }
  const mph = Math.max(0, Math.round(wind.mph));
  const tone = ['calm', 'moderate', 'strong'].includes(wind.strength) ? wind.strength : mph <= 5 ? 'calm' : mph <= 12 ? 'moderate' : 'strong';
  const lines = mph < 1 ? ['NO WIND'] : [
    wind.cross === 'R' ? 'LEFT TO RIGHT' : wind.cross === 'L' ? 'RIGHT TO LEFT' : '',
    wind.along === 'tail' ? 'HELPING' : wind.along === 'head' ? 'HURTING' : '',
  ].filter(Boolean);
  return { known: true, tone, num: String(mph), arrowDeg: mph >= 1 && n(wind.relDeg) ? wind.relDeg : null, lines, text: wind.label || `${mph} MPH` };
}

// v2:menu The match menu (the pause panel): what it offers for this state. RESUME, UNDO LAST
// SHOT (when the server has a swing to take back: state.undoable), RESTART HOLE (while a hole
// or a sudden-death round is being played: state.canRestartHole), RESTART MATCH, QUIT MATCH.
// `ask`: destructive, so it asks once before it is done. Number keys 1 to 5 press them.
// v2:playability With the game state (`game`: canDrop, rescue, drop) and a hole in play, DROP
// ON THE LINE is offered third, for whoever is up: FREE DROP out of a dead lie (one press),
// else +1 stroke (it asks once). An undoable drop reads as a drop.
export function menuItems(m, game = null, { shell = false } = {}) {   // v2:shell shell: the game product, where the way out of a match is the main menu
  if (!m) return [];
  const u = m.undoable || null;
  const who = u ? playerOf(m, u.playerId) : null;
  const round = m.phase === 'tiebreak';
  const d = game && game.canDrop && game.drop && m.phase === 'play' && m.currentPlayerId ? game.drop : null;
  const up = d ? playerOf(m, m.currentPlayerId) : null;
  const yd = d && Number.isFinite(d.distToPinYd) ? ` · ${Math.round(d.distToPinYd)} YD OUT` : '';
  const drop = !d ? [] : [d.free
    ? { id: 'drop', label: 'FREE DROP', sub: `${up ? `${shout(up.name)}: ` : ''}STUCK? BACK ON THE LINE · NO PENALTY${yd}`, on: true, ask: null }
    : { id: 'drop', label: 'DROP ON THE LINE', sub: `${up ? `${shout(up.name)}: ` : ''}BACK ON THE FAIRWAY · +1 STROKE`, on: true,
      ask: { title: 'DROP ON THE LINE?', sub: `${up ? `${shout(up.name)} TAKES ` : ''}+1 STROKE. THE BALL GOES BACK ON THE FAIRWAY${yd}.` } }];
  return [
    { id: 'resume', label: 'RESUME', sub: 'BACK TO THE MATCH', on: true, ask: null },
    { id: 'undo', label: u && u.drop ? 'UNDO THE DROP' : 'UNDO LAST SHOT', sub: u ? (u.drop ? `TAKE BACK ${who ? `${shout(who.name)}'S` : 'THE'} DROP` : `TAKE BACK ${who ? `${shout(who.name)}'S` : 'THE LAST'} SWING${u.stray ? ' · A STRAY BALL?' : ''}`) : 'NO SWING TO TAKE BACK', on: !!u, ask: null },
    ...drop,
    { id: 'restart-hole', label: round ? 'RESTART ROUND' : 'RESTART HOLE', sub: m.canRestartHole ? (round ? 'THIS SUDDEN-DEATH ROUND AGAIN' : 'BOTH PLAYERS BACK ON THE TEE') : 'NO HOLE IS BEING PLAYED', on: !!m.canRestartHole,
      ask: { title: round ? 'RESTART THE ROUND?' : 'RESTART THE HOLE?', sub: round ? 'BOTH BALLS OF THIS ROUND ARE HIT AGAIN.' : 'BOTH PLAYERS GO BACK TO THE TEE. THE SHOTS OF THIS HOLE ARE FORGOTTEN.' } },
    { id: 'restart-match', label: 'RESTART MATCH', sub: 'SAME PLAYERS, FROM THE TOP', on: true, ask: { title: 'RESTART THE MATCH?', sub: 'THE SCORE IS WIPED. SAME PLAYERS, SAME FORMAT, HOLE ONE.' } },
    shell   // v2:shell
      ? { id: 'quit', label: 'EXIT TO MAIN MENU', sub: m.phase === 'done' ? 'THE RESULT STANDS' : 'QUIT THE MATCH · NO RESULT', on: true, ask: { title: 'EXIT TO MAIN MENU?', sub: m.phase === 'done' ? 'THE RESULT STANDS.' : 'THE MATCH ENDS. NOBODY WINS, NOTHING IS PAID.' } }
      : { id: 'quit', label: 'QUIT MATCH', sub: 'NO RESULT. BACK TO THE COURSE.', on: true, ask: { title: 'QUIT MATCH?', sub: m.phase === 'done' ? 'THE RESULT STANDS. BACK TO THE COURSE.' : 'NOBODY WINS, NOTHING IS PAID. BACK TO THE COURSE.' } },
  ];
}

// The tiebreak round on the duel board: each player's ball, from the live tiebreak or,
// once it is decided, from the hole's result.
export function duelView(m) {
  const tb = m.tiebreak;
  const lr = m.lastResult && m.lastResult.tiebreak ? m.lastResult.tiebreak : null;
  const cells = {};
  let round = 1;
  if (tb && Array.isArray(tb.results)) {
    round = tb.round || Math.max(1, ...tb.results.map((r) => r.round || 1));
    for (const p of m.players) {
      const r = tb.results.find((x) => x.playerId === p.id && (x.round || 1) === round);
      cells[p.id] = !r ? { state: 'wait' }
        : r.holed ? { state: 'in', ft: 0 }
          : r.miss || r.ft == null ? { state: 'miss', miss: r.miss || 'miss' }
            : { state: 'ft', ft: r.ft };
    }
  } else if (lr && Array.isArray(lr.rounds) && lr.rounds.length) {
    round = lr.rounds.length;
    const last = lr.rounds[round - 1] || {};
    for (const p of m.players) {
      const ft = last[p.id];
      cells[p.id] = ft === undefined ? { state: 'wait' } : ft == null ? { state: 'miss', miss: 'miss' } : ft === 0 ? { state: 'in', ft: 0 } : { state: 'ft', ft };
    }
  } else {
    for (const p of m.players) cells[p.id] = p.tiebreakFt != null ? { state: 'ft', ft: p.tiebreakFt } : { state: 'wait' };
  }
  return { round, cells, arenaId: (tb && tb.arenaId) || (lr && lr.arenaId) || null };
}

// What the hole-result screen says.
export function holeResultView(m, r = m.lastResult) {
  if (!r) return null;
  const w = r.winnerId ? playerOf(m, r.winnerId) : null;
  const l = w ? otherOf(m, w.id) : null;
  const par = r.par ?? (m.stage && m.stage.par);
  const idx = (r.holeNumber || 1) - 1;
  const duel = r.reason === 'tiebreak' ? duelView({ ...m, tiebreak: null, lastResult: r }) : null;
  const row = (p) => {
    const strokes = r.scores ? r.scores[p.id] : null;
    const hs = Array.isArray(p.holeScores) ? p.holeScores[idx] : undefined;
    const tiedLevel = !r.winnerId && strokes != null;
    const finished = hs !== undefined ? hs != null : (tiedLevel || p.id === r.winnerId || r.reason === 'score');
    if (duel) {
      const c = duel.cells[p.id] || { state: 'wait' };
      return { p, big: c.state === 'ft' ? ftText(c.ft) : c.state === 'in' ? 'IN!' : 'MISS', label: 'TO THE PIN', out: c.state === 'miss', duel: true };
    }
    if (strokes == null) return { p, big: '–', label: '', out: true };
    if (!finished) return { p, big: String(strokes), label: r.reason === 'cap' ? 'STROKE LIMIT' : r.reason === 'hazard' ? 'HAZARD' : 'OUT', out: true };
    return { p, big: String(strokes), label: scoreName(strokes, par), out: false };
  };
  const rows = bySlot(m).map(row);
  const rw = w ? rows.find((x) => x.p.id === w.id) : null;
  const rl = l ? rows.find((x) => x.p.id === l.id) : null;
  let kind, title, sub, how;
  if (w && (r.reason === 'knockout' || r.reason === 'cap')) {
    kind = 'knockout'; title = 'KNOCKOUT!'; sub = `${shout(w.name)} WINS THE HOLE`;
    how = r.reason === 'cap' ? `${shout(l.name)} HIT THE STROKE LIMIT`
      : `IN FOR ${rw.label || rw.big}. ${shout(l.name)} CAN'T CATCH IT.`;
  } else if (w) {
    kind = 'win'; title = shout(w.name); sub = 'WINS THE HOLE';
    how = r.reason === 'tiebreak' ? (rl.out ? `${rw.big} TO THE PIN. ${shout(l.name)} MISSED.` : `CLOSEST TO THE PIN: ${rw.big} BEATS ${rl.big}`)
      : r.reason === 'hazard' ? `${shout(l.name)} FOUND THE HAZARD`
        : rw.label && rl.label && !rl.out ? `${rw.label} BEATS ${rl.label}` : '';
  } else if (r.reason === 'tied') {
    kind = 'tied'; title = 'ALL SQUARE!'; sub = 'SUDDEN DEATH DECIDES IT';
    how = rows[0].label && rows[0].label === rows[1].label && !rows[0].out ? `BOTH MAKE ${rows[0].label}` : 'NOTHING BETWEEN THEM';
  } else {
    kind = 'halved'; title = 'HOLE HALVED'; sub = 'NOTHING BETWEEN THEM';
    how = rows[0].label && rows[0].label === rows[1].label && !rows[0].out ? `BOTH MAKE ${rows[0].label}` : '';
  }
  return { kind, title, sub, how, rows, winner: w, loser: l, par, holeNumber: r.holeNumber, stageName: r.stageName };
}

// FLAWLESS (a series won without dropping a hole) and COMEBACK (won after trailing).
export function seriesTags(m) {
  const tags = [];
  if (!m || !m.winnerId || m.reason === 'concede') return tags;
  const w = playerOf(m, m.winnerId), l = otherOf(m, m.winnerId);
  if (!w || !l) return tags;
  if ((m.target || 1) >= 2 && (l.holesWon || 0) === 0 && (w.holesWon || 0) >= (m.target || 1)) tags.push({ id: 'flawless', text: 'FLAWLESS VICTORY', lines: ['FLAWLESS', 'VICTORY'], voice: 'm-flawless' });
  let a = 0, b = 0, worst = 0;
  for (const r of m.holeResults || []) {
    if (r.winnerId === w.id) a++; else if (r.winnerId === l.id) b++;
    worst = Math.max(worst, b - a);
  }
  if (worst >= ((m.target || 1) >= 5 ? 2 : 1) && (m.target || 1) >= 2) tags.push({ id: 'comeback', text: 'WHAT A COMEBACK', lines: ['WHAT A', 'COMEBACK'], voice: 'm-comeback' });
  return tags;
}

// The events of a state that have not been played yet (seq above the last one seen).
export function unseenEvents(m, lastSeq) {
  return (Array.isArray(m && m.events) ? m.events : []).filter((e) => e && typeof e.seq === 'number' && e.seq > lastSeq).sort((a, b) => a.seq - b.seq);
}

// A ball of the catalogue (GET /api/arcade -> powerups) for the chest, with fallbacks.
const RARITY_COLOR = { common: '#cfd6dd', rare: '#5ab8ff', epic: '#c878ff', legendary: '#ffd21f' };
export function ballInfo(id, catalogue) {
  const c = (catalogue || []).find((x) => x && x.id === id) || {};
  const name = c.name || String(id).replace(/[-_]/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());
  // the catalogue's colour is the trail's: a number (0xff5b5f) or already a CSS colour
  const color = typeof c.color === 'number' ? `#${(c.color & 0xffffff).toString(16).padStart(6, '0')}` : c.color;
  return { id, name, emoji: c.emoji || '', rarity: c.rarity || 'common', kind: c.kind || 'ball', color: color || RARITY_COLOR[c.rarity] || '#ffd21f' };
}

// ---------------------------------------------------------------- little pieces of markup

const trophySvg = '<svg class="mt-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4.5h8v5a4 4 0 0 1-8 0z"/><path d="M8 6.5H4.5a3 3 0 0 0 3.6 3.4M16 6.5h3.5a3 3 0 0 1-3.6 3.4"/><path d="M12 13.5V17M8.5 19.5h7M10 17h4"/></svg>';
const RING_R = 21;
const RING_LEN = 2 * Math.PI * RING_R;
const SHOT_CLOCK_S = 0;   // no shot clock by default: nothing times or hurries a player setting up over a real ball (the ring stays an option: shotClock > 0)
const PICK_KEY = 'open-birdie.match.pick';

// a line of huge text that sizes itself to its length (--n: characters)
const big = (text, cls = '', extra = '') => `<span class="mt-x ${cls}" style="--n:${Math.max(3, String(text).length)}${extra ? `;${extra}` : ''}">${esc(text)}</span>`;
const bgHalves = (cls = '') => `<div class="mt-bg ${cls}" aria-hidden="true"><i class="mt-half mt-hl"></i><i class="mt-half mt-hr"></i><i class="mt-slash"></i><i class="mt-dots"></i></div>`;
const profileChip = (pr) => {
  if (!pr) return '';
  const rank = rankText(pr.rank);
  const rec = pr.wins != null || pr.losses != null ? `<span class="mt-rec">${fmt(pr.wins)}W ${fmt(pr.losses)}L</span>` : '';
  return `<span class="mt-chip">${rank ? `<b class="mt-rank">${esc(rank)}</b>` : ''}<span class="mt-tro">${trophySvg}${fmt(pr.trophies)}</span>${rec}${pr.streak > 1 ? `<span class="mt-streak">${fmt(pr.streak)} IN A ROW</span>` : ''}</span>`;
};
const pips = (won, target, cls = '') => (target > 1
  ? `<span class="mt-pips ${cls}" aria-label="${won} of ${target}">${Array.from({ length: target }, (_, i) => `<i class="${i < won ? 'on' : ''}"></i>`).join('')}</span>` : '');
const stageFacts = (st) => [st.par ? `PAR ${st.par}` : '', st.lengthYd ? `${Math.round(st.lengthYd)} YD` : ''].filter(Boolean).join(' · ');
const themeStyle = (st) => { const t = themeOf(st); return `--ta:${t.a};--tb:${t.b};--tg:${t.glow}`; };
// v2:wind the wind arrow: drawn pointing up the screen (toward the pin), turned by arrowDeg
const windArrow = (deg) => (deg == null ? '<i class="mt-wind-dot" aria-hidden="true"></i>'
  : `<svg class="mt-wind-arrow" viewBox="0 0 24 24" aria-hidden="true" style="transform:rotate(${Math.round(deg)}deg)"><path d="M12 1.5l7.5 9.5h-4.7V22.5H9.2V11H4.5z"/></svg>`);
const windKey = (v) => (v ? `${v.known ? 1 : 0}|${v.num}|${v.arrowDeg}|${v.lines.join('/')}` : '');
// the inside of the intro's WIND chip: the dial (a pin at the top: that way is the hole), the speed, the read
const windInner = (v, pop = false) => `
  <span class="mt-wind-dial ${pop ? 'mt-wind-swing' : ''}" aria-hidden="true"><i class="mt-wind-pin"></i>${v.known ? windArrow(v.arrowDeg) : '<b class="mt-wind-q">?</b>'}</span>
  <span class="mt-wind-c"><span class="mt-wind-n ${pop ? 'mt-wind-pop' : ''}"><b>${esc(v.num)}</b><em>MPH</em></span>
  <span class="mt-wind-l">${v.lines.map((l) => `<b>${esc(l)}</b>`).join('')}</span></span>`;
const windChip = (wind) => {
  const v = windView(wind);
  if (!v) return '<div class="mt-wind hidden" data-k=""><span class="mt-wind-k">WIND</span><div class="mt-wind-body"></div></div>';
  return `<div class="mt-wind mt-wind-${v.tone}" data-k="${esc(windKey(v))}" aria-label="Wind: ${esc(v.text)}"><span class="mt-wind-k">WIND</span><div class="mt-wind-body">${windInner(v)}</div></div>`;
};
// the header's small, persistent wind badge: the arrow and the speed
const windBadge = (wind) => {
  const v = windView(wind);
  return v && v.known ? `<span class="mt-mid-wind mt-wind-${v.tone}" title="Wind: ${esc(v.text)}">${windArrow(v.arrowDeg)}<b>${esc(v.num)}</b><em>MPH</em></span>` : '';
};

// ---------------------------------------------------------------- confetti (a canvas, bounded bursts)

class Confetti {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = null;
    this.parts = [];
    this.raf = 0;
    this.last = 0;
    this._frame = (t) => this._step(t);
  }
  _fit() {
    const c = this.canvas;
    const w = Math.max(1, Math.round(c.clientWidth)), h = Math.max(1, Math.round(c.clientHeight));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    this.ctx = this.ctx || c.getContext('2d');
  }
  // x, y: 0..1 of the canvas; angle in degrees (0: right, -90: up)
  burst({ x = 0.5, y = 0.5, n = 80, colors = ['#fff'], angle = -90, spread = 60, power = 1 } = {}) {
    this.canvas.classList.remove('hidden');
    this._fit();
    const W = this.canvas.width, H = this.canvas.height;
    for (let i = 0; i < n; i++) {
      const a = (angle + (Math.random() - 0.5) * spread) * Math.PI / 180;
      const v = (0.55 + Math.random() * 0.75) * H * 1.15 * power;
      this.parts.push({
        x: x * W, y: y * H, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        w: 8 + Math.random() * 12, h: 5 + Math.random() * 9, rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 14,
        ph: Math.random() * 6.28, color: colors[(Math.random() * colors.length) | 0], life: 0, ttl: 3.2 + Math.random() * 2.2,
      });
    }
    if (this.parts.length > 700) this.parts.splice(0, this.parts.length - 700);
    if (!this.raf) { this.last = 0; this.raf = requestAnimationFrame(this._frame); }
  }
  _step(t) {
    const dt = this.last ? Math.min(0.05, (t - this.last) / 1000) : 0.016;
    this.last = t;
    const { ctx, canvas } = this;
    const H = canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, H);
    const g = H * 1.5;
    this.parts = this.parts.filter((p) => {
      p.life += dt;
      p.vy += g * dt;
      p.vx *= 1 - 1.4 * dt;
      p.vy *= 1 - 0.9 * dt;
      p.x += (p.vx + Math.sin(p.life * 5 + p.ph) * 60) * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      if (p.life > p.ttl || p.y > H + 40) return false;
      const fade = Math.min(1, (p.ttl - p.life) / 0.6);
      ctx.globalAlpha = fade;
      ctx.setTransform(Math.cos(p.rot), Math.sin(p.rot), -Math.sin(p.rot) * Math.cos(p.life * 7 + p.ph), Math.cos(p.rot) * Math.cos(p.life * 7 + p.ph), p.x, p.y);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      return true;
    });
    if (this.parts.length) this.raf = requestAnimationFrame(this._frame);
    else this.clear();
  }
  clear() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.parts = [];
    if (this.ctx) { this.ctx.setTransform(1, 0, 0, 1, 0, 0); this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height); }
    this.canvas.classList.add('hidden');
  }
}

async function defaultFetchJson(url, init) {
  const r = await fetch(url, init);
  return r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }));
}

// ---------------------------------------------------------------- the UI

export class MatchUI {
  // hud: the element to build in (the app's #hud)
  // fetchJson(url, init?) -> the parsed JSON body (null / {ok: false, error} on failure)
  // toast(main, sub): the app's HUD message, for errors
  // audio: the ArcadeAudio (say / cue / stopVoice), or null: every call is guarded
  // shotClock: seconds on the ring of whoever is up (cosmetic; 0: no ring)
  // catalogue: the arcade power-ups (GET /api/arcade -> powerups); fetched when not given
  constructor({ hud, fetchJson = defaultFetchJson, toast = () => {}, audio = null, shotClock = SHOT_CLOCK_S, catalogue = null } = {}) {
    this.hud = hud || document.body;
    this.fetchJson = fetchJson;
    this.toast = toast;
    this.audio = audio;
    this.shotClock = Math.max(0, +shotClock || 0);
    this.shell = false;       // v2:shell set by the game product's front end (arcade/shell.js): the match menu's way out reads EXIT TO MAIN MENU
    this.catalogue = Array.isArray(catalogue) ? catalogue : null;
    this.players = [];        // the roster: [{id, name, handicap, initials}]
    this.profiles = {};       // {playerId: {trophies, rank, wins, losses, streak}} from GET /api/match
    this.tour = null;         // the tour manifest
    this.tiers = TIER_FALLBACK;
    this.match = null;        // the last match state from the server (null: none)
    this.pick = { a: null, b: null, format: 'quick', stage: 'random', tieRule: 'shootout', powerups: 'loadout', order: 'tour', hazardLosesHole: false, stakes: null, putting: 'assist' };
    try { Object.assign(this.pick, JSON.parse(localStorage.getItem(PICK_KEY) || '{}')); } catch (_) { /* first time, or private mode */ }
    this.lobbyUi = { open: false, picker: null, drawer: false, busy: false, fresh: false, error: '' };
    this.reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    this._mem = {};           // what this match has already shown (intro keys, result keys ...)
    this._lastSeq = 0;
    this._screenKind = null;
    this._steps = [];
    this._stepTimers = new Set();
    this._timers = new Set();
    this._soundTimers = new Set();   // the few-frame offsets inside one sound moment
    this._bannerQ = [];
    this._bannerBusy = false;
    this._clock = { key: null, start: 0 };
    this._clockTimer = null;

    this.root = document.createElement('div');
    this.root.className = 'mt-root hidden';
    this.root.innerHTML = `
      <div class="mt-hdr hidden" aria-live="polite"></div>
      <div class="mt-ticker hidden" aria-live="polite"></div>
      <div class="mt-banner hidden" aria-live="assertive"></div>
      <div class="mt-screen hidden"></div>
      <canvas class="mt-confetti hidden" aria-hidden="true"></canvas>`;
    this.hud.appendChild(this.root);
    this.header = this.root.querySelector('.mt-hdr');
    this.ticker = this.root.querySelector('.mt-ticker');
    this.banner = this.root.querySelector('.mt-banner');
    this.screen = this.root.querySelector('.mt-screen');
    this.confetti = new Confetti(this.root.querySelector('.mt-confetti'));
    // v2:menu the match menu (a pause panel over everything of the match), the MENU chip that
    // floats over the full-bleed match screens, and the stray-ball prompt
    this.menuUi = { open: false, ask: null, busy: false, key: '' };
    this.menuChip = Object.assign(document.createElement('button'), { type: 'button', className: 'mt-menu-chip hidden', innerHTML: '<i aria-hidden="true"></i>MENU<em>ESC</em>', title: 'Match menu: undo, restart, quit' });
    this.menuChip.dataset.mt = 'menu';
    this.strayEl = Object.assign(document.createElement('div'), { className: 'mt-stray hidden' });
    this.menuEl = Object.assign(document.createElement('div'), { className: 'mt-menu hidden' });
    this.root.append(this.menuChip, this.strayEl, this.menuEl);
    this._stray = null;
    this.root.addEventListener('click', (e) => { this._pickAt = performance.now(); this._click(e); });
    // v2:voice a tiny tick as the pointer or the focus moves onto another lobby control (a run of them
    // sounds like a selector rolling: the audio engine varies each one). Never on top of a pick.
    this._hoverKey = null; this._pickAt = 0;
    const hoverTick = (e) => {
      if (this._screenKind !== 'lobby') return;
      const el = e.target && e.target.closest ? e.target.closest('[data-pick-player],[data-format],[data-stage],[data-opt],[data-mt]') : null;
      const key = el ? `${el.dataset.pickPlayer || ''}|${el.dataset.format || ''}|${el.dataset.stage || ''}|${el.dataset.opt || ''}${el.dataset.val || ''}|${el.dataset.mt || ''}${el.dataset.slot || ''}` : null;
      if (key === this._hoverKey) return;
      this._hoverKey = key;
      if (!key || el.disabled || performance.now() - this._pickAt < 350) return;
      this._cue('ui-tick', { intensity: 0.5 });
    };
    this.root.addEventListener('pointerover', hoverTick);
    this.root.addEventListener('focusin', hoverTick);
    this._onKey = (e) => this._key(e);
    document.addEventListener('keydown', this._onKey, true);
  }

  get active() { return !!(this.match && this.match.phase !== 'done'); }
  get lobbyOpen() { return this.lobbyUi.open; }
  get resultOpen() { return this._screenKind === 'winner' || this._screenKind === 'result'; }

  dispose() {
    document.removeEventListener('keydown', this._onKey, true);
    this._clearAll();
    this.root.remove();
  }

  // ---------- audio (never throws; audio may be null and methods may not exist yet) ----------
  _say(line, opts) { try { this.audio?.say?.(line, opts); } catch (_) { /* silent */ } }
  _cue(name, opts) { try { this.audio?.cue?.(name, opts); } catch (_) { /* silent */ } }
  _hush() { try { this.audio?.stopVoice?.(); } catch (_) { /* silent */ } }
  // One beat, one stack: at most one impact (the hit itself), one sting, one crowd reaction and
  // one voice line, fired on the frame the thing lands. audio.moment() sequences them when the
  // audio has it; otherwise the same cues go out a few frames apart.
  _moment({ impact = null, sting = null, crowd = null, say = null, priority = 1 } = {}) {
    try {
      if (typeof this.audio?.moment === 'function') { this.audio.moment({ impact, sting, crowd, say, priority }); return; }
    } catch (_) { return; }
    if (impact) this._cue(impact);
    if (sting) this._after(impact ? 80 : 0, () => this._cue(sting), this._soundTimers);
    if (crowd) this._after(250, () => this._cue(crowd), this._soundTimers);
    if (say) this._after(impact || sting ? 300 : 0, () => this._say(say, { priority }), this._soundTimers);
  }

  // ---------- timers ----------
  _after(ms, fn, set = this._timers) {
    const h = setTimeout(() => { set.delete(h); fn(); }, Math.max(0, ms));
    set.add(h);
    return h;
  }
  _clearSet(set) { for (const h of set) clearTimeout(h); set.clear(); }

  // ---------- data in ----------
  // the roster (GET /api/leagues -> players), for the lobby
  setPlayers(list) {
    this.players = Array.isArray(list) ? list.map((p) => ({ ...p, initials: p.initials || initialsOf(p.name) })) : [];
    this._fixPick();
    if (this.lobbyOpen) this._renderLobby();
  }
  setCatalogue(list) { if (Array.isArray(list)) this.catalogue = list; }
  _fixPick() {
    const has = (id) => this.players.some((p) => p.id === id);
    if (!has(this.pick.a)) this.pick.a = this.players[0]?.id ?? null;
    if (!has(this.pick.b) || this.pick.b === this.pick.a) this.pick.b = this.players.find((p) => p.id !== this.pick.a)?.id ?? null;
  }
  _savePick() { try { localStorage.setItem(PICK_KEY, JSON.stringify(this.pick)); } catch (_) { /* private mode */ } }

  // the 'match' SSE event: the match's state (null when none is running)
  onMatch(state) {
    const m = state && state.id && !state.aborted ? state : null;
    const prev = this.match;
    // a match the server had to abandon (a stage that would not load) says why
    if (state && state.aborted && state.error && prev && prev.id === state.id) this.toast('Match abandoned', state.error);
    if (!m) {
      this.match = null;
      this._clearAll();
      if (this.lobbyOpen) this._renderLobby();
      this._sync();
      return;
    }
    if (prev && prev.id === m.id && typeof m.seq === 'number' && typeof prev.seq === 'number' && m.seq < prev.seq) return;   // stale
    const fresh = !prev || prev.id !== m.id;
    if (fresh) this._beginMatch(m);
    this.match = m;
    const evs = unseenEvents(m, this._lastSeq);
    for (const e of m.events || []) if (typeof e.seq === 'number') this._lastSeq = Math.max(this._lastSeq, e.seq);
    for (const e of evs) this._onEvent(e, m);
    this._direct(m, fresh ? null : prev);
    this._sync();
  }

  _beginMatch(m) {
    this._clearAll();
    this.lobbyUi.open = false;
    if (this._screenKind === 'lobby') this._hideScreen(false);
    this._mem = { base: {} };
    for (const p of m.players) this._mem.base[p.id] = clone(p.profile || this.profiles[p.id] || null);
    // a match met at its very start plays everything; one met in progress (a reload) is joined quietly
    const atStart = (m.phase === 'loading' || m.phase === 'intro') && !(m.holeResults || []).length;
    this._mem.vsDone = !atStart;
    this._lastSeq = atStart ? -1 : Math.max(-1, ...(m.events || []).map((e) => (typeof e.seq === 'number' ? e.seq : -1)));
    if (!this.catalogue) this._loadCatalogue();
  }
  async _loadCatalogue() {
    try {
      const a = await this.fetchJson('/api/arcade');
      if (a && Array.isArray(a.powerups)) this.catalogue = a.powerups;
    } catch (_) { /* the chest falls back to ids */ }
  }

  _clearAll() {
    this._clearSet(this._timers);
    this._clearSet(this._soundTimers);
    this._clearSet(this._stepTimers);
    this._steps = [];
    this._dropBanners();
    this.banner.innerHTML = '';
    clearTimeout(this._hdrLeave);
    this.header.className = 'mt-hdr hidden';
    this.ticker.className = 'mt-ticker hidden';
    this._stopClock();
    this.confetti.clear();
    if (this._screenKind && this._screenKind !== 'lobby') this._hideScreen(false);
    this._mem = {};
  }

  show() { this.root.classList.remove('hidden'); }
  hide() { this.root.classList.add('hidden'); }
  // the root is on screen while there is anything in it to see
  _sync() { this.root.classList.toggle('hidden', !(this.match || this.lobbyOpen || this._screenKind)); this._syncMenu(); /* v2:menu */ }

  // ---------- events (each once, by seq) ----------
  _onEvent(e, m) {
    switch (e.type) {
      case 'coin-flip': this._mem.coin = e.winnerId ?? e.playerId ?? null; break;
      case 'hole-won': this._mem.clutch = e.clutch === 'win' ? (e.holeNumber ?? true) : null; this._mem.tiedUp = null; break;   // v2:stake the ball that dropped was FOR THE WIN
      case 'hole-tied': this._mem.tiedUp = e.clutch === 'tie' ? e.playerId : null; this._mem.clutch = null; break;               // v2:stake ... or TO TIE
      case 'turn': this._mem.tiedUp = null; break;                                                                                 // v2:stake
      case 'stray-shot': this._strayShow(m, e); break;                 // v2:menu
      case 'shot-undone': this._rewound(m, 'undo', e); break;           // v2:menu
      case 'hole-restarted': this._rewound(m, 'restart', e); break;     // v2:menu
      case 'match-point': this._mem.mpDue = true; break;
      case 'tiebreak-shot': this._mem.pop = e.playerId || null; break;
      case 'tiebreak-again':
        this._flash({ kicker: 'SUDDEN DEATH', text: 'AGAIN!', sub: 'STILL NOTHING IN IT. ONE MORE BALL EACH.', tone: 'again', delay: 900, ms: 2000, onShow: () => this._cue('whoosh') });
        break;
      case 'trick-cast': {
        const target = playerOf(m, e.targetId);
        const b = ballInfo(e.id, this.catalogue);
        this._flash({ kicker: 'SABOTAGE!', text: b.name.toUpperCase(), sub: target ? `ON ${shout(target.name)}'S NEXT SWING` : '', tone: 'trick', ms: 1900 });
        break;
      }
      default: break;   // the rest is shown from the state itself
    }
  }

  // ---------- the director: which screen for this state ----------
  _direct(m, prev) {
    switch (m.phase) {
      case 'loading':
      case 'intro':
        this._hidePlay();
        this._intro(m);
        break;
      case 'play':
      case 'tiebreak':
        this._endIntro();
        this._play(m, prev);
        break;
      case 'hole-result':
        this._holeResult(m, prev);
        break;
      case 'done':
        this._done(m, prev);
        break;
      default: break;
    }
  }

  _hidePlay() {
    const h = this.header, t = this.ticker;
    if (!h.classList.contains('hidden') && !h.classList.contains('mt-leave') && !this.reduced) {
      h.classList.add('mt-leave'); t.classList.add('mt-leave');
      clearTimeout(this._hdrLeave);
      this._hdrLeave = setTimeout(() => { h.classList.add('hidden'); t.classList.add('hidden'); h.classList.remove('mt-leave'); t.classList.remove('mt-leave'); }, 260);
    } else if (!h.classList.contains('mt-leave')) {
      h.classList.add('hidden'); t.classList.add('hidden');
    }
    this._stopClock();
    this._dropBanners();
    this._mem.hdrVals = null;
  }

  // ---------- full-bleed screens ----------
  _show(kind, html, { style = '' } = {}) {
    clearTimeout(this._outTimer);
    const s = this.screen;
    // one screen replacing another cuts over ink: the game never flashes through between them
    const swap = !!this._screenKind && !(this._screenKind === 'lobby' && kind === 'lobby') || (kind === 'lobby' && s.classList.contains('mt-swap'));
    s.className = `mt-screen mt-s-${kind}${swap ? ' mt-swap' : ''}`;
    s.setAttribute('style', style);
    s.innerHTML = html;
    this._screenKind = kind;
    this._sync();
  }
  _hideScreen(wipe = true) {
    if (!this._screenKind) return;
    this._screenKind = null;
    clearTimeout(this._outTimer);
    const s = this.screen;
    const gone = () => { s.className = 'mt-screen hidden'; s.innerHTML = ''; this._sync(); };
    if (!wipe || this.reduced) { gone(); return; }
    s.classList.remove('mt-swap');
    s.classList.add('mt-out');
    this._outTimer = setTimeout(gone, 430);
  }
  _shake(el = this.screen) {
    if (this.reduced || !el) return;
    el.classList.remove('mt-shake');
    void el.offsetWidth;
    el.classList.add('mt-shake');
  }

  // ---------- intro: VS (first hole), stage intro (every hole), sudden death ----------
  _intro(m) {
    const key = introKey(m);
    if (this._mem.introKey !== key) {
      this._mem.introKey = key;
      this._mem.introDone = false;
      this._mem.readySent = false;
      this._mem.windAt = 0; this._mem.windHeld = false;   // v2:wind
      this._clearSet(this._timers);
      this.confetti.clear();
      const st = introStage(m);
      const steps = [];
      if (st && st.kind === 'tiebreak') steps.push('sudden');
      else { if (!this._mem.vsDone) steps.push('vs'); steps.push('stage'); }
      this._steps = steps;
      this._nextStep();
    } else if (this._mem.introDone) {
      this._syncWind(m);   // v2:wind
      this._maybeReady();
    } else {
      this._syncWind(m);   // v2:wind
    }
  }
  // v2:wind The wind is rolled when the stage's course comes up, which can be after its intro
  // began: the chip shows the range until then, and the roll lands on it (the number pops,
  // the arrow swings round to its bearing).
  _syncWind(m) {
    if (this._screenKind !== 'stage' && this._screenKind !== 'sudden') return;
    const el = this.screen.querySelector('.mt-wind');
    const st = introStage(m);
    const v = windView(st && st.wind);
    if (!el || !v || el.dataset.k === windKey(v)) return;
    const landed = v.known && !/^1\|/.test(el.dataset.k || '');
    el.className = `mt-wind mt-wind-${v.tone}`;
    el.dataset.k = windKey(v);
    el.setAttribute('aria-label', `Wind: ${v.text}`);
    el.querySelector('.mt-wind-body').innerHTML = windInner(v, landed && !this.reduced);
    if (landed) this._mem.windAt = Date.now();
  }
  _nextStep() {
    this._clearSet(this._stepTimers);
    const m = this.match;
    const step = this._steps.shift();
    if (!m || !step) {
      if (m && !this._mem.introDone) { this._mem.introDone = true; this._maybeReady(); }
      return;
    }
    const ms = step === 'vs' ? this._screenVs(m) : step === 'sudden' ? this._screenSudden(m) : this._screenStage(m);
    this._after(this.reduced ? Math.min(ms, 2600) : ms, () => this._nextStep(), this._stepTimers);
  }
  // the intro screens are over: tee off as soon as the server has the course loaded
  _maybeReady() {
    const m = this.match;
    if (!m || !this._mem.introDone) return;
    if (m.phase === 'intro') {
      this.screen.classList.remove('mt-waiting');
      if (this._mem.readySent) return;
      // v2:wind a roll that landed as the intro was ending stays up long enough to be read
      const hold = (this._mem.windAt || 0) + 1300 - Date.now();
      if (hold > 0) {
        if (!this._mem.windHeld) { this._mem.windHeld = true; this._after(hold + 20, () => this._maybeReady()); }
        return;
      }
      this._mem.readySent = true;
      const key = this._mem.introKey;
      this._post('/api/match/ready', {});
      // once more if the server did not hear it (it readies itself after 25 s anyway)
      this._after(5000, () => {
        if (this.match && this.match.phase === 'intro' && this._mem.introKey === key) this._post('/api/match/ready', {}, { quiet: true });
      });
    } else if (m.phase === 'loading') {
      this.screen.classList.add('mt-waiting');   // the course is still loading: a quiet pill, the screen stays
    }
  }
  _endIntro() {
    if (!['vs', 'stage', 'sudden', 'result'].includes(this._screenKind)) return;
    this._clearSet(this._stepTimers);
    this._steps = [];
    this._mem.introDone = true;
    const wasIntro = this._screenKind !== 'result';
    this._hideScreen(true);
    this._cue(wasIntro ? 'tee-off' : 'whoosh');   // v2:voice the doors open on the hole: a short "go" hit as play begins
  }
  _skipIntro() {
    if (!this._steps.length && this._mem.introDone) return;
    this._hush();
    this._clearSet(this._soundTimers);
    this._cue('ui-tick');
    this._nextStep();
  }

  _screenVs(m) {
    this._mem.vsDone = true;
    const [a, b] = bySlot(m);
    const f = formatOf(m.format);
    const coinId = this._mem.coin ?? m.honourId ?? m.currentPlayerId ?? a.id;
    const first = playerOf(m, coinId) || a;
    const firstSlot = slotOf(m, first.id);
    const side = (p, slot) => `
      <div class="mt-vs-p mt-p${slot}">
        <span class="mt-slot">PLAYER ${slot}</span>
        ${big(shout(p.name), 'mt-vs-name')}
        ${profileChip(p.profile || this.profiles[p.id])}
      </div>`;
    this._show('vs', `
      ${bgHalves()}
      <div class="mt-vs-format"><b>${esc(m.formatLabel ? String(m.formatLabel).toUpperCase() : f.label)}</b><span>${f.target > 1 ? `FIRST TO ${m.target || f.target}` : 'ONE HOLE. WINNER TAKES IT.'}</span>${m.stakes ? `<span class="mt-pot">POT ${fmt(m.stakes.pot)}</span>` : ''}</div>
      ${side(a, 1)}
      ${side(b, 2)}
      <div class="mt-vs-badge" aria-hidden="true"><span class="mt-x">VS</span></div>
      <div class="mt-coin-row mt-first-${firstSlot}">
        <div class="mt-coin" aria-hidden="true"><i class="mt-coin-f mt-coin-1">1</i><i class="mt-coin-f mt-coin-2">2</i></div>
        <div class="mt-coin-text"><span>COIN FLIP</span><b>${esc(shout(first.name))} TEES OFF FIRST</b></div>
      </div>
      <span class="mt-skip">ANY KEY TO SKIP</span>`);
    // sound: the wipe, then the slam on the frame the VS badge lands as the two panels meet,
    // then (a beat later, with the ribbon) the format; then the coin: its flick and ringing spin as it
    // leaves the thumb (the CSS flip runs 1.75 s to 3.2 s) and the slap as it lands with the result
    this._cue('whoosh');
    if (!this.reduced) this._after(1750, () => this._cue('coin-flip'), this._stepTimers);   // v2:voice
    this._after(this.reduced ? 1100 : 3200, () => this._cue('coin-land'), this._stepTimers);   // v2:voice
    this._after(520, () => { this._shake(); this._moment({ impact: 'vs-slam', say: 'm-versus' }); }, this._stepTimers);
    this._after(1700, () => this._say(f.voice), this._stepTimers);
    this._after(this.reduced ? 0 : 3250, () => this.screen.classList.add('mt-coin-done'), this._stepTimers);
    return 4100;
  }

  _screenStage(m) {
    const st = introStage(m) || { name: 'NEXT HOLE', kind: 'match' };
    const [a, b] = bySlot(m);
    const n = introHoleNumber(m);
    const f = formatOf(m.format);
    const max = m.maxHoles || f.holes;
    const last = max > 1 && n >= max;
    const hon = playerOf(m, m.honourId ?? m.currentPlayerId);
    const tourEntry = ((this.tour && this.tour.stages) || []).find((x) => x.id === st.id) || {};
    const freeId = st.freeBall || tourEntry.freeBall || null;
    const free = freeId ? ballInfo(freeId, this.catalogue) : null;
    const routes = stageRoutes(st.routes ? st : tourEntry);
    const diff = st.difficulty ? `<span class="mt-diff" aria-label="Difficulty ${st.difficulty} of 3">${[1, 2, 3].map((i) => `<i class="${i <= st.difficulty ? 'on' : ''}"></i>`).join('')}</span>` : '';
    this._show('stage', `
      <div class="mt-bg mt-stage-bg" aria-hidden="true"><i class="mt-stage-sky"></i>${silhouette(st.theme)}<i class="mt-stage-slab"></i><i class="mt-dots"></i></div>
      <div class="mt-stage-no" aria-hidden="true">${String(n).padStart(2, '0')}</div>
      <div class="mt-stage-top">
        <span class="mt-tag">${max > 1 ? `HOLE ${n} OF ${max}` : 'QUICK MATCH'}</span>
        ${last ? '<span class="mt-tag mt-tag-hot">FINAL HOLE</span>' : ''}
        ${m.matchPoint ? '<span class="mt-tag mt-tag-hot">MATCH POINT</span>' : ''}
      </div>
      <div class="mt-stage-main">
        <span class="mt-stage-kicker">HOLE ${n}</span>
        ${big(String(st.name || '').toUpperCase(), 'mt-stage-name')}
        <div class="mt-stage-facts">${st.par ? `<b>PAR ${esc(st.par)}</b>` : ''}${st.lengthYd ? `<b>${Math.round(st.lengthYd)} YD</b>` : ''}${diff}</div>
        ${st.blurb ? `<p class="mt-stage-blurb">${esc(st.blurb)}</p>` : ''}
        ${routes.length ? `<div class="mt-routes">${routes.map((r, i) => `<span class="mt-route mt-route-${r.id}" style="--d:${(0.95 + i * 0.13).toFixed(2)}s"><b>${r.label}</b><em>${esc(r.name)}</em></span>`).join('')}</div>` : ''}
      </div>
      ${free ? `<div class="mt-rocket" style="--c:${esc(free.color)}"><i aria-hidden="true">${esc(free.emoji || '🚀')}</i>${big(`${ballWord(free.id)} HOLE`, 'mt-rocket-t')}<span>FREE ${esc(ballWord(free.id))} BALL ON THE TEE</span></div>` : ''}
      ${windChip(st.wind || tourEntry.wind) /* v2:wind */}
      <div class="mt-stage-foot">
        <div class="mt-series">
          <span class="mt-series-p mt-p1">${esc(shout(a.name))}</span>
          <b class="mt-series-n"><i class="mt-p1">${a.holesWon || 0}</i><em>–</em><i class="mt-p2">${b.holesWon || 0}</i></b>
          <span class="mt-series-p mt-p2">${esc(shout(b.name))}</span>
        </div>
        ${hon ? `<span class="mt-honour mt-p${slotOf(m, hon.id)}"><i></i>${esc(shout(hon.name))} TEES OFF</span>` : ''}
      </div>
      <div class="mt-ready"><i></i></div>
      <span class="mt-loading">LOADING THE COURSE</span>
      <span class="mt-skip">ANY KEY TO SKIP</span>`, { style: themeStyle(st) });
    const ms = this._mem.stageShown ? 4000 : 3600;   // hole one follows the VS screen: under 9 s from START to the tee
    this._mem.stageShown = true;
    this.screen.style.setProperty('--ms', `${ms}ms`);
    const line = [];
    if (last) line.push('m-final-hole'); else if (n >= 1 && n <= 9) line.push(`m-hole-${n}`);
    if (st.id) line.push(`stage-${st.id}`);
    this._moment({ impact: 'whoosh', say: line.length ? line : null });   // the wipe, and the announcer names the hole
    // v2:voice the stage name slams in (.34 s + .5 s in match.css): one hit as it lands, the stage's own if it has one
    this._after(this.reduced ? 0 : 700, () => this._cue(/^[a-z]+$/.test(st.theme || '') ? `stage-sting-${st.theme}` : 'stage-sting'), this._stepTimers);
    // a rocket hole is its own beat: the stamp lands, the ball arms, the announcer shouts its name
    if (free) this._after(1480, () => { this._shake(); this._moment({ impact: 'arm-epic', say: `pu-${free.id}` }); }, this._stepTimers);
    return ms;
  }

  _screenSudden(m) {
    const st = introStage(m) || {};
    const [a, b] = bySlot(m);
    const round = (m.tiebreak && m.tiebreak.round) || 1;
    this._show('sudden', `
      <div class="mt-bg mt-sd-bg" aria-hidden="true"><i class="mt-sd-slash mt-sd-1"></i><i class="mt-sd-slash mt-sd-2"></i><i class="mt-dots"></i></div>
      <div class="mt-sd-main">
        <span class="mt-x mt-sd-a">SUDDEN</span>
        <span class="mt-x mt-sd-b">DEATH</span>
        <span class="mt-sd-ctp">CLOSEST TO THE PIN</span>
      </div>
      <div class="mt-sd-arena" style="${themeStyle(st)}">
        <span>THE ARENA${round > 1 ? ` · ROUND ${round}` : ''}</span>
        <b>${esc(String(st.name || 'THE SHOOTOUT').toUpperCase())}</b>
        <em>${[stageFacts(st), 'ONE BALL EACH', 'NEAREST WINS'].filter(Boolean).join(' · ')}</em>
      </div>
      <div class="mt-sd-vs"><b class="mt-p1">${esc(shout(a.name))}</b><i>VS</i><b class="mt-p2">${esc(shout(b.name))}</b></div>
      ${windChip(st.wind) /* v2:wind */}
      <span class="mt-loading">LOADING THE ARENA</span>
      <span class="mt-skip">ANY KEY TO SKIP</span>`);
    // sound: one drumroll into the reveal, the words slam on its end, then the rule
    this._cue('drumroll');
    this._after(1380, () => { this._shake(); this._say('m-sudden-death', { priority: 2 }); }, this._stepTimers);
    this._after(2350, () => this._say('m-closest-to-the-pin'), this._stepTimers);
    return 4300;
  }

  // ---------- in play: header, ticker, turn banner, match point ----------
  _play(m, prev) {
    this._renderHeader(m);
    this._renderTicker(m);
    this._syncClock();
    const up = playerOf(m, m.currentPlayerId);
    const holeKey = `${m.id}|${m.phase}|${(m.holeResults || []).length}`;
    const afterShot = !!(prev && prev.phase === m.phase && this._mem.holeKey === holeKey);
    if (this._mem.holeKey !== holeKey) {
      this._mem.holeKey = holeKey;
      this._mem.turnKey = null;
      if (m.phase === 'play' && m.matchPoint) this._mem.mpDue = true;
    }
    // let the shot's own banner (the arcade HUD) have its moment before the next one
    let delay = afterShot ? 1700 : 480;
    if (this._mem.mpDue && m.phase === 'play' && m.matchPoint) {
      this._mem.mpDue = false;
      const who = m.matchPoint === 'both' ? null : playerOf(m, m.matchPoint);
      this._flash({
        kicker: who ? shout(who.name) : 'NEXT HOLE WINS', text: 'MATCH POINT', tone: who ? `p${slotOf(m, who.id)}` : 'gold', delay, ms: 1700,
        onShow: () => this._moment({ impact: 'whoosh', say: 'm-match-point' }),
      });
      delay = 150;
    } else {
      this._mem.mpDue = false;
    }
    if (!up) return;
    const turnKey = `${holeKey}|${(m.tiebreak && m.tiebreak.round) || 0}|${up.id}|${up.mustHole ? 1 : 0}|${up.shotFor || ''}|${up.shotKind || ''}`;   // v2:stake a new stake is a new banner
    if (turnKey === this._mem.turnKey) return;
    this._mem.turnKey = turnKey;
    const need = shotNeed(m, up);
    const slot = slotOf(m, up.id);
    this._flash({
      turn: true, kicker: `PLAYER ${slot}`, text: need.stake ? `${shout(up.name)}'S UP` : `${shout(up.name)}, YOU'RE UP` /* v2:stake */, sub: need.text, tone: `p${slot}`, need: need.tone, delay, ms: need.tone === 'must' || need.stake ? 3000 : 2500,
      onShow: () => {
        // v2:stake to win or to tie: one heartbeat, then the name and what it is for
        if (need.stake) { this._moment({ impact: 'heartbeat-hit', say: [voiceName(m, up), need.stake.voice], priority: 2 }); if (need.stake.for === 'tie') this._shake(this.banner); return; }
        const must = need.tone === 'must' && m.phase === 'play';
        this._moment({ impact: must ? 'heartbeat-hit' : 'turn-chime', say: [voiceName(m, up), must ? 'm-must-hole' : 'm-youre-up'] });
        if (need.tone === 'must') this._shake(this.banner);
      },
    });
  }

  _renderHeader(m, { final = null } = {}) {
    const h = this.header;
    const duel = m.phase === 'tiebreak' || !!final;
    const [a, b] = bySlot(m);
    const f = formatOf(m.format);
    const target = m.target || f.target;
    const dv = duel ? duelView(m) : null;
    const st = m.stage || {};
    const pop = this._mem.pop;
    this._mem.pop = null;
    const vals = {};
    const upNow = playerOf(m, m.currentPlayerId);
    const fogged = !!(upNow && upNow.cursedWith === 'fog' && !final);   // the fog trick: every yardage goes
    const clock = this.shotClock > 0
      ? `<svg class="mt-clock" viewBox="0 0 48 48" aria-hidden="true"><circle class="mt-clock-track" cx="24" cy="24" r="${RING_R}"/><circle class="mt-clock-ring" cx="24" cy="24" r="${RING_R}" stroke-dasharray="${RING_LEN.toFixed(2)}" stroke-dashoffset="0"/></svg>` : '';
    const side = (p, slot) => {
      const up = !final && p.id === m.currentPlayerId;
      let nums;
      const was = (this._mem.hdrVals || {})[p.id] || null;
      const dist = p.holed ? 'IN' : fogged ? '???' : toGoText(p.distToPinYd);
      vals[p.id] = { s: p.strokes || 0, d: dist, up };
      const bumpS = was && was.s !== (p.strokes || 0) ? 'mt-bump' : '';
      const bumpD = was && was.d !== dist ? 'mt-bump' : '';
      const turned = was && up && !was.up ? 'mt-turned' : '';
      if (dv) {
        const c = dv.cells[p.id] || { state: 'wait' };
        const txt = c.state === 'ft' ? ftText(c.ft) : c.state === 'in' ? 'IN!' : c.state === 'miss' ? 'MISS' : '– –';
        const sub = c.state === 'miss' ? (c.miss === 'water' ? 'IN THE WATER' : c.miss === 'ob' ? 'OUT OF BOUNDS' : 'NO DISTANCE') : c.state === 'wait' ? 'TO THE PIN' : 'TO THE PIN';
        nums = `<div class="mt-duel-n mt-d-${c.state} ${pop === p.id || final ? 'mt-pop' : ''}"><b>${esc(txt)}</b><span>${sub}</span></div>`;
      } else {
        nums = `<div class="mt-num"><b class="${bumpS}">${p.strokes || 0}</b><span>STROKES</span></div>
          <div class="mt-num mt-num-d"><b class="${bumpD}" ${fogged || p.holed ? '' : 'data-yardage'}>${esc(dist)}</b><span>TO PIN</span></div>`;
      }
      const tag = final ? (final === p.id ? '<span class="mt-uptag mt-wintag">CLOSER!</span>' : '')
        : up && stakeView(m, p) ? `<span class="mt-uptag mt-staketag mt-stake-${stakeView(m, p).for}">${stakeView(m, p).text}</span>`                              /* v2:stake */
          : this._mem.tiedUp === p.id && m.phase === 'hole-result' ? '<span class="mt-uptag mt-staketag mt-stake-tie mt-tiedup">TIED IT UP!</span>'   /* v2:stake */
        : p.mustHole && up ? '<span class="mt-uptag mt-musttag">MUST MAKE</span>'
          : up ? '<span class="mt-uptag">UP NOW</span>' : '';
      const armed = p.armedPowerup ? `<i class="mt-armed" title="Armed">${esc(ballInfo(p.armedPowerup, this.catalogue).emoji || '⚡')}</i>` : '';
      const cursed = p.cursedWith ? `<i class="mt-armed mt-cursed" title="Sabotaged">${esc(ballInfo(p.cursedWith, this.catalogue).emoji || '☠')}</i>` : '';
      return `<div class="mt-side mt-p${slot} ${up ? 'mt-up' : ''} ${turned} ${final && final === p.id ? 'mt-won' : ''} ${final && final !== p.id ? 'mt-lost' : ''}" data-player="${esc(p.id)}">
        <i class="mt-side-bg"></i>
        <span class="mt-badge">${up ? clock : ''}<b>P${slot}</b>${up && this.shotClock > 0 ? '<i class="mt-clock-s"></i>' : ''}</span>
        <div class="mt-side-body">
          <div class="mt-side-id"><span class="mt-side-name">${esc(shout(p.name))}</span>${armed}${cursed}${pips(p.holesWon || 0, target)}</div>
          <div class="mt-nums">${nums}</div>
        </div>
        ${tag}
      </div>`;
    };
    const n = m.holeNumber || (m.holeResults || []).length + 1;
    const mid = duel
      ? `<span class="mt-mid-top mt-mid-sd">SUDDEN DEATH</span><b class="mt-mid-big">RD ${dv.round}</b><span class="mt-mid-stage">${esc(String(st.name || 'CLOSEST TO THE PIN').toUpperCase())}</span>${windBadge(st.wind) /* v2:wind */}`
      : `<span class="mt-mid-top">${target > 1 ? `HOLE ${n}` : 'QUICK MATCH'}${st.par ? ` · PAR ${st.par}` : ''}</span>
         <b class="mt-mid-big">${target > 1 ? `${a.holesWon || 0}<i>–</i>${b.holesWon || 0}` : 'VS'}</b>
         <span class="mt-mid-stage">${esc(String(st.name || '').toUpperCase())}</span>${windBadge(st.wind) /* v2:wind */}`;
    clearTimeout(this._hdrLeave);
    this.ticker.classList.remove('mt-leave');
    this._mem.hdrVals = vals;
    const wasHidden = h.classList.contains('hidden') || h.classList.contains('mt-leave');
    h.className = `mt-hdr ${duel ? 'mt-duel' : ''} ${m.matchPoint && !duel ? 'mt-mp' : ''} ${wasHidden ? 'mt-enter' : ''}`;
    h.innerHTML = `${side(a, 1)}
      <div class="mt-mid">${mid}${final ? '' : '<button type="button" class="mt-concede" data-mt="concede" title="The player who is up concedes the match">CONCEDE</button>'}${final ? '' : '<button type="button" class="mt-menu-btn" data-mt="menu" title="Match menu: undo a shot, restart, quit (Esc or M)"><i aria-hidden="true"></i>MENU</button>' /* v2:menu */}</div>
      ${side(b, 2)}`;
    this._tick();
  }

  // the shot clock (cosmetic: nothing happens at zero)
  setShotClock(seconds) {
    this.shotClock = Math.max(0, +seconds || 0);
    const m = this.match;
    if (m && (m.phase === 'play' || m.phase === 'tiebreak')) { this._renderHeader(m); this._syncClock(); }
  }
  _syncClock() {
    const m = this.match;
    if (!m || !(m.phase === 'play' || m.phase === 'tiebreak') || !m.currentPlayerId || !(this.shotClock > 0)) { this._stopClock(); return; }
    const key = `${m.id}|${m.currentPlayerId}|${m.turnStartedAt}`;
    if (key !== this._clock.key) this._clock = { key, start: Date.now() };
    if (!this._clockTimer) this._clockTimer = setInterval(() => this._tick(), 250);
    this._tick();
  }
  _stopClock() {
    clearInterval(this._clockTimer);
    this._clockTimer = null;
    this._clock = { key: null, start: 0 };
  }
  _tick() {
    const ring = this.header.querySelector('.mt-up .mt-clock-ring');
    if (!ring || !this._clock.key) return;
    const left = Math.max(0, this.shotClock - (Date.now() - this._clock.start) / 1000);
    ring.style.strokeDashoffset = (RING_LEN * (1 - left / this.shotClock)).toFixed(2);
    const wrap = ring.closest('.mt-badge');
    wrap.classList.toggle('mt-low', left <= 10 && left > 0);
    wrap.classList.toggle('mt-out0', left <= 0);
    const s = wrap.querySelector('.mt-clock-s');
    if (s) s.textContent = left <= 10 ? `${Math.ceil(left)}` : '';
    const sec = Math.ceil(left);
    /* no countdown beeps: the players are setting up over a real ball */
  }

  _renderTicker(m) {
    const log = m.log || [];
    if (!log.length) { this.ticker.classList.add('hidden'); return; }
    const lastLine = log[log.length - 1];
    const text = typeof lastLine === 'string' ? lastLine : lastLine.text;
    const key = `${log.length}|${typeof lastLine === 'string' ? lastLine : lastLine.t}`;
    this.ticker.classList.remove('hidden');
    if (key === this._mem.logKey) return;
    this._mem.logKey = key;
    this.ticker.innerHTML = `<div class="mt-line">${esc(text)}</div>`;
  }

  // ---------- the banner layer: turn banners and flashes, one at a time, never clickable ----------
  _flash(item) {
    if (item.turn) {   // only the newest turn banner matters: one still waiting, or still up, makes way
      this._bannerQ = this._bannerQ.filter((x) => !x.turn);
      if (this._bannerCur && this._bannerCur.turn) { item.at = Date.now(); this._bannerQ.push(item); this._pumpBanner(); return; }
    }
    item.at = Date.now();
    this._bannerQ.push(item);
    if (!this._bannerBusy) this._pumpBanner();
  }
  _dropBanners() {
    this._bannerQ = [];
    this._bannerBusy = false;
    this._bannerCur = null;
    clearTimeout(this._bannerTimer);
    this.banner.classList.add('hidden');
  }
  _pumpBanner() {
    clearTimeout(this._bannerTimer);
    const it = this._bannerQ.shift();
    this._bannerCur = it || null;
    if (!it) { this._bannerBusy = false; this.banner.classList.add('hidden'); return; }
    this._bannerBusy = true;
    const showIt = () => {
      const el = this.banner;
      el.className = `mt-banner mt-b-${it.tone || 'gold'} ${it.turn ? 'mt-b-turn' : 'mt-b-flash'} ${it.need ? `mt-need-${it.need}` : ''}`;
      el.innerHTML = `<div class="mt-b-band"><i class="mt-b-bg"></i>
        ${it.kicker ? `<span class="mt-b-kicker">${esc(it.kicker)}</span>` : ''}
        ${big(it.text, 'mt-b-text')}
        ${it.sub ? `<span class="mt-b-sub">${esc(it.sub)}</span>` : ''}</div>`;
      try { it.onShow && it.onShow(); } catch (_) { /* a banner never breaks the match */ }
      const ms = this.reduced ? Math.min(it.ms || 2200, 1800) : (it.ms || 2200);
      this._bannerTimer = setTimeout(() => {
        el.classList.add('mt-b-out');
        this._bannerTimer = setTimeout(() => this._pumpBanner(), this.reduced ? 0 : 260);
      }, ms);
    };
    // the delay is counted from when it was asked for: time spent queued behind another banner is not added again
    const wait = Math.max(0, (it.delay || 0) - (Date.now() - (it.at || Date.now())));
    if (wait > 0) this._bannerTimer = setTimeout(showIt, wait); else showIt();
  }

  // ---------- hole result ----------
  _holeResult(m, prev) {
    const r = m.lastResult || (m.holeResults || [])[(m.holeResults || []).length - 1];
    if (!r) return;
    const key = `${m.id}|${r.holeNumber}|${r.reason}|${r.winnerId || ''}`;
    if (this._mem.resultKey === key) return;
    this._mem.resultKey = key;
    this._mem.continued = false;
    this._clearSet(this._stepTimers);
    this._steps = [];
    this._dropBanners();
    this._stopClock();
    const fromTiebreak = r.reason === 'tiebreak' && prev && prev.phase === 'tiebreak';
    const fromPlay = prev && prev.phase === 'play';
    if (fromTiebreak) this._duelFinale(m, r, () => this._screenResult(m, r));
    else if (fromPlay) { this._renderHeader(m); if (this._mem.tiedUp) this._renderTicker(m); this._after(this._mem.tiedUp ? 2000 : 1100 /* v2:stake TIED IT UP! */, () => this._screenResult(m, r)); }
    else this._screenResult(m, r);
  }
  // the second tiebreak ball has landed: the board shows both distances and who is closer
  _duelFinale(m, r, then) {
    // v2:final the deciding ball's own grade banner (the loser's MISS) sat behind the verdict
    // below for a second: the arcade's banner stage is out of sight from here until the
    // result screen covers it (match.css; a plain timer, so nothing can leave it hidden)
    if (this.hud && this.hud.classList) {
      const hud = this.hud;
      hud.classList.add('mt-finale');
      setTimeout(() => hud.classList.remove('mt-finale'), 3600);
    }
    this._renderHeader(m, { final: r.winnerId || m.winnerId });
    this._renderTicker(m);
    const w = playerOf(m, r.winnerId || m.winnerId);
    if (w) {
      const v = holeResultView(m, r);
      const mine = v && v.rows.find((x) => x.p.id === w.id);
      this._flash({ kicker: 'CLOSEST TO THE PIN', text: `${shout(w.name)} TAKES IT`, sub: mine && !mine.out ? mine.big : '', tone: `p${slotOf(m, w.id)}`, delay: 500, ms: 1700, onShow: () => this._cue('whoosh') });
    }
    this._after(2500, then);
  }

  _seriesBoard(m) {
    const [a, b] = bySlot(m);
    const f = formatOf(m.format);
    const max = m.maxHoles || f.holes;
    const res = m.holeResults || [];
    const cells = max > 1 ? Array.from({ length: max }, (_, i) => {
      const hr = res[i];
      const cls = !hr ? '' : hr.winnerId === a.id ? 'mt-p1 on' : hr.winnerId === b.id ? 'mt-p2 on' : 'mt-half-won on';
      return `<i class="${cls}">${i + 1}</i>`;
    }).join('') : '';
    return `<div class="mt-board">
      <div class="mt-board-row">
        <span class="mt-board-p mt-p1">${esc(shout(a.name))}</span>
        <b class="mt-board-n"><i class="mt-p1">${a.holesWon || 0}</i><em>–</em><i class="mt-p2">${b.holesWon || 0}</i></b>
        <span class="mt-board-p mt-p2">${esc(shout(b.name))}</span>
      </div>
      ${cells ? `<div class="mt-board-holes">${cells}</div>` : ''}
    </div>`;
  }

  _screenResult(m, r) {
    if (!this.match || this.match.id !== m.id) return;
    const v = holeResultView(m, r);
    if (!v) return;
    this._hidePlay();
    const ws = v.winner ? slotOf(m, v.winner.id) : 0;
    const f = formatOf(m.format);
    const ns = m.nextStage;
    const sd = v.kind === 'tied' || (ns && ns.kind === 'tiebreak');
    const next = sd
      ? `<div class="mt-next mt-next-sd"><span>NEXT</span><b>SUDDEN DEATH</b><em>${ns && ns.name ? esc([String(ns.name).toUpperCase(), ns.lengthYd ? `${Math.round(ns.lengthYd)} YD` : ''].filter(Boolean).join(' · ')) : 'CLOSEST TO THE PIN'}</em></div>`
      : ns ? `<div class="mt-next" style="${themeStyle(ns)}">${silhouette(ns.theme)}<span>NEXT · HOLE ${(m.holeResults || []).length + 1}${ns.freeBall ? ` · ${esc(ballWord(ns.freeBall))} HOLE` : ''}</span><b>${esc(String(ns.name || '').toUpperCase())}</b><em>${esc(stageFacts(ns))}</em></div>`
        : '';
    const mp = m.matchPoint ? `<span class="mt-tag mt-tag-hot">MATCH POINT${m.matchPoint !== 'both' && playerOf(m, m.matchPoint) ? `: ${esc(shout(playerOf(m, m.matchPoint).name))}` : ''}</span>` : '';
    const rowHtml = (x) => `<div class="mt-res-row mt-p${slotOf(m, x.p.id)} ${v.winner && x.p.id === v.winner.id ? 'mt-res-w' : ''} ${x.out ? 'mt-res-out' : ''} ${x.duel ? 'mt-res-duel' : ''}">
        <span class="mt-res-name">${esc(shout(x.p.name))}</span><b class="mt-res-big">${esc(x.big)}</b><span class="mt-res-lab">${esc(x.label)}</span></div>`;
    this._show('result', `
      ${bgHalves(`mt-res-bg mt-res-${v.kind} mt-win-${ws}`)}
      <div class="mt-res-top"><span class="mt-tag">HOLE ${esc(v.holeNumber ?? '')}${v.stageName ? ` · ${esc(String(v.stageName).toUpperCase())}` : ''}${v.par ? ` · PAR ${esc(v.par)}` : ''}</span>${mp}</div>
      <div class="mt-res-head mt-kind-${v.kind} mt-p${ws}">
        ${big(v.title, 'mt-res-title')}
        ${big(v.sub, 'mt-res-sub')}
        ${v.how ? `<span class="mt-res-how">${esc(v.how)}</span>` : ''}
      </div>
      <div class="mt-res-rows">${v.rows.map(rowHtml).join('')}</div>
      <div class="mt-res-foot">
        ${(m.target || f.target) > 1 ? this._seriesBoard(m) : '<div class="mt-board"></div>'}
        ${next}
        <button type="button" class="mt-btn mt-btn-go mt-continue" data-mt="continue"><span>${sd ? 'TO SUDDEN DEATH' : 'CONTINUE'}</span><i class="mt-count"></i></button>
      </div>`);
    this._clutchStamp(r);   // v2:stake
    const auto = 8000;
    this.screen.style.setProperty('--ms', `${auto}ms`);
    // sound: the wipe, then one stack on the frame the headline lands
    this._cue('whoosh');
    const LAND = 480;
    if (v.kind === 'knockout') {
      this._after(LAND, () => { this._shake(); this._moment({ sting: 'sting-knockout', say: 'm-knockout', priority: 2 }); }, this._stepTimers);
      this._after(1500, () => { this._burst(ws, 0.6); this._moment({ impact: 'confetti-pop', say: [voiceName(m, v.winner), 'm-wins-the-hole'] }); }, this._stepTimers);
    } else if (v.kind === 'win') {
      this._after(LAND, () => { this._burst(ws, 0.6); this._moment({ impact: 'confetti-pop', sting: 'fanfare-hole', say: [voiceName(m, v.winner), 'm-wins-the-hole'], priority: 2 }); }, this._stepTimers);
    } else {
      this._after(LAND, () => this._moment({ crowd: 'crowd-ohh', say: 'm-all-square', priority: 2 }), this._stepTimers);
    }
    this._after(auto, () => this._continue(false), this._stepTimers);
  }
  async _continue(pressed = false) {
    const m = this.match;
    if (!m || m.phase !== 'hole-result' || this._mem.continued) return;
    // v2:menu the result screen does not move on by itself while the menu is open or a stray ball
    // is being asked about: leaving it makes the hole final (nothing to undo any more)
    if (!pressed && (this.menuUi.open || this._stray)) { this._after(1500, () => this._continue(false), this._stepTimers); return; }
    this._mem.continued = true;
    if (pressed) this._cue('ui-confirm');
    this._clearSet(this._stepTimers);
    this.screen.classList.add('mt-going');
    const out = await this._post('/api/match/continue', {});
    if (!out) { this._mem.continued = false; this.screen.classList.remove('mt-going'); }
  }

  // confetti in a player's colours (slot 0: both)
  _burst(slot, power = 1) {
    if (this.reduced) return;
    const gold = ['#ffd21f', '#fff6c9', '#ffffff'];
    const colors = slot === 1 ? ['#ff5a36', '#ff9a4a', ...gold] : slot === 2 ? ['#2e9bff', '#7fd6ff', ...gold] : ['#ff5a36', '#2e9bff', ...gold];
    const n = Math.round(90 * power);
    this.confetti.burst({ x: 0.02, y: 1.02, angle: -62, spread: 34, n, colors, power });
    this.confetti.burst({ x: 0.98, y: 1.02, angle: -118, spread: 34, n, colors, power });
  }

  // ---------- the winner ----------
  _done(m, prev) {
    if (this._mem.doneKey === m.id) return;
    this._mem.doneKey = m.id;
    this._clearSet(this._stepTimers);
    this._steps = [];
    this._dropBanners();
    this._stopClock();
    const r = m.lastResult || (m.holeResults || [])[(m.holeResults || []).length - 1] || null;
    const live = !!prev;   // seen happening (not a reload onto a finished match)
    const show = () => this._screenWinner(m);
    const ko = () => {
      if (live && r && r.reason !== 'tiebreak' && m.reason !== 'concede' && m.winnerId && r.winnerId === m.winnerId) this._screenDecider(m, r, show);
      else show();
    };
    if (live && prev.phase === 'tiebreak' && r && m.winnerId && m.reason !== 'concede') this._duelFinale(m, r, show);
    else if (live && prev.phase === 'play' && m.reason !== 'concede') { this._renderHeader({ ...m, currentPlayerId: null }); this._after(1100, ko); }
    else ko();
  }
  // The hole that decides the match goes straight to 'done': how it ended (KNOCKOUT!, BIRDIE!)
  // gets its moment before the winner screen.
  _screenDecider(m, r, then) {
    if (!this.match || this.match.id !== m.id) return;
    this._hidePlay();
    const v = holeResultView(m, r);
    const w = playerOf(m, m.winnerId);
    const ws = slotOf(m, w.id);
    const mine = v.rows.find((x) => x.p.id === w.id);
    const ko = v.kind === 'knockout';
    const title = ko ? 'KNOCKOUT!' : r.reason === 'hazard' ? 'HAZARD!' : mine && mine.label && !mine.out ? `${mine.label}!` : 'HOLE WON!';
    const sub = `${shout(w.name)} TAKES ${(m.target || 1) > 1 ? `HOLE ${r.holeNumber}` : 'THE HOLE'}`;
    this._show('ko', `${bgHalves(`mt-res-bg mt-res-knockout mt-win-${ws}`)}
      <div class="mt-ko mt-p${ws} ${ko ? 'mt-kind-knockout' : 'mt-kind-win'}">${big(title, 'mt-res-title')}<span class="mt-x mt-ko-sub">${esc(sub)}</span></div>`);
    this._clutchStamp(r);   // v2:stake
    // on the frame the stamp lands
    this._after(340, () => { this._shake(); this._moment(ko ? { sting: 'sting-knockout', say: 'm-knockout', priority: 2 } : { impact: 'whoosh' }); });
    this._after(1600, then);
  }

  _screenWinner(m) {
    if (!this.match || this.match.id !== m.id) return;
    this._hidePlay();
    const w = playerOf(m, m.winnerId);
    const [a, b] = bySlot(m);
    const f = formatOf(m.format);
    const buttons = `<div class="mt-win-actions">
        <button type="button" class="mt-btn mt-btn-go" data-mt="rematch">REMATCH</button>
        <button type="button" class="mt-btn" data-mt="new-match">NEW MATCH</button>
        <button type="button" class="mt-btn mt-btn-dim" data-mt="exit">EXIT</button>
      </div>`;
    if (!w) {   // no winner (a drawn or abandoned match): say so, offer the same three ways out
      this._show('winner', `${bgHalves('mt-res-bg mt-res-tied')}
        <div class="mt-win-main"><span class="mt-slot">${esc(f.label)}</span>${big('ALL SQUARE', 'mt-win-name')}<span class="mt-x mt-win-wins">NO WINNER</span></div>${buttons}`);
      return;
    }
    const l = otherOf(m, w.id);
    const ws = slotOf(m, w.id), ls = slotOf(m, l.id);
    const tags = seriesTags(m);
    const rw = (m.rewards && m.rewards.winner) || {};
    const rl = (m.rewards && m.rewards.loser) || {};
    const base = (this._mem.base || {})[w.id];
    const now = w.profile || null;
    const rankNow = rankText(now && now.rank);
    const rankWas = rankText(base && base.rank);
    const rankUp = rankNow && rankWas && rankNow !== rankWas;
    // how the last hole ended, since the deciding hole has no result screen of its own
    const series = (m.target || f.target) > 1;
    const lastR = m.lastResult || (m.holeResults || [])[(m.holeResults || []).length - 1] || null;
    const lv = lastR ? holeResultView(m, lastR) : null;
    const lw = lv && lv.winner ? lv.rows.find((x) => x.p.id === lv.winner.id) : null;
    const ll = lv && lv.loser ? lv.rows.find((x) => x.p.id === lv.loser.id) : null;
    const how = m.reason === 'concede' ? `${shout(l.name)} CONCEDED`
      : !lv || !lw ? ''
        : lastR.reason === 'tiebreak' ? `WON IN SUDDEN DEATH · ${lw.big}${ll && !ll.out ? ` TO ${ll.big}` : ''}`
          : lv.kind === 'knockout' ? (series ? `WON BY KNOCKOUT ON HOLE ${lastR.holeNumber}` : `WON BY KNOCKOUT${lw.label ? ` · IN FOR ${lw.label}` : ''}`)
            : lv.how ? (series ? `HOLE ${lastR.holeNumber}: ${lv.how}` : lv.how) : '';
    const awards = (m.awards || []).slice(0, 5).map((x, i) => {
      const p = playerOf(m, x.playerId);
      const [val, ...more] = String(x.value ?? '').split(' · ');
      return `<div class="mt-award ${p ? `mt-p${slotOf(m, p.id)}` : ''}" style="--d:${(1.5 + i * 0.22).toFixed(2)}s">
        <span class="mt-award-l">${esc([String(x.label || x.id || ''), ...more].join(' · ').toUpperCase())}</span>
        <b class="mt-award-p">${p ? esc(shout(p.name)) : ''}</b>
        <span class="mt-award-v${val.length > 7 ? ' mt-long' : ''}${val.length > 14 ? ' mt-xlong' : ''}">${esc(val.toUpperCase())}</span></div>`;
    }).join('');
    const chest = Array.isArray(rw.chest) ? rw.chest.map((id) => ballInfo(id, this.catalogue)) : [];
    const loot = `
      <div class="mt-loot">
        ${rw.trophies != null ? `<div class="mt-loot-i mt-loot-tro" style="--d:2.6s"><b>+${fmt(Math.abs(rw.trophies))}</b>${trophySvg}<span>${now && now.trophies != null ? `NOW ${fmt(now.trophies)}` : 'TROPHIES'}</span></div>` : ''}
        ${rw.coins ? `<div class="mt-loot-i mt-loot-coin" style="--d:2.7s"><b>+${fmt(rw.coins)}</b><i class="mt-coin-ico"></i><span>COINS</span></div>` : ''}
        ${rankNow ? `<div class="mt-loot-i mt-loot-rank ${rankUp ? 'mt-rank-up' : ''}" style="--d:2.8s"><b style="--n:${Math.max(6, rankNow.length)}">${esc(rankNow)}</b><span>${rankUp ? 'RANK UP!' : 'RANK'}</span></div>` : ''}
        ${rl.trophies ? `<div class="mt-loot-i mt-loot-lose mt-p${ls}" style="--d:2.9s"><b>−${fmt(Math.abs(rl.trophies))}</b>${trophySvg}<span>${esc(shout(l.name))}</span></div>` : ''}
      </div>
      ${chest.length ? `<div class="mt-chest" style="--d:3.3s">
        <div class="mt-chest-box" aria-hidden="true"><i class="mt-chest-lid"></i><i class="mt-chest-base"></i><i class="mt-chest-glow"></i></div>
        <div class="mt-chest-balls">${chest.map((c, i) => `<div class="mt-ball mt-r-${esc(c.rarity)}" style="--c:${esc(c.color)};--d:${(3.95 + i * 0.22).toFixed(2)}s"><i class="mt-ball-orb">${esc(c.emoji)}</i><b>${esc(c.name.toUpperCase())}</b><span>${c.kind === 'trick' ? 'TRICK' : esc(String(c.rarity).toUpperCase())}</span></div>`).join('')}</div>
      </div>` : ''}`;
    this._show('winner', `
      <div class="mt-bg mt-win-bg mt-win-${ws}" aria-hidden="true"><i class="mt-rays"></i><i class="mt-win-slab"></i><i class="mt-dots"></i></div>
      <div class="mt-win-main mt-p${ws}">
        <span class="mt-slot">PLAYER ${ws} · ${esc(m.formatLabel ? String(m.formatLabel).toUpperCase() : f.label)}</span>
        ${big(shout(w.name), 'mt-win-name')}
        <span class="mt-x mt-win-wins">WINS!</span>
        <div class="mt-win-score">
          <span class="mt-p1">${esc(shout(a.name))}</span><b><i class="mt-p1">${a.holesWon || 0}</i><em>–</em><i class="mt-p2">${b.holesWon || 0}</i></b><span class="mt-p2">${esc(shout(b.name))}</span>
        </div>
        ${how ? `<span class="mt-win-how">${esc(how)}</span>` : ''}
        ${tags.map((t, i) => `<span class="mt-stamp mt-stamp-${t.id}" style="--d:${(1.1 + i * 0.3).toFixed(2)}s" aria-label="${esc(t.text)}">${t.lines.map((x) => `<i>${esc(x)}</i>`).join('')}</span>`).join('')}
      </div>
      <div class="mt-win-side">
        ${awards ? `<div class="mt-awards"><span class="mt-side-h">MATCH AWARDS</span>${awards}</div>` : ''}
        ${loot}
      </div>
      ${buttons}`);
    const nameless = /^player\s*[12]$/i.test(String(w.name).trim());
    // sound: everything on the frame the name lands (confetti, fanfare, the announcer), then
    // the reward beats one at a time: a tick per award line, the loot, the chest lid
    this._after(400, () => {
      this._shake();
      this._burst(ws, 1.25);
      this._moment({ impact: 'confetti-pop', sting: 'fanfare-win', say: nameless ? `m-player-${ws}-wins` : [voiceName(m, w), 'm-wins-the-match'], priority: 3 });
      for (const t of tags) this._after(600, () => this._say(t.voice), this._soundTimers);   // queued behind the winner line: one voice at a time
    });
    (m.awards || []).slice(0, 5).forEach((_, i) => this._after(1650 + i * 220, () => this._cue('trophy-tick')));
    if (rw.trophies != null || rw.coins) this._after(2750, () => this._cue('coin-burst'));
    this._after(1100, () => { if (!this.reduced) this.confetti.burst({ x: 0.5, y: -0.05, angle: 90, spread: 150, n: 140, power: 0.45, colors: ws === 1 ? ['#ff5a36', '#ffd21f', '#fff'] : ['#2e9bff', '#ffd21f', '#fff'] }); });
    this._after(2000, () => this._burst(ws, 0.8));
    if (chest.length) this._after(3650, () => this._cue('chest-open'));
    this._after(this.reduced ? 0 : 900, () => this.screen.querySelector('[data-mt="rematch"]')?.focus({ preventScroll: true }));
  }

  // ---------- the lobby ----------
  async openLobby() {
    const ui = this.lobbyUi;
    ui.open = true; ui.picker = null; ui.drawer = false; ui.busy = false; ui.error = ''; ui.fresh = true;
    this._cue('lobby-open');   // v2:voice the match screen arrives: a swish that lands in a thud
    this._fixPick();
    this._renderLobby();
    this._sync();
    try {
      const [d, mm, a] = await Promise.all([this.fetchJson('/api/leagues'), this.fetchJson('/api/match'), this.catalogue ? null : this.fetchJson('/api/arcade')]);
      if (mm) {
        if (mm.tour !== undefined) this.tour = mm.tour;
        if (Array.isArray(mm.tiers) && mm.tiers.length) this.tiers = mm.tiers;
        if (mm.profiles) this.profiles = mm.profiles;
      }
      if (a && Array.isArray(a.powerups)) this.catalogue = a.powerups;
      if (d && Array.isArray(d.players)) this.setPlayers(d.players);
      else if (this.lobbyOpen) this._renderLobby();
    } catch (_) { /* the roster we have */ }
  }
  closeLobby() {
    if (!this.lobbyUi.open) return;
    this.lobbyUi.open = false;
    if (this._screenKind === 'lobby') this._hideScreen(true);
    this._sync();
  }
  toggleLobby() { if (this.lobbyOpen) this.closeLobby(); else this.openLobby(); }

  // the match stages of the tour, in order (tiebreak arenas are never offered as a match stage)
  _stages() {
    return ((this.tour && this.tour.stages) || []).filter((x) => x && x.id && x.role !== 'tiebreak' && x.kind !== 'tiebreak')
      .sort((x, y) => (x.order || 0) - (y.order || 0));
  }
  // the stage row pages when it holds more cards than fit: arrows, the wheel, a drag of the trackpad
  _syncPager(sc) {
    const row = sc.closest('.mt-stage-row');
    if (!row) return;
    const max = sc.scrollWidth - sc.clientWidth;
    row.classList.toggle('mt-can-l', sc.scrollLeft > 4);
    row.classList.toggle('mt-can-r', max - sc.scrollLeft > 4);
  }
  _wirePager(sc, keepScroll, centre) {
    const on = sc.querySelector('.mt-scard.on');
    if (centre && on) sc.scrollLeft = Math.max(0, on.offsetLeft - (sc.clientWidth - on.offsetWidth) / 2);
    else if (keepScroll) sc.scrollLeft = keepScroll;
    this._syncPager(sc);
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => this._syncPager(sc));   // once the cards have their size
    sc.addEventListener('scroll', () => this._syncPager(sc), { passive: true });
    sc.addEventListener('wheel', (e) => {
      if (sc.scrollWidth <= sc.clientWidth || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      sc.scrollLeft += e.deltaY;
      e.preventDefault();
    }, { passive: false });
  }

  _renderLobby() {
    const ui = this.lobbyUi;
    if (!ui.open || (this.match && this._screenKind && this._screenKind !== 'lobby')) return;
    const pk = this.pick;
    const stages = this._stages();
    const f = formatOf(pk.format);
    if (pk.stage !== 'random' && pk.stage !== 'current' && !stages.some((s) => s.id === pk.stage)) pk.stage = stages.length ? 'random' : 'current';
    if (!stages.length) pk.stage = 'current';
    else if (pk.stage === 'current') pk.stage = 'random';
    const P = (id) => this.players.find((x) => x.id === id) || null;
    const slot = (key, n) => {
      const p = P(pk[key]);
      const open = ui.picker === key;
      const list = this.players.map((x) => `<button type="button" class="mt-roster-b ${x.id === pk[key] ? 'on' : ''}" data-pick-player="${esc(x.id)}">${esc(x.name)}</button>`).join('');
      return `<div class="mt-slotcard mt-p${n} ${open ? 'mt-open' : ''} ${p ? '' : 'mt-empty'} ${arr === `slot-${key}` ? 'mt-arrive' : ''}">
        <i class="mt-slot-bg"></i>
        <button type="button" class="mt-slot-main" data-mt="picker" data-slot="${key}" aria-expanded="${open}">
          <span class="mt-slot">PLAYER ${n}</span>
          ${big(p ? p.name.toUpperCase() : 'TAP TO PICK', 'mt-slot-name')}
          ${p ? (profileChip(this.profiles[p.id]) || '<span class="mt-chip"><b class="mt-rank">NEW CHALLENGER</b></span>') : ''}
          <span class="mt-slot-change">${open ? 'CLOSE' : 'CHANGE'}</span>
        </button>
        ${open ? `<div class="mt-picker ${arr === 'picker' ? 'mt-arrive' : ''}">
          <div class="mt-roster">${list || '<span class="mt-roster-none">NO PLAYERS YET</span>'}</div>
          <form class="mt-add" data-slot="${key}"><input class="mt-add-in" name="name" maxlength="24" placeholder="NEW PLAYER NAME" autocomplete="off" aria-label="New player name"><button type="submit" class="mt-btn mt-btn-sm">ADD</button></form>
        </div>` : ''}
      </div>`;
    };
    const fcard = (x) => `<button type="button" class="mt-fcard ${x.id === f.id ? `on ${arr === 'format' ? 'mt-arrive' : ''}` : ''}" data-format="${x.id}" aria-pressed="${x.id === f.id}">
        ${big(x.label)}<span class="mt-fsub">${x.sub}</span><em>${x.blurb}</em></button>`;
    const arr = ui.arrive || '';
    ui.arrive = null;
    const scard = (s, { ro = false, n = null } = {}) => `<button type="button" class="mt-scard ${!ro && pk.stage === s.id ? `on ${arr === 'stage' ? 'mt-arrive' : ''}` : ''} ${ro ? 'mt-ro' : ''}" ${ro ? 'tabindex="-1"' : `data-stage="${esc(s.id)}"`} style="${themeStyle(s)}">
        ${silhouette(s.theme)}${n ? `<i class="mt-scard-n">${n}</i>` : ''}${s.par ? `<span class="mt-scard-par">PAR ${esc(s.par)}</span>` : ''}${s.freeBall ? `<i class="mt-scard-free">${esc(ballWord(s.freeBall))} HOLE</i>` : ''}<b data-w="${Math.max(5, ...String(s.name || s.id).split(/\s+/).map((w) => w.length))}">${esc(String(s.name || s.id).toUpperCase())}</b><span>${s.lengthYd ? `${Math.round(s.lengthYd)} YD` : ''}</span></button>`;
    const wordN = Math.max(6, ...stages.flatMap((s) => String(s.name || s.id).split(' ').map((w) => w.length)));   // one type size for every card
    let stageRow;
    if (!stages.length) {
      stageRow = `<div class="mt-stage-row"><span class="mt-row-h">STAGE</span><div class="mt-scards"><button type="button" class="mt-scard on mt-ro" tabindex="-1" style="${themeStyle(null)}">${silhouette('current')}<b>THIS COURSE</b><span>THE HOLE THAT IS LOADED</span></button></div></div>`;
    } else if (f.id === 'quick') {
      stageRow = `<div class="mt-stage-row"><span class="mt-row-h">PICK THE STAGE · ${stages.length} ON THE TOUR</span>
        <button type="button" class="mt-page mt-page-l" data-mt="page" data-dir="-1" aria-label="Earlier stages">‹</button>
        <button type="button" class="mt-page mt-page-r" data-mt="page" data-dir="1" aria-label="More stages">›</button>
        <div class="mt-scards" style="--n:${wordN}">
        <button type="button" class="mt-scard mt-scard-rand ${pk.stage === 'random' ? `on ${arr === 'stage' ? 'mt-arrive' : ''}` : ''}" data-stage="random"><i class="mt-q">?</i><b>RANDOM</b><span>SURPRISE US</span></button>
        ${stages.map((s) => scard(s)).join('')}</div></div>`;
    } else if (pk.order === 'shuffle') {
      // a shuffled series draws from every stage: nobody knows what is coming
      const n = Math.min(f.holes, stages.length);
      stageRow = `<div class="mt-stage-row"><span class="mt-row-h">THE CLASH TOUR · SHUFFLED · ${n} OF ${stages.length} STAGES, NO REPEATS</span><div class="mt-scards mt-shuffled">
        ${Array.from({ length: n }, (_, i) => `<button type="button" class="mt-scard mt-scard-rand mt-ro" tabindex="-1"><i class="mt-q">?</i><b>HOLE ${i + 1}</b><span>A SURPRISE</span></button>`).join('')}</div></div>`;
    } else {
      const shown = stages.slice(0, f.holes);
      stageRow = `<div class="mt-stage-row"><span class="mt-row-h">THE CLASH TOUR · IN TOUR ORDER${f.holes > shown.length ? ` · ${shown.length} STAGES BUILT` : ''}</span>
        <button type="button" class="mt-page mt-page-l" data-mt="page" data-dir="-1" aria-label="Earlier stages">‹</button>
        <button type="button" class="mt-page mt-page-r" data-mt="page" data-dir="1" aria-label="More stages">›</button>
        <div class="mt-scards">
        ${shown.map((s, i) => scard(s, { ro: true, n: i + 1 })).join('')}</div></div>`;
    }
    const tier = this.tiers.find((t) => t.id === pk.stakes) || null;
    const seg = (key, opts) => `<div class="mt-seg">${opts.map(([val, label]) => `<button type="button" class="${String(pk[key] ?? '') === String(val) ? `on ${arr === `opt-${key}` ? 'mt-arrive' : ''}` : ''}" data-opt="${key}" data-val="${esc(val)}">${esc(label)}</button>`).join('')}</div>`;
    const summary = [pk.tieRule === 'halve' ? 'TIES HALVED' : 'TIES: SUDDEN DEATH', pk.powerups === 'off' ? 'NO POWER-UPS' : pk.powerups === 'unlimited' ? 'UNLIMITED POWER-UPS' : 'POWER-UP LOADOUT', pk.hazardLosesHole ? 'HAZARD LOSES HOLE' : '', pk.putting === 'easy' ? 'EASY PUTTING' : pk.putting === 'off' ? 'REAL PUTTING' : '', tier ? `STAKES ${fmt(tier.entryFee)}` : 'FRIENDLY'].filter(Boolean).join(' · ');
    const a = P(pk.a), b = P(pk.b);
    const can = a && b && a.id !== b.id && !this.active && !ui.busy;
    const html = `
      ${bgHalves('mt-lobby-bg')}
      <header class="mt-lobby-head">
        <div class="mt-logo"><span class="mt-x">CLASH MATCH</span><em>1 V 1 · REAL SWINGS · ONE BAY</em></div>
        <button type="button" class="mt-x-btn" data-mt="close-lobby" aria-label="Close">×</button>
      </header>
      <div class="mt-lobby-players">
        ${slot('a', 1)}
        <div class="mt-lobby-vs" aria-hidden="true"><span class="mt-x">VS</span></div>
        ${slot('b', 2)}
      </div>
      ${this.active ? this._lobbyLive() : '' /* v2:menu a match is in play: RESUME or QUIT, instead of a START that cannot start */}
      ${this.players.length < 2 ? `<button type="button" class="mt-btn mt-quick2" data-mt="quick-two">ONE TAP: PLAYER 1 VS PLAYER 2</button>` : ''}
      <div class="mt-fcards">${FORMATS.map(fcard).join('')}</div>
      ${stageRow}
      <footer class="mt-lobby-foot">
        <button type="button" class="mt-btn mt-opts-btn" data-mt="drawer" aria-expanded="${ui.drawer}"><b>OPTIONS</b><span>${esc(summary)}</span></button>
        ${ui.error ? `<p class="mt-error ${arr === 'error' ? 'mt-arrive' : ''}" role="alert">${esc(ui.error)}</p>` : ''}
        <button type="button" class="mt-btn mt-btn-go mt-start" data-mt="start" ${can ? '' : 'disabled'}>${ui.busy ? 'GET READY…' : this.active ? 'MATCH IN PLAY' : 'START'}</button>
      </footer>
      <aside class="mt-drawer ${ui.drawer ? 'mt-open' : ''}" aria-hidden="${!ui.drawer}">
        <header><span class="mt-x">OPTIONS</span><button type="button" class="mt-x-btn" data-mt="drawer" aria-label="Close options">×</button></header>
        <div class="mt-opt"><span>TIED HOLES</span>${seg('tieRule', [['shootout', 'SUDDEN DEATH'], ['halve', 'HALVE']])}</div>
        <div class="mt-opt"><span>POWER-UPS</span>${seg('powerups', [['loadout', 'LOADOUT'], ['unlimited', 'UNLIMITED'], ['off', 'OFF']])}</div>
        <div class="mt-opt ${f.id === 'quick' ? 'mt-opt-na' : ''}"><span>STAGE ORDER</span>${seg('order', [['tour', 'TOUR'], ['shuffle', 'SHUFFLE']])}</div>
        <div class="mt-opt"><span>HAZARD LOSES THE HOLE</span>${seg('hazardLosesHole', [['false', 'OFF'], ['true', 'ON']])}</div>
        <div class="mt-opt" title="How much the game helps a putt. ASSISTED: a decent putt drops, a poor one is a miss. EASY: more of them drop. REAL: your own stroke at the real cup."><span>PUTTING</span>${seg('putting', [['easy', 'EASY'], ['assist', 'ASSISTED'], ['off', 'REAL']])}</div>
        <div class="mt-opt"><span>STAKES</span>${seg('stakes', [['', 'FRIENDLY'], ...this.tiers.map((t) => [t.id, `${String(t.label || t.id).toUpperCase()} ${fmt(t.entryFee)}`])])}</div>
      </aside>`;
    const keepScroll = this.screen.querySelector('.mt-scards')?.scrollLeft || 0;
    this._show('lobby', html);
    const wasFresh = ui.fresh;
    this.screen.classList.toggle('mt-enter', ui.fresh);
    this.screen.classList.toggle('mt-drawer-open', ui.drawer);
    ui.fresh = false;
    const sc = this.screen.querySelector('.mt-scards');
    if (sc) this._wirePager(sc, keepScroll, wasFresh);
    const form = this.screen.querySelector('.mt-add');
    if (form) {
      form.addEventListener('submit', (e) => { e.preventDefault(); this._cue('ui-confirm'); this._addPlayer(form.dataset.slot, form.elements.name.value); });
      form.elements.name.focus({ preventScroll: true });
    }
  }

  // the options drawer slides: a class on what is there, never a re-render (so it can slide back)
  _setDrawer(open, quiet = false) {
    this.lobbyUi.drawer = !!open;
    if (!quiet || !open) this._cue(open ? 'drawer-open' : 'drawer-close');   // v2:voice the options drawer has its own pair
    const d = this.screen.querySelector('.mt-drawer');
    if (!d) { this._renderLobby(); return; }
    d.classList.toggle('mt-open', !!open);
    d.setAttribute('aria-hidden', String(!open));
    this.screen.classList.toggle('mt-drawer-open', !!open);
    this.screen.querySelector('.mt-opts-btn')?.setAttribute('aria-expanded', String(!!open));
  }
  // the roster picker folds away before it goes
  _closePicker() {
    const p = this.screen.querySelector('.mt-picker');
    this.lobbyUi.picker = null;
    if (!p || this.reduced) { this._renderLobby(); return; }
    p.classList.remove('mt-arrive');
    p.classList.add('mt-leave');
    setTimeout(() => { if (this.lobbyOpen && !this.lobbyUi.picker) this._renderLobby(); }, 150);
  }
  _setSlot(key, id) {
    const other = key === 'a' ? 'b' : 'a';
    if (id && this.pick[other] === id) this.pick[other] = this.pick[key];   // swap rather than pick one twice
    this.pick[key] = id;
    this.lobbyUi.picker = null;
    this.lobbyUi.arrive = `slot-${key}`;
    this._savePick();
  }
  async _ensurePlayer(name) {
    const n = String(name || '').trim();
    if (!n) return null;
    const have = this.players.find((p) => p.name.toLowerCase() === n.toLowerCase());
    if (have) return have;
    const out = await this._post('/api/players', { name: n }, { lobby: true });
    if (!out || !out.player) return null;
    if (!this.players.some((p) => p.id === out.player.id)) this.players.push({ ...out.player, initials: out.player.initials || initialsOf(out.player.name) });
    return out.player;
  }
  async _addPlayer(key, name) {
    const p = await this._ensurePlayer(name);
    if (p) this._setSlot(key, p.id);
    if (this.lobbyOpen) this._renderLobby();
  }
  async _quickTwo() {
    const a = await this._ensurePlayer('Player 1');
    const b = await this._ensurePlayer('Player 2');
    if (a) this.pick.a = a.id;
    if (b) this.pick.b = b.id;
    this._savePick();
    if (this.lobbyOpen) this._renderLobby();
  }

  async _startFromLobby() {
    const ui = this.lobbyUi, pk = this.pick;
    const a = this.players.find((p) => p.id === pk.a), b = this.players.find((p) => p.id === pk.b);
    if (ui.busy) return;
    if (!a || !b || a.id === b.id) { this._cue('ui-error'); return; }   // v2:voice a soft denied buzz
    this._cue('start-match');   // v2:voice the big one: a confirm whose rising tail hands off to the VS slam
    ui.busy = true; ui.error = '';
    this._renderLobby();
    // the announcer learns both names (rendered once, server-side); never worth waiting long for
    const names = Promise.allSettled([a, b].map((p) => Promise.resolve(this.fetchJson('/api/voice/name', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: p.name }) })).catch(() => null)));
    await Promise.race([names, new Promise((res) => setTimeout(res, 2500))]);
    const out = await this.start({
      playerIds: [a.id, b.id], format: pk.format,
      stage: pk.format === 'quick' ? pk.stage : (this._stages().length ? undefined : 'current'),
      order: pk.order, tieRule: pk.tieRule, powerups: pk.powerups, stakes: pk.stakes || null, hazardLosesHole: !!pk.hazardLosesHole,
      putting: ['easy', 'assist', 'off'].includes(pk.putting) ? pk.putting : 'assist',
    });
    ui.busy = false;
    if (out && out.match && (!this.match || this.match.id !== out.match.id)) this.onMatch(out.match);
    else if (this.lobbyOpen) { if (!out || !out.match) this._cue('ui-error'); /* v2:voice the server said no */ this._renderLobby(); }
  }

  // v2:stake the ball that won the hole was a FOR THE WIN one: it is stamped on the screen that says who won
  _clutchStamp(r) {
    const c = this._mem.clutch;
    if (!c || !r || !r.winnerId || (c !== true && c !== r.holeNumber)) return;
    this._mem.clutch = null;
    const el = document.createElement('div');
    el.className = 'mt-clutch';
    el.innerHTML = '<span class="mt-x">FOR THE WIN!</span>';
    this.screen.appendChild(el);
  }

  // ---------- v2:menu the match menu, the stray-ball prompt ----------
  // The way out of anything a match can get stuck in: a pause panel with big buttons, opened
  // from the header's MENU button, the MENU chip on the intro and result screens, Esc or M.
  // It does not pause the server: swings still count while it is open.
  get menuOpen() { return this.menuUi.open; }
  openMenu() {
    if (!this.match || this.menuUi.open) return;
    Object.assign(this.menuUi, { open: true, ask: null, busy: false, key: '' });
    this._cue('ui-confirm');
    this._renderMenu();
    this._syncMenu();
  }
  closeMenu(quiet = false) {
    if (!this.menuUi.open) return;
    Object.assign(this.menuUi, { open: false, ask: null, busy: false, key: '' });
    if (!quiet) this._cue('ui-back');
    this.menuEl.className = 'mt-menu hidden';
    this.menuEl.innerHTML = '';
    this._syncMenu();
  }
  _renderMenu() {
    const m = this.match, ui = this.menuUi;
    if (!m || !ui.open) return;
    const items = menuItems(m, this.game, { shell: this.shell });   // v2:playability with the rescue drop when there is one
    const asking = items.find((x) => x.id === ui.ask && x.ask && x.on) || null;
    if (!asking) ui.ask = null;
    const [a, b] = bySlot(m);
    const where = m.phase === 'done' ? 'MATCH OVER' : `${m.phase === 'tiebreak' ? 'SUDDEN DEATH' : `HOLE ${m.holeNumber || 1}`} · ${esc(shout(a.name))} ${a.holesWon || 0}–${b.holesWon || 0} ${esc(shout(b.name))}`;
    const body = asking
      ? `<span class="mt-x mt-menu-t mt-menu-q" style="--n:${asking.ask.title.length}">${esc(asking.ask.title)}</span>
         <span class="mt-menu-sub">${esc(asking.ask.sub)}</span>
         <div class="mt-menu-yn">
           <button type="button" class="mt-menu-b mt-menu-yes" data-mt="menu-yes" ${ui.busy ? 'disabled' : ''}><i>Y</i><b>YES</b></button>
           <button type="button" class="mt-menu-b mt-menu-no" data-mt="menu-no" ${ui.busy ? 'disabled' : ''}><i>N</i><b>NO</b></button>
         </div>`
      : `<span class="mt-x mt-menu-t">MATCH MENU</span>
         <span class="mt-menu-sub">${where}</span>
         <div class="mt-menu-list">${items.map((x, i) => `<button type="button" class="mt-menu-b mt-menu-${x.id}" data-mt="menu-do" data-do="${x.id}" ${x.on && !ui.busy ? '' : 'disabled'}><i>${i + 1}</i><b>${esc(x.label)}</b><span>${esc(x.sub)}</span></button>`).join('')}</div>
         <span class="mt-menu-note">SWINGS STILL COUNT WHILE THIS IS OPEN · ESC TO RESUME</span>`;
    this.menuEl.className = `mt-menu ${asking ? 'mt-menu-asking' : ''}`;
    this.menuEl.innerHTML = `<div class="mt-menu-back" data-mt="${asking ? 'menu-no' : 'menu-resume'}"></div><div class="mt-menu-panel" role="dialog" aria-modal="true" aria-label="Match menu">${body}</div>`;
    ui.key = this._menuStateKey(m);
    this.menuEl.querySelector(asking ? '.mt-menu-no' : '.mt-menu-b:not([disabled])')?.focus({ preventScroll: true });
  }
  _menuStateKey(m) { const g = this.game; return m ? `${m.id}|${m.phase}|${m.undoable ? `${m.undoable.playerId}${m.undoable.stray ? 's' : ''}${m.undoable.drop ? 'd' : ''}` : ''}|${m.canRestartHole ? 1 : 0}|${m.holeNumber}|${m.players.map((p) => p.holesWon).join('-')}|${g && g.canDrop && g.drop ? `${m.currentPlayerId}${g.drop.free ? 'f' : 'p'}` : ''}` : ''; }
  // v2:playability the game state (app.js, on every 'state'): the menu's DROP ON THE LINE
  setGameState(s) {
    this.game = s && typeof s === 'object' ? s : null;
    if (this.menuUi && this.menuUi.open) this._syncMenu();
  }
  // after every change: the chip shows over the full-bleed match screens, an open menu
  // follows the state, a stray-ball prompt goes when its swing is no longer the last one
  _syncMenu() {
    if (!this.menuChip) return;
    const m = this.match, ui = this.menuUi;
    const overScreen = ['vs', 'stage', 'sudden', 'result', 'ko'].includes(this._screenKind);
    this.menuChip.classList.toggle('hidden', !(m && !ui.open && overScreen));
    if (ui.open && !m) this.closeMenu(true);
    else if (ui.open && !ui.busy && ui.key !== this._menuStateKey(m)) this._renderMenu();
    const s = this._stray;
    if (s && (!m || m.id !== s.matchId || !m.undoable || !m.undoable.stray || m.undoable.playerId !== s.playerId)) this._strayHide();
  }
  async _menuDo(id) {
    const m = this.match, ui = this.menuUi;
    const item = menuItems(m, this.game, { shell: this.shell }).find((x) => x.id === id);
    if (!item || !item.on || ui.busy) return;
    if (id === 'resume') { this.closeMenu(); return; }
    if (item.ask) { ui.ask = id; this._cue('ui-confirm'); this._renderMenu(); return; }   // asks once: YES / NO
    await this._menuRun(id);
  }
  async _menuRun(id) {
    const ui = this.menuUi;
    if (!id || ui.busy || !this.match) return;
    ui.busy = true;
    this._cue('ui-confirm');
    this._renderMenu();
    let out = null;
    if (id === 'undo') out = await this._post('/api/match/undo', {});
    else if (id === 'drop') out = await this._post('/api/match/drop', { playerId: this.match.currentPlayerId });   // v2:playability
    else if (id === 'restart-hole') out = await this._post('/api/match/restart-hole', {});
    else if (id === 'restart-match') out = await this._post('/api/match/restart', {});
    else if (id === 'quit') { await this.abort(); this.closeMenu(true); this.onMatch(null); return; }   // whatever the server said: off the screen
    ui.busy = false;
    if (!out) { ui.ask = null; this._renderMenu(); return; }   // refused: the toast says why, the menu stays
    this.closeMenu(true);
    if (out.match) this.onMatch(out.match);   // (the event stream brings it too)
  }
  // A swing was taken back, or the hole started again: whatever screen and banner the undone
  // swing brought is cleared, and whoever is up is told again.
  _rewound(m, how, e) {
    this._clearSet(this._timers);
    this._clearSet(this._stepTimers);
    this._clearSet(this._soundTimers);
    this._steps = [];
    this._hush();
    this._dropBanners();
    this.confetti.clear();
    this._strayHide();
    Object.assign(this._mem, { resultKey: null, doneKey: null, continued: false, turnKey: null, pop: null, mpDue: false, hdrVals: null });
    if (this._screenKind && this._screenKind !== 'lobby' && m.phase !== 'loading' && m.phase !== 'intro') this._hideScreen(true);
    const p = e.playerId ? playerOf(m, e.playerId) : null;
    this._flash(how === 'undo'
      ? (e.drop   // v2:playability a rescue drop taken back: the ball is where it lay
        ? { kicker: p ? shout(p.name) : 'THE DROP', text: 'DROP TAKEN BACK', sub: 'THE BALL IS BACK WHERE IT LAY', tone: 'gold', ms: 1700 }
        : { kicker: p ? shout(p.name) : 'LAST SHOT', text: 'SHOT TAKEN BACK', sub: e.stray ? 'A STRAY BALL: IT NEVER HAPPENED' : 'HIT IT AGAIN', tone: 'gold', ms: 1700 })
      : { kicker: e.tiebreak ? 'SUDDEN DEATH' : `HOLE ${e.holeNumber || m.holeNumber || ''}`, text: e.tiebreak ? 'ROUND RESTARTED' : 'HOLE RESTARTED', sub: 'BOTH PLAYERS BACK ON THE TEE', tone: 'gold', ms: 1700 });
  }
  // A stray ball (the server marks a swing under 40 mph from a full-shot lie): it counted,
  // and for eight seconds, or until the next swing, a big prompt offers to take it back.
  _strayShow(m, e) {
    const u = m.undoable;
    if (!u || !u.stray || u.playerId !== e.playerId) return;   // already taken back, or another swing since
    const p = playerOf(m, e.playerId);
    this._strayHide();
    const ms = 8000;
    this._stray = { matchId: m.id, playerId: e.playerId, timer: setTimeout(() => this._strayHide(), ms) };
    this.strayEl.className = 'mt-stray';
    this.strayEl.innerHTML = `<div class="mt-stray-card" role="alertdialog" aria-label="Stray ball?" style="--ms:${ms}ms">
      <span class="mt-stray-k">${e.speedMph != null ? `${Math.round(e.speedMph)} MPH · ` : ''}THAT COUNTED AS ${esc(p ? shout(p.name) : 'A')}'S SHOT</span>
      <span class="mt-x mt-stray-t">STRAY BALL?</span>
      <div class="mt-stray-row">
        <button type="button" class="mt-menu-b mt-stray-undo" data-mt="stray-undo"><i>U</i><b>UNDO</b></button>
        <button type="button" class="mt-menu-b mt-stray-count" data-mt="stray-count"><i>C</i><b>COUNT IT</b></button>
      </div>
      <i class="mt-stray-bar" aria-hidden="true"></i>
    </div>`;
  }
  _strayHide() {
    if (this._stray) clearTimeout(this._stray.timer);
    this._stray = null;
    if (this.strayEl) { this.strayEl.className = 'mt-stray hidden'; this.strayEl.innerHTML = ''; }
  }
  async _strayUndo() {
    if (!this._stray) return;
    this._cue('ui-confirm');
    this._strayHide();
    const out = await this._post('/api/match/undo', {});
    if (out && out.match) this.onMatch(out.match);
  }
  // the lobby while a match is in play: say so, and offer the two ways on
  _lobbyLive() {
    const m = this.match;
    const [a, b] = bySlot(m);
    const ask = !!this.lobbyUi.quitAsk;
    return `<div class="mt-live ${ask ? 'mt-live-ask' : ''}" role="status">
      <span class="mt-live-t"><b>${ask ? 'QUIT THIS MATCH?' : 'MATCH IN PLAY'}</b><em>${esc(shout(a.name))} ${a.holesWon || 0}–${b.holesWon || 0} ${esc(shout(b.name))} · ${m.phase === 'tiebreak' ? 'SUDDEN DEATH' : `HOLE ${m.holeNumber || 1}`}</em></span>
      ${ask
        ? '<button type="button" class="mt-btn mt-live-quit" data-mt="lobby-quit">YES, QUIT</button><button type="button" class="mt-btn mt-btn-dim" data-mt="lobby-quit-no">NO</button>'
        : '<button type="button" class="mt-btn mt-btn-go" data-mt="lobby-resume">RESUME</button><button type="button" class="mt-btn mt-live-quit" data-mt="lobby-quit">QUIT MATCH</button>'}
    </div>`;
  }
  // Keys of the menu and the stray prompt. True: the key was theirs.
  _menuKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey || !this.match) return false;
    if (e.target && e.target.closest && e.target.closest('input, textarea, select')) return false;
    const k = String(e.key || '').toLowerCase();
    const ui = this.menuUi;
    const mine = () => { e.stopPropagation(); e.preventDefault(); };
    if (ui.open) {
      if (k === 'tab' || k === 'shift' || k === 'enter' || k === ' ' || /^f\d+$/.test(k)) { e.stopPropagation(); return true; }   // the focused button's own
      mine();
      if (e.repeat || ui.busy) return true;
      if (ui.ask) {
        if (k === 'y') this._menuRun(ui.ask);
        else if (k === 'n' || k === 'escape' || k === 'backspace') { this._cue('ui-back'); ui.ask = null; this._renderMenu(); }
      } else if (k === 'escape' || k === 'm') this.closeMenu();
      else if (/^[1-6]$/.test(k)) { const it = menuItems(this.match, this.game, { shell: this.shell })[+k - 1]; if (it) this._menuDo(it.id); }   // v2:playability six with the drop
      return true;
    }
    if (this._stray && (k === 'u' || k === 'c')) {
      mine();
      if (!e.repeat) { if (k === 'u') this._strayUndo(); else { this._cue('ui-back'); this._strayHide(); } }
      return true;
    }
    if (this._screenKind === 'lobby' || this._screenKind === 'winner') return false;   // their own Esc; the winner screen has its own buttons
    if (k === 'escape' || k === 'm') {
      if (k === 'm') mine(); else e.stopPropagation();
      if (!e.repeat) this.openMenu();
      return true;
    }
    return false;
  }

  // ---------- actions ----------
  async _post(path, body, { quiet = false, lobby = false } = {}) {
    try {
      const out = await this.fetchJson(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
      if (!out || out.ok === false) throw new Error((out && out.error) || 'The server refused that');
      return out;
    } catch (e) {
      if (quiet) return null;
      const msg = e.message || String(e);
      if (this.lobbyOpen || lobby) { this.lobbyUi.error = msg; this.lobbyUi.busy = false; this.lobbyUi.arrive = 'error'; this._renderLobby(); }
      this.toast('Match', msg);
      return null;
    }
  }
  start(body) { this.lobbyUi.error = ''; return this._post('/api/match/start', body, { lobby: true }); }
  concede(playerId) { return this._post('/api/match/concede', { playerId }); }
  abort() { return this._post('/api/match/abort', {}); }
  rematch() { return this._post('/api/match/rematch', {}); }
  arm(playerId, id) { return this._post('/api/match/arm', { playerId, id }); }

  async _click(e) {
    const t = e.target;
    const kind = this._screenKind;
    if (t.closest('.mt-menu, .mt-stray') && !t.closest('[data-mt]')) return;   // v2:menu a click on the panel itself is nothing
    if (kind === 'lobby') {
      const pp = t.closest('[data-pick-player]');
      if (pp) { this._cue('select-player'); /* v2:voice one sound per pick */ this._setSlot(this.lobbyUi.picker, pp.dataset.pickPlayer); this._renderLobby(); return; }
      const fb = t.closest('[data-format]');
      if (fb) { this._cue('select-format'); /* v2:voice */ this.lobbyUi.arrive = 'format'; this.pick.format = fb.dataset.format; this._savePick(); this._renderLobby(); return; }
      const sb = t.closest('[data-stage]');
      if (sb) { this._cue('select-stage'); /* v2:voice the weightiest of the three */ this.lobbyUi.arrive = 'stage'; this.pick.stage = sb.dataset.stage; this._savePick(); this._renderLobby(); return; }
      const ob = t.closest('[data-opt]');
      if (ob) {
        const k = ob.dataset.opt, v = ob.dataset.val;
        this._cue((v === 'false' || v === 'off' || v === '' || v == null) && k !== 'putting' ? 'toggle-off' : 'toggle-on');   // v2:voice
        this.lobbyUi.arrive = `opt-${k}`;
        this.pick[k] = k === 'hazardLosesHole' ? v === 'true' : k === 'stakes' ? (v || null) : v;
        this._savePick(); this._renderLobby(); return;
      }
    }
    const b = t.closest('[data-mt]');
    if (!b) {
      // a click anywhere on an intro skips ahead; on the hole result it continues
      if (kind === 'vs' || kind === 'stage' || kind === 'sudden') this._skipIntro();
      else if (kind === 'result') this._continue(true);
      else if (kind === 'lobby' && this.lobbyUi.drawer && !t.closest('.mt-drawer')) this._setDrawer(false);
      return;
    }
    const m = this.match;
    switch (b.dataset.mt) {
      case 'close-lobby': this._cue('ui-back'); this.closeLobby(); break;
      // v2:menu the match menu, the stray-ball prompt, the lobby's "match in play" bar
      case 'menu': this.openMenu(); break;
      case 'menu-resume': this.closeMenu(); break;
      case 'menu-do': await this._menuDo(b.dataset.do); break;
      case 'menu-yes': await this._menuRun(this.menuUi.ask); break;
      case 'menu-no': this._cue('ui-back'); this.menuUi.ask = null; this._renderMenu(); break;
      case 'stray-undo': await this._strayUndo(); break;
      case 'stray-count': this._cue('ui-back'); this._strayHide(); break;
      case 'lobby-resume': this._cue('ui-back'); this.closeLobby(); break;
      case 'lobby-quit':
        if (!this.lobbyUi.quitAsk) { this._cue('ui-confirm'); this.lobbyUi.quitAsk = true; this._renderLobby(); break; }
        this.lobbyUi.quitAsk = false; this._cue('ui-confirm'); await this.abort(); this.onMatch(null); if (this.lobbyOpen) this._renderLobby();
        break;
      case 'lobby-quit-no': this._cue('ui-back'); this.lobbyUi.quitAsk = false; this._renderLobby(); break;
      case 'picker':
        if (this.lobbyUi.picker === b.dataset.slot) { this._cue('ui-back'); this._closePicker(); break; }
        this.lobbyUi.picker = b.dataset.slot; this.lobbyUi.arrive = 'picker'; this._cue('ui-tick'); this._renderLobby();
        break;
      case 'drawer': this._setDrawer(!this.lobbyUi.drawer); break;
      case 'page': {
        const sc = this.screen.querySelector('.mt-scards');
        if (sc) { this._cue('ui-tick'); sc.scrollBy({ left: (+b.dataset.dir || 1) * sc.clientWidth * 0.8, behavior: this.reduced ? 'auto' : 'smooth' }); }
        break;
      }
      case 'quick-two': b.disabled = true; this._cue('ui-confirm'); await this._quickTwo(); break;
      case 'start': await this._startFromLobby(); break;   // v2:voice START sounds in _startFromLobby (start-match, or ui-error when it cannot start)
      case 'continue': this._continue(true); break;
      case 'concede': {   // two presses: the first asks
        if (!m || !m.currentPlayerId) break;
        const id = m.currentPlayerId;
        if (this._mem.concedeAsk === id && b.classList.contains('mt-ask')) { this._mem.concedeAsk = null; this._cue('ui-confirm'); await this.concede(id); break; }
        this._cue('ui-tick');
        this._mem.concedeAsk = id;
        b.classList.add('mt-ask');
        b.textContent = `${shout(playerOf(m, id)?.name)} GIVES UP?`;
        clearTimeout(this._concedeTimer);
        this._concedeTimer = setTimeout(() => { this._mem.concedeAsk = null; if (b.isConnected) { b.classList.remove('mt-ask'); b.textContent = 'CONCEDE'; } }, 3500);
        break;
      }
      case 'rematch': b.disabled = true; this._cue('ui-confirm'); if (!(await this.rematch()) && b.isConnected) b.disabled = false; break;
      case 'new-match': this._cue('ui-confirm'); await this.abort(); this.onMatch(null); this.openLobby(); break;
      case 'exit': this._cue('ui-back'); await this.abort(); this.onMatch(null); break;   // whatever the server said: off the screen
      default: break;
    }
  }

  _key(e) {
    if (this._menuKey(e)) return;   // v2:menu Esc / M open the match menu; its own keys while it is open; U on a stray ball
    const kind = this._screenKind;
    if (!kind) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const typing = e.target && e.target.closest && e.target.closest('input, textarea, select');
    if (e.key === 'Escape') {
      if (kind !== 'lobby') return;
      e.stopPropagation();
      const ui = this.lobbyUi;
      if (!ui.drawer) this._cue('ui-back');
      if (ui.picker) this._closePicker(); else if (ui.drawer) this._setDrawer(false, true); else this.closeLobby();
      return;
    }
    if (e.key === 'Tab' || e.key === 'Shift' || /^F\d+$/.test(e.key)) return;
    if (typing) { e.stopPropagation(); return; }   // a name being typed is not a game shortcut
    if (kind === 'vs' || kind === 'stage' || kind === 'sudden') {
      e.stopPropagation(); e.preventDefault();
      if (!e.repeat) this._skipIntro();
    } else if (kind === 'result') {
      e.stopPropagation(); e.preventDefault();
      if (!e.repeat) this._continue(true);
    } else if (kind === 'ko' || kind === 'winner' || kind === 'lobby') {
      e.stopPropagation();   // the game's own shortcuts stay out of the way while a match screen is up
    }
  }
}

export default MatchUI;
