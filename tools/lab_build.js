#!/usr/bin/env node
'use strict';

// tools/lab_build.js: the reconciler described in docs/lab-design.md.
//
// Enumerates apps/*/app.json, validates each against the app.json contract,
// and derives hub/registry.json deterministically from what it finds.
// --check fails if the committed registry differs from the derived one.
// --write regenerates it. No other tool in this repo may write registry.json.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const APPS_DIR = path.join(ROOT, 'apps');
const HUB_DIR = path.join(ROOT, 'hub');
const GOLDENS_FILE = path.join(ROOT, 'goldens', 'originals.txt');
const REGISTRY_FILE = path.join(HUB_DIR, 'registry.json');
const PACKAGE_FILE = path.join(ROOT, 'package.json');

const VALID_KINDS = new Set(['frozen-golden', 'sdk-page', 'instrument-view']);

// Basic shape check for display.accent / display.background: not a real
// CSS-color validator, just enough to catch obvious typos (a stray path,
// an empty string). #rgb/#rgba/#rrggbb/#rrggbbaa hex, an rgb()/rgba()/
// hsl()/hsla() call, or a bare alphabetic token standing in for a named
// CSS color keyword.
const PLAUSIBLE_COLOR_RE =
  /^(#[0-9a-f]{3,4}|#[0-9a-f]{6}|#[0-9a-f]{8}|(rgb|rgba|hsl|hsla)\([^)]+\)|[a-z]+)$/i;

function isPlausibleColor(v) {
  return typeof v === 'string' && PLAUSIBLE_COLOR_RE.test(v.trim());
}

function fail(msg) {
  errors.push(msg);
}

let errors = [];

function sha256(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function parseGoldens() {
  const text = fs.readFileSync(GOLDENS_FILE, 'utf8');
  const hashes = new Set();
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const hex = trimmed.split(/\s+/)[0];
    if (/^[0-9a-f]{64}$/i.test(hex)) hashes.add(hex.toLowerCase());
  }
  return hashes;
}

// Minimal ">=x.y.z" satisfiability check for the sdk field. The contract's
// sdk versions are constraints like ">=0.1.0"; this repo doesn't vendor
// eigen-form yet (no sdk-page apps exist today), so this is exercised only
// once a first sdk-page app lands. Kept intentionally small: one operator
// (">=") against a pinned x.y.z version.
function satisfiesRange(range, version) {
  const m = /^>=\s*(\d+)\.(\d+)\.(\d+)$/.exec(range.trim());
  if (!m) return false;
  const want = m.slice(1, 4).map(Number);
  const have = version.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (have[i] > want[i]) return true;
    if (have[i] < want[i]) return false;
  }
  return true;
}

// The repo's own package.json version, not a vendored copy. sdk-page apps
// import the library's ES module directly (docs/lab-design.md, "Consuming
// the library"); there is no vendored snapshot to read a version from, so
// the reconciler checks the sdk constraint and a native app's provenance
// against the version this checkout itself declares.
function readPackageVersion() {
  if (!fs.existsSync(PACKAGE_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(PACKAGE_FILE, 'utf8')).version || null;
  } catch {
    return null;
  }
}

// provenance.builtOn shape: "eigen-form@<semver> <short-commit>". The
// version must equal this checkout's package.json version exactly (not a
// range: builtOn names the version the page was actually authored
// against). The commit is informational lineage, not re-verified against
// git HEAD: an app.json's own commit isn't known until after it's
// committed, so checking it against HEAD would be unsatisfiable by
// construction. Format only: 7-40 lowercase hex characters.
const BUILT_ON_RE = /^eigen-form@(\d+\.\d+\.\d+)\s+([0-9a-f]{7,40})$/i;

