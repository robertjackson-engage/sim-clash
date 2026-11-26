'use strict';
// Runs main.js against a fake Electron and a fake server, and prints what it did as JSON
// (test/app-shell.test.js). argv[2]: 'ok' | 'busy' | 'second' | 'windowed' | 'muted'.
const Module = require('module');
const path = require('path');
const fs = require('fs');
const os = require('os');

const scenario = process.argv[2] || 'ok';
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'main-harness-'));
if (scenario === 'windowed') fs.writeFileSync(path.join(userData, 'window.json'), '{"fullscreen":false}');
const log = [];
const handlers = {};
let lock = true;
let readyResolve, readyReject;
const serverReady = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
let appReady;
const whenReady = new Promise((resolve) => { appReady = resolve; });

class BrowserWindow {
  constructor(opts) {
    this.opts = opts; this.visible = opts.show !== false; this.full = !!opts.fullscreen; this.on_ = {}; this.once_ = {};
    this.webContents = {
      on: (name, fn) => { this.on_[`wc:${name}`] = fn; },
      setAudioMuted: (v) => { log.push(['setAudioMuted', v]); },
      setWindowOpenHandler: (fn) => { this.openHandler = fn; },
    };
    log.push(['window', { fullscreen: opts.fullscreen, show: opts.show, backgroundColor: opts.backgroundColor, title: opts.title, contextIsolation: opts.webPreferences.contextIsolation }]);
    BrowserWindow.last = this;
  }
  on(name, fn) { this.on_[name] = fn; }
  once(name, fn) { this.once_[name] = fn; }
  loadURL(url) { log.push(['loadURL', url.startsWith('data:') ? `data:${decodeURIComponent(url.slice(url.indexOf(',') + 1)).replace(/<style>[\s\S]*<\/style>/, '')}` : url]); return Promise.resolve(); }
  show() { this.visible = true; log.push(['show']); }
  focus() { log.push(['focus']); }
  restore() { log.push(['restore']); }
  isVisible() { return this.visible; }
  isMinimized() { return false; }
  isDestroyed() { return false; }
  isFullScreen() { return this.full; }
  setFullScreen(v) { this.full = v; log.push(['setFullScreen', v]); if (this.on_[v ? 'enter-full-screen' : 'leave-full-screen']) this.on_[v ? 'enter-full-screen' : 'leave-full-screen'](); }
  reload() {}
}
const electron = {
  app: {
    isPackaged: false,
    setName: (n) => log.push(['setName', n]),
    getPath: () => userData,
    requestSingleInstanceLock: () => lock,
    quit: () => log.push(['quit']),
    whenReady: () => whenReady,
    on: (name, fn) => { handlers[name] = fn; },
  },
  BrowserWindow,
  globalShortcut: { register: (key, fn) => { handlers[`key:${key}`] = fn; log.push(['shortcut', key]); }, unregisterAll() {} },
  shell: { openExternal: (url) => { log.push(['openExternal', url]); return Promise.resolve(); } },
};
const fakeServer = { ready: serverReady, primaryNonce: 'NONCE', close() { log.push(['server.close']); } };

const realLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (request === 'electron') return electron;
  if (request === './server' && parent && /main\.js$/.test(parent.filename)) return fakeServer;
  return realLoad.call(this, request, parent, ...rest);
};
process.env.BIRDIE_NO_WATCH = '1';
process.env.BIRDIE_PORT = '8334';
delete process.env.BIRDIE_PRODUCT;
delete process.env.SIMCLASH_MUTE;
if (scenario === 'muted') process.env.SIMCLASH_MUTE = '1';
delete process.env.BIRDIE_ARCADE_DIR;

(async () => {
  if (scenario === 'second') lock = false;
  require(path.join(__dirname, '..', '..', 'main.js'));
  if (scenario === 'second') { console.log(JSON.stringify({ log })); return; }
  appReady();
  await new Promise((r) => setImmediate(r));
  log.push(['-- app ready, server not yet --']);
  const win = BrowserWindow.last;
  if (win && win.once_['ready-to-show']) win.once_['ready-to-show']();
  if (scenario === 'busy') readyReject(Object.assign(new Error('listen EADDRINUSE: address already in use 127.0.0.1:8334'), { code: 'EADDRINUSE', port: 8334 }));
  else readyResolve({ httpPort: 8334 });
  await new Promise((r) => setTimeout(r, 20));
  log.push(['-- after server --']);
  if (scenario !== 'busy') {
    // Alt+Enter, then F11, then a second launch
    let prevented = false;
    win.on_['wc:before-input-event']({ preventDefault() { prevented = true; } }, { type: 'keyDown', key: 'Enter', alt: true });
    log.push(['alt+enter prevented', prevented]);
    win.on_['wc:before-input-event']({ preventDefault() { log.push(['BUG: plain Enter was eaten']); } }, { type: 'keyDown', key: 'Enter', alt: false });
    handlers['key:F11']();
    handlers['second-instance']();
    // a page asks for a new window: an https link, then things that are not
    if (win.openHandler) {
      for (const url of ['https://example.com/download', 'file:///C:/Windows/notepad.exe', 'javascript:alert(1)', 'http://example.com/plain']) {
        log.push(['new window', url, win.openHandler({ url }).action]);
      }
    }
  }
  let prefs = null;
  try { prefs = JSON.parse(fs.readFileSync(path.join(userData, 'window.json'), 'utf8')); } catch (_) { /* none written */ }
  console.log(JSON.stringify({ log, prefs, arcadeDir: process.env.BIRDIE_ARCADE_DIR || null }));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
