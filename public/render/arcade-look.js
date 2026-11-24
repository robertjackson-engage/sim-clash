// The ARCADE look: the same procedural renderer pushed toward the concept art in
// docs/art/concepts (a bright mobile-arcade style): candy-green striped fairways, white sand,
// turquoise water with a foam rim, a warm low sun with long soft shadows, a light pastel
// haze, brighter canopies, a big yellow flag and a fat glowing tracer.
//
// ONE SOURCE OF TRUTH: scene.look ('real' | 'arcade'). Everything the look changes is a
// number or a colour in ARCADE_LOOK below; the render files read it through the small
// look*() helpers here, and every helper hands back its input untouched (the same object,
// the same number) in the 'real' look, so the default rendering stays pixel-identical
// (docs/arcade-look.md lists each hook).
//
//   scene.setLook('arcade')        switch at run time (rebuilds the course scenery)
//   new GolfScene(el, { look })    or start in it
//
// THEMES: every arcade stage is its own world. A course says which with
// course.arcade = { theme, timeOfDay } (docs/dev/arcade-v2-contract.md); a theme is a layer
// of overrides on ARCADE_LOOK (ARCADE_THEMES below), the time of day another on top, and
// resolveLook() merges them into one complete look of ARCADE_LOOK's shape. The scene
// keeps the one for the course that is loaded (scene._arcadeLook) and every hook reads it
// when it is handed the scene. A course without a theme, and 'tropical' by day, resolve
// to ARCADE_LOOK itself: nothing about them can have moved.
import * as THREE from 'three';
import { makePin } from './pin-flag.js';
import { RocketFx, makeGlow } from './shot-fx.js';
import { ballSkinColor } from './ball-skins.js';

export const LOOKS = Object.freeze(['real', 'arcade']);
export const DEFAULT_LOOK = 'real';

export function parseLook(value) {
  const v = String(value ?? '').trim().toLowerCase();
  return LOOKS.includes(v) ? v : DEFAULT_LOOK;
}

// Every knob of the arcade look. Colours are sRGB hex, as they would be picked off the
// concept art; the helpers convert. Tune here, reload the page (docs/arcade-look.md).
export const ARCADE_LOOK = {
  // --- the ground's colours (replaces course-character.js COLORS key for key) ---
  palette: {
    base: '#57a33a',      // the unlabeled ground between holes: lush, a step under the fairway
    rough: '#4a9634',     // deep saturated rough
    wood: '#2f6f30',
    range: '#6bb33e',
    fairwayA: '#84c63e', fairwayB: '#76b937',   // candy lime; the stripes come from the shader
    greenA: '#9bd84a', greenB: '#8ecd43',       // the putting surface: lighter and yellower
    tee: '#8ccb42',
    bunker: '#fbf1d8',    // near-white sand
    water: '#1fb6cf',
  },
  // --- course character: every arcade course is lush parkland ---
  character: { courseDry: 0, fescue: 0 },
  // --- the turf shader (turf.js, behind #ifdef TURF_ARCADE) ---
  turf: {
    stripeStatic: 1.0,      // 0 = a view-dependent sheen (real grass), 1 = painted bands seen the same from every side
    stripeGain: 0.85,       // the bands' strength (x the real look's sheen at its strongest: painted, they need no more)
    crossGain: 0.2,         // the fainter set at right angles: 1 turns the fairway into a plaid
    stripeM: 6.5,           // band width (m); the real look cuts 4.5 m
    saturation: 1.0,        // the grass's own chroma, before the frame's grade
    gain: 1.0,              // and its brightness
    collar: '#b4e45c',      // the apron ring round a green
    sand: '#fff6e2',        // the sand's colour
    sandMix: 0.82,          // how far sand painted on the ground itself goes to it
    sandGain: 1.12,         // the bunker meshes: brighter ...
    sandGlow: 0.24,         // ... and this much of the colour given back unlit, so a bunker stays cream under a low sun or in a tree's shade
    // the aerial photo's hold on the ground (config.js courseAerial*): candy colours need
    // most of it gone
    macro: { closeWeight: 0.22, farWeight: 0.3, photoFar: 0.12 },
    normalScale: 0.8,       // the blade normal map's strength (0.8 is the real look's; snow is smoother)
    sandTint: null,         // a theme's sand: the bunker meshes' colour is multiplied by it (black volcanic sand)
    // steep ground is rock, not turf smeared down a face (turf.js TURF_CLIFF): its two
    // colours in strata `strataM` apart, taking over between `to` and `from` (the cosine of
    // the slope: 0.8 is 37 degrees, 0.6 is 53). null = the turf everywhere, as it was.
    cliff: { a: '#9a8a72', b: '#75675a', from: 0.6, to: 0.8, strataM: 3 },
    // night golf (themes): { lift, edge, edgeGain, greenEdge, greenEdgeGain }. The mown
    // ground gives back `lift` of its own colour unlit, and the fairway's and the green's
    // edges glow. null compiles none of it (turf.js TURF_GLOW).
    glow: null,
  },
  // --- water (water.js, behind #ifdef WATER_ARCADE) ---
  water: {
    deep: '#0f6fc0',        // the pond's body
    shallow: '#48e6d2',     // the glowing shallows at the bank (needs the terrain depth pre-pass: High graphics, pond within 300 m)
    shallowReachM: 1.5,     // metres of depth over which the shallows fade
    shallowMix: 0.9,
    foam: '#ffffff',
    foamM: 0.26,            // the foam line: the depth of water (m) it covers at the bank
    reflect: 0.55,          // share of the mirror / sky reflection kept (1 = the real look)
    glint: 1.6,             // the sun's glitter, x the real look's
    chopMul: 1,             // the ripples' height, x what the day's wind gives (a frozen tarn: 0.15)
    // self-lit water (themes): { mode: 'lava' | 'neon', color, hot, crust, strength, scaleM, speed }.
    // null compiles none of it (water.js WATER_GLOW).
    glow: null,
    sea: {
      deep: '#1268c4', scatter: '#25c2d6', shallow: '#56ecd9',
      shallowReachM: 55,    // the turquoise band off the shore (the real look clears over 14 m)
      foamM: 3.2,           // a solid wash this wide along the waterline
      reflect: 0.6,
    },
  },
  // --- the sun and the fill (applied over whichever sky is picked; overcast skies keep their own sun) ---
  light: {
    sunColor: '#ffd49a',    // warm gold
    sunIntensityMul: 1.12,
    sunAltitudeDeg: 21,     // low: long shadows, rim light on the crowns
    environmentMul: 1.45,   // more sky fill: shadows go soft blue, not black
    exposureMul: 1.0,
    shadowRadiusMul: 2.2,   // softer shadow edges (x quality.js shadowRadius)
    // one scene-level fill light (themes: night, dusk, a volcano's up-light from the lava):
    // { sky, ground, intensity } for a HemisphereLight; null = none
    fill: null,
  },
  // --- haze: thin, and pulled toward a pastel ---
  fog: { color: '#ffd9c2', colorMix: 0.5, densityMul: 0.55 },
  // --- sky: an existing preset (sky-presets.js), nothing new fetched beyond what that preset already uses ---
  sky: {
    preset: 'golden',       // switched to on entering the look (null = keep the player's sky)
    backgroundIntensity: 1.12,
    // a painted sky in place of a photo (themes; arcade-sky.js paintSky's spec, plus
    // `light`: the whole sky preset that goes with it). null = the photo.
    paint: null,
  },
  // --- the frame: tone mapping, grade, bloom (postfx.js) ---
  grade: {
    toneMapping: 'neutral', // 'neutral' keeps saturated colours saturated; 'aces' (the real look) greys them
    contrast: 1.06,
    saturation: 1.2,
    vignette: 0.2,
    bloom: { strength: 0.12, radius: 0.55, threshold: 1.4 },
  },
  // --- trees (trees.js): the leaf tint per species, how far the photo atlas takes it, its brightness ---
  trees: {
    leaves: { oak: '#7cc437', maple: '#6fbb35', birch: '#a5dc48', pine: '#58ad42', fir: '#48a14a' },
    leafMix: 0.8,           // the real look tints 0.45 of the way
    leafGain: 1.75,         // ... at 0.92 brightness
    // how a theme draws course.trees (lookTreeSpots here; trees.js TREE_THEME):
    species: null,          // { oak: 'fir', ... }, or one species name for every tree
    scale: 1,               // x each tree's drawn size (kept near 1: the ball hits the real one)
    // { paint: { species: hex }, paintMix, snow: hex, snowAmount, uplight: hex, uplightGain }:
    // leaves repainted (blossom), snow on the crowns, a warm light from below
    fx: null,
  },
  // --- the pin ---
  flag: {
    colors: { cloth: '#ffd21f', hem: '#f0b400', ink: '#2a2118' },
    scale: 1.9,             // the cloth, x its real 0.72 x 0.46 m
    poleScale: 1.3,         // the pole's height, x its real 2.3 m
    glow: 0,                // the cloth's own colour given back unlit (night themes)
  },
  // --- the shot (shot-fx.js, impact-fx.js) ---
  trail: {
    color: '#ffd93a', core: '#fffbe6',
    widthPx: 16,            // the comet's width at the ball (the real tracer is 6 px)
    freshS: 0.45,           // the comet on the ball: seconds of flight it tapers over
    thin: 0.5,              // the trail behind it: its share of the width (8 px)
    tail: 0.7,              // ... and of the strength (the real tracer fades to 0.3)
    gain: 1.6,              // brightness (it blooms)
    headGlowPx: 34,         // the glow round the ball in flight (real: 13 px)
    // BALL CAM (scene.shotCam === 'ball'): the camera sits right behind the ball and the trail
    // streams back at the lens, so it is a bold tapered streak, thick at the ball and
    // narrowing to a fine line over about a second of flight, fading out before it reaches
    // the lens (nearM: gone at the first distance from the camera, whole from the second).
    // The other cameras see the trail from the side and keep the thinner one above.
    // taper: [m, m, share]: full width from the second distance from the camera, down to the share by the first.
    ballCam: { widthPx: 44, freshS: 1.1, thin: 0.14, tail: 0.34, gain: 1.25, nearM: [1.2, 3.6], taper: [1.5, 6.0, 0.22], headGlowPx: 40 },
    // a dark rim along the trail (themes: a bright trail over snow or lava):
    // { color, strength }; null compiles none of it (shot-fx.js TRACER_OUTLINE)
    outline: null,
  },
  // --- the ball in flight (themes): a dark halo behind it, so a white ball is not lost
  // against snow: { color, px, alpha }; null = none
  ball: { halo: null },
  impact: { sizeMul: 1.6, countMul: 1.35 },
  // --- the rocket ball: a good shot's exhaust (playShot opts.trailHeat, any look; shot-fx.js RocketFx) ---
  rocket: {
    color: '#ff8a1f',       // the flame's colour when the shot gives no trailColor
    lengthPx: [70, 190],    // the flame's length off the club at heat 0 .. 1 (it shrinks to ~55% of that by landing)
    widthPx: [22, 38],      // wider than the trail's 16 px comet, or it hides in it
    sparksPerS: 140,        // sparks shed a second at heat 1 off the club
    sparkPx: [3, 6],
    burst: 34,              // sparks thrown up where it first comes down
    sparks: 120,            // the pool (live at once) ...
    lowSparks: 40,          // ... on Low graphics,
    lowRate: 0.4,           // with this share of the rate
    glowPx: [1.0, 1.25],    // the glow round the ball, x its size, at heat 0 .. 1 (much bigger and it hides the flame)
    glowAlpha: 0.35,        // ... and this much brighter at heat 1
  },
  // --- GLB set pieces (props.js): matte, non-metal, a little of their own colour given back as glow ---
  // emissive: x the procedural props' glowing parts (lava cracks, windows, neon);
  // self: their own colour given back unlit, so they still read at night
  props: { roughness: 0.9, metalness: 0, envMapIntensity: 1.15, glow: 0.1, emissive: 0.6, self: 0.06 },
};

