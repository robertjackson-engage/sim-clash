'use strict';
// Renders the trailer's own graphics (captions, the end card, thumbnail lettering) to PNG
// files with an alpha channel, in the game's type style: Bahnschrift condensed bold italic
// capitals, the two player colours (#ff5a36 / #2e9bff), gold (#ffd21f) on near-black
// (#07090d): public/arcade/shell.css and public/product.json. A hidden offscreen Electron
// window; nothing is shown.
//
//   electron tools/release/trailer/cards.cjs <spec.json>
//   spec: { out: <dir>, cards: [{ id, width, height, html }] }
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const spec = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
app.setPath('userData', path.join(spec.out, '..', 'electron-profile-cards'));
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('mute-audio');
app.on('window-all-closed', () => {});

const CSS = `
:root { --p1: #ff5a36; --p2: #2e9bff; --gold: #ffd21f; --ink: #07090d; --white: #fffdf5;
  --font: "Bahnschrift", "DIN Condensed", "Impact", "Arial Narrow", sans-serif; }
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: 100%; height: 100%; background: transparent; overflow: hidden; }
body { font-family: var(--font); font-stretch: 75%; font-weight: 700; color: var(--white); text-transform: uppercase; }
.p1 { color: var(--p1); } .p2 { color: var(--p2); } .gold { color: var(--gold); }
/* a caption: a slanted near-black band in the lower third, a player colour on each end */
.cap { position: absolute; left: 0; right: 0; display: flex; justify-content: center; }
.cap > div { position: relative; padding: 14px 54px 10px; background: rgba(7, 9, 13, .93); transform: skewX(-9deg);
  box-shadow: -14px 0 0 var(--p1), 14px 0 0 var(--p2), 0 10px 30px rgba(0, 0, 0, .45); }
.cap > div > span { display: block; transform: skewX(9deg); font-style: italic; font-size: 66px; line-height: 1.05; letter-spacing: .035em; white-space: nowrap; }
.cap.small > div > span { font-size: 44px; }
/* the wordmark, as the title screen draws it */
.wm { display: inline-flex; align-items: center; gap: .16em; font-style: italic; line-height: .86; letter-spacing: .01em; white-space: nowrap; }
.wm > b { font-style: italic; font-weight: 700; -webkit-text-stroke: .075em var(--ink); paint-order: stroke fill; text-shadow: 0 .07em 0 rgba(0, 0, 0, .55), 0 0 .5em rgba(0, 0, 0, .35); }
.wm > i { display: block; width: .1em; height: 1.1em; background: var(--gold); transform: skewX(-12deg); box-shadow: 0 .05em 0 rgba(0, 0, 0, .5); }
/* the end card */
.end { position: absolute; inset: 0; background:
  linear-gradient(100deg, rgba(255, 90, 54, .30) 0%, rgba(255, 90, 54, 0) 38%),
  linear-gradient(280deg, rgba(46, 155, 255, .30) 0%, rgba(46, 155, 255, 0) 38%), var(--ink);
  display: flex; flex-direction: column; align-items: center; justify-content: center; }
.end .wm { font-size: 250px; margin-bottom: 40px; }
.end .tag { font-size: 58px; font-style: italic; letter-spacing: .12em; color: var(--gold); }
/* the call to act: a gold slab, as the game's START button is */
.end .dl { margin-top: 36px; padding: 16px 56px 10px; font-size: 64px; font-style: italic; letter-spacing: .06em; background: var(--gold); color: var(--ink); transform: skewX(-9deg); box-shadow: 0 10px 0 rgba(0, 0, 0, .45); }
.end .dl > span { display: block; transform: skewX(9deg); }
.end .url { margin-top: 34px; padding: 12px 40px 8px; font-size: 54px; letter-spacing: .05em; text-transform: none; background: var(--white); color: var(--ink); transform: skewX(-9deg); }
.end .url > span { display: block; transform: skewX(9deg); }
.end .built { margin-top: 40px; font-size: 36px; letter-spacing: .12em; color: rgba(255, 253, 245, .86); text-transform: none; }
.end .fine { position: absolute; left: 0; right: 0; bottom: 44px; text-align: center; font-size: 25px; font-stretch: 87%; font-weight: 500; letter-spacing: .08em; color: rgba(255, 253, 245, .62); text-transform: none; line-height: 1.5; }
/* thumbnail lettering */
.thumb-shade { position: absolute; inset: 0; background: linear-gradient(200deg, rgba(7, 9, 13, 0) 40%, rgba(7, 9, 13, .82) 100%); }
.thumb { position: absolute; left: 70px; bottom: 60px; font-style: italic; line-height: .9; }
.thumb > div { font-size: 210px; letter-spacing: .01em; -webkit-text-stroke: 16px var(--ink); paint-order: stroke fill; text-shadow: 0 14px 0 rgba(0, 0, 0, .55); }
.thumb.mid > div { font-size: 170px; }
.thumb-wm { position: absolute; right: 60px; top: 50px; font-size: 120px; }
/* the vertical cut: the wordmark above the picture, the address under it */
.v-top { position: absolute; left: 0; right: 0; top: 150px; text-align: center; }
.v-top .wm { font-size: 190px; }
.v-top .tag { margin-top: 26px; font-size: 44px; font-style: italic; letter-spacing: .1em; color: var(--white); text-shadow: 0 3px 0 rgba(0,0,0,.6); }
.v-bot { position: absolute; left: 0; right: 0; bottom: 170px; text-align: center; }
.v-bot .dl { display: inline-block; margin-top: 22px; padding: 12px 40px 6px; font-size: 54px; font-style: italic; letter-spacing: .06em; background: var(--gold); color: var(--ink); }
.v-bot .dl + br + .url, .v-bot .url { margin-top: 20px; }
.v-bot .tag { font-size: 62px; font-style: italic; letter-spacing: .1em; color: var(--gold); text-shadow: 0 3px 0 rgba(0,0,0,.6); }
.v-bot .url { display: inline-block; margin-top: 22px; padding: 10px 30px 6px; font-size: 40px; letter-spacing: .04em; text-transform: none; background: var(--white); color: var(--ink); }
`;

app.whenReady().then(async () => {
  let code = 0;
  try {
    fs.mkdirSync(spec.out, { recursive: true });
    for (const card of spec.cards) {
      const win = new BrowserWindow({ width: card.width, height: card.height, useContentSize: true, show: false, frame: false, transparent: true, skipTaskbar: true, focusable: false, enableLargerThanScreen: true,
        webPreferences: { offscreen: true, backgroundThrottling: false } });
      win.setContentSize(card.width, card.height);
      const html = `<!doctype html><meta charset="utf-8"><style>${CSS}</style><body>${card.html}</body>`;
      await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      await win.webContents.executeJavaScript('document.fonts.ready.then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))))');
      await new Promise((r) => setTimeout(r, 250));
      const img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(spec.out, `${card.id}.png`), img.toPNG());
      win.destroy();
    }
  } catch (error) { code = 1; console.error(error && error.stack || error); }
  app.exit(code);
});
