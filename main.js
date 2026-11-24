'use strict';
// Electron shell: runs the sim server in the main process and opens the
// game fullscreen. `npm start` launches this; `npm run start:server`
// runs the same server headless for browser/tablet use.
const { app, BrowserWindow, globalShortcut } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const HTTP_PORT = +(process.env.BIRDIE_PORT || 8222);

// Auto-start the free Uneekor VIEW feed bridge so the launch monitor connects
// on its own — no separate `npm run watch`, no paywalled GSPconnect. Only runs
// when the VIEW ShotData folder is present, so non-Uneekor setups are untouched.
// Set BIRDIE_NO_WATCH=1 to opt out (e.g. when using GSPconnect instead).
let watcher = null;
function startWatcher() {
  if (process.env.BIRDIE_NO_WATCH) return;
  const shotDir = process.env.UNEEKOR_SHOTDATA || (process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, '..', 'LocalLow', 'Uneekor', 'VIEW', 'ShotData')
    : null);
  if (!shotDir || !fs.existsSync(shotDir)) return;
  const script = path.join(__dirname, 'tools', 'uneekor-watch.js');
  // process.execPath is the Electron binary; ELECTRON_RUN_AS_NODE makes it run
  // the bridge as a plain Node script (no separate Node install needed).
  watcher = spawn(process.execPath, [script, '--speed-scale', '2.23694'], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'inherit',
  });
  watcher.on('exit', () => { watcher = null; });
}
function stopWatcher() {
  if (!watcher) return;
  try { watcher.kill(); } catch (_) { /* already gone */ }
  watcher = null;
}