function validateApp(id, goldenHashes) {
  const appDir = path.join(APPS_DIR, id);
  const manifestPath = path.join(appDir, 'app.json');
  if (!fs.existsSync(manifestPath)) {
    fail(`${id}: missing app.json`);
    return null;
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (e) {
    fail(`${id}: app.json is not valid JSON (${e.message})`);
    return null;
  }

  // --- schema ---
  const required = ['id', 'title', 'description', 'version', 'kind', 'entry', 'provenance', 'capabilities', 'pwa'];
  for (const key of required) {
    if (!(key in manifest)) fail(`${id}: app.json missing required field "${key}"`);
  }
  if (manifest.id !== id) {
    fail(`${id}: app.json id "${manifest.id}" does not match directory name "${id}"`);
  }
  if (!VALID_KINDS.has(manifest.kind)) {
    fail(`${id}: kind "${manifest.kind}" is not one of ${[...VALID_KINDS].join(', ')}`);
  }
  if (manifest.kind === 'frozen-golden' && 'sdk' in manifest) {
    fail(`${id}: kind is frozen-golden but app.json declares an sdk field: frozen goldens build on nothing, sdk is for sdk-pages only`);
  }
  if (manifest.capabilities) {
    if (!Array.isArray(manifest.capabilities.emits)) fail(`${id}: capabilities.emits must be an array`);
    if (!Array.isArray(manifest.capabilities.accepts)) fail(`${id}: capabilities.accepts must be an array`);
  }
  if (manifest.pwa && typeof manifest.pwa.installable !== 'boolean') {
    fail(`${id}: pwa.installable must be a boolean`);
  }
  if ('display' in manifest) {
    const d = manifest.display;
    if (!d || typeof d !== 'object' || Array.isArray(d)) {
      fail(`${id}: display must be an object`);
    } else {
      if ('order' in d && !Number.isInteger(d.order)) {
        fail(`${id}: display.order must be an integer`);
      }
      if ('accent' in d && !isPlausibleColor(d.accent)) {
        fail(`${id}: display.accent "${d.accent}" is not a syntactically plausible CSS color`);
      }
      if ('background' in d && !isPlausibleColor(d.background)) {
        fail(`${id}: display.background "${d.background}" is not a syntactically plausible CSS color`);
      }
    }
  }

  // --- entry exists ---
  const entryPath = path.join(appDir, manifest.entry || 'index.html');
  if (!manifest.entry || !fs.existsSync(entryPath)) {
    fail(`${id}: entry file "${manifest.entry}" does not exist`);
    return manifest;
  }

  // --- provenance ---
  // Two shapes, exactly one required. derivesFrom: this app re-expresses
  // (byte-identical or migrated) a frozen original that exists outside
  // this repository; the hash is the only thing tying it back. builtOn:
  // this app was born native to the library, has no frozen original to
  // derive from, and instead names the eigen-form version it was built
  // against (docs/lab-design.md, "app.json"). A frozen-golden app is
  // always the derivesFrom shape (it IS the frozen bytes); a native
  // sdk-page is always builtOn; a migrated sdk-page uses derivesFrom.
  const prov = manifest.provenance || {};
  const hasDerivesFrom = Object.prototype.hasOwnProperty.call(prov, 'derivesFrom');
  const hasBuiltOn = Object.prototype.hasOwnProperty.call(prov, 'builtOn');
  if (hasDerivesFrom === hasBuiltOn) {
    fail(`${id}: provenance must have exactly one of "derivesFrom" (migrated) or "builtOn" (native), not ${hasDerivesFrom ? 'both' : 'neither'}`);
    return manifest;
  }

  if (hasDerivesFrom) {
    if (!prov.derivesFrom || !/^sha256:[0-9a-f]{64}$/i.test(prov.derivesFrom)) {
      fail(`${id}: provenance.derivesFrom must be "sha256:<64 hex chars>"`);
      return manifest;
    }
    const derivesHash = prov.derivesFrom.slice('sha256:'.length).toLowerCase();
    if (!goldenHashes.has(derivesHash)) {
      fail(`${id}: provenance.derivesFrom hash ${derivesHash} is not present in goldens/originals.txt`);
    }
    if (!Array.isArray(prov.changes)) {
      fail(`${id}: provenance.changes must be an array`);
      return manifest;
    }

    const actualHash = sha256(entryPath);
    if (prov.changes.length === 0) {
      // Byte-identical claim: the entry's own hash must equal derivesFrom.
      if (actualHash !== derivesHash) {
        fail(`${id}: changes is empty (byte-identical claim) but entry hash ${actualHash} != derivesFrom ${derivesHash}`);
      }
    } else {
      // Changed app: entryHash must be recorded (we can't diff against the
      // private original from inside this repo) and must match the actual
      // entry file, so an undeclared edit after the fact is caught.
      if (!prov.entryHash || !/^sha256:[0-9a-f]{64}$/i.test(prov.entryHash)) {
        fail(`${id}: provenance.changes is non-empty but provenance.entryHash is missing or malformed`);
      } else {
        const wantEntryHash = prov.entryHash.slice('sha256:'.length).toLowerCase();
        if (actualHash !== wantEntryHash) {
          fail(`${id}: entry hash ${actualHash} != recorded provenance.entryHash ${wantEntryHash}`);
        }
      }
    }
  } else {
    // builtOn: native sdk-page, licensed by the library version it was
    // composed on rather than by an equivalence proof against an original.
    const raw = String(prov.builtOn || '').trim();
    const m = BUILT_ON_RE.exec(raw);
    if (!m) {
      fail(`${id}: provenance.builtOn must match "eigen-form@<semver> <short-commit>", got ${JSON.stringify(prov.builtOn)}`);
    } else {
      const packageVersion = readPackageVersion();
      if (!packageVersion) {
        fail(`${id}: provenance.builtOn given but this checkout's package.json version could not be read`);
      } else if (m[1] !== packageVersion) {
        fail(`${id}: provenance.builtOn names eigen-form@${m[1]} but this checkout's package.json is at ${packageVersion}; a native app's builtOn must track the current library version`);
      }
    }
  }

  // --- sdk constraint (required for sdk-page) ---
  if (manifest.kind === 'sdk-page') {
    if (!manifest.sdk || typeof manifest.sdk !== 'object') {
      fail(`${id}: kind is sdk-page but app.json has no sdk field`);
    } else {
      const packageVersion = readPackageVersion();
      for (const [lib, range] of Object.entries(manifest.sdk)) {
        if (lib !== 'eigen-form') continue;
        if (!packageVersion) {
          fail(`${id}: sdk requires eigen-form ${range} but this checkout's package.json version could not be read`);
        } else if (!satisfiesRange(range, packageVersion)) {
          fail(`${id}: sdk requires eigen-form ${range} but this checkout's package.json version is ${packageVersion}`);
        }
      }
    }
  }

  return manifest;
}

function deriveRegistry(entries) {
  const apps = entries
    .filter(Boolean)
    .slice()
    .sort((a, b) => {
      const orderA = (a.display && Number.isInteger(a.display.order)) ? a.display.order : 999;
      const orderB = (b.display && Number.isInteger(b.display.order)) ? b.display.order : 999;
      if (orderA !== orderB) return orderA - orderB;
      return a.id.localeCompare(b.id);
    })
    .map((m) => {
      const entry = {
        id: m.id,
        title: m.title,
        description: m.description,
        path: `../apps/${m.id}/${m.entry}`,
        kind: m.kind,
        provenance: 'derivesFrom' in m.provenance
          ? { derivesFrom: m.provenance.derivesFrom, changes: m.provenance.changes }
          : { builtOn: m.provenance.builtOn },
        pwa: { installable: !!(m.pwa && m.pwa.installable) }
      };
      if (m.kind === 'sdk-page' && m.sdk) entry.sdk = m.sdk;
      if (m.display && typeof m.display === 'object') {
        const d = {};
        if ('order' in m.display) d.order = m.display.order;
        if ('accent' in m.display) d.accent = m.display.accent;
        if ('background' in m.display) d.background = m.display.background;
        if (Object.keys(d).length) entry.display = d;
      }
      return entry;
    });

  return {
    $schema: 'hub/registry.json: generated by tools/lab_build.js, do not hand-edit',
    apps
  };
}

function main() {
  const mode = process.argv.includes('--write')
    ? 'write'
    : process.argv.includes('--check')
      ? 'check'
      : 'check';

  if (!fs.existsSync(APPS_DIR)) {
    console.error('apps/ directory not found');
    process.exit(1);
  }

  const goldenHashes = parseGoldens();
  const ids = fs
    .readdirSync(APPS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  const manifests = ids.map((id) => validateApp(id, goldenHashes));

  if (errors.length) {
    console.error(`lab_build: ${errors.length} validation error(s):`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  const derived = deriveRegistry(manifests);
  const derivedText = JSON.stringify(derived, null, 2) + '\n';

  if (mode === 'write') {
    fs.mkdirSync(HUB_DIR, { recursive: true });
    fs.writeFileSync(REGISTRY_FILE, derivedText);
    console.log(`lab_build: wrote hub/registry.json (${derived.apps.length} apps)`);
    process.exit(0);
  }

  // --check
  if (!fs.existsSync(REGISTRY_FILE)) {
    console.error('lab_build: hub/registry.json does not exist, run with --write first');
    process.exit(1);
  }
  const committedText = fs.readFileSync(REGISTRY_FILE, 'utf8');
  if (committedText !== derivedText) {
    console.error('lab_build: hub/registry.json is stale: it does not match what the app manifests derive.');
    console.error('Run "node tools/lab_build.js --write" and commit the result.');
    process.exit(1);
  }

  console.log(`lab_build: registry.json is up to date (${derived.apps.length} apps), all provenance checks passed`);
  process.exit(0);
}

main();