// ---------------------------------------------------------------- themes
export const THEMES = Object.freeze(['tropical', 'canyon', 'links', 'volcano', 'alpine', 'sakura', 'jungle', 'desert', 'neon', 'stadium']);
export const TIMES_OF_DAY = Object.freeze(['day', 'golden', 'dusk', 'night']);

const word = (v) => String(v ?? '').trim().toLowerCase();
// A theme name, or null for anything else (an unknown theme is no theme: the plain arcade look).
export const parseTheme = (v) => (THEMES.includes(word(v)) ? word(v) : null);
export const parseTimeOfDay = (v) => (TIMES_OF_DAY.includes(word(v)) ? word(v) : 'day');

// A painted night: deep blue, stars, a moon. `tint` lays a theme's own horizon over it.
const nightSky = (over = {}) => ({
  zenith: '#03040e', mid: '#0a1436', horizon: '#1d2c66', gain: 0.5, exponent: 0.6, ground: '#05070f',
  glows: [{ color: '#3a4fb0', widthDeg: 360, heightDeg: 9, strength: 0.22 }],
  disc: { azDeg: 28, altDeg: 34, color: '#eaf0ff', sizeDeg: 1.7, strength: 3.2, halo: 0.1 },
  stars: 1,
  clouds: null,
  // floodlit golf: a cool, high key light with short shadows
  light: { sunColor: '#e4ecff', sunIntensity: 2.0, sunAzimuthDeg: 205, sunAltitudeDeg: 56, environmentIntensity: 1.0, exposure: 0.95, fogDensity: 0.00028 },
  ...over,
});
// A painted dusk: the sun just down ahead and to the left of a hole played north.
const duskSky = (over = {}) => ({
  zenith: '#141b4a', mid: '#6a3f86', horizon: '#ff8d5c', gain: 0.62, exponent: 0.6, ground: '#191420',
  glows: [
    { color: '#ffb24a', azDeg: 318, widthDeg: 100, heightDeg: 8, strength: 1.5 },
    { color: '#ff5a8a', azDeg: 318, widthDeg: 220, heightDeg: 24, strength: 0.3 },
  ],
  disc: { azDeg: 318, altDeg: 3, color: '#ffd9a0', sizeDeg: 2.4, strength: 7, halo: 0.5 },
  stars: 0.35,
  clouds: { color: '#ff9c7c', cover: 0.42, scale: 4, strength: 0.45, lowDeg: 5, highDeg: 42 },
  light: { sunColor: '#ffb48c', sunIntensity: 2.7, sunAzimuthDeg: 282, sunAltitudeDeg: 17, environmentIntensity: 1.0, exposure: 0.95, fogDensity: 0.00034 },
  ...over,
});

