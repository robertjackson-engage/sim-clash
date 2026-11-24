// Arcade prop models: scene GLB -> one small game-ready GLB per prop kind.
//
// The models are built in a hosted Blender (Higgsfield "3D Jutsu", Python `bpy`); its
// export is ONE scene GLB with one node per prop kind. A model there carries no material
// and no vertex colour: every face's colour rides in two UV sets, which every glTF
// exporter writes whatever its settings,
//
//   TEXCOORD_0 = (red, green)      TEXCOORD_1 = (blue, glow 0 | 1)       (sRGB, 0..1)
//
// This tool splits that scene by node and bakes each model down to what the game's
// PropsLayer (public/render/props.js) draws cheaply:
//
//   - ONE small palette texture (4 px cells, nearest filter) instead of vertex colours,
//     so the arcade look's "own colour given back as glow" (emissiveMap = map) works;
//   - at most TWO primitives / materials: `base` (matte) and `glow` (the same palette as
//     its emissive texture: lamps, screens, lava, neon), both double sided;
//   - welded vertices, 16-bit UVs, 16-bit indices where they fit;
//   - Y up, front to +Z, origin at the centre of the base (the node's translation in the
//     scene, a grid slot, is dropped).
//
//   node tools/arcade-art/bake.mjs <scene.glb> [--out public/arcade/props] [--only a,b]
//        [--skip zz-test] [--manifest] [--heights kind=h,kind=h]
//   node tools/arcade-art/bake.mjs --verify [--out public/arcade/props]
//
// --manifest merges the baked kinds into <out>/manifest.json. --verify re-reads every
// GLB the manifest lists and prints what is really in the file.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CELL = 4;   // palette cell, px

// ---------------------------------------------------------------- GLB in
export function readGlb(file) {
  const b = fs.readFileSync(file);
  if (b.readUInt32LE(0) !== 0x46546c67) throw new Error(`${file}: not a GLB`);
  let off = 12, json = null, bin = null;
  while (off < b.length) {
    const len = b.readUInt32LE(off), type = b.readUInt32LE(off + 4);
    const chunk = b.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(chunk.toString('utf8'));
    else if (type === 0x004e4942) bin = chunk;
    off += 8 + len;
  }
  return { json, bin, bytes: b.length };
}

const COMP = { 5120: [Int8Array, 1], 5121: [Uint8Array, 1], 5122: [Int16Array, 2], 5123: [Uint16Array, 2], 5125: [Uint32Array, 4], 5126: [Float32Array, 4] };
const NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const NORM = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 };

// An accessor as a plain Float64Array (normalized integers scaled to 0..1 / -1..1).
export function readAccessor(g, index) {
  const a = g.json.accessors[index], n = NCOMP[a.type];
  const out = new Float64Array(a.count * n);
  if (a.bufferView == null) return { data: out, n, count: a.count };
  const bv = g.json.bufferViews[a.bufferView];
  const [, size] = COMP[a.componentType];
  const stride = bv.byteStride || size * n;
  const base = g.bin.byteOffset + (bv.byteOffset || 0) + (a.byteOffset || 0);
  const dv = new DataView(g.bin.buffer, base);
  const rd = { 5120: 'getInt8', 5121: 'getUint8', 5122: 'getInt16', 5123: 'getUint16', 5125: 'getUint32', 5126: 'getFloat32' }[a.componentType];
  const k = a.normalized ? 1 / NORM[a.componentType] : 1;
  for (let i = 0; i < a.count; i++) for (let c = 0; c < n; c++) out[i * n + c] = dv[rd](i * stride + c * size, true) * k;
  return { data: out, n, count: a.count };
}

function quatRotate(q, v) {
  const [x, y, z, w] = q, [vx, vy, vz] = v;
  const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx);
  return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
}

