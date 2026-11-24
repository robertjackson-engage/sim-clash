/**
 * The announcer's queue: the part of ArcadeAudio.say() that has nothing to do with Web
 * Audio, so it runs (and is tested) under Node. audio.js supplies `load` and `play`.
 *
 *   say('slice-house')                                  one line
 *   say(['m-player-1', 'm-wins-the-match'])             a sentence: lines back to back
 *   say([{ name: 'Alex', fallback: 'm-player-1' }, 'm-wins-the-match'])
 *
 * Lines play one after another and never overlap. A say() with a HIGHER priority than
 * everything playing and waiting clears the queue and cuts in; anything else waits its
 * turn. A sentence that has waited too long to start (maxWaitMs) is dropped: a shot
 * callout six seconds late is worse than none.
 */

export const DEFAULT_PACK = 'announcer';
const PACK_RX = /^[a-z0-9][a-z0-9-]{0,31}$/;

/** The pack asked for with ?voice=<pack>, or null. */
export function packFromQuery(search) {
  try {
    const v = new URLSearchParams(String(search || '')).get('voice');
    return v && PACK_RX.test(v) ? v : null;
  } catch (_) {
    return null;
  }
}

/** File-safe id of a player's name. Must match nameSlug() in lib/voice.js (the tests hold them together). */
export function nameSlug(name) {
  const s = String(name == null ? '' : name).normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/g, '');
  if (s) return s;
  const cps = Array.from(String(name == null ? '' : name).trim()).slice(0, 8)
    .map((c) => c.codePointAt(0).toString(16)).join('-');
  return cps ? `u-${cps}`.slice(0, 48).replace(/-+$/g, '') : '';
}

/** A random take out of `count`, never `last` again when there is another to choose. */
export function pickTake(count, last = -1, random = Math.random) {
  const n = Math.floor(Number(count) || 0);
  if (n <= 0) return -1;
  if (n === 1) return 0;
  const r = Math.min(0.999999, Math.max(0, Number(random()) || 0));
  if (!(last >= 0 && last < n)) return Math.floor(r * n);
  const k = Math.floor(r * (n - 1));
  return k >= last ? k + 1 : k;
}

/**
 * say()'s `line` argument as a list of items:
 *   'id' -> { kind: 'line', id }        { name, fallback } -> { kind: 'name', name, fallback }
 * Anything else is dropped.
 */
export function normaliseLine(line) {
  const out = [];
  for (const it of Array.isArray(line) ? line : [line]) {
    if (typeof it === 'string') {
      if (it) out.push({ kind: 'line', id: it });
    } else if (it && typeof it === 'object') {
      const fallback = typeof it.fallback === 'string' && it.fallback ? it.fallback : null;
      if (typeof it.name === 'string' && it.name.trim()) out.push({ kind: 'name', name: it.name.trim(), fallback });
      else if (typeof it.id === 'string' && it.id) out.push({ kind: 'line', id: it.id });
      else if (fallback) out.push({ kind: 'line', id: fallback });
    }
  }
  return out;
}

export class VoiceQueue {
  /**
   * load(item)        -> Promise of a clip (anything play() understands) or null. Never needs to reject.
   * play(clip, done)  -> starts the clip NOW, calls done() when it has finished by itself, and
   *                      returns a function that stops it early (done is then not expected).
   * onActive(bool)    -> the voice started speaking / the queue ran dry (used to duck the effects).
   */
  constructor({ load, play, onActive = () => {}, now = () => Date.now(), setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = (t) => clearTimeout(t), maxPending = 8, loadTimeoutMs = 1500 } = {}) {
    this._load = load;
    this._play = play;
    this._onActive = onActive;
    this._now = now;
    this._setTimer = setTimer;
    this._clearTimer = clearTimer;
    this._maxPending = maxPending;
    this._loadTimeoutMs = loadTimeoutMs;
    this._batches = [];      // waiting sentences: { items: [{ ready }], priority, gapMs, expires, started }
    this._current = null;    // the sentence being spoken
    this._running = false;   // an item is loading, playing, or in its gap
    this._stopFn = null;
    this._timer = null;
    this._gen = 0;           // bumped by a flush: late callbacks of the old generation do nothing
    this._active = false;
  }

