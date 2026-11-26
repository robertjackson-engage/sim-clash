'use strict';
// v2:connect The launch-monitor catalogue (docs/launch-monitors.md is generated from it).
//
// The data is lib/launch-monitors.json, self-contained so the README and the website can
// read the same file. This is its tiny loader: the catalogue, a check of its shape (the
// tests and the doc generator run it), and what the connection wizard needs with it (this
// PC's addresses, the values a device's steps ask the player to type).

const os = require('os');
const CATALOGUE = require('./launch-monitors.json');

const TIER_IDS = CATALOGUE.tiers.map((t) => t.id);
const ROUTES = ['open-connect', 'foresight-bridge', 'none'];
const STEP_MAX = 64;   // a step is read from the hitting mat: one short line
// A device may carry a `guide`, which lets the wizard do more than list its steps:
//   download  { step, label, url }   a button on that step that opens the connector's download page
//   warning   a sentence shown beside the steps (an unofficial connector, an antivirus alarm)
//   checks    [{ step, want, program }]  steps the game can tick by itself: want is 'running' or
//             'closed' (is a program of that name running on this PC; a trailing * matches any
//             ending) or 'connected' (a connector has connected to the game)
// A check only ever ticks a step: it never holds the player back.
const GUIDE_WANTS = ['running', 'closed', 'connected'];

// The choices that are not a device: no launch monitor (try the game with test swings),
// and a connector that is not in the list (the generic Open Connect instructions).
const SPECIAL = Object.freeze({
  none: { id: 'none', name: 'No launch monitor', tier: null, route: 'none' },
  other: { id: 'other', name: 'Not listed (any Open Connect connector)', tier: null, route: 'open-connect' },
});

function device(id) {
  return CATALOGUE.devices.find((d) => d.id === id) || null;
}

/** A device id, 'none' or 'other' -> what the status and the wizard show for it; else null. */
function choice(id) {
  const key = String(id || '');
  if (SPECIAL[key]) return { ...SPECIAL[key] };
  const d = device(key);
  if (!d) return null;
  const brand = CATALOGUE.brands.find((b) => b.id === d.brand);
  return { id: d.id, name: d.name, brand: brand ? brand.name : d.brand, tier: d.tier, route: d.route, address: d.address || null };
}

/** Every problem with the catalogue's shape ([] when it is sound). */
function problems(cat = CATALOGUE) {
  const out = [];
  const say = (id, text) => out.push(`${id}: ${text}`);
  const tiers = new Set((cat.tiers || []).map((t) => t.id));
  const brands = new Set((cat.brands || []).map((b) => b.id));
  const seen = new Set();
  const isHttp = (u) => /^https:\/\/[^\s]+$/.test(String(u || ''));
  const isSource = (u) => isHttp(u) || /^docs\/[\w./-]+\.md$/.test(String(u || ''));
  const checkSteps = (id, steps) => {
    if (!Array.isArray(steps) || !steps.length) { say(id, 'no steps'); return; }
    for (const s of steps) {
      if (typeof s !== 'string' || !s.trim()) say(id, 'an empty step');
      else if (s.length > STEP_MAX) say(id, `a step longer than ${STEP_MAX} characters: "${s}"`);
    }
  };
  const checkSources = (id, sources) => {
    if (!Array.isArray(sources) || !sources.length) { say(id, 'no source'); return; }
    for (const s of sources) {
      if (!s || !isSource(s.url)) say(id, `a source without a usable URL: ${JSON.stringify(s && s.url)}`);
      if (!s || typeof s.note !== 'string' || !s.note.trim()) say(id, 'a source without a note');
      if (!s || typeof s.confirmed !== 'boolean') say(id, 'a source that does not say whether it is confirmed');
    }
  };
  const checkSettings = (id, settings) => {
    for (const s of settings || []) {
      if (!s || !s.label || typeof s.value !== 'string') say(id, 'a setting without a label or a value');
      else if (s.value.replace(/\{address\}|\{port\}/g, '').includes('{')) say(id, `a setting with an unknown placeholder: ${s.value}`);
    }
  };
  // A device's optional guide: what lets the wizard help with its steps (see GUIDE_WANTS).
  const checkGuide = (id, g, steps) => {
    const n = Array.isArray(steps) ? steps.length : 0;
    const stepOk = (i) => Number.isInteger(i) && i >= 0 && i < n;
    if (!g || typeof g !== 'object' || Array.isArray(g)) { say(id, 'a guide that is not an object'); return; }
    if (g.download !== undefined && (!g.download || !stepOk(g.download.step) || !String(g.download.label || '').trim() || !isHttp(g.download.url))) say(id, 'a guide download without a step, a label or a link');
    if (g.warning !== undefined && (typeof g.warning !== 'string' || !g.warning.trim())) say(id, 'an empty guide warning');
    for (const c of g.checks || []) {
      if (!c || !stepOk(c.step)) { say(id, 'a guide check for a step that does not exist'); continue; }
      if (!GUIDE_WANTS.includes(c.want)) say(id, `a guide check with an unknown want: ${c.want}`);
      else if (c.want !== 'connected' && !/^[\w .-]{2,40}\*?$/.test(String(c.program || ''))) say(id, 'a guide check without a program name');
    }
  };
  for (const d of cat.devices || []) {
    const id = d && d.id ? d.id : '(no id)';
    if (!d || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(String(d.id || ''))) say(id, 'a bad id');
    if (seen.has(d.id)) say(id, 'the id is used twice');
    seen.add(d.id);
    if (SPECIAL[d.id]) say(id, 'the id is reserved');
    if (!brands.has(d.brand)) say(id, `unknown brand ${d.brand}`);
    if (!d.name || !Array.isArray(d.models) || !d.models.length) say(id, 'no name or no models');
    if (!tiers.has(d.tier)) say(id, `unknown tier ${d.tier}`);
    if (!ROUTES.includes(d.route)) say(id, `unknown route ${d.route}`);
    checkSteps(id, d.steps);
    checkSources(id, d.sources);
    checkSettings(id, d.settings);
    if (d.tier === 'unsupported') {
      if (d.route !== 'none') say(id, 'not supported, but it has a route');
      if (!d.why) say(id, 'not supported, and it does not say why');
    } else {
      if (d.route === 'none') say(id, 'supported, but it has no route');
      if (!d.connector || !d.connector.name || !isHttp(d.connector.url)) say(id, 'no connector with a name and a link');
      if (d.connector && !d.connector.license) say(id, 'the connector has no licence note');
      if (d.route === 'open-connect' && !['local', 'lan'].includes(d.address)) say(id, 'it does not say which address the connector is given (local or lan)');
      if (d.tier !== 'tested' && !(d.notes || []).some((n) => /untested|not tested/i.test(n))) say(id, 'it is not tested, and its notes do not say so');
    }
    for (const a of d.alternatives || []) if (!a.name || !isHttp(a.url) || !a.license) say(id, 'an alternative without a name, a link or a licence note');
    if (d.guide !== undefined) checkGuide(id, d.guide, d.steps);
  }
  for (const b of cat.brands || []) {
    if (!(cat.devices || []).some((d) => d.brand === b.id)) say(b.id, 'a brand with no device');
  }
  if (!cat.generic) say('generic', 'missing');
  else { checkSteps('generic', cat.generic.steps); checkSources('generic', cat.generic.sources); checkSettings('generic', cat.generic.settings); }
  return out;
}