// Every triangle of a node's mesh (rotation and scale applied, translation dropped):
// { pos: [x,y,z]*3, nrm: [..]*3, rgb: 0xRRGGBB, glow: bool }
function nodeTriangles(g, node) {
  const mesh = g.json.meshes[node.mesh];
  const q = node.rotation || [0, 0, 0, 1], s = node.scale || [1, 1, 1];
  const tris = [];
  for (const prim of mesh.primitives) {
    if (prim.mode != null && prim.mode !== 4) continue;
    const A = prim.attributes;
    if (A.TEXCOORD_0 == null || A.TEXCOORD_1 == null) throw new Error(`${node.name}: a primitive without the two colour UV sets`);
    const P = readAccessor(g, A.POSITION).data, N = A.NORMAL != null ? readAccessor(g, A.NORMAL).data : null;
    const U0 = readAccessor(g, A.TEXCOORD_0).data, U1 = readAccessor(g, A.TEXCOORD_1).data;
    const idx = prim.indices != null ? readAccessor(g, prim.indices).data : Float64Array.from({ length: P.length / 3 }, (_, i) => i);
    const c8 = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));
    for (let t = 0; t + 2 < idx.length; t += 3) {
      const tri = { pos: [], nrm: [], rgb: 0, glow: false };
      for (let k = 0; k < 3; k++) {
        const i = idx[t + k];
        tri.pos.push(quatRotate(q, [P[i * 3] * s[0], P[i * 3 + 1] * s[1], P[i * 3 + 2] * s[2]]));
        tri.nrm.push(N ? quatRotate(q, [N[i * 3], N[i * 3 + 1], N[i * 3 + 2]]) : null);
      }
      const i0 = idx[t];
      // the exporter flips v: stored v = 1 - blender v
      tri.rgb = (c8(U0[i0 * 2]) << 16) | (c8(1 - U0[i0 * 2 + 1]) << 8) | c8(U1[i0 * 2]);
      tri.glow = 1 - U1[i0 * 2 + 1] > 0.5;
      // face normal: drop degenerate triangles, fill missing normals
      const [a, b, c] = tri.pos;
      const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const fn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const len = Math.hypot(...fn);
      if (len < 1e-9) continue;
      for (let k = 0; k < 3; k++) {
        const nn = tri.nrm[k];
        if (!nn || Math.hypot(...nn) < 1e-6) tri.nrm[k] = fn.map((v) => v / len);
      }
      tris.push(tri);
    }
  }
  return tris;
}

