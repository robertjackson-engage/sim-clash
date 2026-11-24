// v2:shell The product's NAME as the page knows it.
//
// The name lives in ONE file: public/product.json (the release stream's; lib/product.js reads
// it for the window, the installer and the server). The page gets it from the server's
// bootstrap script (GET /product.js, a classic script in index.html that runs before the
// modules): window.__PRODUCT__ = { mode, version, name, wordmark, initials, tagline, colors,
// builtOn, repo }. This module only gives that a shape the screens can rely on, with the
// defaults below for a page opened without the server (the demo pages, the unit tests).
//
// The title's wordmark is LIVE TEXT built from `wordmark`: a rename is one line in
// product.json and nothing has to be redrawn.

const DEFAULTS = {
  name: 'Sim Clash',
  wordmark: ['SIM', 'CLASH'],
  initials: 'SC',
  tagline: 'Arcade 1v1 golf for real launch monitors',
  colors: { p1: '#ff5a36', p2: '#2e9bff', gold: '#ffd21f', ink: '#07090d' },
  builtOn: [
    { name: 'Open-Birdie', by: 'Rooj Rin', url: 'https://github.com/rroojrooj/Open-Birdie', licence: 'MIT' },
    { name: 'Open-Birdie (fork)', by: 'jordan-shilts', url: 'https://github.com/jordan-shilts/Open-Birdie', licence: 'MIT' },
  ],
  repo: { owner: '', name: '' },
  licence: 'MIT',
  // where the full credits live in the source tree
  creditsFiles: ['README.md', 'ASSETS.md', 'public/arcade/sfx/CREDITS.md'],
  // per-monitor connection help lives in the project's guide, never in the game
  connectGuide: 'the connection guide in the project README',
};

/** The two halves of the wordmark, one per player colour: ['SIM', 'CLASH']; one word: ['GOLFBASH', '']. */
export function wordmarkParts(name, wordmark = null) {
  const given = Array.isArray(wordmark) ? wordmark.map((w) => String(w || '').trim()).filter(Boolean) : [];
  const words = given.length ? given : String(name || '').trim().toUpperCase().split(/\s+/).filter(Boolean);
  if (words.length < 2) return [words[0] || '', ''];
  return [words[0], words.slice(1).join(' ')];
}

/** The product as the screens use it, from the server's bootstrap object (or nothing). */
export function resolveProduct(raw = null) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const str = (v, d) => (typeof v === 'string' && v.trim() ? v.trim() : d);
  const name = str(r.name, DEFAULTS.name);
  const repo = r.repo && typeof r.repo === 'object' ? r.repo : {};
  const owner = str(repo.owner, ''), repoName = str(repo.name, '');
  // a placeholder owner (the release has not named the repository yet) gives no link
  const url = str(r.url, owner && repoName && owner !== 'OWNER' ? `https://github.com/${owner}/${repoName}` : '');
  return Object.freeze({
    ...DEFAULTS,
    name,
    words: wordmarkParts(name, r.wordmark || (r.name ? null : DEFAULTS.wordmark)),
    initials: str(r.initials, name.split(/\s+/).map((w) => w[0]).join('').toUpperCase().slice(0, 3)),
    tagline: str(r.tagline, DEFAULTS.tagline),
    colors: { ...DEFAULTS.colors, ...(r.colors && typeof r.colors === 'object' ? r.colors : {}) },
    builtOn: Array.isArray(r.builtOn) && r.builtOn.length ? r.builtOn : DEFAULTS.builtOn,
    url,
    version: str(r.version, ''),
    mode: r.mode === 'open-birdie' ? 'open-birdie' : r.mode === 'simclash' ? 'simclash' : null,
  });
}

export const PRODUCT = resolveProduct(typeof globalThis !== 'undefined' ? globalThis.__PRODUCT__ : null);
export default PRODUCT;
