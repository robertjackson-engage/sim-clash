// The `palm` PROP as a coconut palm from the tree generator.
//
// A stage's hole file places palms two ways: as trees (course.trees: the tree field draws
// them, tree-models.js) and as `palm` props (course.props: the props layer draws them,
// props.js). So that both are the same tree, this writes the generator's coconut palm as
// plain glTF the props layer can instance, and lists it in the props manifest:
//
//   public/arcade/props/palm-a.glb, palm-b.glb, palm-c.glb    the coconut's three variants
//   public/arcade/props/manifest.json  kinds.palm = { file, variants, tris, heightM, ... }
//
// The props layer's conventions (props.js, test/arcade-art.test.mjs): Y up, the base on
// y = 0 (the bole runs a little below it, as a skirt), no glTF extension, at most two
// primitives and ONE texture. So each file carries one small atlas baked from the tree
// textures (left half the frond, right half the ringed bark, a period and a half of it so
// no triangle needs it to wrap), a bark primitive and a double-sided, alpha-masked frond
// primitive; the model's occlusion and per-leaf tints ride in COLOR_0. A prop palm does not
// sway and has one level of detail (it is ~850 triangles).
//
//   node tools/arcade-art/trees/palm-prop.mjs [--trees public/arcade/trees] [--props public/arcade/props]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { growTree, SPECIES } from './gen.mjs';
import { LEAF_TILES, LEAF_GRID, BARK_COLUMNS, TILE, BARK_W, BARK_H } from './textures.mjs';
import { TREE_WORLDS, treeGrade, leafPaint } from '../../../public/render/tree-species.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const PALM_PROP_FILES = Object.freeze(['palm-a.glb', 'palm-b.glb', 'palm-c.glb']);
const AW = 512, AH = 512, HALF = 256;          // the atlas: frond | bark
const BARK_PERIODS = 1.5, INSET = 2.5 / HALF;   // the bark half holds this many repeats; UVs keep this far off a half's edge
const V_GAIN = 0.85;                            // vertex colours are stored x this (a tint may be brighter than 1), the texture / this

const toLin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toSrgb = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// the atlas a palm prop is drawn with: RGBA, AW x AH
async function palmAtlas(sharp, treesDir, manifest) {
  const T = manifest.textures, mid = manifest.detailMid || 0.4;
  const raw = async (file, w, h, region) => (await sharp(path.join(treesDir, file)).removeAlpha().extract(region).resize(w, h, { fit: 'fill', kernel: 'lanczos3' }).raw().toBuffer());
  const ti = LEAF_TILES.indexOf('frond'), tx = (ti % LEAF_GRID[0]) * TILE, ty = Math.floor(ti / LEAF_GRID[0]) * TILE, M = 14;
  const region = { left: tx + M, top: ty + M, width: TILE - 2 * M, height: TILE - 2 * M };
  const col = await raw(T.leaves.file, HALF, AH, region), aux = await raw(T.leavesAux.file, HALF, AH, region);
  const bi = BARK_COLUMNS.indexOf('ringed'), per = Math.round(AH / BARK_PERIODS);
  const bark = await raw(T.bark.file, HALF, per, { left: bi * BARK_W, top: 0, width: BARK_W, height: BARK_H });
  // the coconut's leaf colour as the tree field draws it in the tropical world, lit side of the ramp
  const row = TREE_WORLDS.tropical.trees.find((t) => t.species === 'coconut');
  const leaf = leafPaint(row.leaf), { lo, hi } = treeGrade(null);
  const out = Buffer.alloc(AW * AH * 4);
  for (let y = 0; y < AH; y++) for (let x = 0; x < HALF; x++) {
    const i = (y * HALF + x) * 3, o = (y * AW + x) * 4;
    const d = [toLin(col[i] / 255) / mid, toLin(col[i + 1] / 255) / mid, toLin(col[i + 2] / 255) / mid];
    const L = 0.2126 * d[0] + 0.7152 * d[1] + 0.0722 * d[2], k = smooth(0.06, 0.9, clamp01(L * 0.62));
    for (let c = 0; c < 3; c++) {
      const hue = 1 + (d[c] / Math.max(L, 0.08) - 1) * 0.9;
      out[o + c] = Math.round(255 * clamp01(toSrgb(leaf[c] * hue * (lo[c] + (hi[c] - lo[c]) * k) / V_GAIN)));
    }
    out[o + 3] = aux[i];
    // the bark half: the column, repeated down the atlas (row 0 is the top of the picture, v = BARK_PERIODS)
    const bo = (y * AW + HALF + x) * 4, by = ((y - (AH - per * Math.floor(AH / per)) % per) % per + per) % per, b = (by * HALF + x) * 3;
    for (let c = 0; c < 3; c++) out[bo + c] = Math.round(255 * clamp01(toSrgb(toLin(bark[b + c] / 255) / mid * 0.62 / V_GAIN)));
    out[bo + 3] = 255;
  }
  const png = await sharp(out, { raw: { width: AW, height: AH, channels: 4 } }).png({ compressionLevel: 9, palette: true, colours: 256, effort: 9, dither: 0.6 }).toBuffer();   // 256 colours: a fifth of the bytes, nothing a palm at ten metres shows
  if (!png.length) throw new Error('palm prop: the atlas did not encode');
  return png;
}

