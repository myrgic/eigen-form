#!/usr/bin/env node
/* =====================================================================
   tools/vj_serve.mjs — one local origin for working on the live apps
   with a real song: this checkout, an Oscine checkout and a folder of
   songs, side by side, so a page can import Oscine's engine and load a
   project without either being copied in here.

     /            this eigen-form checkout
     /oscine/     an Oscine checkout (--oscine). Several, comma-separated,
                  are searched in order: a worktree first, then the main
                  checkout for files only it has (the gitignored game
                  sound tables, for one)
     /songs/      a folder of .oscine.json files (--songs)
     /songs/index.json   every song under it, as [{ path, name }]

   Then open, for example:
     http://127.0.0.1:8471/apps/vj_deck/index.html?sim=fluid&song=/songs/storm/storm-over-the-lake.v5.oscine.json

   Listens on 127.0.0.1 only. Songs can be private: nothing here copies
   or publishes them, and nothing under /songs/ belongs in this repo.
   Zero dependencies.

   Usage:
     node tools/vj_serve.mjs --oscine <dir>[,<dir>] --songs <dir> [--port 8471]
   ===================================================================== */

import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync, readdirSync, readFileSync } from 'node:fs';
import { resolve, join, extname, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = {};
for (let i = 2; i < process.argv.length; i++) { const k = process.argv[i]; if (k.startsWith('--')) args[k.slice(2)] = process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[++i] : true; }
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(args.port) || 8471;
const dirs = (v) => (v && v !== true ? String(v).split(',').map((d) => resolve(d.trim())).filter(Boolean) : []);
const mounts = [['/oscine/', dirs(args.oscine)], ['/songs/', dirs(args.songs)], ['/', [ROOT]]];
for (const [prefix, list] of mounts) for (const d of list) if (!existsSync(d)) { console.error(`vj_serve: ${prefix} -> ${d} does not exist`); process.exit(2); }

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.webmanifest': 'application/manifest+json' };

function songIndex() {
  const out = [];
  for (const base of mounts[1][1]) {
    const walk = (dir, depth) => { if (depth > 4) return; for (const e of readdirSync(dir, { withFileTypes: true })) { const p = join(dir, e.name); if (e.isDirectory()) walk(p, depth + 1); else if (e.name.endsWith('.oscine.json')) { let name = e.name; try { name = JSON.parse(readFileSync(p, 'utf8')).name || name; } catch { /* listed by file name */ } out.push({ path: '/songs/' + relative(base, p).split(sep).map(encodeURIComponent).join('/'), name }); } } };
    walk(base, 0);
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

function find(urlPath) {
  for (const [prefix, list] of mounts) {
    if (!urlPath.startsWith(prefix)) continue;
    for (const base of list) {
      const p = resolve(base, '.' + sep + urlPath.slice(prefix.length));
      if (p !== base && !p.startsWith(base + sep)) continue;                 // never above a mount
      if (existsSync(p)) { const st = statSync(p); if (st.isFile()) return p; if (st.isDirectory() && existsSync(join(p, 'index.html'))) return join(p, 'index.html'); }
    }
    if (prefix !== '/') return null;                                       // a mount answers for its own prefix only
  }
  return null;
}

createServer((req, res) => {
  let urlPath;
  try { urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400).end(); return; }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
  if (urlPath === '/songs/index.json') { const body = JSON.stringify(songIndex()); res.writeHead(200, { 'Content-Type': TYPES['.json'], 'Cache-Control': 'no-store' }); res.end(req.method === 'HEAD' ? undefined : body); return; }
  const file = find(urlPath);
  if (!file) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(`not found: ${urlPath}\n`); return; }
  // no-store: the point of this server is editing a file and reloading
  res.writeHead(200, { 'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store', 'Content-Length': statSync(file).size });
  if (req.method === 'HEAD') res.end(); else createReadStream(file).pipe(res);
}).listen(PORT, '127.0.0.1', () => {
  console.log(`vj_serve: http://127.0.0.1:${PORT}/`);
  for (const [prefix, list] of mounts) console.log(`  ${prefix.padEnd(9)} ${list.length ? list.join('  then  ') : '(not mounted)'}`);
});