// ---------------------------------------------------------------- PNG out
function png(width, height, rgb) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  const chunk = (type, data) => {
    const head = Buffer.alloc(8); head.writeUInt32BE(data.length, 0); head.write(type, 4, 'ascii');
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const pow2 = (n) => { let p = 1; while (p < n) p *= 2; return p; };
const pad4 = (b, fill = 0) => (b.length % 4 ? Buffer.concat([b, Buffer.alloc(4 - (b.length % 4), fill)]) : b);

// ---------------------------------------------------------------- bake one model
export function bakeModel(name, tris) {
  // palette
  const colours = [...new Set(tris.map((t) => t.rgb))].sort((a, b) => a - b);
  const cols = pow2(Math.ceil(Math.sqrt(colours.length))), rows = pow2(Math.ceil(colours.length / cols));
  const slot = new Map(colours.map((c, i) => [c, i]));
  const W = cols * CELL, H = rows * CELL, px = Buffer.alloc(W * H * 3);
  colours.forEach((c, i) => {
    const cx = i % cols, cy = (i / cols) | 0;
    for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) {
      const o = ((cy * CELL + y) * W + cx * CELL + x) * 3;
      px[o] = c >> 16; px[o + 1] = (c >> 8) & 255; px[o + 2] = c & 255;
    }
  });
  const image = png(W, H, px);
  const uvOf = (rgb) => { const i = slot.get(rgb); return [Math.round(((i % cols) + 0.5) / cols * 65535), Math.round((((i / cols) | 0) + 0.5) / rows * 65535)]; };

  // weld, one vertex pool per primitive (base, glow)
  const groups = [{ glow: false, pos: [], nrm: [], uv: [], idx: [], map: new Map() }, { glow: true, pos: [], nrm: [], uv: [], idx: [], map: new Map() }];
  for (const t of tris) {
    const gr = groups[t.glow ? 1 : 0], uv = uvOf(t.rgb);
    for (let k = 0; k < 3; k++) {
      const p = t.pos[k], n = t.nrm[k];
      const key = `${Math.round(p[0] * 2000)},${Math.round(p[1] * 2000)},${Math.round(p[2] * 2000)},${Math.round(n[0] * 60)},${Math.round(n[1] * 60)},${Math.round(n[2] * 60)},${t.rgb}`;
      let i = gr.map.get(key);
      if (i == null) { i = gr.pos.length / 3; gr.map.set(key, i); gr.pos.push(...p); gr.nrm.push(...n); gr.uv.push(...uv); }
      gr.idx.push(i);
    }
  }

  // buffers
  const chunks = []; let offset = 0;
  const bufferViews = [], accessors = [], primitives = [];
  const view = (buf, target) => { const b = pad4(buf); bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: buf.length, ...(target ? { target } : {}) }); chunks.push(b); offset += b.length; return bufferViews.length - 1; };
  let nTris = 0; const box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  const used = groups.filter((g) => g.idx.length);
  for (const gr of used) {
    const count = gr.pos.length / 3;
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < gr.pos.length; i++) { const c = i % 3; mn[c] = Math.min(mn[c], gr.pos[i]); mx[c] = Math.max(mx[c], gr.pos[i]); }
    for (let c = 0; c < 3; c++) { mn[c] = Math.fround(mn[c]); mx[c] = Math.fround(mx[c]); box.min[c] = Math.min(box.min[c], mn[c]); box.max[c] = Math.max(box.max[c], mx[c]); }
    const P = view(Buffer.from(new Float32Array(gr.pos).buffer), 34962);
    accessors.push({ bufferView: P, componentType: 5126, count, type: 'VEC3', min: mn, max: mx });
    const N = view(Buffer.from(new Float32Array(gr.nrm).buffer), 34962);
    accessors.push({ bufferView: N, componentType: 5126, count, type: 'VEC3' });
    const U = view(Buffer.from(new Uint16Array(gr.uv).buffer), 34962);
    accessors.push({ bufferView: U, componentType: 5123, normalized: true, count, type: 'VEC2' });
    const big = count > 65535;
    const X = view(Buffer.from((big ? new Uint32Array(gr.idx) : new Uint16Array(gr.idx)).buffer), 34963);
    accessors.push({ bufferView: X, componentType: big ? 5125 : 5123, count: gr.idx.length, type: 'SCALAR' });
    const a0 = accessors.length - 4;
    primitives.push({ attributes: { POSITION: a0, NORMAL: a0 + 1, TEXCOORD_0: a0 + 2 }, indices: a0 + 3, material: gr.glow ? 1 : 0, mode: 4 });
    nTris += gr.idx.length / 3;
  }
  const imageView = view(image);
  const hasGlow = used.some((g) => g.glow), hasBase = used.some((g) => !g.glow);
  const baseMat = { name: 'base', pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 0.85 }, doubleSided: true };
  // glow: the palette colour comes from the emissive texture; the lit base is turned down
  // so daylight does not wash a screen or a lamp out to white
  const glowMat = { name: 'glow', pbrMetallicRoughness: { baseColorFactor: [0.22, 0.22, 0.22, 1], baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 0.6 }, emissiveTexture: { index: 0 }, emissiveFactor: [1, 1, 1], doubleSided: true };
  // material indices must be dense: a model that is all glow (or has none) keeps one material
  const materials = [];
  if (hasBase) materials.push(baseMat);
  if (hasGlow) materials.push(glowMat);
  for (const p of primitives) p.material = p.material === 1 ? materials.indexOf(glowMat) : 0;
  const json = {
    asset: { version: '2.0', generator: 'open-birdie tools/arcade-art/bake.mjs' },
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name, mesh: 0 }],
    meshes: [{ name, primitives }], materials,
    textures: [{ sampler: 0, source: 0 }], samplers: [{ magFilter: 9728, minFilter: 9728, wrapS: 33071, wrapT: 33071 }],
    images: [{ bufferView: imageView, mimeType: 'image/png', name: `${name}-palette` }],
    accessors, bufferViews, buffers: [{ byteLength: offset }],
  };
  const jb = pad4(Buffer.from(JSON.stringify(json), 'utf8'), 0x20), bb = Buffer.concat(chunks);
  const head = Buffer.alloc(12); head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + jb.length + 8 + bb.length, 8);
  const jh = Buffer.alloc(8); jh.writeUInt32LE(jb.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8); bh.writeUInt32LE(bb.length, 0); bh.writeUInt32LE(0x004e4942, 4);
  return { glb: Buffer.concat([head, jh, jb, bh, bb]), tris: nTris, box, colours: colours.length, glow: hasGlow };
}

