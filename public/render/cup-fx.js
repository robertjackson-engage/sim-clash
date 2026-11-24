// The cup moment: what the hole does the instant a ball drops into it. Two rings of light
// run out across the green from the cup and a burst of sparks jumps out of it, over about
// a second. One small object, built the first time a ball is holed and reused after;
// nothing is drawn (or updated) between bursts. scene.js fires it at the drop
// (arcade/feel.js cupDropT) and updates it once a frame.
import * as THREE from 'three';

export const CUP_FX = Object.freeze({
  sparks: 72, lifeS: [0.6, 1.25], outMps: [0.25, 1.5], upMps: [0.7, 2.6], gravity: 5,
  ringS: 0.8, ringM: [0.16, 1.5], ringGapS: 0.16, flashS: 0.55, totalS: 1.4,
});

// a spark's place t seconds after the burst: thrown up and out of the cup, falling back
export function sparkAt(s, t) {
  return { x: s.vx * t, y: Math.max(0, s.vy * t - 0.5 * CUP_FX.gravity * t * t), z: s.vz * t };
}

export class CupFx {
  constructor({ color = 0xffe27a, hot = 0xffffff } = {}) {
    const C = CUP_FX;
    this.group = new THREE.Group();
    this.group.name = 'cupFx';
    this.group.visible = false;
    this.group.renderOrder = 6;
    this.t0 = -Infinity;
    // the rings: flat on the green, growing out from the cup
    this.rings = [0, 1].map((k) => {
      const m = new THREE.Mesh(
        new THREE.RingGeometry(0.93, 1, 64),
        new THREE.MeshBasicMaterial({
          color: k ? hot : color, transparent: true, opacity: 0, depthWrite: false,
          blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
          polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
        }),
      );
      m.rotation.x = -Math.PI / 2;
      m.position.y = 0.035 + 0.01 * k;
      this.group.add(m);
      return m;
    });
    // the flash: light out of the hole itself
    this.flash = new THREE.Mesh(
      new THREE.CircleGeometry(0.2, 40),
      new THREE.MeshBasicMaterial({
        color: hot, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
        toneMapped: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6,
      }),
    );
    this.flash.rotation.x = -Math.PI / 2;
    this.flash.position.y = 0.05;
    this.group.add(this.flash);
    // the sparks
    this.seeds = [];
    const pos = new Float32Array(C.sparks * 3), col = new Float32Array(C.sparks * 3);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.tint = [new THREE.Color(color), new THREE.Color(hot)];
    this.points = new THREE.Points(this.geo, new THREE.PointsMaterial({
      size: 0.17, sizeAttenuation: true, vertexColors: true, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: false, map: sparkTexture(),
    }));
    this.points.frustumCulled = false;
    this.group.add(this.points);
  }

  // at: the cup's mouth (three coordinates); now: the scene's frame time (s)
  burst(at, now) {
    const C = CUP_FX;
    this.group.position.copy(at);
    this.t0 = now;
    this.seeds.length = 0;
    let r = (Math.round(at.x * 131) ^ Math.round(at.z * 977) ^ 0x9e3779b9) >>> 0;
    const rnd = () => { r = (Math.imul(r, 1664525) + 1013904223) >>> 0; return r / 4294967296; };
    for (let i = 0; i < C.sparks; i++) {
      const a = rnd() * Math.PI * 2, out = C.outMps[0] + (C.outMps[1] - C.outMps[0]) * rnd();
      this.seeds.push({
        vx: Math.cos(a) * out, vz: Math.sin(a) * out, vy: C.upMps[0] + (C.upMps[1] - C.upMps[0]) * rnd(),
        life: C.lifeS[0] + (C.lifeS[1] - C.lifeS[0]) * rnd(), hot: rnd() < 0.35 ? 1 : 0,
      });
    }
    this.group.visible = true;
    this.update(now);
  }

  get active() { return this.group.visible; }

  update(now) {
    if (!this.group.visible) return false;
    const C = CUP_FX, t = now - this.t0;
    if (t > C.totalS || t < 0) { this.group.visible = false; return false; }
    this.rings.forEach((m, k) => {
      const u = Math.min(1, Math.max(0, (t - k * C.ringGapS) / C.ringS)), e = 1 - (1 - u) * (1 - u);
      const s = C.ringM[0] + (C.ringM[1] - C.ringM[0]) * e * (k ? 0.72 : 1);
      m.scale.set(s, s, 1);
      m.material.opacity = u <= 0 ? 0 : 0.95 * (1 - u) * (1 - u);
    });
    const fu = Math.min(1, t / C.flashS);
    this.flash.material.opacity = (1 - fu) * (1 - fu);
    this.flash.scale.setScalar(1 + 1.2 * fu);
    const pos = this.geo.attributes.position, col = this.geo.attributes.color;
    this.seeds.forEach((s, i) => {
      const u = Math.min(1, t / s.life), p = sparkAt(s, Math.min(t, s.life));
      pos.setXYZ(i, p.x, p.y + 0.03, p.z);
      const k = (1 - u) * (1 - u) * (0.75 + 0.25 * Math.sin(40 * t + i));   // they twinkle as they die
      const c = this.tint[s.hot];
      col.setXYZ(i, c.r * k, c.g * k, c.b * k);
    });
    pos.needsUpdate = true;
    col.needsUpdate = true;
    return true;
  }

  dispose() {
    for (const m of [...this.rings, this.flash]) { m.geometry.dispose(); m.material.dispose(); }
    this.geo.dispose();
    this.points.material.map?.dispose();
    this.points.material.dispose();
  }
}

// a soft four-point star, drawn once
function sparkTexture() {
  const S = 64, cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const rad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  rad.addColorStop(0, 'rgba(255,255,255,1)');
  rad.addColorStop(0.22, 'rgba(255,255,255,0.85)');
  rad.addColorStop(0.5, 'rgba(255,255,255,0.18)');
  rad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = rad;
  g.fillRect(0, 0, S, S);
  g.strokeStyle = 'rgba(255,255,255,0.9)';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(S / 2, 3); g.lineTo(S / 2, S - 3);
  g.moveTo(3, S / 2); g.lineTo(S - 3, S / 2);
  g.stroke();
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
