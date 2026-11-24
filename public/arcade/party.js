// v3:modes PARTY in the HUD: the match UI for two to four players (docs/modes.md).
//
// A party is the match engine playing one of its party formats (lib/match.js: skins, a stroke
// race, elimination), so its state arrives on the same 'match' event and this class IS the
// match UI: PartyUI extends MatchUI and takes over only where two players were assumed.
// A head-to-head (state.party absent) is drawn by MatchUI exactly as before: every method
// here starts by handing a non-party state to super.
//
//   lobby        four slots in the four player colours, SKINS / STROKE RACE / ELIMINATION,
//                3 / 6 / 9 holes, each player's HELP (a handicap), the options drawer, START
//   the field    the first intro: every name, the format, the draw for the honour
//   stage        every hole (the stage card of a match, with the party's standings)
//   sudden       SUDDEN DEATH between the players who are level: nearest wins / farthest is out
//   (in play)    the header: one card per player (strokes, to the pin, their skins / total /
//                status), whose turn, what the swing is for; the same ticker, banners, menu
//   result       who took the skin / it carries over / who is OUT / the hole's scores
//   winner       the placings, awards, loot, PLAY AGAIN
//
// The pure helpers are exported for test/party-ui.test.mjs. Styles: party.css (classes .pt-),
// linked by this module; the match's own pieces (.mt-) are reused wherever they fit.
import {
  MatchUI, playerOf, slotOf, bySlot, shout, scoreName, toGoText, ftText, introStage, introHoleNumber, ballInfo, ballWord,
  stageRoutes, silhouette, duelView, menuItems, kit,
} from './match.js';
import { PLAYER_COLORS, PLAYER_MARKS, slotColor, slotMark } from './shell-core.js';

const { esc, fmt, big, profileChip, stageFacts, themeStyle, windChip, windBadge, trophySvg, voiceName } = kit;
const PICK_KEY = 'sim-clash.party.pick';

// ---------------------------------------------------------------- pure helpers (exported)

export const isParty = (m) => !!(m && m.party);

export const PARTY_CARDS = Object.freeze([
  { id: 'skins', label: 'SKINS', sub: 'TIES CARRY OVER', blurb: "Lowest score alone takes the hole.", voice: 'p-skins' },
  { id: 'stroke', label: 'STROKE RACE', sub: 'LOWEST TOTAL', blurb: 'Every stroke counts. Points break a tie.', voice: 'p-stroke-race' },
  { id: 'elim', label: 'ELIMINATION', sub: 'HIGHEST IS OUT', blurb: "One out on every hole. Last one standing.", voice: 'p-elimination' },
]);
export const partyCard = (id) => PARTY_CARDS.find((c) => c.id === id) || PARTY_CARDS[0];

// The help levels as the lobby explains them (lib/match.js HELP_LEVELS; the server sends its own with GET /api/match).
export const HELP_FALLBACK = Object.freeze([
  { level: 0, label: 'OFF', text: 'NO HELP' },
  { level: 1, label: 'HELP 1', text: 'EASY PUTTING · +1 POWER-UP' },
  { level: 2, label: 'HELP 2', text: 'EASY PUTTING · +1 POWER-UP · FORWARD TEE (20% CLOSER)' },
  { level: 3, label: 'HELP 3', text: 'EASY PUTTING · +2 POWER-UPS · FORWARD TEE (35% CLOSER)' },
]);

export const alivePlayers = (m) => m.players.filter((p) => !p.out);
const doneHole = (p) => p.holed || p.capped || p.pickedUp;

/** The figure a player's card carries in a party: their skins, their strokes against par so far, or whether they are still in. */
export function partyFigure(m, p) {
  if (m.party === 'skins') return { big: String(p.holesWon || 0), label: (p.holesWon || 0) === 1 ? 'SKIN' : 'SKINS' };
  if (m.party === 'stroke') {
    const par = (m.holeResults || []).filter((r) => !r.playoff).reduce((s, r) => s + (r.par || 0), 0);
    const d = (p.total || 0) - par;
    return { big: !(m.holeResults || []).length ? 'E' : d === 0 ? 'E' : d > 0 ? `+${d}` : String(d), label: `${p.total || 0} STROKES` };
  }
  if (p.out) return { big: 'OUT', label: p.left ? 'LEFT THE GAME' : p.outOnHole ? `ON HOLE ${p.outOnHole}` : '' };
  return { big: 'IN', label: 'STILL ALIVE' };
}

/** How a player stands on the hole in play: the tag under their card. null: nothing to say. */
export function partyStatus(m, p) {
  if (p.out) return { text: p.left ? 'LEFT' : 'OUT', tone: 'out' };
  if (m.phase === 'tiebreak') return null;
  if (p.pickedUp) return { text: 'PICKED UP', tone: 'out' };
  if (p.capped) return { text: 'STROKE LIMIT', tone: 'out' };
  if (p.holed) return { text: `IN FOR ${p.strokes}`, tone: 'in' };
  return null;
}

/**
 * The stake of the swing of the player who is up (the server's shotFor / shotKind for a
 * party: lib/match.js partyStake), as the banner and the tag shout it; null when the swing
 * is for neither. As in a head-to-head a putt or a chip always gets its line, and a full
 * shot only when it is the last word (to stay alive) or beats a score that is already in.
 */
export function partyStakeView(m, p) {
  if (!m || !p || m.phase !== 'play') return null;
  const f = p.shotFor;
  if (f !== 'win' && f !== 'tie') return null;
  const kind = p.shotKind === 'putt' || p.shotKind === 'chip' ? p.shotKind : 'shot';
  const others = alivePlayers(m).filter((q) => q.id !== p.id);
  if (kind === 'shot' && f === 'win' && !others.some((q) => q.holed)) return null;
  const verb = kind === 'putt' ? 'PUTT IN' : kind === 'chip' ? 'CHIP IN' : 'HOLE IT';
  let what, voice = f === 'win' ? 'm-for-the-win' : 'p-to-stay-alive';
  if (m.party === 'skins') {
    const n = m.skinsAtStake || 1;
    what = f === 'win' ? (n > 1 ? `FOR ${n} SKINS` : 'TO WIN THE HOLE') : 'TO STAY ALIVE';
    if (f === 'win' && n > 1) voice = 'p-for-the-skins';
  } else if (m.party === 'elim') {
    const live = others.filter((q) => !doneHole(q));
    what = f === 'tie' ? 'TO STAY ALIVE' : others.length === 1 ? 'TO WIN THE GAME' : live.length === 1 ? `TO KNOCK OUT ${shout(live[0].name)}` : 'TO BE SAFE';
  } else {
    what = f === 'win' ? 'TO WIN THE RACE' : 'TO TIE THE RACE';
    if (f === 'tie') voice = 'm-to-tie';
  }
  return { for: f, kind, text: `${verb} ${what}`, voice };
}

/** What the next swing is for: the second line of the turn banner (shotNeed() of a match, for a party). */
export function partyNeed(m, p) {
  const stake = partyStakeView(m, p);
  if (stake) return { text: stake.text, tone: `stake-${stake.for}`, stake };
  const par = m.stage && m.stage.par;
  if (m.phase === 'tiebreak') {
    const tb = m.tiebreak || {};
    const goal = tb.goal || 'best';
    const done = (tb.results || []).filter((r) => r.round === tb.round && r.playerId !== p.id);
    const fts = done.filter((r) => !r.miss && r.ft != null).map((r) => r.ft);
    if (goal === 'worst') {
      if (done.some((r) => r.miss || r.ft == null)) return { text: 'SOMEBODY MISSED: JUST FIND LAND', tone: 'win' };
      if (fts.length) return { text: `INSIDE ${ftText(Math.max(...fts))} AND YOU ARE SAFE`, tone: 'win' };
      return { text: 'FARTHEST FROM THE PIN IS OUT', tone: 'must' };
    }
    if (done.some((r) => r.holed)) return { text: 'HOLE IT TO STAY ALIVE', tone: 'must' };
    if (fts.length) return { text: `BEAT ${ftText(Math.min(...fts))}`, tone: 'win' };
    if (done.length) return { text: 'THEY MISSED: JUST FIND LAND', tone: 'win' };
    return { text: 'CLOSEST TO THE PIN', tone: 'info' };
  }
  const next = (p.strokes || 0) + 1;
  const fog = p.cursedWith === 'fog';
  if (p.mustHole) return { text: 'MUST MAKE THIS', tone: 'must' };
  const close = p.lie === 'green' || (p.distToPinYd != null && p.distToPinYd <= 30);
  if (close && par != null) return { text: `FOR ${scoreName(next, par)}`, tone: 'score' };
  if (!p.strokes) {
    const st = m.stage || {};
    const yd = p.teeYd || st.lengthYd;
    const len = fog ? '???' : yd ? `${Math.round(yd)} YD` : '';
    if (st.freeBall && m.phase === 'play') return { text: `${ballWord(st.freeBall)} LOADED${len ? ` · ${len}` : ''}`, tone: 'rocket' };
    return { text: [p.teeYd ? 'FORWARD TEE' : 'TEE SHOT', len, par ? `PAR ${par}` : ''].filter(Boolean).join(' · '), tone: 'info' };
  }
  return { text: `SHOT ${next}${fog ? ' · ??? TO THE PIN' : p.distToPinYd != null ? ` · ${toGoText(p.distToPinYd)} TO THE PIN` : ''}`, tone: 'info' };
}

/** The players in the order the standings show them: the leader first. */
export function partyRanking(m) {
  const list = [...m.players];
  const slot = (p) => slotOf(m, p.id);
  if (Array.isArray(m.placings) && m.placings.length) return m.placings.map((id) => playerOf(m, id)).filter(Boolean);
  if (m.party === 'skins') return list.sort((a, b) => (a.out ? 1 : 0) - (b.out ? 1 : 0) || (b.holesWon || 0) - (a.holesWon || 0) || slot(a) - slot(b));
  if (m.party === 'stroke') return list.sort((a, b) => (a.out ? 1 : 0) - (b.out ? 1 : 0) || (a.total || 0) - (b.total || 0) || ((b.stats && b.stats.points) || 0) - ((a.stats && a.stats.points) || 0) || slot(a) - slot(b));
  return list.sort((a, b) => (a.out ? (a.place || 9) : 0) - (b.out ? (b.place || 9) : 0) || slot(a) - slot(b));
}