// ---------------------------------------------------------------- verify (reads the file back)
export function inspectGlb(file) {
  const g = readGlb(file);
  let tris = 0, agree = 0, total = 0;
  const box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (const mesh of g.json.meshes || []) for (const prim of mesh.primitives) {
    const P = readAccessor(g, prim.attributes.POSITION).data;
    const N = prim.attributes.NORMAL != null ? readAccessor(g, prim.attributes.NORMAL).data : null;
    const idx = prim.indices != null ? readAccessor(g, prim.indices).data : Float64Array.from({ length: P.length / 3 }, (_, i) => i);
    tris += idx.length / 3;
    for (let i = 0; i < P.length; i++) { const c = i % 3; box.min[c] = Math.min(box.min[c], P[i]); box.max[c] = Math.max(box.max[c], P[i]); }
    if (N) for (let t = 0; t + 2 < idx.length; t += 3) {
      const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]];
      const e1 = [P[b * 3] - P[a * 3], P[b * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] - P[a * 3 + 2]], e2 = [P[c * 3] - P[a * 3], P[c * 3 + 1] - P[a * 3 + 1], P[c * 3 + 2] - P[a * 3 + 2]];
      const fn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const d = fn[0] * (N[a * 3] + N[b * 3] + N[c * 3]) + fn[1] * (N[a * 3 + 1] + N[b * 3 + 1] + N[c * 3 + 1]) + fn[2] * (N[a * 3 + 2] + N[b * 3 + 2] + N[c * 3 + 2]);
      total++; if (d > 0) agree++;
    }
  }
  const tex = (g.json.images || []).length;
  return {
    bytes: g.bytes, tris, meshes: (g.json.meshes || []).length, primitives: (g.json.meshes || []).reduce((n, m) => n + m.primitives.length, 0),
    materials: (g.json.materials || []).length, textures: tex, box,
    size: box.max.map((v, i) => v - box.min[i]),
    // winding agrees with the stored normals (a mirrored model reads near 0)
    windingOk: total ? agree / total : null,
    extensions: g.json.extensionsUsed || [],
  };
}

const r2 = (v) => Math.round(v * 100) / 100;

function main() {
  const argv = process.argv.slice(2);
  const opt = (k, d = null) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  const outDir = path.resolve(ROOT, opt('--out', 'public/arcade/props'));
  const manifestFile = path.join(outDir, 'manifest.json');
  const readManifest = () => (fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : { kinds: {} });

  if (argv.includes('--verify')) {
    const man = readManifest(); const rows = [];
    for (const [kind, e] of Object.entries(man.kinds || {})) {
      const f = path.join(outDir, e.file);
      if (!fs.existsSync(f)) { rows.push({ kind, error: 'missing file' }); continue; }
      const s = inspectGlb(f);
      rows.push({ kind, tris: s.tris, KB: Math.round(s.bytes / 1024), mats: s.materials, prims: s.primitives, tex: s.textures, w: r2(s.size[0]), h: r2(s.box.max[1]), d: r2(s.size[2]), minY: r2(s.box.min[1]), cx: r2((s.box.min[0] + s.box.max[0]) / 2), cz: r2((s.box.min[2] + s.box.max[2]) / 2), winding: s.windingOk == null ? '-' : r2(s.windingOk), manifestTris: e.tris });
    }
    console.table(rows);
    return;
  }

  const src = argv.find((a) => !a.startsWith('--') && a.endsWith('.glb'));
  if (!src) { console.error('usage: bake.mjs <scene.glb> [--out dir] [--only a,b] [--skip a,b] [--manifest]'); process.exit(1); }
  const only = opt('--only') ? new Set(opt('--only').split(',')) : null;
  const skip = new Set((opt('--skip', 'zz-test')).split(','));
  const g = readGlb(src);
  if ((g.json.extensionsRequired || []).length) console.warn('scene uses required extensions:', g.json.extensionsRequired);
  fs.mkdirSync(outDir, { recursive: true });
  const man = readManifest(); man.kinds ||= {};
  const rows = [];
  for (const node of g.json.nodes || []) {
    if (node.mesh == null) continue;
    const name = String(node.name || '').replace(/\.\d+$/, '');
    if ((only && !only.has(name)) || skip.has(name)) continue;
    const tris = nodeTriangles(g, node);
    const baked = bakeModel(name, tris);
    const file = `${name}.glb`;
    fs.writeFileSync(path.join(outDir, file), baked.glb);
    const s = inspectGlb(path.join(outDir, file));
    const entry = {
      file, tris: s.tris, heightM: r2(s.box.max[1]), widthM: r2(s.size[0]), depthM: r2(s.size[2]),
      skirtM: r2(Math.max(0, -s.box.min[1])), bytes: s.bytes, glow: baked.glow, source: 'blender',
    };
    if (argv.includes('--manifest')) man.kinds[name] = entry;
    rows.push({ kind: name, tris: s.tris, KB: Math.round(s.bytes / 1024), mats: s.materials, colours: baked.colours, w: entry.widthM, h: entry.heightM, d: entry.depthM, minY: r2(s.box.min[1]), cx: r2((s.box.min[0] + s.box.max[0]) / 2), cz: r2((s.box.min[2] + s.box.max[2]) / 2), winding: r2(s.windingOk) });
  }
  if (argv.includes('--manifest')) {
    man.kinds = Object.fromEntries(Object.entries(man.kinds).sort(([a], [b]) => a.localeCompare(b)));
    fs.writeFileSync(manifestFile, JSON.stringify(man, null, 2) + '\n');
  }
  console.table(rows);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
