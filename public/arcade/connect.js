// v2:connect The launch-monitor connection wizard (docs/launch-monitors.md).
//
// A console game's controller-setup flow for a launch monitor, readable from the hitting
// mat: SELECT YOUR LAUNCH MONITOR -> GET CONNECTED -> HIT A BALL -> YOU'RE OFF TO THE RACES.
// Self-contained: give it an element.
//
//   import { ConnectWizard } from './arcade/connect.js';
//   const wizard = new ConnectWizard({ root, fetchJson, audio, events, onDone });
//   wizard.dispose();
//
//   root        an element the wizard fills (it draws inside it, absolutely positioned)
//   fetchJson   (url, opts) -> Promise<json | null>            default: fetch
//   audio       the ArcadeAudio or null: only audio.cue('ui-tick' | 'ui-confirm' | 'ui-back'),
//               one sound per action, never a loop
//   events      the page's EventSource on /events (optional): the wizard follows its
//               'connect' event; it also asks GET /api/connect/status every 1.5 s
//   onDone      ({ device, connected, tested }) once, when the player leaves the last screen
//   css         false: do not add arcade/connect.css (the shell links it itself)
//
//   ConnectWizard.overlay({ fetchJson, audio, events, onDone })   the same, full screen over
//               whatever page it is on (the simulator's ?connect=1)
//
// The server side is lib/connect.js: GET /api/launch-monitors (the catalogue and this PC's
// addresses), GET /api/connect/status (one call: is the port ours, who is connected, the
// last shot, the likely cause when nothing is connected), POST /api/connect/device {id}
// (the choice is remembered, so the wizard runs once) and POST /api/connect/probe {on}
// (while HIT A BALL is up every swing is shown here and played in no game).
//
// The flow is a pure state machine (reduce) so it runs under Node; the class draws it.
// Classes are prefixed cn-.

export const TIER_ORDER = ['tested', 'expected', 'community', 'unsupported'];
const BRAND_COLS = 7;
const SPECIALS = ['none', 'other'];   // I DON'T HAVE ONE / MINE ISN'T LISTED

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** A brand's best tier (the one its tile shows). */
export function brandTier(cat, brandId) {
  const tiers = cat.devices.filter((d) => d.brand === brandId).map((d) => TIER_ORDER.indexOf(d.tier)).filter((i) => i >= 0);
  return tiers.length ? TIER_ORDER[Math.min(...tiers)] : 'unsupported';
}

/** The brands as the grid shows them: best tier first, the catalogue's order inside a tier. */
export function brandList(cat) {
  return cat.brands
    .map((b, i) => ({ ...b, tier: brandTier(cat, b.id), i }))
    .sort((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier) || a.i - b.i);
}

export function devicesOf(cat, brandId) {
  return cat.devices
    .filter((d) => d.brand === brandId)
    .sort((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier));
}

/** The device a state is about: a catalogue entry, the generic entry ('other') or null ('none'). */
export function deviceOf(cat, id) {
  if (id === 'other') return { ...cat.generic, id: 'other', tier: null, route: 'open-connect', address: 'either', models: [], connector: null, alternatives: [], needs: [] };
  return cat.devices.find((d) => d.id === id) || null;
}

/** The address a device's connector is given, and the others this PC has. */
export function addressFor(cat, dev) {
  const lan = cat.lanAddress || (cat.addresses && cat.addresses[0] && cat.addresses[0].address) || null;
  const wantsLan = dev && dev.address === 'lan';
  return {
    address: wantsLan && lan ? lan : '127.0.0.1',
    lan, wantsLan: !!wantsLan, missing: !!wantsLan && !lan,
    others: (cat.addresses || []).map((a) => a.address).filter((a) => a !== lan),
  };
}

/** "Foresight GCQuad", but "PiTrac", not "PiTrac PiTrac". */
export const fullName = (brand, name) => (!brand || String(name).toLowerCase().startsWith(String(brand).toLowerCase()) ? String(name) : `${brand} ${name}`);

export const fill = (text, { address, port }) => String(text).replace(/\{address\}/g, address).replace(/\{port\}/g, String(port));

/** The newest shot a status carries for the wizard: the held test ball, else the last shot. */
export function shotIn(status) {
  if (!status) return null;
  const a = status.probe && status.probe.shot, b = status.lastShot;
  if (a && b) return a.seq >= b.seq ? a : b;
  return a || b || null;
}

export function initialState() {
  return { screen: 'loading', brandId: null, deviceId: null, step: 0, cursor: 0, linked: false, sinceSeq: 0, shot: null, effects: [] };
}

