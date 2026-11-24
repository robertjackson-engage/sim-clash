'use strict';
// v2:shell The product switch (docs/sim-clash-shell.md).
//
// One code base, two products:
//
//   simclash     (the default) the GAME. Only its own arcade stages, a title screen and a
//                main menu in front of them, no real-course feature anywhere, and a server
//                that never goes to the network on its own.
//   open-birdie  the original golf SIMULATOR, untouched: real courses from OpenStreetMap,
//                the course picker, scorecards, leagues, scenery downloads, the cloud.
//
// BIRDIE_PRODUCT=open-birdie starts the simulator; anything else (or nothing) the game. The
// page follows the server (GET /product.js); ?sim=1 shows the simulator's screens on a game
// server (its real-course routes stay refused: start the server as open-birdie for those).
//
// This file is the pure part: what the mode is, which course requests the game accepts, and
// the swing gate of the game's front end (a swing while the menus are up is nobody's shot).
// The product's NAME is somewhere else: public/product.json (lib/product.js).

const SIMULATOR_WORDS = new Set(['open-birdie', 'openbirdie', 'birdie', 'sim', 'simulator']);
const GAME_WORDS = new Set(['simclash', 'sim-clash', 'game']);

/**
 * 'simclash' (the default) or 'open-birdie', from the environment.
 *
 * One exception to "the game unless told otherwise": under Node's test runner (`node --test`
 * marks every test process, and the processes they spawn, with NODE_TEST_CONTEXT) a server
 * that is not told which product it is runs as the SIMULATOR. The upstream simulator's
 * suites start servers on real courses and expect searches and downloads to be attempted;
 * they were written before there was a switch and must keep testing what they test without
 * each of them being edited. The game's own tests say BIRDIE_PRODUCT=simclash.
 */
function productMode(env = process.env) {
  const v = String((env && env.BIRDIE_PRODUCT) || '').trim().toLowerCase();
  if (SIMULATOR_WORDS.has(v)) return 'open-birdie';
  if (GAME_WORDS.has(v)) return 'simclash';
  if (env && env.NODE_TEST_CONTEXT) return 'open-birdie';
  return 'simclash';
}

/** A hand-built arcade stage: a course whose arcade block names a theme (tools/arcade-holes). */
function isArcadeCourse(course) {
  const a = course && course.arcade;
  return Boolean(a && typeof a === 'object' && !Array.isArray(a) && typeof a.theme === 'string' && a.theme.trim());
}

/**
 * May the game product put this course in the bay? Only a stage that is already on disk:
 * a request by cache file name whose course is an arcade stage. Anything that would mean a
 * search, a download or a build (an OSM id, a bounding box, a name) is refused before any
 * I/O. -> null when it is fine, else { code, message }.
 *   request      what /api/load-course takes
 *   loadCached   (file) -> the cached course, or null
 */
function courseRefusal(request, { loadCached } = {}) {
  const refuse = (message) => ({ code: 'PRODUCT_COURSE_REFUSED', message });
  const file = request && typeof request.cached === 'string' ? request.cached : '';
  if (!file) return refuse('This game plays its own stages only: no course search or download.');
  if (!/^[A-Za-z0-9._-]+\.json$/.test(file)) return refuse('No such stage.');
  let course = null;
  try { course = typeof loadCached === 'function' ? loadCached(file) : null; } catch (_) { course = null; }
  if (!course) return refuse('No such stage.');
  if (!isArcadeCourse(course)) return refuse('That is a real course: this game plays its own stages only.');
  return null;
}

/**
 * The stage the game boots onto (the title screen's backdrop): the first stage of the tour
 * that is really on disk, else the first arcade course in the cache, else null.
 *   tour      the tour manifest as the server reads it ({ stages, tiebreaks }) or null
 *   cached    [{ file }] every cached course (lib/course.js listCached)
 */
function bootStage({ tour = null, cached = [], loadCached } = {}) {
  const ok = (file) => !courseRefusal({ cached: file }, { loadCached });
  const stages = tour && Array.isArray(tour.stages) ? [...tour.stages].sort((a, b) => (a.order || 0) - (b.order || 0)) : [];
  for (const s of stages) if (s && typeof s.file === 'string' && ok(s.file)) return s.file;
  for (const c of Array.isArray(cached) ? cached : []) if (c && typeof c.file === 'string' && ok(c.file)) return c.file;
  return null;
}

/**
 * The front end's swing gate. The page says which screen it is on (POST /api/shell): while
 * the one that spoke last is in the menus, a swing is dropped (not played, not counted,
 * nothing spent) and the page is told, so a real swing can serve as "press any key". The
 * gate belongs to a connected page: when that page goes away (its event stream closes) the
 * gate opens again, so a headless server, a test or a tool is never left locked out.
 */
function createShellGate() {
  let holder = null;   // { cid, screen } of the page that spoke last
  return {
    /** screen: 'menu' (title, main menu, any screen that is not a game) or 'game'. */
    set(cid, screen) {
      const id = String(cid || '');
      if (!id) return this.state();
      holder = { cid: id, screen: screen === 'menu' ? 'menu' : 'game' };
      return this.state();
    },
    /** That page's event stream closed. */
    drop(cid) {
      if (holder && holder.cid === String(cid || '')) holder = null;
    },
    /** True while swings are to be dropped. */
    get closed() { return Boolean(holder && holder.screen === 'menu'); },
    state() { return { inMenu: this.closed, cid: holder ? holder.cid : null }; },
  };
}

module.exports = { productMode, isArcadeCourse, courseRefusal, bootStage, createShellGate };
