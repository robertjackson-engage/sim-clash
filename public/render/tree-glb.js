// The arcade trees' model files (public/arcade/trees/*.glb): a small, strict reader and
// writer for the one shape of GLB the tree build makes (tools/arcade-art/trees/build.mjs).
// Pure (no three, no DOM): the game reads the files with it (tree-models.js), the build
// writes them, and the tests open the shipped files with it in Node.
//
// A file holds one species. Each VARIANT of it is three meshes named `<variant>_LOD0`,
// `_LOD1`, `_LOD2` that share one set of vertex attributes and differ only in their index
// buffer (the far levels keep a prefix of the leaf cards and a simpler trunk):
//
//   POSITION    f32 x3   metres, y up, the trunk's foot at the origin
//   NORMAL      f32 x3   leaf cards carry a normal bent out of the crown (a soft volume)
//   TEXCOORD_0  f32 x2   leaves: the atlas; bark: (turns round the trunk, metres up it / 3)
//   COLOR_0     u8  x4   ao, branch sway, leaf flutter, kind (0 bark, 1 leaf)
//   _TINT       u8  x4   colour x 0.5 (so a card can be twice as bright as its tree), bark column / 8
//   _WIND       u8  x4   sway phase, LOD rank (a card is dropped when the tree's keep < rank),
//                        how much a kept card grows as its neighbours drop, snow it catches
//   _PIVOT      f32 x3   vertex minus the pivot of its leaf card (0 for bark): cards shrink
//                        into their pivot as they drop out
//
// Any glTF viewer opens the files (the custom attributes are ignored there).

const GLB_MAGIC = 0x46546c67, JSON_CHUNK = 0x4e4f534a, BIN_CHUNK = 0x004e4942;
export const TREE_ATTRIBUTES = Object.freeze({
  POSITION: { name: 'position', type: 'VEC3', comp: 5126, size: 3 },
  NORMAL: { name: 'normal', type: 'VEC3', comp: 5126, size: 3 },
  TEXCOORD_0: { name: 'uv', type: 'VEC2', comp: 5126, size: 2 },
  COLOR_0: { name: 'aData', type: 'VEC4', comp: 5121, size: 4, normalized: true },
  _TINT: { name: 'aTint', type: 'VEC4', comp: 5121, size: 4, normalized: true },
  _WIND: { name: 'aWind', type: 'VEC4', comp: 5121, size: 4, normalized: true },
  _PIVOT: { name: 'aPivot', type: 'VEC3', comp: 5126, size: 3 },
});
const ARRAY = { 5126: Float32Array, 5121: Uint8Array, 5123: Uint16Array, 5125: Uint32Array };

