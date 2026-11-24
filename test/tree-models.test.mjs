// The arcade worlds' trees (public/render/tree-species.js, tree-models.js, tree-glb.js; the
// models in public/arcade/trees/ grown by tools/arcade-art/trees/): every theme has its
// species, the shipped files are what the generator makes, levels of detail hand over
// without a pop, instances stand where the ball's trees do and are about as thick, the
// understory is the same for every player and keeps off play, and the pass-through still
// takes a tree out of the way of the shot. v3:tree-realism: the painted atlases are cut
// clean and mip-safe, the trees by a tee or a green are hero models, the trees take their
// light's colours from the stage's sky, and the `palm` prop is the generator's coconut.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import * as THREE from 'three';
import { readTreeGlb, writeTreeGlb, TREE_ATTRIBUTES } from '../public/render/tree-glb.js';
import {
  TREE_WORLDS, TREE_WORLD_NAMES, TREE_SIZE_RANGE, UNDER_MODELS, UNDER_MARGIN_M, UNDER_TRUNK_CLEAR_M, treeWorld, worldSpecies, treeAt, variantOf, treeScale,
  collisionTrunkR, spotHeight, lodFor, lodKeep, cardVisible, treeDetail, placeUnderstory, hash2,
  heroSpots, HERO_RADIUS_M, treeGrade, leafPaint, LEAF_GRADE,
} from '../public/render/tree-species.js';
import { ArcadeTreeField, treeModeFromQuery } from '../public/render/tree-models.js';
import { ARCADE_THEMES } from '../public/render/arcade-look.js';
import { FADE_SHOWN, FADE_HUG_M } from '../public/render/tree-fade.js';
import { growTree, hasHero, tileRect, SPECIES, SPECIES_NAMES, LOD_KEEP } from '../tools/arcade-art/trees/gen.mjs';
import { LEAF_TILES, LEAF_GRID, BARK_COLUMNS, TILE, BARK_W, BARK_H, DETAIL_MID } from '../tools/arcade-art/trees/textures.mjs';
import { LEAF_PROMPTS, BARK_PROMPTS, promptFor } from '../tools/arcade-art/trees/prompts.mjs';
import { PALM_PROP_FILES } from '../tools/arcade-art/trees/palm-prop.mjs';
import { inspectGlb } from '../tools/arcade-art/bake.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'public', 'arcade', 'trees');
const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8'));
const glbCache = new Map();
const glb = (name) => { if (!glbCache.has(name)) glbCache.set(name, readTreeGlb(fs.readFileSync(path.join(DIR, manifest.species[name].file)))); return glbCache.get(name); };
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

// a wood on flat ground: n spots on a jittered grid, measured like an arcade stage's trees
function wood(n, { pitch = 9, seed = 5 } = {}) {
  const side = Math.ceil(Math.sqrt(n)), spots = [];
  for (let i = 0; i < n; i++) {
    const gx = i % side, gy = Math.floor(i / side);
    spots.push({ x: Math.round((gx * pitch + hash2(gx, gy, seed) * 4 + 30) * 100) / 100, y: Math.round((gy * pitch + hash2(gx, gy, seed + 1) * 4 + 30) * 100) / 100, h: 9 + 7 * hash2(gx, gy, seed + 2), r: 2.8 + 2.2 * hash2(gx, gy, seed + 3) });
  }
  return spots;
}
const V = (x, y, z = 0) => new THREE.Vector3(x, z, -y);
const flat = () => 0;
const given = (extra = {}) => ({ manifest, glb: (name) => fs.readFileSync(path.join(DIR, manifest.species[name].file)), textures: { leaves: new THREE.Texture(), aux: new THREE.Texture(), bark: new THREE.Texture(), barkN: new THREE.Texture() }, ...extra });
function camAt(x, y, z, lookX, lookY, lookZ = 2) {
  const cam = new THREE.PerspectiveCamera(58, 16 / 9, 0.3, 6000);
  cam.position.copy(V(x, y, z));
  cam.lookAt(V(lookX, lookY, lookZ));
  cam.updateMatrixWorld(true);
  return cam;
}

