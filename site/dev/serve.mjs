#!/usr/bin/env node
// Serves the site the way GitHub Pages will: under a sub-path, without site/dev and the README.
//
//   node site/dev/serve.mjs [--port 8361] [--base /sim-clash/]
//
// then open http://127.0.0.1:8361/sim-clash/ . This PC only (127.0.0.1). A development tool:
// the Pages workflow does not publish site/dev.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const site = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, d) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : d; };
const port = Number(arg('--port', 8361));
const base = `/${String(arg('--base', '/sim-clash/')).replace(/^\/+|\/+$/g, '')}/`;
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.xml': 'application/xml', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4', '.webm': 'video/webm', '.txt': 'text/plain; charset=utf-8', '.ico': 'image/x-icon' };

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (!url.pathname.startsWith(base)) { res.writeHead(url.pathname === '/' ? 302 : 404, url.pathname === '/' ? { location: base } : {}); return res.end('not here: the site is under ' + base); }
  let rel = decodeURIComponent(url.pathname.slice(base.length)) || 'index.html';
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(site, rel);
  // what the workflow leaves out, and nothing outside the folder
  if (!file.startsWith(site) || /^(dev\/|README\.md$)/.test(rel.replace(/\\/g, '/')) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end('404'); }
  const size = fs.statSync(file).size;
  const head = { 'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'accept-ranges': 'bytes', 'cache-control': 'no-store' };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');   // video players ask for ranges
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    res.writeHead(206, { ...head, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 });
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...head, 'content-length': size });
  fs.createReadStream(file).pipe(res);
}).listen(port, '127.0.0.1', () => console.log(`http://127.0.0.1:${port}${base}`));
