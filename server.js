'use strict';
// Open-Birdie — open-data golf simulator.
//   HTTP  : http://localhost:8222  (game UI + API, Server-Sent Events)
//   TCP   : port 921               (GSPro Open Connect — point GSPconnect here)
// Zero npm dependencies; needs Node 18+.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { OpenConnectServer, toOpenConnectClub } = require('./lib/openconnect');
const { createForesightManager, createSwingGuard } = require('./lib/foresight-bridge');   // v2:bridge Foresight GC units, through GSPro's own connector (docs/foresight-bridge.md)
const { searchCourses, loadCourse, listCached, loadCached, lakesInPlay } = require('./lib/course');
const {
  cloudConfigFromEnv,
  cloudSceneryProviders,
  createCloudClient,
  createCloudCourseSource,
} = require('./lib/cloud-client');
const { createCourseActivationManager } = require('./lib/course-activation');
const { createCourseCache } = require('./lib/course-cache');
const { createCourseLibrary } = require('./lib/course-library');
const {
  applySceneryUpdate,
  createSceneryEnricher,
  localSceneryProviders,
} = require('./lib/course-enrichment');
const { serveCourseArtRequest } = require('./lib/course-art-http');
const { createCourseDiagnostic, sanitizePublicText } = require('./lib/course-diagnostics');
const { normalizeCourseSource } = require('./lib/course-identity');
const { packageKeyFor, parsePackageKey } = require('./lib/course-package');
const { prepareCourseCandidate } = require('./lib/resolved-course-package');
const { Game, CLUB_FULL } = require('./lib/game');
const { clubDelivery } = require('./lib/club-delivery');
const { PRESETS, conditionsState, loadConditionsFile, saveConditionsFile } = require('./lib/conditions');
const { createStageWind, seededRandom } = require('./lib/arcade-wind');   // v2:wind the wind rolled for every arcade hole
const { normalizeSettings, loadSettingsFile, saveSettingsFile } = require('./lib/settings');
const { createBag } = require('./lib/bag');
const { createSavedShots } = require('./lib/saved-shots');
const { createLeagues, LeagueError, initials } = require('./lib/leagues');
const { PredictError, predictCarries, predictShot } = require('./lib/predict');
const { ArcadeError, ArcadeState, gradeShot } = require('./lib/arcade');
const { createMatch, MatchError, MATCH_TIERS, MATCH_FORMATS, tierFor, normalizeProfile, applyRewards,
  PARTY_FORMATS, PARTY_HOLES, HELP_LEVELS, partyFormatFor, applyPartyRewards, suggestHelp /* v3:modes party, handicaps */ } = require('./lib/match');
const { serveHdAsset, publicHdMetadata, pickDescriptor } = require('./lib/hd-http');
const { makeNonce, verifyReadinessAck } = require('./lib/hd-readiness');
const { googleTilesConfig } = require('./lib/google-tiles-config');
const { createSkyCache, webSkyFiles } = require('./lib/sky-cache');
// v2:shell The product switch (lib/product-mode.js, docs/sim-clash-shell.md): the GAME (the
// default: its own arcade stages only, a title screen and a menu in front, no network I/O
// of its own) or, with BIRDIE_PRODUCT=open-birdie, the original simulator, untouched.
const { productMode, courseRefusal, bootStage, createShellGate } = require('./lib/product-mode');
const { createSoloRun, createSoloBests, SoloError } = require('./lib/solo');
const PRODUCT_MODE = productMode(process.env);
const SIMCLASH = PRODUCT_MODE === 'simclash';

const HTTP_PORT = +(process.env.BIRDIE_PORT || 8222);
const OC_PORT = +(process.env.BIRDIE_OC_PORT || 921);
// Bind the HTTP API to localhost by default — its mutating endpoints (reset,
// load-course, test-shot) are unauthenticated, so don't expose them to the LAN
// unless explicitly opted in. Set BIRDIE_HOST=0.0.0.0 for tablet/phone mirroring
// on a TRUSTED network only.
const HTTP_HOST = process.env.BIRDIE_HOST || '127.0.0.1';
// Correct ball speed for monitors/bridges that report m/s instead of mph
// (m/s plays ~2.2x short). e.g. BIRDIE_SPEED_SCALE=2.23694 for a metric monitor.
const SPEED_SCALE = +(process.env.BIRDIE_SPEED_SCALE || 1);
const PUB = path.join(__dirname, 'public');
const DATA_DIR = process.env.BIRDIE_DATA_DIR || path.join(__dirname, 'data');
const ART_DIR = process.env.BIRDIE_ART_DIR || path.join(__dirname, 'build', 'course-art');
// Background scenery (buildings, real trees, aerial photo) for every course that is
// missing it. BIRDIE_ENRICH=0 turns it off (offline play, tests, visual capture).
const SCENERY_ENABLED = process.env.BIRDIE_ENRICH !== '0' && !SIMCLASH;   // v2:shell the game never fetches scenery (nor skies: the prefetch hangs off this too)
// Bounded local course cache (BIRDIE_CACHE_MAX_MB, default 1024): least recently
// played courses are deleted past the cap, never the active one.
const courseCache = createCourseCache({ dataDir: DATA_DIR });
const skyCache = createSkyCache({ dataDir: DATA_DIR });
let skyKeeper = null; // the background sky download (started once the server listens)
// the course picker's list: every downloaded course and the featured ones (lib/course-library.js)
const courseLibrary = createCourseLibrary();
// Cloud course service (BIRDIE_CLOUD_URL): courses and their scenery are downloaded
// as verified packages instead of being built here. Unset = no cloud request ever.
const CLOUD = SIMCLASH ? null : cloudConfigFromEnv(process.env, console, { file: path.join(DATA_DIR, 'cloud.json') });   // v2:shell the game has no cloud
const cloudClient = CLOUD ? createCloudClient(CLOUD) : null;