/** The buttons of a screen, in order; the last one is where the cursor starts. */
export function buttonsOf(state, cat) {
  switch (state.screen) {
    case 'steps': {
      const dev = deviceOf(cat, state.deviceId);
      const last = !dev || state.step >= dev.steps.length - 1;
      return ['back', state.linked || last ? 'to-hit' : 'next'];
    }
    case 'unsupported': return ['back', 'try'];
    case 'hit': return state.shot ? ['again', 'looks-right'] : ['back', 'skip-ball'];
    case 'done': return ['play'];
    default: return [];
  }
}

function itemCount(state, cat) {
  if (state.screen === 'brands') return cat.brands.length + SPECIALS.length;
  if (state.screen === 'models') return devicesOf(cat, state.brandId).length;
  return buttonsOf(state, cat).length;
}

function moveCursor(state, cat, dir) {
  const n = itemCount(state, cat);
  if (!n) return state.cursor;
  const c = clamp(state.cursor, 0, n - 1);
  const step = dir === 'left' || dir === 'up' ? -1 : 1;
  if (state.screen !== 'brands') return clamp(c + step, 0, n - 1);
  const brands = cat.brands.length;
  if (dir === 'left' || dir === 'right') return clamp(c + step, 0, n - 1);
  const lastRow = Math.floor((brands - 1) / BRAND_COLS) * BRAND_COLS;
  if (c >= brands) return dir === 'up' ? Math.min(lastRow + (c === brands ? 1 : BRAND_COLS - 2), brands - 1) : c;   // from the two wide tiles: back up into the grid
  const next = c + step * BRAND_COLS;
  if (next < 0) return c;
  if (next < brands) return next;
  if (c < lastRow) return brands - 1;                                     // a short last row: its last tile
  return brands + ((c % BRAND_COLS) < BRAND_COLS / 2 ? 0 : 1);            // off the bottom: the wide tile under it
}

const goto = (state, screen, patch = {}) => ({ ...state, screen, cursor: 0, ...patch });

function openDevice(state, cat, id, effects) {
  const dev = deviceOf(cat, id);
  effects.push({ type: 'save-device', id });
  if (id !== 'other' && dev && dev.tier === 'unsupported') {
    return goto(state, 'unsupported', { deviceId: id, cursor: 1 });
  }
  return goto(state, 'steps', { deviceId: id, step: 0, cursor: 1, linked: false, shot: null });
}

/**
 * The flow. (state, action, catalogue) -> the next state; state.effects lists what the
 * caller must do: { type: 'cue', name } (at most one per action), { type: 'save-device', id },
 * { type: 'probe', on }, { type: 'done' }.
 *
 * Actions: { type: 'loaded' } the catalogue is in; { type: 'move', dir }; { type: 'hover', index };
 * { type: 'select', index? }; { type: 'press', id } a button by name; { type: 'back' };
 * { type: 'status', status } what GET /api/connect/status answered.
 */
