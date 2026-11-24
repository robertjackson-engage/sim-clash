// Arcade prop models: make an image-to-3D GLB (Meshy: one textured mesh, a multi-megabyte
// JPEG atlas, unit-cube sized, origin at its centre) game-ready:
//
//   - the texture atlas resized to 1024 px (sharp) and re-encoded as JPEG;
//   - turned about +Y so its FRONT faces +Z, scaled to a height in metres, set down with
//     its base at y = 0 (minus --sink metres, so its own rock base buries a little) and
//     centred in x and z;
//   - 16-bit indices and UVs where they fit, material matte (roughness 0.85, no metal).
//
//   node tools/arcade-art/fit-glb.mjs <in.glb> <out.glb> --height 16 [--yaw 90] [--sink 0.3]
//        [--tex 1024] [--quality 84] [--manifest kind]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readGlb, readAccessor, inspectGlb } from './bake.mjs';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
const pad4 = (b, fill = 0) => (b.length % 4 ? Buffer.concat([b, Buffer.alloc(4 - (b.length % 4), fill)]) : b);
const argv = process.argv.slice(2);
const opt = (k, d = null) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const [src, dst] = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')));
if (!src || !dst) { console.error('usage: fit-glb.mjs <in.glb> <out.glb> --height H [--yaw deg] [--sink m] [--tex px]'); process.exit(1); }
const height = Number(opt('--height', 10)), yaw = Number(opt('--yaw', 0)) * Math.PI / 180, sink = Number(opt('--sink', 0));
const texPx = Number(opt('--tex', 1024)), quality = Number(opt('--quality', 84));

const g = readGlb(src);
const prim = g.json.meshes[0].primitives[0];
if (g.json.meshes.length !== 1 || g.json.meshes[0].primitives.length !== 1) console.warn('more than one primitive: only the first is kept');
const P = readAccessor(g, prim.attributes.POSITION).data, N = readAccessor(g, prim.attributes.NORMAL).data;
const U = readAccessor(g, prim.attributes.TEXCOORD_0).data, X = readAccessor(g, prim.indices).data;
const count = P.length / 3, cs = Math.cos(yaw), sn = Math.sin(yaw);
const pos = new Float32Array(P.length), nrm = new Float32Array(N.length);
const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < count; i++) {
  const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
  pos[i * 3] = x * cs + z * sn; pos[i * 3 + 1] = y; pos[i * 3 + 2] = -x * sn + z * cs;
  nrm[i * 3] = N[i * 3] * cs + N[i * 3 + 2] * sn; nrm[i * 3 + 1] = N[i * 3 + 1]; nrm[i * 3 + 2] = -N[i * 3] * sn + N[i * 3 + 2] * cs;
  for (let c = 0; c < 3; c++) { mn[c] = Math.min(mn[c], pos[i * 3 + c]); mx[c] = Math.max(mx[c], pos[i * 3 + c]); }
}
const k = height / (mx[1] - mn[1]), cx = (mn[0] + mx[0]) / 2, cz = (mn[2] + mx[2]) / 2;
const bmin = [Infinity, Infinity, Infinity], bmax = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < count; i++) {
  pos[i * 3] = (pos[i * 3] - cx) * k; pos[i * 3 + 1] = (pos[i * 3 + 1] - mn[1]) * k - sink; pos[i * 3 + 2] = (pos[i * 3 + 2] - cz) * k;
  for (let c = 0; c < 3; c++) { bmin[c] = Math.min(bmin[c], pos[i * 3 + c]); bmax[c] = Math.max(bmax[c], pos[i * 3 + c]); }
}
let uvOk = true;
for (let i = 0; i < U.length; i++) if (U[i] < 0 || U[i] > 1) { uvOk = false; break; }
const uv = uvOk ? Uint16Array.from(U, (v) => Math.round(v * 65535)) : Float32Array.from(U);
const idx = count > 65535 ? Uint32Array.from(X) : Uint16Array.from(X);

