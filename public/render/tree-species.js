// Which trees grow in which world, and what stands at their feet. Pure (no three, no DOM)
// so every rule here is unit-tested (test/tree-models.test.mjs): each arcade theme has a
// species set, a spot always gets the same tree, the tree the player sees stands where the
// ball's tree does and is about as thick (lib/tree-obstacles.js), and the understory is the
// same for every player and never on mown ground.
//
// The models themselves are files (public/arcade/trees/<species>.glb, built by
// tools/arcade-art/trees/build.mjs); public/render/tree-models.js draws them.

// ---------------------------------------------------------------- the worlds
// trees: [{ species, weight, tall (-1 .. 1: taller spots lean to it), leaf, accent, height,
// crown (x the spot's measured height and crown radius; the ball still hits the measured
// tree, so these stay within TREE_SIZE_RANGE) }].
// under: what is scattered at the trees' feet, [{ plant, weight, leaf, accent, size: [lo, hi] (m),
// reach: [lo, hi] (x the tree's crown radius from its trunk) }].
// fx: { snow: [hex, amount], uplight: [hex, gain], petals: [hex, hex], accentGlow, moss: [hex, amount],
// bark: [r, g, b] multiplier, backlight, through (light through the leaves, 0.32 when absent),
// leaf: { sat, gain } (leafPaint's grade of the palette, LEAF_GRADE when absent),
// grade: { sky, sun, lift } (how far the shade and the lit colour lean to the stage's sky and sun; lift
// raises the shade end of the ramp toward the lit one, for a pale crown) }.
// underDensity: x the plants a tree (1 when absent).
export const TREE_SIZE_RANGE = Object.freeze([0.8, 1.25]);
const W = (o) => Object.freeze(o);
export const TREE_WORLDS = Object.freeze({
  tropical: W({
    trees: [
      { species: 'coconut', weight: 5, tall: 0.6, leaf: '#6ecb3c', accent: '#8a6a2a', height: 1.1, crown: 1.15 },
      { species: 'fanpalm', weight: 2, tall: -0.8, leaf: '#58b848', accent: '#8a6a2a', height: 0.85, crown: 0.9 },
      { species: 'seaalmond', weight: 3, tall: -0.2, leaf: '#4fb53a', accent: '#ff5fa2', height: 0.95, crown: 1.25 },
    ],
    under: [
      { plant: 'fern', weight: 3, leaf: '#58b840', size: [0.8, 1.5], reach: [0.3, 1.2] },
      { plant: 'bigleaf', weight: 2, leaf: '#4fb53a', size: [0.9, 1.6], reach: [0.3, 1.1] },
      { plant: 'flower', weight: 3, leaf: '#4aa838', accent: '#ff4f9a', size: [0.7, 1.2], reach: [0.5, 1.5] },
      { plant: 'flower', weight: 2, leaf: '#4aa838', accent: '#ffd23f', size: [0.6, 1.0], reach: [0.6, 1.6] },
      { plant: 'grass', weight: 4, leaf: '#7cc840', accent: '#e8d88a', size: [0.5, 0.9], reach: [0.4, 1.8] },
      { plant: 'rock', weight: 1, leaf: '#b9b3a4', size: [0.5, 1.3], reach: [0.5, 1.6] },
    ],
    fx: {},
  }),
  jungle: W({
    trees: [
      { species: 'junglebroad', weight: 5, tall: -0.3, leaf: '#3aa834', accent: '#ffb030', height: 1.0, crown: 1.2 },
      { species: 'kapok', weight: 2.2, tall: 1.4, leaf: '#58bd3c', accent: '#ffb030', height: 1.25, crown: 1.25 },
      { species: 'fig', weight: 2.5, tall: 0.1, leaf: '#2f9a3a', accent: '#ffb030', height: 1.0, crown: 1.25 },
      { species: 'coconut', weight: 1.2, tall: 0.2, leaf: '#62c040', accent: '#8a6a2a', height: 1.1, crown: 1.1 },
    ],
    under: [
      { plant: 'fern', weight: 5, leaf: '#3fae35', size: [0.9, 1.8], reach: [0.25, 1.3] },
      { plant: 'bigleaf', weight: 4, leaf: '#35a23a', size: [1.0, 2.0], reach: [0.25, 1.2] },
      { plant: 'banana', weight: 2.6, leaf: '#62c040', size: [3.2, 5.0], reach: [0.5, 1.2] },
      { plant: 'treefern', weight: 2.2, leaf: '#3fae35', size: [3.0, 4.8], reach: [0.5, 1.2] },
      { plant: 'flower', weight: 2, leaf: '#35a23a', accent: '#ff3f6e', size: [0.7, 1.3], reach: [0.5, 1.5] },
      { plant: 'flower', weight: 1.2, leaf: '#35a23a', accent: '#ffa21f', size: [0.7, 1.2], reach: [0.5, 1.5] },
      { plant: 'grass', weight: 3, leaf: '#58b838', accent: '#c8d86a', size: [0.5, 1.0], reach: [0.4, 1.8] },
      { plant: 'rock', weight: 1, leaf: '#8f9080', size: [0.6, 1.5], reach: [0.5, 1.6] },
    ],
    fx: { moss: ['#5a9a34', 0.95], backlight: 0.7, through: 0.4 },
    underDensity: 1.4,   // a jungle floor is crowded
  }),
  canyon: W({
    trees: [
      { species: 'juniper', weight: 5, tall: -0.3, leaf: '#8ea252', accent: '#6a7fae', height: 0.85, crown: 1.1 },
      { species: 'acacia', weight: 2.5, tall: 0.4, leaf: '#9aa85a', accent: '#f2d26a', height: 0.9, crown: 1.25 },
      { species: 'snag', weight: 1.4, tall: 0.2, leaf: '#b9a88a', accent: '#b9a88a', height: 0.9, crown: 1.0 },
    ],
    under: [
      { plant: 'scrub', weight: 5, leaf: '#9aa860', accent: '#e8c84a', size: [0.7, 1.5], reach: [0.5, 2.2] },
      { plant: 'grass', weight: 4, leaf: '#c8b468', accent: '#e8d89a', size: [0.5, 0.9], reach: [0.5, 2.4] },
      { plant: 'rock', weight: 3, leaf: '#c07a52', size: [0.6, 1.8], reach: [0.5, 2.2] },
      { plant: 'flower', weight: 1, leaf: '#8ea252', accent: '#ff7a2a', size: [0.5, 0.9], reach: [0.6, 2] },
    ],
    fx: {},
  }),
  desert: W({
    trees: [
      { species: 'datepalm', weight: 5, tall: 0.6, leaf: '#7fae48', accent: '#e8862a', height: 1.1, crown: 1.1 },
      { species: 'acacia', weight: 2.5, tall: -0.5, leaf: '#8f9a4a', accent: '#f2d26a', height: 0.82, crown: 1.25 },
      { species: 'snag', weight: 0.8, tall: -0.2, leaf: '#c8b89a', accent: '#c8b89a', height: 0.85, crown: 1.0 },
    ],
    under: [
      { plant: 'scrub', weight: 4, leaf: '#a0a856', accent: '#f0d060', size: [0.6, 1.3], reach: [0.6, 2.4] },
      { plant: 'grass', weight: 4, leaf: '#d0bc70', accent: '#f0e0a0', size: [0.5, 1.0], reach: [0.5, 2.6] },
      { plant: 'rock', weight: 3, leaf: '#d8b078', size: [0.5, 1.6], reach: [0.6, 2.4] },
    ],
    fx: {},
  }),
  links: W({
    trees: [
      { species: 'windpine', weight: 1, tall: 0, leaf: '#4f8a44', accent: '#8a6a3a', height: 0.9, crown: 1.2 },
    ],
    under: [
      { plant: 'gorse', weight: 5, leaf: '#4f8a3a', accent: '#ffd21f', size: [0.9, 1.9], reach: [0.6, 2.6] },
      { plant: 'grass', weight: 6, leaf: '#b8b060', accent: '#e8dca0', size: [0.6, 1.1], reach: [0.5, 2.8] },
      { plant: 'rock', weight: 1.5, leaf: '#9a988e', size: [0.5, 1.4], reach: [0.6, 2.4] },
      { plant: 'flower', weight: 1, leaf: '#5a9040', accent: '#c88aff', size: [0.5, 0.9], reach: [0.6, 2.4] },
    ],
    fx: { windBent: true },
  }),
  alpine: W({
    trees: [
      { species: 'spruce', weight: 5, tall: 0.5, leaf: '#52a26c', accent: '#f4f9ff', height: 1.15, crown: 1.0 },   // accent: the snow painted on the boughs
      { species: 'fir', weight: 4, tall: -0.2, leaf: '#5cae88', accent: '#f4f9ff', height: 1.0, crown: 0.95 },
      { species: 'larch', weight: 1.4, tall: 0, leaf: '#8a6a3a', accent: '#e8a030', height: 1.05, crown: 1.0 },
    ],
    under: [
      { plant: 'sapling', species: 'spruce', weight: 3, leaf: '#52a26c', accent: '#f4f9ff', size: [1.4, 3.2], reach: [0.7, 2.2] },
      { plant: 'rock', weight: 3, leaf: '#8f96a4', size: [0.6, 1.8], reach: [0.5, 2.2] },
      { plant: 'scrub', weight: 2, leaf: '#4a8460', accent: '#f4f9ff', size: [0.6, 1.2], reach: [0.5, 2] },
      { plant: 'grass', weight: 2, leaf: '#c8c090', accent: '#f0e8c8', size: [0.4, 0.8], reach: [0.5, 2.2] },
    ],
    fx: { snow: ['#f4f9ff', 0.85], leaf: { sat: 0.86, gain: 1.05 } },
  }),
  sakura: W({
    trees: [
      { species: 'cherry', weight: 6, tall: 0, leaf: '#ff9cc8', accent: '#ff6aa6', height: 0.95, crown: 1.25 },
      { species: 'maple', weight: 2, tall: -0.6, leaf: '#e8502a', accent: '#ffc21f', height: 0.85, crown: 1.2 },
      { species: 'cloudpine', weight: 2, tall: 0.5, leaf: '#3f8a44', accent: '#8a6a3a', height: 1.0, crown: 1.15 },
    ],
    under: [
      { plant: 'flower', weight: 3, leaf: '#58a848', accent: '#ff86bc', size: [0.7, 1.3], reach: [0.5, 1.6] },
      { plant: 'flower', weight: 2, leaf: '#58a848', accent: '#ffffff', size: [0.6, 1.1], reach: [0.5, 1.6] },
      { plant: 'fern', weight: 2, leaf: '#58a848', size: [0.7, 1.2], reach: [0.3, 1.2] },
      { plant: 'grass', weight: 3, leaf: '#7cc050', accent: '#ffd0e4', size: [0.4, 0.8], reach: [0.4, 1.8] },
      { plant: 'rock', weight: 2, leaf: '#a4a098', size: [0.5, 1.4], reach: [0.5, 1.6] },
      { plant: 'bush', weight: 2, leaf: '#3f9a44', size: [0.9, 1.6], reach: [0.5, 1.4] },
    ],
    fx: { petals: ['#ffb7d8', '#ffffff'], leaf: { sat: 0.8, gain: 1.1 }, grade: { sky: 0.25, sun: 0.15, lift: 0.6 } },   // blossom is pale all through: its shade is lifted
  }),
  volcano: W({
    trees: [
      { species: 'snag', weight: 5, tall: 0.2, leaf: '#3a2a24', accent: '#ff6a1e', height: 1.0, crown: 1.0 },
      { species: 'acacia', weight: 2, tall: -0.3, leaf: '#8a3a1c', accent: '#ff8a2a', height: 0.85, crown: 1.15 },
    ],
    under: [
      { plant: 'rock', weight: 5, leaf: '#3a3434', size: [0.6, 2.0], reach: [0.5, 2.4] },
      { plant: 'scrub', weight: 2, leaf: '#6a3a22', accent: '#ff7a1e', size: [0.6, 1.2], reach: [0.5, 2.2] },
      { plant: 'grass', weight: 2, leaf: '#7a5a34', accent: '#ffb060', size: [0.4, 0.8], reach: [0.5, 2.4] },
    ],
    fx: { uplight: ['#ff5a1e', 0.5], accentGlow: 1.6, bark: [0.42, 0.36, 0.34] },
  }),
  neon: W({
    trees: [
      { species: 'street', weight: 1, tall: 0, leaf: '#2f9a62', accent: '#ffe9a8', height: 0.9, crown: 1.0 },
    ],
    under: [
      { plant: 'bush', weight: 4, leaf: '#2a8a5c', size: [0.8, 1.4], reach: [0.5, 1.5] },
      { plant: 'flower', weight: 2, leaf: '#2a8a5c', accent: '#ff3fb4', size: [0.6, 1.0], reach: [0.5, 1.6] },
      { plant: 'flower', weight: 2, leaf: '#2a8a5c', accent: '#3fe0ff', size: [0.6, 1.0], reach: [0.5, 1.6] },
      { plant: 'grass', weight: 2, leaf: '#2f9a70', accent: '#b0ffe0', size: [0.4, 0.8], reach: [0.5, 1.8] },
    ],
    fx: { uplight: ['#ffb060', 0.7], accentGlow: 1.4, lit: true },
  }),
  stadium: W({
    trees: [
      { species: 'street', weight: 1, tall: 0, leaf: '#4fb53a', accent: '#fff2c0', height: 0.9, crown: 1.0 },
    ],
    under: [
      { plant: 'bush', weight: 4, leaf: '#3fa23a', size: [0.8, 1.4], reach: [0.5, 1.5] },
      { plant: 'flower', weight: 3, leaf: '#3fa23a', accent: '#ffffff', size: [0.6, 1.0], reach: [0.5, 1.6] },
      { plant: 'flower', weight: 2, leaf: '#3fa23a', accent: '#ff3b30', size: [0.6, 1.0], reach: [0.5, 1.6] },
      { plant: 'grass', weight: 2, leaf: '#6cc040', accent: '#e8e8a0', size: [0.4, 0.8], reach: [0.5, 1.8] },
    ],
    fx: { uplight: ['#ffd9a0', 0.5], accentGlow: 1.1, lit: true },
  }),
});
export const TREE_WORLD_NAMES = Object.freeze(Object.keys(TREE_WORLDS));