const game = new Game();
// Playing conditions persist across restarts (a bad or missing file: standard conditions).
const CONDITIONS_FILE = path.join(DATA_DIR, 'conditions.json');
{
  const saved = loadConditionsFile(CONDITIONS_FILE);
  if (saved) game.setConditions(saved);
}
// So do the round settings (lib/settings.js: the gimme).
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
{
  const saved = loadSettingsFile(SETTINGS_FILE);
  if (saved) game.settings = saved;
}
// The player's bag: per-club launch history from the launch monitor (lib/bag.js),
// which the lineup predicts with (lib/predict.js reads game.bag).
const bag = createBag({ dataDir: DATA_DIR });
game.bag = bag;
// The player's saved shots (lib/saved-shots.js), and the last shot played: the one a
// save applies to, with where it was hit from.
const saved = createSavedShots({ dataDir: DATA_DIR });
let shotSeq = 0;
let lastShot = null;
// Players and leagues (lib/leagues.js). The active player is who the round belongs to.
const leagues = createLeagues({ dataDir: DATA_DIR });
// The arcade layer (lib/arcade.js, docs/arcade.md): grades, coins, streaks, power-ups.
const arcade = new ArcadeState({ dataDir: DATA_DIR });
// v2:playability The arcade's play assists (lib/playability.js PLAY_ASSIST, docs/arcade.md
// "Play assists"): launch clearance, soft trees, a 90 degree aim and the rescue drop are
// on whenever the arcade layer is, and off with it (the plain simulator, to the last bit).
// BIRDIE_PLAY_ASSIST=0 keeps them off.
const { PLAY_ASSIST } = require('./lib/playability');
function syncPlayAssist() {
  game.playAssist = arcade.enabled && process.env.BIRDIE_PLAY_ASSIST !== '0' ? PLAY_ASSIST : null;
}
syncPlayAssist();
// Match mode v2 (lib/match.js, docs/match.md): one head-to-head at a time, in memory. The
// match is a pure state machine; everything it needs from the outside world (a stage's
// course in the bay, the safety timeouts of its screens) it asks for through
// `match.waiting`, and driveMatch() below does it.
let match = null;
let matchSettled = false;
let matchPayout = null;   // v2:menu what settleMatch() paid, so a deciding swing that is taken back can be unpaid
// Every player's profile { trophies, rank, wins, losses, streak, bestStreak, coins }, in
// the ledger file (the first ledger kept { coins, trophies, streak, wins, losses }: the
// same file, read into profiles).
const MATCH_LEDGER_FILE = path.join(DATA_DIR, 'match-ledger.json');
const matchLedger = {};
try {
  const raw = JSON.parse(fs.readFileSync(MATCH_LEDGER_FILE, 'utf8'));
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [id, rec] of Object.entries(raw)) matchLedger[id] = normalizeProfile(rec);
  }
} catch (_) { /* no matches yet */ }
const matchProfile = (id) => (matchLedger[id] ||= normalizeProfile(null));
const matchProfiles = (ids) => Object.fromEntries(ids.map((id) => [id, { ...matchProfile(id) }]));
function saveMatchLedger() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(MATCH_LEDGER_FILE, JSON.stringify(matchLedger, null, 2));
  } catch (error) {
    console.warn(`[match] ledger not saved: ${error.message}`);
  }
}
// The stakes of a staked match, on disk for as long as it is in play: a match lives in
// memory, so if the game stops mid-match (a crash, a restart) the entry fees would be gone
// with it. On the next start whatever is still in escrow goes back to the players who paid.
const MATCH_ESCROW_FILE = path.join(DATA_DIR, 'match-escrow.json');
let matchEscrow = null;   // { playerIds, entryFee } while fees are held
function holdMatchStakes(playerIds, entryFee) {
  for (const id of playerIds) matchProfile(id).coins -= entryFee;   // into the pot
  matchEscrow = { playerIds, entryFee };
  saveMatchLedger();
  try { fs.writeFileSync(MATCH_ESCROW_FILE, JSON.stringify({ playerIds, entryFee, at: Date.now() })); } catch (_) { /* best effort */ }
}
function releaseMatchStakes() {
  matchEscrow = null;
  try { fs.unlinkSync(MATCH_ESCROW_FILE); } catch (_) { /* nothing held */ }
}
function refundMatchStakes() {
  if (!matchEscrow) return;
  for (const id of matchEscrow.playerIds) matchProfile(String(id)).coins += matchEscrow.entryFee;
  saveMatchLedger();
  releaseMatchStakes();
}
try {
  const held = JSON.parse(fs.readFileSync(MATCH_ESCROW_FILE, 'utf8'));
  if (held && Array.isArray(held.playerIds) && held.entryFee > 0) {
    matchEscrow = { playerIds: held.playerIds.map(String), entryFee: held.entryFee };
    refundMatchStakes();
    console.log(`[match] the last match was cut short: ${held.entryFee} coins refunded to each of ${held.playerIds.length} players`);
  }
  releaseMatchStakes();
} catch (_) { /* no match was in play */ }
// The Clash Tour (tools/arcade-holes/build.mjs writes it): the match stages and tiebreak
// arenas whose course files are really in the data dir. Null: no tour (stage 'current' only).
const MATCH_TOUR_FILE = path.join(DATA_DIR, 'arcade-tour.json');
function matchTour() {
  try {
    const tour = JSON.parse(fs.readFileSync(MATCH_TOUR_FILE, 'utf8'));
    const built = (list) => (Array.isArray(list) ? list : []).filter((s) => s && typeof s.id === 'string' && typeof s.file === 'string'
      && path.basename(s.file) === s.file && fs.existsSync(path.join(DATA_DIR, 'courses', s.file)));
    const stages = built(tour.stages), tiebreaks = built(tour.tiebreaks);
    return stages.length || tiebreaks.length ? { ...tour, stages, tiebreaks } : null;
  } catch (_) {
    return null;
  }
}
// The safety timeouts of the match's screens (ms; 0: wait for the client for ever).
const envMs = (name) => (process.env[name] !== undefined && Number.isFinite(+process.env[name]) ? Math.max(0, +process.env[name]) : undefined);
const MATCH_TIMEOUTS = {
  readyMs: envMs('BIRDIE_MATCH_READY_MS'), continueMs: envMs('BIRDIE_MATCH_CONTINUE_MS'), doneMs: envMs('BIRDIE_MATCH_DONE_MS'),
};
// What the 'match' event and GET /api/match carry: the match's state, each player with
// their profile as the ledger has it now.
function matchState() {
  if (!match) return null;
  const s = match.state();
  for (const x of s.players) x.profile = { ...matchProfile(x.id) };
  return s;
}
// A decided match pays out, once: trophies, the record and coins to the two profiles, the
// winner's chest onto the bay's shelf and its coins into the bay's wallet (lib/arcade.js).
function settleMatch() {
  if (!match || match.active || matchSettled) return;
  const s = match.state();
  if (s.aborted || !s.winnerId || !s.rewards) return;
  matchSettled = true;
  // v2:menu the two profiles and the escrow as they stand, in case the deciding swing is taken back
  matchPayout = { winnerId: s.winnerId, loserId: s.loserId, winner: { ...matchProfile(s.winnerId) }, loser: { ...matchProfile(s.loserId) }, escrow: matchEscrow ? { ...matchEscrow } : null, chest: [], coins: 0 };
  if (s.party && Array.isArray(s.placings)) {
    // v3:modes a party: every player's profile moves (first: the win and its rewards; last: the drop; between: a loss on the record)
    matchPayout.all = matchProfiles(s.placings);
    Object.assign(matchLedger, applyPartyRewards(matchProfiles(s.placings), s.rewards));
  } else {
  const next = applyRewards(matchProfile(s.winnerId), matchProfile(s.loserId), s.rewards);
  matchLedger[s.winnerId] = next.winner;
  matchLedger[s.loserId] = next.loser;
  }
  saveMatchLedger();
  releaseMatchStakes();   // paid out with the rewards
  const { chest = [], coins = 0, pot = 0 } = s.rewards.winner;
  try {
    if (chest.length) {
      if (typeof arcade.grantBalls === 'function') arcade.grantBalls(chest);
      else { for (const id of chest) arcade.grant(id); if (typeof arcade._save === 'function') arcade._save(); }
      matchPayout.chest = [...chest];   // v2:menu
    }
    if (coins - pot > 0) {
      if (typeof arcade.addCoins === 'function') arcade.addCoins(coins - pot);
      else { arcade.coins += coins - pot; if (typeof arcade._save === 'function') arcade._save(); }
      matchPayout.coins = coins - pot;   // v2:menu
    }
  } catch (error) {
    console.warn(`[match] chest not delivered: ${error.message}`);
  }
  broadcast('arcade-state', arcade.snapshot());
}
// v2:wind Wind per hole (lib/arcade-wind.js, docs/match.md "Wind"). An arcade stage (a
// course whose arcade block names a theme) plays in a wind ROLLED for the hole: a speed
// inside the stage's range (course.arcade.wind { min, max }, else what its conditions
// stand for: calm 0 to 5, breezy 6 to 12, windy 12 to 22 mph), from anywhere round the
// compass, leaning toward the top of the range late in a series. It is rolled once each
// time the hole comes up (the stage's course committed, a match hole on the loaded course,
// a restart, the next hole) and is on game.conditions for every shot of it, so both
// players, the HUD's wind dial and the lineup all have the same wind. The day's own
// conditions are held aside meanwhile and come back with the next course that is not an
// arcade stage; they are what conditions.json keeps. BIRDIE_WIND_SEED: a repeatable roll.
const stageWind = createStageWind({
  game,
  random: process.env.BIRDIE_WIND_SEED ? seededRandom(process.env.BIRDIE_WIND_SEED) : Math.random,
});
let stageWindRolls = 0;   // v2:wind counts the rolls, so a stage load can tell whether its course came with one
function rollStageWind() {
  stageWindRolls++;
  const wind = stageWind.roll({ progress: match && match.active ? match.progress : 0 });
  if (wind) console.log(`[wind] ${game.course.name}: ${wind.label} (from ${wind.dirDeg} deg, range ${wind.min} to ${wind.max} mph)`);
  return wind;
}
// v2:menu Take the match's last swing back (POST /api/match/undo; lib/match.js undoLastShot):
// the match and the game are as they were before it. When that swing had decided the match,
// what settleMatch() paid is taken back too: the two profiles as they were, the entry fees
// back in escrow, the chest off the bay's shelf and its coins out of the bay's wallet.
// (The arcade grade of the swing itself, its coins and XP, stay in the bay's wallet.)
function undoMatchShot() {
  const wasOver = !match.active;
  match.undoLastShot(game);   // a MatchError when there is nothing to take back
  if (!wasOver || !matchSettled || !matchPayout) return;
  const pay = matchPayout;
  if (pay.all) Object.assign(matchLedger, pay.all);   // v3:modes a party: every profile as it was
  else {
  matchLedger[pay.winnerId] = pay.winner;
  matchLedger[pay.loserId] = pay.loser;
  }
  saveMatchLedger();
  if (pay.escrow) {
    matchEscrow = pay.escrow;
    try { fs.writeFileSync(MATCH_ESCROW_FILE, JSON.stringify({ ...pay.escrow, at: Date.now() })); } catch (_) { /* best effort */ }
  }
  try {
    for (const id of pay.chest) {
      if (arcade.inventory && arcade.inventory[id] > 0 && !--arcade.inventory[id]) delete arcade.inventory[id];
    }
    if (typeof arcade.addCoins === 'function') arcade.addCoins(-pay.coins);   // saves the shelf too
  } catch (error) {
    console.warn(`[match] chest not taken back: ${error.message}`);
  }
  matchSettled = false;
  matchPayout = null;
  broadcast('arcade-state', arcade.snapshot());
}
// ---- the match's driver ----
let matchTimer = null;
let matchDriven = null;   // the request (match id : waiting token) already being seen to
function clearMatchTimer() {
  if (matchTimer) { clearTimeout(matchTimer); matchTimer = null; }
}
// Put a stage's course in the bay (the path /api/load-course takes), then tell the match.
async function loadMatchStage(m, w) {
  const t0 = Date.now();
  let error = null;
  const rolls = stageWindRolls;   // v2:wind
  try {
    const result = await activationManager.activate({ cached: w.file });
    if (result.status !== 'committed') error = (result.diagnostic && result.diagnostic.message) || result.status;
  } catch (e) {
    error = e.message;
  }
  if (match !== m) return;   // dropped meanwhile: the bay keeps whatever course came up
  try {
    if (error) {
      console.warn(`[match] ${w.stageId} would not load: ${error}`);
      if (!m.stageFailed(w.token, error)) return;
      if (m.aborted) return dropMatch();   // no stage left to play
    } else {
      if (!m.active) return;               // conceded while the course loaded
      // v2:wind the hole's wind was rolled as its course was committed (commitPreparedActivation);
      // a course that was already in the bay came with no roll, so it is rolled here
      if (stageWindRolls === rolls) rollStageWind();
      if (!m.stageReady(game, w.token, { wind: stageWind.current })) return;
      console.log(`[match] ${w.stageId} in the bay after ${Date.now() - t0} ms`);
    }
  } catch (e) {
    console.error(`[match] dropped: ${e.message}`);
    return dropMatch();
  }
  matchChanged();
}
// See to whatever the match is waiting for: a course in the bay, or the safety timeout
// of the screen that is showing. Safe to call after any change; each request is seen to once.
function driveMatch() {
  while (match) {
    const w = match.waiting;
    const key = w ? `${match.id}:${w.token}` : null;
    if (key === matchDriven) return;
    matchDriven = key;
    clearMatchTimer();
    if (!w) return;
    const m = match;
    if (w.for === 'stage') {
      if (w.file) { loadMatchStage(m, w).catch((e) => console.error(`[match] stage load: ${e.message}`)); return; }
      // v2:wind a hole on the course that is loaded: a fresh wind when it is an arcade stage (the
      // same-hole shootout keeps the wind of the hole it settles); any other course: the day's
      try { m.stageReady(game, w.token, { wind: w.kind === 'tiebreak' ? stageWind.current : rollStageWind() }); } catch (e) { console.error(`[match] dropped: ${e.message}`); return dropMatch(); }
      continue;   // the loaded course is the stage: on to its intro
    }
    if (!(w.timeoutMs > 0)) return;
    matchTimer = setTimeout(() => {
      matchTimer = null;
      const now = match === m ? m.waiting : null;
      if (!now || now.token !== w.token) return;
      try {   // a timer must never take the server down
        if (w.for === 'dismiss') return dropMatch();
        if (w.for === 'ready') m.ready(game);
        else if (w.for === 'continue') m.continue();
        matchChanged();
      } catch (e) {
        console.error(`[match] ${w.for} timeout: ${e.message}`);
      }
    }, w.timeoutMs);
    if (matchTimer.unref) matchTimer.unref();
    return;
  }
}
// After any change to the match: drive it, then tell every client.
function matchChanged() {
  driveMatch();
  const st = matchState();
  broadcast('match', st);
  broadcast('state', game.state());
  updatePlayerInfo();
  return st;
}
// Start a match: {playerIds: [slot 1, slot 2], format, stage?, order?, tieRule?, powerups?,
// stakes?, hazardLosesHole?} (POST /api/match/start; a rematch passes the last one's again).
function startMatch(cfg) {
  if (match && match.active) throw new MatchError('A match is in play: quit it first', 409);   // v2:menu a message the lobby can show (it offers RESUME / QUIT)
  if (game.leagueRound) throw new MatchError('Finish or leave the league round first', 409);
  const ids = Array.isArray(cfg.playerIds) ? cfg.playerIds.map(String) : [];
  const pls = ids.map((id) => leagues.player(id));
  const party = Boolean(partyFormatFor(cfg.format));   // v3:modes PARTY: 'skins' | 'stroke' | 'elim', two to four players
  if (party && (pls.length < 2 || pls.length > 4 || pls.some((x) => !x))) throw new MatchError('Pick two to four players from the roster');
  if (!party && (pls.length !== 2 || pls.some((x) => !x))) throw new MatchError('Pick two players from the roster');
  // v3:modes help: { <playerId>: level 0 to 3 | { charges, tee, putting } } (a handicap; lib/match.js HELP_LEVELS)
  const helpOf = (id) => (cfg.help && typeof cfg.help === 'object' && cfg.help[id] != null ? cfg.help[id] : undefined);
  const staked = !party && !(cfg.stakes == null || cfg.stakes === false || cfg.stakes === '');   // v3:modes a party is always a friendly: no entry fee is held
  const tier = staked ? tierFor(cfg.stakes) : null;
  if (staked && !tier) throw new MatchError('No such stakes tier');
  const broke = tier && pls.find((x) => matchProfile(x.id).coins < tier.entryFee);
  if (broke) throw new MatchError(`${broke.name} can't cover the ${tier.entryFee} coin entry fee`, 409);
  dropSolo();   // v2:shell a match takes the bay from a solo run
  dropModes();  // v3:modes ... and from a bullseye game or a duel
  dropMatch();   // a finished one still on its result screen
  if (game.practice) game.endPractice();
  match = createMatch({
    game,
    tour: matchTour(),
    timeouts: MATCH_TIMEOUTS,
    players: pls.map((x) => ({ id: x.id, name: x.name, initials: initials(x.name), handicap: x.handicap, profile: matchProfile(x.id), help: helpOf(x.id) /* v3:modes */ })),
    options: {
      format: cfg.format, holes: cfg.holes, stage: cfg.stage, order: cfg.order, tieRule: cfg.tieRule, powerups: cfg.powerups,
      putting: cfg.putting,   // v2:playability 'easy' | 'assist' | 'off' (default 'assist': the match's putting assist)
      stakes: tier ? tier.id : null, hazardLosesHole: cfg.hazardLosesHole === true,
      ...(Number.isInteger(cfg.holeIndex) ? { holeIndex: cfg.holeIndex } : {}),
    },
  });
  matchSettled = false;
  matchPayout = null;   // v2:menu
  if (tier) holdMatchStakes(pls.map((x) => x.id), tier.entryFee);
}
// End whatever match there is and hand the bay back: a stage 'current' match puts the round
// back as it was, a tour match leaves the bay on its last stage with a fresh hole. Fees
// still held are refunded. Safe to call when there is no match.
function dropMatch() {
  if (!match) return;
  clearMatchTimer();
  matchDriven = null;
  refundMatchStakes();   // an unfinished staked match (a finished one has paid out)
  match.abort(game);
  match = null;
  matchSettled = false;
  matchPayout = null;   // v2:menu
  // v2:wind the bay is back in solo play: on a course that is not an arcade stage the day's
  // conditions are back; a tour match leaves the bay on its last stage with a fresh hole,
  // which, like any arcade stage in solo play, gets a wind of its own (the day's stay aside)
  rollStageWind();
  setGamePlayer();   // the round is the active player's again (they may have changed meanwhile)
  broadcast('match', null);
  broadcast('state', game.state());
  updatePlayerInfo();
}
// v2:shell ---- the game product's front end: its swing gate, and solo play ----
// The page says which screen it is on (POST /api/shell {cid, screen}); while it is in the
// menus a swing is dropped and the page is told ('shell-swing'), so a real swing works as
// "press any key" and is never played as a shot (lib/product-mode.js createShellGate).
const shellGate = createShellGate();
let sseSeq = 0;
const sseCids = new Set();   // the ids of the pages whose event stream is open: only they can hold the gate
// Solo play (lib/solo.js): one run at a time, in memory, like the match; the best scores
// on disk (DATA_DIR/solo-best.json).
const soloBests = createSoloBests({ dataDir: DATA_DIR });
let solo = null;
let soloDriven = null;   // the request (run id : waiting token) already being seen to
const soloState = () => (solo ? solo.state() : null);
// What solo play offers: the tour's stages in order, and the tiebreak arenas (single stage only).
function soloStages() {
  const tour = matchTour();
  const sort = (list) => [...list].sort((a, b) => (a.order || 0) - (b.order || 0));
  return tour ? { stages: sort(tour.stages), arenas: sort(tour.tiebreaks).map((s) => ({ ...s, arena: true })) } : { stages: [], arenas: [] };
}
function dropSolo({ quiet = false } = {}) {
  if (!solo) return;
  solo.abort();
  solo = null;
  soloDriven = null;
  if (!quiet) broadcast('solo', null);
}
// Put a stage's course in the bay on its tee (the path a match stage takes), then tell the run.
async function loadSoloStage(run, w) {
  let error = null;
  const rolls = stageWindRolls;
  // a stage the game would refuse (a manifest that names a real course) fails here, at once, with the reason
  const no = SIMCLASH ? courseRefusal({ cached: w.file }, { loadCached }) : null;
  if (no) error = no.message;
  else {
    try {
      const result = await activationManager.activate({ cached: w.file });
      if (result.status !== 'committed') error = (result.diagnostic && result.diagnostic.message) || result.status;
    } catch (e) {
      error = e.message;
    }
  }
  if (solo !== run) return;   // dropped meanwhile
  if (error) {
    console.warn(`[solo] ${w.stageId} would not load: ${error}`);
    run.stageFailed(w.token, error);
    const st = run.state();
    solo = null;
    soloDriven = null;
    broadcast('solo', st);   // aborted, with the reason
    return;
  }
  if (game.practice) game.endPractice();
  game.reset();                                    // a fresh tee, whatever was played on this course before
  if (stageWindRolls === rolls) rollStageWind();   // the course was already in the bay: a wind for this go
  setGamePlayer();
  if (run.stageReady(w.token)) soloChanged();
}
function driveSolo() {
  if (!solo) return;
  const w = solo.waiting;
  const key = w ? `${solo.id}:${w.token}` : null;
  if (key === soloDriven) return;
  soloDriven = key;
  if (w) loadSoloStage(solo, w).catch((e) => console.error(`[solo] stage load: ${e.message}`));
}
// A finished run offers its score to the best-score store, once.
function settleSolo() {
  if (!solo || solo.phase !== 'done' || solo.settled) return;
  solo.settled = true;
  const r = solo.result();
  if (r) solo.setBest(soloBests.offer(r).best);
}
// After any change to the run: drive it, then tell every client.
function soloChanged() {
  driveSolo();
  settleSolo();
  const st = soloState();
  broadcast('solo', st);
  broadcast('state', game.state());
  updatePlayerInfo();
  return st;
}
// Start a run: {kind: tour|stage|free, stage?: id, length?: stages in the tour, playerId?} (POST /api/solo/start).
function startSolo(cfg) {
  if (match && match.active) throw new SoloError('A match is in play: quit it first', 409);
  const kind = String(cfg.kind || 'tour');
  const { stages, arenas } = soloStages();
  let list = stages;
  // a tour of the first N stages (a sprint); none or too many: the whole tour
  const n = Math.round(Number(cfg.length));
  if (kind === 'tour' && Number.isFinite(n) && n >= 1 && n < stages.length) list = stages.slice(0, n);
  if (kind !== 'tour') {
    const pick = [...stages, ...arenas].find((s) => s.id === String(cfg.stage || ''));
    if (!pick) throw new SoloError('No such stage', 404);
    list = [pick];
  }
  let player = leagues.activePlayer || null;
  if (cfg.playerId != null && cfg.playerId !== '') {
    player = leagues.player(String(cfg.playerId));
    if (!player) throw new SoloError('No such player', 404);
    try { leagues.setActivePlayer(player.id); } catch (e) { throw new SoloError(e.message, 409); }
  }
  dropMatch();
  dropModes();  // v3:modes
  dropSolo({ quiet: true });
  if (game.practice) game.endPractice();
  game.leagueRound = null;
  setGamePlayer();
  const pl = player ? { id: player.id, name: player.name } : null;
  solo = createSoloRun({
    kind, stages: list, player: pl,
    best: soloBests.get({ kind, playerId: pl ? pl.id : null, stageId: list[0] ? list[0].id : null, stages: list.length }),
  });
  broadcast('leagues', leagues.state());
}
function setGamePlayer() {
  const p = leagues.activePlayer;
  if (match && match.active) return;   // a match shows whoever is up (dropMatch calls this again)
  game.player = p ? { id: p.id, name: p.name, initials: initials(p.name), handicap: p.handicap } : null;
}
setGamePlayer();
// v3:modes ---- the other game modes (docs/modes.md): BULLSEYE, TRICK SHOT DUEL, HIGHLIGHTS ----
// A mode lives in its own file (lib/<id>-mode.js: its rules are a pure engine beside it) and
// is registered below with one line. What a mode is, to this server:
//   id                      names its routes (GET /api/<id>, POST /api/<id>/<action>), its event
//                           ('<id>': its state, sent on connect and after every change) and
//                           its mark on a shot (result[id])
//   active                  (getter) a game of this mode has the bay: every swing is its own
//   state()                 what the event and GET /api/<id> carry (null: no game)
//   info()                  (optional) more for GET /api/<id>: high scores, the arenas, ...
//   drop()                  end the game and let go of the bay (safe when there is none)
//   beforeShot(game)        a swing arrived: null drops it (not played, nothing counted), else
//                           { armed?: ball id, curses?: [trick ids], putting?: 'easy'|'assist'|'off', free?: true }
//   afterShot(game, result) the game has played it: what is returned rides on the shot as result[id]
//   handle(action, body)    POST /api/<id>/<action>: returns the answer's extra fields (or
//                           nothing; may be async); throws ctx.ModeError(message, status) to refuse
//   onShot(result, about)   (optional) every shot the bay plays, in any mode (the highlights)
// The modes, a match and a solo run are one at a time: starting any of them drops the others
// (ctx.takeBay). Rules, routes and state of each: docs/modes.md.
class ModeError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const modes = [];
const activeMode = () => (match ? null : modes.find((md) => md.active) || null);
function dropModes(except = null) {
  for (const md of modes) {
    if (md.id === except) continue;
    try { md.drop(); } catch (error) { console.error(`[${md.id}] drop: ${error.message}`); }
  }
}
function modeChanged(id) {
  const md = modes.find((x) => x.id === id);
  const st = md ? md.state() : null;
  broadcast(id, st);
  broadcast('state', game.state());
  updatePlayerInfo();
  return st;
}
const modeCtx = {
  ModeError, game, arcade, leagues, initials, dataDir: DATA_DIR,
  broadcast: (event, data) => broadcast(event, data),
  tour: () => matchTour(),                       // the Clash Tour manifest (stages, tiebreaks: the arenas), or null
  profile: (id) => ({ ...matchProfile(String(id)) }),
  player: (id) => leagues.player(String(id)),
  // The bay is this mode's: whatever else was being played is dropped (a match, a solo run,
  // a practice game, another mode).
  takeBay(id) {
    dropSolo();
    dropMatch();
    dropModes(id);
    if (game.practice) game.endPractice();
    game.leagueRound = null;
  },
  // Put a stage's course (a file of the tour manifest) in the bay, on its tee, with a wind
  // of its own. Resolves null, or the reason it would not load.
  async loadStage(file) {
    const rolls = stageWindRolls;
    try {
      const no = SIMCLASH ? courseRefusal({ cached: file }, { loadCached }) : null;
      if (no) return no.message;
      const result = await activationManager.activate({ cached: file });
      if (result.status !== 'committed') return (result.diagnostic && result.diagnostic.message) || result.status;
    } catch (e) {
      return e.message;
    }
    if (game.practice) game.endPractice();
    game.reset();
    if (stageWindRolls === rolls) rollStageWind();
    return null;
  },
  wind: () => stageWind.current,                 // the wind rolled for the hole in the bay (lib/arcade-wind.js), or null
  rollWind: () => rollStageWind(),
  changed: (id) => modeChanged(id),              // after any change: the mode's event, then 'state'
  setGamePlayer: () => setGamePlayer(),          // the round is the active player's again
  matchState: () => matchState(),
  // what has the bay right now ('match' | 'solo' | a mode's id), or null: its stage must stay where it is (the highlights reel asks before it loads another)
  busy: () => (match && match.active ? 'match' : solo && solo.active ? 'solo' : ((modes.find((md) => md.active) || {}).id || null)),
  json: (res, obj, code) => json(res, obj, code),
};
function registerMode(file) {
  try {
    const md = require(file).create(modeCtx);
    if (md && md.id) modes.push(md);
  } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND' || !String(error.message).includes(file.replace(/^\.\//, ''))) console.error(`[modes] ${file} did not start: ${error.stack || error.message}`);
  }
}
// (registered once the server's own pieces exist: see "v3:modes the modes" near the end)
const sseClients = new Set();
// HD bundle runtime state, kept OUTSIDE the serializable course object so absolute
// paths + Float32 heights never leak through course JSON. An ARRAY — one descriptor
// per built hole — so the whole course renders real 1 m relief, not just one hole.
let activeHd = [];       // resolved descriptors (server-only paths); [] when none
let courseRevision = 0;  // bumped on each course activation
// Per-process secret handed only to the loopback Electron primary client: its ack says
// which ground its scene drew (HD, or the base grid when a bundle failed to decode), so
// the ball plays the ground the desktop app shows. HD is the default everywhere else:
// run on its own (`node server.js`, opened in a browser or over the LAN) no client can
// hold the nonce, so an HD course plays its HD ground from the moment it loads; and if
// the desktop app never answers, it plays HD too. (This used to hold every shot for 15 s
// and then fall back to the base grid, under HD visuals.)
const PRIMARY_NONCE = makeNonce();
const READY_TIMEOUT_MS = +(process.env.BIRDIE_HD_READY_TIMEOUT_MS || 15000);
const STANDALONE = require.main === module;   // false when main.js (the desktop app) runs it
let readyTimer = null;
const isLoopbackAddr = (a) => a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';

