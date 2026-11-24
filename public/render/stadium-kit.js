// v3:stadium The stadium kit's layout: where the tiers, aisles, vomitories and seats of each
// stand model are, and how a straight stand module is bent into the wedge that closes a
// ring. Pure numbers (no three, no DOM): the renderer (props.js: the wedge in the vertex
// shader; crowd.js: the people in the seats), the hole files (tools/arcade-holes/lib.js
// standRing) and the tests all read the same tables, and the Blender sources of the models
// (tools/arcade-art/blender/models/stand-*.py) are built to them.
//
// A stand module is modelled STRAIGHT in its own frame: x across (-W/2 .. W/2), y up from
// the pitch, front edge on z = 0 facing +z, the tiers climbing away to -z. Two numbers place
// a point of it: u = x / W (-0.5 .. 0.5) and d = -z (metres behind the front edge).
//
// THE WEDGE. A copy standing in a ring is given
//
//   wedge = { w, tl, tr, sag, sagK }
//
// w: the length of its front chord (m); tl, tr: how far its left (u = -0.5) and right
// (u = +0.5) side lines run OUT per metre of depth (the tangent of each side's splay; 0, 0
// is a straight stand); sag, sagK: the front edge's bulge at mid chord (m, away from the
// pitch) and how it grows with depth (per m), so a section follows a curved terrace instead
// of cutting its corner. wedgePoint() is the whole deformation; the vertex shader in
// props.js is the same four lines. Two neighbours that share a side line (the same point and
// the same direction, each seen from its own frame with the same cosine) meet along it at
// every depth and height: that is what closes a ring without a gap (standRing in the hole
// tools makes them so; test/stadium-kit.test.mjs measures it).

export const FAN_SCALE = 1.16;          // spectators are drawn a little larger than life: they read from the tee
export const SEAT_PITCH_M = 0.62;       // seat to seat along a row

// u ranges are fractions of the module's width; rows count from the front of a tier.
// tier: { rows, d0 (front of the first tread), tread, y0 (the first tread), rise,
//         voms: [[u0, u1, row0, row1]] (no seats: a tunnel mouth), stand: true (no seats: a standing terrace) }
const AISLES_3 = [[-0.5, -0.474], [-0.026, 0.026], [0.474, 0.5]];
export const STANDS = Object.freeze({
  // the bowl section: two tiers, a concourse between them, a cantilever roof
  'stand-section': {
    widthM: 24, depthM: 48, heightM: 42.5,
    aisles: AISLES_3,
    tiers: [
      { rows: 20, d0: 2.5, tread: 0.9, y0: 3.3, rise: 0.405, voms: [[-0.31, -0.19, 8, 12], [0.19, 0.31, 8, 12]] },
      { rows: 21, d0: 24.0, tread: 0.86, y0: 14.6, rise: 0.56, voms: [[-0.31, -0.19, 4, 7], [0.19, 0.31, 4, 7]] },
    ],
    lamps: { y: 36.2, d: 13.5, us: [-0.33, 0, 0.33] },      // floodlight banks under the roof's front edge
    ribbons: [{ y: 2.7, d: 0 }, { y: 13.4, d: 23.6 }],        // LED ribbon boards along the tier fronts
  },
  // the corner: the same tiers, no tunnels, a pylon and a mast behind
  'stand-corner': {
    widthM: 24, depthM: 55, heightM: 61.4,
    aisles: AISLES_3,
    tiers: [
      { rows: 20, d0: 2.5, tread: 0.9, y0: 3.3, rise: 0.405, voms: [] },
      { rows: 21, d0: 24.0, tread: 0.86, y0: 14.6, rise: 0.56, voms: [] },
    ],
    lamps: { y: 53.4, d: 45.9, us: [0] },
    ribbons: [{ y: 2.7, d: 0 }, { y: 13.4, d: 23.6 }],
  },
  // the free-standing roofed stand a stage places beside a green
  grandstand: {
    widthM: 30, depthM: 16, heightM: 15.82,
    aisles: [[-0.5, -0.48], [-0.27, -0.23], [-0.02, 0.02], [0.23, 0.27], [0.48, 0.5]],
    tiers: [{ rows: 12, d0: 1.6, tread: 0.9, y0: 1.9, rise: 0.5, voms: [[-0.2, -0.08, 3, 6], [0.08, 0.2, 3, 6]] }],
    lamps: { y: 13.4, d: 0.6, us: [-0.3, 0.3] },
    ribbons: [{ y: 1.3, d: 0 }],
  },
  // a gallery: a few low steps of standing spectators (heightM sizes the block, not the people)
  crowd: {
    widthM: 18, depthM: 4.6, heightM: 4.3,
    aisles: [],
    tiers: [{ rows: 4, d0: 0.5, tread: 1.0, y0: 0.3, rise: 0.55, voms: [], stand: true }],
  },
});

export const isStandKind = (kind) => Object.prototype.hasOwnProperty.call(STANDS, kind);
export const STRAIGHT = Object.freeze({ tl: 0, tr: 0, sag: 0, sagK: 0 });

