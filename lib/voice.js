'use strict';
// Announcer voice, server side (docs/arcade-voice.md, docs/dev/arcade-v2-contract.md section 3).
//
// The announcer's lines are pre-rendered files under public/arcade/voice/<pack>/ (made by
// tools/arcade-voice/generate.mjs). The one thing that cannot be rendered ahead of time is
// a player's NAME, so this module renders it on demand with the same voice and delivery as
// "PLAYER ONE", once, and keeps it on disk:
//
//   POST /api/voice/name { name, pack? }   -> { ok, slug, name, url, cached }   or { ok: false, error }
//   GET  /api/voice/names[?pack=]          -> { ok, pack, names: [{ slug, name, url }] }
//   GET  /voice/names/<slug>.mp3           the clip (default pack)
//   GET  /voice/names/<pack>/<slug>.mp3    the clip in another pack's voice
//
// Without a key, without a network, or over the limits it answers { ok: false } and the
// client says the fallback line ("PLAYER ONE") instead. The key is read at run time
// (environment variable ELEVENLABS_API_KEY, then the env file named by BIRDIE_VOICE_ENV, then
// a git-ignored .env in the repo root: see .env.example), is only ever sent in the
// xi-api-key header to api.elevenlabs.io, and is never logged or written anywhere. Nothing
// but the name and the voice settings leaves this PC.

const fs = require('fs');
const path = require('path');

const API_ORIGIN = 'https://api.elevenlabs.io';
const KEY_NAME = 'ELEVENLABS_API_KEY';
// Last resort for the key: a .env file in the repo root (git-ignored; .env.example shows the line).
const DEFAULT_ENV_FILES = [path.join(__dirname, '..', '.env')];

const DEFAULT_PACK = 'announcer';
// Used when a pack's manifest cannot be read (the pack has not been rendered yet).
const DEFAULT_VOICE = {
  id: '0m1WGWVzxS7KbWobXtnw',
  model: 'eleven_v3',
  settings: { stability: 0.35, similarity_boost: 0.8, use_speaker_boost: true, speed: 1.0 },
};
const DEFAULT_NAME_DELIVERY = '[shouting] {NAME}!';

const NAME_MAX = 24;            // characters, after trimming
const MAX_STORED = 400;         // name clips kept per pack
const MAX_RENDERS_PER_HOUR = 40;
const RENDER_TIMEOUT_MS = 30000;
const NAME_MAX_SECONDS = 3.5;   // a name that runs longer than this was a ramble: render again
const PACK_RX = /^[a-z0-9][a-z0-9-]{0,31}$/;
const SLUG_RX = /^[a-z0-9][a-z0-9-]{0,47}$/;
const FILE_RX = /^\/voice\/names\/(?:([a-z0-9][a-z0-9-]{0,31})\/)?([a-z0-9][a-z0-9-]{0,47})\.mp3$/;