  /** Something is playing or waiting. */
  get busy() { return this._running || this._batches.length > 0; }
  /** Sentences waiting behind the one being spoken. */
  get pending() { return this._batches.length; }

  say(line, options) {
    try {
      const { priority = 1, gapMs = 120, maxWaitMs = 6000 } = options || {};
      const items = normaliseLine(line);
      if (!items.length || typeof this._load !== 'function' || typeof this._play !== 'function') return false;
      const pr = Number.isFinite(Number(priority)) ? Number(priority) : 1;
      if (this.busy) {
        const top = Math.max(this._current ? this._current.priority : -Infinity, ...this._batches.map((b) => b.priority));
        if (pr > top) this._flush();
        else if (this._batches.length >= this._maxPending) return false;
      }
      const batch = {
        priority: pr,
        gapMs: Math.max(0, Number.isFinite(Number(gapMs)) ? Number(gapMs) : 120),
        expires: this._now() + Math.max(0, Number.isFinite(Number(maxWaitMs)) ? Number(maxWaitMs) : 6000),
        started: false,
        // every clip of the sentence starts loading now, so the second line is ready when the first ends
        items: items.map((item) => ({ ready: this._prepare(item) })),
      };
      this._batches.push(batch);
      if (!this._running) this._next();
      return true;
    } catch (_) {
      return false;
    }
  }

  /** Silence: stop the line being spoken and forget everything waiting. */
  stop() {
    try { this._flush(); } catch (_) { /* never throws */ }
    this._setActive(false);
  }

  // ───────────── internals ─────────────

  _prepare(item) {
    const safe = (it) => {
      let p;
      try { p = Promise.resolve(this._load(it)); } catch (_) { p = Promise.resolve(null); }
      return p.then((c) => c || null, () => null);
    };
    let p = safe(item);
    if (item.kind === 'name' && item.fallback) {
      p = p.then((c) => c || safe({ kind: 'line', id: item.fallback }));
    }
    // a clip that is not there in time is skipped rather than holding the sentence up
    return new Promise((resolve) => {
      let done = false;
      const finish = (c) => { if (!done) { done = true; resolve(c); } };
      const t = this._setTimer(() => finish(null), this._loadTimeoutMs * (item.kind === 'name' ? 2 : 1));
      p.then((c) => { this._clearTimer(t); finish(c); });
    });
  }

  _flush() {
    this._gen++;
    if (this._timer != null) { this._clearTimer(this._timer); this._timer = null; }
    const stop = this._stopFn;
    this._stopFn = null;
    this._batches = [];
    this._current = null;
    this._running = false;
    if (stop) { try { stop(); } catch (_) { /* ignore */ } }
  }

  _setActive(on) {
    if (this._active === on) return;
    this._active = on;
    try { this._onActive(on); } catch (_) { /* ignore */ }
  }

  _next() {
    if (this._running) return;
    let batch = this._current;
    while (!batch || !batch.items.length) {
      batch = this._batches.shift();
      if (!batch) { this._current = null; this._setActive(false); return; }
      if (!batch.started && this._now() > batch.expires) { batch = null; continue; }   // waited too long
    }
    this._current = batch;
    batch.started = true;
    const item = batch.items.shift();
    const gen = this._gen;
    this._running = true;
    const advance = (gapMs) => {
      if (gen !== this._gen) return;
      this._stopFn = null;
      const go = () => { if (gen !== this._gen) return; this._timer = null; this._running = false; this._next(); };
      if (gapMs > 0) this._timer = this._setTimer(go, gapMs); else go();
    };
    item.ready.then((clip) => {
      if (gen !== this._gen) return;
      if (!clip) { advance(0); return; }
      this._setActive(true);
      let ended = false;
      const done = () => { if (!ended) { ended = true; advance(batch.gapMs); } };
      try {
        const stop = this._play(clip, done);
        if (!ended && gen === this._gen) this._stopFn = typeof stop === 'function' ? stop : null;
      } catch (_) {
        done();
      }
    });
  }
}

export default VoiceQueue;