export function reduce(state, action, cat) {
  const effects = [];
  const cue = (name) => { if (!effects.some((e) => e.type === 'cue')) effects.push({ type: 'cue', name }); };
  const out = (next) => ({ ...next, effects });
  const s = state;

  if (action.type === 'loaded') {
    return out(goto(s, 'brands', { cursor: 0 }));
  }
  if (!cat || s.screen === 'loading') return out(s);

  if (action.type === 'status') {
    const st = action.status || {};
    if (s.screen === 'steps' && st.connected && !s.linked) return out({ ...s, linked: true, cursor: 1 });
    if (s.screen === 'steps' && !st.connected && s.linked) return out({ ...s, linked: false });
    if (s.screen === 'hit') {
      const shot = shotIn(st);
      if (shot && shot.seq > s.sinceSeq && (!s.shot || shot.seq > s.shot.seq)) {
        cue('ui-confirm');
        return out({ ...s, shot, cursor: 1 });
      }
    }
    return out(s);
  }

  if (action.type === 'move') {
    const cursor = moveCursor(s, cat, action.dir);
    if (cursor !== s.cursor) cue('ui-tick');
    return out({ ...s, cursor });
  }
  if (action.type === 'hover') {
    const n = itemCount(s, cat);
    return out(n && Number.isInteger(action.index) ? { ...s, cursor: clamp(action.index, 0, n - 1) } : s);
  }

  if (action.type === 'back') {
    const multi = s.brandId && devicesOf(cat, s.brandId).length > 1;
    const brandCursor = () => Math.max(0, brandList(cat).findIndex((b) => b.id === s.brandId));
    switch (s.screen) {
      case 'brands': return out(s);
      case 'models': cue('ui-back'); return out(goto(s, 'brands', { cursor: brandCursor() }));
      case 'unsupported':
      case 'steps': {
        cue('ui-back');
        if (s.screen === 'steps' && s.step > 0) return out({ ...s, step: s.step - 1 });
        if (multi) return out(goto(s, 'models', { cursor: Math.max(0, devicesOf(cat, s.brandId).findIndex((d) => d.id === s.deviceId)) }));
        return out(goto(s, 'brands', { cursor: s.deviceId === 'other' ? cat.brands.length + 1 : brandCursor() }));
      }
      case 'hit': {
        cue('ui-back');
        effects.push({ type: 'probe', on: false });
        const dev = deviceOf(cat, s.deviceId);
        return out(goto(s, 'steps', { step: dev ? dev.steps.length - 1 : 0, cursor: 1, shot: null }));
      }
      case 'done': {
        cue('ui-back');
        if (s.deviceId === 'none' || !s.deviceId) return out(goto(s, 'brands', { cursor: cat.brands.length }));
        const dev = deviceOf(cat, s.deviceId);
        if (dev && dev.tier === 'unsupported') return out(goto(s, 'unsupported', { cursor: 1 }));
        effects.push({ type: 'probe', on: true });
        return out(goto(s, 'hit', { cursor: 1 }));
      }
      default: return out(s);
    }
  }

  if (action.type === 'press' && action.id === 'back') return reduce(s, { type: 'back' }, cat);
  if (action.type === 'select' || action.type === 'press') {
    const index = Number.isInteger(action.index) ? action.index : s.cursor;
    if (s.screen === 'brands') {
      const brands = brandList(cat);
      if (index >= brands.length) {
        const special = SPECIALS[index - brands.length];
        cue('ui-confirm');
        if (special === 'none') {
          effects.push({ type: 'save-device', id: 'none' });
          return out(goto(s, 'done', { brandId: null, deviceId: 'none', shot: null }));
        }
        return out(openDevice({ ...s, brandId: null }, cat, 'other', effects));
      }
      const brand = brands[clamp(index, 0, brands.length - 1)];
      const list = devicesOf(cat, brand.id);
      cue('ui-confirm');
      if (list.length === 1) return out(openDevice({ ...s, brandId: brand.id }, cat, list[0].id, effects));
      return out(goto(s, 'models', { brandId: brand.id, cursor: 0 }));
    }
    if (s.screen === 'models') {
      const list = devicesOf(cat, s.brandId);
      const dev = list[clamp(index, 0, list.length - 1)];
      if (!dev) return out(s);
      cue('ui-confirm');
      return out(openDevice(s, cat, dev.id, effects));
    }
    const buttons = buttonsOf(s, cat);
    const id = action.type === 'press' ? action.id : buttons[clamp(index, 0, buttons.length - 1)];
    if (!buttons.includes(id)) return out(s);
    switch (id) {
      case 'back': return reduce(s, { type: 'back' }, cat);
      case 'next': cue('ui-tick'); return out({ ...s, step: s.step + 1, cursor: 1 });
      case 'to-hit':
        cue('ui-confirm');
        effects.push({ type: 'probe', on: true });
        return out(goto(s, 'hit', { cursor: 1, shot: null, sinceSeq: action.seq || 0 }));
      case 'again': cue('ui-tick'); return out({ ...s, shot: null, sinceSeq: s.shot ? s.shot.seq : s.sinceSeq, cursor: 1 });
      case 'try':
        cue('ui-confirm');
        return out(goto(s, 'done', { shot: null }));
      case 'skip-ball':
      case 'looks-right':
        cue('ui-confirm');
        effects.push({ type: 'probe', on: false });
        return out(goto(s, 'done'));
      case 'play':
        cue('ui-confirm');
        effects.push({ type: 'done' });
        return out(s);
      default: return out(s);
    }
  }
  return out(s);
}

