'use strict';
// The sky photos that ship with the app (release packaging; docs/dev/packaging.md).
//
// The game never fetches anything (lib/product-mode.js), and its server only serves a sky
// that is already in <dataDir>/sky-cache (lib/sky-cache.js). A fresh install has an empty
// data dir, so without this every stage that is lit by a sky photo (the golden-hour and the
// morning ones) would fall back to the one sky inside the app, the midday one.
//
//   npm run prepare:sky   ->  build/arcade-data/{sky.json, sky/<name>_4k.hdr}
//   electron-builder      ->  <resources>/arcade-data/   (with the stage courses)
//
// installSkyBundle() runs once on boot, right after installArcadeBundle() and under the same
// condition (the server was told where the bundle is). It copies a bundled sky into
// <dataDir>/sky-cache when it is not there, or is there with another size (a cut-off copy).
// It writes only names of the shape lib/sky-cache.js accepts, never deletes, and never
// throws: a failed install leaves the game on its midday sky.
//
// The files are Poly Haven HDRIs (CC0), the same ones lib/sky-cache.js downloads for the
// simulator: tools/arcade-holes/sky-files.mjs names each one, its author and its checksum.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { FILE_RE } = require('./sky-cache');
const { bundleDirFor } = require('./arcade-bundle');

const SKY_MANIFEST = 'sky.json';
const SKY_DIR = 'sky';
const SKY_FORMAT = 1;

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/** The sky manifest of a bundle dir, or null when there is none (or it names a file we would not write). */
function readSkyBundle(bundleDir) {
  let b = null;
  try { b = JSON.parse(fs.readFileSync(path.join(bundleDir, SKY_MANIFEST), 'utf8')); } catch (_) { return null; }
  if (!b || b.format !== SKY_FORMAT || !Array.isArray(b.files)) return null;
  const ok = b.files.every((f) => f && typeof f.file === 'string' && FILE_RE.test(f.file) && typeof f.sha256 === 'string' && Number.isFinite(f.bytes) && f.bytes > 0);
  return ok ? b : null;
}

/**
 * Install the bundled sky photos into <dataDir>/sky-cache.
 * -> { status: 'no-bundle' | 'current' | 'installed' | 'failed', written: [file], error? }
 */
function installSkyBundle({ bundleDir = bundleDirFor(), dataDir, log = console } = {}) {
  const out = { status: 'no-bundle', written: [] };
  try {
    if (!bundleDir) return out;
    if (!dataDir) throw new Error('no data dir');
    const bundle = readSkyBundle(bundleDir);
    if (!bundle) return out;
    const destDir = path.join(dataDir, 'sky-cache');
    for (const f of bundle.files) {
      const dest = path.join(destDir, f.file);
      let size = -1;
      try { size = fs.statSync(dest).size; } catch (_) { /* not there */ }
      if (size === f.bytes) continue;
      const buf = fs.readFileSync(path.join(bundleDir, SKY_DIR, f.file));
      if (buf.length !== f.bytes || sha256(buf) !== f.sha256) throw new Error(`bundled ${f.file} does not match its checksum`);
      fs.mkdirSync(destDir, { recursive: true });
      const tmp = `${dest}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, buf);
      try { fs.renameSync(tmp, dest); }
      catch (error) { try { fs.unlinkSync(tmp); } catch (_) { /* gone */ } throw error; }
      out.written.push(f.file);
    }
    out.status = out.written.length ? 'installed' : 'current';
    if (out.written.length && log) log.log(`[sky] installed ${out.written.length} sky photo(s) from the bundle`);
    return out;
  } catch (error) {
    out.status = 'failed';
    out.error = error && error.message ? error.message : String(error);
    if (log) log.error(`[sky] could not install the bundled skies: ${out.error}`);
    return out;
  }
}

module.exports = { installSkyBundle, readSkyBundle, SKY_MANIFEST, SKY_DIR, SKY_FORMAT };