// A volcano's sky: ash overhead, the lava lake's glow all round the horizon.
const volcanoSky = (over = {}) => ({
  zenith: '#0e0a10', mid: '#2c1318', horizon: '#8a2c12', gain: 0.7, exponent: 0.42, ground: '#1c0a07',
  glows: [{ color: '#ff5a14', widthDeg: 360, heightDeg: 6, strength: 0.5 }, { color: '#ffa23c', azDeg: 0, widthDeg: 120, heightDeg: 5, strength: 0.6 }],
  disc: { azDeg: 300, altDeg: 20, color: '#ff8a4a', sizeDeg: 2.2, strength: 3, halo: 0.35 },
  stars: 0,
  clouds: { color: '#5a2a20', cover: 0.62, scale: 3.4, strength: 0.6, lowDeg: 6, highDeg: 60 },
  light: { sunColor: '#ffe6d0', sunIntensity: 3.1, sunAzimuthDeg: 225, sunAltitudeDeg: 38, environmentIntensity: 1.0, exposure: 0.95, fogDensity: 0.0005 },
  ...over,
});

// What a time of day lays over a theme's daytime look. `golden` stays on a sky photo;
// `dusk` and `night` are painted, lit by one fill light and the turf's own glow, so the
// fairway, the green, the flag and the ball read from the tee: floodlit golf, not a dark screen.
const TIME_LAYERS = {
  day: {},
  golden: {
    sky: { preset: 'golden', paint: null },
    light: { sunColor: '#ffb469', sunIntensityMul: 1.08, sunAltitudeDeg: 12, environmentMul: 1.5, exposureMul: 1.0 },
    fog: { color: '#ffc59a', colorMix: 0.6, densityMul: 0.8 },
  },
  dusk: {
    sky: { preset: null, backgroundIntensity: 1, paint: duskSky() },
    light: { shadowRadiusMul: 2.6, fill: { sky: '#b3a4ff', ground: '#7a5a4a', intensity: 0.75 } },
    fog: { color: '#a8648c', colorMix: 0.6, densityMul: 1 },
    turf: { glow: { lift: 0.14, edge: '#ffe9a8', edgeGain: 0.5, greenEdge: '#ffffff', greenEdgeGain: 0.7 } },
    grade: { bloom: { strength: 0.17, radius: 0.55, threshold: 1.3 }, vignette: 0.26 },
    flag: { glow: 0.35 },
    props: { emissive: 0.9, self: 0.1 },
  },
  night: {
    sky: { preset: null, backgroundIntensity: 1, paint: nightSky() },
    light: { shadowRadiusMul: 2.8, fill: { sky: '#9db4ff', ground: '#3a4a66', intensity: 0.85 } },
    fog: { color: '#0b1430', colorMix: 1, densityMul: 1 },
    water: { reflect: 0.8, glint: 0.6 },
    turf: { glow: { lift: 0.26, edge: '#b8ffd0', edgeGain: 1.1, greenEdge: '#ffffff', greenEdgeGain: 1.5 } },
    grade: { bloom: { strength: 0.18, radius: 0.55, threshold: 1.28 }, vignette: 0.3, saturation: 1.22 },
    flag: { glow: 0.6 },
    trail: { gain: 1.9, headGlowPx: 40 },
    props: { emissive: 1.05, self: 0.12 },
  },
};