let lmStatus = { connected: false, ready: false };
// v2:bridge The launch monitor's light covers both ways a shot can arrive: an Open Connect
// client on OC_PORT, or the Foresight connector held by the bridge (lib/foresight-bridge.js).
// source: 'open-connect' | 'foresight' | null (which one is connected); foresight: the bridge's state.
let foresight = null;
const swingGuard = createSwingGuard();   // one swing, one stroke, even when it arrives by both roads at once
function lmSync() {
  const fb = foresight ? foresight.status() : null;
  const ocUp = oc.clientCount > 0;
  const fbUp = !!fb && fb.state === 'connector-connected';
  lmStatus.connected = ocUp || fbUp;
  lmStatus.source = ocUp ? 'open-connect' : (fbUp ? 'foresight' : null);
  lmStatus.foresight = fb ? fb.state : 'off';
  return lmStatus;
}

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) res.write(payload);
}

// ---------- Open Connect (launch monitor) ----------
const oc = new OpenConnectServer(OC_PORT);
oc.on('listening', (p) => console.log(SIMCLASH
  ? `[OC] Open Connect listening on TCP ${p}: a launch monitor's own Open API connector connects here (Foresight GC units come in through the built-in bridge instead; SETTINGS > LAUNCH MONITOR has the steps)`   // v2:final GSPro's own connections inside GSPconnect cannot be pointed at this port (docs/launch-monitors.md)
  : `[OC] Open Connect listening on TCP ${p} — point GSPconnect/Uneekor VIEW at this PC`));
oc.on('connected', (addr) => {
  lmSync();   // v2:bridge (was: lmStatus.connected = true)
  console.log(`[OC] launch monitor connected from ${addr}`);
  broadcast('lm', lmStatus);
  updatePlayerInfo();
});
oc.on('disconnected', () => {
  lmSync();   // v2:bridge (was: lmStatus.connected = oc.clientCount > 0)
  broadcast('lm', lmStatus);
});
oc.on('status', (s) => { lmStatus.ready = s.ready; broadcast('lm', lmStatus); });
oc.on('duplicate', (d) => console.log(`[OC] shot #${d.shotNumber} sent again after a dropped link; already played`));
oc.on('shot', (shot) => {
  // v2:bridge the same swing by two roads at once (the bridge reading the connector's log, and another bridge program sending that log's shot to this port) is one stroke
  if (swingGuard.isRepeat(shot.ball, shot.source || 'open-connect')) { console.log(`[foresight] the same swing came again by ${shot.source === 'foresight' ? 'the connector log' : 'Open Connect'}: already played`); return; }
  if (SPEED_SCALE !== 1 && shot.source !== 'foresight' && typeof shot.ball.Speed === 'number') shot.ball.Speed *= SPEED_SCALE;   // v2:bridge (the connector's log is always mph)
  console.log(`[${shot.source === 'foresight' ? 'foresight' : 'OC'}] shot: ${shot.ball.Speed} mph, VLA ${shot.ball.VLA}, HLA ${shot.ball.HLA}, spin ${shot.ball.TotalSpin}${shot.clubName ? ' (' + shot.clubName + ')' : ''}`);   // v2:bridge the log names the path the shot came by
  const from = shotOrigin();
  const result = playShot(shot.ball, shot.clubName, shot.club, shot.source || 'open-connect');   // v2:bridge the source rides on the result
  if (result || (!match && !shellGate.closed && !connectHub.probing)) recordBagShot(shot, result, from);   // v2:shell (nor is a swing the menus dropped)   // v2:connect (nor the connection wizard's test ball)   // a swing a match ignored is nobody's shot
});
oc.on('error', (err) => {
  if (err.code === 'EADDRINUSE') return;   // v2:connect the hub reports a taken port to the UI, says so once, and retries (lib/connect.js) (was: a log line asking for a restart)
  console.error('[OC]', err.message);
});