// models: [{ name, attributes: { position: Float32Array, ... (TREE_ATTRIBUTES names) }, lods: [Uint32Array x3], extras }]
// Returns a Uint8Array (the .glb).
export function writeTreeGlb(models, { generator = 'sim-clash tree build', extras = null } = {}) {
  const chunks = [];
  let offset = 0;
  const json = { asset: { version: '2.0', generator }, scene: 0, scenes: [{ nodes: [] }], nodes: [], meshes: [], accessors: [], bufferViews: [], buffers: [{ byteLength: 0 }] };
  if (extras) json.asset.extras = extras;
  const push = (typed, target) => {
    const bytes = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
    const pad = (4 - (bytes.length % 4)) % 4;
    json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, target });
    chunks.push(bytes);
    if (pad) chunks.push(new Uint8Array(pad));
    offset += bytes.length + pad;
    return json.bufferViews.length - 1;
  };
  for (const m of models) {
    const count = m.attributes.position.length / 3;
    const attrs = {};
    for (const [sem, d] of Object.entries(TREE_ATTRIBUTES)) {
      const data = m.attributes[d.name];
      if (!data || data.length !== count * d.size) throw new Error(`${m.name}: attribute ${d.name} has ${data ? data.length : 0} values, wants ${count * d.size}`);
      const acc = { bufferView: push(data, 34962), componentType: d.comp, count, type: d.type };
      if (d.normalized) acc.normalized = true;
      if (sem === 'POSITION') {
        const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
        for (let i = 0; i < data.length; i++) { const k = i % 3; if (data[i] < min[k]) min[k] = data[i]; if (data[i] > max[k]) max[k] = data[i]; }
        acc.min = min; acc.max = max;
      }
      json.accessors.push(acc);
      attrs[sem] = json.accessors.length - 1;
    }
    m.lods.forEach((index, lod) => {
      const small = count <= 65535;
      const typed = small ? Uint16Array.from(index) : Uint32Array.from(index);
      json.accessors.push({ bufferView: push(typed, 34963), componentType: small ? 5123 : 5125, count: typed.length, type: 'SCALAR' });
      json.meshes.push({ name: `${m.name}_LOD${lod}`, primitives: [{ attributes: attrs, indices: json.accessors.length - 1, mode: 4 }] });
      json.nodes.push({ name: `${m.name}_LOD${lod}`, mesh: json.meshes.length - 1, ...(lod === 0 && m.extras ? { extras: m.extras } : {}) });
      // only the full model is in the scene a viewer shows; the far levels are there by name
      if (lod === 0) json.scenes[0].nodes.push(json.nodes.length - 1);
    });
  }
  json.buffers[0].byteLength = offset;
  let text = JSON.stringify(json);
  while (text.length % 4) text += ' ';
  const jsonBytes = new TextEncoder().encode(text);
  const total = 12 + 8 + jsonBytes.length + 8 + offset;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, GLB_MAGIC, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, jsonBytes.length, true); dv.setUint32(16, JSON_CHUNK, true);
  out.set(jsonBytes, 20);
  let o = 20 + jsonBytes.length;
  dv.setUint32(o, offset, true); dv.setUint32(o + 4, BIN_CHUNK, true);
  o += 8;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

// buffer: ArrayBuffer | Uint8Array of a tree .glb. Returns
// { extras, models: [{ name, extras, attributes: { position, normal, uv, aData, aTint, aWind, aPivot }, lods: [index x3] }] }
// (typed arrays are copies aligned to their own type, safe to hand to the GPU).
export function readTreeGlb(buffer) {
  const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (dv.getUint32(0, true) !== GLB_MAGIC) throw new Error('not a GLB');
  let o = 12, json = null, bin = null;
  while (o < u8.length) {
    const len = dv.getUint32(o, true), type = dv.getUint32(o + 4, true);
    if (type === JSON_CHUNK) json = JSON.parse(new TextDecoder().decode(u8.subarray(o + 8, o + 8 + len)));
    else if (type === BIN_CHUNK) bin = u8.subarray(o + 8, o + 8 + len);
    o += 8 + len;
  }
  if (!json || !bin) throw new Error('GLB without a JSON or a BIN chunk');
  const SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
  const cache = new Map();
  const accessor = (i) => {
    if (cache.has(i)) return cache.get(i);
    const a = json.accessors[i], bv = json.bufferViews[a.bufferView], T = ARRAY[a.componentType];
    const n = a.count * SIZE[a.type], start = bin.byteOffset + (bv.byteOffset || 0) + (a.byteOffset || 0);
    const out = new T(n);
    new Uint8Array(out.buffer).set(new Uint8Array(bin.buffer, start, n * T.BYTES_PER_ELEMENT));
    cache.set(i, out);
    return out;
  };
  const byName = new Map();
  for (const node of json.nodes || []) {
    const m = /^(.*)_LOD([0-2])$/.exec(node.name || '');
    if (!m || node.mesh == null) continue;
    const prim = json.meshes[node.mesh].primitives[0];
    let model = byName.get(m[1]);
    if (!model) {
      model = { name: m[1], extras: null, attributes: {}, lods: [] };
      for (const [sem, d] of Object.entries(TREE_ATTRIBUTES)) model.attributes[d.name] = accessor(prim.attributes[sem]);
      byName.set(m[1], model);
    }
    if (node.extras) model.extras = node.extras;
    model.lods[+m[2]] = accessor(prim.indices);
  }
  return { extras: json.asset?.extras || null, models: [...byName.values()] };
}
