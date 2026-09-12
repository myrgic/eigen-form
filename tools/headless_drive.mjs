#!/usr/bin/env node
/* =====================================================================
   tools/headless_drive.mjs — the real-time instrument.

   Named plainly, in docs/aquarium-design.md and here: the page's own
   requestAnimationFrame loop does not advance under Chromium's
   --virtual-time-budget flag (measured 2026-09-11 — dump-dom under
   virtual time only ever captures frame one, no matter how large the
   budget). Every dynamics defect that only shows up AFTER frame one —
   the three this delivery fixes, and any future one — is invisible to
   that verification path. This script drives the app over the DevTools
   protocol in real wall-clock time instead: launch a headless Chromium,
   serve this repo, navigate, sleep in real seconds, and read the page's
   own #observables panel (index.html already recomputes and renders it
   every SLOW_CACHE_PERIOD frames) at declared sample times.

   Plain node, global WebSocket and fetch, no packages — same idiom the
   throwaway investigation script (cog workspace scratch, referenced in
   this delivery's own commit history) used, promoted into the repo so
   `npm run aquarium:drive` can run it from now on rather than needing
   to be reconstructed per investigation.

   Usage:
     node tools/headless_drive.mjs [options]

   Options (all optional; see DEFAULTS below):
     --url <path>          Path under the served repo root, e.g.
                            /apps/aquarium/ (default: /apps/aquarium/)
     --seconds <N>          Total real-time seconds to drive (default 30)
     --samples <a,b,c>       Comma-separated sample times in seconds
                             (default: 5,15,30 — or evenly spaced
                             thirds of --seconds if it's not 30)
     --screenshot <path>     Where to write the final PNG (default:
                             <os.tmpdir()>/aquarium-drive.png)
     --chromium <path>       Path to a chrome-headless-shell binary
                             (default: resolved by resolveChromium())
     --cdp-port <port>       Chrome's --remote-debugging-port (default 9455)
     --http-port <port>      python3 -m http.server port (default 8923)
     --width / --height      Viewport size (default 1400x900)

   Exit code is non-zero if #observables is ever missing/unparsable, or
   if the engine's own step counter never advances between samples —
   both are "the instrument itself is broken", not "the app is buggy",
   and are treated as harder failures than any individual observable.
   ===================================================================== */

import { spawn } from 'node:child_process';
import { existsSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

/* ---- args ------------------------------------------------------------ */

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) { out[key] = true; }
      else { out[key] = next; i++; }
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

const DEFAULTS = {
  url: '/apps/aquarium/',
  seconds: 30,
  screenshot: path.join(tmpdir(), 'aquarium-drive.png'),
  cdpPort: 9455,
  httpPort: 8923,
  width: 1400,
  height: 900
};

const urlPath = args.url || DEFAULTS.url;
const totalSeconds = Number(args.seconds || DEFAULTS.seconds);
const screenshotPath = args.screenshot || DEFAULTS.screenshot;
const cdpPort = Number(args['cdp-port'] || DEFAULTS.cdpPort);
const httpPort = Number(args['http-port'] || DEFAULTS.httpPort);
const width = Number(args.width || DEFAULTS.width);
const height = Number(args.height || DEFAULTS.height);

let sampleTimes;
if (args.samples) {
  sampleTimes = String(args.samples).split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0);
} else if (totalSeconds === 30) {
  sampleTimes = [5, 15, 30];
} else {
  sampleTimes = [totalSeconds / 3, (totalSeconds * 2) / 3, totalSeconds].map((n) => Math.round(n * 10) / 10);
}
sampleTimes.sort((a, b) => a - b);

/* ---- chromium resolution ---------------------------------------------
   Prefer an explicit --chromium flag, then AQUARIUM_CHROMIUM_PATH, then
   the exact path this delivery was measured against, then a glob for
   any chrome-headless-shell revision under Playwright's cache, then a
   plain `chromium`/`google-chrome` on PATH — named as a fallback chain
   (feedback_cli_binary_fallback_pattern), not a single hardcoded guess. */
function resolveChromium() {
  if (args.chromium) return String(args.chromium);
  if (process.env.AQUARIUM_CHROMIUM_PATH) return process.env.AQUARIUM_CHROMIUM_PATH;

  const named = path.join(
    homedir(), 'Library', 'Caches', 'ms-playwright',
    'chromium_headless_shell-1234', 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell'
  );
  if (existsSync(named)) return named;

  const cacheDir = path.join(homedir(), 'Library', 'Caches', 'ms-playwright');
  if (existsSync(cacheDir)) {
    const revisions = readdirSync(cacheDir).filter((d) => d.startsWith('chromium_headless_shell-'));
    for (const rev of revisions) {
      const revDir = path.join(cacheDir, rev);
      let platforms = [];
      try { platforms = readdirSync(revDir); } catch { /* ignore */ }
      for (const plat of platforms) {
        const candidate = path.join(revDir, plat, 'chrome-headless-shell');
        if (existsSync(candidate)) return candidate;
      }
    }
  }

  for (const name of ['chromium', 'google-chrome', 'chrome']) {
    // Not resolved via PATH lookup here (no `which` dependency) — spawn
    // will fail with a clear ENOENT if this guess is wrong, which is
    // an acceptable last resort after every known-good path missed.
    return name;
  }
}

