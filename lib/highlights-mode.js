'use strict';
// v3:modes HIGHLIGHTS, the server's side (docs/modes.md "Instant replay and highlights").
// Registered with the mode registry of server.js; it never owns a swing (active: false). It
// listens to every shot the bay plays (onShot), marks the notable ones on the shot itself
// (result.highlight = { id, why, title, auto }: the page plays those again from another
// camera, public/arcade/replay.js), keeps them in the reel (lib/highlights.js: the last
// game's in memory, the night's best in <dataDir>/highlights.json), and plays one back on
// request:
//
//   GET  /api/highlights            { ok, highlights: state }
//   POST /api/highlights/play       { id, camera? }   put its stage in the bay if it is not
//                                   (refused with 409 while a match, a solo run or a mode's
//                                   game has the bay), then broadcast 'replay' { id, at,
//                                   camera, highlight } (the whole record, path and all)
//   POST /api/highlights/remove     { id }
//   POST /api/highlights/clear      { which: 'last' | 'night' | 'all' }
//
// Event 'highlights': the reel (state()), on connect and whenever it changes.
const fs = require('fs');
const path = require('path');
const { createHighlights, notable, recordOf } = require('./highlights');

function create(ctx) {
  const file = path.join(ctx.dataDir, 'highlights.json');
  const reel = createHighlights({
    read: () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; } },
    write: (obj) => {
      try { fs.mkdirSync(ctx.dataDir, { recursive: true }); fs.writeFileSync(file, JSON.stringify(obj)); } catch (error) { console.warn(`[highlights] not saved: ${error.message}`); }
    },
  });

  // The stage a shot was hit on: its tour entry (for its course file), by id when the game
  // says which stage it is, else by the name of the course in the bay.
  function stageOf(about) {
    const before = about.before || {};
    const tour = ctx.tour() || {};
    const list = [...(Array.isArray(tour.stages) ? tour.stages : []), ...(Array.isArray(tour.tiebreaks) ? tour.tiebreaks : [])];
    const m = about.match, s = about.solo;
    const id = (m && m.stage && m.stage.id) || (s && Array.isArray(s.stages) && s.stages[s.index] && s.stages[s.index].id) || null;
    const name = String(before.courseName || '');
    const hit = (id && list.find((x) => x.id === id)) || list.find((x) => x.name === name || x.name === name.split(',')[0]) || null;
    return { id: hit ? hit.id : (id && id !== 'current' && id !== 'shootout' ? id : null), name: (m && m.stage && m.stage.name) || (hit && hit.name) || name, file: hit ? hit.file : null };
  }
  function playerOf(result, about) {
    const m = about.match;
    if (m && result.match && result.match.playerId != null) {
      const p = (m.players || []).find((x) => String(x.id) === String(result.match.playerId));
      if (p) return { id: p.id, name: p.name, slot: p.slot ?? null };
    }
    const g = ctx.game.player || (about.solo && about.solo.player) || null;
    return g ? { id: g.id ?? null, name: g.name || 'Player 1', slot: null } : { id: null, name: 'Player 1', slot: null };
  }
  function gameOf(about) {
    const m = about.match, s = about.solo;
    if (m) return { id: m.id, kind: 'match', label: m.formatLabel || null };
    if (about.mode) return { id: about.mode, kind: 'mode', label: String(about.mode).toUpperCase() };
    if (s && s.id) return { id: s.id, kind: s.kind === 'free' ? 'free' : 'solo', label: s.kind === 'tour' ? 'SOLO TOUR' : s.kind === 'stage' ? 'SOLO STAGE' : 'FREE PLAY' };
    return { id: (about.before && about.before.courseName) || null, kind: 'free', label: 'FREE PLAY' };
  }

  function state() {
    // the award was given on a swing that has since been taken back (POST /api/match/undo): it is not given yet
    const s = reel.state();
    if (s.shotOfMatch) {
      const ms = ctx.matchState();
      if (ms && ms.id === s.shotOfMatch.matchId && ms.phase !== 'done' && reel.unaward(ms.id)) return reel.state();
    }
    return s;
  }

  // What has the bay right now ('match' | 'solo' | a mode's id), or null: its stage must stay.
  function busy() {
    if (typeof ctx.busy === 'function') return ctx.busy();
    const ms = ctx.matchState();
    return ms && ms.phase !== 'done' ? 'match' : null;
  }

  return {
    id: 'highlights',
    label: 'highlights',
    get active() { return false; },   // it never owns a swing
    state,
    drop() { /* nothing to let go of */ },
    reel,   // (tests)

    onShot(result, about = {}) {
      if (!result || !result.sim || !Array.isArray(result.sim.points) || result.sim.points.length < 2) return;
      const before = about.before || {};
      if (before.practice) return;   // a practice game's flags are not a hole
      const seq0 = reel.seq;
      reel.touch();
      const m = about.match || null;
      const note = notable(result, about);
      const base = () => recordOf(result, about, { note, stage: stageOf(about), game: gameOf(about), player: playerOf(result, about) });
      let kept = null;
      if (note) {
        kept = reel.add(base());
        // the page plays it again: by itself in a match (once), offered in solo play
        result.highlight = { id: kept.id, why: [...kept.why], title: kept.title, auto: Boolean(m) };
      }
      if (m && result.match && result.match.playerId != null) {
        const offered = reel.offerBest(m.id, result.match.playerId, kept || base());
        if (offered && !result.highlight) result.replayId = offered.id;   // (not marked: only kept in case it is the shot of the match)
        if (m.phase === 'done' && Array.isArray(m.awards)) {
          const award = m.awards.find((a) => a && a.id === 'shot-of-the-match');
          if (award) reel.awardShotOfMatch(m.id, award);
        }
      }
      if (reel.seq !== seq0) ctx.broadcast('highlights', state());
    },

    async handle(action, body = {}) {
      if (action === 'play') {
        const h = reel.get(String(body.id ?? ''));
        if (!h) throw new ctx.ModeError('No such highlight', 404);
        const inBay = ctx.game.course && h.stage.courseName && ctx.game.course.name === h.stage.courseName;
        let loaded = false;
        if (!inBay) {
          const who = busy();
          if (who) throw new ctx.ModeError(`A ${who === 'match' ? 'match' : who === 'solo' ? 'solo game' : `${who} game`} is in play: finish or leave it first`, 409);
          const tour = ctx.tour() || {};
          const list = [...(Array.isArray(tour.stages) ? tour.stages : []), ...(Array.isArray(tour.tiebreaks) ? tour.tiebreaks : [])];
          const entry = list.find((x) => (h.stage.file && x.file === h.stage.file) || (h.stage.id && x.id === h.stage.id)) || null;
          if (!entry) throw new ctx.ModeError(`${h.stage.name || 'That stage'} is not installed any more`, 409);
          const error = await ctx.loadStage(entry.file);
          if (error) throw new ctx.ModeError(`${h.stage.name || 'That stage'} would not load: ${error}`, 409);
          ctx.setGamePlayer();
          loaded = true;
        }
        const camera = ['greenside', 'topdown', 'reverse'].includes(body.camera) ? body.camera : null;
        ctx.broadcast('replay', { id: h.id, at: Date.now(), camera, loaded, highlight: h });
        return { playing: h.id, loaded };
      }
      if (action === 'remove') {
        if (!reel.remove(String(body.id ?? ''))) throw new ctx.ModeError('No such highlight', 404);
        return { removed: String(body.id) };
      }
      if (action === 'clear') {
        const which = ['last', 'night', 'all'].includes(body.which) ? body.which : 'all';
        reel.clear(which);
        return { cleared: which };
      }
      throw new ctx.ModeError('No such highlights route', 404);
    },
  };
}

module.exports = { create };