test('every arcade theme has a species set, and every species it names is a shipped model', () => {
  for (const theme of Object.keys(ARCADE_THEMES)) {
    assert.ok(TREE_WORLDS[theme], `no tree world for the theme "${theme}"`);
  }
  assert.equal(treeWorld('no-such-theme'), TREE_WORLDS.tropical, 'a course without a theme is the plain arcade look');
  assert.equal(treeWorld(null), TREE_WORLDS.tropical);
  for (const name of TREE_WORLD_NAMES) {
    const w = TREE_WORLDS[name];
    assert.ok(w.trees.length >= 1 && w.under.length >= 3, name);
    for (const t of w.trees) {
      const e = manifest.species[t.species];
      assert.ok(e, `${name}: species ${t.species} is not in the manifest`);
      assert.ok(e.variants.length >= 2, `${name}: ${t.species} has ${e.variants.length} variant(s): a wood of it would look copy-pasted`);
      assert.notEqual(e.kind, 'under', `${name}: ${t.species} is an understory plant, not a tree`);
      assert.ok(t.height >= TREE_SIZE_RANGE[0] && t.height <= TREE_SIZE_RANGE[1] && t.crown >= TREE_SIZE_RANGE[0] && t.crown <= TREE_SIZE_RANGE[1], `${name}: ${t.species} is drawn too far from the measured tree`);
      assert.match(t.leaf, /^#[0-9a-f]{6}$/i);
    }
    // one species cannot fill a world unless it has three forms
    if (w.trees.length === 1) assert.ok(manifest.species[w.trees[0].species].variants.length >= 3, name);
    for (const u of w.under) {
      const model = u.species || UNDER_MODELS[u.plant];
      assert.ok(model && manifest.species[model], `${name}: understory plant ${u.plant} has no model`);
      assert.ok(u.size[0] > 0 && u.size[1] >= u.size[0] && u.reach[1] >= u.reach[0]);
    }
    for (const s of worldSpecies(name)) assert.ok(manifest.species[s], `${name}: ${s}`);
    assert.deepEqual(worldSpecies(name, { understory: false }).sort(), [...new Set(w.trees.map((t) => t.species))].sort(), 'Low loads the trees alone');
  }
  // the sets the brief asked for
  const has = (world, list) => list.every((s) => TREE_WORLDS[world].trees.some((t) => t.species === s) || TREE_WORLDS[world].under.some((u) => u.plant === s || u.species === s));
  assert.ok(has('tropical', ['coconut', 'fanpalm', 'seaalmond']));
  assert.ok(has('jungle', ['kapok', 'fig', 'banana', 'treefern']));
  assert.ok(has('canyon', ['juniper', 'acacia', 'snag', 'scrub']) && has('desert', ['datepalm', 'acacia', 'snag', 'scrub']));
  assert.ok(has('links', ['windpine', 'gorse']) && has('alpine', ['spruce', 'fir', 'larch']) && has('sakura', ['cherry', 'cloudpine', 'maple']));
  assert.ok(has('neon', ['street']) && has('stadium', ['street']));
  assert.ok(TREE_WORLDS.alpine.fx.snow && TREE_WORLDS.sakura.fx.petals && TREE_WORLDS.neon.fx.uplight && TREE_WORLDS.stadium.fx.uplight, 'snow, blossom on the air, up-lighting');
});

test('the shipped tree files are what the manifest says, and the whole set is light', () => {
  assert.deepEqual(manifest.leafTiles, [...LEAF_TILES]);
  assert.deepEqual(manifest.barkColumns, [...BARK_COLUMNS]);
  assert.deepEqual(manifest.lodKeep, [...LOD_KEEP]);
  assert.deepEqual(Object.keys(manifest.species).sort(), [...SPECIES_NAMES].sort());
  let total = 0;
  for (const [name, e] of Object.entries(manifest.species)) {
    assert.match(e.file, /^[a-z0-9][a-z0-9._-]*\.glb$/);
    const file = path.join(DIR, e.file);
    assert.equal(fs.statSync(file).size, e.bytes, `${name}: the manifest is stale (node tools/arcade-art/trees/build.mjs)`);
    total += e.bytes;
    const g = glb(name);
    assert.equal(!!e.hero, hasHero(name), `${name}: a hero model for every tree, none for the understory`);
    assert.equal(g.models.length, e.variants.length + (e.hero ? 1 : 0), name);
    if (e.hero) assert.equal(g.models.at(-1).name, `${name}-hero`);
    const metas = [...e.variants, ...(e.hero ? [e.hero] : [])];
    g.models.forEach((m, v) => {
      const n = m.attributes.position.length / 3;
      assert.equal(n, metas[v].verts, `${name}-${v}`);
      for (const d of Object.values(TREE_ATTRIBUTES)) assert.equal(m.attributes[d.name].length, n * d.size, `${name}-${v}: ${d.name}`);
      assert.equal(m.lods.length, 3);
      assert.deepEqual(m.lods.map((l) => l.length / 3), metas[v].tris, `${name}-${v}: triangles a level`);
      assert.ok(m.lods[0].length >= m.lods[1].length && m.lods[1].length >= m.lods[2].length, `${name}-${v}: far levels are lighter`);
      for (const l of m.lods) for (let i = 0; i < l.length; i += 97) assert.ok(l[i] < n, `${name}-${v}: an index past the vertices`);
      // stands on its foot, y up
      let minY = Infinity, maxY = -Infinity;
      for (let i = 1; i < m.attributes.position.length; i += 3) { minY = Math.min(minY, m.attributes.position[i]); maxY = Math.max(maxY, m.attributes.position[i]); }
      assert.ok(minY <= 0.05 && minY > -1.5, `${name}-${v}: the foot is at ${minY}`);
      assert.ok(Math.abs(maxY - metas[v].top) < 0.01, `${name}-${v}: top`);
      // (the understory's small plants are scaled to a size each: only trees are modelled at a height)
      if (e.kind !== 'under') assert.ok(maxY > e.H * 0.55 && maxY < e.H * 1.35, `${name}-${v}: ${maxY} m tall, modelled for ${e.H}`);
    });
  }
  for (const t of Object.values(manifest.textures)) { assert.equal(fs.statSync(path.join(DIR, t.file)).size, t.bytes); total += t.bytes; }
  assert.equal(total, manifest.bytes);
  assert.ok(total < 25 * 1048576, `the tree set is ${(total / 1048576).toFixed(1)} MB`);
  // nothing unlisted ships in the folder
  const listed = new Set(['manifest.json', ...Object.values(manifest.species).map((e) => e.file), ...Object.values(manifest.textures).map((t) => t.file)]);
  assert.deepEqual(fs.readdirSync(DIR).filter((f) => !listed.has(f)), []);
  // a tree model near the camera is a few thousand triangles, a far one a few hundred; a hero
  // (a handful a hole) may be three times that
  for (const [name, e] of Object.entries(manifest.species)) {
    for (const v of e.variants) assert.ok(v.tris[0] <= 2800 && v.tris[2] <= 480, `${name}: ${v.tris}`);
    if (e.hero) {
      assert.ok(e.hero.tris[0] > e.variants[0].tris[0] * 1.5 && e.hero.tris[0] <= 9000 && e.hero.tris[2] <= 900, `${name} hero: ${e.hero.tris}`);
      assert.ok(Math.abs(e.hero.top - e.variants[0].top) < 0.12 * e.H, `${name}: the hero stands as tall as the tree it replaces`);
    }
  }
});

test('the painted textures: four files of the sizes the shader assumes, cut clean and safe to mip', async () => {
  const sharp = createRequire(import.meta.url)('sharp');
  const T = manifest.textures;
  assert.deepEqual(Object.keys(T).sort(), ['bark', 'barkNormal', 'leaves', 'leavesAux']);
  assert.deepEqual(manifest.leafGrid, [...LEAF_GRID]);
  assert.equal(LEAF_TILES.length, LEAF_GRID[0] * LEAF_GRID[1], 'every cell of the atlas is a tile');
  assert.equal(manifest.detailMid, DETAIL_MID);
  const [AW, AH] = [LEAF_GRID[0] * TILE, LEAF_GRID[1] * TILE], BW = BARK_W * BARK_COLUMNS.length;
  const load = async (t) => { const { data, info } = await sharp(path.join(DIR, t.file)).raw().toBuffer({ resolveWithObject: true }); assert.equal(info.channels, 3, `${t.file}: opaque RGB`); return { data, w: info.width, h: info.height }; };
  const [col, aux, bark, barkN] = await Promise.all([load(T.leaves), load(T.leavesAux), load(T.bark), load(T.barkNormal)]);
  assert.deepEqual([col.w, col.h, aux.w, aux.h], [AW, AH, AW, AH]);
  assert.deepEqual([bark.w, bark.h, barkN.w, barkN.h], [BW, BARK_H, BW, BARK_H]);
  for (const [k, t] of Object.entries(T)) assert.deepEqual([t.width, t.height], k.startsWith('leaves') ? [AW, AH] : [BW, BARK_H], k);
  LEAF_TILES.forEach((name, t) => {
    const gx = (t % LEAF_GRID[0]) * TILE, gy = Math.floor(t / LEAF_GRID[0]) * TILE;
    let cover = 0, edge = 0, darkUnderCut = 0, cut = 0, accent = 0;
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
      const i = ((gy + y) * AW + gx + x) * 3, a = aux.data[i];
      if (a >= 128) { cover++; if (aux.data[i + 1] >= 128) accent++; }
      else { cut++; if (col.data[i] + col.data[i + 1] + col.data[i + 2] < 24) darkUnderCut++; }
      // the outermost pixels of a tile: nothing of the picture there but the stalk it grows from (or the edge a vine hangs from)
      if ((x < 4 || x >= TILE - 4 || y < 4) && a >= 128 && name !== 'vine') edge++;
    }
    const share = cover / (TILE * TILE);
    assert.ok(share > 0.12 && share < 0.72, `${name}: ${(share * 100).toFixed(0)} % covered`);
    assert.equal(edge, 0, `${name}: the picture reaches the edge of its tile (it would bleed into its neighbour's mips)`);
    // the colour under the cut-away background is the leaves' own, carried outward: never black, never the key
    assert.ok(darkUnderCut < cut * 0.02, `${name}: ${darkUnderCut} dark pixels under the cut`);
    if (['bushFlower', 'gorse', 'grass', 'twig', 'boughSnow'].includes(name)) assert.ok(accent > cover * 0.02, `${name}: its flowers / seed heads / buds / snow are in the accent mask`);
    else assert.ok(accent < cover * 0.02, `${name}: no accent`);
  });
  // no key colour survives anywhere in the atlas (magenta or pure blue would be a missed cut)
  let key = 0;
  for (let i = 0; i < col.data.length; i += 3 * 7) { const r = col.data[i], g = col.data[i + 1], b = col.data[i + 2]; if ((r > 200 && b > 200 && g < 90) || (b > 200 && r < 70 && g < 70)) key++; }
  assert.equal(key, 0, 'key colour left in the leaf atlas');
  // bark tiles up the trunk: a column's top row meets its bottom row about as well as any two neighbouring rows meet
  BARK_COLUMNS.forEach((name, c) => {
    const row = (y) => { let s = 0; for (let x = 8; x < BARK_W - 8; x++) { const i = (y * BW + c * BARK_W + x) * 3, j = (((y + 1) % BARK_H) * BW + c * BARK_W + x) * 3; s += Math.abs(bark.data[i] - bark.data[j]) + Math.abs(bark.data[i + 1] - bark.data[j + 1]) + Math.abs(bark.data[i + 2] - bark.data[j + 2]); } return s / (BARK_W - 16); };
    let inside = 0;
    for (let y = 100; y < 900; y += 50) inside = Math.max(inside, row(y));
    assert.ok(row(BARK_H - 1) < inside * 1.6 + 6, `${name}: a seam where the column wraps (${row(BARK_H - 1).toFixed(1)} against ${inside.toFixed(1)})`);
    // its normal map is a unit-ish normal facing out of the bark
    let nz = 0, n = 0;
    for (let y = 0; y < BARK_H; y += 9) for (let x = 0; x < BARK_W; x += 7) { const i = (y * BW + c * BARK_W + x) * 3, nx = barkN.data[i] / 127.5 - 1, ny = barkN.data[i + 1] / 127.5 - 1; nz += Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny)); n++; }
    assert.ok(nz / n > 0.8, `${name}: normals ${(nz / n).toFixed(2)}`);
  });
  // every tile and column has its prompt on file, and says where the art came from
  for (const name of LEAF_TILES) assert.ok(LEAF_PROMPTS[name] && /flat, uniform, pure (magenta|blue)/.test(promptFor(name).prompt), `a prompt for ${name}`);
  for (const name of BARK_COLUMNS) assert.ok(BARK_PROMPTS[name], `a prompt for ${name}`);
  assert.match(manifest.art.made, /original/);
  assert.equal(Object.keys(manifest.art.jobs).length, LEAF_TILES.length + BARK_COLUMNS.length);
  // a model's cards read whole tiles: the atlas uv of a tile's corners lies inside that tile, off its margin
  for (const name of LEAF_TILES) {
    const t = LEAF_TILES.indexOf(name), rect = tileRect(name), [u0, v0] = rect(0, 0), [u1, v1] = rect(1, 1);
    const c = t % LEAF_GRID[0], r = Math.floor(t / LEAF_GRID[0]);
    assert.ok(u0 > c / LEAF_GRID[0] && u1 < (c + 1) / LEAF_GRID[0] && 1 - v0 < (r + 1) / LEAF_GRID[1] && 1 - v1 > r / LEAF_GRID[1], name);
  }
});