const isPrivateV4 = (a) => /^10\./.test(a) || /^192\.168\./.test(a) || /^172\.(1[6-9]|2\d|3[01])\./.test(a);

/**
 * This PC's IPv4 addresses on its networks, the likeliest home-network one first:
 * [{ address, name, private }]. Never a loopback or a link-local (169.254) address.
 */
function lanAddresses(interfaces = os.networkInterfaces()) {
  const out = [];
  for (const [name, list] of Object.entries(interfaces || {})) {
    for (const i of list || []) {
      const v4 = i && (i.family === 'IPv4' || i.family === 4);
      if (!v4 || i.internal || !i.address || /^169\.254\./.test(i.address) || /^127\./.test(i.address)) continue;
      out.push({ address: i.address, name, private: isPrivateV4(i.address) });
    }
  }
  // home networks first (192.168, then 10, then 172.16-31), virtual adapters last
  const virtual = (n) => /virtual|vethernet|vmware|hyper-v|wsl|docker|loopback|bluetooth|tailscale|zerotier|vpn/i.test(n);
  const rank = (a) => (virtual(a.name) ? 10 : 0) + (/^192\.168\./.test(a.address) ? 0 : /^10\./.test(a.address) ? 1 : a.private ? 2 : 3);
  return out.sort((a, b) => rank(a) - rank(b) || a.address.localeCompare(b.address));
}

/** The address a device's connector is given: 127.0.0.1 (it runs on this PC) or this PC's network address. */
function addressFor(dev, addresses = lanAddresses()) {
  const lan = addresses.length ? addresses[0].address : null;
  if (dev && dev.address === 'lan') return lan || '127.0.0.1';
  return '127.0.0.1';
}

/** A setting's value with {address} and {port} filled in. */
function fill(text, { address, port }) {
  return String(text).replace(/\{address\}/g, address).replace(/\{port\}/g, String(port));
}

/** What GET /api/launch-monitors answers: the catalogue with this server's port and this PC's addresses. */
function forClient({ port = CATALOGUE.port, addresses = lanAddresses() } = {}) {
  return {
    ok: true,
    version: CATALOGUE.version, updated: CATALOGUE.updated,
    port, defaultPort: CATALOGUE.port,
    tiers: CATALOGUE.tiers, brands: CATALOGUE.brands, devices: CATALOGUE.devices, generic: CATALOGUE.generic,
    addresses, lanAddress: addresses.length ? addresses[0].address : null, localAddress: '127.0.0.1',
  };
}

module.exports = { CATALOGUE, TIER_IDS, ROUTES, STEP_MAX, GUIDE_WANTS, SPECIAL, device, choice, problems, lanAddresses, addressFor, fill, forClient };