// v2:bridge ---------- the Foresight bridge (lib/foresight-bridge.js, docs/foresight-bridge.md) ----------
// EXPERIMENTAL. Foresight GC units reach us through GSPro's own connector: it dials TCP 9050
// and writes each shot to its log. The bridge holds that connection and reads the log; a
// shot it finds is handed to the oc 'shot' handler above, so it goes down the SAME path
// as an Open Connect one (validation, the menu / solo / match gates, the bag), tagged
// source: 'foresight'. Setting: foresight.json in the data dir ('auto' | 'on' | 'off').
// 'auto' brings it up only on the bay's own game (the default ports): a second copy on
// private ports never takes the connector's port. Env: BIRDIE_FORESIGHT, _PORT, _LOG.
foresight = createForesightManager({
  dataDir: DATA_DIR,
  primary: HTTP_PORT === 8222 && OC_PORT === 921,
  onShot: (msg) => oc.emit('shot', {
    shotNumber: msg.ShotNumber, device: msg.DeviceID, units: msg.Units || 'Yards',
    ball: msg.BallData, club: null, clubName: null, source: 'foresight',
  }),
  onStatus: (s) => { lmSync(); broadcast('lm', lmStatus); broadcast('foresight', s); },
});
lmSync();
// v2:connect Getting connected (lib/connect.js, docs/launch-monitors.md): the hub starts the
// Open Connect port and keeps trying while another program has it, answers GET
// /api/launch-monitors and /api/connect/* (one status with the likely cause when nothing is
// connected), keeps the chosen launch monitor, and holds the connection wizard's test ball.
const connectHub = require('./lib/connect').createConnectHub({ oc, port: OC_PORT, dataDir: DATA_DIR, broadcast, foresight: () => (foresight ? foresight.status() : null) });

// Solo play on a rocket hole: the ball (course.arcade.freeBall, a ball of the catalogue,
// never a trick) the first stroke of the hole is played with, or null.
function soloFreeBall() {
  const id = game.course && game.course.arcade ? game.course.arcade.freeBall : null;
  if (!id || game.practice || game.strokes !== 0 || game.holed || game.over) return null;
  const catalogue = require('./lib/arcade').POWERUPS;
  return Array.isArray(catalogue) && catalogue.some((b) => b && b.id === id && b.kind !== 'trick') ? String(id) : null;
}

function playShot(ballData, clubName, clubData = null, source = null) {   // v2:bridge source: the launch-monitor path the swing came by ('open-connect' | 'foresight'; none: a test shot)
  // Match mode (lib/match.js): while there is a match, a swing only counts when a hole or a
  // sudden death is being played. Then the player who is up is swapped into the game before
  // the ball is played. In every other phase (a course loading, an intro, a result screen,
  // a finished match still on screen) the swing is dropped: not played as a round shot, not
  // counted, nothing spent. A launch monitor sends stray shots.
  // v2:shell The game's front end is in its menus (title, main menu): the swing is nobody's
  // shot. Not played, not counted, nothing spent; the page is told, so it can serve as
  // "press any key".
  if (connectHub.gate(ballData, source)) return null;   // v2:connect the connection wizard is on HIT A BALL: the swing is shown to it (event 'connect') and played in no game
  if (shellGate.closed) {
    console.log('[shell] swing ignored (the front end is in its menus)');
    broadcast('shell-swing', { speedMph: Number.isFinite(+ballData.Speed) ? +ballData.Speed : null });
    return null;
  }
  // v2:shell A solo run takes a swing only while a stage is being played (not while its
  // course loads, not over a result card). A practice game on the stage plays on.
  if (solo && !match && !game.practice && !solo.acceptsSwing) {
    console.log(`[solo] swing ignored (${solo.phase})`);
    broadcast('swing-ignored', { by: 'solo', phase: solo.phase });   // v3:modes the page is told (a swing skips a replay that is playing)
    return null;
  }
  let shooter = null;
  if (match) {
    try {
      shooter = game.course && !game.practice ? match.beforeShot(game) : null;
    } catch (error) {   // a broken match must not take the launch monitor's connection down with it
      console.error(`[match] dropped: ${error.stack || error.message}`);
      dropMatch();
      return null;
    }
    if (!shooter) {
      console.log(`[match] swing ignored (${match.phase})`);
      broadcast('swing-ignored', { by: 'match', phase: match.phase });   // v3:modes the page is told (a swing skips a replay that is playing)
      return null;
    }
  }
  // v3:modes a mode's game has the bay (bullseye, a trick-shot duel): the swing is its own
  const owner = activeMode();
  let ownerShot = null;
  if (owner) {
    try {
      ownerShot = game.course && !game.practice ? owner.beforeShot(game) : null;
    } catch (error) {
      console.error(`[${owner.id}] dropped: ${error.stack || error.message}`);
      owner.drop();
      return null;
    }
    if (!ownerShot) {
      console.log(`[${owner.id}] swing ignored`);
      return null;
    }
  }
  const before = game.course ? game.state() : null;   // where the ball is hit from
  // Arcade on: an armed power-up rides on this ball (and only this ball), and the
  // assists (dispersion, tap-ins) apply. Arcade off: shotMods stays null, a plain shot.
  // A league round's card is a competition's: it is graded, but played with a plain
  // ball under the round's own rules (an armed ball waits for the next casual shot).
  // A match shot takes its ball from the player's loadout and the tricks cast on them,
  // never from the bay's shelf (no consumeArmed).
  // A rocket hole (course.arcade.freeBall): the first stroke of the hole is played with
  // that ball for free. In a match the engine says so (shooter.free: no charge, the
  // player's own armed ball kept); in solo play the bay's shelf and its armed ball are
  // left as they are.
  const boosted = arcade.enabled && !(game.leagueRound && !game.practice);
  let pu = null;
  let free = false;
  if (shooter) {
    pu = shooter.armed;
    free = shooter.free === true;
    game.shotMods = arcade.enabled || pu || shooter.curses.length ? arcade.shotMods(pu, { curses: shooter.curses, putting: shooter.putting || match.putting /* v3:modes a handicapped player's own putting level */ }) : null;   // v2:playability the match's own putting assist (lib/match.js putting)
  } else if (ownerShot) {   // v3:modes the mode says what the ball is (never the bay's shelf)
    pu = ownerShot.armed || null;
    free = ownerShot.free === true;
    const curses = Array.isArray(ownerShot.curses) ? ownerShot.curses : [];
    game.shotMods = arcade.enabled || pu || curses.length ? arcade.shotMods(pu, { curses, ...(ownerShot.putting ? { putting: ownerShot.putting } : {}) }) : null;
  } else {
    const freeBall = boosted ? soloFreeBall() : null;
    free = Boolean(freeBall);
    pu = freeBall || (boosted ? arcade.consumeArmed() : null);
    game.shotMods = boosted ? arcade.shotMods(pu) : null;
  }
  let result;
  try { result = game.handleShot(ballData, clubName); } finally { game.shotMods = null; }
  if (!result) {   // no shot played: the ball goes back on the shelf, still armed (a match's or a free one was never taken)
    if (pu && !shooter && !ownerShot && !free) { arcade.refund(pu); broadcast('arcade-state', arcade.snapshot()); }
    return null;
  }
  result.shotId = ++shotSeq;
  if (source) result.source = source;   // v2:bridge
  if (free) result.freeBall = pu;   // the stage's free ball rode on this shot
  if (arcade.enabled) {
    const theme = game.course && game.course.arcade ? game.course.arcade.theme : null;   // v2:arcade-core water on a volcano stage is lava (callout MELTED!)
    const g = gradeShot({ result, before, practice: before.practice || null, streak: arcade.streak, powerup: pu, theme });
    const award = arcade.applyShot(g, { powerupUsed: pu, shotId: result.shotId });
    result.arcade = { shotId: result.shotId, ...g, powerup: pu, award, state: arcade.snapshot() };
  }
  // the club card (public/club-panel.js): the monitor's club data, the rest from the ball
  result.clubData = clubDelivery(clubData, ballData, result.clubKey, { isPutt: !!result.sim?.isPutt });
  const pr = before.practice || null;
  lastShot = {
    result,
    context: {
      shotId: result.shotId, at: Date.now(), course: before.courseName,
      hole: pr ? null : before.hole, holeRef: pr ? (pr.holeRef ?? null) : before.holeRef, practice: pr ? pr.mode : null,
      club: result.clubKey || result.club || null, pin: before.pin, tee: before.tee, aimDeg: before.aimDeg,
    },
  };
  // Match mode: the shot is the shooter's. Record it (with its arcade grade), decide the
  // hole / sudden death / match, and load whoever is up next, so the 'state' below shows
  // their ball.
  if (shooter) {
    try {
      const ev = match.afterShot(game, result);
      result.match = { playerId: shooter.playerId, powerup: shooter.armed, free, curses: shooter.curses, ...ev };
      if (ev && ev.stray) result.stray = true;   // v2:menu a stray ball (under 40 mph from a full-shot lie): the UI offers to take it back
    } catch (error) {   // as above: the shot was played; the match is let go
      console.error(`[match] dropped: ${error.stack || error.message}`);
      dropMatch();
      shooter = null;
    }
  }
  // v3:modes the shot is the mode's: it scores it and brings up whoever is next
  if (ownerShot) {
    try {
      result[owner.id] = owner.afterShot(game, result) || null;
    } catch (error) {
      console.error(`[${owner.id}] dropped: ${error.stack || error.message}`);
      owner.drop();
      ownerShot = null;
    }
  }
  // v3:modes every shot is offered to the modes that listen (the highlights reel)
  for (const md of modes) {
    if (typeof md.onShot !== 'function') continue;
    try { md.onShot(result, { before, match: shooter ? matchState() : null, solo: solo ? soloState() : null, mode: ownerShot ? owner.id : null }); } catch (error) { console.error(`[${md.id}] onShot: ${error.message}`); }
  }
  // v2:shell a solo run keeps the score of the stage (lib/solo.js); a pick-up ends the hole in the game too
  let soloEv = null;
  if (solo && !shooter && !ownerShot && !before.practice && solo.acceptsSwing) {
    soloEv = solo.recordShot(result);
    if (soloEv) {
      result.solo = { runId: solo.id, kind: solo.kind, ...soloEv };
      if (soloEv.pickedUp) game.nextHole();
      settleSolo();
    }
  }
  broadcast('shot', result);
  if (result.arcade) broadcast('arcade', result.arcade);
  if (soloEv) broadcast('solo', soloState());   // v2:shell
  if (ownerShot) broadcast(owner.id, owner.state());   // v3:modes
  if (shooter) {
    settleMatch();   // pays out once the match is decided (no-op before)
    driveMatch();    // the result screen's safety timeout
    broadcast('match', matchState());
  }
  broadcast('state', game.state());
  updatePlayerInfo();
  postLeagueRound();
  return result;
}

// A round started from a league posts its card the moment the round is finished: the
// last hole holed out, picked up or skipped.
function postLeagueRound() {
  const lr = game.leagueRound;
  if (!lr || !game.over || game.practice) return;
  game.leagueRound = null;
  game._undo = null;   // a posted card is final: no taking its last shot back
  const st = game.state();
  try {
    const r = leagues.postRound(lr.leagueId, lr.week, lr.playerId, {
      course: st.courseName, pars: st.pars, scores: st.scores, pickedUp: st.pickedUp,
    });
    broadcast('league-card', { ...r, leagueId: lr.leagueId, week: lr.week, playerName: lr.playerName });
    broadcast('leagues', leagues.state());
  } catch (error) {
    console.warn(`[leagues] card not posted: ${error.message}`);
  }
  broadcast('state', game.state());
}

// League and roster routes answer a LeagueError (bad input, a rule) with its message.
function leagueRoute(res, fn) {
  try {
    const out = fn();
    broadcast('leagues', leagues.state());
    return json(res, { ok: true, ...out });
  } catch (error) {
    if (error instanceof LeagueError) return json(res, { ok: false, error: error.message }, error.status);
    throw error;
  }
}

// Where the next ball is hit from, for the bag's history.
function shotOrigin() {
  if (!game.course) return {};
  const p = game.practice;
  if (p) {
    return { course: game.course.name, practice: p.mode, lie: p.lie, ...(p.target.ref != null ? { hole: p.target.ref } : {}) };
  }
  return { course: game.course.name, hole: game.hole ? (game.hole.ref ?? game.holeIndex + 1) : null, lie: game.lie };
}

// Every full launch-monitor shot goes into the player's bag (not putts, not mishits;
// /api/test-shot never comes through here).
function recordBagShot(shot, result, from) {
  const r = bag.recordShot({
    ball: shot.ball,
    clubName: shot.clubName,
    selectedClub: game.selectedClub,
    isPutt: Boolean(result && result.sim && result.sim.isPutt),
    meta: { ...from, at: Date.now() },
  });
  if (r.recorded) broadcast('bag', { club: r.club, n: r.n, total: bag.total });
  else if (r.reason !== 'putt') console.log(`[bag] shot not recorded: ${r.reason}${r.club ? ` (${r.club})` : ''}`);
}

// Prediction routes: a PredictError is the caller's (bad club / aim) or the game's
// (no course, not ready, hole finished) state, not a server failure.
function predictRoute(res, fn) {
  try {
    return json(res, fn());
  } catch (error) {
    if (error instanceof PredictError) return json(res, { ok: false, error: error.message, code: error.code }, error.status);
    throw error;
  }
}

function updatePlayerInfo() {
  if (!game.course) return;
  // the round's pin, or the practice target while on the range / in a mini game
  oc.setPlayer({ DistanceToTarget: Math.round(game.state().distToPinYd) });
}

