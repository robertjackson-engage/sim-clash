// The frame-cost cuts made for the sim PC's integrated GPU (docs/machines.md): the HD
// ground in tiles, the quality scale on the ground's detail rings, the links tufts in
// culled cells, the grade inside the OutputPass, and what the Low preset leaves out.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildHdTerrainLod, updateTerrainLod } from '../public/render/hd-terrain.js';
import { buildGrass } from '../public/render/grass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { gradeInto, guardBloom, guardOutput, guardInto, FINITE_GLSL, FINITE_GLSL_ES1, SCENE_MAX } from '../public/render/postfx.js';
import { QUALITY_PRESETS } from '../public/render/quality.js';

const flat = (nx, ny, cellM = 1, minX = 0, minY = 0) => ({ minX, minY, cellM, nx, ny, heights: new Float32Array(nx * ny) });
const entries = (root) => { const out = []; root.traverse((o) => { if (o.userData?.lod) out.push(o.userData.lod); }); return out; };
const cam = (x, y, h = 2) => { const c = new THREE.PerspectiveCamera(); c.position.set(x, h, -y); return c; };

test('an HD patch is built as tiles, each with its own levels of detail', () => {
  // 300 x 200 cells at 1 m -> 3 x 2 tiles of up to 128 cells
  const root = buildHdTerrainLod({ grid: flat(301, 201), material: new THREE.MeshBasicMaterial(), uvBounds: { minX: 0, minY: 0, maxX: 300, maxY: 200 } });
  const tiles = entries(root);
  assert.equal(tiles.length, 6);
  for (const L of tiles) {
    assert.equal(L.meshes.length, 3, '1 m, 2 m and 4 m');
    assert.deepEqual(L.far, [240, 600]);
    const t = L.meshes.map((m) => m.geometry.getIndex().count);
    assert.ok(t[0] > t[1] && t[1] > t[2], 'each level is coarser');
  }
  // the tiles cover the patch: their footprints span 0..300 x 0..200
  assert.equal(Math.min(...tiles.map((L) => L.minX)), 0);
  assert.equal(Math.max(...tiles.map((L) => L.maxX)), 300);
  assert.equal(Math.max(...tiles.map((L) => L.maxY)), 200);
});

test('standing on one end of a long HD patch leaves its far tiles coarse', () => {
  const root = buildHdTerrainLod({ grid: flat(801, 101), material: new THREE.MeshBasicMaterial(), uvBounds: { minX: 0, minY: 0, maxX: 800, maxY: 100 } });
  updateTerrainLod(root, cam(5, 50));
  const levels = entries(root).sort((a, b) => a.minX - b.minX).map((L) => L.level);
  assert.equal(levels[0], 0, 'the tile underfoot at full detail');
  assert.equal(levels.at(-1), 2, 'the tile 650 m off at the coarsest');
  assert.ok(levels.every((v, i) => i === 0 || v >= levels[i - 1]), 'detail only falls with distance');
});

test('the quality scale brings the detail rings in', () => {
  const root = buildHdTerrainLod({ grid: flat(129, 129), material: new THREE.MeshBasicMaterial(), uvBounds: { minX: 0, minY: 0, maxX: 128, maxY: 128 } });
  const [L] = entries(root);
  const c = cam(128 + 200, 64);    // 200 m off the tile's edge
  updateTerrainLod(root, c, 1);
  assert.equal(L.level, 0);       // inside the 240 m ring
  updateTerrainLod(root, c, 0.6);
  assert.equal(L.level, 1);       // past 0.6 x 240 = 144 m
  assert.equal(L.meshes.filter((m) => m.visible).length, 1, 'one level shows at a time');
  updateTerrainLod(root, c, Number.NaN);   // a bad scale falls back to 1
  assert.equal(L.level, 0);
});

test('Low leaves out bloom and draws trees, ground detail and tufts less far', () => {
  const H = QUALITY_PRESETS.high, L = QUALITY_PRESETS.low;
  assert.equal(L.bloom, false);
  assert.equal(H.bloom, true);
  assert.ok(L.treeMidM < H.treeMidM && L.treeMidM > L.treeNearM);
  assert.equal(H.terrainLodScale, 1);
  assert.ok(L.terrainLodScale > 0 && L.terrainLodScale < 1);
  assert.ok(L.grassDrawM < H.grassDrawM);
  // bunker meshes follow the ground more coarsely at Low (fewer triangles)
  assert.ok(H.patchDetailM > 0 && L.patchDetailM > H.patchDetailM);
});