// A prop's wedge, checked: { w, tl, tr, sag, sagK }. Without one (or a broken one) the stand
// is straight and as wide as its model times `scaleX`.
export function standWedge(kind, wedge, scaleX = 1) {
  const def = STANDS[kind];
  const n = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const w = n(wedge && wedge.w, 0) > 1 ? wedge.w : (def ? def.widthM : 1) * scaleX;
  const lim = (v) => Math.max(-1.6, Math.min(1.6, n(v, 0)));
  return { w, tl: lim(wedge && wedge.tl), tr: lim(wedge && wedge.tr), sag: Math.max(-6, Math.min(6, n(wedge && wedge.sag, 0))), sagK: Math.max(-0.2, Math.min(0.2, n(wedge && wedge.sagK, 0))) };
}

// The deformation: (u, d) of the straight module -> [x across, back] in the copy's own
// frame, metres (x toward its u = +0.5 side, back = away from the pitch).
export function wedgePoint(wedge, u, d) {
  const xl = -wedge.w / 2 - d * wedge.tl, xr = wedge.w / 2 + d * wedge.tr;
  return [xl + (xr - xl) * (u + 0.5), d + (1 - 4 * u * u) * (wedge.sag + d * wedge.sagK)];
}

// ... and on the course: a prop at (x, y) turned rotDeg (clockwise from above; 0 = its front
// to the south) has its own +x along [cos a, -sin a] and its back along [sin a, cos a].
export function standToCourse(place, lx, back) {
  const a = (place.rotDeg || 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return [place.x + lx * c + back * s, place.y - lx * s + back * c];
}

// How far the row turns from the stand's own facing at u (radians, clockwise from above):
// the people in a wedge face the middle of the ring, not the chord's normal.
export function wedgeYaw(wedge, u) {
  return Math.atan(-wedge.tl + (wedge.tr + wedge.tl) * (u + 0.5));
}

function hash2(a, b) {
  let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul((b | 0) + 0x7f4a7c15, 0x85ebca6b)) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d) >>> 0; h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

// Every seat of a stand: place = { kind, x, y, z (course height of the model's y = 0),
// rotDeg, wedge?, scale? (a number: the model's scale; a gallery's rows shrink with it) }.
// Returns { count, pos: Float32Array [x, y, z (the tread), yaw (rad, the way the seat faces,
// clockwise from north)] * count, meta: Uint16Array [tier, row, col, block] * count,
// rows: [{ tier, row, from, to }] }. col counts seats along the row from the u = -0.5 end, so
// a pattern (lettering) can be laid over (col, row). `pitch` is the seat spacing (m).
export function standSeats(place, { pitch = SEAT_PITCH_M } = {}) {
  const def = STANDS[place.kind];
  if (!def) return { count: 0, pos: new Float32Array(0), meta: new Uint16Array(0), rows: [] };
  const k = typeof place.scale === 'number' && place.scale > 0 ? place.scale : 1;
  const wedge = standWedge(place.kind, place.wedge, k);
  const pos = [], meta = [], rows = [];
  const face = ((place.rotDeg || 0) + 180) * Math.PI / 180;   // the front: the way a seat looks
  def.tiers.forEach((tier, ti) => {
    for (let r = 0; r < tier.rows; r++) {
      const d = (tier.d0 + tier.tread * (r + 0.55)) * k, y = (tier.y0 + tier.rise * r) * k;
      // the open stretches of this row: between the aisles, less the tunnel mouths
      const cuts = [...def.aisles, ...tier.voms.filter((v) => r >= v[2] && r <= v[3]).map((v) => [v[0], v[1]])].sort((a, b) => a[0] - b[0]);
      const open = [];
      let from = -0.5;
      for (const [a, b] of cuts) { if (a > from + 1e-6) open.push([from, a]); from = Math.max(from, b); }
      if (from < 0.5 - 1e-6) open.push([from, 0.5]);
      const start = pos.length / 4;
      let col = 0;
      open.forEach(([ua, ub], bi) => {
        const pa = wedgePoint(wedge, ua, d), pb = wedgePoint(wedge, ub, d);
        const len = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
        const n = Math.floor((len - 0.1) / pitch);
        for (let i = 0; i < n; i++) {
          const u = ua + (ub - ua) * ((i + 0.5) / n);
          const [lx, back] = wedgePoint(wedge, u, d);
          const [cx, cy] = standToCourse(place, lx, back);
          pos.push(cx, cy, (place.z || 0) + y, face + wedgeYaw(wedge, u));
          meta.push(ti, r, col++, bi);
        }
      });
      rows.push({ tier: ti, row: r, from: start, to: pos.length / 4, stand: !!tier.stand });
    }
  });
  return { count: pos.length / 4, pos: new Float32Array(pos), meta: new Uint16Array(meta), rows, wedge, def };
}