// The ten worlds. `look`: the theme by day, laid over ARCADE_LOOK. `times`: what the theme
// itself adds at a time of day, over TIME_LAYERS. `always`: a theme that only exists at
// one time of day (the neon city is a night).
export const ARCADE_THEMES = Object.freeze({
  // Lagoon Island, Bullseye Bay: the arcade look as it has always been
  tropical: { look: {} },

  // Canyon Run: red rock, a turquoise river, dusty juniper scrub
  canyon: {
    look: {
      palette: { base: '#c4703c', rough: '#b96a3b', wood: '#8a4e2c', range: '#c98a4a', fairwayA: '#8cc640', fairwayB: '#7db838', greenA: '#a4dc4e', greenB: '#96d045', tee: '#93cf46', bunker: '#ffe3b0', water: '#22b3c2' },
      turf: { collar: '#c2e65e', sand: '#ffe4b4', sandGlow: 0.2, cliff: { a: '#cc6a3c', b: '#a04626', strataM: 4.5 } },
      water: { deep: '#0f7f96', shallow: '#62e6cf', sea: { deep: '#0f6f9e', scatter: '#2cc0c8', shallow: '#62e6cf' } },
      light: { sunColor: '#ffc88e', sunAltitudeDeg: 26, sunIntensityMul: 1.1 },
      fog: { color: '#ffb98c', colorMix: 0.65, densityMul: 0.6 },
      sky: { preset: 'morning' },
      trees: { species: { oak: 'pine', maple: 'pine', birch: 'pine', fir: 'pine' }, scale: 0.85, leaves: { oak: '#9aa85a', maple: '#9aa85a', birch: '#a8b464', pine: '#8ea252', fir: '#8ea252' }, leafMix: 0.85, leafGain: 1.5 },
    },
  },

  // Lighthouse Point: a windswept clifftop, golden fescue, a cold deep sea
  links: {
    look: {
      palette: { base: '#9aa24e', rough: '#a5a550', wood: '#5c7a3a', range: '#8fae4c', fairwayA: '#7fc44c', fairwayB: '#71b745', greenA: '#93d65c', greenB: '#86ca54', tee: '#84c850', bunker: '#f4ead0', water: '#1c6fb0' },
      turf: { collar: '#b0de62', stripeGain: 0.7, cliff: { a: '#8c867a', b: '#666158', strataM: 2.4 } },
      water: { deep: '#0d4f8c', shallow: '#3fc3c9', glint: 2.0, sea: { deep: '#0e4a9a', scatter: '#2a9fc4', shallow: '#4fd3d0', shallowReachM: 30, foamM: 4.5 } },
      light: { sunColor: '#fff0d4', sunAltitudeDeg: 30, sunIntensityMul: 1.05, environmentMul: 1.35 },
      fog: { color: '#dfeaf2', colorMix: 0.5, densityMul: 0.8 },
      sky: { preset: 'morning' },
      trees: { leaves: { oak: '#6a9a3a', maple: '#6a9a3a', birch: '#8ab04a', pine: '#4f8a44', fir: '#467f48' }, leafGain: 1.5, scale: 0.9 },
    },
  },

  // Volcano Drop: basalt and ash, a lake of molten rock, an ember sky
  volcano: {
    look: {
      palette: { base: '#3b2b29', rough: '#4a3530', wood: '#2a1d1c', range: '#4a3a34', fairwayA: '#86c63c', fairwayB: '#78b835', greenA: '#a8e04c', greenB: '#9ad444', tee: '#8ecb42', bunker: '#6b625c', water: '#ff5a14' },
      turf: { collar: '#c6ea5c', sand: '#70665f', sandMix: 0.9, sandGain: 0.9, sandGlow: 0.05, sandTint: '#8a7f78', cliff: { a: '#40302e', b: '#221a1c', strataM: 5 }, glow: { lift: 0.16, edge: '#ffb060', edgeGain: 0.45, greenEdge: '#ffe9c0', greenEdgeGain: 0.8 } },
      water: {
        deep: '#a82604', shallow: '#ffb21f', shallowReachM: 2.2, shallowMix: 0.95, foam: '#fff2a8', foamM: 0.45, reflect: 0.04, glint: 0, chopMul: 0.5,
        glow: { mode: 'lava', color: '#ff4a0c', hot: '#ffd24a', crust: '#2a0803', strength: 1, scaleM: 16, speed: 0.045 },
        sea: { deep: '#a82604', scatter: '#ff7a1a', shallow: '#ffc23a', shallowReachM: 26, foamM: 2.2, reflect: 0.04 },
      },
      light: { shadowRadiusMul: 2.4, fill: { sky: '#b08a90', ground: '#ff6a2a', intensity: 0.5 } },
      fog: { color: '#4a1c10', colorMix: 0.85, densityMul: 1 },
      sky: { preset: null, backgroundIntensity: 1, paint: volcanoSky() },
      grade: { bloom: { strength: 0.18, radius: 0.55, threshold: 1.28 }, vignette: 0.3, saturation: 1.22 },
      trees: { species: 'birch', leaves: { birch: '#7a3b22' }, leafMix: 0.9, leafGain: 1.0, scale: 0.9, fx: { paint: { birch: '#8a3a1c' }, paintMix: 0.8, uplight: '#ff5a1e', uplightGain: 0.5 } },
      flag: { glow: 0.3 },
      trail: { color: '#7df9ff', core: '#ffffff', outline: { color: '#1a0503', strength: 0.55 } },
      ball: { halo: { color: '#160402', px: 44, alpha: 0.5 } },
      props: { emissive: 0.95, self: 0.1 },
    },
    // there is no blue sky over a volcano: every time of day is its own ash and ember
    times: {
      golden: { sky: { preset: null, paint: volcanoSky() }, light: { sunColor: '#ffc88e', sunIntensityMul: 1.12, sunAltitudeDeg: 21, environmentMul: 1.45 }, fog: { color: '#5e2413', colorMix: 0.85, densityMul: 1 } },
      dusk: { sky: { paint: volcanoSky({ gain: 0.6, light: { sunColor: '#ffdcc4', sunIntensity: 2.6, sunAzimuthDeg: 240, sunAltitudeDeg: 34, environmentIntensity: 1.0, exposure: 0.95, fogDensity: 0.0005 } }) }, fog: { color: '#3a140c', colorMix: 0.9 }, light: { fill: { sky: '#b08a90', ground: '#ff6a2a', intensity: 0.55 } } },
      night: { sky: { paint: volcanoSky({ gain: 0.42, stars: 0.3, disc: null, light: { sunColor: '#ffe0cc', sunIntensity: 2.0, sunAzimuthDeg: 205, sunAltitudeDeg: 55, environmentIntensity: 1.0, exposure: 0.95, fogDensity: 0.0005 } }) }, fog: { color: '#2a0d08', colorMix: 1 }, light: { fill: { sky: '#a88a98', ground: '#ff6a2a', intensity: 0.6 } }, turf: { glow: { edge: '#ffb060', greenEdge: '#ffe9c0' } } },
    },
  },

  // Frostbite Ridge, Ice Pick: snow off the fairway, a frozen lake, pines under snow
  alpine: {
    look: {
      palette: { base: '#eef4fb', rough: '#e4edf7', wood: '#cfdcea', range: '#dfe9f3', fairwayA: '#6fc05c', fairwayB: '#62b453', greenA: '#8ad86c', greenB: '#7dcc62', tee: '#7cc864', bunker: '#d8c49a', water: '#a9d8f0' },
      // baseLift: snow gives back a third of its own colour unlit, or a low sun leaves it grey
      turf: { collar: '#a6e486', sand: '#e2cfa6', sandGlow: 0.14, saturation: 0.98, normalScale: 0.22, cliff: { a: '#8e98aa', b: '#7a8498', strataM: 6 }, glow: { lift: 0, baseLift: 0.34, edge: null, greenEdge: null } },
      water: {
        deep: '#86c2e6', shallow: '#dcf3ff', shallowReachM: 2.5, shallowMix: 0.8, foam: '#ffffff', foamM: 0.5, reflect: 0.8, glint: 2.2, chopMul: 0.12,
        sea: { deep: '#5fa8d8', scatter: '#a9dcf0', shallow: '#dcf3ff', shallowReachM: 40, foamM: 5, reflect: 0.7 },
      },
      light: { sunColor: '#fff4e2', sunAltitudeDeg: 27, sunIntensityMul: 0.92, environmentMul: 1.2, exposureMul: 0.9 },
      fog: { color: '#e4eefa', colorMix: 0.8, densityMul: 0.9 },
      sky: { preset: 'morning', backgroundIntensity: 1.05 },
      grade: { saturation: 1.12, bloom: { strength: 0.1, radius: 0.5, threshold: 1.7 } },
      trees: {
        species: { oak: 'fir', maple: 'fir', birch: 'pine' }, leaves: { fir: '#3f8a5c', pine: '#4a9460' }, leafMix: 0.85, leafGain: 1.35,
        fx: { snow: '#f4f9ff', snowAmount: 0.8 },
      },
      flag: { colors: { cloth: '#ff3b30', hem: '#c81e1e', ink: '#ffffff' } },
      trail: { color: '#ff3d6e', core: '#ffd9a8', gain: 1.25, outline: { color: '#0d1b3a', strength: 0.7 } },
      ball: { halo: { color: '#0d1b3a', px: 48, alpha: 0.6 } },
    },
    times: {
      // moonlit snow is already bright: no lift, a quieter fill
      night: { light: { fill: { sky: '#9db4ff', ground: '#8ea4d8', intensity: 0.55 } }, turf: { glow: { lift: 0.2, baseLift: 0.16 } } },
      dusk: { turf: { glow: { baseLift: 0.22 } } },
    },
  },

  // Sakura Garden: moss, raked white gravel, a green koi pond, blossom
  sakura: {
    look: {
      palette: { base: '#6fb04c', rough: '#62a546', wood: '#3f7a3a', range: '#7dba52', fairwayA: '#90d054', fairwayB: '#83c54c', greenA: '#a6e262', greenB: '#99d75a', tee: '#96d458', bunker: '#f6ecd9', water: '#2f8a5c' },
      turf: { collar: '#c2ec7a', cliff: { a: '#938d82', b: '#6f6a62', strataM: 2.6 } },
      water: { deep: '#1f6b4a', shallow: '#86e6a6', shallowReachM: 1.2, foam: '#f0fff2', foamM: 0.12, reflect: 0.72, glint: 1.2, chopMul: 0.45 },
      light: { sunColor: '#ffe4e0', sunAltitudeDeg: 30, environmentMul: 1.5 },
      fog: { color: '#ffd4e4', colorMix: 0.7, densityMul: 0.95 },
      sky: { preset: 'morning' },
      grade: { saturation: 1.18 },
      trees: {
        species: { fir: 'pine' }, leaves: { oak: '#ff8fc0', maple: '#ffb3d6', birch: '#ffe1ee', pine: '#4f9a4a' }, leafMix: 0.6, leafGain: 1.5,
        fx: { paint: { oak: '#ff86bc', maple: '#ffaed4', birch: '#ffe6f1' }, paintMix: 0.92 },
      },
      flag: { colors: { cloth: '#ff4f9a', hem: '#d82f78', ink: '#ffffff' } },
    },
  },

  // Temple Run: deep green, lime fairways, a jade river, mist
  jungle: {
    look: {
      palette: { base: '#2f7f2c', rough: '#2b7629', wood: '#1c5220', range: '#3a8a30', fairwayA: '#84d43c', fairwayB: '#74c634', greenA: '#a4e64a', greenB: '#96da42', tee: '#8cd640', bunker: '#ecd9a6', water: '#2a9a78' },
      turf: { collar: '#c4f05c', cliff: { a: '#7a745e', b: '#4f5a40', strataM: 3.4 } },
      water: { deep: '#1a6a55', shallow: '#66dca4', foam: '#eaffe2', reflect: 0.5, sea: { deep: '#176a5c', scatter: '#3fc0a0', shallow: '#74e2b0' } },
      light: { sunColor: '#fff0c4', sunAltitudeDeg: 36, sunIntensityMul: 1.05, environmentMul: 1.3 },
      fog: { color: '#b4e4ac', colorMix: 0.75, densityMul: 1.7 },
      sky: { preset: 'morning' },
      grade: { saturation: 1.24, contrast: 1.08 },
      trees: { species: { pine: 'maple', fir: 'oak' }, scale: 1.18, leaves: { oak: '#2f9a3a', maple: '#3fae35', birch: '#6fc840' }, leafMix: 0.85, leafGain: 1.5 },
    },
  },

  // Pharaoh's Gate: sand to the horizon, oasis greens, a hard high sun
  desert: {
    look: {
      palette: { base: '#dcb56c', rough: '#d4aa60', wood: '#b9955a', range: '#d8b872', fairwayA: '#86c444', fairwayB: '#78b83c', greenA: '#9eda4e', greenB: '#90ce46', tee: '#8ccc46', bunker: '#fff6dc', water: '#1fb6cf' },
      turf: { collar: '#c0e85e', sand: '#fff8e4', sandGain: 1.16, sandGlow: 0.28, cliff: { a: '#e2b26c', b: '#bd8648', strataM: 3.6 } },
      light: { sunColor: '#fff2cc', sunAltitudeDeg: 38, sunIntensityMul: 1.0, environmentMul: 1.3 },
      fog: { color: '#f6dfb0', colorMix: 0.75, densityMul: 0.8 },
      sky: { preset: 'midday' },
      trees: { species: { fir: 'oak', pine: 'oak', maple: 'oak' }, scale: 0.85, leaves: { oak: '#8f9a4a', birch: '#a0a856' }, leafMix: 0.85, leafGain: 1.35 },
    },
  },

  // Midnight Mile: a night city. Black water with neon in it, glowing fairway edges
  neon: {
    always: 'night',
    look: {
      palette: { base: '#1c3c48', rough: '#27605a', wood: '#122c30', range: '#27584e', fairwayA: '#36c66c', fairwayB: '#2cb660', greenA: '#62f2a2', greenB: '#54e496', tee: '#4ada86', bunker: '#cbbaff', water: '#05070f' },
      turf: { collar: '#9affc8', sand: '#d6c8ff', sandMix: 0.85, sandGlow: 0.34, sandTint: '#d8ccff', stripeGain: 1.0, cliff: { a: '#34325c', b: '#1e1c3a', strataM: 4 } },
      water: {
        deep: '#03040a', shallow: '#141e44', shallowReachM: 0.8, shallowMix: 0.6, foam: '#ff4fd8', foamM: 0.16, chopMul: 0.5,
        glow: { mode: 'neon', color: '#ff3df2', hot: '#3df2ff', crust: '#000000', strength: 0.75, scaleM: 9, speed: 0.25 },
        sea: { deep: '#03040a', scatter: '#1a1444', shallow: '#2a1a5c', shallowReachM: 12, foamM: 1.2, reflect: 1 },
      },
      trees: { leaves: { oak: '#2f9a62', maple: '#2f9a62', birch: '#49b070', pine: '#2a8a5c', fir: '#2a8a5c' }, leafMix: 0.8, leafGain: 1.2, fx: { uplight: '#ffb060', uplightGain: 0.7 } },
      flag: { colors: { cloth: '#ffe81f', hem: '#ff9f0a', ink: '#1a1030' } },
      trail: { color: '#3df2ff', core: '#ffffff' },
    },
    times: {
      night: {
        sky: {
          paint: nightSky({
            zenith: '#04030d', mid: '#100a2e', horizon: '#3c1668',
            glows: [{ color: '#ff3df2', widthDeg: 360, heightDeg: 7, strength: 0.4 }, { color: '#ff8a3c', azDeg: 0, widthDeg: 140, heightDeg: 5, strength: 0.5 }, { color: '#3d8aff', azDeg: 180, widthDeg: 160, heightDeg: 8, strength: 0.25 }],
            stars: 0.6,
            light: { sunColor: '#d4dcff', sunIntensity: 1.9, sunAzimuthDeg: 205, sunAltitudeDeg: 60, environmentIntensity: 1.0, exposure: 0.95, fogDensity: 0.0003 },
          }),
        },
        light: { fill: { sky: '#8f7bff', ground: '#a8408c', intensity: 0.8 } },
        fog: { color: '#1c0f3c', colorMix: 1 },
        water: { reflect: 1, glint: 0.3 },
        turf: { glow: { lift: 0.36, edge: '#ff3df2', edgeGain: 2.2, greenEdge: '#3df2ff', greenEdgeGain: 2.4 } },
        grade: { bloom: { strength: 0.17, radius: 0.5, threshold: 1.3 }, saturation: 1.26, vignette: 0.32 },
        props: { emissive: 1.0, self: 0.12 },
      },
    },
  },

  // Thunder Dome: a stadium pitch, mown in a plaid, under the lights
  stadium: {
    look: {
      palette: { base: '#3f9c3a', rough: '#3a9436', wood: '#2a6a2c', range: '#4aa63e', fairwayA: '#70cc44', fairwayB: '#60be3c', greenA: '#8ee04a', greenB: '#80d442', tee: '#7cd044', bunker: '#ffffff', water: '#1fb6cf' },
      turf: { stripeGain: 1.05, crossGain: 0.85, stripeM: 5, collar: '#b8f060', cliff: { a: '#9ca2ae', b: '#7a808c', strataM: 2 } },
      light: { sunColor: '#fff4dc', sunAltitudeDeg: 34 },
      fog: { color: '#dcecff', colorMix: 0.5, densityMul: 0.6 },
      sky: { preset: 'midday' },
      trees: { leaves: { oak: '#56b03a', maple: '#56b03a', birch: '#7cc848', pine: '#3f9a44', fir: '#3a9048' }, leafGain: 1.6 },
    },
    times: {
      night: {
        sky: { paint: nightSky({ glows: [{ color: '#6a8cff', widthDeg: 360, heightDeg: 11, strength: 0.4 }], stars: 0.5, light: { sunColor: '#f2f6ff', sunIntensity: 2.5, sunAzimuthDeg: 200, sunAltitudeDeg: 62, environmentIntensity: 1.0, exposure: 0.98, fogDensity: 0.00024 } }) },
        light: { fill: { sky: '#c4d4ff', ground: '#4a6a4a', intensity: 1.0 } },
        turf: { glow: { lift: 0.3, edge: '#ffffff', edgeGain: 0.8, greenEdge: '#ffffff', greenEdgeGain: 1.6 } },
        props: { emissive: 1.15 },
      },
      dusk: { props: { emissive: 1.0 } },
    },
  },
});