/** The status light: { tone: 'ok' | 'wait' | 'warn', title, help } for a status (and the device chosen). */
export function lightOf(status, { screen = 'steps' } = {}) {
  if (!status) return { tone: 'wait', title: 'CHECKING', help: '' };
  const cause = status.cause || null;
  if (status.connected) {
    const from = status.source === 'foresight' ? 'FORESIGHT CONNECTOR FOUND' : 'CONNECTOR CONNECTED';
    if (cause && cause.id === 'no-shots' && screen === 'hit') return { tone: 'ok', title: cause.title, help: cause.help };
    if (status.ready) return { tone: 'ok', title: 'READY', help: screen === 'hit' ? 'Hit a ball.' : 'Your launch monitor is connected and ready.' };
    return { tone: 'ok', title: from, help: screen === 'hit' ? 'Hit a ball.' : 'Waiting for the launch monitor to say it is ready.' };
  }
  if (status.state === 'blocked') return { tone: 'warn', title: cause ? cause.title : 'BLOCKED', help: cause ? cause.help : '' };
  return { tone: 'wait', title: cause ? cause.title : 'WAITING FOR YOUR CONNECTOR', help: cause ? cause.help : '' };
}

/** "WE SEE YOU: 142 MPH" and the three numbers under it. */
export function shotText(shot) {
  if (!shot) return null;
  const n = (v, d = 0) => (v === null || v === undefined ? '--' : (d ? v.toFixed(d) : String(Math.round(v))));
  const side = shot.hla === null || shot.hla === undefined || Math.abs(shot.hla) < 0.05 ? '' : (shot.hla > 0 ? ' R' : ' L');
  return {
    headline: `WE SEE YOU: ${n(shot.speedMph)} MPH`,
    stats: [
      { label: 'BALL SPEED', value: n(shot.speedMph, 1), unit: 'MPH' },
      { label: 'LAUNCH', value: n(shot.vla, 1), unit: 'DEG UP' },
      { label: 'DIRECTION', value: shot.hla === null || shot.hla === undefined ? '--' : Math.abs(shot.hla).toFixed(1), unit: `DEG${side}` },
      { label: 'SPIN', value: n(shot.totalSpin), unit: 'RPM' },
    ],
    issues: (shot.check && shot.check.issues) || [],
  };
}

// ------------------------------------------------------------------ drawing

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TIER_LABEL = { tested: 'TESTED', expected: 'EXPECTED TO WORK', community: 'COMMUNITY', unsupported: 'NOT SUPPORTED YET' };
const BUTTON_TEXT = {
  back: '‹ BACK', next: 'NEXT STEP ›', 'to-hit': 'HIT A BALL ›', try: 'TRY IT WITH TEST SWINGS ›',
  again: 'HIT ANOTHER', 'looks-right': 'LOOKS RIGHT ›', 'skip-ball': 'SKIP THE TEST BALL ›', play: 'PLAY ›',
};
const GO = new Set(['next', 'to-hit', 'try', 'looks-right', 'play']);
const tierChip = (tier) => (tier ? `<i class="cn-tier cn-tier-${esc(tier)}">${TIER_LABEL[tier] || ''}</i>` : '');

function addCss(doc) {
  if (doc.querySelector('link[data-cn-css], link[data-sc-connect]')) return;
  const link = doc.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('./connect.css', import.meta.url).href;
  link.setAttribute('data-cn-css', '');
  doc.head.appendChild(link);
}

export class ConnectWizard {
  constructor({ root, fetchJson = null, audio = null, events = null, onDone = null, css = true, pollMs = 1500, doneMs = 3500 } = {}) {
    if (!root) throw new Error('ConnectWizard needs a root element');
    this.root = root;
    this.doc = root.ownerDocument;
    this.fetchJson = fetchJson || ((url, opts) => fetch(url, opts).then((r) => r.json()).catch(() => null));
    this.audio = audio;
    this.events = events;
    this.onDone = onDone;
    this.doneMs = doneMs;
    this.cat = null;
    this.status = null;
    this.state = initialState();
    this.finished = false;
    this.disposed = false;
    this.panel = null;
    if (css) addCss(this.doc);

    this.el = this.doc.createElement('div');
    this.el.className = 'cn-root';
    this.el.setAttribute('data-cn-screen', 'loading');
    root.appendChild(this.el);

    this._onKey = (e) => this._key(e);
    this._onClick = (e) => this._click(e);
    this._onOver = (e) => this._over(e);
    this._onEvent = (e) => { try { this._onStatus(JSON.parse(e.data)); } catch (_) { /* not ours */ } };
    this.doc.addEventListener('keydown', this._onKey, true);
    this.el.addEventListener('click', this._onClick);
    this.el.addEventListener('mouseover', this._onOver);
    if (events && events.addEventListener) events.addEventListener('connect', this._onEvent);
    this.poll = setInterval(() => this._refresh(), pollMs);
    this.renew = setInterval(() => { if (this.state.screen === 'hit') this._probe(true); }, 30000);

    this._render();
    this._load();
  }