test('heroes: the trees nearest a tee or a green stand as their species\' higher-detail model', async () => {
  const spots = wood(240);
  const tee = { x: 30, y: 30 }, pin = [150, 160];
  const picked = heroSpots(spots, [tee, { x: pin[0], y: pin[1] }], 3);
  assert.equal(picked.size, 6);
  for (const i of picked) assert.ok(Math.min(Math.hypot(spots[i].x - tee.x, spots[i].y - tee.y), Math.hypot(spots[i].x - pin[0], spots[i].y - pin[1])) < HERO_RADIUS_M);
  // they are the nearest: no other tree is closer to the tee than the farthest of its three
  const dTee = spots.map((s) => Math.hypot(s.x - tee.x, s.y - tee.y)).sort((a, b) => a - b);
  assert.ok([...picked].filter((i) => Math.hypot(spots[i].x - tee.x, spots[i].y - tee.y) <= dTee[2] + 1e-9).length === 3);
  assert.equal(heroSpots(spots, [{ x: 5000, y: 5000 }], 3).size, 0, 'no tree near: no hero');
  assert.deepEqual([...heroSpots(spots, [tee], 3)], [...heroSpots(spots, [tee], 3)], 'the same every time');
  assert.equal(treeDetail('low').heroes, 0);
  assert.ok(treeDetail('high').heroes >= 2 && treeDetail('high').heroes <= 3 && treeDetail('ultra').heroes >= treeDetail('high').heroes);
  // in the field: ordinary batches (four buckets, the one material), so they change level and fade like the rest
  const field = new ArcadeTreeField(spots, flat, V, { nearM: 200, midM: 1100, theme: 'jungle', quality: 'high', assets: given(), focus: [tee, pin] });
  await field.ready;
  assert.equal(field.heroes, 6);
  const heroBatches = field.variants.filter((b) => b.name.endsWith(':hero'));
  assert.ok(heroBatches.length >= 1 && heroBatches.reduce((s, b) => s + b.n, 0) === 6);
  assert.equal(field.variants.filter((b) => !b.under).reduce((s, b) => s + b.n, 0), spots.length, 'a hero replaces its tree: still one instance a spot');
  for (const b of heroBatches) {
    assert.equal(b.buckets.length, 4);
    assert.ok(b.buckets[0].im.geometry.index.count > b.buckets[1].im.geometry.index.count && b.buckets[1].im.geometry.index.count > b.buckets[2].im.geometry.index.count);
    assert.equal(b.buckets[0].im.material, field.variants[0].buckets[0].im.material);
  }
  field.update(camAt(100, -900, 200, 100, 100), 1);
  assert.equal(field.stats.far, spots.length, 'from a kilometre off a hero is a far model like any other');
  const low = new ArcadeTreeField(spots, flat, V, { theme: 'jungle', quality: 'low', assets: given(), focus: [tee, pin] });
  await low.ready;
  assert.equal(low.heroes, 0);
  for (const f of [field, low]) f.dispose();
  // a hero has more of everything, and is grown from the same seed every time
  const a = growTree('kapok', 0, { hero: true }), b = growTree('kapok', 0, { hero: true }), plain = growTree('kapok', 0);
  assert.deepEqual(a.meta, b.meta);
  assert.ok(a.meta.cards > plain.meta.cards && a.meta.tris[0] > plain.meta.tris[0] * 1.5);
  assert.match(read('public/render/scene.js'), /focus: \(geo\.holes \|\| \[\]\)\.flatMap\(\(h\) => \[h\.tee, h\.pin\]\)\.filter\(Boolean\),/);
});

