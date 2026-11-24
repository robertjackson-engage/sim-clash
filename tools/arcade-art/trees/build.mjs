#!/usr/bin/env node
// Build the arcade trees: every species' models (gen.mjs) to one GLB a species, the palm
// prop the props layer draws (palm-prop.mjs), the manifest the game reads, and, when given
// the painted pictures, the four textures (textures.mjs).
//
//   node tools/arcade-art/trees/build.mjs [--out public/arcade/trees] [--only kapok,fig]
//        [--paint <folder of painted pictures>] [--preview <dir>] [--no-props]
//
// The models are grown from seeds in code: the same command always writes the same files,
// and nothing is downloaded. The textures are painted pictures (prompts.mjs) cut out and
// packed by textures.mjs: without --paint the shipped textures are left as they are.
// Output (public/arcade/trees/):
//
//   <species>.glb    the species' variants and its hero model, three levels of detail each
//                    (public/render/tree-glb.js)
//   leaves.webp, leaves-aux.png, bark.webp, bark-n.webp   (textures.mjs)
//   manifest.json    { version, lodKeep, leafTiles, leafGrid, barkColumns, textures, species: { name:
//                      { file, kind, H, align, bytes, variants: [{ top, crownBase, crownTop, crownR,
//                      trunkR, ... }], hero: { ... } } } }
//
// and public/arcade/props/palm-*.glb with the `palm` row of that folder's manifest (see palm-prop.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { growTree, hasHero, SPECIES, SPECIES_NAMES, LOD_KEEP } from './gen.mjs';
import { LEAF_TILES, LEAF_GRID, BARK_COLUMNS, DETAIL_MID } from './textures.mjs';
import { writeTreeGlb } from '../../../public/render/tree-glb.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const MANIFEST_VERSION = 2;

export async function buildTrees({ outDir = path.join(ROOT, 'public', 'arcade', 'trees'), only = null, paint = null, preview = null, props = true, propsDir = path.join(ROOT, 'public', 'arcade', 'props'), log = () => {} } = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  const manifestFile = path.join(outDir, 'manifest.json');
  const old = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : null;
  const manifest = {
    version: MANIFEST_VERSION, generator: 'tools/arcade-art/trees/build.mjs', lodKeep: [...LOD_KEEP], leafTiles: [...LEAF_TILES], leafGrid: [...LEAF_GRID], barkColumns: [...BARK_COLUMNS], detailMid: DETAIL_MID,
    textures: old?.textures || {}, art: old?.art || null, species: only ? { ...(old?.species || {}) } : {},
  };
  let total = 0;
  const strip = (meta) => { const { species, variant, kind, H, align, hero, ...rest } = meta; return rest; };
  for (const name of SPECIES_NAMES) {
    if (only && !only.includes(name)) continue;
    const sp = SPECIES[name];
    const models = sp.variants.map((_, v) => growTree(name, v));
    const hero = hasHero(name) ? growTree(name, 0, { hero: true }) : null;
    const glb = writeTreeGlb([
      ...models.map((m, v) => ({ name: `${name}-${v}`, attributes: m.attributes, lods: m.lods, extras: m.meta })),
      ...(hero ? [{ name: `${name}-hero`, attributes: hero.attributes, lods: hero.lods, extras: hero.meta }] : []),
    ], { extras: { species: name } });
    fs.writeFileSync(path.join(outDir, `${name}.glb`), glb);
    manifest.species[name] = { file: `${name}.glb`, kind: models[0].meta.kind, H: sp.H, align: !!sp.align, bytes: glb.length, variants: models.map((m) => strip(m.meta)), ...(hero ? { hero: strip(hero.meta) } : {}) };
    log(`${name.padEnd(12)} ${models.length} variants  ${(glb.length / 1024).toFixed(0).padStart(5)} KB  tris ${models.map((m) => m.meta.tris.join('/')).join('  ')}${hero ? `  hero ${hero.meta.tris.join('/')}` : ''}`);
  }
  if (paint) {
    const { buildTextures } = await import('./textures.mjs');
    const t = await buildTextures({ srcDir: paint, outDir, preview, log });
    manifest.textures = t.files;
    // where the pictures came from: <paint>/sources.json { made, model, jobs: { tile: job id } } when it is there
    const src = path.join(paint, 'sources.json');
    manifest.art = { made: 'painted for Sim Clash with an image model (original; no photograph, no third-party texture)', prompts: 'tools/arcade-art/trees/prompts.mjs', ...(fs.existsSync(src) ? JSON.parse(fs.readFileSync(src, 'utf8')) : {}) };
  }
  for (const s of Object.values(manifest.species)) total += s.bytes;
  for (const t of Object.values(manifest.textures)) total += t.bytes;
  manifest.bytes = total;
  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 1)}\n`);
  log(`total ${(total / 1048576).toFixed(2)} MB in ${outDir}`);
  if (props && !only) {
    const { buildPalmProps } = await import('./palm-prop.mjs');
    await buildPalmProps({ treesDir: outDir, propsDir, log });
  }
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
  await buildTrees({ outDir: flag('--out') ? path.resolve(flag('--out')) : undefined, only: flag('--only') ? flag('--only').split(',') : null, paint: flag('--paint') ? path.resolve(flag('--paint')) : null, preview: flag('--preview') ? path.resolve(flag('--preview')) : null, props: !args.includes('--no-props'), log: console.log });
}