/** The value of the ELEVENLABS_API_KEY line of an env file's text, or null. Nothing else is read. */
function parseKeyLine(text) {
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?ELEVENLABS_API_KEY\s*=\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    let v = m[1];
    const quoted = /^(["'])(.*)\1$/.exec(v);
    if (quoted) v = quoted[2];
    else v = v.replace(/\s+#.*$/, '');
    v = v.trim();
    if (v) return v;
  }
  return null;
}

/** The key: environment, then the file named by BIRDIE_VOICE_ENV, then the default env files. */
function loadKey({ env = process.env, files = DEFAULT_ENV_FILES, readFile = (f) => fs.readFileSync(f, 'utf8') } = {}) {
  const direct = env && typeof env[KEY_NAME] === 'string' ? env[KEY_NAME].trim() : '';
  if (direct) return direct;
  const candidates = [];
  if (env && env.BIRDIE_VOICE_ENV) candidates.push(String(env.BIRDIE_VOICE_ENV));
  for (const f of files || []) candidates.push(f);
  for (const file of candidates) {
    try {
      const key = parseKeyLine(readFile(file));
      if (key) return key;
    } catch (_) { /* no such file: try the next */ }
  }
  return null;
}

/**
 * A player name that is safe to speak and to store: letters (any script), digits, spaces,
 * apostrophes, hyphens and full stops. No brackets (they would be read as delivery tags),
 * no control characters, at most NAME_MAX characters.
 */
function validateName(raw) {
  if (typeof raw !== 'string') return { ok: false, error: 'name-required' };
  const name = raw.normalize('NFC').replace(/\s+/g, ' ').trim();
  if (!name) return { ok: false, error: 'name-required' };
  if (Array.from(name).length > NAME_MAX) return { ok: false, error: 'name-too-long' };
  if (!/^[\p{L}\p{N} .'’-]+$/u.test(name)) return { ok: false, error: 'name-invalid' };
  if (!/[\p{L}\p{N}]/u.test(name)) return { ok: false, error: 'name-invalid' };
  return { ok: true, name };
}

/**
 * File-safe id of a name: 'José  O’Neil' -> 'jose-o-neil'. Names with no Latin letters or
 * digits get a stable code-point id ('u-674e'). public/arcade/voice/queue.js has the same
 * function for the browser (the tests hold the two together).
 */
function nameSlug(name) {
  const s = String(name == null ? '' : name).normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/g, '');
  if (s) return s;
  const cps = Array.from(String(name == null ? '' : name).trim()).slice(0, 8)
    .map((c) => c.codePointAt(0).toString(16)).join('-');
  return cps ? `u-${cps}`.slice(0, 48).replace(/-+$/g, '') : '';
}

/** What the voice is asked to say for a name: '[shouting] ALEX!'. */
function nameText(name, delivery = DEFAULT_NAME_DELIVERY) {
  const spoken = String(name).toUpperCase().replace(/[.]+$/g, '');
  const tpl = typeof delivery === 'string' && delivery.includes('{NAME}') ? delivery : DEFAULT_NAME_DELIVERY;
  return tpl.replace('{NAME}', spoken);
}

function json(res, obj, code = 200) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function readJsonBody(req, limit = 4096) {
  return new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { finish(null); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (done) return;
      try { finish(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (_) { finish(null); }
    });
    req.on('error', () => finish(null));
  });
}

function createVoice({
  dataDir,
  publicDir = path.join(__dirname, '..', 'public'),
  env = process.env,
  keyFiles = DEFAULT_ENV_FILES,
  fetchImpl = globalThis.fetch,
  log = (msg) => console.log(msg),
  now = () => Date.now(),
} = {}) {
  if (!dataDir) throw new Error('createVoice: dataDir is required');
  const namesRoot = path.join(dataDir, 'voice', 'names');
  const inflight = new Map();   // '<pack>/<slug>' -> Promise of the result
  const renderTimes = [];       // start times of recent renders (rate cap)

  const packDir = (pack) => (pack === DEFAULT_PACK ? namesRoot : path.join(namesRoot, pack));
  const urlFor = (pack, slug) => (pack === DEFAULT_PACK ? `/voice/names/${slug}.mp3` : `/voice/names/${pack}/${slug}.mp3`);
  const fileFor = (pack, slug) => path.join(packDir(pack), `${slug}.mp3`);
  const indexFile = (pack) => path.join(packDir(pack), 'index.json');

  function readIndex(pack) {
    try {
      const idx = JSON.parse(fs.readFileSync(indexFile(pack), 'utf8'));
      return idx && typeof idx === 'object' && !Array.isArray(idx) ? idx : {};
    } catch (_) { return {}; }
  }

  function writeAtomic(file, data) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, file);
  }

  /** The pack's voice (id, model, settings) and name delivery, from its manifest. */
  function packVoice(pack) {
    if (!PACK_RX.test(pack)) return null;
    try {
      const m = JSON.parse(fs.readFileSync(path.join(publicDir, 'arcade', 'voice', pack, 'manifest.json'), 'utf8'));
      const v = m && m.voice;
      // a pack rendered somewhere this key cannot reach (the Higgsfield account's preset voices): a name in
      // any other voice would not match the pack, so there is no name voice and the fallback line is used
      if (v && v.provider && v.provider !== 'elevenlabs') return { unavailable: true };
      if (v && typeof v.id === 'string' && /^[A-Za-z0-9]{8,40}$/.test(v.id)) {
        return {
          id: v.id,
          model: typeof v.model === 'string' ? v.model : DEFAULT_VOICE.model,
          settings: v.settings && typeof v.settings === 'object' ? v.settings : DEFAULT_VOICE.settings,
          delivery: m.names && typeof m.names.delivery === 'string' ? m.names.delivery : DEFAULT_NAME_DELIVERY,
        };
      }
    } catch (_) { /* not rendered yet */ }
    return pack === DEFAULT_PACK ? { ...DEFAULT_VOICE, delivery: DEFAULT_NAME_DELIVERY } : null;
  }

  function listNames(pack = DEFAULT_PACK) {
    if (!PACK_RX.test(pack)) return [];
    let files = [];
    try { files = fs.readdirSync(packDir(pack)); } catch (_) { return []; }
    const idx = readIndex(pack);
    return files
      .filter((f) => f.endsWith('.mp3') && SLUG_RX.test(f.slice(0, -4)))
      .map((f) => f.slice(0, -4))
      .sort()
      .map((slug) => ({ slug, name: typeof idx[slug] === 'string' ? idx[slug] : slug, url: urlFor(pack, slug) }));
  }

  async function callApi(voice, text, key) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), RENDER_TIMEOUT_MS);
    try {
      const res = await fetchImpl(`${API_ORIGIN}/v1/text-to-speech/${voice.id}?output_format=mp3_44100_128`, {
        method: 'POST',
        headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
        body: JSON.stringify({ text, model_id: voice.model, voice_settings: voice.settings }),
        signal: ctl.signal,
      });
      if (!res.ok) return { error: `api-${res.status}` };
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 1000) return { error: 'api-empty' };
      return { buf };
    } catch (_) {
      return { error: 'network' };
    } finally {
      clearTimeout(timer);
    }
  }

  async function renderOnce(pack, slug, name) {
    const key = loadKey({ env, files: keyFiles });
    if (!key) return { ok: false, error: 'no-key' };
    if (typeof fetchImpl !== 'function') return { ok: false, error: 'network' };
    const voice = packVoice(pack);
    if (!voice) return { ok: false, error: 'unknown-pack' };
    if (voice.unavailable) return { ok: false, error: 'no-name-voice' };
    if (listNames(pack).length >= MAX_STORED) return { ok: false, error: 'limit' };
    const t = now();
    while (renderTimes.length && t - renderTimes[0] > 3600e3) renderTimes.shift();
    if (renderTimes.length >= MAX_RENDERS_PER_HOUR) return { ok: false, error: 'limit' };
    renderTimes.push(t);

    const text = nameText(name, voice.delivery);
    let best = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await callApi(voice, text, key);
      if (r.error) { if (!best) best = r; break; }
      // 128 kbit/s constant bit rate: 16000 bytes a second
      if (!best || !best.buf || r.buf.length < best.buf.length) best = r;
      if (r.buf.length / 16000 <= NAME_MAX_SECONDS) break;
    }
    if (!best || !best.buf) return { ok: false, error: (best && best.error) || 'network' };
    try {
      writeAtomic(fileFor(pack, slug), best.buf);
      const idx = readIndex(pack);
      idx[slug] = name;
      writeAtomic(indexFile(pack), JSON.stringify(idx, null, 2));
    } catch (_) {
      return { ok: false, error: 'write-failed' };
    }
    log(`[voice] rendered the name clip ${pack}/${slug}.mp3 (${Math.round(best.buf.length / 1024)} kB)`);
    return { ok: true, slug, name, pack, url: urlFor(pack, slug), cached: false };
  }

  /** Render (or find) the clip for a name. Never throws; concurrent calls for one name share one render. */
  function renderName(rawName, pack = DEFAULT_PACK) {
    const v = validateName(rawName);
    if (!v.ok) return Promise.resolve({ ok: false, error: v.error });
    if (typeof pack !== 'string' || !PACK_RX.test(pack)) return Promise.resolve({ ok: false, error: 'unknown-pack' });
    const slug = nameSlug(v.name);
    if (!slug || !SLUG_RX.test(slug)) return Promise.resolve({ ok: false, error: 'name-invalid' });
    try {
      if (fs.statSync(fileFor(pack, slug)).size > 0) {
        return Promise.resolve({ ok: true, slug, name: v.name, pack, url: urlFor(pack, slug), cached: true });
      }
    } catch (_) { /* not rendered yet */ }
    const id = `${pack}/${slug}`;
    if (inflight.has(id)) return inflight.get(id);
    const p = renderOnce(pack, slug, v.name)
      .catch(() => ({ ok: false, error: 'render-failed' }))
      .finally(() => inflight.delete(id));
    inflight.set(id, p);
    return p;
  }

  function serveClip(req, res, pathname) {
    const m = FILE_RX.exec(pathname);
    if (!m) { res.writeHead(404); res.end('not found'); return; }
    const full = fileFor(m[1] || DEFAULT_PACK, m[2]);
    let stat;
    try { stat = fs.statSync(full); } catch (_) { stat = null; }
    if (!stat || !stat.isFile()) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': stat.size, 'Cache-Control': 'no-cache' });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(full).on('error', () => res.destroy()).pipe(res);
  }

  /** Is this request one of ours? */
  function matches(pathname) {
    return pathname === '/api/voice/name' || pathname === '/api/voice/names' || pathname.startsWith('/voice/names/');
  }

  /** Answer a voice request. Returns true when it was handled (always, for a path that matches). */
  async function handle(req, res, url) {
    const u = url || new URL(req.url, 'http://x');
    const p = u.pathname;
    try {
      if (p.startsWith('/voice/names/')) {
        if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return true; }
        serveClip(req, res, p);
        return true;
      }
      if (p === '/api/voice/names') {
        const pack = u.searchParams.get('pack') || DEFAULT_PACK;
        json(res, { ok: true, pack: PACK_RX.test(pack) ? pack : DEFAULT_PACK, names: listNames(pack), key: !!loadKey({ env, files: keyFiles }) });
        return true;
      }
      if (p === '/api/voice/name') {
        if (req.method !== 'POST') { json(res, { ok: false, error: 'post-only' }, 405); return true; }
        const body = await readJsonBody(req);
        if (!body || typeof body !== 'object') { json(res, { ok: false, error: 'bad-request' }, 400); return true; }
        const result = await renderName(body.name, body.pack == null ? DEFAULT_PACK : body.pack);
        const bad = !result.ok && /^name-|^unknown-pack$/.test(result.error || '');
        json(res, result, bad ? 400 : 200);
        return true;
      }
    } catch (_) {
      try { json(res, { ok: false, error: 'voice-failed' }, 500); } catch (__) { /* already answered */ }
      return true;
    }
    res.writeHead(404); res.end('not found');
    return true;
  }

  return { handle, matches, renderName, listNames, packVoice, namesRoot };
}

// One instance per data directory, for the single hook in server.js.
const instances = new Map();
function handle(req, res, { dataDir, url, publicDir } = {}) {
  let v = instances.get(dataDir);
  if (!v) { v = createVoice({ dataDir, publicDir }); instances.set(dataDir, v); }
  return v.handle(req, res, url);
}
function matches(pathname) {
  return pathname === '/api/voice/name' || pathname === '/api/voice/names' || pathname.startsWith('/voice/names/');
}

module.exports = {
  createVoice, handle, matches, loadKey, parseKeyLine, validateName, nameSlug, nameText,
  DEFAULT_PACK, DEFAULT_VOICE, DEFAULT_NAME_DELIVERY, DEFAULT_ENV_FILES, NAME_MAX, API_ORIGIN,
};