  /** The same wizard, full screen over the page it is on. */
  static overlay(opts = {}) {
    const doc = opts.document || document;
    const host = doc.createElement('div');
    host.className = 'cn-overlay';
    doc.body.appendChild(host);
    const wizard = new ConnectWizard({
      ...opts, root: host,
      onDone: (result) => { wizard.dispose(); host.remove(); if (opts.onDone) opts.onDone(result); },
    });
    return wizard;
  }

  async _load() {
    const [cat, status] = await Promise.all([this.fetchJson('/api/launch-monitors'), this.fetchJson('/api/connect/status')]);
    if (this.disposed) return;
    if (!cat || !Array.isArray(cat.devices)) {
      this.el.innerHTML = '<div class="cn-wait"><h1>THE LAUNCH-MONITOR LIST DID NOT LOAD</h1><p>The game can still be played: press SKIP.</p></div>';
      return;
    }
    this.cat = cat;
    if (status) this.status = status;
    this.state = reduce(this.state, { type: 'loaded' }, cat);
    // a launch monitor chosen before: its brand is where the cursor starts
    const chosen = cat.chosen && cat.devices.find((d) => d.id === cat.chosen);
    if (chosen) this.state.cursor = Math.max(0, brandList(cat).findIndex((b) => b.id === chosen.brand));
    else if (cat.chosen === 'other') this.state.cursor = cat.brands.length + 1;
    else if (cat.chosen === 'none') this.state.cursor = cat.brands.length;
    this._render();
  }

  async _refresh() {
    if (this.disposed || !this.cat) return;
    const st = await this.fetchJson('/api/connect/status');
    if (st) this._onStatus(st);
  }

  _onStatus(st) {
    if (this.disposed || !st || st.ok === false) return;
    if (this.status && st.now && this.status.now && st.now < this.status.now) return;   // an older answer that arrived late
    this.status = st;
    if (!this.cat) return;
    const before = this.state;
    const next = reduce(before, { type: 'status', status: st }, this.cat);
    const moved = next.screen !== before.screen || next.linked !== before.linked || next.shot !== before.shot;
    this._apply(next, { full: moved });
  }

  _post(url, body) {
    return this.fetchJson(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }
  _probe(on) { this._post('/api/connect/probe', { on }).then((st) => { if (st && st.ok) this._onStatus(st); }); }
  _cue(name) { try { this.audio?.cue?.(name); } catch (_) { /* silent */ } }

  _dispatch(action) {
    if (this.disposed || !this.cat || this.finished) return;
    // entering HIT A BALL: only a ball hit from now on counts
    if (action.type !== 'status') {
      const shot = shotIn(this.status);
      action = { ...action, seq: shot ? shot.seq : 0 };
    }
    this._apply(reduce(this.state, action, this.cat), { full: true });
  }

  _apply(next, { full }) {
    const effects = next.effects || [];
    this.state = { ...next, effects: [] };
    for (const e of effects) {
      if (e.type === 'cue') this._cue(e.name);
      else if (e.type === 'save-device') this._post('/api/connect/device', { id: e.id }).then((st) => { if (st && st.ok) this._onStatus(st); });
      else if (e.type === 'probe') this._probe(e.on);
      else if (e.type === 'done') this._finish();
    }
    if (this.finished) return;
    if (full) this._render(); else this._renderLive();
  }

  _finish() {
    if (this.finished) return;
    this.finished = true;
    clearTimeout(this.doneTimer);
    this._probe(false);
    const st = this.status || {};
    const result = { device: this.state.deviceId, connected: !!st.connected, tested: !!this.state.shot };
    if (this.onDone) { try { this.onDone(result); } catch (e) { console.warn('[connect] onDone failed', e); } }
  }

  dispose() {
    if (this.disposed) return;
    const wasHit = this.state.screen === 'hit';
    this.disposed = true;
    clearInterval(this.poll);
    clearInterval(this.renew);
    clearTimeout(this.doneTimer);
    this.doc.removeEventListener('keydown', this._onKey, true);
    if (this.events && this.events.removeEventListener) this.events.removeEventListener('connect', this._onEvent);
    this._dropPanel();
    if (wasHit && !this.finished) this._post('/api/connect/probe', { on: false });
    this.el.remove();
  }

  // ---------------------------------------------------------------- input
  _key(e) {
    if (this.disposed || this.finished || e.ctrlKey || e.metaKey || e.altKey) return;
    if (!this.el.isConnected) return;
    const t = e.target;
    if (t && t.closest && t.closest('input, textarea, select') ) return;
    const k = e.key;
    const dir = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }[k];
    let action = null;
    if (dir) action = { type: 'move', dir };
    else if (k === 'Enter' || k === ' ') action = { type: 'select' };
    else if (k === 'Escape' || k === 'Backspace') action = { type: 'back' };
    if (!action) return;
    if ((k === 'Enter' || k === ' ') && t && t.closest) {
      if (t.closest('a, [data-cn-free]')) return;                                  // a link or the bridge panel has the key
      if (t.closest('button') && !this.el.contains(t)) return;                     // so has a button of the page around us (the shell's SKIP)
    }
    e.preventDefault();
    e.stopPropagation();
    this._dispatch(action);
  }
  _click(e) {
    const el = e.target.closest ? e.target.closest('[data-cn-item], [data-cn-btn]') : null;
    if (!el || !this.el.contains(el)) return;
    if (el.dataset.cnBtn) this._dispatch({ type: 'press', id: el.dataset.cnBtn });
    else this._dispatch({ type: 'select', index: +el.dataset.cnItem });
  }
  _over(e) {
    const el = e.target.closest ? e.target.closest('[data-cn-item]') : null;
    if (!el || !this.cat || +el.dataset.cnItem === this.state.cursor) return;
    this.state = { ...reduce(this.state, { type: 'hover', index: +el.dataset.cnItem }, this.cat), effects: [] };
    this._markCursor();
  }