const isPlain = (v) => v && typeof v === 'object' && !Array.isArray(v);
// `over` laid on `base`: plain objects merge key by key, anything else replaces.
function layer(base, over) {
  if (!isPlain(over)) return over === undefined ? base : over;
  const out = isPlain(base) ? { ...base } : {};
  for (const [k, v] of Object.entries(over)) out[k] = isPlain(v) && isPlain(out[k]) ? layer(out[k], v) : (isPlain(v) ? layer({}, v) : v);
  return out;
}
const RESOLVED = new Map();

// The time of day a theme is drawn at: the one asked for, unless the theme has only one.
export const themeTimeOfDay = (theme, timeOfDay) => ARCADE_THEMES[parseTheme(theme)]?.always || parseTimeOfDay(timeOfDay);

// The complete look for a theme at a time of day: an object of ARCADE_LOOK's shape, plus
// `theme` and `timeOfDay`. No theme (or an unknown one) is ARCADE_LOOK itself, whatever
// the time; so is 'tropical' by day.
export function resolveLook(theme, timeOfDay) {
  const t = parseTheme(theme);
  if (!t) return ARCADE_LOOK;
  const time = themeTimeOfDay(t, timeOfDay);
  if (t === 'tropical' && time === 'day') return ARCADE_LOOK;
  const key = `${t}|${time}`;
  let L = RESOLVED.get(key);
  if (!L) {
    const def = ARCADE_THEMES[t];
    L = layer(ARCADE_LOOK, def.look || {});
    L = layer(L, TIME_LAYERS[time]);
    L = layer(L, def.times?.[time] || {});
    L.theme = t;
    L.timeOfDay = time;
    RESOLVED.set(key, L);
  }
  return L;
}

