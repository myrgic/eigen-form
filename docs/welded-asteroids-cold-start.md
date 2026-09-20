# welded_asteroids / eigen-form — Cold-Start Handoff

*Written 2026-09-20 by the outgoing session. Confidence markers on every state claim.*

## 0. BLUF

**What:** `welded_asteroids` is a physarum (slime-mold) simulation running on closed quotient surfaces — torus, Klein bottle, projective plane, Möbius strip — where the topology IS the point. It lives in the `eigen-form` lab repo and is deployed at **https://myrgic.com/eigen-form/apps/welded_asteroids/index.html**. Current version **v2.9.0**, merged to main, CI green, live.

**Where:** Repo `/Users/slowbro/workspaces/myrgic/eigen-form`, branch `feat/welded-asteroids-v2`, app at `apps/welded_asteroids/`.

**What's new this session (PRs #9–#18, all merged):** seam-wall bug fixes, real height relief, color separation (green chemical / violet contours / cyan-white agents), slice scope (planar torus section → two circles → diff vs clamped radius), quadrant scope + per-frame COM precession, collector plates (BPM-style normalized steering vector), mobile/fold touch support.

**What's next (most likely):** user will want arbitrary-plane slice orientation, BPM auto-zero calibration, relief-feedback into the sim, or a second Codex co-review. Also open: **aquarium app is on the shelf labeled unvetted** and has never been reviewed.

## 1. What Is This

**welded_asteroids** — a physarum simulation on quotient surfaces. Agents deposit a chemical, sense it, steer toward it; the surface's gluing rules (torus = periodic, Klein = one periodic + one mirrored seam, etc.) shape what structures form. The standing operator directive (verbatim): *"The simulation should follow the topology. I don't actually want the asteroids game itself in it (maybe as an Easter egg), I want the simulation itself to provide the levels and knobs to drive the physarium."* The asteroids game survives only as a hidden Easter egg (appears when β₁ ≥ 42).

**eigen-form lab** — a GitHub Pages-served "shelf" of self-contained apps at `myrgic.com/eigen-form/`, governed by lab discipline: frozen-golden ancestor (byte-identical `welded_fields`), provenance sha256s, cogdoc frontmatter, declared parameter knobs with `meaning` fields, generated `hub/registry.json`. There's a repo tool `tools/lab_build.js` that validates manifests and regenerates the registry.

**The operator** = Chaz. He reviews **visually** — screenshots are his bug reports. He says "/yolo" to authorize decisive action, asks for Codex (`codex exec`) as independent reviewer with hypotheses plus license to disprove.

## 2. Why It Exists

Chaz's thesis: topology shapes computation. The sim is an instrument for watching how a medium's rules of gluing (the "welds") determine what structures emerge — loops, seams, braids — and those structures are measured (β₀ components, β₁ voids, coverage) rather than just displayed. Each release has added *instruments*: the slice scope, the quadrant scope, the BPM plates — all operator-conceived, agent-built.

## 3. Key Decisions

