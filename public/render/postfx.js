// Post-processing for GolfScene — bloom + SMAA over the base render.
// Stock three.js passes only (see docs/visual-upgrade-plan.md, Step 1):
//   RenderPass -> UnrealBloomPass -> OutputPass (tone map + sRGB + grade) -> SMAAPass (FXAA at Low) -> CAS.
// SAO/SSAO are intentionally omitted: the terrain is a flat height grid with
// nothing to self-occlude, and SAO haloes over the 12000m far plane.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { RENDER_CONFIG } from './config.js';
import { replaceGtaoNoiseTexture } from './gtao-noise.js';

// Cinematic grade in display space (after tone-map/sRGB): gentle contrast +
// saturation, a warm-highlight / cool-shadow split-tone, and a soft vignette. It runs at
// the end of the OutputPass (gradeInto), not as a pass of its own: that was one more
// full-screen read and write a frame for a few multiply-adds a pixel (~0.2 ms at 1.3 MP
// on the dev Mac, several ms on the sim PC's integrated GPU; docs/machines.md).
const GRADE_UNIFORMS = {
  // natural: the old 1.16 saturation pushed sunlit turf toward lime once the sun
  // became the key light
  uContrast: 1.08,
  uSaturation: 1.08,
  uVignette: 0.34,
};
const GRADE_GLSL = `
  {
    vec3 col = (gl_FragColor.rgb - 0.5) * uContrast + 0.5;   // contrast
    float l = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(vec3(l), col, uSaturation);                 // saturation
    col += vec3(0.006, 0.004, -0.012) * (1.0 - l);        // warm, desaturated shadows (turf greens, not blue)
    col += vec3(0.028, 0.018, -0.012) * l;                // warm highlights
    #ifdef GRADE_ARCADE
    // v3:environment a theme's grade (arcade-look.js grade.film / shadows / highlights / vibrance):
    // a filmic S (a soft toe and shoulder), a colour for the shadows and one for the
    // highlights, and vibrance, which lifts the weak colours more than the strong ones
    col = clamp(col, 0.0, 1.0);
    col = mix(col, col * col * (3.0 - 2.0 * col), uGradeFilm.x);
    float gl2 = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col += uGradeShadow * (1.0 - gl2) * (1.0 - gl2) + uGradeHigh * gl2 * gl2;
    float gmx = max(col.r, max(col.g, col.b)), gmn = min(col.r, min(col.g, col.b));
    col = mix(vec3(gl2), col, 1.0 + uGradeFilm.y * (1.0 - clamp(gmx - gmn, 0.0, 1.0)));
    #endif
    float v = smoothstep(0.85, 0.42, length(vUv - 0.5));  // vignette
    col *= mix(1.0, v, uVignette);
    gl_FragColor = vec4(clamp(col, 0.0, 1.0), gl_FragColor.a);
  }`;

// The grade appended to an OutputPass's shader, after its tone mapping and sRGB encode.
// OutputPass rebuilds only its defines when the tone mapping changes, never the shader
// text, so the grade stays.
export function gradeInto(pass) {
  const m = pass.material;
  for (const [k, v] of Object.entries(GRADE_UNIFORMS)) m.uniforms[k] = { value: v };
  m.uniforms.uGradeFilm = { value: new THREE.Vector2(0, 0) };
  m.uniforms.uGradeShadow = { value: new THREE.Color(0, 0, 0) };
  m.uniforms.uGradeHigh = { value: new THREE.Color(0, 0, 0) };
  const fs = m.fragmentShader.replace('varying vec2 vUv;', 'varying vec2 vUv;\nuniform float uContrast, uSaturation, uVignette;\n#ifdef GRADE_ARCADE\nuniform vec2 uGradeFilm; uniform vec3 uGradeShadow, uGradeHigh;\n#endif');
  const end = fs.lastIndexOf('}');
  if (end < 0 || fs === m.fragmentShader) throw new Error('OutputPass shader changed: the grade has nowhere to go');
  m.fragmentShader = fs.slice(0, end) + GRADE_GLSL + '\n' + fs.slice(end);
  m.needsUpdate = true;
  return pass;
}