// Dev override: ?theme=<name>&tod=<timeOfDay> forces a theme on whatever course is loaded
// in the arcade look (so a theme can be looked at before its hole exists).
let themeOverride;
export function lookThemeOverride() {
  if (themeOverride !== undefined) return themeOverride;
  themeOverride = null;
  try {
    const q = new URLSearchParams(globalThis.location?.search || '');
    const theme = parseTheme(q.get('theme'));
    const tod = q.get('tod') ?? q.get('timeOfDay');
    if (theme || tod) themeOverride = { theme, timeOfDay: tod ? parseTimeOfDay(tod) : null };
  } catch { /* no URL: no override */ }
  return themeOverride;
}
export function setLookThemeOverride(theme, timeOfDay = null) {
  themeOverride = theme || timeOfDay ? { theme: parseTheme(theme), timeOfDay: timeOfDay ? parseTimeOfDay(timeOfDay) : null } : null;
}

// The theme a course asks for: { theme, timeOfDay }, or null (the plain arcade look).
export function courseTheme(geo, override = lookThemeOverride()) {
  const a = geo && isPlain(geo.arcade) ? geo.arcade : null;
  const theme = override?.theme || parseTheme(a?.theme) || (override?.timeOfDay ? 'tropical' : null);
  if (!theme) return null;
  return { theme, timeOfDay: themeTimeOfDay(theme, override?.timeOfDay || a?.timeOfDay) };
}

// Point the scene at the look of the course it holds. True when that changed.
function syncTheme(scene) {
  const want = courseTheme(scene.geo);
  const key = want ? `${want.theme}|${want.timeOfDay}` : '';
  if (key === (scene._themeKey || '')) return false;
  scene._themeKey = key;
  scene._arcadeLook = want ? resolveLook(want.theme, want.timeOfDay) : null;
  return true;
}

// A hook's argument is the scene (its look, and its course's theme) or a bare look name
// ('real' | 'arcade': the plain arcade look).
const lookOf = (x) => {
  if (x && typeof x === 'object') return x.look === 'arcade' ? (x._arcadeLook || ARCADE_LOOK) : null;
  return x === 'arcade' ? ARCADE_LOOK : null;
};
// The scene's theme and time of day, for anything that wants to know (null in the real look).
export const lookTheme = (scene) => { const L = lookOf(scene); return L ? { theme: L.theme || null, timeOfDay: L.timeOfDay || 'day' } : null; };
const TONE_MAPPING = { aces: THREE.ACESFilmicToneMapping, neutral: THREE.NeutralToneMapping, agx: THREE.AgXToneMapping };
// what the scene builds the in-flight head glow with (scene.js constructor)
const HEAD_GLOW = Object.freeze({ color: 0xffe7a3, px: 13 });

// ---------------------------------------------------------------- pure hooks
// Each returns its input as it came in the 'real' look.

// The sky preset the light is taken from, with the look's sun and fill laid over it.
export function lookSkyPreset(preset, look) {
  const L = lookOf(look);
  if (!L || !preset) return preset;
  // a painted sky brings its whole preset with it (arcade-sky.js)
  if (L.sky.paint) return { label: 'Painted', hdri: null, painted: true, ...L.sky.paint.light };
  const s = L.light, clear = !preset.overcast;
  return {
    ...preset,
    sunColor: clear ? s.sunColor : preset.sunColor,
    sunIntensity: preset.sunIntensity * (clear ? s.sunIntensityMul : 1),
    sunAltitudeDeg: clear && s.sunAltitudeDeg != null ? s.sunAltitudeDeg : preset.sunAltitudeDeg,
    environmentIntensity: preset.environmentIntensity * s.environmentMul,
    exposure: preset.exposure * s.exposureMul,
    fogDensity: preset.fogDensity * L.fog.densityMul,
  };
}

// The painted sky a theme brings in place of a sky photo (arcade-sky.js paintSky's spec), or null.
export const lookSkyPaint = (look) => lookOf(look)?.sky.paint ?? null;

// The haze colour (a linear THREE.Color, changed in place).
export function lookFogColor(color, look) {
  const L = lookOf(look);
  if (!L) return color;
  return color.lerp(new THREE.Color(L.fog.color), L.fog.colorMix);
}

// The shadow's softness (the light's PCF radius).
export function lookShadowRadius(radius, look) {
  const L = lookOf(look);
  return L ? radius * L.light.shadowRadiusMul : radius;
}

// The sky to start in: the look's own (the player's is kept to go back to).
export function lookSkySetting(scene, setting) {
  const L = lookOf(scene);
  if (!L || !L.sky.preset) return setting;
  scene._skyBeforeLook = setting;
  return L.sky.preset;
}

export const lookFlagColors = (look) => lookOf(look)?.flag.colors;   // undefined = pin-flag.js's red
export const lookTurf = (look) => lookOf(look)?.turf ?? null;        // makeTurfMaterial({ arcade })
export const lookWater = (look) => lookOf(look)?.water ?? null;      // buildWater(..., look)
export const lookTrees = (look) => lookOf(look)?.trees ?? null;      // new TreeField(..., { look })
export const lookProps = (look) => lookOf(look)?.props ?? null;      // PropsLayer({ style })