test('the trees sit in the stage\'s own light: shade toward its sky, lit sides toward its sun', async () => {
  const env = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'arcade', 'env', 'manifest.json'), 'utf8'));
  const luma = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const neutral = treeGrade(null);
  assert.ok(luma(neutral.lo) < 0.4 && luma(neutral.hi) > 1, 'a dark end and a lit end');
  for (const [id, sky] of Object.entries(env.skies)) {
    const g = treeGrade(sky);
    // the grade moves the colour, not the brightness
    assert.ok(Math.abs(luma(g.lo) - luma(neutral.lo)) < 0.01 && Math.abs(luma(g.hi) - luma(neutral.hi)) < 0.01, id);
    for (const v of [...g.lo, ...g.hi]) assert.ok(v > 0.05 && v < 2, `${id}: ${g.lo} / ${g.hi}`);
    // every arcade theme's stage sky is one the trees can find
    const [theme] = id.split('-');
    assert.ok(TREE_WORLDS[theme], `${id}: a tree world for the sky's theme`);
  }
  // a blue alpine sky cools the shade; a golden jungle sun warms the lit side
  const alpine = treeGrade(env.skies['alpine-day']), jungle = treeGrade(env.skies['jungle-golden']);
  assert.ok(alpine.lo[2] / alpine.lo[0] > neutral.lo[2] / neutral.lo[0], 'alpine shade is bluer');
  assert.ok(jungle.hi[0] / jungle.hi[2] > neutral.hi[0] / neutral.hi[2], 'jungle light is warmer');
  // a pale crown's shade is lifted (blossom)
  assert.ok(luma(treeGrade(env.skies['sakura-day'], TREE_WORLDS.sakura.fx.grade).lo) > luma(treeGrade(env.skies['sakura-day']).lo) + 0.1);
  // the field takes the grade it is given, and the neutral one without a sky
  const spots = wood(40);
  const lit = new ArcadeTreeField(spots, flat, V, { theme: 'alpine', quality: 'high', assets: given({ sky: env.skies['alpine-day'] }) });
  const plain = new ArcadeTreeField(spots, flat, V, { theme: 'alpine', quality: 'high', assets: given() });
  await Promise.all([lit.ready, plain.ready]);
  assert.deepEqual(lit.shared.uShadeLo.value.toArray(), alpine.lo);
  assert.deepEqual(plain.shared.uShadeLo.value.toArray(), neutral.lo);
  assert.equal(lit.shared.uPaint.value.x, 1 / DETAIL_MID);
  for (const f of [lit, plain]) f.dispose();
  // the palette as painted: a little less saturated and darker than the hex, never negative
  const p = leafPaint('#6ecb3c'), raw = leafPaint('#6ecb3c', { sat: 1, gain: 1 });
  assert.ok(luma(p) < luma(raw) && p[1] / p[0] < raw[1] / raw[0] && p.every((v) => v >= 0));
  assert.ok(LEAF_GRADE.sat > 0.6 && LEAF_GRADE.sat <= 1);
});

test('the palm prop is the generator\'s coconut palm, as the props layer wants its models', () => {
  const PROPS = path.join(ROOT, 'public', 'arcade', 'props');
  const row = JSON.parse(fs.readFileSync(path.join(PROPS, 'manifest.json'), 'utf8')).kinds.palm;
  assert.ok(row, 'kinds.palm in public/arcade/props/manifest.json (node tools/arcade-art/trees/build.mjs)');
  assert.equal(row.file, PALM_PROP_FILES[0]);
  assert.deepEqual(row.variants, [...PALM_PROP_FILES]);
  const coconut = manifest.species.coconut;
  for (const f of PALM_PROP_FILES) {
    const s = inspectGlb(path.join(PROPS, f));
    assert.ok(coconut.variants.some((v) => v.tris[0] === s.tris || Math.abs(v.tris[0] - s.tris) <= 4), `${f}: a coconut variant's full model (${s.tris} triangles)`);
    assert.ok(coconut.variants.some((v) => Math.abs(v.top - s.box.max[1]) < 0.01), `${f}: as tall as the tree`);
    assert.ok(s.primitives === 2 && s.materials === 2 && s.textures === 1 && s.extensions.length === 0, `${f}: bark and fronds, one atlas, plain glTF`);
    assert.ok(s.box.min[1] <= 0 && s.box.min[1] > -1, `${f}: its foot on y = 0`);
    assert.ok(s.windingOk > 0.97, `${f}: winding`);
    assert.ok(s.bytes < 400 * 1024, `${f}: ${Math.round(s.bytes / 1024)} KB`);
  }
  assert.equal(inspectGlb(path.join(PROPS, row.file)).tris, row.tris);
  assert.equal(inspectGlb(path.join(PROPS, row.file)).bytes, row.bytes);
});