// One coconut variant -> a .glb (Uint8Array) and its numbers
function palmGlb(model, png, name) {
  const A = model.attributes, n = A.position.length / 3;
  const rect = (() => { const i = LEAF_TILES.indexOf('frond'), [GX, GY] = LEAF_GRID, c = i % GX, r = Math.floor(i / GX), pad = 14 / 512; return (u, v) => [((u * GX - c) - pad) / (1 - 2 * pad), (((1 - v) * GY - r) - pad) / (1 - 2 * pad)]; })();   // atlas uv -> (s across, t DOWN the tile)
  const prims = { bark: { pos: [], nrm: [], uv: [], col: [], idx: [] }, frond: { pos: [], nrm: [], uv: [], col: [], idx: [] } };
  const index = model.lods[0];
  for (let t = 0; t < index.length; t += 3) {
    const tri = [index[t], index[t + 1], index[t + 2]];
    const leafTri = A.aData[tri[0] * 4 + 3] >= 191;
    const P = leafTri ? prims.frond : prims.bark;
    // wind the triangle the way its normals point (the tree shader draws both sides and never asked)
    const p = tri.map((i) => [A.position[i * 3], A.position[i * 3 + 1], A.position[i * 3 + 2]]);
    const nr = tri.map((i) => { const v = [A.normal[i * 3], A.normal[i * 3 + 1], A.normal[i * 3 + 2]], l = Math.hypot(v[0], v[1], v[2]) || 1; return v.map((q) => q / l); });
    const e1 = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]], e2 = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
    const fn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const ns = [nr[0][0] + nr[1][0] + nr[2][0], nr[0][1] + nr[1][1] + nr[2][1], nr[0][2] + nr[1][2] + nr[2][2]];
    if (Math.hypot(fn[0], fn[1], fn[2]) < 1e-9) continue;   // a degenerate sliver
    const order = fn[0] * ns[0] + fn[1] * ns[1] + fn[2] * ns[2] >= 0 ? [0, 1, 2] : [0, 2, 1];
    // bark: unwrap the trunk's repeating v so this triangle sits inside the atlas's bark half
    const vBase = leafTri ? 0 : Math.floor(Math.min(...tri.map((i) => A.uv[i * 2 + 1])));
    for (const k of order) {
      const i = tri[k];
      P.pos.push(...p[k]); P.nrm.push(...nr[k]);
      const ao = A.aData[i * 4] / 255, tint = [A.aTint[i * 4] / 127.5, A.aTint[i * 4 + 1] / 127.5, A.aTint[i * 4 + 2] / 127.5];
      if (leafTri) {
        const [s, td] = rect(A.uv[i * 2], A.uv[i * 2 + 1]);
        P.uv.push((INSET + clamp01(s) * (1 - 2 * INSET)) * 0.5, clamp01(td));
        const shade = 0.42 + 0.58 * ao;
        P.col.push(...tint.map((c) => Math.round(255 * clamp01(c * shade * V_GAIN))), 255);
      } else {
        const u = A.uv[i * 2], f = u - Math.floor(u), tri01 = 1 - Math.abs(2 * f - 1);   // the column is mirrored round the trunk
        const v = Math.min(BARK_PERIODS, A.uv[i * 2 + 1] - vBase);
        P.uv.push(0.5 + (INSET + tri01 * (1 - 2 * INSET)) * 0.5, 1 - v / BARK_PERIODS);
        const shade = (0.5 + 0.5 * ao) * 0.8;   // (the props layer gives a model a little of its own colour back as glow)
        P.col.push(...tint.map((c) => Math.round(255 * clamp01(c * shade * V_GAIN))), 255);
      }
      P.idx.push(P.idx.length);
    }
  }
  // ---- the file
  const json = {
    asset: { version: '2.0', generator: 'sim-clash tree build (palm prop)' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name, mesh: 0 }],
    meshes: [{ name, primitives: [] }], accessors: [], bufferViews: [], buffers: [{ byteLength: 0 }],
    materials: [
      { name: 'bark', pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 0.92 } },
      { name: 'fronds', pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 0.8 }, alphaMode: 'MASK', alphaCutoff: 0.5, doubleSided: true },
    ],
    textures: [{ sampler: 0, source: 0 }], samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }], images: [{ mimeType: 'image/png', bufferView: 0 }],
  };
  const chunks = [];
  let offset = 0;
  const push = (bytes, target) => { const pad = (4 - (bytes.length % 4)) % 4; json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, ...(target ? { target } : {}) }); chunks.push(bytes); if (pad) chunks.push(new Uint8Array(pad)); offset += bytes.length + pad; return json.bufferViews.length - 1; };
  const u8 = (typed) => new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
  push(new Uint8Array(png));
  let tris = 0;
  const box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (const [mi, P] of [prims.bark, prims.frond].entries()) {
    const count = P.pos.length / 3, pos = Float32Array.from(P.pos);
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < pos.length; i++) { const k = i % 3; if (pos[i] < min[k]) min[k] = pos[i]; if (pos[i] > max[k]) max[k] = pos[i]; }
    for (let k = 0; k < 3; k++) { box.min[k] = Math.min(box.min[k], min[k]); box.max[k] = Math.max(box.max[k], max[k]); }
    const acc = (typed, type, comp, extra = {}) => { json.accessors.push({ bufferView: push(u8(typed), type === 'SCALAR' ? 34963 : 34962), componentType: comp, count: type === 'SCALAR' ? typed.length : count, type, ...extra }); return json.accessors.length - 1; };
    json.meshes[0].primitives.push({
      attributes: { POSITION: acc(pos, 'VEC3', 5126, { min, max }), NORMAL: acc(Float32Array.from(P.nrm), 'VEC3', 5126), TEXCOORD_0: acc(Float32Array.from(P.uv), 'VEC2', 5126), COLOR_0: acc(Uint8Array.from(P.col), 'VEC4', 5121, { normalized: true }) },
      indices: acc(Uint16Array.from(P.idx), 'SCALAR', 5123), material: mi, mode: 4,
    });
    tris += P.idx.length / 3;
  }
  json.buffers[0].byteLength = offset;
  let text = JSON.stringify(json);
  while (text.length % 4) text += ' ';
  const jb = new TextEncoder().encode(text), total = 12 + 8 + jb.length + 8 + offset;
  const out = new Uint8Array(total), dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, jb.length, true); dv.setUint32(16, 0x4e4f534a, true);
  out.set(jb, 20);
  let o = 20 + jb.length;
  dv.setUint32(o, offset, true); dv.setUint32(o + 4, 0x004e4942, true);
  o += 8;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return { glb: out, tris, box };
}

