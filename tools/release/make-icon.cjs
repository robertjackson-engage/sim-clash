#!/usr/bin/env node
'use strict';
// The product icon: build/product.ico (the app, the installer, the taskbar) and
// docs/media/icon.png (README, the site).   Run: npm run make-icon:product
//
// The mark: the two player colours meeting on a diagonal, as on the VS screen, with a white
// bolt down the seam. Colours come from public/product.json. It is drawn as SVG here and
// rasterised with sharp (a dev dependency); the .ico holds PNG images at the usual sizes.
// The output is committed, so a normal build does not need to run this.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const product = require('../../lib/product.js');

const repo = path.join(__dirname, '..', '..');
const SIZES = [16, 24, 32, 48, 64, 128, 256];
const { p1, p2, ink } = product.colors;

// 256 x 256. `small`: a heavier bolt and no fine detail, for 16 to 32 px.
function svg({ small = false } = {}) {
  const bolt = small
    ? '140,14 186,14 146,104 194,104 90,244 116,142 66,142'
    : '146,20 180,20 143,106 186,106 94,238 118,140 74,140';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">
  <defs>
    <clipPath id="r"><rect x="6" y="6" width="244" height="244" rx="${small ? 44 : 54}"/></clipPath>
    <linearGradient id="a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff8a3a"/><stop offset=".45" stop-color="${p1}"/><stop offset="1" stop-color="#b3260a"/></linearGradient>
    <linearGradient id="b" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#63d2ff"/><stop offset=".5" stop-color="${p2}"/><stop offset="1" stop-color="#0a45b8"/></linearGradient>
  </defs>
  <g clip-path="url(#r)">
    <rect width="256" height="256" fill="${ink}"/>
    <polygon points="0,0 164,0 92,256 0,256" fill="url(#a)"/>
    <polygon points="164,0 256,0 256,256 92,256" fill="url(#b)"/>
    ${small ? '' : '<polygon points="0,0 256,0 256,74 0,118" fill="#ffffff" opacity=".10"/>'}
    <polygon points="${bolt}" fill="#fffdf5" stroke="${ink}" stroke-width="${small ? 16 : 11}" stroke-linejoin="round" paint-order="stroke"/>
  </g>
  <rect x="6" y="6" width="244" height="244" rx="${small ? 44 : 54}" fill="none" stroke="${ink}" stroke-width="${small ? 10 : 7}"/>
</svg>`;
}

// A .ico whose images are PNG files (Windows Vista and later read these at every size).
function ico(images) {
  const head = Buffer.alloc(6 + 16 * images.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(images.length, 4);
  let offset = head.length;
  images.forEach(({ size, png }, i) => {
    const e = 6 + 16 * i;
    head.writeUInt8(size >= 256 ? 0 : size, e);
    head.writeUInt8(size >= 256 ? 0 : size, e + 1);
    head.writeUInt8(0, e + 2); head.writeUInt8(0, e + 3);
    head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(png.length, e + 8); head.writeUInt32LE(offset, e + 12);
    offset += png.length;
  });
  return Buffer.concat([head, ...images.map((i) => i.png)]);
}

(async () => {
  const render = (size) => sharp(Buffer.from(svg({ small: size <= 32 })), { density: 72 * Math.max(1, size / 256) * 4 })
    .resize(size, size, { kernel: 'lanczos3' }).png({ compressionLevel: 9 }).toBuffer();
  const images = [];
  for (const size of SIZES) images.push({ size, png: await render(size) });
  const icoFile = path.join(repo, 'build', 'product.ico');
  fs.writeFileSync(icoFile, ico(images));
  const media = path.join(repo, 'docs', 'media');
  fs.mkdirSync(media, { recursive: true });
  fs.writeFileSync(path.join(media, 'icon.png'), await render(512));
  fs.writeFileSync(path.join(media, 'icon.svg'), svg());
  console.log(`${path.relative(repo, icoFile)}  ${SIZES.join(', ')} px, ${(fs.statSync(icoFile).size / 1024).toFixed(0)} KB`);
  console.log(`docs/media/icon.png (512 px), docs/media/icon.svg`);
  if (process.argv.includes('--preview')) {
    const out = process.argv[process.argv.indexOf('--preview') + 1];
    const tiles = await Promise.all([256, 64, 48, 32, 24, 16].map(async (s) => ({ s, png: await render(s) })));
    let x = 16;
    const composite = tiles.map((t) => { const c = { input: t.png, left: x, top: 16 }; x += t.s + 16; return c; });
    await sharp({ create: { width: x, height: 288, channels: 4, background: '#3a3f4a' } }).composite(composite).png().toFile(out);
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