test('fescue tufts in cells: the same blades, culled by distance', () => {
  const spots = [];
  for (let i = 0; i < 40; i++) spots.push({ x: (i % 20) * 30, y: Math.floor(i / 20) * 300, s: 1 });   // two rows 300 m apart
  const V = (x, y, z) => new THREE.Vector3(x, z, -y);
  const one = buildGrass(spots, () => 0, V, { perTuft: 4 });
  assert.ok(one.mesh.isInstancedMesh, 'without cellM: one mesh, as before');
  const cells = buildGrass(spots, () => 0, V, { perTuft: 4, cellM: 120 });
  assert.ok(cells.mesh.isGroup);
  const meshes = cells.mesh.children;
  assert.ok(meshes.length > 2);
  assert.equal(meshes.reduce((n, m) => n + m.count, 0), spots.length * 4, 'every blade is kept');
  assert.ok(meshes.every((m) => m.boundingSphere && m.boundingSphere.radius > 0), 'each cell has its own bounds to be culled by');
  cells.cull(cam(0, 0, 2), 150);
  const shown = meshes.filter((m) => m.visible);
  assert.ok(shown.length > 0 && shown.length < meshes.length);
  for (const m of shown) assert.ok(m.boundingSphere.center.distanceTo(new THREE.Vector3(0, 2, 0)) - m.boundingSphere.radius < 150);
  cells.cull(cam(0, 0, 2), Infinity);
  assert.ok(meshes.every((m) => m.visible));
});

test('the grade runs at the end of the OutputPass, after the sRGB encode', () => {
  const pass = gradeInto(new OutputPass());
  const fs = pass.material.fragmentShader;
  for (const u of ['uContrast', 'uSaturation', 'uVignette']) assert.ok(pass.material.uniforms[u], u);
  assert.equal(pass.uniforms, pass.material.uniforms, 'the pass and its material share uniforms');
  const enc = fs.indexOf('sRGBTransferOETF'), grade = fs.indexOf('* uContrast');
  assert.ok(enc > 0 && grade > enc, 'graded in display space');
  assert.ok(/uniform float uContrast, uSaturation, uVignette;/.test(fs));
  assert.equal(fs.trim().slice(-1), '}');
});

test('one bad pixel cannot black out the picture: every pass that reads the frame takes it through the NaN guard', () => {
  // the bloom's bright pass: the frame is sanitised the moment it is read, before the luminance and the blur
  const bloom = guardBloom(new UnrealBloomPass(new THREE.Vector2(64, 64), 0.1, 0.4, 1.6));
  const hp = bloom.materialHighPassFilter.fragmentShader;
  const read = hp.indexOf('vec4 texel = texture2D( tDiffuse, vUv );');
  assert.ok(read > 0, "three's bright pass still reads the frame the way the guard expects");
  assert.ok(hp.indexOf('texel.rgb = sceneFinite(texel.rgb);') > read && hp.indexOf('texel.rgb = sceneFinite(texel.rgb);') < hp.indexOf('luminance( texel.xyz )'), 'guarded before anything uses it');
  assert.ok(hp.indexOf('bool sceneBad(float x)') > 0 && hp.indexOf('bool sceneBad(float x)') < hp.indexOf('void main'), 'the helper is declared before main');
  // NaN and Inf are found by their bits (a comparison may be folded away), and the frame is clamped into a half float
  assert.match(FINITE_GLSL, /floatBitsToUint\(x\) & 0x7f800000u\) == 0x7f800000u/);
  assert.match(FINITE_GLSL, new RegExp(`clamp\\(c, vec3\\(0\\.0\\), vec3\\(${SCENE_MAX}\\.0\\)\\)`));
  assert.ok(SCENE_MAX > 16 && SCENE_MAX < 65504, 'above anything the scene draws, inside a half float');
  assert.ok(bloom.materialHighPassFilter.userData.unguarded.indexOf('sceneFinite') < 0, 'the stock text is kept for a NaN hunt');
  // the output pass: guarded before tone mapping; with the grade too. It is compiled as GLSL ES 1.00 (no bit casts): the clamp alone
  for (const pass of [guardOutput(new OutputPass()), gradeInto(guardOutput(new OutputPass()))]) {
    const fs = pass.material.fragmentShader;
    const at = fs.indexOf('gl_FragColor.rgb = sceneFinite(gl_FragColor.rgb);');
    assert.ok(at > fs.indexOf('gl_FragColor = texture2D( tDiffuse, vUv );') && at < fs.indexOf('// tone mapping'), 'guarded before tone mapping');
    assert.equal(pass.material.isRawShaderMaterial, true);
    assert.ok(fs.indexOf('floatBitsToUint') < 0 && fs.indexOf(FINITE_GLSL_ES1.trim()) > 0, 'no bit cast in a GLSL ES 1.00 shader');
    assert.equal(fs.trim().slice(-1), '}');
  }
  // a pass whose shader three has changed is refused, loudly
  assert.throws(() => guardInto({ name: 'Changed', fragmentShader: 'void main() { gl_FragColor = vec4(1.0); }', userData: {} }, 'vec4 texel = texture2D( tDiffuse, vUv );', 'texel'), /NaN guard has nowhere to go/);
});

test('Low antialiases with FXAA, High keeps SMAA', () => {
  assert.equal(QUALITY_PRESETS.low.aa, 'fxaa');
  assert.equal(QUALITY_PRESETS.high.aa, 'smaa');
});
