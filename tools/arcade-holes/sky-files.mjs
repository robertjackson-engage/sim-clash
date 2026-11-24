// Which sky photos the arcade stages are lit by, and where each one comes from.
//
// A stage names a theme and a time of day; the look (public/render/arcade-look.js) turns
// that into, in this order:
//   - its own PANORAMA (public/arcade/env/sky, generated for this game and inside the app:
//     docs/arcade-look.md "The world round a stage"). No sky photo is asked for. Since the
//     v3 environment pass EVERY stage that ships is lit this way, so the game bundles no
//     sky photo at all (v3:env-polish: the two Poly Haven files were 32 MB of installer that
//     nothing drew);
//   - a painted sky (dusk, night, the volcano: no file);
//   - one of the sky presets (public/render/sky-presets.js): `midday` is inside the app, the
//     others are Poly Haven HDRIs the game's server serves from <data dir>/sky-cache.
// neededSkyFiles() asks the look itself, so this list cannot drift from what the page will
// request. A stage added later with a theme and hour that has no panorama gets its photo
// bundled again by the same machinery (sky-bundle.mjs, lib/sky-bundle.js), which is kept
// whole. If a panorama cannot be loaded the page falls back to the stage's photo
// (fallbackSkyFileOf) and, that not being on disk in the game, to the midday sky.
//
// SKY_SOURCES pins every sky a stage may use: the exact bytes (SHA-256 of the 4k .hdr that
// https://dl.polyhaven.org serves, which is what lib/sky-cache.js downloads), the asset's
// page, its authors and its licence. All Poly Haven assets are CC0 1.0
// (https://polyhaven.com/license). Sizes and MD5s were checked against Poly Haven's own file
// list (https://api.polyhaven.com/files/<id>) in November 2026; authors are from
// https://api.polyhaven.com/info/<id>. A stage that needs a sky that is not pinned here stops
// the release build (sky-bundle.mjs) and fails test/sky-bundle.test.mjs: add its row.
import { resolveLook, courseTheme, ARCADE_LOOK } from '../../public/render/arcade-look.js';
import { SKY_PRESETS } from '../../public/render/sky-presets.js';

export const POLY_HAVEN_HDR_4K = 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/4k/';

export const SKY_SOURCES = Object.freeze({
  'kloppenheim_06_puresky_4k.hdr': Object.freeze({
    preset: 'golden',
    title: 'Kloppenheim 06 (Pure Sky)',
    authors: 'Greg Zaal (original), Jarod Guest (sky edits)',
    page: 'https://polyhaven.com/a/kloppenheim_06_puresky',
    licence: 'CC0 1.0',
    md5: '63e9826c43b973f8b6ecb07cb6a89227',
    bytes: 17385661,
    sha256: '1bebd7cbbfb5c48a642f03d93bffbabb2c42d0b109061f37a72259d1cbdb3053',
  }),
  'rustig_koppie_puresky_4k.hdr': Object.freeze({
    preset: 'morning',
    title: 'Rustig Koppie (Pure Sky)',
    authors: 'Greg Zaal (original), Jarod Guest (sky edits)',
    page: 'https://polyhaven.com/a/rustig_koppie_puresky',
    licence: 'CC0 1.0',
    md5: '499abd33d77b000b80a7ce024fc72ec2',
    bytes: 15257521,
    sha256: '0a7431d4831e71d8690ab1be0a9baaec181962918166395cf14cbe1add6a84a9',
  }),
});

/** The sky photo a course falls back to when it has no panorama (or its panorama cannot be loaded), or null (a painted sky, or the midday sky inside the app). */
export function fallbackSkyFileOf(course) {
  const want = courseTheme(course, null);
  const look = want ? resolveLook(want.theme, want.timeOfDay) : ARCADE_LOOK;
  if (look.sky.paint || !look.sky.preset) return null;
  const hdri = SKY_PRESETS[look.sky.preset]?.hdri;
  return hdri ? hdri.split('/').pop() : null;
}

/** The panorama a course is under in the game (public/arcade/env/manifest.json id), or null. Only a course that names a theme has one (arcade-look.js lookSkyPano). */
export function panoramaOf(course) {
  const want = courseTheme(course, null);
  return want ? resolveLook(want.theme, want.timeOfDay).sky.pano?.id ?? null : null;
}

/** The sky file a course NEEDS on disk in the game, or null (its own panorama, a painted sky, or the midday sky inside the app). */
export function skyFileOf(course) {
  return panoramaOf(course) ? null : fallbackSkyFileOf(course);
}

/** -> [{ file, stages: [course name] }], sorted by file name: every sky file `courses` need. */
export function neededSkyFiles(courses) {
  const by = new Map();
  for (const c of courses) {
    const file = skyFileOf(c);
    if (!file) continue;
    if (!by.has(file)) by.set(file, []);
    by.get(file).push(c.name || c.id || '?');
  }
  return [...by.keys()].sort().map((file) => ({ file, stages: by.get(file) }));
}