- **foldRead/uvOf/momRead mirror the CROSSED axis, not the named one** (`y.flip='x'` ⇒ x is mirrored at the y-seam). Named the other way twice this session; both times wrong. The Klein rule is `(x, y+H) ≡ (W−x, y)`.
- **The parametrization IS the folded immersion** — texture/relief sampling must NOT fold again. `foldUv` is deliberately the identity; there's a comment saying so. Do not "fix" this.
- **Diffusion is mirror-periodic at seams, not periodic** — `nb()` must sample the glued neighbor, and the mirrored vector component flips sign. Torus diffusion is plain periodic.
- **The physarum turn rule is chiral** across mirrored seams — L/R sense samples swap when the fold image differs; without this agents re-trap into seam walls.
- **Texture `flipY=false`** — found by Codex co-review (PR #13). Texture rows must match height-sample rows; the three.js default mirror-flipped the relief.
- **Ship path:** feat branch → `lab_build --write` → `lab_build --check` → PR → squash-merge → Pages. Merge conflicts on `hub/registry.json` / `app.json` are routine — resolve `--ours` for app files, regenerate the registry, commit.
- **BPM readout over raw masses** (v2.8): normalized difference `b=(bx,by)` divides out total trail intensity; the trace of b is the precession plot.

## 4. Architecture

Single self-contained `apps/welded_asteroids/index.html` (~1700 lines). One classic script for sim + one module script for three.js.

```
classic script:
  TOPOLOGIES      gluing specs (flip axis/type per seam)
  SURFACES        parametrizations torus/klein/mobius/projective
  grid/tmp/mask   W=H=300 fundamental polygon, Float32Array
  stepAgents()    deposit → sense → steer (chirality-aware at seams)
  diffuseDecay()  mirror-periodic diffusion at welds
  wrapPos()       seam crossing (double-flip safe)
  foldRead()      mirrored sample read (crossed-axis rule)
  simStep()       extracted physics (v2.5), seeded rng, steppable
  measure(t)      β₀/β₁ via components()/euler() on threshold mask
  sliceSample()   v2.6 planar torus section, two circles, diff vs ρc
  fieldCOM()      v2.7 per-frame center of mass (torus frame)
  quadrantMasses() v2.7 four quarter masses
  plateSignal()   v2.8 BPM normalized steering vector
  LEVELS[]        six tour levels; the sim provides them
module script (three.js):
  buildSurface()  mesh from SURFACES + relief displacement
  foldUv()        identity (see Key Decisions)
  pushContours()/pushAgents()  displaced entity layers
  Pxyz()          barycentric on displaced buffer (entities ride the mesh)
  orbit/pinch     pointer + touch handlers
```

## 5. File Map (repo root `/Users/slowbro/workspaces/myrgic/eigen-form`)

```
apps/welded_asteroids/index.html   the whole app
apps/welded_asteroids/app.json     manifest: version/description/kind/cogdoc
apps/welded_fields/index.html      frozen-golden ancestor (do not touch)
apps/aquarium/                     second app, UNVETTED (vetted:false badge)
hub/index.html                     the shelf; renders vetted/unvetted badges
hub/registry.json                  generated by lab_build.js, do not hand-edit
tools/lab_build.js                 manifest validator + registry generator
tests/                             node test suites run by CI
```

## 6. Current State

- **Working (confirmed):** all six surfaces render; 150s Klein soak clean; torus/projective/Möbius healthy; relief + contours + agents aligned (post Codex fixes); slice/quadrant/BPM readouts verified headless; mobile touch orbit + pinch + tabbed stage verified at 390×844 viewport; CI green on every merged PR; live URL 200 serving v2.9.0.
- **Working (assessed, not user-confirmed):** the fold's *feel* — drag sensitivity 0.008 rad/px, drawer breakpoint at 900px width. User hasn't reported back since PR #18.
- **Planned (discussed, not built):** arbitrary-plane slice orientation (2-angle tilt readout); BPM auto-zero (store offset at reset, subtract); relief feeding back into sim (agents preferring slopes); extending slice/quadrant scope to Klein.
- **Broken (known issue):** nothing open. Historical seam-wall collapse fully fixed in v2.5.1 (sensing path) — negative-result validated, torus invariant.
- **Not started:** aquarium review (it's labeled unvetted on purpose — flip manifest `vetted:false` after review).

## 7. How to Build / Run / Test

```bash
cd /Users/slowbro/workspaces/myrgic/eigen-form
python3 -m http.server 8777 --bind 127.0.0.1 &     # serve locally
# app at http://127.0.0.1:8777/apps/welded_asteroids/index.html

node tools/lab_build.js --write    # regen hub/registry.json (run after app.json edits)
node tools/lab_build.js --check    # validate manifests + provenance
node --check <(sed -n 's/.*<script>//' apps/welded_asteroids/index.html)   # rough syntax check

# headless browser verification (playwright-core):
NODE_PATH=/Users/slowbro/.npm/_npx/86170c4cd1c5da32/node_modules node /tmp/your_test.js
# executablePath: /Users/slowbro/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing
# MUST pass flag: --enable-unsafe-swiftshader (no GPU in headless)
```

Test port (browser console): `window.__welded` → `{ P, topo, grid, W, H, parts, B, slice(), com(), quadrants(), plates(), SL, QS, ... }`.

Ship: commit → push `feat/welded-asteroids-v2` → `gh pr create` → wait for the two CI checks → `gh pr merge N --squash` → Pages deploys in ~70s.

## 8. What to Build Next (dependency-ordered)

1. **Wait for user feedback on fold feel** — Small. If he says nothing, don't touch it.
2. **BPM auto-zero calibration** — Small. Store (bx,by) at reset, subtract live. Unblocks: clean precession traces from non-centered spawns.
3. **Arbitrary plane orientation for slice scope** — Medium. Normal vector + two-angle phase readout. Unblocks: watching a structure's tilt plane rotate.
4. **Relief feedback into sim** — Medium. Gradient of height field biases agent steering. Unblocks: terrain-preference behavior.
5. **Aquarium review** — Large, independent lane. Its regression tests + headless driver are in the repo; review it, then flip `vetted:false` in `apps/aquarium/app.json`.

## 9. Constraints

- **Do not modify `apps/welded_fields/index.html`** (frozen ancestor, provenance-checked).
- **Do not hand-edit `hub/registry.json`** — regenerate.
- **Never echo API keys.** OpenRouter key lives in `~/.hermes/profiles/cog/.env` (read inside Python, never print). HF token at `~/.cache/huggingface/token` (user slowbrow).
- **Gemini-skill rule:** never recommend/pass/configure API keys.
- **"I like free"** — local/free models preferred; the one paid lane is audio-input LLMs (~0.7¢/call).
- **Lab discipline:** every knob declared in app.json with `meaning`; hue-is-data; PR-per-fix iterate cycles are approved ("/yolo" = go).
- **Codex reviews:** `codex exec --skip-git-repo-check --sandbox read-only -m gpt-6-astra -C <repo> "<prompt>"` — give it the symptom, your hypotheses, and license to disprove. It found a bug I'd missed twice.
- The workflow recorder: **verify visually** — screenshots to `/tmp/*.png`, inspect with vision, only then claim fixed.

## 10. Key Files to Read (in order)

1. `apps/welded_asteroids/app.json` — what the app claims to be, version history in the description
2. `apps/welded_asteroids/index.html` (search for the section banners `/* ── ... ── */`) — they partition the file readably
3. `hub/index.html` `badgesHtml()` — how shelf badges work
4. `tools/lab_build.js` — the ship gate
5. `git log --oneline -20` — the session's arc, every commit message is honest
6. `apps/welded_fields/index.html` — the ancestor, for taste reference
```
