// The art stream's prop models (public/arcade/props/*.glb, listed in manifest.json): every
// file the manifest names is there, parses, and is what the manifest and the renderer
// (public/render/props.js: Y up, front +Z, base on the ground) expect of it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectGlb, bakeModel, readGlb } from '../tools/arcade-art/bake.mjs';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'arcade', 'props');
const manifestFile = path.join(DIR, 'manifest.json');
const manifest = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : { kinds: {} };
// placed many times on a stage: small and light
const REPEATED = ['crowd', 'floodlight', 'flag-banner', 'tiki', 'torii', 'hut', 'boat', 'rock-spire', 'torch', 'pine', 'cactus', 'stone-lantern', 'sakura-tree', 'crystal', 'snowman', 'lava-rock', 'ice-spire'];

test('the prop manifest lists files that exist, under safe names', () => {
  const kinds = Object.entries(manifest.kinds);
  assert.ok(kinds.length >= 30, `only ${kinds.length} kinds in the manifest`);
  for (const [kind, e] of kinds) {
    assert.match(kind, /^[a-z0-9][a-z0-9_-]{0,63}$/, kind);
    assert.match(e.file, /^[a-z0-9][a-z0-9._-]*\.glb$/, `${kind}: ${e.file}`);
    assert.ok(fs.existsSync(path.join(DIR, e.file)), `${kind}: ${e.file} is missing`);
    assert.ok(e.heightM > 0, `${kind}: heightM`);
  }
});

for (const [kind, e] of Object.entries(manifest.kinds)) {
  test(`prop model ${kind}: parses, within budget, upright on its base`, () => {
    const s = inspectGlb(path.join(DIR, e.file));
    const light = REPEATED.includes(kind);
    assert.equal(s.tris, e.tris, 'triangle count as the manifest says');
    assert.ok(s.tris <= (light ? 3100 : 20000), `${s.tris} triangles`);
    assert.ok(s.bytes < (light ? 300 : 1500) * 1024, `${Math.round(s.bytes / 1024)} KB`);
    assert.ok(s.materials <= 2 && s.primitives <= 2, `${s.materials} materials, ${s.primitives} primitives`);
    assert.ok(s.textures <= 1, 'one texture at most');
    assert.deepEqual(s.extensions, [], 'no glTF extensions needed');
    // the ground plane is y = 0: a skirt below it, never the whole model above or far below
    assert.ok(s.box.min[1] <= 0.01 && s.box.min[1] >= -2, `base at y = ${s.box.min[1].toFixed(2)}`);
    assert.ok(Math.abs(s.box.max[1] - e.heightM) < 0.02, 'heightM is the height above the ground');
    // roughly centred on its origin in plan
    assert.ok(Math.abs(s.box.min[0] + s.box.max[0]) / 2 < 0.2 * s.size[0], 'centred in x');
    assert.ok(Math.abs(s.box.min[2] + s.box.max[2]) / 2 < 0.2 * s.size[2], 'centred in z');
    // faces wind the way their normals point: a mirrored model reads near 0
    assert.ok(s.windingOk > 0.97, `winding agrees with normals on ${(s.windingOk * 100).toFixed(1)} %`);
  });
}

test('bake: colour UV sets become one palette texture and at most a base and a glow primitive', () => {
  const tri = (rgb, glow, z) => ({ pos: [[0, 0, z], [1, 0, z], [0, 1, z]], nrm: [[0, 0, 1], [0, 0, 1], [0, 0, 1]], rgb, glow });
  const baked = bakeModel('probe', [tri(0xff0000, false, 0), tri(0x00ff00, false, 1), tri(0xffee88, true, 2)]);
  assert.equal(baked.tris, 3);
  assert.equal(baked.colours, 3);
  assert.equal(baked.glow, true);
  const tmp = path.join(fs.mkdtempSync(path.join(process.env.TEMP || process.env.TMPDIR || '.', 'art-')), 'probe.glb');
  fs.writeFileSync(tmp, baked.glb);
  const g = readGlb(tmp), s = inspectGlb(tmp);
  assert.deepEqual(g.json.materials.map((m) => m.name), ['base', 'glow']);
  assert.ok(g.json.materials[1].emissiveTexture, 'the glow material carries the palette as its emissive texture');
  assert.equal(s.primitives, 2);
  assert.equal(s.windingOk, 1);
  fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
});
