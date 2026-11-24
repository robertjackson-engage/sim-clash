#!/usr/bin/env node
// Shoot the trailer's raw clips (the scenes are scenes.mjs; build.mjs cuts them).
//
//   node tools/release/trailer/shoot.mjs                    every scene of scenes.mjs
//   node tools/release/trailer/shoot.mjs --only rocket,putt  some of them
//   ... --scenes <file.mjs>   another scene script        --verbose   the private server's log
//   ... --window hidden       a never-shown window instead of offscreen rendering
//   ... --input test-shot     POST /api/test-shot instead of the stand-in connector
//
// Nothing is shown and nothing is heard: the recorder is a hidden, muted Electron window on
// a private server (ports 8341 / 9972). Clips land in .scratch/trailer/raw/<name>.mkv with
// a <name>.json beside each (marks, frame cadence, audio level).
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..', '..');
const electron = createRequire(import.meta.url)(path.join(repo, 'node_modules', 'electron'));   // the path of electron.exe
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [path.join(here, 'recorder.cjs'), ...process.argv.slice(2)], { cwd: repo, env, stdio: 'inherit', windowsHide: true });
child.on('exit', (code) => process.exit(code == null ? 1 : code));
