// Painted skies for the arcade themes (arcade-look.js): a night city, a volcano's ash
// and ember glow, a dusk. The real look and the daylight themes use the sky PHOTOS
// (sky-presets.js); there is no photo of a neon midnight, so these are painted into an
// equirect radiance map of the same kind and handed to the scene through the same door
// (env.js loadHDRIEnvironment's result shape): the image-based light, the visible sky,
// the ground-projected horizon and the water's reflection all come from it.
//
// paintSky() is pure (no three, no DOM), so the spec -> pixels step is unit-tested.
import * as THREE from 'three';
import { horizonColorFromEquirect, horizonLinearFromEquirect } from './hdri-analyze.js';

const RAD = Math.PI / 180;
const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

// '#rrggbb' -> linear [r, g, b], times gain
export function skyColor(hex, gain = 1) {
  const s = String(hex || '#000000').replace('#', '');
  const n = parseInt(s.length === 3 ? s.replace(/(.)/g, '$1$1') : s, 16) || 0;
  return [srgbToLinear(((n >> 16) & 255) / 255) * gain, srgbToLinear(((n >> 8) & 255) / 255) * gain, srgbToLinear((n & 255) / 255) * gain];
}

// The unit vector toward a compass bearing (0 = north = three -z, 90 = east = +x) at an
// altitude above the horizon: the same frame as hdri-analyze.js sunDirectionVec.
export function skyDirection(azDeg, altDeg) {
  const az = azDeg * RAD, alt = altDeg * RAD, c = Math.cos(alt);
  return { x: c * Math.sin(az), y: Math.sin(alt), z: -c * Math.cos(az) };
}