function deriveActivationSource(request) {
  if (request?.source || (request?.osmType && request?.osmId != null)) {
    return normalizeCourseSource(request.source || request);
  }
  if (request?.cached) {
    const cachedCourse = loadCached(request.cached);
    if (cachedCourse?.source) return normalizeCourseSource(cachedCourse.source);
  }
  return normalizeCourseSource(null);
}

async function acquireActivationCourse(request, { abortDifferent, source }) {
  // v2:shell the game product only ever puts one of its own stages in the bay, from disk:
  // a search, a download or a real course is refused here, before any I/O (the one choke
  // point of every activation: boot, /api/load-course, a match stage, a solo stage)
  if (SIMCLASH) {
    const no = courseRefusal(request, { loadCached });
    if (no) throw Object.assign(new Error(no.message), { code: no.code });
  }
  const preloadedCourse = request.cached ? loadCached(request.cached) : null;
  return loadCourse(request, {
    abortDifferent,
    source,
    ...(preloadedCourse ? { preloadedCourse } : {}),
    // not cached here: try the cloud's package before building it locally
    ...(cloudCourses ? { remote: cloudCourses.acquire } : {}),
  });
}

function commitPreparedActivation({ candidate, resolvedPackage }) {
  let nextTimer = null;
  const hd = candidate.hdDescriptors.length > 0;
  if (hd && !STANDALONE) {
    const revision = resolvedPackage.courseRevision;
    nextTimer = setTimeout(() => {
      if (!game.runtimeReady && courseRevision === revision) {
        console.warn('[hd] no readiness ack from the app — playing the HD ground');
        game.activateRuntimeTerrain(activeHd.map((d) => d.grid));
        broadcast('state', game.state());
      }
    }, READY_TIMEOUT_MS);
    if (nextTimer.unref) nextTimer.unref();
  }

  game.commitPreparedCourse(candidate.preparedGameState);
  rollStageWind();   // v2:wind an arcade stage: a wind for the hole; any other course: the day's conditions
  activeHd = candidate.hdDescriptors;
  courseRevision = resolvedPackage.courseRevision;
  const previousTimer = readyTimer;
  readyTimer = nextTimer;
  if (previousTimer) clearTimeout(previousTimer);
  // no desktop app to wait for: the HD ground, now
  if (hd && STANDALONE) game.activateRuntimeTerrain(activeHd.map((d) => d.grid));
}

// A finished scenery layer: put it on the live course (only if that course is still
// the active one) and tell clients to refresh their scenery. Gameplay never reads
// these fields, so the round in progress is untouched.
function applyActiveScenery({ courseId, layer, course }) {
  const current = activationManager.current();
  if (!current || current.courseId !== courseId || !applySceneryUpdate(game.course, course)) return;
  console.log(`[scenery] ${layer} ready for ${courseId}`);
  broadcast('scenery', { courseId, courseRevision: current.courseRevision, layers: [layer] });
}

// Keep the cache under its cap; the active course (and any extra key, e.g. one
// being installed) is never evicted.
function trimCourseCache(...extraKeys) {
  const keep = [...extraKeys];
  const current = activationManager.current();
  if (current) {
    try { keep.push(packageKeyFor(parsePackageKey(current.courseId))); } catch (_) { /* no key form */ }
  }
  try { courseCache.enforce({ protect: keep }); }
  catch (error) { console.warn(`[cache] trim failed: ${error.message}`); }
}

const cloudCourses = cloudClient ? createCloudCourseSource({
  client: cloudClient,
  dataDir: DATA_DIR,
  onProgress: (progress) => broadcast('course-progress', progress),
  onInstalled({ key, manifest }) {
    courseCache.record(key, { origin: 'cloud', packageId: manifest.packageId, lastUsed: Date.now() });
    trimCourseCache(key);
  },
}) : null;

const sceneryEnricher = SCENERY_ENABLED ? createSceneryEnricher({
  cacheDir: path.join(DATA_DIR, 'courses'),
  // with a cloud, a course installed from a base package upgrades to the cloud's
  // tiled aerial once it is there
  aerialQuality: cloudClient ? 'tiled' : 'single',
  // With a cloud, scenery comes from the course's cloud package; buildings and the
  // single-request aerial can still be fetched here if the cloud cannot supply
  // them, but canopy (geotiff) only ever comes from the cloud.
  providers: cloudClient
    ? cloudSceneryProviders({ client: cloudClient, fallback: localSceneryProviders({ canopy: false }) })
    : localSceneryProviders(),
  onLayer(event) {
    applyActiveScenery(event);
    const key = packageKeyFor(event.course.source);
    courseCache.record(key); // the course grew
    trimCourseCache(key);
  },
  onProgress: (progress) => broadcast('course-progress', progress),
}) : null;

const activationManager = createCourseActivationManager({
  deriveSource: deriveActivationSource,
  acquireCourse: acquireActivationCourse,
  prepareCandidate: ({ course, source }) => prepareCourseCandidate({
    baseCourse: course,
    requestedIdentity: source,
    packsEnabled: process.env.BIRDIE_DISABLE_CURATED !== '1',
    dataDir: DATA_DIR,
    artDir: ART_DIR,
    prepareGame: (gameplayCourse, options) => game.prepareCourse(gameplayCourse, options),
  }),
  commitPreparedActivation,
  onPrepareFailed(error, { courseId }) {
    const cause = createCourseDiagnostic({
      code: error?.code || error?.name || 'ACTIVATION_PREPARE_FAILED',
      severity: 'error',
      stage: 'activation-private',
      courseId,
      message: sanitizePublicText(
        error?.message,
        'Course activation preparation failed.',
      ),
      recovery: 'Inspect the private activation log and retry the course.',
    });
    console.error(`[course] activation prepare failed: ${JSON.stringify(cause)}`);
  },
  onCommitted({ resolvedPackage, candidate }) {
    game.leagueRound = null;   // a new course ends a league round (/api/leagues/play sets it after)
    if (activeHd.length) {
      console.log(`[hd] ${activeHd.length} bundle(s) active: hole(s) ${activeHd.map((d) => d.hole).join(', ')}`);
    }
    updatePlayerInfo();
    broadcast('course', {
      name: candidate.gameplayCourse.name,
      courseId: resolvedPackage.courseId,
      courseRevision: resolvedPackage.courseRevision,
      contentRevision: resolvedPackage.contentRevision,
    });
    broadcast('state', game.state());
    const key = packageKeyFor(candidate.baseCourse.source);
    courseCache.touch(key);
    trimCourseCache(key);
    // The course is playable now; missing scenery follows in the background.
    if (sceneryEnricher) {
      sceneryEnricher.schedule({ source: candidate.baseCourse.source, course: candidate.baseCourse });
    }
  },
});