  // ---------------------------------------------------------------- drawing
  _markCursor() {
    for (const el of this.el.querySelectorAll('[data-cn-item]')) el.classList.toggle('cn-on', +el.dataset.cnItem === this.state.cursor);
    const on = this.el.querySelector('[data-cn-item].cn-on');
    if (on && on.scrollIntoView && this.state.screen === 'brands') { try { on.scrollIntoView({ block: 'nearest' }); } catch (_) { /* old browser */ } }
  }

  _dropPanel() {
    const p = this.panel;
    this.panel = null;
    try { if (p && p.dispose) p.dispose(); } catch (_) { /* gone */ }
  }

  _render() {
    if (this.disposed) return;
    const s = this.state, cat = this.cat;
    this._dropPanel();
    clearTimeout(this.doneTimer);
    this.el.setAttribute('data-cn-screen', s.screen);
    if (!cat) { this.el.innerHTML = '<div class="cn-wait"><h1>LAUNCH MONITORS</h1><p>One moment.</p></div>'; return; }
    const html = {
      brands: () => this._brands(), models: () => this._models(), steps: () => this._steps(),
      unsupported: () => this._unsupported(), hit: () => this._hit(), done: () => this._done(),
    }[s.screen];
    this.el.innerHTML = html ? html() : '';
    this._markCursor();
    this._renderLive();
    if (s.screen === 'steps') this._mountPanel();
    if (s.screen === 'done' && this.doneMs > 0) this.doneTimer = setTimeout(() => this._dispatch({ type: 'press', id: 'play' }), this.doneMs);
  }

  /** What follows the server without a redraw: the status light and what hangs off it. */
  _renderLive() {
    const box = this.el.querySelector('[data-cn-light]');
    if (!box) return;
    const light = lightOf(this.status, { screen: this.state.screen });
    const sig = JSON.stringify(light);
    if (box.dataset.sig === sig) return;
    box.dataset.sig = sig;
    box.className = `cn-light cn-light-${light.tone}`;
    box.innerHTML = `<span class="cn-lamp"></span><div><b>${esc(light.title)}</b><p>${esc(light.help)}</p></div>`;
  }

  _head(step, title, sub = '') {
    const pips = [1, 2, 3].map((n) => `<i class="${n === step ? 'cn-now' : n < step ? 'cn-was' : ''}"></i>`).join('');
    return `<header class="cn-head"><div class="cn-pips">${step ? pips : ''}<span>${step ? `STEP ${step} OF 3` : ''}</span></div><h1>${esc(title)}</h1>${sub ? `<p>${sub}</p>` : ''}</header>`;
  }

  _buttons() {
    const list = buttonsOf(this.state, this.cat);
    return `<nav class="cn-btns">${list.map((id, i) => `<button type="button" class="cn-btn${GO.has(id) ? ' cn-go' : ''}" data-cn-btn="${id}" data-cn-item="${i}">${BUTTON_TEXT[id]}</button>`).join('')}</nav>`;
  }