/* ---- process lifecycle ------------------------------------------------ */

const children = [];
function spawnTracked(cmd, cmdArgs, opts) {
  const child = spawn(cmd, cmdArgs, opts);
  children.push(child);
  return child;
}
function cleanup() {
  for (const child of children) {
    try { child.kill('SIGTERM'); } catch { /* already gone */ }
  }
}
process.on('exit', cleanup);

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function waitForHttp(url, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status < 500) return true;
    } catch { /* not up yet */ }
    await sleep(150);
  }
  return false;
}

/* ---- main -------------------------------------------------------------- */

async function main() {
  const chromiumPath = resolveChromium();

  mkdirSync(path.dirname(screenshotPath), { recursive: true });

  // Serve the repo root so `${urlPath}` resolves the same way it does
  // in a normal checkout (apps/aquarium/index.html imports its sibling
  // modules with relative paths).
  const httpServer = spawnTracked('python3', ['-m', 'http.server', String(httpPort)], {
    cwd: ROOT,
    stdio: ['ignore', 'ignore', 'pipe']
  });
  httpServer.on('error', (err) => {
    console.error(`headless_drive: failed to start python3 -m http.server: ${err.message}`);
  });

  const httpUp = await waitForHttp(`http://localhost:${httpPort}${urlPath}`, 10000);
  if (!httpUp) {
    console.error(`headless_drive: http://localhost:${httpPort}${urlPath} never came up`);
    process.exit(1);
  }

  const chrome = spawnTracked(chromiumPath, [
    '--headless', '--no-sandbox', `--remote-debugging-port=${cdpPort}`, 'about:blank'
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  chrome.on('error', (err) => {
    console.error(`headless_drive: failed to launch chromium at "${chromiumPath}": ${err.message}`);
    console.error('headless_drive: pass --chromium <path> or set AQUARIUM_CHROMIUM_PATH.');
    process.exit(1);
  });

  const cdpUp = await waitForHttp(`http://localhost:${cdpPort}/json`, 10000);
  if (!cdpUp) {
    console.error(`headless_drive: chromium's DevTools port ${cdpPort} never came up`);
    process.exit(1);
  }

  const list = await (await fetch(`http://localhost:${cdpPort}/json`)).json();
  if (!list.length) {
    console.error('headless_drive: chromium reported no open pages');
    process.exit(1);
  }
  const ws = new WebSocket(list[0].webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const send = (method, params = {}) => new Promise((resolve) => {
    const thisId = ++id;
    pending.set(thisId, resolve);
    ws.send(JSON.stringify({ id: thisId, method, params }));
  });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
  };
  await new Promise((resolve) => { ws.onopen = resolve; });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `http://localhost:${httpPort}${urlPath}` });

  let lastElapsed = 0;
  let firstSteps = null;
  let lastSteps = null;
  let sawObservables = false;

  for (const t of sampleTimes) {
    const waitMs = Math.max(0, (t - lastElapsed) * 1000);
    if (waitMs > 0) await sleep(waitMs);
    lastElapsed = t;

    const r = await send('Runtime.evaluate', {
      expression: 'document.getElementById("observables") && document.getElementById("observables").textContent',
      returnByValue: true
    });
    const raw = r && r.result ? r.result.value : undefined;
    if (raw == null) {
      console.error(`headless_drive: #observables was missing in the page at t=${t}s`);
      ws.close();
      process.exit(1);
    }
    let o;
    try { o = JSON.parse(raw); } catch (err) {
      console.error(`headless_drive: #observables text was not valid JSON at t=${t}s: ${err.message}`);
      ws.close();
      process.exit(1);
    }
    sawObservables = true;
    if (firstSteps == null) firstSteps = o.steps;
    lastSteps = o.steps;

    const rounded = Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' ? +v.toFixed(4) : v]));
    console.log(`t=${t}s`, JSON.stringify(rounded));
  }

  if (!sawObservables) {
    console.error('headless_drive: never read a single #observables sample');
    ws.close();
    process.exit(1);
  }
  if (typeof firstSteps !== 'number' || typeof lastSteps !== 'number' || !(lastSteps > firstSteps)) {
    console.error(`headless_drive: engine step counter did not advance (steps: ${firstSteps} -> ${lastSteps}) — the rAF loop is not running in this environment`);
    ws.close();
    process.exit(1);
  }

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(screenshotPath, Buffer.from(shot.data, 'base64'));
  console.log(`screenshot written: ${screenshotPath}`);

  ws.close();
  process.exit(0);
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