// course.trees as a theme draws them (scene._addTrees): species swapped (snow country is
// all conifers, a jungle all broadleaf) and sizes scaled. The same array when the look
// asks for neither. Positions and count never change: the ball still hits the real tree.
export function lookTreeSpots(spots, look) {
  const T = lookOf(look)?.trees;
  if (!T || (!T.species && (T.scale ?? 1) === 1)) return spots;
  const k = T.scale ?? 1;
  return spots.map((s) => {
    const from = s.species || 'oak';
    const species = typeof T.species === 'string' ? T.species : (T.species?.[from] ?? from);
    const out = { ...s, species };
    if (k !== 1) {
      if (s.s != null) out.s = s.s * k;
      if (s.h != null) out.h = s.h * k;
      if (s.r != null) out.r = s.r * k;
    }
    return out;
  });
}

// A bunker mesh's sand material (turf.js makeSandMaterial), in the look's sand.
export function lookSand(mat, look) {
  const L = lookOf(look);
  if (!L) return mat;
  if (L.turf.sandTint) mat.color.multiply(new THREE.Color(L.turf.sandTint));
  mat.color.multiplyScalar(L.turf.sandGain);
  mat.emissive.set(L.turf.sand);
  mat.emissiveIntensity = L.turf.sandGlow;
  return mat;
}

// The palette (course-character.js keys) a course is painted with.
export function lookPalette(pal, look) {
  const L = lookOf(look);
  return L ? { ...pal, ...L.palette } : pal;
}

// One scene-level fill light for a theme (a HemisphereLight: night, dusk, a lava lake's
// up-light). Made the first time a theme wants one, switched off when the look has none.
function applyFill(scene, L) {
  const f = L?.light.fill;
  if (!f || !(f.intensity > 0)) {
    if (scene._lookFill) scene._lookFill.visible = false;
    return;
  }
  if (!scene._lookFill) {
    scene._lookFill = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
    scene._lookFill.name = 'lookFill';
    scene.scene.add(scene._lookFill);
  }
  scene._lookFill.color.set(f.sky);
  scene._lookFill.groundColor.set(f.ground);
  scene._lookFill.intensity = f.intensity;
  scene._lookFill.visible = true;
}

// Course load (scene.loadCourse, once the course's own character and aerial tint are
// set up): the look's palette, a lush character, the aerial photo's hold loosened.
export function lookCourse(scene) {
  if (scene.look !== 'arcade') return;
  // the course's theme: its look replaces the last course's (the pin, the grade, the fill
  // light and the sky go with it; the scenery is being built from it right now)
  if (syncTheme(scene)) applyTheme(scene);
  const L = lookOf(scene);
  if (L.character.courseDry != null) scene._courseDry = L.character.courseDry;
  if (L.character.fescue != null) scene._fescue = L.character.fescue;
  scene._pal = lookPalette(scene._pal, scene);
  for (const m of [scene._macro, ...(scene._hdMacros || [])]) if (m) Object.assign(m, L.turf.macro);
}

// The tracer ribbon's options (shot-fx.js ShotTracer) for a look: undefined = its defaults.
export function lookTracer(look) {
  const L = lookOf(look);
  if (!L) return undefined;
  // the ball cam's bold streak (trail.ballCam) when the scene is in that camera
  const bc = look && typeof look === 'object' && look.shotCam === 'ball' ? L.trail.ballCam : null;
  const t = bc ? { ...L.trail, ...bc } : L.trail;
  const out = { color: t.color, core: t.core, widthPx: t.widthPx, arcade: { freshS: t.freshS, thin: t.thin, tail: t.tail, gain: t.gain } };
  if (bc && bc.nearM) out.arcade.nearM = bc.nearM;
  if (bc && bc.taper) out.arcade.taper = bc.taper;
  if (t.outline) out.arcade.outline = t.outline;   // a dark rim, for a trail over snow or lava
  return out;
}

// The ball in flight on a theme where it would be lost (white on snow): a dark halo
// behind it. scene._updateShotFx calls this every frame; a look without one costs an `if`.
export function lookBallHalo(scene, inAir, pxWorld) {
  const want = inAir ? lookOf(scene)?.ball?.halo : null;
  let m = scene._ballHalo;
  if (!want) { if (m) m.visible = false; return; }
  if (!m) {
    m = scene._ballHalo = makeGlow({ color: want.color, px: want.px });
    m.renderOrder = 10.5;   // over the tracer, under the bright glow on the ball
    scene.scene.add(m);
  }
  const u = m.userData.uniforms;
  u.uColor.value.set(want.color);
  u.uPx.value = want.px;
  u.uAlpha.value = want.alpha ?? 0.5;
  u.uPxWorld.value = pxWorld;
  m.position.copy(scene.ball.position);
  m.visible = true;
}

// One shot's trail (scene.playShot). The arcade trail is drawn in the arcade look, or
// in any look for a shot played with opts.trail === true (opts.trail === false keeps the
// plain tracer in the arcade look); opts.trailColor tints the tracer and the glow round
// the ball for that shot (a power-up's colour). Returns the ShotTracer options, undefined
// for the plain tracer, and dresses the head glow to match (put back on the next plain shot).
export function shotTrail(scene, opts = {}) {
  const arcade = opts.trail === true || (opts.trail !== false && scene.look === 'arcade');
  // a power-up ball flies in its own colour (opts.ballSkin): trail, glow and flame agree with the ball
  const tint = ballSkinColor(opts.ballSkin) ?? opts.trailColor ?? null;
  const heat = rocketHeat(opts);
  const glow = scene.headGlow?.userData?.uniforms;
  if (!arcade && tint == null && !heat) {
    if (glow && scene._trailStyled) {
      glow.uColor.value.set(HEAD_GLOW.color);
      glow.uPx.value = HEAD_GLOW.px;
      glow.uAlpha.value = 1;
      scene._trailStyled = false;
    }
    return undefined;
  }
  const T = scene.look === 'arcade' ? lookOf(scene) : ARCADE_LOOK;   // the theme's trail in the arcade look
  const out = arcade ? lookTracer(scene.look === 'arcade' ? scene : 'arcade') : (tint != null ? {} : undefined);
  if (tint != null) {
    out.color = tint;
    // a tinted trail's core is that tint white-hot, not the look's cream
    if (arcade) out.core = new THREE.Color(1, 1, 1).lerp(new THREE.Color(tint), 0.25);
  }
  // a rocket ball's flame is its comet: the trail behind it is the plain line, start to end
  if (heat && arcade) { out.widthPx *= out.arcade.thin; out.arcade.thin = 1; }
  if (glow) {
    // the glow is the trail's colour, lifted toward white so the ball still reads as a ball;
    // a rocket ball's is bigger and brighter
    const R = ARCADE_LOOK.rocket;
    const color = out?.color ?? (heat ? R.color : null);
    if (color != null) glow.uColor.value.set(color).lerp(new THREE.Color(1, 1, 1), 0.3);
    else glow.uColor.value.set(HEAD_GLOW.color);
    const glowPx = arcade ? (scene.shotCam === 'ball' && T.trail.ballCam ? T.trail.ballCam.headGlowPx : T.trail.headGlowPx) : HEAD_GLOW.px;
    glow.uPx.value = glowPx * (heat ? R.glowPx[0] + (R.glowPx[1] - R.glowPx[0]) * heat : 1);
    glow.uAlpha.value = 1 + R.glowAlpha * heat;
    scene._trailStyled = true;
  }
  return out;
}