  _brands() {
    const cat = this.cat;
    const tiles = brandList(cat).map((b, i) => `<button type="button" class="cn-tile cn-brand" data-cn-item="${i}"><b>${esc(b.name)}</b>${tierChip(b.tier)}</button>`).join('');
    const n = cat.brands.length;
    return `${this._head(1, 'SELECT YOUR LAUNCH MONITOR')}
      <div class="cn-grid" style="--cn-cols:${BRAND_COLS}">${tiles}</div>
      <div class="cn-wide">
        <button type="button" class="cn-tile cn-special" data-cn-item="${n}"><b>I DON'T HAVE ONE</b><span>JUST LET ME TRY IT</span></button>
        <button type="button" class="cn-tile cn-special" data-cn-item="${n + 1}"><b>MINE ISN'T LISTED</b><span>I'LL POINT MY CONNECTOR AT THIS PC MYSELF</span></button>
      </div>
      <footer class="cn-keys"><span><kbd>←↑↓→</kbd> CHOOSE</span><span><kbd>ENTER</kbd> SELECT</span></footer>`;
  }

  _models() {
    const cat = this.cat, s = this.state;
    const brand = cat.brands.find((b) => b.id === s.brandId);
    const how = (d) => (d.route === 'foresight-bridge' ? 'THROUGH GSPCONNECT, BUILT IN' : d.connector ? `WITH ${esc(d.connector.name.split(' (')[0]).toUpperCase()}` : 'NO WAY IN YET');
    const tiles = devicesOf(cat, s.brandId).map((d, i) => `<button type="button" class="cn-tile cn-model" data-cn-item="${i}">
        ${tierChip(d.tier)}<b>${esc(d.name)}</b><span>${how(d)}</span></button>`).join('');
    return `${this._head(1, `${brand ? brand.name : ''}: WHICH ONE?`)}
      <div class="cn-models">${tiles}</div>
      <nav class="cn-btns"><button type="button" class="cn-btn" data-cn-btn="back">‹ BACK</button></nav>
      <footer class="cn-keys"><span><kbd>←→</kbd> CHOOSE</span><span><kbd>ENTER</kbd> SELECT</span><span><kbd>ESC</kbd> BACK</span></footer>`;
  }

  _values(dev) {
    const cat = this.cat;
    const a = addressFor(cat, dev);
    const settings = (dev.settings || []).map((x) => ({ label: x.label, value: fill(x.value, { address: a.address, port: cat.port }) }));
    if (!settings.length) return '';
    const note = a.missing ? '<p class="cn-warn">THIS PC HAS NO NETWORK ADDRESS: CONNECT IT TO YOUR NETWORK FIRST.</p>'
      : dev.address === 'either' ? `<p>CONNECTOR ON THIS PC: 127.0.0.1${a.lan ? ` · ON ANOTHER DEVICE: ${esc(a.lan)}` : ''}</p>`
        : a.wantsLan ? `<p>THIS PC'S ADDRESS ON YOUR NETWORK${a.others.length ? ` (ALSO ${a.others.map(esc).join(', ')})` : ''}</p>`
          : '<p>THE CONNECTOR RUNS ON THIS PC</p>';
    return `<section class="cn-values"><h3>TYPE THIS IN YOUR CONNECTOR</h3>
      <dl>${settings.map((x) => `<div><dt>${esc(x.label)}</dt><dd>${esc(x.value)}</dd></div>`).join('')}</dl>${note}</section>`;
  }