// The world a theme's trees come from (a course with no theme is the plain arcade look: tropical).
export function treeWorld(theme) {
  return TREE_WORLDS[theme] || TREE_WORLDS.tropical;
}
// every species (and sapling species) a world needs loaded
export function worldSpecies(theme, { understory = true } = {}) {
  const w = treeWorld(theme);
  const set = new Set(w.trees.map((t) => t.species));
  if (understory) for (const u of w.under) if (UNDER_MODELS[u.plant]) set.add(u.species || UNDER_MODELS[u.plant]); else if (u.species) set.add(u.species);
  return [...set];
}
// understory plants that are a species model of their own (the rest are small `under-*` models)
export const UNDER_MODELS = Object.freeze({ banana: 'banana', treefern: 'treefern', sapling: null, fern: 'under-fern', bigleaf: 'under-bigleaf', flower: 'under-flower', grass: 'under-grass', rock: 'under-rock', scrub: 'under-scrub', gorse: 'under-gorse', bush: 'under-bush' });

// ---------------------------------------------------------------- one tree
// stable hashes of a position (the same tree for every player, every load)
export function hash2(x, y, salt = 0) {
  let h = Math.imul(Math.round(x * 20) | 0, 374761393) ^ Math.imul(Math.round(y * 20) | 0, 668265263) ^ Math.imul(salt | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
// smooth noise over the ground (patches of one species, as woods grow)
function patch(x, y, salt, cell = 46) {
  const fx = x / cell, fy = y / cell, xi = Math.floor(fx), yi = Math.floor(fy);
  const sx = fx - xi, sy = fy - yi, a = sx * sx * (3 - 2 * sx), b = sy * sy * (3 - 2 * sy);
  const v = (i, j) => hash2((xi + i) * 0.05, (yi + j) * 0.05, salt + 77);
  return v(0, 0) * (1 - a) * (1 - b) + v(1, 0) * a * (1 - b) + v(0, 1) * (1 - a) * b + v(1, 1) * a * b;
}

// The tree drawn at a spot { x, y, h?, r?, s? }: { species, variant (0 .. nVariants-1 via
// variantOf), entry (the world's row), u (0..1 for per-tree variation) }. hRel: where the
// spot's height sits among the course's trees (0 shortest .. 1 tallest).
export function treeAt(theme, spot, hRel = 0.5) {
  const w = treeWorld(theme);
  let total = 0;
  const ws = w.trees.map((t, i) => {
    const k = t.weight * Math.exp((t.tall || 0) * (hRel - 0.5) * 3) * (0.35 + 1.9 * patch(spot.x, spot.y, i * 31 + 5) ** 2);
    total += k;
    return k;
  });
  let pick = hash2(spot.x, spot.y, 11) * total, i = 0;
  for (; i < ws.length - 1; i++) { pick -= ws[i]; if (pick <= 0) break; }
  return { species: w.trees[i].species, entry: w.trees[i], index: i, u: hash2(spot.x, spot.y, 23), v: hash2(spot.x, spot.y, 37) };
}
export const variantOf = (spot, n) => Math.min(n - 1, Math.floor(hash2(spot.x, spot.y, 53) * n));

// A spot's height (m) as the ball's tree has it: measured (canopy data) or a point tree's
// size draw (trees.js: (s || 1) * 0.85 of a 14 m reference).
export const spotHeight = (spot) => (spot.h > 0 ? spot.h : 14 * (spot.s || 1) * 0.85);
export const spotCrown = (spot) => (spot.r > 0 ? spot.r : spotHeight(spot) * 0.3);

// The instance scale of a model on a spot: { w (across), ht (up), heightM, crownM }. The
// height follows the measured tree x the world's own stature for the species; the width
// goes half way from the model's own proportions to the measured crown, so a noisy crown
// radius never squashes a model. a, b in [0, 1): a few percent of variation.
export function treeScale(spot, entry, model, a = 0.5, b = 0.5) {
  const lo = TREE_SIZE_RANGE[0], hi = TREE_SIZE_RANGE[1];
  const heightM = spotHeight(spot) * Math.min(hi, Math.max(lo, entry.height || 1)) * (0.96 + 0.08 * a);
  const ht = heightM / model.top;
  const crownM = spotCrown(spot) * Math.min(hi, Math.max(lo, entry.crown || 1));
  const fromCrown = model.crownR > 0 ? crownM / model.crownR : ht;
  const w = Math.min(ht * 1.3, Math.max(ht * 0.78, ht + (fromCrown - ht) * 0.5)) * (0.95 + 0.1 * b);
  return { w, ht, heightM, crownM: model.crownR * w };
}

// The ball's trunk at that spot (lib/tree-obstacles.js): radius 0.12 + 0.01 h, a vertical
// cylinder from the ground to the crown's foot. The arcade's soft trees use 0.6 of it.
export const collisionTrunkR = (heightM) => 0.12 + 0.01 * heightM;

// ---------------------------------------------------------------- levels of detail
// Which bucket a tree is drawn from at distance d (m): 0 the full model, 1, 2 the far one.
export function lodFor(d, nearM, midM) { return d < nearM ? 0 : d < midM ? 1 : 2; }
// The share of its leaf cards a tree keeps at distance d (the vertex shader's treeKeep:
// keep the two in step). Full to 45% of nearM, then down to keep[1] at nearM and keep[2] at midM.
export function lodKeep(d, nearM, midM, keep = [1, 0.42, 0.15]) {
  const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const k = 1 + (keep[1] - 1) * ss(nearM * 0.45, nearM, d);
  return k + (keep[2] - k) * ss(nearM, midM, d);
}
// How much of a card of rank `rank` is drawn when the tree keeps `keep` (1 whole, 0 gone).
export const cardVisible = (rank, keep) => Math.min(1, Math.max(0, (keep * 1.08 - rank) / (0.08 * keep + 1e-4)));

// What a graphics level draws: quality.js level -> the tree field's settings. Low is the
// cheap trees: never the full model, no understory, no petals, shorter distances.
// heroes: how many trees round each tee and green stand as their species' hero model;
// barkRelief: the bark normal map's strength.
export function treeDetail(level) {
  if (level === 'low') return { maxLod: 1, understory: 0, underDrawM: 0, petals: 0, shadows: false, blobs: true, heroes: 0, barkRelief: 0 };
  if (level === 'ultra') return { maxLod: 0, understory: 1.3, underDrawM: 260, petals: 1, shadows: true, blobs: true, heroes: 4, barkRelief: 1 };
  return { maxLod: 0, understory: 1, underDrawM: 180, petals: 1, shadows: true, blobs: true, heroes: 3, barkRelief: 1 };
}

// ---------------------------------------------------------------- heroes
// The spots that stand as hero models: the `count` nearest each focus point (a tee, a pin)
// within HERO_RADIUS_M. Returns a Set of indices into `spots`. Pure, so the same hole always
// has the same heroes.
export const HERO_RADIUS_M = 120;
export function heroSpots(spots, focus, count = 3, radius = HERO_RADIUS_M) {
  const out = new Set();
  for (const f of focus || []) {
    const near = [];
    for (let i = 0; i < spots.length; i++) { const d = Math.hypot(spots[i].x - f.x, spots[i].y - f.y); if (d < radius) near.push([d, i]); }
    near.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    for (const [, i] of near.slice(0, count)) out.add(i);
  }
  return out;
}

// ---------------------------------------------------------------- the stage's light
// The two ends of the leaves' shade ramp (linear RGB multipliers of a tree's own colour),
// graded from the stage's sky as the environment stream measured it (public/arcade/env/
// manifest.json: sun.color, zenith, horizon): the shaded side leans to the sky's colour,
// the lit side to the sun's. No sky (null): the neutral pair. Pure.
const SHADE_LO = [0.2, 0.31, 0.37], SHADE_HI = [1.16, 1.08, 0.8];
const hexLin = (hex) => { const n = parseInt(String(hex).replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }); };
const luma3 = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
// A world's leaf (or accent) colour as the trees are painted with it: linear RGB, a little
// less saturated and a little darker than the palette's own hex (the palette was tuned for
// flat cards; painted leaves carry their own highlights), unless the world's fx.leaf says
// otherwise.
export const LEAF_GRADE = Object.freeze({ sat: 0.82, gain: 0.88 });
export function leafPaint(hex, { sat = LEAF_GRADE.sat, gain = LEAF_GRADE.gain } = {}) {
  const c = hexLin(hex), l = luma3(c);
  return c.map((v) => Math.max(0, (l + (v - l) * sat) * gain));
}
export function treeGrade(sky, { sky: skyK = 0.4, sun: sunK = 0.45, lift = 0 } = {}) {
  const lifted = (lo, hi) => lo.map((v, i) => Math.round((v + (hi[i] * 0.6 - v) * lift) * 1000) / 1000);
  if (!sky || !sky.zenith) return { lo: lifted(SHADE_LO, SHADE_HI), hi: [...SHADE_HI] };
  const unit = (c) => { const l = Math.max(1e-4, luma3(c)); return c.map((v) => v / l); };
  // a tint, held near white so a deep blue zenith or a red sun colours the trees without dyeing them
  const tint = (c, k) => unit(c).map((v) => 1 + (Math.min(2.2, v) - 1) * k);
  const z = hexLin(sky.zenith), h = hexLin(sky.horizon || sky.zenith);
  const air = tint([0.5 * (z[0] + h[0]), 0.5 * (z[1] + h[1]), 0.5 * (z[2] + h[2])], skyK);
  const sun = tint(hexLin((sky.sun && sky.sun.color) || '#ffffff'), sunK);
  const grade = (base, t) => { const l = luma3(base), c = base.map((v, i) => v * t[i]), k = l / Math.max(1e-4, luma3(c)); return c.map((v) => Math.round(v * k * 1000) / 1000); };
  const hi = grade(SHADE_HI, sun);
  return { lo: lifted(grade(SHADE_LO, air), hi), hi };
}

// ---------------------------------------------------------------- the understory
// Scattered at the foot of the trees: ferns, bushes, grass tufts, flowers, rocks, and a
// world's small trees (banana, tree fern, saplings). Scenery only: nothing here is in the
// ball's way (lib/tree-obstacles.js never sees it), so it keeps off anywhere a ball is
// played from. Deterministic from the tree spots: the same course gives the same plants.
//
// spots: [{ x, y, h?, r? }]; blocked(x, y, r) -> true on fairway / green / tee / bunker /
// water (scene.js _treeSpots' test); clear(x, y) -> false where nothing may stand (steep
// ground, under water); density: plants a tree (quality). Returns
// [{ x, y, plant, row (the world's row index), size (m), rot, u }].
export const UNDER_PER_TREE = 3.2;
export const UNDER_MARGIN_M = 1.6;     // kept this far outside mown ground, sand and water
export const UNDER_TRUNK_CLEAR_M = 0.9; // and this far from any trunk
export const UNDER_CAP = 5200;
export function placeUnderstory(theme, spots, { blocked = null, clear = null, density = 1, cap = UNDER_CAP } = {}) {
  const w = treeWorld(theme);
  if (!w.under.length || !(density > 0) || !spots.length) return [];
  const total = w.under.reduce((s, u) => s + u.weight, 0);
  const out = [];
  const want = UNDER_PER_TREE * density * (w.underDensity || 1);
  const perTree = want * Math.min(1, cap / Math.max(1, spots.length * want));
  const m = UNDER_MARGIN_M;
  const cell = 2.2, taken = new Map();
  const key = (x, y) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  // every trunk's foot stays clear (its own tree's and its neighbours')
  const tcell = 4, trunks = new Map();
  const tkey = (cx, cy) => `${cx},${cy}`;
  for (const s of spots) { const k = tkey(Math.floor(s.x / tcell), Math.floor(s.y / tcell)); (trunks.get(k) || trunks.set(k, []).get(k)).push(s); }
  const onTrunk = (x, y, r) => {
    const cx = Math.floor(x / tcell), cy = Math.floor(y / tcell);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const s of trunks.get(tkey(cx + i, cy + j)) || []) if ((s.x - x) ** 2 + (s.y - y) ** 2 < r * r) return true;
    return false;
  };
  for (const s of spots) {
    const n = Math.floor(perTree) + (hash2(s.x, s.y, 301) < perTree % 1 ? 1 : 0);
    const cr = spotCrown(s);
    for (let k = 0; k < n; k++) {
      let pick = hash2(s.x, s.y, 310 + k * 7) * total, i = 0;
      for (; i < w.under.length - 1; i++) { pick -= w.under[i].weight; if (pick <= 0) break; }
      const row = w.under[i];
      const a = hash2(s.x, s.y, 320 + k * 7) * Math.PI * 2;
      const d = Math.max(1.1, cr * (row.reach[0] + (row.reach[1] - row.reach[0]) * hash2(s.x, s.y, 330 + k * 7)));
      const x = s.x + Math.cos(a) * d, y = s.y + Math.sin(a) * d;
      const size = row.size[0] + (row.size[1] - row.size[0]) * hash2(s.x, s.y, 340 + k * 7);
      const pad = m + size * 0.35;
      if (blocked && (blocked(x, y, pad) || blocked(x + pad, y, pad) || blocked(x - pad, y, pad) || blocked(x, y + pad, pad) || blocked(x, y - pad, pad))) continue;
      if (clear && !clear(x, y)) continue;
      if (onTrunk(x, y, UNDER_TRUNK_CLEAR_M + size * 0.12)) continue;
      const kk = key(x, y), big = size > 2.4 ? 2 : 1;
      if ((taken.get(kk) || 0) + big > 2) continue;   // no pile-ups: two small plants a cell, or one big
      taken.set(kk, (taken.get(kk) || 0) + big);
      out.push({ x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100, plant: row.plant, row: i, size: Math.round(size * 100) / 100, rot: hash2(x, y, 350) * Math.PI * 2, u: hash2(x, y, 360) });
      if (out.length >= cap) return out;
    }
  }
  return out;
}