/** One line under the standings: what the game is and how far through. */
export function partyLine(m) {
  const card = partyCard(m.party);
  const n = m.holeNumber || 1, max = m.maxHoles || 1;
  if (m.party === 'elim') { const left = alivePlayers(m).length; return left === 2 && m.players.length > 2 ? 'THE FINAL' : `${card.label} · ${left} LEFT`; }
  return `${card.label} · HOLE ${Math.min(n, max)} OF ${max}`;
}

/**
 * What the result screen of a party hole says: { kind, title, sub, how, rows: [{ p, big, label, out, mark }] }.
 * kind: 'win' (a skin taken, a hole's best in a stroke race), 'carry' (the skin carries over),
 * 'out' (a player eliminated), 'tied' (sudden death is next), 'done' (a stroke-race hole shared).
 */
export function partyResultView(m, r = m.lastResult) {
  if (!r) return null;
  const par = r.par ?? (m.stage && m.stage.par);
  const w = r.winnerId ? playerOf(m, r.winnerId) : null;
  const gone = r.eliminatedId ? playerOf(m, r.eliminatedId) : null;
  const sd = r.tiebreak && Array.isArray(r.tiebreak.rounds) ? r.tiebreak : null;
  const lastRound = sd && sd.rounds.length ? sd.rounds[sd.rounds.length - 1] : null;
  const row = (p) => {
    const fin = r.finish ? r.finish[p.id] : null;
    const s = r.scores ? r.scores[p.id] : null;
    let cell;
    if (s == null && !(lastRound && p.id in lastRound)) cell = { big: '–', label: p.out && p.id !== r.eliminatedId ? 'OUT' : '', out: true };
    else if (fin === 'holed') cell = { big: String(s), label: scoreName(s, par), out: false };
    else if (fin === 'picked-up') cell = { big: 'X', label: 'PICKED UP', out: true };
    else if (fin === 'capped') cell = { big: 'X', label: 'STROKE LIMIT', out: true };
    else cell = { big: s == null ? '–' : String(s), label: '', out: s == null };
    // a sudden death settled it: its distances ride beside the score
    if (lastRound && p.id in lastRound) {
      const ft = lastRound[p.id];
      cell.sd = ft == null ? 'MISS' : ft === 0 ? 'IN!' : ftText(ft);
    }
    return { p, ...cell, won: !!(w && w.id === p.id) && m.party !== 'elim', gone: !!(gone && gone.id === p.id) };
  };
  const rows = bySlot(m).filter((p) => (r.scores && p.id in r.scores) || (lastRound && p.id in lastRound) || p.id === r.eliminatedId).map(row);
  const holedRows = rows.filter((x) => !x.out);
  let kind, title, sub, how = '';
  if (r.playoff) {
    kind = 'win'; title = w ? shout(w.name) : 'PLAYOFF'; sub = 'WINS THE PLAYOFF';
    how = 'CLOSEST TO THE PIN';
  } else if (m.party === 'skins') {
    const n = r.skins || 1;
    if (w) {
      kind = 'win'; title = shout(w.name); sub = n > 1 ? `TAKES ${n} SKINS` : 'TAKES THE SKIN';
      const mine = rows.find((x) => x.p.id === w.id);
      how = r.reason === 'concede' ? 'NOBODY LEFT TO PLAY IT OFF AGAINST' : r.reason === 'tiebreak' ? `CLOSEST TO THE PIN${mine && mine.sd ? `: ${mine.sd}` : ''}` : r.reason === 'knockout' ? `IN FOR ${mine ? mine.label || mine.big : ''}. NOBODY CAN CATCH IT.` : mine && mine.label ? `${mine.label} BEATS THE FIELD` : '';
    } else if (r.reason === 'carry') {
      kind = 'carry'; title = 'NO WINNER'; sub = `${n + 1} SKINS ON THE NEXT HOLE`;
      how = holedRows.length > 1 ? `${holedRows.filter((x) => x.big === holedRows.reduce((b, y) => (+y.big < +b ? y.big : b), holedRows[0].big)).length} PLAYERS MAKE ${holedRows.reduce((b, y) => (+y.big < +b.big ? y : b), holedRows[0]).label}` : 'NOBODY HOLES OUT';
    } else {
      kind = 'tied'; title = 'ALL SQUARE!'; sub = `SUDDEN DEATH FOR ${n > 1 ? `${n} SKINS` : 'THE SKIN'}`;
      how = 'CLOSEST TO THE PIN TAKES IT';
    }
  } else if (m.party === 'elim') {
    if (gone) {
      kind = 'out'; title = shout(gone.name); sub = 'IS OUT!';
      how = r.reason === 'tiebreak' ? 'FARTHEST FROM THE PIN' : r.reason === 'concede' ? 'LEFT THE GAME' : 'THE HIGHEST SCORE ON THE HOLE';
    } else {
      kind = 'tied'; title = 'TOO CLOSE TO CALL'; sub = 'SUDDEN DEATH: FARTHEST IS OUT';
      how = 'LEVEL FOR THE HIGHEST SCORE';
    }
  } else if (w) {
    kind = 'win'; title = shout(w.name); sub = 'BEST OF THE HOLE';
    const mine = rows.find((x) => x.p.id === w.id);
    how = mine && mine.label ? mine.label : '';
  } else {
    kind = 'done'; title = `HOLE ${r.holeNumber}`; sub = 'IN THE BOOK';
    how = holedRows.length ? 'THE BEST OF THE HOLE IS SHARED' : 'NOBODY HOLES OUT';
  }
  return { kind, title, sub, how, rows, winner: w, gone, par, holeNumber: r.holeNumber, stageName: r.stageName };
}

/** The match menu's items for a party: the match's own, in a party's words, plus LEAVE THE GAME for whoever is up. */
export function partyMenuItems(m, game = null, { shell = false } = {}) {
  const items = menuItems(m, game, { shell }).map((x) => {
    if (x.id === 'resume') return { ...x, sub: 'BACK TO THE GAME' };
    if (x.id === 'restart-hole' && m.phase !== 'tiebreak') return { ...x, sub: m.canRestartHole ? 'EVERYBODY BACK ON THE TEE' : x.sub, ask: { title: 'RESTART THE HOLE?', sub: 'EVERYBODY GOES BACK TO THE TEE. THE SHOTS OF THIS HOLE ARE FORGOTTEN.' } };
    if (x.id === 'restart-hole') return { ...x, ask: { title: 'RESTART THE ROUND?', sub: 'EVERY BALL OF THIS ROUND IS HIT AGAIN.' } };
    if (x.id === 'restart-match') return { ...x, label: 'RESTART GAME', ask: { title: 'RESTART THE GAME?', sub: 'THE SCORES ARE WIPED. SAME PLAYERS, SAME FORMAT, HOLE ONE.' } };
    if (x.id === 'quit') return { ...x, sub: m.phase === 'done' ? 'THE RESULT STANDS' : 'QUIT THE GAME · NO RESULT', ask: { ...x.ask, sub: m.phase === 'done' ? 'THE RESULT STANDS.' : 'THE GAME ENDS. NOBODY WINS, NOTHING IS PAID.' } };
    return x;
  });
  const up = m.currentPlayerId ? playerOf(m, m.currentPlayerId) : null;
  if (up && m.phase !== 'done' && alivePlayers(m).length > 1) {
    items.splice(items.length - 1, 0, { id: 'leave', label: 'LEAVE THE GAME', sub: `${shout(up.name)} DROPS OUT · THE OTHERS PLAY ON`, on: true,
      ask: { title: `${shout(up.name)} LEAVES?`, sub: alivePlayers(m).length === 2 ? 'THE OTHER PLAYER WINS THE GAME.' : 'THE REST OF THE FIELD PLAYS ON WITHOUT THEM.' } });
  }
  return items;
}

/** Who a trick is cast on by default: the first opponent still in the game who carries no curse (the tee order), else anybody still in. */
export function defaultTarget(m, meId, wantId = null) {
  const field = alivePlayers(m).filter((p) => p.id !== meId);
  const want = wantId ? field.find((p) => p.id === wantId) : null;
  if (want) return want.id;
  const order = Array.isArray(m.teeOrder) ? m.teeOrder : [];
  const rank = (p) => { const i = order.indexOf(p.id); return i < 0 ? 99 : i; };
  const sorted = [...field].sort((a, b) => (a.cursedWith ? 1 : 0) - (b.cursedWith ? 1 : 0) || rank(a) - rank(b));
  return sorted.length ? sorted[0].id : null;
}

// ---------------------------------------------------------------- little pieces of markup
const pcls = (slot) => `mt-p${slot} pt-p${slot}`;
const markOf = (slot) => `<i class="pt-mark" aria-hidden="true">${esc(slotMark(slot))}</i>`;
const ordinal = (n) => (n === 1 ? '1ST' : n === 2 ? '2ND' : n === 3 ? '3RD' : `${n}TH`);