const mat = g.json.materials[prim.material ?? 0];
const texIndex = mat.pbrMetallicRoughness.baseColorTexture.index;
const img = g.json.images[g.json.textures[texIndex].source];
const bv = g.json.bufferViews[img.bufferView];
const raw = Buffer.from(g.bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength));
const meta = await sharp(raw).metadata();
const image = await sharp(raw).resize(texPx, texPx, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality, mozjpeg: true }).toBuffer();

const chunks = []; let offset = 0; const bufferViews = [];
const view = (buf, target) => { const b = pad4(buf); bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: buf.length, ...(target ? { target } : {}) }); chunks.push(b); offset += b.length; return bufferViews.length - 1; };
const name = path.basename(dst, '.glb');
const json = {
  asset: { version: '2.0', generator: 'open-birdie tools/arcade-art/fit-glb.mjs (image-to-3D source)' },
  scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name, mesh: 0 }],
  meshes: [{ name, primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, material: 0, mode: 4 }] }],
  materials: [{ name: 'base', pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 0.85 }, doubleSided: false }],
  textures: [{ sampler: 0, source: 0 }], samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }],
  images: [{ bufferView: 4, mimeType: 'image/jpeg', name: `${name}-atlas` }],
  accessors: [
    { bufferView: view(Buffer.from(pos.buffer), 34962), componentType: 5126, count, type: 'VEC3', min: bmin.map(Math.fround), max: bmax.map(Math.fround) },
    { bufferView: view(Buffer.from(nrm.buffer), 34962), componentType: 5126, count, type: 'VEC3' },
    { bufferView: view(Buffer.from(uv.buffer), 34962), componentType: uvOk ? 5123 : 5126, ...(uvOk ? { normalized: true } : {}), count, type: 'VEC2' },
    { bufferView: view(Buffer.from(idx.buffer), 34963), componentType: count > 65535 ? 5125 : 5123, count: idx.length, type: 'SCALAR' },
  ],
};
view(image);
json.bufferViews = bufferViews; json.buffers = [{ byteLength: offset }];
const jb = pad4(Buffer.from(JSON.stringify(json), 'utf8'), 0x20), bb = Buffer.concat(chunks);
const head = Buffer.alloc(12); head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + jb.length + 8 + bb.length, 8);
const jh = Buffer.alloc(8); jh.writeUInt32LE(jb.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
const bh = Buffer.alloc(8); bh.writeUInt32LE(bb.length, 0); bh.writeUInt32LE(0x004e4942, 4);
fs.mkdirSync(path.dirname(path.resolve(dst)), { recursive: true });
fs.writeFileSync(dst, Buffer.concat([head, jh, jb, bh, bb]));
const s = inspectGlb(dst);
const r2 = (v) => Math.round(v * 100) / 100;
console.log({ out: dst, tris: s.tris, KB: Math.round(s.bytes / 1024), texture: `${meta.width}x${meta.height} -> ${texPx}px jpeg ${Math.round(image.length / 1024)} KB`, size: s.size.map(r2), minY: r2(s.box.min[1]), winding: r2(s.windingOk) });
const kind = opt('--manifest');
if (kind) {
  const mf = path.join(path.dirname(path.resolve(dst)), 'manifest.json');
  const man = fs.existsSync(mf) ? JSON.parse(fs.readFileSync(mf, 'utf8')) : { kinds: {} };
  man.kinds[kind] = { file: path.basename(dst), tris: s.tris, heightM: r2(s.box.max[1]), widthM: r2(s.size[0]), depthM: r2(s.size[2]), skirtM: r2(Math.max(0, -s.box.min[1])), bytes: s.bytes, glow: false, source: 'image-to-3d' };
  man.kinds = Object.fromEntries(Object.entries(man.kinds).sort(([a], [b]) => a.localeCompare(b)));
  fs.writeFileSync(mf, JSON.stringify(man, null, 2) + '\n');
}