// v2:release The product's name (public/product.json via lib/product.js): the window title
// and the user-data folder, so the game keeps its own settings, its own data and its own
// single-instance lock beside an Open-Birdie install. BIRDIE_PRODUCT=open-birdie: the
// original simulator, under its own name.
const product = require('./lib/product');
const asGame = process.env.BIRDIE_PRODUCT !== 'open-birdie';
if (asGame) app.setName(product.userDataDir);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // Packaged builds run from a read-only app.asar; redirect the writable data
  // dir (course cache) to per-user AppData. Dev + headless (node server.js)
  // keep the repo's data/ via the env-var default in lib/course.js.
  if (app.isPackaged) {
    // v2:release an installed app has no terminal: keep what it prints in <user data>/logs/game.log
    require('./lib/app-log').installFileLog({ dir: path.join(app.getPath('userData'), 'logs') });
    process.env.BIRDIE_DATA_DIR = path.join(app.getPath('userData'), 'data');
    process.env.BIRDIE_ART_DIR = path.join(process.resourcesPath, 'course-art');
    // v2:release the game's installer ships no real-course art packs: the folder is only named when it is there
    if (!fs.existsSync(process.env.BIRDIE_ART_DIR)) delete process.env.BIRDIE_ART_DIR;
  }
  // v2:release The arcade stages ship as a bundle (npm run prepare:arcade-data); the server
  // installs them into the data dir on boot (lib/arcade-bundle.js). Packaged: beside the
  // app in resources; from source: build/arcade-data.
  if (!process.env.BIRDIE_ARCADE_DIR) {
    process.env.BIRDIE_ARCADE_DIR = app.isPackaged ? path.join(process.resourcesPath, 'arcade-data') : path.join(__dirname, 'build', 'arcade-data');
  }
  let win = null;
  const srv = require('./server');
  srv.ready.catch(() => { /* v2:release reported on the splash below, not as an unhandled rejection */ });

  // a second launch (the shortcut clicked twice) brings the running game to the front
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      if (!win.isVisible()) win.show();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    // v2:release The window opens AT ONCE, dark, on a splash with the wordmark (lib/app-shell.js),
    // and the game replaces it when the server is up: no white flash, no blank wait, and a
    // server that cannot start (a busy port) says so on screen. Full screen on the primary
    // display by default; F11 or Alt+Enter toggles it and the choice is remembered.
    const shell = require('./lib/app-shell');
    const title = asGame ? product.name : 'Open-Birdie';
    const splashOf = (opts) => shell.splashUrl(asGame ? product : { ...product, name: title, wordmark: ['OPEN', 'BIRDIE'], tagline: '' }, opts);
    const prefsFile = path.join(app.getPath('userData'), 'window.json');
    const prefs = shell.readWindowPrefs(prefsFile);
    win = new BrowserWindow({
      fullscreen: prefs.fullscreen,
      width: 1600,
      height: 900,
      show: false,
      autoHideMenuBar: true,
      backgroundColor: asGame ? product.colors.ink : '#0a160e',
      title,   // (the page sets its own <title> too)
      webPreferences: { contextIsolation: true },
    });
    win.on('closed', () => { win = null; });
    // v2:final SIMCLASH_MUTE=1: the window makes no sound at all, whatever the page's own sound
    // setting says (for looking at a build on a PC somebody is using; docs/dev/packaging.md).
    // On the window itself, before anything is loaded into it, so it holds for every page.
    if (process.env.SIMCLASH_MUTE === '1' && win.webContents && typeof win.webContents.setAudioMuted === 'function') {
      win.webContents.setAudioMuted(true);
      console.log('[window] SIMCLASH_MUTE=1: the game window is muted');
    }
    const reveal = () => { if (win && !win.isDestroyed() && !win.isVisible()) win.show(); };
    win.once('ready-to-show', reveal);
    setTimeout(reveal, 2000);   // whatever happens to the splash, the window appears
    win.loadURL(splashOf()).catch(() => { /* the game page follows anyway */ });
    const toggleFullScreen = () => { if (win && !win.isDestroyed()) win.setFullScreen(!win.isFullScreen()); };
    win.on('enter-full-screen', () => shell.writeWindowPrefs(prefsFile, { fullscreen: true }));
    win.on('leave-full-screen', () => shell.writeWindowPrefs(prefsFile, { fullscreen: false }));
    win.webContents.on('before-input-event', (event, input) => {
      if (input && input.type === 'keyDown' && input.key === 'Enter' && input.alt && !input.control && !input.meta) { event.preventDefault(); toggleFullScreen(); }
    });

    try {
      await srv.ready;
    } catch (error) {
      console.error(`[window] the game server did not start: ${error && error.message}`);
      if (win && !win.isDestroyed()) win.loadURL(splashOf({ error: shell.startErrorText(error, { httpPort: HTTP_PORT, name: title }) })).catch(() => {});
      return;
    }
    startWatcher();
    if (!win || win.isDestroyed()) return;   // closed during the splash: the app is quitting
    // Hand the readiness nonce ONLY to the loopback Electron primary client, so
    // LAN/SSE mirrors can render but cannot activate an HD course revision.
    win.loadURL(`http://localhost:${HTTP_PORT}?primaryNonce=${srv.primaryNonce}`);
    // What goes wrong inside the window, written to the terminal's log (a frozen or blank
    // game leaves no other trace); and a window whose renderer dies comes back by itself.
    win.webContents.on('console-message', (e) => {   // the event carries level, message, lineNumber, sourceId
      if (e && e.level === 'error') console.error(`[window] ${e.message} (${e.sourceId}:${e.lineNumber})`);
    });
    win.webContents.on('render-process-gone', (_e, details) => {
      console.error(`[window] the game window stopped: ${details && details.reason} (exit ${details && details.exitCode}); reloading it`);
      if (win && !win.isDestroyed()) setTimeout(() => { if (win && !win.isDestroyed()) win.reload(); }, 500);
    });
    win.on('unresponsive', () => console.error('[window] the game window is not responding'));
    win.on('responsive', () => console.error('[window] the game window is responding again'));
    app.on('child-process-gone', (_e, details) => console.error(`[window] ${details && details.type} process gone: ${details && details.reason}`));

    globalShortcut.register('F11', toggleFullScreen);
  });

  app.on('will-quit', () => { globalShortcut.unregisterAll(); stopWatcher(); });
  app.on('window-all-closed', () => {
    stopWatcher();
    srv.close();
    app.quit();
  });
}