// A shot's heat, 0..1: opts.trailHeat > 0 makes it a rocket ball (never a putt).
const rocketHeat = (opts) => (!opts.isPutt && opts.trailHeat > 0 ? Math.min(1, Number(opts.trailHeat)) : 0);

// The rocket ball's exhaust for one shot (scene.playShot): a flame on the ball and the
// sparks behind it (shot-fx.js RocketFx), in the shot's trailColor. null for every shot
// without opts.trailHeat, so an ordinary shot builds nothing. carryM: the shot's carry,
// which the flame shrinks along. Fewer sparks on Low graphics.
export function shotRocket(scene, opts = {}, carryM = 0) {
  const heat = rocketHeat(opts);
  if (!heat) return null;
  const R = ARCADE_LOOK.rocket, low = scene.quality?.level === 'low';
  const fx = new RocketFx({
    heat, color: ballSkinColor(opts.ballSkin) ?? opts.trailColor ?? R.color, cfg: R,
    sparks: low ? R.lowSparks : R.sparks, sparkRate: low ? R.lowRate : 1,
  });
  fx.carryM = Math.max(1, carryM);
  return fx;
}

// ---------------------------------------------------------------- applying a look

// The arcade pin: a bigger cloth on a taller pole. The pin group's own scale belongs to
// the read-scale each frame (framing.js), so the parts are sized instead.
function stylePin(pinFlag, flag) {
  const kids = pinFlag.group.children;
  const cloth = kids.find((o) => o.geometry?.type === 'PlaneGeometry');
  const pole = kids.find((o) => o.geometry?.type === 'CylinderGeometry' && o.material?.map);
  if (!cloth || !pole) return;
  const poleH = pole.geometry.parameters.height;            // 2.3 m
  const clothH = cloth.geometry.parameters.height;          // 0.46 m
  pole.scale.y = flag.poleScale;
  pole.position.y = (poleH / 2) * flag.poleScale;
  cloth.scale.set(flag.scale, flag.scale, 1);
  cloth.position.y = poleH * flag.poleScale - (clothH * flag.scale) / 2 - 0.01;
  // night themes: the cloth gives back some of its own colour unlit
  const m = cloth.material;
  if (m?.emissive && (flag.glow > 0 || m.userData.lookGlow)) {
    m.emissive.set(flag.glow > 0 ? 0xffffff : 0x000000);
    m.emissiveMap = flag.glow > 0 ? m.map : null;
    m.emissiveIntensity = flag.glow > 0 ? flag.glow : 1;
    m.userData.lookGlow = flag.glow > 0;
    m.needsUpdate = true;
  }
}

// A fresh pin in the look's colours, standing where the old one stood.
function rebuildPin(scene) {
  const old = scene._pinFlag;
  if (!old) return;
  const pf = makePin(lookFlagColors(scene));
  pf.group.position.copy(old.group.position);
  pf.group.rotation.copy(old.group.rotation);
  pf.group.scale.copy(old.group.scale);
  pf.group.visible = old.group.visible;
  pf.uTime.value = old.uTime.value;
  if (scene._activeHole?.ref != null) pf.setLabel(scene._activeHole.ref);
  if (scene._wind) pf.setWindSpeed(scene._wind.mph);
  scene.scene.remove(old.group);
  // freed a little later: a shader warm-up still waiting on the driver (scene._warmShaders)
  // holds the old pin's materials, and three throws if one is disposed under it
  setTimeout(() => old.dispose(), 6000);
  scene._pinFlag = pf;
  scene.pin = pf.group;
  scene._flagU = pf.uTime;
  scene.scene.add(pf.group);
  scene.lineupFx?.setFlag(pf.group);
}

// What a look changes that needs no rebuild: tone mapping, grade, bloom, the sky's
// brightness, shadow softness, the pin's proportions, the landing effects.
function applyLive(scene) {
  const L = lookOf(scene);
  scene.renderer.toneMapping = (L && TONE_MAPPING[L.grade.toneMapping]) || THREE.ACESFilmicToneMapping;
  scene.postfx?.setLook(L ? L.grade : undefined);
  scene.scene.backgroundIntensity = L ? L.sky.backgroundIntensity : 1;
  if (scene.sun && scene.quality) {
    scene.sun.shadow.radius = lookShadowRadius(scene.quality.preset.shadowRadius, scene);
    scene._shadowsDirty = true;
  }
  applyFill(scene, L);
  if (scene.impactFx) {
    scene.impactFx.sizeMul = L ? L.impact.sizeMul : 1;
    scene.impactFx.countMul = L ? L.impact.countMul : 1;
  }
  if (L && scene._pinFlag) stylePin(scene._pinFlag, L.flag);
}

// The loaded course's theme just changed (lookCourse): a new pin if its colours did, the
// live settings, and the theme's sky (its own painted one, or the photo it names).
function applyTheme(scene) {
  const L = lookOf(scene);
  if (!L || !scene.renderer) return;   // a bare stand-in for a scene (tests): nothing to dress
  const flag = JSON.stringify(L.flag.colors);
  if (scene._pinFlag && flag !== (scene._flagKey ?? JSON.stringify(ARCADE_LOOK.flag.colors))) rebuildPin(scene);
  scene._flagKey = flag;
  applyLive(scene);
  scene.setSky(L.sky.preset || scene.skySetting);
}

// Switch a GolfScene to a look. Live settings change at once; the sky is re-applied (its
// light carries the look) and the course scenery rebuilt (turf, water and trees are built
// per look), which is deferred while a shot is replaying. Returns the promise of the sky
// being ready (scene.envReady). keepSky: stay on the sky that is showing.
export function applyLook(scene, look, { keepSky = false } = {}) {
  const next = parseLook(look), prev = scene.look;
  scene.look = next;
  if (next === 'arcade') syncTheme(scene);   // the loaded course's theme, before anything reads the look
  if (next === prev) { applyLive(scene); return scene.envReady; }
  rebuildPin(scene);
  scene._flagKey = JSON.stringify(lookOf(scene)?.flag.colors ?? null);
  applyLive(scene);
  // the warm-up tracer keeps the tracer's program compiled: let it be the look's variant
  if (scene._warmTracer) {
    scene.scene.remove(scene._warmTracer.mesh);
    scene._warmTracer.dispose();
    scene._warmTracer = null;
  }
  let sky = scene.skySetting;
  if (!keepSky) {
    const mine = (scene._arcadeLook || ARCADE_LOOK).sky.preset;
    if (next === 'arcade') sky = lookSkySetting(scene, sky);
    else if (mine && sky === mine && scene._skyBeforeLook) sky = scene._skyBeforeLook;   // back to the player's own sky, unless they picked another meanwhile
  }
  const ready = scene.setSky(sky);
  scene._rebuildScenery();
  scene.onLookChange?.(next);
  return ready;
}
