'use strict';
// A log file for the installed app (v2:release). A packaged Windows app has no terminal, so
// what the server and the window print would be lost: this copies console.log / warn / error
// to <dir>/game.log as well. One file, started again when it passes maxBytes (the old one is
// kept as game.old.log), so it never grows without limit. Never throws: a log that cannot
// be written is skipped.
const fs = require('fs');
const path = require('path');
const util = require('util');

const LOG_NAME = 'game.log';

function installFileLog({ dir, maxBytes = 1024 * 1024, target = console, now = () => new Date() } = {}) {
  if (!dir) return null;
  const file = path.join(dir, LOG_NAME);
  try {
    fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(file) && fs.statSync(file).size > maxBytes) fs.renameSync(file, path.join(dir, 'game.old.log'));
  } catch (_) { return null; }
  let size = 0;
  try { size = fs.existsSync(file) ? fs.statSync(file).size : 0; } catch (_) { size = 0; }
  const write = (level, args) => {
    try {
      const line = `${now().toISOString()} ${level} ${util.format(...args)}\n`;
      if (size + line.length > maxBytes * 2) return;   // a runaway session: stop writing, keep the start
      fs.appendFileSync(file, line);
      size += line.length;
    } catch (_) { /* disk full, folder gone: the console still has it */ }
  };
  for (const [name, level] of [['log', 'INFO '], ['info', 'INFO '], ['warn', 'WARN '], ['error', 'ERROR']]) {
    const original = target[name].bind(target);
    target[name] = (...args) => { write(level, args); original(...args); };
  }
  write('INFO ', ['---- started ----']);
  return file;
}

module.exports = { installFileLog, LOG_NAME };