// Contrast-adaptive sharpening (after AMD FidelityFX CAS): restores detail when the frame
// is rendered under the display's resolution (dynamic resolution, retina budgets),
// sharpening flat detail more than edges that are already crisp.
const CAS_SHADER = {
  uniforms: { tDiffuse: { value: null }, uTexel: { value: new THREE.Vector2(1 / 1920, 1 / 1080) }, uSharp: { value: 0.2 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform vec2 uTexel; uniform float uSharp; varying vec2 vUv;
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      vec3 n = texture2D(tDiffuse, vUv + vec2(0.0, uTexel.y)).rgb, s = texture2D(tDiffuse, vUv - vec2(0.0, uTexel.y)).rgb;
      vec3 e = texture2D(tDiffuse, vUv + vec2(uTexel.x, 0.0)).rgb, w = texture2D(tDiffuse, vUv - vec2(uTexel.x, 0.0)).rgb;
      vec3 mn = min(c, min(min(n, s), min(e, w))), mx = max(c, max(max(n, s), max(e, w)));
      vec3 amp = sqrt(clamp(min(mn, 1.0 - mx) / max(mx, vec3(1e-4)), 0.0, 1.0));
      vec3 wt = -amp / mix(8.0, 5.0, uSharp);
      vec3 col = ((n + s + e + w) * wt + c) / (1.0 + 4.0 * wt);
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }`,
};

// v3:environment THE AIR AND THE LENS, one pass straight after the scene is drawn (arcade look only;
// off, and costing nothing, everywhere else). One pass, not three, because all of it reads
// the scene's depth, and only the first pass after the RenderPass can do that without
// reading the depth of the very target it is drawing into.
//   ENV_FOG   height fog and aerial perspective: the haze thickens with distance on the curve
//             the scene's own fog uses (atmosphere.js), thins with height (peaks stand out of
//             it), takes its colour from the sky's horizon in the direction looked (the far
//             world's haze ring: warm under the sun, cool away from it) and glows toward the sun.
//   ENV_DOF   depth of field, for a close-up on the pin and the title screen's backdrop.
//   ENV_BLUR  motion blur from the camera's own movement, for the ball cam at speed; nothing
//             within a hand's width of the ball on screen is blurred.
const ENV_SHADER = {
  uniforms: {
    tDiffuse: { value: null }, tDepth: { value: null }, uHaze: { value: null },
    uProjInv: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() }, uPrevViewProj: { value: new THREE.Matrix4() },
    uCamPos: { value: new THREE.Vector3() },
    uFogA: { value: new THREE.Vector4(0.00042, 1 / 140, 0, 1) },     // density, height falloff (1/m), base height (m), most it may hide
    uFogB: { value: new THREE.Vector4(1, 0.25, 12, 0) },             // colour gain, glow toward the sun, its tightness, (unused)
    uFogCol: { value: new THREE.Color(0.6, 0.7, 0.8) }, uFogMix: { value: 0 },   // one colour for every bearing (and how far to use it: no haze ring = 1)
    uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color(1, 0.9, 0.7) },
    uDof: { value: new THREE.Vector4(10, 6, 0, 0.5) },               // focus (m), range (m), widest blur (px; 0 = none), near share
    uBlur: { value: new THREE.Vector4(0, 0.5, 0.5, 0.12) },          // strength, the ball on screen (u, v), the radius left sharp
    uTexel: { value: new THREE.Vector2(1 / 1920, 1 / 1080) },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse, tDepth, uHaze;
    uniform mat4 uProjInv, uCamWorld, uPrevViewProj;
    uniform vec3 uCamPos, uFogCol, uSunDir, uSunCol;
    uniform vec4 uFogA, uFogB, uDof, uBlur;
    uniform float uFogMix;
    uniform vec2 uTexel;
    varying vec2 vUv;
    vec3 worldAt(vec2 uv, float depth) {
      vec4 v = uProjInv * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
      return (uCamWorld * vec4(v.xyz / v.w, 1.0)).xyz;
    }
    // the scene's colour at a pixel, through the air between it and the camera
    vec3 seen(vec2 uv, out float dist) {
      vec3 c = texture2D(tDiffuse, uv).rgb;
      float depth = texture2D(tDepth, uv).x;
      dist = 1e5;
      if (depth >= 1.0) return c;             // the sky has its own air
      vec3 ray = worldAt(uv, depth) - uCamPos;
      dist = length(ray);
      #ifdef ENV_FOG
      vec3 rd = ray / max(dist, 1e-3);
      // the haze lies in the low air: integrate its thinning with height along the ray
      float t = uFogA.y * ray.y;
      float column = exp(-uFogA.y * max(uCamPos.y - uFogA.z, 0.0)) * (abs(t) > 1e-3 ? (1.0 - exp(-t)) / t : 1.0);
      float x = uFogA.x * dist * clamp(column, 0.0, 1.6);
      float f = (1.0 - exp(-x * (0.2 + x))) * uFogA.w;
      vec3 fc = mix(texture2D(uHaze, vec2(atan(rd.x, -rd.z) / 6.28318530718 + 0.03125, 0.5)).rgb, uFogCol, uFogMix) * uFogB.x;
      fc += uSunCol * uFogB.y * pow(max(dot(rd, uSunDir), 0.0), uFogB.z);
      c = mix(c, fc, f);
      #endif
      return c;
    }
    void main() {
      float dist;
      vec3 col = seen(vUv, dist);
      #ifdef ENV_DOF
      {
        // a disc of taps as wide as this pixel is out of focus; a tap that is itself in
        // focus gives little, so the pin does not smear into the blur behind it
        float coc = clamp((dist - uDof.x) / uDof.y, -uDof.w, 1.0);
        float r = abs(coc) * uDof.z;
        if (r > 0.6) {
          vec3 acc = col; float wsum = 1.0;
          // (v3:env-polish the disc is turned by a different amount at every pixel: the same fourteen
          // taps everywhere drew a fine hatch across anything blurred)
          float turn = 6.2831853 * fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
          for (int i = 0; i < 14; i++) {
            float a = float(i) * 2.39996323 + turn, rr = sqrt((float(i) + 0.5) / 14.0);
            vec2 o = vec2(cos(a), sin(a)) * rr * r * uTexel;
            float d2; vec3 s = seen(vUv + o, d2);
            float w = clamp(abs((d2 - uDof.x) / uDof.y) * 1.6 + 0.12, 0.0, 1.0);
            acc += s * w; wsum += w;
          }
          col = acc / wsum;
        }
      }
      #endif
      #ifdef ENV_BLUR
      {
        // where this point of the world was on screen a frame ago: smear along the way
        float depth = texture2D(tDepth, vUv).x;
        vec3 w = depth >= 1.0 ? uCamPos + normalize(worldAt(vUv, 0.999) - uCamPos) * 1e5 : worldAt(vUv, depth);
        vec4 pc = uPrevViewProj * vec4(w, 1.0);
        vec2 vel = (vUv - (pc.xy / max(pc.w, 1e-4) * 0.5 + 0.5)) * uBlur.x;
        float keep = smoothstep(uBlur.w, uBlur.w * 3.0, distance(vUv, uBlur.yz));
        vel *= keep;
        float len = length(vel);
        if (len > 0.0007) {
          vel *= min(1.0, 0.045 / len);
          vec3 acc = col; float d2;
          for (int i = 1; i < 8; i++) acc += seen(vUv - vel * (float(i) / 7.0), d2);
          col = acc / 8.0;
        }
      }
      #endif
      gl_FragColor = vec4(col, 1.0);
    }`,
};

// The bloom's (strength, radius, threshold): see the note where the pass is built.
const BLOOM_DEFAULT = Object.freeze({ strength: 0.06, radius: 0.4, threshold: 1.6 });

export class PostFX {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    const size = renderer.getSize(new THREE.Vector2());

    // EffectComposer reads renderer.getPixelRatio() and uses HalfFloat targets,
    // so the scene stays HDR/linear until OutputPass tone-maps it. The targets carry a
    // depth TEXTURE so GTAO can read the main pass's depth instead of drawing the whole
    // course again into its own normal/depth buffers (one geometry pass a frame fewer).
    const target = new THREE.WebGLRenderTarget(Math.max(1, size.x), Math.max(1, size.y), { type: THREE.HalfFloatType });
    target.depthTexture = new THREE.DepthTexture(Math.max(1, size.x), Math.max(1, size.y));
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));
    this.camera = camera;

    // v3:environment the air and the lens (ENV_SHADER above): built off, switched on by setEnv
    this.env = new ShaderPass(ENV_SHADER);
    this.env.material.depthTest = false; this.env.material.depthWrite = false;
    this.env.enabled = false;
    this._envState = { fog: false, dof: false, blur: false, lens: false, allowed: true };
    this._prevViewProj = new THREE.Matrix4();
    this.composer.addPass(this.env);

    // GTAO for contact grounding (tree bases, terrain folds, bunker lips). Small
    // WORLD-space radius + steep falloff so it darkens only nearby contacts and
    // never haloes over the 12000m far plane (the reason plain SAO was omitted).
    if (RENDER_CONFIG.gtao) {
      const gtao = new GTAOPass(scene, camera, size.x, size.y);
      replaceGtaoNoiseTexture(gtao);
      gtao.output = GTAOPass.OUTPUT.Default;
      gtao.updateGtaoMaterial({
        radius: 1.6, distanceExponent: 2.0, thickness: 1.0,
        scale: 1.4, samples: 12, distanceFallOff: 1.0, screenSpaceRadius: false,
      });
      gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 4, radiusExponent: 1, rings: 2, samples: 16 });
      // GTAO's normal/depth pre-pass renders the scene with ONE override material,
      // which ignores alpha cutouts and transparency: every leaf card, flower bush,
      // tracer ribbon and haze band became a solid quad in the AO buffers, greying
      // the sky in card-shaped 'glass shards' around canopies. Keep cutout and
      // transparent geometry out of the AO pre-pass (it has real shadows anyway).
      const hideBase = gtao._overrideVisibility.bind(gtao);
      gtao._overrideVisibility = function overrideVisibility() {
        hideBase();
        const cache = this._visibilityCache;
        this.scene.traverse((o) => {
          if (!o.visible) return;
          const m = o.material;
          if (o.userData?.noAO || (m && !Array.isArray(m) && (m.transparent || m.alphaTest > 0))) {
            o.visible = false;
            cache.push(o);
          }
        });
      };
      // AO buffers at a fraction of the frame (quality.js aoScale): the pre-pass,
      // the GTAO march and the denoise all scale with pixels; the blend upsamples.
      this.aoScale = 1;
      const gtaoSetSize = gtao.setSize.bind(gtao);
      gtao.setSize = (w, h) => gtaoSetSize(Math.max(1, Math.round(w * this.aoScale)), Math.max(1, Math.round(h * this.aoScale)));
      this.composer.addPass(gtao);
      this.gtao = gtao;
      // read the scene depth the RenderPass just wrote; normals are rebuilt from it
      // (GTAO's own normal pass — and its whole-scene draw — is skipped)
      gtao.setGBuffer(this.composer.readBuffer.depthTexture);
      // Normals rebuilt from depth go wrong at depth edges past a few dozen metres (a
      // 12 km far plane leaves little depth precision), where AO printed dark tree-shaped
      // halos on the turf behind distant trees. A 1.6 m contact AO only matters up close
      // (grounding.js lays the tree-base contact shadows), so fade it out from 35 to 70 m.
      const gm = gtao.gtaoMaterial;
      gm.fragmentShader = gm.fragmentShader.replace(
        'ao = pow(ao, scale);',
        'ao = pow(ao, scale);\n\t\t\tao = mix(ao, 1.0, smoothstep(35.0, 70.0, length(viewPos)));',
      );
      gm.needsUpdate = true;
    }

    // Bloom must NOT touch turf: sun-lit bright grass (esp. the greens) sits near
    // linear 1.0, so a 1.0 threshold haloed the greens into glowing blobs at the
    // overview camera. Raise the threshold to 1.6 so only true speculars (sun glint
    // on water, the brightest sand) bloom, and keep strength low. (strength, radius, threshold).
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), BLOOM_DEFAULT.strength, BLOOM_DEFAULT.radius, BLOOM_DEFAULT.threshold);
    this.composer.addPass(this.bloom);

    // OutputPass applies renderer.toneMapping + toneMappingExposure and converts
    // to the renderer's output color space (composer render targets are linear); the
    // cinematic grade runs at its end, in display space, before SMAA.
    const output = new OutputPass();
    if (RENDER_CONFIG.colorGrade) gradeInto(output);
    this.composer.addPass(output);
    this.output = output;

    // Composer render targets carry no MSAA; SMAA antialiases the final image.
    // (The last pass renders to the default framebuffer, so preserveDrawingBuffer
    // still captures the composited frame for the screenshot/recording path.)
    this.smaa = new SMAAPass();
    this.composer.addPass(this.smaa);
    // Low's antialiasing instead (setQuality, quality.js aa): one pass where SMAA takes three
    this.fxaa = new FXAAPass();
    this.fxaa.enabled = false;
    this.composer.addPass(this.fxaa);
    // sharpening last, over the antialiased frame (setSharpness follows the upscale)
    this.cas = new ShaderPass(CAS_SHADER);
    this.composer.addPass(this.cas);
  }

  // Graphics quality (quality.js): toggle the optional passes live.
  setQuality({ gtao = true, bloom = true, aoScale = 1, aa = 'smaa' } = {}) {
    this.aoScale = aoScale;
    if (this.gtao) this.gtao.enabled = !!gtao;
    if (this.bloom) this.bloom.enabled = !!bloom;
    this.smaa.enabled = aa !== 'fxaa';
    this.fxaa.enabled = aa === 'fxaa';
  }

  // A look's grade and bloom (arcade-look.js), live. No argument = this file's own numbers.
  // v3:environment: with a look, its own grade (film, shadows, highlights, vibrance) is compiled
  // in (GRADE_ARCADE); with none, the output pass is the program it always was.
  setLook(look = undefined) {
    const { contrast = GRADE_UNIFORMS.uContrast, saturation = GRADE_UNIFORMS.uSaturation, vignette = GRADE_UNIFORMS.uVignette, bloom = BLOOM_DEFAULT } = look || {};
    const m = this.output.material, u = m.uniforms;
    if (u.uContrast) {
      u.uContrast.value = contrast; u.uSaturation.value = saturation; u.uVignette.value = vignette;
      const arcade = !!look;
      if (arcade !== (m.defines.GRADE_ARCADE !== undefined)) {
        if (arcade) m.defines.GRADE_ARCADE = ''; else delete m.defines.GRADE_ARCADE;
        m.needsUpdate = true;
      }
      u.uGradeFilm.value.set(look?.film ?? 0, look?.vibrance ?? 0);
      u.uGradeShadow.value.set(look?.shadows ?? '#000000').multiplyScalar(look?.shadows ? (look.tint ?? 0.12) : 0);
      u.uGradeHigh.value.set(look?.highlights ?? '#000000').multiplyScalar(look?.highlights ? (look.tint ?? 0.12) : 0);
    }
    this.bloom.strength = bloom.strength; this.bloom.radius = bloom.radius; this.bloom.threshold = bloom.threshold;
  }

  // v3:environment The air and the lens. fog: null, or { density, falloffM, baseM, max, haze (the far
  // world's ring texture, or null), color (THREE.Color, linear), gain, sunGlow, sunTight,
  // sunDir, sunColor }. dof: null or { focusM, rangeM, maxPx, near }. blur: null or
  // { strength, ball: [u, v], keep }. Each part is compiled in only while it is asked for.
  setEnv({ fog = undefined, dof = undefined, blur = undefined, allowed = undefined, lens = undefined } = {}) {
    const s = this._envState, m = this.env.material, u = m.uniforms;
    if (allowed !== undefined) s.allowed = !!allowed;
    // lens: the depth of field and motion blur code is compiled in and waits at zero strength,
    // so the first shot that wants it does not stop to compile a shader
    if (lens !== undefined) s.lens = !!lens;
    if (fog !== undefined) {
      s.fog = !!fog;
      if (fog) {
        u.uFogA.value.set(fog.density ?? 0.00042, 1 / Math.max(10, fog.falloffM ?? 140), fog.baseM ?? 0, fog.max ?? 1);
        u.uFogB.value.set(fog.gain ?? 1, fog.sunGlow ?? 0.2, fog.sunTight ?? 10, 0);
        u.uHaze.value = fog.haze || null;
        u.uFogMix.value = fog.haze ? (fog.colorMix ?? 0) : 1;
        if (fog.color) u.uFogCol.value.copy(fog.color);
        if (fog.sunDir) u.uSunDir.value.copy(fog.sunDir).normalize();
        if (fog.sunColor) u.uSunCol.value.copy(fog.sunColor);
      }
    }
    if (dof !== undefined) {
      s.dof = !!dof && dof.maxPx > 0.05;
      if (s.dof) u.uDof.value.set(dof.focusM ?? 10, Math.max(0.5, dof.rangeM ?? 8), dof.maxPx ?? 9, dof.near ?? 0.6);
      else u.uDof.value.z = 0;
      // v3:env-polish the contact shading is laid AFTER this pass, sharp, from the scene's depth: over a
      // blurred background its edge pixels stood out as black specks along every silhouette.
      // It fades as the blur comes up (what is in focus on a pin close-up is a ball on a green).
      if (this.gtao) this.gtao.blendIntensity = s.dof ? 1 - Math.min(1, (dof.maxPx ?? 9) / 3) : 1;
    }
    if (blur !== undefined) {
      s.blur = !!blur && blur.strength > 0.01;
      if (s.blur) u.uBlur.value.set(blur.strength, blur.ball?.[0] ?? 0.5, blur.ball?.[1] ?? 0.5, blur.keep ?? 0.1);
      else u.uBlur.value.x = 0;
    }
    const want = { ENV_FOG: s.allowed && s.fog, ENV_DOF: s.allowed && (s.lens || s.dof), ENV_BLUR: s.allowed && (s.lens || s.blur) };
    let changed = false;
    m.defines = m.defines || {};
    for (const [k, on] of Object.entries(want)) {
      if (on !== (m.defines[k] !== undefined)) { if (on) m.defines[k] = ''; else delete m.defines[k]; changed = true; }
    }
    if (changed) m.needsUpdate = true;
    // the pass itself runs only while it has something to do
    this.env.enabled = want.ENV_FOG || (s.allowed && (s.dof || s.blur));
    return this.env.enabled;
  }
  // whether the pass is laying the haze (the scene then turns its own fog off)
  get envFog() { return this.env.enabled && this.env.material.defines.ENV_FOG !== undefined; }

  setSize(w, h) {
    // Track the renderer's current pixel ratio, then size the composer; it
    // multiplies by pixelRatio internally and propagates to every pass.
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    const pr = this.renderer.getPixelRatio();
    this.cas.uniforms.uTexel.value.set(1 / Math.max(1, w * pr), 1 / Math.max(1, h * pr));
    this.env.uniforms.uTexel.value.set(1 / Math.max(1, w * pr), 1 / Math.max(1, h * pr));
  }

  setSharpness(v) {
    this.cas.uniforms.uSharp.value = v;
  }

  render() {
    // the composer ping-pongs its targets: point GTAO at the one the scene renders into
    if (this.gtao?.enabled) this.gtao.setGBuffer(this.composer.readBuffer.depthTexture);
    if (this.env.enabled) {
      // v3:environment the depth the RenderPass is about to write, and this frame's camera
      const u = this.env.uniforms, cam = this.camera;
      u.tDepth.value = this.composer.readBuffer.depthTexture;
      u.uProjInv.value.copy(cam.projectionMatrixInverse);
      u.uCamWorld.value.copy(cam.matrixWorld);
      u.uCamPos.value.setFromMatrixPosition(cam.matrixWorld);
      u.uPrevViewProj.value.copy(this._prevViewProj);
    }
    this._prevViewProj.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    this.composer.render();
  }
}