// Where a stand's floodlight banks hang and its LED ribbons run, on the course:
// lamps [{ x, y, z, yaw }] (yaw: the way they shine, as a seat faces).
export function standLamps(place) {
  const def = STANDS[place.kind];
  if (!def || !def.lamps) return [];
  const k = typeof place.scale === 'number' && place.scale > 0 ? place.scale : 1;
  const wedge = standWedge(place.kind, place.wedge, k);
  const face = ((place.rotDeg || 0) + 180) * Math.PI / 180;
  return def.lamps.us.map((u) => {
    const [lx, back] = wedgePoint(wedge, u, def.lamps.d * k);
    const [x, y] = standToCourse(place, lx, back);
    return { x, y, z: (place.z || 0) + def.lamps.y * k, yaw: face + wedgeYaw(wedge, u) };
  });
}

// A stable 0..1 number for a seat (who sits there, what they wear): the same stand always
// has the same crowd.
export function seatHash(standIndex, seatIndex, salt = 0) {
  return hash2(standIndex * 8191 + salt * 131, seatIndex);
}

// ---- lettering picked out in the seats (and in the shirts of the people in them)
// A 5 x 7 face, rows top to bottom, 5 bits a row (bit 4 = the left column).
const FONT = {
  A: [14, 17, 17, 31, 17, 17, 17], B: [30, 17, 17, 30, 17, 17, 30], C: [14, 17, 16, 16, 16, 17, 14], D: [30, 17, 17, 17, 17, 17, 30],
  E: [31, 16, 16, 30, 16, 16, 31], F: [31, 16, 16, 30, 16, 16, 16], G: [14, 17, 16, 23, 17, 17, 15], H: [17, 17, 17, 31, 17, 17, 17],
  I: [14, 4, 4, 4, 4, 4, 14], J: [7, 2, 2, 2, 2, 18, 12], K: [17, 18, 20, 24, 20, 18, 17], L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17], N: [17, 25, 21, 19, 17, 17, 17], O: [14, 17, 17, 17, 17, 17, 14], P: [30, 17, 17, 30, 16, 16, 16],
  Q: [14, 17, 17, 17, 21, 18, 13], R: [30, 17, 17, 30, 20, 18, 17], S: [15, 16, 16, 14, 1, 1, 30], T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14], V: [17, 17, 17, 17, 17, 10, 4], W: [17, 17, 17, 21, 21, 27, 17], X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 10, 4, 4, 4, 4], Z: [31, 1, 2, 4, 8, 16, 31], '!': [4, 4, 4, 4, 4, 0, 4], ' ': [0, 0, 0, 0, 0, 0, 0],
  0: [14, 17, 19, 21, 25, 17, 14], 1: [4, 12, 4, 4, 4, 4, 14], 2: [14, 17, 1, 2, 4, 8, 31], 3: [30, 1, 1, 14, 1, 1, 30],
};

// Is the seat (col of nCols along its row, row of nRows from the front) inside a letter of
// `text` laid across the block? Each font pixel covers `px` rows; the text is centred.
export function seatLettering(text, col, nCols, row, nRows, px = 2) {
  if (!text) return false;
  const chars = String(text).toUpperCase().split('').filter((c) => FONT[c]);
  if (!chars.length) return false;
  const rowsNeeded = 7 * px;
  const top = Math.floor((nRows - rowsNeeded) / 2);
  const fr = nRows - 1 - row - top;                // font row from the top (the back row is the top)
  if (fr < 0 || fr >= rowsNeeded) return false;
  const cellsWide = chars.length * 6 - 1;           // 5 columns a letter, 1 between
  const seatsPerCell = Math.max(1, Math.floor(nCols / (cellsWide + 2)));
  const left = Math.floor((nCols - cellsWide * seatsPerCell) / 2);
  const cell = Math.floor((col - left) / seatsPerCell);
  if (col < left || cell >= cellsWide) return false;
  const ch = Math.floor(cell / 6), cx = cell % 6;
  if (cx === 5) return false;
  return ((FONT[chars[ch]][Math.floor(fr / px)] >> (4 - cx)) & 1) === 1;
}

// ---- rings
// Do two stands share their side line? a's u = -0.5 side against b's u = +0.5 side: the gap
// between them (m) at the front and at depth D, and the height step where their rows meet.
// A closed ring has all three near zero (the test's tolerance is centimetres).
export function seamGap(a, b, D = 40) {
  const wa = standWedge(a.kind, a.wedge), wb = standWedge(b.kind, b.wedge);
  const at = (place, wedge, u, d) => standToCourse(place, ...wedgePoint(wedge, u, d));
  const a0 = at(a, wa, -0.5, 0), b0 = at(b, wb, 0.5, 0), a1 = at(a, wa, -0.5, D), b1 = at(b, wb, 0.5, D);
  return { front: Math.hypot(a0[0] - b0[0], a0[1] - b0[1]), back: Math.hypot(a1[0] - b1[0], a1[1] - b1[1]), dz: Math.abs((a.z || 0) - (b.z || 0)) };
}