// ---------- HTTP ----------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.wasm': 'application/wasm', '.webp': 'image/webp' };   // v3:env-polish (.webp: the stage skies and ground sets, public/arcade/env)
// ES modules served from node_modules (keeps the app fully offline-capable). three.js is
// always used; 3d-tiles-renderer is only fetched when Google 3D tiles are configured.
const VENDOR = { '/vendor/three/': 'three', '/vendor/3d-tiles-renderer/': '3d-tiles-renderer' };
// Official Google Maps logo for the 3D-tiles attribution, if the user has installed it
// (else the page shows the words "Google Maps", which the Map Tiles policies allow).
const GOOGLE_LOGO = 'assets/attribution/google-maps-logo.svg';

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    if (p.startsWith('/api/voice/') || p.startsWith('/voice/names/')) return await require('./lib/voice').handle(req, res, { dataDir: DATA_DIR, url });   // v2:voice player-name clips for the announcer (lib/voice.js)
    if (p === '/api/launch-monitors' || p.startsWith('/api/connect/')) return await connectHub.handle(req, res, url);   // v2:connect the launch-monitor catalogue, the connection status, the chosen device, the wizard's test ball (lib/connect.js)
    if (p.startsWith('/api/course-art/')) {
      return await serveCourseArtRequest(req, res, {
        artRoot: ART_DIR,
        getActivePackage: () => activationManager.current(),
        lookupPrivateAsset: (contentRevision, assetKey) => (
          activationManager.lookupPrivateAsset(contentRevision, assetKey)
        ),
        onInternalError: (error) => {
          console.error(`[course-art] request rejected internally: ${error?.message || 'unknown error'}`);
        },
      });
    }
    if (p === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(`event: state\ndata: ${JSON.stringify(game.state())}\n\n`);
      res.write(`event: lm\ndata: ${JSON.stringify(lmStatus)}\n\n`);
      res.write(`event: foresight\ndata: ${JSON.stringify(foresight.status())}\n\n`);   // v2:bridge
      res.write(`event: arcade-state\ndata: ${JSON.stringify(arcade.snapshot())}\n\n`);
      res.write(`event: match\ndata: ${JSON.stringify(matchState())}\n\n`);
      // v2:shell this page's id (it names itself with it in POST /api/shell), and the solo run
      const cid = `c${++sseSeq}${Math.random().toString(36).slice(2, 8)}`;
      res.write(`event: hello\ndata: ${JSON.stringify({ cid, product: PRODUCT_MODE, shell: shellGate.state() })}\n\n`);
      res.write(`event: solo\ndata: ${JSON.stringify(soloState())}\n\n`);
      for (const md of modes) res.write(`event: ${md.id}\ndata: ${JSON.stringify(md.state())}\n\n`);   // v3:modes
      sseClients.add(res);
      sseCids.add(cid);
      req.on('close', () => { sseClients.delete(res); sseCids.delete(cid); shellGate.drop(cid); /* v2:shell a page that left the menus by closing does not hold the gate */ });
      return;
    }
    // v2:shell the product: which one this server is, and its name (public/product.json via
    // lib/product.js). /product.js is the page's bootstrap, a classic script that runs before
    // the modules (?sim=1 shows the simulator's screens on a game server).
    if (p === '/api/product' || p === '/product.js') {
      const name = require('./lib/product');
      const info = {
        mode: PRODUCT_MODE, version: require('./package.json').version,
        name: name.name, wordmark: name.wordmark, initials: name.initials, tagline: name.tagline, colors: name.colors, builtOn: name.builtOn, repo: name.repo,
        ocPort: OC_PORT,
      };
      if (p === '/api/product') return json(res, info);
      res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' });
      // the page's bootstrap: which product (the address can ask for the simulator's screens), the
      // name, and, for the game, the boot cover: the wordmark on black, drawn before any module
      // has loaded, so the first thing a player sees is the title and never a half-built HUD
      // (public/arcade/shell.js lifts it once the stage is in)
      const h = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
      const words = Array.isArray(name.wordmark) && name.wordmark.length ? name.wordmark : String(name.name).toUpperCase().split(/\s+/);
      const cover = `<div id="sc-boot" class="sc-boot"><div class="sc-title-c"><span class="sc-kicker">${h(name.tagline)}</span><h1 class="sc-title-w"><span class="sc-wordmark sc-wm-xl"><b class="sc-w1">${h(words[0])}</b>${words.length > 1 ? `<i class="sc-wslash"></i><b class="sc-w2">${h(words.slice(1).join(' '))}</b>` : ''}</span></h1><p class="sc-press sc-boot-load"><span>LOADING</span></p></div></div>`;
      const js = (v) => JSON.stringify(v).replace(/</g, '\\u003c');
      return res.end(`(function(){var p=${js(info)};try{var q=new URLSearchParams(location.search);if(q.get('sim')==='1'||q.get('arcade')==='0'||q.get('visualCapture')==='1')p.mode='open-birdie';}catch(e){}window.__PRODUCT__=p;var d=document.documentElement;d.setAttribute('data-product',p.mode);if(p.mode!=='simclash')return;document.title=p.name;d.classList.add('sc-menu');if(document.body)document.body.insertAdjacentHTML('afterbegin',${js(cover)});})();\n`);
    }
    if (p === '/api/solo' && req.method !== 'POST') return json(res, { ok: true, run: soloState(), bests: soloBests.all(), ...soloStages() });
    // v2:shell the game product has no course library, no course search, no web skies
    if (SIMCLASH) {
      if (p === '/api/courses') return json(res, { courses: [], featured: [] });
      if (p === '/api/courses/cached') return json(res, []);
      if (p === '/api/search') return json(res, { ok: false, error: 'This game plays its own stages only: no course search.', code: 'PRODUCT' }, 404);
      if (p === '/api/google-tiles-config') return json(res, { enabled: false, reason: 'product' });
      // a sky already on disk is served; none is fetched (the page falls back to the bundled sky) unless BIRDIE_SKY_FETCH=1 asks for the one-time download
      if (p.startsWith('/sky/') && process.env.BIRDIE_SKY_FETCH !== '1' && !skyCache.isCached(p.slice('/sky/'.length))) { res.writeHead(404); return res.end('not found'); }
    }
    if (p === '/api/state') return json(res, game.state());
    // Web skies, fetched once and then served from disk (lib/sky-cache.js).
    if (p.startsWith('/sky/')) return await skyCache.serve(req, res, p.slice('/sky/'.length));
    if (p === '/api/clubs') return json(res, CLUB_FULL);
    // Shot lineup: conditions, predictions, the player's bag (lib/conditions.js,
    // lib/predict.js, lib/bag.js).
    if (p === '/api/conditions' && req.method !== 'POST') {
      // v2:wind stageWind: the wind rolled for the arcade hole in play (null: the day's conditions
      // are in force); day: the day's conditions held aside meanwhile (null: none held)
      return json(res, { conditions: conditionsState(game.conditions), presets: PRESETS, stageWind: stageWind.current, day: stageWind.day ? conditionsState(stageWind.day) : null });
    }
    if (p === '/api/predict' && req.method !== 'POST') {
      return predictRoute(res, () => predictShot(game, {
        club: url.searchParams.get('club'),
        aimOffset: url.searchParams.get('aim'),
      }));
    }
    if (p === '/api/carries' && req.method !== 'POST') return predictRoute(res, () => predictCarries(game));
    if (p === '/api/bag' && req.method !== 'POST') return json(res, bag.summary());
    // Saved shots: the list (newest first), and one with its trajectory to replay
    if (p === '/api/saved-shots' && req.method !== 'POST') {
      return json(res, { shots: saved.list(), lastShotId: lastShot ? lastShot.context.shotId : null });
    }
    if (p.startsWith('/api/saved-shots/') && req.method === 'GET') {
      const one = saved.get(decodeURIComponent(p.slice('/api/saved-shots/'.length)));
      return one ? json(res, one) : json(res, { ok: false, error: 'No such saved shot' }, 404);
    }
    if (p === '/api/leagues' && req.method !== 'POST') return json(res, { ...leagues.state(), leagueRound: game.leagueRound });
    if (p === '/api/arcade' && req.method !== 'POST') return json(res, arcade.snapshot());
    if (p === '/api/foresight' && req.method !== 'POST') return json(res, foresight.status());   // v2:bridge the Foresight bridge's status (docs/foresight-bridge.md)
    if (p === '/api/match' && req.method !== 'POST') {
      // tour: the Clash Tour manifest (null: none built); profiles: every roster player's
      // (wallets: the same, under the name the first match UI read)
      const profiles = matchProfiles(leagues.state().players.map((x) => x.id));
      return json(res, { ok: true, match: matchState(), tour: matchTour(), tiers: MATCH_TIERS, formats: MATCH_FORMATS, profiles, wallets: profiles,
        partyFormats: PARTY_FORMATS, partyHoles: PARTY_HOLES, helpLevels: HELP_LEVELS /* v3:modes */ });
    }
    // v3:modes GET /api/<mode>: its state, and whatever else it has to show (high scores, arenas)
    if (req.method !== 'POST') {
      const md = modes.find((x) => p === `/api/${x.id}`);
      if (md) return json(res, { ok: true, [md.id]: md.state(), ...(typeof md.info === 'function' ? md.info() : {}) });
    }
    if (p === '/api/courses/cached') return json(res, listCached());
    if (p === '/api/courses') {
      return json(res, courseLibrary.list({ entries: courseCache.entries(), currentId: activationManager.current()?.courseId || null }));
    }
    if (p === '/api/search') {
      // Raw query: appending " golf" made Nominatim match addresses like
      // "Golf Place" (St Andrews' starter hut) instead of the course itself.
      return json(res, await searchCourses(url.searchParams.get('q') || ''));
    }
    if (req.method === 'POST') {
      const body = await readBody(req);
      // v3:modes POST /api/<mode>/<action> (docs/modes.md): answers { ok: true, <mode>: state, ... } or { ok: false, error }
      {
        const md = modes.find((x) => p.startsWith(`/api/${x.id}/`));
        if (md) {
          let extra;
          try {
            extra = await md.handle(p.slice(`/api/${md.id}/`.length), body);
          } catch (error) {
            if (!(error instanceof ModeError)) throw error;
            return json(res, { ok: false, error: error.message }, error.status);
          }
          return json(res, { ok: true, [md.id]: modeChanged(md.id), ...(extra && typeof extra === 'object' ? extra : {}) });
        }
        // a mode's game has the bay: the round's own moves wait (as in a match)
        const busy = activeMode();
        if (busy && (p === '/api/drop' || p === '/api/mulligan' || p === '/api/next-hole')) return json(res, { ok: false, error: `A ${busy.label || busy.id} game is in play` }, 409);
        if (p === '/api/reset' || (p === '/api/practice' && !body.action)) dropModes();
      }
      if (p === '/api/load-course') {
        // v2:shell the game product: one of its own stages, from disk, or nothing
        if (SIMCLASH) {
          const no = courseRefusal(body, { loadCached });
          if (no) return json(res, { ok: false, error: no.message, code: no.code }, 403);
        }
        dropModes();   // v3:modes
        dropSolo();    // v2:shell
        dropMatch();   // a match brings its own courses: loading one by hand ends it
        const result = await activationManager.activate(body);
        if (result.status === 'superseded') {
          return json(res, {
            ok: false,
            error: result.diagnostic.message,
            diagnostic: result.diagnostic,
          }, 409);
        }
        if (result.status === 'failed') {
          return json(res, {
            ok: false,
            error: result.diagnostic.message,
            diagnostic: result.diagnostic,
          }, 500);
        }
        // geometry is heavy (elevation grid) — clients refetch it themselves
        return json(res, {
          ok: true,
          holes: game.course.holes.length,
          courseId: result.package.courseId,
          courseRevision: result.package.courseRevision,
          contentRevision: result.package.contentRevision,
          ...(result.observerDiagnostic ? { diagnostics: [result.observerDiagnostic] } : {}),
        });
      }
      // v2:shell ---- the game's front end ----
      //   /api/shell             {cid, screen: 'menu'|'game'}  which screen this page is on (the swing gate)
      //   /api/solo/start        {kind: tour|stage|free, stage?: id, length?: n, playerId?}
      //   /api/solo/next         {}  leave a stage's card: the tour's next stage (free: the same again)
      //   /api/solo/restart-stage {}  the stage from its tee again (not in a tour)
      //   /api/solo/give-up      {}  pick the stage up (it costs, see lib/solo.js)
      //   /api/solo/abort        {}  end the run (also dismisses a finished one)
      // Every change broadcasts 'solo' with the run GET /api/solo gives.
      if (p === '/api/shell') {
        // only a page that is really there can hold the gate (it would never be let go otherwise)
        if (!sseCids.has(String(body.cid || ''))) return json(res, { ok: false, error: 'No such page: open the event stream first', ...shellGate.state() }, 409);
        return json(res, { ok: true, ...shellGate.set(body.cid, body.screen) });
      }
      if (p.startsWith('/api/solo/')) {
        try {
          if (p === '/api/solo/start') startSolo(body);
          else if (p === '/api/solo/abort') { dropSolo(); broadcast('state', game.state()); return json(res, { ok: true, run: null }); }
          else if (!solo) throw new SoloError('No solo game in play', 409);
          else if (p === '/api/solo/next') solo.next();
          else if (p === '/api/solo/restart-stage') solo.restartStage();
          else if (p === '/api/solo/give-up') { solo.giveUp(game.strokes); if (!game.over) game.nextHole(); }
          else throw new SoloError('No such solo route', 404);
        } catch (error) {
          if (!(error instanceof SoloError)) throw error;
          return json(res, { ok: false, error: error.message }, error.status);
        }
        return json(res, { ok: true, run: soloChanged() });
      }
      // v2:shell leagues (a course a week) belong to the simulator: the game keeps the roster only
      if (SIMCLASH && p.startsWith('/api/leagues')) return json(res, { ok: false, error: 'Leagues are part of the simulator.', code: 'PRODUCT' }, 404);
      // v2:bridge {mode?: 'auto'|'on'|'off', logFile?: ConnectDebug.txt or its folder ('' forgets it)}: answers the new status
      if (p === '/api/foresight') {
        try { return json(res, await foresight.configure(body)); }
        catch (error) {
          if (error.code !== 'BAD_SETTING') throw error;
          return json(res, { ok: false, error: error.message, code: error.code }, 400);
        }
      }
      if (p === '/api/test-shot') {
        // practice panel / testing without a launch monitor
        // club: optional Open Connect ClubData fields (Speed, Path, FaceToTarget,
        // AngleOfAttack, Loft, HorizontalFaceImpact, VerticalFaceImpact) to try the club card
        const club = body.club && typeof body.club === 'object' ? body.club : null;
        playShot({
          Speed: +body.speed, VLA: +body.vla, HLA: +body.hla || 0,
          TotalSpin: +body.spin || 0, SpinAxis: +body.spinAxis || 0,
        }, undefined, club);
        return json(res, { ok: true });
      }
      if (p === '/api/aim') {
        game.setAimOffset(body.offset);
        broadcast('state', game.state());
        return json(res, { ok: true });
      }
      // ---- match mode v2 (lib/match.js, docs/match.md) ----
      //   /api/match/start     {playerIds: [a, b], format: quick|bo3|bo9, stage?: id|'random'|'current',
      //                         order?: tour|shuffle, tieRule?: shootout|halve, powerups?: loadout|unlimited|off,
      //                         putting?: easy|assist|off (the putting assist of this match; default assist),
      //                         stakes?: null|tier, hazardLosesHole?}
      //   /api/match/ready     {}  the intro screens are done: tee off
      //   /api/match/continue  {}  leave the hole-result screen
      //   /api/match/arm       {playerId, id|null}  a ball for their next shot, or a trick on the opponent
      //   /api/match/concede   {playerId}
      //   /api/match/abort     {}  (also dismisses a finished match)
      //   /api/match/rematch   {}  the same players and options, a new match
      //   /api/match/undo          {}  take the last swing back            (v2:menu)
      //   /api/match/restart-hole  {}  the hole (or sudden-death round) again
      //   /api/match/drop          {playerId?}  the rescue drop for whoever is up (v2:playability)
      //   /api/match/restart       {}  the same match from the top, also while one is in play
      // Every change broadcasts 'match' with the state GET /api/match gives.
      if (p.startsWith('/api/match/')) {
        try {
          if (p === '/api/match/start') {
            startMatch(body);
          } else if (p === '/api/match/rematch') {
            if (!match) throw new MatchError('No match to play again', 409);
            if (match.active) throw new MatchError('A match is in play: quit it first', 409);
            const last = match.config();
            startMatch({ ...last.options, playerIds: last.players.map((x) => x.id), help: Object.fromEntries(last.players.map((x) => [x.id, x.help])) /* v3:modes */ });
          } else if (p === '/api/match/restart') {
            // v2:menu the match menu's RESTART MATCH: the same players and options from the top,
            // whatever the match in play is doing (rematch is for a finished one)
            if (!match) throw new MatchError('No match to restart', 409);
            const last = match.config();
            dropMatch();
            startMatch({ ...last.options, playerIds: last.players.map((x) => x.id), help: Object.fromEntries(last.players.map((x) => [x.id, x.help])) /* v3:modes */ });
          } else if (p === '/api/match/grant') {
            // top up profiles: {coins, playerIds?} (every player on the roster when none are named)
            const coins = Math.round(Number(body.coins));
            if (!Number.isFinite(coins) || coins === 0 || Math.abs(coins) > 10000000) throw new MatchError('coins: a whole number, up to ten million');
            const roster = leagues.state().players.map((x) => x.id);
            const ids = Array.isArray(body.playerIds) && body.playerIds.length ? body.playerIds.map(String).filter((id) => roster.includes(id)) : roster;
            if (!ids.length) throw new MatchError('No players to give coins to: add them from the player card first');
            for (const id of ids) { const w = matchProfile(id); w.coins = Math.max(0, w.coins + coins); }
            saveMatchLedger();
            broadcast('match', matchState());
            const profiles = matchProfiles(roster);
            return json(res, { ok: true, profiles, wallets: profiles });
          } else if (p === '/api/match/suggest') {
            // v3:modes {playerIds}: a help level for each of them from their records (never forced: the lobby offers it)
            const ids = (Array.isArray(body.playerIds) ? body.playerIds : []).map(String).filter((id) => leagues.player(id));
            return json(res, { ok: true, help: suggestHelp(matchProfiles(ids)), levels: HELP_LEVELS });
          } else if (p === '/api/match/abort') {
            dropMatch();
            return json(res, { ok: true, match: null });
          } else if (!match) {
            throw new MatchError('No match in play', 409);
          } else if (p === '/api/match/ready') {
            match.ready(game);       // no intro showing: nothing happens
          } else if (p === '/api/match/continue') {
            match.continue();        // no result showing: nothing happens
          } else if (p === '/api/match/undo') {
            undoMatchShot();             // v2:menu take the last swing back (also one that decided the hole or the match)
          } else if (p === '/api/match/drop') {
            // v2:playability {playerId?}: the player who is up takes the rescue drop (lib/match.js
            // drop): back on the line for a stroke, free out of a dead lie; it can decide the hole
            const ev = match.drop(game, body.playerId ?? null);
            broadcast('drop', { ...ev, match: true });
            settleMatch();
          } else if (p === '/api/match/restart-hole') {
            match.restartHole(game);     // v2:menu both players back on the tee of this hole (a sudden death: this round)
          } else if (p === '/api/match/concede') {
            match.concede(String(body.playerId ?? match.currentPlayerId ?? ''), game);   // v3:modes (the game: a party plays on, somebody else may come up)
            settleMatch();
          } else if (p === '/api/match/arm') {
            match.arm(String(body.playerId ?? match.currentPlayerId ?? ''), body.id ?? null, body.targetId ?? null);   // v3:modes targetId: who a trick is cast on (a party)
          } else {
            throw new MatchError('No such match route', 404);
          }
        } catch (error) {
          if (!(error instanceof MatchError)) throw error;
          return json(res, { ok: false, error: error.message }, error.status);
        }
        return json(res, { ok: true, match: matchChanged() });
      }
      // The arcade layer (lib/arcade.js, docs/arcade.md):
      //   /api/arcade/arm       {id}: arm a power-up for the next ball ({id: null}: put it back)
      //   /api/arcade/reset     wipe coins, xp, streak and inventory (settings stay)
      //   /api/arcade/settings  {enabled?, assist?: {putting?, dispersion?, tapInFt?}}
      // Every change broadcasts 'arcade-state' with the snapshot GET /api/arcade gives.
      if (p === '/api/arcade/arm' || p === '/api/arcade/settings') {
        // While a match is in play the dock arms for whoever is up, from their match loadout
        // (POST /api/match/arm): the bay's own shelf is not touched.
        if (p === '/api/arcade/arm' && match && match.active) {
          let armed;
          try {
            armed = match.arm(String(match.currentPlayerId ?? ''), body.id ?? null, body.targetId ?? null);   // v3:modes targetId: a trick's target in a party
          } catch (error) {
            if (!(error instanceof MatchError)) throw error;
            return json(res, { ok: false, error: error.message, code: 'MATCH' }, error.status);
          }
          matchChanged();
          const snap = arcade.snapshot();
          return json(res, { ok: true, armed, enabled: snap.enabled, unlimited: snap.unlimited, assist: snap.assist, match: true });
        }
        try {
          if (p === '/api/arcade/arm') arcade.arm(body.id ?? null);
          else {
            if (body.assist !== undefined) arcade.setAssist(body.assist);
            if (typeof body.enabled === 'boolean') arcade.setEnabled(body.enabled);
            if (typeof body.unlimited === 'boolean') arcade.setUnlimited(body.unlimited);
            syncPlayAssist();                      // v2:playability the play assists follow the layer
            broadcast('state', game.state());      // v2:playability (the aim range, the rescue drop)
          }
        } catch (error) {
          if (!(error instanceof ArcadeError)) throw error;
          return json(res, { ok: false, error: error.message, code: error.code }, 400);
        }
        const snap = arcade.snapshot();
        broadcast('arcade-state', snap);
        return json(res, { ok: true, armed: snap.armed, enabled: snap.enabled, unlimited: snap.unlimited, assist: snap.assist });
      }
      if (p === '/api/arcade/reset') {
        arcade.reset();
        broadcast('arcade-state', arcade.snapshot());
        return json(res, { ok: true });
      }
      // Driving range and mini games on the loaded course (lib/practice.js):
      //   {mode: range|closest|longdrive|targets|putting|chipping|ladder, targetYd?, hole?}
      //                                start (or restart); hole: the par 3 for closest, the
      //                                green for putting / chipping (default: the round's)
      //   {action: 'target', targetYd} move the range flag
      //   {action: 'end'}              back to the round
      if (p === '/api/practice') {
        if (!game.course) return json(res, { ok: false, error: 'Load a course first' }, 409);
        if (!body.action) dropMatch();   // starting a game ends a match; 'end' / 'target' don't
        if (!body.action && solo && solo.kind !== 'free') dropSolo();   // v2:shell ... and a scored solo run (free play keeps its stage)
        try {
          if (body.action === 'end') game.endPractice();
          else if (body.action === 'target') { if (game.practice) game.practice.setTarget(body.targetYd); }
          else game.startPractice(String(body.mode || 'range'), {
            targetYd: Number.isFinite(+body.targetYd) ? +body.targetYd : null,
            hole: Number.isInteger(body.hole) ? body.hole : null,
          });
        } catch (error) {
          return json(res, { ok: false, error: error.message }, 400);
        }
        updatePlayerInfo();
        broadcast('state', game.state());
        return json(res, { ok: true });
      }
      // Performance check (public/perf-check.mjs): a computer's frame times, kept as
      // DATA_DIR/perf-reports/<time>.json for tuning the sim PC's graphics
      if (p === '/api/perf-report') {
        const text = JSON.stringify(body);
        if (body?.version !== 1 || !Array.isArray(body.frames) || !Array.isArray(body.parts) || text.length > 65536) {
          return json(res, { ok: false, error: 'not a performance report' }, 400);
        }
        const dir = path.join(DATA_DIR, 'perf-reports');
        const file = `${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, file), JSON.stringify({ receivedAt: new Date().toISOString(), from: req.socket.remoteAddress, ...body }, null, 1));
        const frames = body.frames.map((f) => `${Number(f.ms).toFixed(1)} ms at ${String(f.canvas).slice(0, 12)}`).join(', ');
        const top = body.parts.filter((x) => x.canvas === body.frames[0]?.canvas).sort((a, b) => b.savedMs - a.savedMs).slice(0, 3)
          .map((x) => `${String(x.part).slice(0, 24)} ${Number(x.savedMs).toFixed(1)}`).join(', ');
        console.log(`[perf] ${String(body.gpu || 'unknown GPU').slice(0, 80)}, ${body.level}: ${frames}; most: ${top} (perf-reports/${file})`);
        return json(res, { ok: true, file: `perf-reports/${file}` });
      }
      if (p === '/api/club') {
        oc.setPlayer({ Club: toOpenConnectClub(body.club) });
        const selectedClub = game.setSelectedClub(body.club);
        broadcast('state', game.state());
        return json(res, { ok: true, selectedClub });
      }
      // {preset: 'windy'} (optionally with fields on top) or a partial conditions object
      if (p === '/api/conditions') {
        let conditions;
        try {
          conditions = game.setConditions(body);
        } catch (error) {
          if (error.code !== 'UNKNOWN_PRESET') throw error;
          return json(res, { ok: false, error: error.message, code: error.code }, 400);
        }
        try { saveConditionsFile(CONDITIONS_FILE, stageWind.changed(body)); }   // v2:wind never the rolled wind: the day's conditions (with this change) are what is kept
        catch (error) { console.warn(`[conditions] could not save: ${error.message}`); }
        broadcast('state', game.state());
        return json(res, { ok: true, conditions });
      }
      if (p === '/api/bag/reset') {
        await bag.reset();
        broadcast('bag', { reset: true, total: bag.total });
        return json(res, { ok: true, bag: bag.summary() });
      }
      // {shotId}: save the shot just played (refused once another has been hit since)
      if (p === '/api/saved-shots') {
        if (!lastShot || (body.shotId != null && body.shotId !== lastShot.context.shotId)) {
          return json(res, { ok: false, error: 'That shot is no longer the last one' }, 409);
        }
        const shot = saved.add(lastShot.result, lastShot.context);
        if (!shot) return json(res, { ok: false, error: 'That shot has no flight to save' }, 422);
        broadcast('saved-shots', { count: saved.count, saved: shot.id, shotId: lastShot.context.shotId });
        return json(res, { ok: true, shot });
      }
      if (p === '/api/saved-shots/remove') {
        const id = String(body.id || '');
        const ok = saved.remove(id);
        if (ok) broadcast('saved-shots', { count: saved.count, removed: id });
        return json(res, { ok });
      }
      // v2:playability DROP ON THE LINE in solo play (lib/game.js dropOnLine): the ball goes
      // back on the hole's routing line, on mown ground, no nearer the hole: +1 stroke, or
      // free when the game judges the lie dead (state.rescue). Broadcasts 'drop' and 'state'.
      // In a match: POST /api/match/drop.
      if (p === '/api/drop') {
        if (match && match.active) return json(res, { ok: false, error: 'A match is in play: its drop is POST /api/match/drop' }, 409);
        if (solo && solo.active && !solo.acceptsSwing) return json(res, { ok: false, error: 'No stage is being played' }, 409);   // v2:final a solo run takes a drop only where it takes a swing (not while a stage loads or over its card); its stroke is the game's own, so the run counts it
        const drop = game.dropOnLine();
        if (!drop) return json(res, { ok: false, error: 'There is no drop to take from here' }, 409);
        broadcast('drop', drop);
        broadcast('state', game.state());
        updatePlayerInfo();
        return json(res, { ok: true, drop });
      }
      // Take the hole's latest shot back (lib/game.js mulligan)
      if (p === '/api/mulligan') {
        if (match) return json(res, { ok: false, error: 'No mulligans in a match' }, 409);
        if (solo && solo.active && solo.kind !== 'free') return json(res, { ok: false, error: 'No mulligans in a solo run: the score counts' }, 409);   // v2:shell
        if (game.leagueRound) return json(res, { ok: false, error: 'No mulligans in a league round' }, 409);
        if (!game.mulligan()) return json(res, { ok: false, error: 'No shot to take back' }, 409);
        const st = game.state();
        broadcast('mulligan', { hole: st.hole, mulligans: st.mulligans[st.hole - 1] });
        broadcast('state', st);
        updatePlayerInfo();
        return json(res, { ok: true });
      }
      if (p === '/api/next-hole') {
        if (match && match.active) return json(res, { ok: false, error: 'A match is in play' }, 409);
        if (solo && solo.active) return json(res, { ok: false, error: 'A solo game is in play' }, 409);   // v2:shell (its own routes move it on)
        dropMatch();
        game.nextHole();
        rollStageWind();   // v2:wind the next hole of an arcade stage: a new wind
        updatePlayerInfo();
        broadcast('state', game.state());
        postLeagueRound();
        return json(res, { ok: true });
      }
      // ---- players and leagues (lib/leagues.js) ----
      if (p === '/api/players') return leagueRoute(res, () => ({ player: leagues.addPlayer(body) }));
      if (p === '/api/players/update') {
        return leagueRoute(res, () => {
          const player = leagues.updatePlayer(String(body.id || ''), body);
          setGamePlayer();
          broadcast('state', game.state());
          return { player };
        });
      }
      if (p === '/api/players/remove') {
        return leagueRoute(res, () => {
          leagues.removePlayer(String(body.id || ''));
          soloBests.forget(String(body.id || ''));   // v2:shell their solo bests go with them
          for (const md of modes) { try { if (md._bests && typeof md._bests.forget === 'function') md._bests.forget(String(body.id || '')); } catch (_) { /* a store of its own */ } }   // v3:modes ... and their Bullseye bests
          setGamePlayer();
          broadcast('state', game.state());
          return {};
        });
      }
      if (p === '/api/players/active') {
        return leagueRoute(res, () => {
          const id = String(body.id || '');
          if (game.leagueRound && game.leagueRound.playerId !== id) {
            throw new LeagueError(`${game.leagueRound.playerName} is playing a league round: finish it or leave it first`, 409);
          }
          leagues.setActivePlayer(id);
          setGamePlayer();
          broadcast('state', game.state());
          return {};
        });
      }
      if (p === '/api/leagues') return leagueRoute(res, () => ({ league: leagues.createLeague(body) }));
      if (p === '/api/leagues/update') return leagueRoute(res, () => ({ league: leagues.updateLeague(String(body.id || ''), body) }));
      if (p === '/api/leagues/remove') {
        return leagueRoute(res, () => {
          leagues.removeLeague(String(body.id || ''));
          if (game.leagueRound && game.leagueRound.leagueId === body.id) game.leagueRound = null;
          broadcast('state', game.state());
          return {};
        });
      }
      // {leagueId, week, playerId}: that player's card for that week, on the week's
      // course (loaded first when it isn't the one in play), from a fresh round
      if (p === '/api/leagues/play') {
        let pick;
        try {
          pick = leagues.weekToPlay(String(body.leagueId || ''), body.week, String(body.playerId || ''));
        } catch (error) {
          if (error instanceof LeagueError) return json(res, { ok: false, error: error.message }, error.status);
          throw error;
        }
        const { league, week } = pick;
        const c = week.course;
        const loaded = game.course && (c.courseId
          ? game.course.source && normalizeCourseSource(game.course.source).courseId === c.courseId
          : game.course.name === c.name);
        dropMatch();   // before the course changes under it
        if (!loaded) {
          const result = await activationManager.activate({ cached: c.cached, name: c.name });
          if (result.status === 'superseded' || result.status === 'failed') {
            return json(res, { ok: false, error: result.diagnostic.message }, result.status === 'failed' ? 500 : 409);
          }
        }
        dropMatch();
        if (game.practice) game.endPractice();
        game.reset();
        leagues.setActivePlayer(String(body.playerId));
        setGamePlayer();
        const pl = leagues.player(String(body.playerId));
        game.leagueRound = {
          leagueId: league.id, leagueName: league.name, week: week.n,
          playerId: pl.id, playerName: pl.name, course: c.name,
        };
        updatePlayerInfo();
        broadcast('state', game.state());
        broadcast('leagues', leagues.state());
        return json(res, { ok: true, leagueRound: game.leagueRound });
      }
      if (p === '/api/leagues/leave') {
        game.leagueRound = null;
        broadcast('state', game.state());
        return json(res, { ok: true });
      }
      if (p === '/api/course-runtime-ready') {
        const currentPackage = activationManager.current();
        const v = verifyReadinessAck(body, {
          currentRevision: currentPackage?.courseRevision || 0,
          currentBundleIds: activeHd.map((d) => d.bundleId),
          serverNonce: PRIMARY_NONCE,
          isLoopback: isLoopbackAddr(req.socket.remoteAddress),
        });
        if (!v.ok) return json(res, { ok: false, code: v.code }, 403); // nonce never echoed
        if (readyTimer) { clearTimeout(readyTimer); readyTimer = null; }
        game.activateRuntimeTerrain(v.mode === 'hd' ? activeHd.map((d) => d.grid) : []);
        broadcast('state', game.state());
        return json(res, { ok: true, mode: v.mode });
      }
      if (p === '/api/reset') {
        dropMatch();
        game.reset();
        rollStageWind();   // v2:wind a restart of an arcade stage: a new wind
        broadcast('state', game.state());
        return json(res, { ok: true });
      }
      // a partial settings object: {gimmeFt: 3}
      if (p === '/api/settings') {
        try {
          game.settings = normalizeSettings(body, game.settings);
        } catch (error) {
          if (error.code !== 'BAD_SETTING') throw error;
          return json(res, { ok: false, error: error.message, code: error.code }, 400);
        }
        try { saveSettingsFile(SETTINGS_FILE, game.settings); }
        catch (error) { console.warn(`[settings] could not save: ${error.message}`); }
        broadcast('state', game.state());
        return json(res, { ok: true, settings: game.settings });
      }
    }
    if (p.startsWith('/api/hd-assets/') && (req.method === 'GET' || req.method === 'HEAD')) {
      const m = /^\/api\/hd-assets\/([^/]+)\/([^/]+)$/.exec(p);
      const d = m && pickDescriptor(activeHd, m[1]);
      if (!d) { res.writeHead(404); return res.end('not found'); }
      return serveHdAsset(req, res, d, m[2]);
    }
    if (p === '/api/course-aerial' && (req.method === 'GET' || req.method === 'HEAD')) {
      const a = game.course && game.course.aerial;
      const fname = a && a.file ? path.basename(a.file) : null; // basename strips any path traversal
      if (!fname) { res.writeHead(404); return res.end('not found'); }
      try {
        const buf = fs.readFileSync(path.join(DATA_DIR, 'courses', fname));
        res.writeHead(200, { 'Content-Type': fname.endsWith('.png') ? 'image/png' : 'image/jpeg', 'Cache-Control': 'no-cache' });
        return res.end(req.method === 'HEAD' ? undefined : buf);
      } catch (e) { res.writeHead(404); return res.end('not found'); }
    }
    if (p === '/api/course-classmap' && (req.method === 'GET' || req.method === 'HEAD')) {
      const a = game.course && game.course.aerial;
      const fname = a && a.classFile ? path.basename(a.classFile) : null; // basename strips any path traversal
      if (!fname) { res.writeHead(404); return res.end('not found'); }
      try {
        const buf = fs.readFileSync(path.join(DATA_DIR, 'courses', fname));
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-cache' }); // classmap is always PNG (data, not photo)
        return res.end(req.method === 'HEAD' ? undefined : buf);
      } catch (e) { res.writeHead(404); return res.end('not found'); }
    }
    if (p === '/api/course-geometry') return json(res, courseGeometry());
    if (p === '/api/google-tiles-config') {
      const config = googleTilesConfig({
        loopback: isLoopbackAddr(req.socket.remoteAddress),
        logoUrl: fs.existsSync(path.join(PUB, GOOGLE_LOGO)) ? GOOGLE_LOGO : null,
      });
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(config));
    }

    for (const [prefix, pkg] of Object.entries(VENDOR)) {
      if (!p.startsWith(prefix)) continue;
      const base = path.join(__dirname, 'node_modules', pkg);
      const rel = path.normalize(p.slice(prefix.length)).replace(/^([.][.][/\\])+/, '');
      const tfull = path.join(base, rel);
      if (!tfull.startsWith(base) || !fs.existsSync(tfull) || !fs.statSync(tfull).isFile()) {
        res.writeHead(404); return res.end('not found');
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(tfull)] || 'application/octet-stream' });
      return fs.createReadStream(tfull).pipe(res);
    }

    // static
    let file = p === '/' ? '/index.html' : p;
    file = path.normalize(file).replace(/^([.][.][/\\])+/, '');
    const full = path.join(PUB, file);
    if (!full.startsWith(PUB) || !fs.existsSync(full)) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
    fs.createReadStream(full).pipe(res);
  } catch (err) {
    console.error(`[HTTP] ${p}:`, err.message);
    const diagnostic = createCourseDiagnostic({
        code: 'HTTP_REQUEST_FAILED',
        severity: 'error',
        stage: 'http',
        message: 'The request could not be completed.',
        recovery: 'Retry the request.',
      });
    json(res, { ok: false, error: diagnostic.message, diagnostic }, 500);
  }
});

// True iff both bounds exist and their extents are equal (tiny epsilon for float noise).
// The classmap's staleness key: it was generated against aerial.classBounds, so if a
// manual aerial swap has since changed aerial.bounds, the pixels no longer register.
function sameBounds(x, y) {
  if (!x || !y) return false;
  const eq = (a, b) => Math.abs(a - b) < 1e-6;
  return eq(x.minX, y.minX) && eq(x.minY, y.minY) && eq(x.maxX, y.maxX) && eq(x.maxY, y.maxY);
}

function courseGeometry() {
  const activePackage = activationManager.current();
  if (!game.course || !activePackage) return null;
  const { name, surfaces, boundary, holes, trees, woods, buildings, elevation } = game.course;
  // projection origin of the course-local metres (lib/course.js parseOsm) — places
  // geographic content such as Google 3D tiles; client-only, not part of any fingerprint
  const origin = game.course.origin && Number.isFinite(game.course.origin.lat) && Number.isFinite(game.course.origin.lon)
    ? { lat: game.course.origin.lat, lon: game.course.origin.lon } : null;
  // real trees [[x, y, heightM, crownRadiusM], ...] from canopy height data (non-fingerprinted scenery)
  const canopy = game.course.canopy?.trees || null;
  // lakes/ponds around the course [{ kind: 'water', poly, name, played }] (non-fingerprinted
  // scenery, never part of `surfaces`): all drawn; `played` on those that reach the
  // course, which play as water (lib/course.js lakesInPlay)
  const water = game.course.scenery?.water;
  const played = new Set(lakesInPlay(game.course));
  const sceneryWater = Array.isArray(water) ? water.map((w) => (played.has(w) ? { ...w, played: true } : w)) : null;
  // Course-wide aerial: bounds only (the image is fetched from /api/course-aerial);
  // never leak the server file path. Drapes the whole course as the ground photo.
  // classes: advertise the runtime NDVI classmap ONLY when it's fresh — i.e. it was
  // built against these same bounds. A stale classmap (aerial hand-swapped since) would
  // sample surfaces at UV coords from the NEW bounds against OLD pixels → mis-registered;
  // mismatch => classes:false => the shader falls back to OSM-only masks (safe).
  const a = game.course.aerial;
  const aerial = a ? {
    bounds: a.bounds,
    classes: !!(a.classFile && a.classBounds && sameBounds(a.classBounds, a.bounds)),
  } : null;
  // hd is an ARRAY of sanitized metadata (one per built hole; no absolute paths,
  // no Float32 heights), or null when the course has no HD bundles.
  const hd = activeHd.length ? activeHd.map(publicHdMetadata) : null;
  return {
    name,
    origin,
    surfaces,
    boundary,
    holes,
    trees,
    woods,
    buildings,
    canopy,
    sceneryWater,
    // hero scenery of a hand-built arcade hole [{ id, kind, x, y, rotDeg, heightM }]
    // (tools/arcade-holes; drawn by public/render/props.js, never part of play)
    props: Array.isArray(game.course.props) ? game.course.props : null,
    // v3:living the stage's life [{ kind, ... }] (public/render/world-life.js; drawn by public/render/world-events.js, never part of play)
    life: Array.isArray(game.course.life) ? game.course.life : null,
    // v3:gadgets the stage's gadgets [{ id, kind, x, y, z?, ... }] (lib/gadgets.js; drawn by public/render/gadgets.js, played by lib/physics.js)
    gadgets: Array.isArray(game.course.gadgets) ? game.course.gadgets : null,
    arcade: game.course.arcade || null,   // v2:look the stage's theme and time of day (public/render/arcade-look.js)
    aerial,
    elevation,
    hd,
    courseId: activePackage.courseId,
    courseRevision: activePackage.courseRevision,
    contentRevision: activePackage.contentRevision,
    presentation: activePackage.presentation,
    terrainPatches: activePackage.terrainPatches,
    assetManifest: activePackage.assetManifest,
    diagnostics: activePackage.diagnostics,
  };
}

function json(res, obj, code = 200) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

if (SPEED_SCALE !== 1) console.log(`[OC] BIRDIE_SPEED_SCALE=${SPEED_SCALE} — scaling incoming ball speed`);
async function bootstrap() {
  require('./lib/arcade-bundle').installArcadeBundle({ dataDir: DATA_DIR });   // v2:release the bundled arcade stages into the data dir (opt-in: main.js or --bundled-arcade), before the courses are listed
  require('./lib/sky-bundle').installSkyBundle({ dataDir: DATA_DIR });   // v2:final and the sky photos those stages are lit by, into the sky cache (the game never downloads one)
  if (cloudClient) {
    console.log(`[cloud] courses come from ${new URL(cloudClient.baseUrl).host}${cloudClient.canBuild ? ' (can request builds)' : ''}`);
  }
  const usage = courseCache.scan();
  if (usage.courses) {
    const limit = Number.isFinite(usage.limitBytes) ? `${Math.round(usage.limitBytes / 1048576)} MB` : 'no limit';
    console.log(`[cache] ${usage.courses} course(s), ${Math.round(usage.bytes / 1048576)} MB (cap ${limit})`);
  }
  if (!process.env.BIRDIE_NO_AUTOLOAD) {
    const cached = listCached();
    // v2:shell the game boots onto one of its own stages (the title screen's backdrop), never a real course
    const first = SIMCLASH ? bootStage({ tour: matchTour(), cached, loadCached }) : (cached.length ? cached[0].file : null);
    if (first) {
      const result = await activationManager.activate({ cached: first });
      if (result.status === 'committed') {
        console.log(`[course] loaded cached: ${game.course.name} (${game.course.holes.length} holes)`);
      } else {
        console.error(`[course] cache load failed: ${JSON.stringify(result.diagnostic)}`);
      }
    }
  }
  return new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once('error', onError);
    server.listen(HTTP_PORT, HTTP_HOST, () => {
      server.off('error', onError);
      const actualPort = server.address().port;
      const exposed = HTTP_HOST !== '127.0.0.1' && HTTP_HOST !== 'localhost';
      console.log(`[HTTP] Open-Birdie UI: http://localhost:${actualPort}` +
        (exposed ? `  (exposed on ${HTTP_HOST} — trusted networks only)` : '  (localhost only — set BIRDIE_HOST=0.0.0.0 to mirror on your LAN)'));
      resolve({ httpPort: actualPort });
      // read the downloaded courses once now, so the course picker opens at once
      setImmediate(() => { try { courseLibrary.list(); } catch (_) { /* listed on demand */ } });
      // every web sky on disk while there is internet, so all of them work offline too
      // (lib/sky-cache.js). Off with the other background downloads (BIRDIE_ENRICH=0)
      // or on its own with BIRDIE_SKY_PREFETCH=0.
      if (SCENERY_ENABLED && process.env.BIRDIE_SKY_PREFETCH !== '0') {
        try { skyKeeper = skyCache.keepAll(webSkyFiles(path.join(__dirname, 'public', 'render', 'sky-presets.js'))); }
        catch (error) { console.warn(`[sky] background download not started: ${error.message}`); }
      }
    });
  });
}