test('the models are grown from seeds: the same every time, and the shipped files are current', () => {
  const a = growTree('kapok', 0), b = growTree('kapok', 0);
  assert.deepEqual(a.meta, b.meta);
  assert.deepEqual(Array.from(a.attributes.position.subarray(0, 600)), Array.from(b.attributes.position.subarray(0, 600)));
  assert.notDeepEqual(growTree('kapok', 1).meta, a.meta, 'variants differ');
  for (const name of SPECIES_NAMES) {
    SPECIES[name].variants.forEach((_, v) => {
      const m = growTree(name, v), shipped = glb(name).models[v];
      assert.equal(m.attributes.position.length, shipped.attributes.position.length, `${name}-${v}: rebuild the trees (node tools/arcade-art/trees/build.mjs)`);
      for (let i = 0; i < m.attributes.position.length; i += 53) assert.equal(m.attributes.position[i], shipped.attributes.position[i], `${name}-${v}: vertex ${i}`);
      assert.deepEqual(Array.from(m.lods[2]), Array.from(shipped.lods[2]), `${name}-${v}: far index`);
    });
  }
  // a model survives the file format
  const back = readTreeGlb(writeTreeGlb([{ name: 'kapok-0', attributes: a.attributes, lods: a.lods, extras: a.meta }])).models[0];
  assert.deepEqual(back.extras, a.meta);
  assert.deepEqual(Array.from(back.attributes.aWind), Array.from(a.attributes.aWind));
  assert.deepEqual(Array.from(back.lods[1]), Array.from(a.lods[1]));
});

test('levels of detail: the bucket by distance, and cards that drop by rank so the hand-over never pops', () => {
  assert.equal(lodFor(10, 200, 480), 0);
  assert.equal(lodFor(200, 200, 480), 1);
  assert.equal(lodFor(479, 200, 480), 1);
  assert.equal(lodFor(480, 200, 480), 2);
  // the share of cards kept: all of them up close, the mid level's share exactly at nearM, the far level's at midM
  assert.equal(lodKeep(0, 200, 480, LOD_KEEP), 1);
  assert.equal(lodKeep(80, 200, 480, LOD_KEEP), 1);
  assert.ok(Math.abs(lodKeep(200, 200, 480, LOD_KEEP) - LOD_KEEP[1]) < 1e-9);
  assert.ok(Math.abs(lodKeep(480, 200, 480, LOD_KEEP) - LOD_KEEP[2]) < 1e-9);
  assert.ok(Math.abs(lodKeep(3000, 200, 480, LOD_KEEP) - LOD_KEEP[2]) < 1e-9);
  let prev = 1;
  for (let d = 0; d <= 600; d += 5) { const k = lodKeep(d, 200, 480, LOD_KEEP); assert.ok(k <= prev + 1e-12, `keep rises at ${d} m`); prev = k; }
  // a card is whole while the tree keeps more than its rank, gone past 1.08 x the keep
  assert.equal(cardVisible(0.2, 1), 1);
  assert.equal(cardVisible(0.999, 1), 1, 'every card is whole on a near tree');
  assert.equal(cardVisible(0.41, 0.42), 1);
  assert.equal(cardVisible(0.42 * 1.08 + 1e-6, 0.42), 0);
  assert.ok(cardVisible(0.44, 0.42) > 0 && cardVisible(0.44, 0.42) < 1);
  // so a level's index needs exactly the cards under 1.08 x its keep: a card it lacks is one the
  // vertex shader had already shrunk to nothing before the tree changed bucket
  for (const name of ['kapok', 'cherry', 'spruce', 'coconut', 'street']) {
    glb(name).models.forEach((m, v) => {
      const kind = (i) => m.attributes.aData[i * 4 + 3] / 255, rank = (i) => m.attributes.aWind[i * 4 + 1] / 255;
      const leafTris = (idx, lim) => { let n = 0; for (let i = 0; i < idx.length; i += 3) if (kind(idx[i]) > 0.75 && rank(idx[i]) < lim) n++; return n; };
      const all = (idx) => leafTris(idx, 2);
      for (const l of [1, 2]) {
        const cut = LOD_KEEP[l] * 1.08;
        // (ranks are stored in 8 bits: allow the cards within one step of the cut)
        assert.ok(all(m.lods[l]) >= leafTris(m.lods[0], cut - 1 / 255) && all(m.lods[l]) <= leafTris(m.lods[0], cut + 1 / 255), `${name}-${v}: level ${l} holds the cards under its cut`);
        assert.ok(all(m.lods[l]) > 0, `${name}-${v}: level ${l} has leaves`);
      }
      assert.ok(all(m.lods[2]) < all(m.lods[1]) && all(m.lods[1]) < all(m.lods[0]));
    });
  }
  // the vertex shader is the same rule as lodKeep / cardVisible
  const src = read('public/render/tree-models.js');
  assert.match(src, /float k = mix\(1\.0, uLod\.z, smoothstep\(uLod\.x \* 0\.45, uLod\.x, d\)\);\r?\n\s*return mix\(k, uLod\.w, smoothstep\(uLod\.x, uLod\.y, d\)\);/);
  assert.match(src, /float vis = clamp\(\(keep \* 1\.08 - aWind\.y\) \/ \(0\.08 \* keep \+ 1e-4\), 0\.0, 1\.0\);/);
  assert.match(src, /transformed = \(position - aPivot\) \+ aPivot \* mix\(1\.0, vis \* grow, tLeaf\);/);
  assert.doesNotMatch(src, /gl_FragCoord/, 'no screen-door dither');
});