  _steps() {
    const cat = this.cat, s = this.state;
    const dev = deviceOf(cat, s.deviceId);
    if (!dev) return '';
    const brand = cat.brands.find((b) => b.id === dev.brand);
    const name = dev.id === 'other' ? 'A CONNECTOR THAT IS NOT LISTED' : fullName(brand && brand.name, dev.name);
    const steps = dev.steps.map((t, i) => `<li class="${i === s.step ? 'cn-now' : i < s.step ? 'cn-was' : ''}"><i>${i + 1}</i><span>${esc(t)}</span></li>`).join('');
    const connector = dev.connector ? `<p class="cn-connector"><span>CONNECTOR</span><b>${esc(dev.connector.name)}</b>${/^https:/.test(dev.connector.url) ? `<a href="${esc(dev.connector.url)}" target="_blank" rel="noopener noreferrer">${esc(dev.connector.url.replace(/^https:\/\//, ''))}</a>` : ''}</p>` : '';
    const needs = (dev.needs || []).length ? `<div class="cn-needs"><span>YOU NEED</span><ul>${dev.needs.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></div>` : '';
    const notes = (dev.notes || []).slice(0, 2).map((n) => `<li>${esc(n)}</li>`).join('');
    return `${this._head(2, 'GET CONNECTED', `<b>${esc(name)}</b>${tierChip(dev.tier)}`)}
      <div class="cn-cols">
        <section class="cn-main">
          <ol class="cn-steps">${steps}</ol>
          ${this._values(dev)}
        </section>
        <aside class="cn-side">
          <div data-cn-light class="cn-light"></div>
          ${dev.route === 'foresight-bridge' ? `${needs}<div class="cn-fb" data-cn-fb data-cn-free></div>` : `${connector}${needs}${notes ? `<ul class="cn-notes">${notes}</ul>` : ''}`}
        </aside>
      </div>
      ${this._buttons()}
      <footer class="cn-keys"><span><kbd>ENTER</kbd> ${s.linked ? 'HIT A BALL' : 'NEXT'}</span><span><kbd>ESC</kbd> BACK</span></footer>`;
  }

  _unsupported() {
    const cat = this.cat, s = this.state;
    const dev = deviceOf(cat, s.deviceId);
    if (!dev) return '';
    const brand = cat.brands.find((b) => b.id === dev.brand);
    return `${this._head(2, 'NOT SUPPORTED YET', `<b>${esc(fullName(brand && brand.name, dev.name))}</b>${tierChip(dev.tier)}`)}
      <div class="cn-why"><p>${esc(dev.why || '')}</p>
        <p class="cn-soft">YOU CAN STILL PLAY: THE GAME HAS TEST SWINGS, AND A LAUNCH MONITOR CAN BE CONNECTED LATER IN SETTINGS.</p></div>
      ${this._buttons()}
      <footer class="cn-keys"><span><kbd>ENTER</kbd> SELECT</span><span><kbd>ESC</kbd> BACK</span></footer>`;
  }

  _hit() {
    const s = this.state;
    const t = shotText(s.shot);
    const body = t ? `<div class="cn-seen"><h2>${esc(t.headline)}</h2>
        <div class="cn-stats">${t.stats.map((x) => `<div><span>${x.label}</span><b>${esc(x.value)}</b><i>${esc(x.unit)}</i></div>`).join('')}</div>
        ${t.issues.length ? `<div class="cn-wrong"><b>THAT LOOKS WRONG</b><ul>${t.issues.map((i) => `<li>${esc(i.text)}</li>`).join('')}</ul></div>`
    : '<p class="cn-soft">DO THOSE NUMBERS MATCH YOUR LAUNCH MONITOR? THIS BALL DID NOT COUNT IN ANY GAME.</p>'}
      </div>`
      : `<div class="cn-target"><div class="cn-ball"></div><h2>HIT A BALL</h2><p>ANY CLUB, A FULL SWING. IT WILL NOT COUNT IN ANY GAME.</p></div>
        <div data-cn-light class="cn-light cn-light-wide"></div>`;
    return `${this._head(3, t ? 'CONNECTED' : 'ONE BALL TO CHECK')}
      <div class="cn-hit">${body}</div>
      ${this._buttons()}
      <footer class="cn-keys"><span><kbd>ENTER</kbd> SELECT</span><span><kbd>ESC</kbd> BACK</span></footer>`;
  }

  _done() {
    const s = this.state, st = this.status || {};
    const dev = deviceOf(this.cat, s.deviceId);
    const line = s.deviceId === 'none' || (dev && dev.tier === 'unsupported') ? 'PLAYING WITH TEST SWINGS. CONNECT A LAUNCH MONITOR ANY TIME IN SETTINGS.'
      : s.shot ? 'YOUR LAUNCH MONITOR IS CONNECTED AND TESTED.'
        : st.connected ? 'YOUR LAUNCH MONITOR IS CONNECTED.'
          : 'NOT CONNECTED YET. THE GAME KEEPS LISTENING: FINISH IT ANY TIME IN SETTINGS.';
    return `<div class="cn-done"><h1>YOU'RE OFF TO THE RACES</h1><p>${line}</p></div>
      ${this._buttons()}`;
  }

  /** The Foresight bridge's own panel, when the build has it (public/arcade/foresight-panel.js). */
  async _mountPanel() {
    const box = this.el.querySelector('[data-cn-fb]');
    if (!box) return;
    let mod = null;
    try { mod = await import('./foresight-panel.js'); } catch (_) { mod = null; }
    if (this.disposed || !mod || !mod.mountForesightPanel || !box.isConnected) return;
    try { this.panel = mod.mountForesightPanel(box, { fetchJson: this.fetchJson, events: this.events }); } catch (_) { this.panel = null; }
  }
}

export default ConnectWizard;