const hash2 = (x, y) => {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
};
function vnoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  let fx = x - ix, fy = y - iy;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy), b = hash2(ix + 1, iy), c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
const fbm3 = (x, y) => 0.55 * vnoise(x, y) + 0.3 * vnoise(x * 2.07 + 5.3, y * 2.07 + 1.7) + 0.15 * vnoise(x * 4.3 + 9.1, y * 4.3 + 4.4);
const smooth = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * Paint a sky into an equirect RGBA float image (linear radiance; row 0 is straight down,
 * as three's equirect sampling reads a DataTexture).
 *
 * spec: {
 *   zenith, horizon          '#hex' the gradient's ends; mid: an optional colour part way up
 *   gain                     radiance multiplier on the gradient (day about 1, night about 0.1)
 *   exponent                 how fast the horizon colour gives way going up (default 0.5)
 *   ground                   '#hex' below the horizon (the far ground the dome is projected on)
 *   glows: [{ color, azDeg, widthDeg, heightDeg, strength }]   lobes of light on the horizon
 *            (a sunset, a city, a lava lake); widthDeg 360 runs all the way round
 *   disc: { azDeg, altDeg, color, sizeDeg, strength, halo }     a sun or a moon
 *   stars: 0..1              how many
 *   clouds: { color, cover: 0..1, scale, strength, lowDeg, highDeg }   a soft band of cloud
 * }
 */
export function paintSky(spec = {}, width = 1024, height = 512) {
  const data = new Float32Array(width * height * 4);
  const gain = spec.gain ?? 1;
  const zen = skyColor(spec.zenith ?? '#1a2a55', gain), hor = skyColor(spec.horizon ?? '#8fa8d8', gain);
  const mid = spec.mid ? skyColor(spec.mid, gain) : null;
  const gnd = skyColor(spec.ground ?? spec.horizon ?? '#20242c', (spec.groundGain ?? 1) * gain);
  const exponent = spec.exponent ?? 0.5;
  const glows = (spec.glows || []).map((g) => ({
    col: skyColor(g.color, g.strength ?? 1), az: (g.azDeg ?? 0) * RAD,
    width: (g.widthDeg ?? 90) * RAD, heightK: 1 / Math.max(0.5, g.heightDeg ?? 12), all: (g.widthDeg ?? 90) >= 360,
  }));
  const disc = spec.disc ? {
    dir: skyDirection(spec.disc.azDeg ?? 0, spec.disc.altDeg ?? 30), col: skyColor(spec.disc.color ?? '#ffffff', spec.disc.strength ?? 4),
    cos: Math.cos((spec.disc.sizeDeg ?? 2) * RAD), halo: spec.disc.halo ?? 0.3,
  } : null;
  const stars = Math.min(1, Math.max(0, spec.stars ?? 0));
  const clouds = spec.clouds ? {
    col: skyColor(spec.clouds.color ?? '#ffffff', spec.clouds.strength ?? 1), cover: spec.clouds.cover ?? 0.5,
    scale: spec.clouds.scale ?? 5, low: spec.clouds.lowDeg ?? 4, high: spec.clouds.highDeg ?? 50,
  } : null;

  for (let j = 0; j < height; j++) {
    const el = ((j + 0.5) / height - 0.5) * Math.PI;      // elevation, -90 .. 90 degrees
    const elDeg = el / RAD, sinEl = Math.sin(el), cosEl = Math.cos(el);
    // the gradient at this height
    let r, g, b;
    if (el < 0) {
      // below the horizon: the far ground, meeting the horizon colour in a short haze band
      const k = smooth(-6, 0, elDeg);
      r = gnd[0] + (hor[0] - gnd[0]) * k; g = gnd[1] + (hor[1] - gnd[1]) * k; b = gnd[2] + (hor[2] - gnd[2]) * k;
    } else {
      const t = Math.pow(Math.min(1, sinEl), exponent);
      if (mid) {
        const a = Math.min(1, t * 2), c = Math.max(0, t * 2 - 1);
        r = hor[0] + (mid[0] - hor[0]) * a + (zen[0] - mid[0]) * c;
        g = hor[1] + (mid[1] - hor[1]) * a + (zen[1] - mid[1]) * c;
        b = hor[2] + (mid[2] - hor[2]) * a + (zen[2] - mid[2]) * c;
      } else {
        r = hor[0] + (zen[0] - hor[0]) * t; g = hor[1] + (zen[1] - hor[1]) * t; b = hor[2] + (zen[2] - hor[2]) * t;
      }
    }
    const glowFall = glows.map((gl) => Math.exp(-Math.abs(elDeg) * gl.heightK) * (el < 0 ? smooth(-8, 0, elDeg) : 1));
    for (let i = 0; i < width; i++) {
      const phi = ((i + 0.5) / width - 0.5) * 2 * Math.PI;   // three equirectUv: u = atan(z, x) / 2pi + 0.5
      const dx = Math.cos(phi) * cosEl, dz = Math.sin(phi) * cosEl;
      let pr = r, pg = g, pb = b;
      for (let k = 0; k < glows.length; k++) {
        const gl = glows[k];
        let w = glowFall[k];
        if (!gl.all) {
          // compass bearing of this column: atan2(east, north) = atan2(dx, -dz)
          let d = Math.atan2(dx, -dz) - gl.az;
          d = Math.atan2(Math.sin(d), Math.cos(d));
          w *= Math.exp(-(d * d) / (2 * (gl.width / 2.4) ** 2));
        }
        pr += gl.col[0] * w; pg += gl.col[1] * w; pb += gl.col[2] * w;
      }
      if (el > 0) {
        if (clouds && elDeg > clouds.low - 3) {
          // a band of cloud, stretched along the horizon, thinning toward the zenith
          const n = fbm3(phi * clouds.scale + 3.1, (elDeg / 14) * clouds.scale * 0.55 + 1.3) * (0.75 + 0.25 * vnoise(phi * clouds.scale * 0.6 + 8.0, elDeg * 0.08));
          const band = smooth(clouds.low - 3, clouds.low + 6, elDeg) * (1 - smooth(clouds.high * 0.6, clouds.high, elDeg));
          const c = smooth(1 - clouds.cover, 1 - clouds.cover + 0.22, n) * band;
          // cloud takes the sky's own glow at its foot: under-lit near the horizon
          pr += (clouds.col[0] - pr * 0.55) * c; pg += (clouds.col[1] - pg * 0.55) * c; pb += (clouds.col[2] - pb * 0.55) * c;
        }
        if (stars > 0 && elDeg > 3) {
          const h = hash2(i * 0.731 + 11.0, j * 1.337 + 7.0);
          if (h > 1 - 0.0016 * stars) {
            const s = (0.5 + 3.5 * hash2(i * 3.1, j * 7.7) ** 3) * smooth(3, 14, elDeg);
            pr += s * 0.9; pg += s * 0.95; pb += s * 1.1;
          }
        }
        if (disc) {
          const d = dx * disc.dir.x + sinEl * disc.dir.y + dz * disc.dir.z;
          const inDisc = smooth(disc.cos - 0.0006, disc.cos + 0.0002, d);
          const halo = disc.halo * Math.pow(Math.max(0, d), 220) + disc.halo * 0.35 * Math.pow(Math.max(0, d), 24);
          pr += disc.col[0] * (inDisc + halo); pg += disc.col[1] * (inDisc + halo); pb += disc.col[2] * (inDisc + halo);
        }
      }
      const o = (j * width + i) * 4;
      data[o] = pr; data[o + 1] = pg; data[o + 2] = pb; data[o + 3] = 1;
    }
  }
  return { data, width, height };
}

// The painted sky as the scene takes a sky photo: { envTexture (PMREM), equirect
// (background, grounded dome, water reflections), sunDir, horizonColor, horizonLinear }.
// spec.light gives the key light's bearing and height (sunAzimuthDeg, sunAltitudeDeg).
export function paintedSkyEnvironment(renderer, spec, { width = 2048, height = 1024 } = {}) {
  const img = paintSky(spec, width, height);
  const equirect = new THREE.DataTexture(img.data, width, height, THREE.RGBAFormat, THREE.FloatType);
  equirect.mapping = THREE.EquirectangularReflectionMapping;
  equirect.colorSpace = THREE.LinearSRGBColorSpace;
  equirect.magFilter = equirect.minFilter = THREE.LinearFilter;
  equirect.wrapS = THREE.RepeatWrapping;
  equirect.generateMipmaps = false;
  equirect.needsUpdate = true;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTexture = pmrem.fromEquirectangular(equirect).texture;
  pmrem.dispose();
  const l = spec.light || {};
  const d = skyDirection(l.sunAzimuthDeg ?? 200, Math.max(8, l.sunAltitudeDeg ?? 45));
  const hl = horizonLinearFromEquirect(img.data, width, height);
  return {
    envTexture, equirect,
    sunDir: new THREE.Vector3(d.x, d.y, d.z).normalize(),
    horizonColor: horizonColorFromEquirect(img.data, width, height),
    horizonLinear: new THREE.Color().setRGB(hl.r, hl.g, hl.b, THREE.LinearSRGBColorSpace),
  };
}