test('the graphics level switches to cheap trees', () => {
  const low = treeDetail('low'), high = treeDetail('high'), ultra = treeDetail('ultra');
  assert.equal(low.maxLod, 1, 'Low never draws the full model');
  assert.equal(low.understory, 0);
  assert.equal(low.petals, 0);
  assert.equal(low.shadows, false);
  assert.equal(high.maxLod, 0);
  assert.ok(high.understory > 0 && high.underDrawM > 100 && ultra.underDrawM > high.underDrawM);
  // the old trees are one query away, and the scene builds its field through the factory
  assert.equal(treeModeFromQuery(), 'arcade');
  const trees = read('public/render/trees.js'), scene = read('public/render/scene.js');
  assert.match(trees, /export function makeTreeField\(spots, hAt, V, opts = \{\}\) \{\r?\n  if \(opts\.arcade && treeModeFromQuery\(\) !== 'classic'\) \{/);
  assert.match(trees, /onFail: \(field\) => field\.adopt\(new TreeField\(spots, hAt, V, opts\)\),/);
  assert.match(trees, /return new TreeField\(spots, hAt, V, opts\);\r?\n\}/);
  assert.match(scene, /this\._treeField = makeTreeField\(spots, hAt, V, \{/);
  assert.match(scene, /arcade: this\.look === 'arcade' \? \{ theme: this\._arcadeLook\?\.theme \|\| 'tropical', timeOfDay: this\._arcadeLook\?\.timeOfDay \|\| 'day' \} : null,/);
  assert.match(scene, /quality: this\.quality\?\.level, blocked: this\._treeBlocked,/);
  assert.match(scene, /this\._treeField\?\.setWind\?\.\(\{ mph, toDeg: to \}\);/);
});

test('a spot always gets the same tree, and a wood is a mix of the world\'s species', () => {
  const spots = wood(600);
  for (const name of TREE_WORLD_NAMES) {
    const count = {};
    for (const s of spots) {
      const a = treeAt(name, s, 0.5), b = treeAt(name, { ...s }, 0.5);
      assert.equal(a.species, b.species);
      assert.equal(a.u, b.u);
      count[a.species] = (count[a.species] || 0) + 1;
      const n = manifest.species[a.species].variants.length, v = variantOf(s, n);
      assert.ok(v >= 0 && v < n && v === variantOf({ x: s.x, y: s.y }, n));
    }
    for (const t of TREE_WORLDS[name].trees) assert.ok(count[t.species] >= 6, `${name}: ${t.species} stands ${count[t.species] || 0} times in 600`);
    // every variant of the main species is used
    const main = TREE_WORLDS[name].trees[0].species, used = new Set(spots.filter((s) => treeAt(name, s, 0.5).species === main).map((s) => variantOf(s, manifest.species[main].variants.length)));
    assert.equal(used.size, manifest.species[main].variants.length, `${name}: ${main}'s variants`);
  }
  // taller spots lean to the tall species
  const tall = spots.filter((s) => treeAt('jungle', s, 0.95).species === 'kapok').length, short = spots.filter((s) => treeAt('jungle', s, 0.05).species === 'kapok').length;
  assert.ok(tall > short * 1.5, `kapok: ${tall} of the tallest, ${short} of the shortest`);
});

test('the tree the player sees stands where the ball\'s tree does and is about as thick', () => {
  // lib/tree-obstacles.js: a trunk is a vertical cylinder of radius 0.12 + 0.01 h
  const obstacles = read('lib/tree-obstacles.js');
  assert.match(obstacles, /this\.trunkR\[i\] = 0\.12 \+ 0\.01 \* p\.h;/);
  assert.equal(collisionTrunkR(12), 0.24);
  for (const name of TREE_WORLD_NAMES) {
    for (const t of TREE_WORLDS[name].trees) {
      manifest.species[t.species].variants.forEach((m, v) => {
        for (const [h, r] of [[5, 2.2], [9, 2.8], [12.4, 3.9], [16, 5], [18.8, 5]]) {
          for (const [a, b] of [[0, 0], [0.5, 0.5], [0.999, 0.999]]) {
            const spot = { x: 0, y: 0, h, r }, sc = treeScale(spot, t, m, a, b);
            // as tall as the measured tree, within the world's stature for the species
            assert.ok(sc.heightM >= h * TREE_SIZE_RANGE[0] * 0.95 && sc.heightM <= h * TREE_SIZE_RANGE[1] * 1.05, `${name} ${t.species}-${v}: ${sc.heightM} m on a ${h} m spot`);
            assert.ok(Math.abs(m.top * sc.ht - sc.heightM) < 1e-6);
            // never squashed or stretched out of its own shape
            assert.ok(sc.w / sc.ht > 0.7 && sc.w / sc.ht < 1.45, `${name} ${t.species}-${v}: ${sc.w / sc.ht}`);
            // the trunk at a metre up against the ball's (the arcade's soft trees use 0.6 of it)
            const seen = m.trunkR * sc.w, hit = collisionTrunkR(h);
            assert.ok(seen > hit * 0.6 * 0.8 && seen < hit * 2.3, `${name} ${t.species}-${v} on ${h} m: trunk drawn ${seen.toFixed(2)} m, hit ${hit.toFixed(2)} m`);
            // and the bole has not leaned away from that cylinder by half way up
            assert.ok(m.leanMid * sc.w < 1.25, `${name} ${t.species}-${v}: leans ${(m.leanMid * sc.w).toFixed(2)} m at half height`);
          }
        }
      });
    }
  }
  assert.equal(spotHeight({ h: 11 }), 11);
  assert.ok(Math.abs(spotHeight({ s: 1 }) - 11.9) < 1e-9, 'a point tree: trees.js draws it at 0.85 of its size');
});

test('the understory is the same for every player and keeps off mown ground, sand and water', () => {
  const spots = wood(300);
  // a fairway down the middle, a bunker, a pond: the scene's own kind of test (inside the shape)
  const rects = [[60, 20, 90, 200], [100, 60, 112, 72], [20, 120, 50, 150]];
  const inRect = (x, y) => rects.some(([x0, y0, x1, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1);
  const blocked = (x, y) => inRect(x, y);
  for (const name of TREE_WORLD_NAMES) {
    const a = placeUnderstory(name, spots, { blocked }), b = placeUnderstory(name, spots.map((s) => ({ ...s })), { blocked });
    assert.deepEqual(a, b, `${name}: placement is not deterministic`);
    assert.ok(a.length > spots.length * 1.2, `${name}: only ${a.length} plants for ${spots.length} trees`);
    for (const p of a) {
      assert.ok(!inRect(p.x, p.y), `${name}: a ${p.plant} on mown ground at ${p.x}, ${p.y}`);
      // and not within the margin of it either
      for (const [x0, y0, x1, y1] of rects) {
        const dx = Math.max(x0 - p.x, 0, p.x - x1), dy = Math.max(y0 - p.y, 0, p.y - y1);
        assert.ok(dx >= UNDER_MARGIN_M - 0.02 || dy >= UNDER_MARGIN_M - 0.02 || Math.hypot(dx, dy) >= UNDER_MARGIN_M * 0.7, `${name}: a ${p.plant} ${Math.hypot(dx, dy).toFixed(2)} m from mown ground`);
      }
      const row = TREE_WORLDS[name].under[p.row];
      assert.equal(row.plant, p.plant);
      assert.ok(p.size >= row.size[0] && p.size <= row.size[1]);
      // no plant on a trunk
      for (const s of spots) if (Math.hypot(s.x - p.x, s.y - p.y) < UNDER_TRUNK_CLEAR_M) assert.fail(`${name}: a ${p.plant} inside a trunk`);
    }
    // every kind of plant the world has turns up
    for (const u of TREE_WORLDS[name].under) assert.ok(a.some((p) => p.plant === u.plant), `${name}: no ${u.plant}`);
  }
  const all = placeUnderstory('jungle', spots, {}), half = placeUnderstory('jungle', spots, { density: 0.5 });
  assert.ok(half.length < all.length * 0.7 && half.length > all.length * 0.3);
  assert.deepEqual(placeUnderstory('jungle', spots, { density: 0 }), []);
  assert.ok(placeUnderstory('jungle', spots, { cap: 100 }).length <= 100);
  assert.equal(placeUnderstory('jungle', spots, { clear: () => false }).length, 0, 'steep ground and water take none');
  // it is scenery only: the ball's trees never hear of it
  assert.doesNotMatch(read('lib/tree-obstacles.js'), /understory|tree-species|placeUnderstory/i);
});

test('the field instances every tree once, at its spot, and re-buckets by distance', async () => {
  const spots = wood(240);
  const field = new ArcadeTreeField(spots, flat, V, { nearM: 200, midM: 1100, theme: 'jungle', quality: 'high', assets: given(), wind: { mph: 12, toDeg: 90 } });
  await field.ready;
  assert.equal(field.failed, false);
  assert.equal(field.loaded, true);
  const treeBatches = field.variants.filter((b) => !b.under), underBatches = field.variants.filter((b) => b.under);
  assert.equal(treeBatches.reduce((s, b) => s + b.n, 0), spots.length, 'one instance a spot');
  assert.equal(underBatches.reduce((s, b) => s + b.n, 0), field.plants);
  assert.ok(field.plants > spots.length);
  // one batch a species variant, four buckets each, every bucket one InstancedMesh on the ONE material
  const kinds = new Set(spots.map((s) => { const t = treeAt('jungle', s, 0.5); return t.species; }));
  assert.ok(treeBatches.length <= [...kinds].reduce((s, k) => s + manifest.species[k].variants.length, 0));
  const meshes = field.group.children.filter((o) => o.isInstancedMesh && o.name.startsWith('tree:'));
  assert.equal(meshes.length, field.variants.length * 4);
  assert.equal(new Set(meshes.filter((m) => !m.name.endsWith(':3')).map((m) => m.material)).size, 1, 'bark, leaves, rocks and flowers are one material');
  assert.equal(new Set(meshes.map((m) => m.customDepthMaterial)).size, 1);
  // every tree stands on its spot (three x = east, z = -north), upright
  const at = new Set(spots.map((s) => `${s.x.toFixed(2)},${s.y.toFixed(2)}`));
  for (const b of treeBatches) for (let i = 0; i < b.n; i++) {
    const x = b.mats[i * 16 + 12], z = b.mats[i * 16 + 14];
    assert.ok(at.has(`${x.toFixed(2)},${(-z).toFixed(2)}`), `an instance at ${x}, ${-z} is on no spot`);
    assert.ok(Math.abs(b.mats[i * 16 + 4]) < 1e-6 && b.mats[i * 16 + 5] > 0.3, 'upright');
  }
  // a camera that sees the whole wood from near: every tree is in exactly one bucket
  const cam = camAt(100, -120, 60, 100, 100);
  assert.equal(field.update(cam, 1), true);
  const st = field.stats;
  assert.equal(st.near + st.mid + st.far + st.seeThrough, spots.length);
  assert.ok(st.near > 0 && st.mid > 0 && st.far === 0, JSON.stringify(st));
  for (const b of field.variants) assert.equal(b.buckets.reduce((s, k) => s + k.im.count, 0) <= b.n, true);
  // from a kilometre off they are all the far model, and it is the lighter index
  field.update(camAt(100, -900, 200, 100, 100), 2);
  assert.equal(field.stats.far, spots.length);
  assert.equal(field.stats.near + field.stats.mid, 0);
  assert.equal(field.stats.under, 0, 'the understory is not drawn from a kilometre away');
  for (const b of treeBatches) assert.ok(b.buckets[2].im.geometry.index.count < b.buckets[0].im.geometry.index.count);
  // a still camera does no work
  assert.equal(field.update(camAt(100, -900, 200, 100, 100), 2.1), false);
  // the wind is the hole's: blowing east at 12 mph
  const w = field.shared.uWind.value;
  assert.ok(Math.abs(w.x - 1) < 1e-9 && Math.abs(w.y) < 1e-9 && Math.abs(w.z - 12 / 25) < 1e-9);
  field.setWind({ mph: 40, toDeg: 0 });
  assert.ok(Math.abs(w.x) < 1e-9 && Math.abs(w.y + 1) < 1e-9 && w.z === 1, 'north is three\'s -z; strength tops out');
  field.dispose();
});

test('Low draws the cheap trees: the lighter model up close, no understory, no shadows', async () => {
  const spots = wood(120);
  const field = new ArcadeTreeField(spots, flat, V, { nearM: 110, midM: 450, theme: 'alpine', quality: 'low', assets: given() });
  await field.ready;
  assert.equal(field.plants, 0);
  assert.ok(field.variants.every((b) => !b.under));
  for (const b of field.variants) {
    assert.equal(b.buckets[0].im.geometry.index.count, b.buckets[1].im.geometry.index.count, 'the near bucket is the mid model');
    assert.ok(b.buckets[0].keep > 0, 'its cards drawn grown, as the mid level draws them');
    assert.ok(b.buckets.every((k) => !k.im.castShadow));
  }
  const high = new ArcadeTreeField(spots, flat, V, { nearM: 200, midM: 1100, theme: 'alpine', quality: 'high', assets: given() });
  await high.ready;
  assert.ok(high.variants.some((b) => b.under));
  assert.ok(high.variants.filter((b) => !b.under).every((b) => b.buckets[0].im.castShadow && b.buckets[3].im.castShadow && !b.buckets[1].im.castShadow));
  assert.ok(high.shared.uSnow.value.w > 0.5, 'snow on alpine crowns');
  assert.ok(!high._petals);
  const sakura = new ArcadeTreeField(spots, flat, V, { theme: 'sakura', quality: 'high', assets: given() });
  await sakura.ready;
  assert.ok(sakura._petals && sakura._petals.isPoints, 'blossom drifting: one draw of points');
  const neonNight = new ArcadeTreeField(spots, flat, V, { theme: 'neon', timeOfDay: 'night', quality: 'high', assets: given() });
  const stadiumDay = new ArcadeTreeField(spots, flat, V, { theme: 'stadium', timeOfDay: 'day', quality: 'high', assets: given() });
  await Promise.all([neonNight.ready, stadiumDay.ready]);
  assert.ok(neonNight.shared.uUp.value.w > 0.5 && stadiumDay.shared.uUp.value.w < neonNight.shared.uUp.value.w * 0.3, 'up-lighting belongs to the night');
  for (const f of [field, high, sakura, neonNight, stadiumDay]) f.dispose();
});

test('the pass-through still takes a tree out of the way of the shot, and a missing file falls back', async () => {
  const spots = [{ x: 0, y: 40, h: 14, r: 4 }, { x: 30, y: 40, h: 14, r: 4 }, { x: 0, y: 140, h: 14, r: 4 }, { x: -60, y: 60, h: 14, r: 4 }];
  const field = new ArcadeTreeField(spots, flat, V, { nearM: 200, midM: 1100, theme: 'tropical', quality: 'low', assets: given() });
  await field.ready;
  const cam = camAt(0, -14, 4.6, 0, 60);
  // no line: the view's own zone (tree-fade.js) takes the tree squarely in front, 54 m is past it
  field.update(cam, 0);
  assert.equal(field.stats.seeThrough, 0, 'the tree in the middle is 54 m off: past the near zone');
  // the line of the shot: camera -> ball -> 120 m on. The tree standing on it becomes a ghost; the one 30 m aside does not
  const line = { x: 0, z: 14, ux: 0, uz: -1, d: 14, len: 134, camY: 4.6, ballY: 0, endY: 0 };
  field.setFadeLine(line);
  assert.equal(field.update(cam, 0), true, 'a new line re-buckets even with a still camera');
  assert.equal(field.stats.seeThrough, 1);
  assert.equal(field.stats.near, 3);
  assert.ok(field._ghosts.every((im) => im.renderOrder === 20), 'ghosts are drawn after the aim line');
  assert.ok(field._ghosts.length > 0 && field._ghosts.every((im) => im.material.transparent && im.material.opacity === FADE_SHOWN && im.material.alphaTest === 0.5 * FADE_SHOWN && im.material.depthWrite === false));
  // the same line again is no work; the pass-through off draws every tree solid
  field.setFadeLine({ ...line });
  assert.equal(field.update(cam, 0), false);
  field.fadeOn = false;
  field._last.t = -1e9;
  field.update(cam, 0);
  assert.equal(field.stats.seeThrough, 0);
  field.fadeOn = true;
  field.setFadeLine(null);
  field.update(cam, 0);
  assert.ok(field._ghosts.every((im) => im.renderOrder === 0));
  assert.equal(field.stats.seeThrough, 0);
  // a tree hugging the camera fades wherever the camera looks
  const hug = new ArcadeTreeField([{ x: 2, y: -12, h: 14, r: 4 }, { x: 80, y: 80, h: 14, r: 4 }], flat, V, { theme: 'tropical', quality: 'low', assets: given() });
  await hug.ready;
  assert.ok(Math.hypot(2, 2) < FADE_HUG_M);
  hug.update(cam, 0);
  assert.equal(hug.stats.seeThrough, 1);
  // the same hooks the classic field has, by name (see-over-rig.js and scene.js call them on either)
  const src = read('public/render/tree-models.js');
  assert.match(src, /setFadeLine\(line\) \{/);
  assert.match(src, /for \(const im of this\._ghosts \|\| \[\]\) im\.renderOrder = line \? 20 : 0;/);
  assert.match(src, /if \(lod === 0 && fl\) \{/);
  assert.match(src, /if \(treeFade\(vx, vz, treeH\) > FADE_AT\) lod = 3;/);
  assert.match(src, /transparent: true, opacity: FADE_SHOWN/);
  assert.match(src, /alphaTest: 0\.5 \* FADE_SHOWN/);
  // a copy of the game without the model files draws the classic trees in the same group
  let failed = null;
  const broken = new ArcadeTreeField(spots, flat, V, { theme: 'jungle', assets: { manifest, glb: () => { throw new Error('gone'); }, textures: given().textures }, onFail: (f) => { failed = f; } });
  const warn = console.warn; console.warn = () => {};
  await broken.ready;
  console.warn = warn;
  assert.equal(failed, broken);
  assert.equal(broken.failed, true);
  const classic = { group: new THREE.Group(), fadeOn: true, lines: [], setFadeLine(l) { this.lines.push(l); }, update() { return true; }, setNearDistance() {}, dispose() {} };
  broken.adopt(classic);
  assert.equal(classic.group.parent, broken.group);
  broken.setFadeLine(line);
  assert.equal(classic.lines.at(-1), line);
  assert.equal(broken.update(cam, 0), true);
  for (const f of [field, hug, broken]) f.dispose();
});

test('the tree tools are dependency-free at run time (sharp only paints the textures)', () => {
  const require = createRequire(import.meta.url);
  assert.doesNotThrow(() => require.resolve('sharp'));
  for (const f of ['public/render/tree-species.js', 'public/render/tree-glb.js']) assert.doesNotMatch(read(f), /from 'three'|document\.|window\./, `${f} is pure`);
  assert.doesNotMatch(read('public/render/tree-models.js'), /document\.|window\./, 'the field builds without a DOM (tests, tools)');
});