function ensureCss() {
  if (typeof document === 'undefined' || document.querySelector('link[data-pt-css]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet'; link.href = 'arcade/party.css'; link.setAttribute('data-pt-css', '');
  document.head.appendChild(link);
}

// ---------------------------------------------------------------- the UI
export class PartyUI extends MatchUI {
  constructor(opts = {}) {
    super(opts);
    ensureCss();
    this.root.classList.add('pt-on');
    this.lobbyKind = 'versus';     // which lobby is up: 'versus' (MatchUI's) | 'party'
    this.helpLevels = HELP_FALLBACK;
    this.suggested = {};           // { playerId: level } from POST /api/match/suggest (never applied by itself)
    this.ppick = { ids: [null, null, null, null], count: 3, format: 'skins', holes: 3, powerups: 'loadout', order: 'tour', putting: 'assist', hazardLosesHole: false, help: {} };
    try { Object.assign(this.ppick, JSON.parse(localStorage.getItem(PICK_KEY) || '{}')); } catch (_) { /* first time */ }
    if (!this.ppick.help || typeof this.ppick.help !== 'object') this.ppick.help = {};
    this.targetId = null;          // who the player who is up casts a trick on (the dock shows it)
    this.onDockChange = null;      // app.js: the ball dock is told when the target changes
    this.targetEl = Object.assign(document.createElement('div'), { className: 'pt-target hidden' });
    this.root.append(this.targetEl);
  }

  // ---------- which lobby ----------
  openLobby() {
    this.lobbyKind = 'versus';
    const opened = super.openLobby();
    Promise.resolve(opened).then(() => this._suggestVersus()).catch(() => {});   // the head-to-head lobby's HELP rows show the suggestion too
    return opened;
  }
  /** The versus lobby: ask for a suggestion for its two players and, when there is one, show it (START keeps the focus it had). */
  async _suggestVersus() {
    const before = JSON.stringify(this.suggested);
    await this._suggest([this.pick.a, this.pick.b].filter(Boolean));
    if (JSON.stringify(this.suggested) === before || !this.lobbyOpen || this.lobbyKind !== 'versus' || this.lobbyUi.picker || this.match) return;
    if (!Object.values(this.suggested).some((v) => +v > 0) && before === '{}') return;
    const onStart = document.activeElement && document.activeElement.dataset && document.activeElement.dataset.mt === 'start';
    this._renderLobby();
    if (onStart) this.screen.querySelector('[data-mt="start"]:not([disabled])')?.focus({ preventScroll: true });
  }
  _setSlot(key, id) {
    super._setSlot(key, id);
    this._suggestVersus().catch(() => {});
  }
  async openPartyLobby() {
    this.lobbyKind = 'party';
    await super.openLobby();
    try {
      const mm = await this.fetchJson('/api/match');
      if (mm && Array.isArray(mm.helpLevels) && mm.helpLevels.length) this.helpLevels = mm.helpLevels;
    } catch (_) { /* the fallback explains them */ }
    this._fixParty();
    await this._suggest();
    if (this.lobbyOpen) this._renderLobby();
  }
  setPlayers(list) {
    super.setPlayers(list);
    if (this.lobbyKind === 'party') { this._fixParty(); if (this.lobbyOpen) this._renderLobby(); }
  }
  _saveParty() { try { localStorage.setItem(PICK_KEY, JSON.stringify(this.ppick)); } catch (_) { /* private mode */ } }
  /** The slots that are in the game, each with a different roster player where the roster has them. */
  _fixParty() {
    const pk = this.ppick;
    pk.count = Math.max(2, Math.min(4, +pk.count || 2));
    const has = (id) => this.players.some((p) => p.id === id);
    const taken = new Set();
    for (let i = 0; i < 4; i++) {
      if (i >= pk.count) { continue; }
      if (!has(pk.ids[i]) || taken.has(pk.ids[i])) pk.ids[i] = (this.players.find((p) => !taken.has(p.id) && !pk.ids.slice(0, pk.count).includes(p.id)) || this.players.find((p) => !taken.has(p.id)) || {}).id ?? null;
      if (pk.ids[i]) taken.add(pk.ids[i]);
    }
    if (!['skins', 'stroke', 'elim'].includes(pk.format)) pk.format = 'skins';
    if (![3, 6, 9].includes(+pk.holes)) pk.holes = 3;
  }
  _partyIds() { return this.ppick.ids.slice(0, this.ppick.count).filter(Boolean); }
  /** Ask the server what help it would suggest for the players in the lobby (their records); shown, never applied. */
  async _suggest(ids = this.lobbyKind === 'party' ? this._partyIds() : [this.pick.a, this.pick.b].filter(Boolean)) {
    const key = ids.join(',');
    if (ids.length < 2 || key === this._suggestKey) return;
    this._suggestKey = key;
    try {
      const out = await this.fetchJson('/api/match/suggest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playerIds: ids }) });
      if (out && out.help && this._suggestKey === key) { this.suggested = out.help; if (Array.isArray(out.levels) && out.levels.length) this.helpLevels = out.levels; }
    } catch (_) { /* no suggestion */ }
  }
  _helpLevel(id) { const v = +this.ppick.help[id]; return Number.isFinite(v) ? Math.max(0, Math.min(3, v)) : 0; }

  // ---------- the lobby ----------
  _renderLobby() {
    if (this.lobbyKind !== 'party') return super._renderLobby();
    const ui = this.lobbyUi;
    if (!ui.open || (this.match && this._screenKind && this._screenKind !== 'lobby')) return;
    const pk = this.ppick;
    const arr = ui.arrive || '';
    ui.arrive = null;
    const P = (id) => this.players.find((x) => x.id === id) || null;
    const stages = this._stages();
    const card = partyCard(pk.format);
    const n = pk.count;
    const holes = pk.format === 'elim' ? n - 1 : pk.holes;
    const slot = (i) => {
      const num = i + 1;
      const on = i < n;
      const p = on ? P(pk.ids[i]) : null;
      const open = ui.picker === `s${i}`;
      if (!on) {
        return `<div class="pt-slot pt-slot-off ${pcls(num)}"><button type="button" class="pt-slot-add" data-pt="add-slot" ${i === n ? '' : 'disabled'}><span class="mt-slot">PLAYER ${num}</span><b>${i === n ? '+ ADD A PLAYER' : ''}</b></button></div>`;
      }
      const lv = p ? this._helpLevel(p.id) : 0;
      const sug = p ? +this.suggested[p.id] || 0 : 0;
      const info = this.helpLevels[lv] || HELP_FALLBACK[lv];
      const list = this.players.map((x) => `<button type="button" class="mt-roster-b ${x.id === pk.ids[i] ? 'on' : ''}" data-pt="pick" data-slot="${i}" data-id="${esc(x.id)}">${esc(x.name)}</button>`).join('');
      return `<div class="pt-slot ${pcls(num)} ${open ? 'pt-open' : ''} ${p ? '' : 'pt-empty'} ${arr === `slot-${i}` ? 'mt-arrive' : ''}">
        <i class="pt-slot-bg"></i>
        <button type="button" class="pt-slot-main" data-pt="picker" data-slot="${i}" aria-expanded="${open}">
          <span class="mt-slot">${markOf(num)}PLAYER ${num}</span>
          ${big(p ? p.name.toUpperCase() : 'TAP TO PICK', 'pt-slot-name')}
          ${p ? (profileChip(this.profiles[p.id]) || '<span class="mt-chip"><b class="mt-rank">NEW CHALLENGER</b></span>') : ''}
        </button>
        ${num > 2 && i === n - 1 ? `<button type="button" class="pt-slot-x" data-pt="remove-slot" aria-label="Remove player ${num}">×</button>` : ''}
        ${p ? `<div class="pt-help" title="${esc(info.text)}">
          <span class="pt-help-k">HELP</span>
          <div class="pt-help-seg">${[0, 1, 2, 3].map((v) => `<button type="button" class="${v === lv ? 'on' : ''} ${v === sug && sug > 0 && v !== lv ? 'pt-sug' : ''}" data-pt="help" data-id="${esc(p.id)}" data-val="${v}" aria-pressed="${v === lv}">${v === 0 ? 'OFF' : v}</button>`).join('')}</div>
          <span class="pt-help-t ${lv ? 'on' : ''}">${esc(lv ? info.text : sug > 0 ? `SUGGESTED FOR THIS LOBBY: HELP ${sug}` : 'NO HELP · PLAYS IT STRAIGHT')}</span>
        </div>` : ''}
        ${open ? `<div class="mt-picker pt-picker ${arr === 'picker' ? 'mt-arrive' : ''}">
          <div class="mt-roster">${list || '<span class="mt-roster-none">NO PLAYERS YET</span>'}</div>
          <form class="mt-add pt-add" data-slot="${i}"><input class="mt-add-in" name="name" maxlength="24" placeholder="NEW PLAYER NAME" autocomplete="off" aria-label="New player name"><button type="submit" class="mt-btn mt-btn-sm">ADD</button></form>
        </div>` : ''}
      </div>`;
    };
    const fcard = (x) => `<button type="button" class="mt-fcard pt-fcard ${x.id === pk.format ? `on ${arr === 'format' ? 'mt-arrive' : ''}` : ''}" data-pt="format" data-val="${x.id}" aria-pressed="${x.id === pk.format}">
        ${big(x.label)}<span class="mt-fsub">${x.sub}</span><em>${x.blurb}</em></button>`;
    const seg = (key, opts, cur = pk[key]) => `<div class="mt-seg">${opts.map(([val, label]) => `<button type="button" class="${String(cur ?? '') === String(val) ? `on ${arr === `opt-${key}` ? 'mt-arrive' : ''}` : ''}" data-pt="opt" data-key="${key}" data-val="${esc(val)}">${esc(label)}</button>`).join('')}</div>`;
    // how long, and where: one row (the stages by name: a party needs its room for four players)
    const shown = stages.filter((s) => (s.order || 0) <= 9).slice(0, Math.min(holes, 9));
    const names = (shown.length ? shown : stages.slice(0, holes)).map((s) => String(s.name || s.id).toUpperCase());
    const where = !stages.length ? 'THE COURSE THAT IS LOADED'
      : pk.order === 'shuffle' ? `${Math.min(holes, stages.length)} STAGES OF THE CLASH TOUR · SHUFFLED`
        : names.length <= 3 ? names.join(' › ') : `${names[0]} › ${names[1]} › … › ${names[names.length - 1]}`;
    const lengthRow = `<div class="pt-length">
        <span class="mt-row-h">HOW LONG</span>
        ${pk.format === 'elim'
          ? `<div class="pt-length-fixed"><b>${n - 1} HOLE${n - 1 === 1 ? '' : 'S'}</b><span>ONE PLAYER OUT ON EACH</span></div>`
          : seg('holes', [[3, '3 HOLES'], [6, '6 HOLES'], [9, '9 HOLES']])}
        <div class="pt-where"><span>${pk.order === 'shuffle' || !stages.length ? 'WHERE' : 'THE CLASH TOUR · IN ORDER'}</span><b>${esc(where)}</b></div>
      </div>`;
    const stageRow = '<div class="pt-gap"></div>';
    const ids = this._partyIds();
    const can = ids.length === n && new Set(ids).size === n && !this.active && !ui.busy;
    const helped = ids.filter((id) => this._helpLevel(id) > 0).length;
    const summary = [pk.powerups === 'off' ? 'NO POWER-UPS' : pk.powerups === 'unlimited' ? 'UNLIMITED POWER-UPS' : 'POWER-UP LOADOUT', pk.order === 'shuffle' ? 'SHUFFLED STAGES' : '', pk.hazardLosesHole ? 'HAZARD: OUT OF THE HOLE' : '', pk.putting === 'easy' ? 'EASY PUTTING' : pk.putting === 'off' ? 'REAL PUTTING' : '', helped ? `${helped} WITH HELP` : ''].filter(Boolean).join(' · ');
    const html = `
      <div class="mt-bg pt-lobby-bg" aria-hidden="true"><i class="pt-bg-a"></i><i class="pt-bg-b"></i><i class="mt-dots"></i></div>
      <header class="mt-lobby-head">
        <div class="mt-logo"><span class="mt-x">PARTY</span><em>2 TO 4 PLAYERS · REAL SWINGS · ONE BAY</em></div>
        <button type="button" class="mt-x-btn" data-mt="close-lobby" aria-label="Close">×</button>
      </header>
      <div class="pt-slots pt-n${n}">${[0, 1, 2, 3].map(slot).join('')}</div>
      ${this.active ? this._lobbyLive() : ''}
      ${this.players.length < 2 ? '<button type="button" class="mt-btn mt-quick2" data-mt="quick-two">ONE TAP: PLAYER 1 AND PLAYER 2</button>' : ''}
      <div class="mt-fcards pt-fcards">${PARTY_CARDS.map(fcard).join('')}</div>
      ${lengthRow}
      ${stageRow}
      <footer class="mt-lobby-foot">
        <button type="button" class="mt-btn mt-opts-btn" data-mt="drawer" aria-expanded="${ui.drawer}"><b>OPTIONS</b><span>${esc(summary)}</span></button>
        ${ui.error ? `<p class="mt-error ${arr === 'error' ? 'mt-arrive' : ''}" role="alert">${esc(ui.error)}</p>` : ''}
        <button type="button" class="mt-btn mt-btn-go mt-start" data-mt="start" ${can ? '' : 'disabled'}>${ui.busy ? 'GET READY…' : this.active ? 'GAME IN PLAY' : 'START'}</button>
      </footer>
      <aside class="mt-drawer ${ui.drawer ? 'mt-open' : ''}" aria-hidden="${!ui.drawer}">
        <header><span class="mt-x">OPTIONS</span><button type="button" class="mt-x-btn" data-mt="drawer" aria-label="Close options">×</button></header>
        <div class="mt-opt"><span>POWER-UPS</span>${seg('powerups', [['loadout', 'LOADOUT'], ['unlimited', 'UNLIMITED'], ['off', 'OFF']])}</div>
        <div class="mt-opt"><span>STAGE ORDER</span>${seg('order', [['tour', 'TOUR'], ['shuffle', 'SHUFFLE']])}</div>
        <div class="mt-opt" title="A ball in the water or out of bounds is out of the hole at once."><span>HAZARD: OUT OF THE HOLE</span>${seg('hazardLosesHole', [['false', 'OFF'], ['true', 'ON']], String(!!pk.hazardLosesHole))}</div>
        <div class="mt-opt" title="How much the game helps a putt, for everybody. A player with HELP putts on EASY whatever this says."><span>PUTTING</span>${seg('putting', [['easy', 'EASY'], ['assist', 'ASSISTED'], ['off', 'REAL']])}</div>
        <p class="pt-drawer-note">HELP (ON EACH PLAYER'S CARD) IS A HANDICAP: EASY PUTTING AND AN EXTRA POWER-UP, THEN A FORWARD TEE.</p>
      </aside>`;
    this._show('lobby', html);
    this.screen.classList.add('pt-s-lobby');
    this.screen.classList.toggle('mt-enter', ui.fresh);
    this.screen.classList.toggle('mt-drawer-open', ui.drawer);
    ui.fresh = false;
    const form = this.screen.querySelector('.pt-add');
    if (form) {
      form.addEventListener('submit', (e) => { e.preventDefault(); this._cue('ui-confirm'); this._addPartyPlayer(+form.dataset.slot, form.elements.name.value); });
      form.elements.name.focus({ preventScroll: true });
    }
  }
  _setPartySlot(i, id) {
    const pk = this.ppick;
    const at = pk.ids.findIndex((x, j) => j < pk.count && x === id);
    if (at >= 0 && at !== i) pk.ids[at] = pk.ids[i];   // swap rather than pick one twice
    pk.ids[i] = id;
    this.lobbyUi.picker = null;
    this.lobbyUi.arrive = `slot-${i}`;
    this._saveParty();
    this._suggest().then(() => { if (this.lobbyOpen && this.lobbyKind === 'party') this._renderLobby(); });
  }
  async _addPartyPlayer(i, name) {
    const p = await this._ensurePlayer(name);
    if (p) this._setPartySlot(i, p.id);
    if (this.lobbyOpen) this._renderLobby();
  }
  async _quickTwo() {
    if (this.lobbyKind !== 'party') return super._quickTwo();
    const a = await this._ensurePlayer('Player 1');
    const b = await this._ensurePlayer('Player 2');
    if (a) this.ppick.ids[0] = a.id;
    if (b) this.ppick.ids[1] = b.id;
    this.ppick.count = Math.max(2, this.ppick.count);
    this._fixParty();
    this._saveParty();
    if (this.lobbyOpen) this._renderLobby();
  }
  async _startFromLobby() {
    if (this.lobbyKind !== 'party') return super._startFromLobby();
    const ui = this.lobbyUi, pk = this.ppick;
    const ids = this._partyIds();
    if (ui.busy) return;
    if (ids.length !== pk.count || new Set(ids).size !== ids.length) { this._cue('ui-error'); return; }
    this._cue('start-match');
    ui.busy = true; ui.error = '';
    this._renderLobby();
    const names = Promise.allSettled(ids.map((id) => this.players.find((p) => p.id === id)).filter(Boolean).map((p) => Promise.resolve(this.fetchJson('/api/voice/name', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: p.name }) })).catch(() => null)));
    await Promise.race([names, new Promise((res) => setTimeout(res, 2500))]);
    const help = {};
    for (const id of ids) if (this._helpLevel(id) > 0) help[id] = this._helpLevel(id);
    const out = await this.start({
      playerIds: ids, format: pk.format, holes: pk.holes,
      stage: this._stages().length ? undefined : 'current',
      order: pk.order, powerups: pk.powerups, hazardLosesHole: !!pk.hazardLosesHole,
      putting: ['easy', 'assist', 'off'].includes(pk.putting) ? pk.putting : 'assist', help,
    });
    ui.busy = false;
    if (out && out.match && (!this.match || this.match.id !== out.match.id)) this.onMatch(out.match);
    else if (this.lobbyOpen) { if (!out || !out.match) this._cue('ui-error'); this._renderLobby(); }
  }
  _lobbyLive() {
    const m = this.match;
    if (!isParty(m)) return super._lobbyLive();
    const ask = !!this.lobbyUi.quitAsk;
    return `<div class="mt-live ${ask ? 'mt-live-ask' : ''}" role="status">
      <span class="mt-live-t"><b>${ask ? 'QUIT THIS GAME?' : 'GAME IN PLAY'}</b><em>${esc(partyLine(m))} · ${esc(String(m.standings || '').toUpperCase())}</em></span>
      ${ask
        ? '<button type="button" class="mt-btn mt-live-quit" data-mt="lobby-quit">YES, QUIT</button><button type="button" class="mt-btn mt-btn-dim" data-mt="lobby-quit-no">NO</button>'
        : '<button type="button" class="mt-btn mt-btn-go" data-mt="lobby-resume">RESUME</button><button type="button" class="mt-btn mt-live-quit" data-mt="lobby-quit">QUIT GAME</button>'}
    </div>`;
  }

  // ---------- clicks and keys of the party's own controls ----------
  async _click(e) {
    const t = e.target;
    const b = t.closest ? t.closest('[data-pt]') : null;
    if (!b) return super._click(e);
    const pk = this.ppick, ui = this.lobbyUi;
    switch (b.dataset.pt) {
      case 'picker': {
        const key = `s${b.dataset.slot}`;
        if (ui.picker === key) { this._cue('ui-back'); ui.picker = null; } else { this._cue('ui-tick'); ui.picker = key; ui.arrive = 'picker'; }
        this._renderLobby();
        break;
      }
      case 'pick': this._cue('select-player'); this._setPartySlot(+b.dataset.slot, b.dataset.id); this._renderLobby(); break;
      case 'add-slot': {
        if (pk.count >= 4) break;
        this._cue('select-player');
        pk.count++;
        this._fixParty();
        ui.arrive = `slot-${pk.count - 1}`;
        if (!pk.ids[pk.count - 1]) ui.picker = `s${pk.count - 1}`;   // nobody left in the roster: ask for a name
        this._saveParty();
        await this._suggest();
        this._renderLobby();
        break;
      }
      case 'remove-slot': if (pk.count > 2) { this._cue('ui-back'); pk.count--; ui.picker = null; this._saveParty(); await this._suggest(); this._renderLobby(); } break;
      case 'format': this._cue('select-format'); pk.format = b.dataset.val; ui.arrive = 'format'; this._saveParty(); this._renderLobby(); break;
      case 'help': {
        const v = Math.max(0, Math.min(3, +b.dataset.val || 0));
        this._cue(v ? 'toggle-on' : 'toggle-off');
        if (v) pk.help[b.dataset.id] = v; else delete pk.help[b.dataset.id];
        this._saveParty(); this._renderLobby();
        break;
      }
      case 'opt': {
        const k = b.dataset.key, v = b.dataset.val;
        this._cue((v === 'false' || v === 'off') && k !== 'putting' ? 'toggle-off' : 'toggle-on');
        ui.arrive = `opt-${k}`;
        pk[k] = k === 'hazardLosesHole' ? v === 'true' : k === 'holes' ? +v : v;
        this._saveParty(); this._renderLobby();
        break;
      }
      case 'target': this._cycleTarget(b.dataset.id || null); break;
      case 'play-again': b.disabled = true; this._cue('ui-confirm'); if (!(await this.rematch()) && b.isConnected) b.disabled = false; break;
      case 'new-game': this._cue('ui-confirm'); await this.abort(); this.onMatch(null); this.openPartyLobby(); break;
      default: break;
    }
  }
  _key(e) {
    // X: the player who is up picks who their trick is for (three or more in the game)
    const m = this.match;
    if (isParty(m) && !this.menuUi.open && !this._screenKind && (m.phase === 'play' || m.phase === 'tiebreak') && String(e.key || '').toLowerCase() === 'x'
      && !e.ctrlKey && !e.metaKey && !e.altKey && !(e.target && e.target.closest && e.target.closest('input, textarea, select'))) {
      if (alivePlayers(m).length > 2 && !this.targetEl.classList.contains('hidden')) { e.stopPropagation(); e.preventDefault(); if (!e.repeat) this._cycleTarget(); return; }
    }
    return super._key(e);
  }

  // ---------- the trick target ----------
  /** The match state as the ball dock should see it: with who the player who is up would cast a trick on. */
  dockState(m = this.match) {
    if (!isParty(m) || !m.currentPlayerId) return m;
    return { ...m, targetId: defaultTarget(m, m.currentPlayerId, this.targetId) };
  }
  _cycleTarget(id = null) {
    const m = this.match;
    if (!isParty(m) || !m.currentPlayerId) return;
    const field = alivePlayers(m).filter((p) => p.id !== m.currentPlayerId);
    if (!field.length) return;
    const cur = defaultTarget(m, m.currentPlayerId, this.targetId);
    const next = id && field.some((p) => p.id === id) ? id : field[(field.findIndex((p) => p.id === cur) + 1) % field.length].id;
    this.targetId = next;
    this._cue('ui-tick');
    this._renderTarget(m);
    try { if (typeof this.onDockChange === 'function') this.onDockChange(); } catch (_) { /* the dock catches up with the next state */ }
  }
  /** The TARGET chip: while the player who is up has a trick to cast and more than one opponent to cast it on. */
  _renderTarget(m) {
    const el = this.targetEl;
    const up = isParty(m) && (m.phase === 'play' || m.phase === 'tiebreak') ? playerOf(m, m.currentPlayerId) : null;
    const field = up ? alivePlayers(m).filter((p) => p.id !== up.id) : [];
    const tricks = (this.catalogue || []).filter((c) => c && c.kind === 'trick');
    const canCast = up && m.options && m.options.powerups !== 'off' && tricks.length && (up.charges == null || up.charges > 0);
    if (!up || field.length < 2 || !canCast || this._screenKind) { el.className = 'pt-target hidden'; el.innerHTML = ''; return; }
    const cur = defaultTarget(m, up.id, this.targetId);
    el.className = 'pt-target';
    el.innerHTML = `<span class="pt-target-k">SABOTAGE GOES TO</span>${field.map((p) => {
      const s = slotOf(m, p.id);
      return `<button type="button" class="pt-target-b ${pcls(s)} ${p.id === cur ? 'on' : ''}" data-pt="target" data-id="${esc(p.id)}" aria-pressed="${p.id === cur}">${markOf(s)}${esc(shout(p.name))}${p.cursedWith ? '<em>CURSED</em>' : ''}</button>`;
    }).join('')}<kbd>X</kbd>`;
  }

  // ---------- data in ----------
  onMatch(state) {
    const was = this.match;
    super.onMatch(state);
    const m = this.match;
    this.root.classList.toggle('pt-live', isParty(m));
    if (!m || !was || was.currentPlayerId !== m.currentPlayerId || was.id !== m.id) this.targetId = null;   // a new player is up: their own choice
    this._renderTarget(m);
  }
  _sync() { super._sync(); if (this.targetEl) this._renderTarget(this.match); }
  _onEvent(e, m) {
    if (!isParty(m)) return super._onEvent(e, m);
    switch (e.type) {
      case 'coin-flip': this._mem.coin = e.winnerId ?? null; break;
      case 'tiebreak-again':
        this._flash({ kicker: 'SUDDEN DEATH', text: 'AGAIN!', sub: Array.isArray(e.playerIds) && e.playerIds.length < ((m.tiebreak && m.tiebreak.results) || []).filter((r) => r.round === e.round - 1).length
          ? `${e.playerIds.map((id) => shout((playerOf(m, id) || {}).name)).join(' · ')} GO AGAIN` : 'STILL NOTHING IN IT. ONE MORE BALL EACH.', tone: 'again', delay: 900, ms: 2000, onShow: () => this._cue('whoosh') });
        break;
      case 'picked-up': {
        const p = playerOf(m, e.playerId);
        if (p) this._flash({ kicker: shout(p.name), text: e.reason === 'hazard' ? 'OUT OF THE HOLE' : 'PICKS UP', sub: e.reason === 'hazard' ? 'HAZARD' : m.party === 'elim' ? 'NOTHING LEFT TO SAVE THE HOLE WITH' : 'CAN\'T CATCH THE SCORE THAT IS IN', tone: `p${slotOf(m, p.id)}`, delay: 1500, ms: 1500, onShow: () => this._cue('sting-fail') });
        break;
      }
      case 'final-two':
        this._mem.finalDue = true;
        break;
      case 'player-left': {
        const p = playerOf(m, e.playerId);
        if (p) this._flash({ kicker: shout(p.name), text: 'LEAVES THE GAME', sub: 'THE OTHERS PLAY ON', tone: 'gold', ms: 1700 });
        break;
      }
      case 'match-point': break;   // a party has none
      default: super._onEvent(e, m); break;
    }
  }

  // ---------- intro ----------
  _screenVs(m) {
    if (!isParty(m)) return super._screenVs(m);
    this._mem.vsDone = true;
    const card = partyCard(m.party);
    const players = bySlot(m);
    const order = (Array.isArray(m.teeOrder) && m.teeOrder.length ? m.teeOrder : players.map((p) => p.id)).map((id) => playerOf(m, id)).filter(Boolean);
    const first = playerOf(m, this._mem.coin ?? m.honourId) || order[0] || players[0];
    const rule = m.party === 'elim' ? `${m.maxHoles} HOLE${m.maxHoles === 1 ? '' : 'S'} · HIGHEST SCORE IS OUT` : `${m.maxHoles} HOLES · ${m.party === 'skins' ? 'A SKIN ON EVERY HOLE' : 'LOWEST TOTAL WINS'}`;
    this._show('vs', `
      <div class="mt-bg pt-field-bg pt-n${players.length}" aria-hidden="true">${players.map((p) => `<i class="pt-stripe ${pcls(slotOf(m, p.id))}"></i>`).join('')}<i class="mt-dots"></i></div>
      <div class="mt-vs-format pt-field-format"><b>${esc(card.label)}</b><span>${esc(rule)}</span></div>
      <div class="pt-field pt-n${players.length}">
        ${players.map((p, i) => { const s = slotOf(m, p.id); const h = p.help && p.help.level ? `<span class="pt-field-help">${esc(p.help.label || 'HELP')}</span>` : ''; return `<div class="pt-field-p ${pcls(s)}" style="--i:${i}">
          <span class="mt-slot">${markOf(s)}PLAYER ${s}</span>
          ${big(shout(p.name), 'pt-field-name')}
          ${profileChip(p.profile || this.profiles[p.id])}${h}
        </div>`; }).join('')}
      </div>
      <div class="pt-draw ${pcls(slotOf(m, first.id))}">
        <span>THE DRAW</span><b>${esc(shout(first.name))} HAS THE HONOUR</b>
        <em>${order.map((p) => esc(shout(p.name))).join(' › ')}</em>
      </div>
      <span class="mt-skip">ANY KEY TO SKIP</span>`);
    this.screen.classList.add('pt-s-field');
    this._cue('whoosh');
    this._after(520, () => { this._shake(); this._moment({ impact: 'vs-slam', say: card.voice }); }, this._stepTimers);
    this._after(this.reduced ? 900 : 2300, () => this._cue('coin-land'), this._stepTimers);
    return 4100;
  }
  /** The strip of standings on the stage card and the result screen: every player, the leader first. */
  _standingsStrip(m, { cls = '' } = {}) {
    return `<div class="pt-strip ${cls} pt-n${m.players.length}">${partyRanking(m).map((p) => {
      const s = slotOf(m, p.id); const f = partyFigure(m, p);
      return `<div class="pt-strip-p ${pcls(s)} ${p.out ? 'pt-out' : ''}">${markOf(s)}<span>${esc(shout(p.name))}</span><b>${esc(f.big)}</b><em>${esc(f.label)}</em></div>`;
    }).join('')}</div>`;
  }
  _screenStage(m) {
    if (!isParty(m)) return super._screenStage(m);
    const st = introStage(m) || { name: 'NEXT HOLE', kind: 'match' };
    const n = introHoleNumber(m);
    const max = m.maxHoles || 1;
    const last = max > 1 && n >= max;
    const hon = playerOf(m, m.honourId ?? m.currentPlayerId);
    const tourEntry = ((this.tour && this.tour.stages) || []).find((x) => x.id === st.id) || {};
    const freeId = st.freeBall || tourEntry.freeBall || null;
    const free = freeId ? ballInfo(freeId, this.catalogue) : null;
    const routes = stageRoutes(st.routes ? st : tourEntry);
    const diff = st.difficulty ? `<span class="mt-diff" aria-label="Difficulty ${st.difficulty} of 3">${[1, 2, 3].map((i) => `<i class="${i <= st.difficulty ? 'on' : ''}"></i>`).join('')}</span>` : '';
    const final2 = m.party === 'elim' && alivePlayers(m).length === 2 && m.players.length > 2;
    const hot = m.party === 'skins' && (m.skinsAtStake || 1) > 1 ? `<span class="mt-tag mt-tag-hot">${m.skinsAtStake} SKINS ON THIS HOLE</span>`
      : final2 ? '<span class="mt-tag mt-tag-hot">THE FINAL</span>' : last && m.party !== 'elim' ? '<span class="mt-tag mt-tag-hot">FINAL HOLE</span>' : '';
    const fwd = m.players.filter((p) => !p.out && p.teeYd);
    this._show('stage', `
      <div class="mt-bg mt-stage-bg" aria-hidden="true"><i class="mt-stage-sky"></i>${silhouette(st.theme)}<i class="mt-stage-slab"></i><i class="mt-dots"></i></div>
      <div class="mt-stage-no" aria-hidden="true">${String(n).padStart(2, '0')}</div>
      <div class="mt-stage-top">
        <span class="mt-tag">${esc(partyCard(m.party).label)} · ${m.party === 'elim' ? `${alivePlayers(m).length} LEFT` : `HOLE ${n} OF ${max}`}</span>
        ${hot}
      </div>
      <div class="mt-stage-main">
        <span class="mt-stage-kicker">HOLE ${n}</span>
        ${big(String(st.name || '').toUpperCase(), 'mt-stage-name')}
        <div class="mt-stage-facts">${st.par ? `<b>PAR ${esc(st.par)}</b>` : ''}${st.lengthYd ? `<b>${Math.round(st.lengthYd)} YD</b>` : ''}${diff}</div>
        ${st.blurb ? `<p class="mt-stage-blurb">${esc(st.blurb)}</p>` : ''}
        ${routes.length ? `<div class="mt-routes">${routes.map((r, i) => `<span class="mt-route mt-route-${r.id}" style="--d:${(0.95 + i * 0.13).toFixed(2)}s"><b>${r.label}</b><em>${esc(r.name)}</em></span>`).join('')}</div>` : ''}
        <div class="mt-gadgets" data-stage="${esc(st.id || '')}">${this._gadgetChips(st.id)}</div>
      </div>
      ${free ? `<div class="mt-rocket" style="--c:${esc(free.color)}"><i aria-hidden="true">${esc(free.emoji || '🚀')}</i>${big(`${ballWord(free.id)} HOLE`, 'mt-rocket-t')}<span>FREE ${esc(ballWord(free.id))} BALL ON THE TEE</span></div>` : ''}
      ${windChip(st.wind || tourEntry.wind)}
      <div class="mt-stage-foot pt-stage-foot">
        ${this._standingsStrip(m)}
        <div class="pt-stage-line">${hon ? `<span class="mt-honour ${pcls(slotOf(m, hon.id))}"><i></i>${esc(shout(hon.name))} TEES OFF</span>` : ''}${fwd.map((p) => `<span class="pt-fwd ${pcls(slotOf(m, p.id))}">${markOf(slotOf(m, p.id))}${esc(shout(p.name))} · FORWARD TEE · ${Math.round(p.teeYd)} YD</span>`).join('')}</div>
      </div>
      <div class="mt-ready"><i></i></div>
      <span class="mt-loading">LOADING THE COURSE</span>
      <span class="mt-skip">ANY KEY TO SKIP</span>`, { style: themeStyle(st) });
    const ms = this._mem.stageShown ? 4000 : 3600;
    this._mem.stageShown = true;
    this.screen.style.setProperty('--ms', `${ms}ms`);
    const line = [];
    if (final2) line.push('p-the-final'); else if (last && m.party !== 'elim') line.push('m-final-hole'); else if (n >= 1 && n <= 9) line.push(`m-hole-${n}`);
    if (st.id) line.push(`stage-${st.id}`);
    this._moment({ impact: 'whoosh', say: line.length ? line : null });
    this._after(this.reduced ? 0 : 700, () => this._cue(/^[a-z]+$/.test(st.theme || '') ? `stage-sting-${st.theme}` : 'stage-sting'), this._stepTimers);
    if (free) this._after(1480, () => { this._shake(); this._moment({ impact: 'arm-epic', say: `pu-${free.id}` }); }, this._stepTimers);
    return ms;
  }
  _screenSudden(m) {
    if (!isParty(m)) return super._screenSudden(m);
    const st = introStage(m) || {};
    const tb = m.tiebreak || {};
    const round = tb.round || 1;
    // who is in it: the live round, or (while the arena loads) the players the result named
    const lastEv = [...(m.events || [])].reverse().find((e) => e.type === 'hole-tied' && Array.isArray(e.playerIds));
    const ids = Array.isArray(tb.ids) && tb.ids.length && m.phase !== 'loading' ? tb.ids : lastEv ? lastEv.playerIds : alivePlayers(m).map((p) => p.id);
    const goal = (m.phase !== 'loading' && tb.goal) || (lastEv && lastEv.goal) || (m.party === 'elim' ? 'worst' : 'best');
    const inIt = ids.map((id) => playerOf(m, id)).filter(Boolean);
    this._show('sudden', `
      <div class="mt-bg mt-sd-bg" aria-hidden="true"><i class="mt-sd-slash mt-sd-1"></i><i class="mt-sd-slash mt-sd-2"></i><i class="mt-dots"></i></div>
      <div class="mt-sd-main">
        <span class="mt-x mt-sd-a">SUDDEN</span>
        <span class="mt-x mt-sd-b">DEATH</span>
        <span class="mt-sd-ctp">${goal === 'worst' ? 'FARTHEST FROM THE PIN IS OUT' : 'CLOSEST TO THE PIN'}</span>
      </div>
      <div class="mt-sd-arena" style="${themeStyle(st)}">
        <span>THE ARENA${round > 1 ? ` · ROUND ${round}` : ''}</span>
        <b>${esc(String(st.name || 'THE SHOOTOUT').toUpperCase())}</b>
        <em>${[stageFacts(st), 'ONE BALL EACH', goal === 'worst' ? 'FARTHEST GOES' : 'NEAREST WINS'].filter(Boolean).join(' · ')}</em>
      </div>
      <div class="mt-sd-vs pt-sd-vs">${inIt.map((p) => `<b class="${pcls(slotOf(m, p.id))}">${markOf(slotOf(m, p.id))}${esc(shout(p.name))}</b>`).join('<i>·</i>')}</div>
      ${windChip(st.wind)}
      <span class="mt-loading">LOADING THE ARENA</span>
      <span class="mt-skip">ANY KEY TO SKIP</span>`);
    this._cue('drumroll');
    this._after(1380, () => { this._shake(); this._say('m-sudden-death', { priority: 2 }); }, this._stepTimers);
    this._after(2350, () => this._say(goal === 'worst' ? 'p-farthest-is-out' : 'm-closest-to-the-pin'), this._stepTimers);
    return 4300;
  }

  // ---------- in play ----------
  _play(m, prev) {
    if (!isParty(m)) return super._play(m, prev);
    this._renderHeader(m);
    this._renderTicker(m);
    this._syncClock();
    const up = playerOf(m, m.currentPlayerId);
    const holeKey = `${m.id}|${m.phase}|${(m.holeResults || []).length}`;
    const afterShot = !!(prev && prev.phase === m.phase && this._mem.holeKey === holeKey);
    if (this._mem.holeKey !== holeKey) { this._mem.holeKey = holeKey; this._mem.turnKey = null; }
    let delay = afterShot ? 1700 : 480;
    if (this._mem.finalDue && m.phase === 'play') {
      this._mem.finalDue = false;
      this._flash({ kicker: alivePlayers(m).map((p) => shout(p.name)).join(' V '), text: 'THE FINAL', sub: 'THE HIGHER SCORE IS OUT', tone: 'gold', delay, ms: 1800, onShow: () => this._moment({ impact: 'whoosh', say: 'p-the-final' }) });
      delay = 150;
    }
    if (!up) return;
    const turnKey = `${holeKey}|${(m.tiebreak && m.tiebreak.round) || 0}|${up.id}|${up.mustHole ? 1 : 0}|${up.shotFor || ''}|${up.shotKind || ''}`;
    if (turnKey === this._mem.turnKey) return;
    this._mem.turnKey = turnKey;
    const need = partyNeed(m, up);
    const slot = slotOf(m, up.id);
    this._flash({
      turn: true, kicker: `PLAYER ${slot}`, text: need.stake ? `${shout(up.name)}'S UP` : `${shout(up.name)}, YOU'RE UP`, sub: need.text, tone: `p${slot}`, need: need.tone, delay, ms: need.tone === 'must' || need.stake ? 3000 : 2500,
      onShow: () => {
        if (need.stake) { this._moment({ impact: 'heartbeat-hit', say: [voiceName(m, up), need.stake.voice], priority: 2 }); if (need.stake.for === 'tie') this._shake(this.banner); return; }
        const must = need.tone === 'must' && m.phase === 'play';
        this._moment({ impact: must ? 'heartbeat-hit' : 'turn-chime', say: [voiceName(m, up), must ? 'm-must-hole' : 'm-youre-up'] });
        if (need.tone === 'must') this._shake(this.banner);
      },
    });
  }

  _renderHeader(m, { final = null } = {}) {
    if (!isParty(m)) return super._renderHeader(m, { final });
    const h = this.header;
    const duel = m.phase === 'tiebreak' || !!final;
    const players = bySlot(m);
    const dv = duel ? duelView(m) : null;
    const tb = m.tiebreak || null;
    const inDuel = duel ? new Set((tb && Array.isArray(tb.ids) ? tb.ids : []).concat((tb && tb.results ? tb.results : []).map((r) => r.playerId))) : null;
    const st = m.stage || {};
    const pop = this._mem.pop;
    this._mem.pop = null;
    const vals = {};
    const upNow = playerOf(m, m.currentPlayerId);
    const fogged = !!(upNow && upNow.cursedWith === 'fog' && !final);
    const card = (p) => {
      const slot = slotOf(m, p.id);
      const up = !final && p.id === m.currentPlayerId;
      const was = (this._mem.hdrVals || {})[p.id] || null;
      const dist = p.holed ? 'IN' : fogged ? '???' : toGoText(p.distToPinYd);
      vals[p.id] = { s: p.strokes || 0, d: dist, up };
      const bumpS = was && was.s !== (p.strokes || 0) ? 'mt-bump' : '';
      const bumpD = was && was.d !== dist ? 'mt-bump' : '';
      const turned = was && up && !was.up ? 'mt-turned' : '';
      const fig = partyFigure(m, p);
      const status = partyStatus(m, p);
      let nums;
      if (dv) {
        const playing = inDuel.has(p.id);
        const c = playing ? (dv.cells[p.id] || { state: 'wait' }) : { state: 'none' };
        const txt = c.state === 'ft' ? ftText(c.ft) : c.state === 'in' ? 'IN!' : c.state === 'miss' ? 'MISS' : c.state === 'none' ? (p.out ? 'OUT' : 'SAFE') : '– –';
        const sub = c.state === 'miss' ? (c.miss === 'water' ? 'IN THE WATER' : c.miss === 'ob' ? 'OUT OF BOUNDS' : 'NO DISTANCE') : c.state === 'none' ? (p.out ? '' : 'NOT IN THIS ONE') : 'TO THE PIN';
        nums = `<div class="pt-duel pt-d-${c.state} ${pop === p.id || final ? 'mt-pop' : ''}"><b>${esc(txt)}</b><span>${sub}</span></div>`;
      } else if (p.out) {
        nums = `<div class="pt-gone"><b>${p.left ? 'LEFT' : 'OUT'}</b><span>${p.place ? ordinal(p.place) : ''}</span></div>`;
      } else {
        nums = `<div class="pt-num"><b class="${bumpS}">${p.strokes || 0}</b><span>STROKES</span></div>
          <div class="pt-num pt-num-d"><b class="${bumpD}" ${fogged || p.holed ? '' : 'data-yardage'}>${esc(dist)}</b><span>TO PIN</span></div>`;
      }
      const stake = up ? partyStakeView(m, p) : null;
      const tag = final ? (final === p.id ? `<span class="mt-uptag mt-wintag">${(tb && tb.goal) === 'worst' || (m.lastResult && m.lastResult.tiebreak && m.lastResult.tiebreak.goal === 'worst') ? 'FARTHEST: OUT' : 'CLOSEST!'}</span>` : '')
        : stake ? `<span class="mt-uptag mt-staketag mt-stake-${stake.for}">${markOf(slot)}${esc(stake.text)}</span>`
          : p.mustHole && up ? `<span class="mt-uptag mt-musttag">${markOf(slot)}MUST MAKE</span>`
            : up ? `<span class="mt-uptag">${markOf(slot)}UP NOW</span>`
              : status && !dv ? `<span class="mt-uptag pt-status pt-status-${status.tone}">${esc(status.text)}</span>` : '';
      const armed = p.armedPowerup ? `<i class="mt-armed" title="Armed">${esc(ballInfo(p.armedPowerup, this.catalogue).emoji || '⚡')}</i>` : '';
      const cursed = p.cursedWith ? `<i class="mt-armed mt-cursed" title="Sabotaged">${esc(ballInfo(p.cursedWith, this.catalogue).emoji || '☠')}</i>` : '';
      const help = p.help && p.help.level ? `<i class="pt-hcp" title="${esc(p.help.text || 'Help')}">H${p.help.level}</i>` : '';
      const dim = p.out || (dv && !inDuel.has(p.id)) || (!dv && (p.pickedUp || p.capped));
      return `<div class="pt-card ${pcls(slot)} ${up ? 'pt-up mt-up' : ''} ${turned} ${dim ? 'pt-dim' : ''} ${final && final === p.id ? 'pt-final' : ''}" data-player="${esc(p.id)}">
        <i class="pt-card-bg"></i>
        <div class="pt-card-top"><span class="pt-badge">${markOf(slot)}<b>P${slot}</b></span><span class="pt-name">${esc(shout(p.name))}</span>${armed}${cursed}${help}</div>
        <div class="pt-card-nums">${nums}<div class="pt-fig ${m.party === 'elim' && !p.out ? 'pt-fig-in' : ''}"><b>${esc(fig.big)}</b><span>${esc(fig.label)}</span></div></div>
        ${tag}
      </div>`;
    };
    const n = m.holeNumber || (m.holeResults || []).length + 1;
    const mid = duel
      ? `<span class="mt-mid-top mt-mid-sd">SUDDEN DEATH</span><b class="mt-mid-big">RD ${dv.round}</b><span class="mt-mid-stage">${esc(String(st.name || 'CLOSEST TO THE PIN').toUpperCase())}</span>${windBadge(st.wind)}`
      : `<span class="mt-mid-top">HOLE ${n}${m.party !== 'elim' ? `/${m.maxHoles}` : ''}${st.par ? ` · PAR ${st.par}` : ''}</span>
         <b class="mt-mid-big pt-mid-big">${m.party === 'skins' ? `${m.skinsAtStake || 1}<em>${(m.skinsAtStake || 1) === 1 ? 'SKIN' : 'SKINS'}</em>` : m.party === 'elim' ? `${alivePlayers(m).length}<em>LEFT</em>` : 'RACE'}</b>
         <span class="mt-mid-stage">${esc(String(st.name || '').toUpperCase())}</span>${windBadge(st.wind)}`;
    clearTimeout(this._hdrLeave);
    this.ticker.classList.remove('mt-leave');
    this._mem.hdrVals = vals;
    const wasHidden = h.classList.contains('hidden') || h.classList.contains('mt-leave');
    const half = Math.ceil(players.length / 2);
    h.className = `mt-hdr pt-hdr pt-n${players.length} ${duel ? 'mt-duel' : ''} ${wasHidden ? 'mt-enter' : ''}`;
    h.innerHTML = `<div class="pt-wing pt-wing-l">${players.slice(0, half).map(card).join('')}</div>
      <div class="mt-mid pt-mid">${mid}${final ? '' : '<button type="button" class="mt-menu-btn" data-mt="menu" title="Game menu: undo a shot, restart, leave (Esc or M)"><i aria-hidden="true"></i>MENU</button>'}</div>
      <div class="pt-wing pt-wing-r">${players.slice(half).map(card).join('')}</div>`;
    this._tick();
  }

  // ---------- hole result ----------
  _holeResult(m, prev) {
    if (!isParty(m)) return super._holeResult(m, prev);
    const r = m.lastResult || (m.holeResults || [])[(m.holeResults || []).length - 1];
    if (!r) return;
    const key = `${m.id}|${r.holeNumber}|${r.reason}|${r.winnerId || ''}|${r.eliminatedId || ''}`;
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
    else if (fromPlay) { this._renderHeader(m); this._after(this._mem.tiedUp ? 2000 : 1100, () => this._screenResult(m, r)); }
    else this._screenResult(m, r);
  }
  _duelFinale(m, r, then) {
    if (!isParty(m)) return super._duelFinale(m, r, then);
    if (this.hud && this.hud.classList) { const hud = this.hud; hud.classList.add('mt-finale'); setTimeout(() => hud.classList.remove('mt-finale'), 3600); }
    const worst = r.tiebreak && r.tiebreak.goal === 'worst';
    const who = playerOf(m, worst ? r.eliminatedId : (r.winnerId || m.winnerId));
    this._renderHeader(m, { final: who ? who.id : null });
    this._renderTicker(m);
    if (who) {
      const v = partyResultView(m, r);
      const mine = v && v.rows.find((x) => x.p.id === who.id);
      this._flash({ kicker: worst ? 'FARTHEST FROM THE PIN' : 'CLOSEST TO THE PIN', text: worst ? `${shout(who.name)} IS OUT` : `${shout(who.name)} TAKES IT`, sub: mine && mine.sd ? mine.sd : '', tone: `p${slotOf(m, who.id)}`, delay: 500, ms: 1700, onShow: () => this._cue(worst ? 'sting-knockout' : 'whoosh') });
    }
    this._after(2500, then);
  }
  _screenResult(m, r) {
    if (!isParty(m)) return super._screenResult(m, r);
    if (!this.match || this.match.id !== m.id) return;
    const v = partyResultView(m, r);
    if (!v) return;
    this._hidePlay();
    const lead = v.winner || v.gone;
    const ws = lead ? slotOf(m, lead.id) : 0;
    const ns = m.nextStage;
    const sd = v.kind === 'tied' || (ns && ns.kind === 'tiebreak');
    const next = sd
      ? `<div class="mt-next mt-next-sd"><span>NEXT</span><b>SUDDEN DEATH</b><em>${ns && ns.name ? esc([String(ns.name).toUpperCase(), ns.lengthYd ? `${Math.round(ns.lengthYd)} YD` : ''].filter(Boolean).join(' · ')) : 'CLOSEST TO THE PIN'}</em></div>`
      : ns ? `<div class="mt-next" style="${themeStyle(ns)}">${silhouette(ns.theme)}<span>NEXT · HOLE ${(m.holeResults || []).length + 1}${ns.freeBall ? ` · ${esc(ballWord(ns.freeBall))} HOLE` : ''}</span><b>${esc(String(ns.name || '').toUpperCase())}</b><em>${esc(stageFacts(ns))}</em></div>`
        : '';
    const rowHtml = (x) => { const s = slotOf(m, x.p.id); return `<div class="pt-res-row ${pcls(s)} ${x.won ? 'pt-res-w' : ''} ${x.gone ? 'pt-res-gone' : ''} ${x.out ? 'pt-res-out' : ''}">
        <span class="pt-res-name">${markOf(s)}${esc(shout(x.p.name))}</span><b class="pt-res-big">${esc(x.big)}</b><span class="pt-res-lab">${esc(x.label)}${x.sd ? `<em>${esc(x.sd)}</em>` : ''}</span></div>`; };
    this._show('result', `
      <div class="mt-bg pt-res-bg pt-kind-${v.kind} ${ws ? pcls(ws) : ''}" aria-hidden="true"><i class="pt-res-slab"></i><i class="pt-res-ink"></i><i class="mt-dots"></i></div>
      <div class="mt-res-top"><span class="mt-tag">HOLE ${esc(v.holeNumber ?? '')}${v.stageName ? ` · ${esc(String(v.stageName).toUpperCase())}` : ''}${v.par ? ` · PAR ${esc(v.par)}` : ''}</span><span class="mt-tag">${esc(partyLine({ ...m, holeNumber: v.holeNumber }))}</span></div>
      <div class="mt-res-head pt-res-head pt-kind-${v.kind} ${ws ? pcls(ws) : 'mt-p0'}">
        ${big(v.title, 'mt-res-title')}
        ${big(v.sub, 'mt-res-sub')}
        ${v.how ? `<span class="mt-res-how">${esc(v.how)}</span>` : ''}
        <div class="pt-res-stand"><span class="mt-row-h">${m.party === 'elim' ? 'WHO IS LEFT' : 'THE STANDINGS'}</span>${this._standingsStrip(m, { cls: 'pt-strip-res' })}</div>
      </div>
      <div class="pt-res-rows pt-n${v.rows.length}">${v.rows.map(rowHtml).join('')}</div>
      <div class="mt-res-foot pt-res-foot">
        <div class="mt-board"></div>
        ${next}
        <button type="button" class="mt-btn mt-btn-go mt-continue" data-mt="continue"><span>${sd ? 'TO SUDDEN DEATH' : 'CONTINUE'}</span><i class="mt-count"></i></button>
      </div>`);
    this.screen.classList.add('pt-s-result');
    const auto = 8000;
    this.screen.style.setProperty('--ms', `${auto}ms`);
    this._cue('whoosh');
    const LAND = 480;
    if (v.kind === 'win') this._after(LAND, () => { this._burst(ws, 0.6); this._moment({ impact: 'confetti-pop', sting: 'fanfare-hole', say: v.winner ? [voiceName(m, v.winner), m.party === 'skins' ? 'p-takes-the-skin' : 'm-wins-the-hole'] : null, priority: 2 }); }, this._stepTimers);
    else if (v.kind === 'out') this._after(LAND, () => { this._shake(); this._moment({ sting: 'sting-knockout', say: [voiceName(m, v.gone), 'p-is-out'], priority: 2 }); }, this._stepTimers);
    else if (v.kind === 'carry') this._after(LAND, () => this._moment({ crowd: 'crowd-ohh', say: 'p-skin-carries', priority: 2 }), this._stepTimers);
    else this._after(LAND, () => this._moment({ crowd: 'crowd-ohh', say: v.kind === 'tied' ? 'm-all-square' : null, priority: 2 }), this._stepTimers);
    this._after(auto, () => this._continue(false), this._stepTimers);
  }
  _burst(slot, power = 1) {
    if (slot !== 3 && slot !== 4) return super._burst(slot, power);
    if (this.reduced) return;
    const colors = [slotColor(slot), '#ffffff', '#ffd21f', '#fff6c9'];
    const n = Math.round(90 * power);
    this.confetti.burst({ x: 0.02, y: 1.02, angle: -62, spread: 34, n, colors, power });
    this.confetti.burst({ x: 0.98, y: 1.02, angle: -118, spread: 34, n, colors, power });
  }

  // ---------- the winner ----------
  _done(m, prev) {
    if (!isParty(m)) return super._done(m, prev);
    if (this._mem.doneKey === m.id) return;
    this._mem.doneKey = m.id;
    this._clearSet(this._stepTimers);
    this._steps = [];
    this._dropBanners();
    this._stopClock();
    const r = m.lastResult || (m.holeResults || [])[(m.holeResults || []).length - 1] || null;
    const live = !!prev;
    const show = () => this._screenWinner(m);
    if (live && prev.phase === 'tiebreak' && r && r.tiebreak && m.reason !== 'concede') this._duelFinale(m, r, show);
    else if (live && prev.phase === 'play' && m.reason !== 'concede') { this._renderHeader({ ...m, currentPlayerId: null }); this._after(1300, show); }
    else show();
  }
  _screenWinner(m) {
    if (!isParty(m)) return super._screenWinner(m);
    if (!this.match || this.match.id !== m.id) return;
    this._hidePlay();
    const w = playerOf(m, m.winnerId);
    const buttons = `<div class="mt-win-actions">
        <button type="button" class="mt-btn mt-btn-go" data-pt="play-again">PLAY AGAIN</button>
        <button type="button" class="mt-btn" data-pt="new-game">NEW GAME</button>
        <button type="button" class="mt-btn mt-btn-dim" data-mt="exit">EXIT</button>
      </div>`;
    const card = partyCard(m.party);
    if (!w) {
      this._show('winner', `<div class="mt-bg pt-res-bg pt-kind-tied" aria-hidden="true"><i class="pt-res-slab"></i><i class="mt-dots"></i></div>
        <div class="mt-win-main"><span class="mt-slot">${esc(card.label)}</span>${big('NO WINNER', 'mt-win-name')}</div>${buttons}`);
      return;
    }
    const ws = slotOf(m, w.id);
    const rw = (m.rewards && m.rewards.winner) || {};
    const rl = (m.rewards && m.rewards.loser) || {};
    const lastP = playerOf(m, m.loserId);
    const base = (this._mem.base || {})[w.id];
    const now = w.profile || null;
    const rankNow = String((now && now.rank) || '').toUpperCase();
    const rankWas = String((base && base.rank) || '').toUpperCase();
    const rankUp = rankNow && rankWas && rankNow !== rankWas;
    const how = m.reason === 'concede' ? 'THE REST OF THE FIELD LEFT' : m.reason === 'tiebreak' ? 'WON IN SUDDEN DEATH' : m.reason === 'points' ? 'LEVEL ON STROKES · WON ON POINTS'
      : m.party === 'skins' ? `${w.holesWon || 0} SKIN${(w.holesWon || 0) === 1 ? '' : 'S'}` : m.party === 'stroke' ? `${w.total || 0} STROKES OVER ${m.holesPlayed || m.maxHoles} HOLES` : 'THE LAST ONE STANDING';
    const places = partyRanking(m).map((p, i) => {
      const s = slotOf(m, p.id); const f = partyFigure(m, p);
      const fig = m.party === 'elim' ? (i === 0 ? 'WINNER' : p.left ? 'LEFT' : p.outOnHole ? `OUT ON ${p.outOnHole}` : 'OUT') : f.big;
      const lab = m.party === 'elim' ? '' : f.label;
      return `<div class="pt-place ${pcls(s)} ${i === 0 ? 'pt-place-1' : ''}" style="--d:${(0.9 + i * 0.16).toFixed(2)}s"><i class="pt-place-n">${ordinal(i + 1)}</i><span class="pt-place-name">${markOf(s)}${esc(shout(p.name))}</span><b>${esc(fig)}</b><em>${esc(lab)}</em></div>`;
    }).join('');
    const awards = (m.awards || []).slice(0, 5).map((x, i) => {
      const p = playerOf(m, x.playerId);
      const [val, ...more] = String(x.value ?? '').split(' · ');
      return `<div class="mt-award ${p ? pcls(slotOf(m, p.id)) : ''}" data-award="${esc(x.id || '')}" style="--d:${(1.5 + i * 0.22).toFixed(2)}s">
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
        ${rl.trophies && lastP ? `<div class="mt-loot-i mt-loot-lose ${pcls(slotOf(m, lastP.id))}" style="--d:2.9s"><b>−${fmt(Math.abs(rl.trophies))}</b>${trophySvg}<span>${esc(shout(lastP.name))}</span></div>` : ''}
      </div>
      ${chest.length ? `<div class="mt-chest" style="--d:3.3s">
        <div class="mt-chest-box" aria-hidden="true"><i class="mt-chest-lid"></i><i class="mt-chest-base"></i><i class="mt-chest-glow"></i></div>
        <div class="mt-chest-balls">${chest.map((c, i) => `<div class="mt-ball mt-r-${esc(c.rarity)}" style="--c:${esc(c.color)};--d:${(3.95 + i * 0.22).toFixed(2)}s"><i class="mt-ball-orb">${esc(c.emoji)}</i><b>${esc(c.name.toUpperCase())}</b><span>${c.kind === 'trick' ? 'TRICK' : esc(String(c.rarity).toUpperCase())}</span></div>`).join('')}</div>
      </div>` : ''}`;
    this._show('winner', `
      <div class="mt-bg mt-win-bg pt-win-bg ${pcls(ws)}" aria-hidden="true"><i class="mt-rays"></i><i class="mt-win-slab"></i><i class="mt-dots"></i></div>
      <div class="mt-win-main pt-win-main ${pcls(ws)}">
        <span class="mt-slot">${markOf(ws)}PLAYER ${ws} · ${esc(m.formatLabel ? String(m.formatLabel).toUpperCase() : card.label)}</span>
        ${big(shout(w.name), 'mt-win-name')}
        <span class="mt-x mt-win-wins">WINS!</span>
        <span class="mt-win-how">${esc(how)}</span>
        <div class="pt-places pt-n${m.players.length}">${places}</div>
      </div>
      <div class="mt-win-side">
        ${awards ? `<div class="mt-awards"><span class="mt-side-h">GAME AWARDS</span>${awards}</div>` : ''}
        ${loot}
      </div>
      ${buttons}`);
    this.screen.classList.add('pt-s-winner');
    const nameless = /^player\s*[1-4]$/i.test(String(w.name).trim());
    this._after(400, () => {
      this._shake();
      this._burst(ws, 1.25);
      this._moment({ impact: 'confetti-pop', sting: 'fanfare-win', say: nameless ? `m-player-${ws}-wins` : [voiceName(m, w), 'p-wins-the-game'], priority: 3 });
    });
    (m.awards || []).slice(0, 5).forEach((_, i) => this._after(1650 + i * 220, () => this._cue('trophy-tick')));
    if (rw.trophies != null || rw.coins) this._after(2750, () => this._cue('coin-burst'));
    this._after(1100, () => { if (!this.reduced) this.confetti.burst({ x: 0.5, y: -0.05, angle: 90, spread: 150, n: 140, power: 0.45, colors: [slotColor(ws), '#ffd21f', '#fff'] }); });
    this._after(2000, () => this._burst(ws, 0.8));
    if (chest.length) this._after(3650, () => this._cue('chest-open'));
    this._after(this.reduced ? 0 : 900, () => this.screen.querySelector('[data-pt="play-again"]')?.focus({ preventScroll: true }));
    try { if (typeof this.onWinnerScreen === 'function') this.onWinnerScreen(m, this.screen); } catch (_) { /* the screen stands without it */ }
  }

  // ---------- the menu ----------
  _menuItems(m) { return isParty(m) ? partyMenuItems(m, this.game, { shell: this.shell }) : super._menuItems(m); }
  _menuTitle(m) { return isParty(m) ? 'GAME MENU' : super._menuTitle(m); }
  _menuWhere(m) {
    if (!isParty(m)) return super._menuWhere(m);
    return m.phase === 'done' ? 'GAME OVER' : `${m.phase === 'tiebreak' ? 'SUDDEN DEATH' : esc(partyLine(m))} · ${esc(String(m.standings || '').toUpperCase())}`;
  }
  async _menuRun(id) {
    if (id !== 'leave' || !isParty(this.match)) return super._menuRun(id);
    const ui = this.menuUi;
    if (ui.busy) return;
    ui.busy = true;
    this._cue('ui-confirm');
    this._renderMenu();
    const out = await this._post('/api/match/concede', { playerId: this.match.currentPlayerId });
    ui.busy = false;
    if (!out) { ui.ask = null; this._renderMenu(); return; }
    this.closeMenu(true);
    if (out.match) this.onMatch(out.match);
  }
}

export { PLAYER_COLORS, PLAYER_MARKS };
export default PartyUI;