export async function buildPalmProps({ treesDir = path.join(ROOT, 'public', 'arcade', 'trees'), propsDir = path.join(ROOT, 'public', 'arcade', 'props'), log = () => {} } = {}) {
  const sharp = createRequire(import.meta.url)('sharp');
  const manifest = JSON.parse(fs.readFileSync(path.join(treesDir, 'manifest.json'), 'utf8'));
  if (!manifest.textures?.leaves || !manifest.textures?.leavesAux || !manifest.textures?.bark) { log('palm prop: no tree textures yet, skipped'); return null; }
  const png = await palmAtlas(sharp, treesDir, manifest);
  const r2 = (v) => Math.round(v * 100) / 100;
  // the least-leaning variant first: it is the kind's own file (the props test wants that one centred on its base)
  const made = SPECIES.coconut.variants.map((_, v) => palmGlb(growTree('coconut', v), png, `palm-${v}`));
  const lean = (m) => Math.hypot(m.box.min[0] + m.box.max[0], m.box.min[2] + m.box.max[2]);
  made.sort((a, b) => lean(a) - lean(b));
  made.forEach((m, i) => { fs.writeFileSync(path.join(propsDir, PALM_PROP_FILES[i]), m.glb); log(`${PALM_PROP_FILES[i]}  ${m.tris} tris  ${(m.glb.length / 1024).toFixed(0)} KB  ${r2(m.box.max[1])} m tall`); });
  // the props manifest: read as late as possible, only the `palm` row is touched
  const file = path.join(propsDir, 'manifest.json');
  const text = fs.readFileSync(file, 'utf8'), crlf = text.includes('\r\n');
  const props = JSON.parse(text), m0 = made[0];
  const row = { file: PALM_PROP_FILES[0], tris: m0.tris, heightM: r2(m0.box.max[1]), widthM: r2(m0.box.max[0] - m0.box.min[0]), depthM: r2(m0.box.max[2] - m0.box.min[2]), skirtM: r2(-m0.box.min[1]), bytes: m0.glb.length, glow: false, source: 'tools/arcade-art/trees (the tree generator\'s coconut palm)', variants: [...PALM_PROP_FILES] };
  const kinds = { ...props.kinds, palm: row };
  props.kinds = Object.fromEntries(Object.keys(kinds).sort().map((k) => [k, kinds[k]]));
  const outText = `${JSON.stringify(props, null, 2)}\n`;
  fs.writeFileSync(file, crlf ? outText.replace(/\n/g, '\r\n') : outText);
  return row;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
  const row = await buildPalmProps({ treesDir: flag('--trees') ? path.resolve(flag('--trees')) : undefined, propsDir: flag('--props') ? path.resolve(flag('--props')) : undefined, log: console.log });
  console.log(JSON.stringify(row));
}
