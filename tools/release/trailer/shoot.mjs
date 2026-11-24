#!/usr/bin/env node
// Shoot the trailer's raw clips (the scenes are scenes.mjs; build.mjs cuts them).
//
//   node tools/release/trailer/shoot.mjs                    every scene of scenes.mjs
//   node tools/release/trailer/shoot.mjs --only rocket,putt  some of them
//   ... --scenes <file.mjs>   another scene script        --verbose   the private server's log
//   ... --window hidden       a never-shown window instead of offscreen rendering
//   ... --input test-shot     POST /api/test-shot instead of the stand-in connector
//   ... --port 8480 --oc 9980   other ports for the private server (HTTP, Open Connect)
//   ... --scratch .scratch/trailer2   another working folder (build.mjs takes the same flag)
//   ... --gfx high            the graphics tier every page is filmed at (high by default, never Auto)
//   ... --fast                rehearse: no recording; prints what every swing did
//
// Nothing is shown and nothing is heard: the recorder is a hidden, muted Electron window on
// a private server (ports 8341 / 9972 unless named). Clips land in .scratch/trailer/raw/<name>.mkv
// with a <name>.json beside each (marks, frame cadence, audio level).
//
// The 1.0.0-beta.2 trailer was filmed with:
//   shoot.mjs --port 8480 --oc 9980 --scratch .scratch/trailer2 --only match,dragon,sudden
//   ... --only g-ring,g-pad,g-strip,g-bumper,g-warp,g-coins     (the gadgets: scenes-beta2.mjs)
//   ... --only fly,party,bullseye
//   build.mjs --scratch .scratch/trailer2 --ffmpeg <ffmpeg.exe>   then   ... --only site
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