// v3:modes the modes (each is skipped quietly while its file is not in the build)
registerMode('./lib/bullseye-mode');
registerMode('./lib/duel-mode');
registerMode('./lib/highlights-mode');
const ready = bootstrap();
connectHub.start();   // v2:connect (was: oc.start()) looks for another program on the port first, listens, and keeps trying while it is taken
foresight.start().catch((error) => console.error('[foresight] ' + error.message));   // v2:bridge up when the setting says so (never fatal: a taken port is reported and retried)

function close() {
  clearMatchTimer();
  if (readyTimer) {
    clearTimeout(readyTimer);
    readyTimer = null;
  }
  if (sceneryEnricher) sceneryEnricher.cancelAll();
  if (skyKeeper) { skyKeeper.stop(); skyKeeper = null; }
  for (const res of sseClients) { try { res.end(); } catch (_) { /* gone */ } }
  sseClients.clear();
  try { server.close(); } catch (_) { /* already closed */ }
  foresight.stop().catch(() => {});   // v2:bridge
  connectHub.stop();   // v2:connect
  try {
    oc.server.close();
    for (const s of oc.clients) s.destroy();
  } catch (_) { /* already closed */ }
}

module.exports = {
  ready,
  close,
  primaryNonce: PRIMARY_NONCE,
  productMode: PRODUCT_MODE,   // v2:shell
  foresight,   // v2:bridge
  connectHub,   // v2:connect
  activationManager,
  sceneryEnricher,
  modes,   // v3:modes
};
