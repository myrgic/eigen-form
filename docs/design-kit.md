# The design kit: one visual language, three files

Codified 2026-08-11, alongside the params/panel modules (v0.2). The kit
is the base layer every UI module renders against: a page links the same
three stylesheets, declares its parameters, and gets the lab's look by
construction rather than by imitation.

Live specimen: `hub/kit.html`. That page is the kit demonstrating
itself: its swatches are read off the computed style at load (so it
cannot drift from the token file without showing the drift), its panel
is a real `defineParams` store rendered by `renderPanel`, and its theme
buttons restyle every module on the page by overriding custom
properties only.

## The three files

| file | owns | consumer links it when |
|------|------|------------------------|
| `src/panel/tokens.css` | the theme: palette, type stacks, spacing, radii, semantic state colors, and the mined `.grp`/`.hd`/`.read` legacy primitives | always; this is the base |
| `src/panel/panel.css`  | the generated control surface, scoped under `.ef-panel` | the page mounts a panel via `src/panel/render.js` |
| `src/kit/kit.css`      | shared chrome: badges, hash spans, tabs, cards, under `.ef-` classes | the page shows lab chrome (kind badges, provenance, tab strips) |

## Naming rule

Custom properties are the **theme surface** and stay bare (`--bg`,
`--accent`, `--space-3`): they are the contract a host page overrides,
and short names keep that contract writable. Class names are **module
structure** and carry the `ef-` prefix (`.ef-panel`, `.ef-badge`,
`.ef-hash`): they belong to the kit's DOM, not the host's vocabulary.
The unprefixed `.grp`/`.hd`/`.read` in tokens.css predate this rule
(mined from welded_fields) and remain as legacy; new chrome starts
prefixed.

## The token inventory

- **Ground and chrome**: `--bg` (page ground), `--panel` (raised
  ground), `--line` (borders), `--fg` / `--dim` / `--faint` (three
  text weights), `--accent` (the one brand hue per theme).
- **Semantic state** (v0.2 addition): `--ok`, `--warn`, `--alert`.
  These say how an adjudication stands: verdict chips on
  instrument-views, deviation callouts, gauges in alarm. They are
  chrome colors, never data colors.
- **Type**: `--mono` (readouts, hashes, headers; always
  `tabular-nums` for numbers), `--sans` (prose and labels).
- **Scale**: `--space-1..6` (4 to 24px), `--radius-1..3` (4/6/8px).

## Hue is data or brand, never both

Inherited from the roadmap, restated as the kit's one hard color rule.
Chrome and marks take brand color: the accent, or a named band from
`src/palette/gradients.js`. Measured quantities take perceptually
honest maps: monotone ramps for magnitudes, uniform cyclic maps for
phases (the cyclic maps ship with the phase-field family; until then
the rule is stated, not faked). One figure never mixes the modes, and
a plotted quantity never borrows `--accent`, `--ok`, `--warn`, or
`--alert`.

## Control classes

Defined in `docs/params-panel-design.md`, rendered by
`src/panel/render.js`, styled by `panel.css`: **knobs** (writable, by
type), **gauges** (read-only, refreshed on demand, accent-colored
readouts), **locks** (a `prereg` parameter renders its declaration and
a lock glyph; no input element exists for it). The kit adds nothing
here; it is listed because the panel is the kit's largest module and
shares its theme surface.

## Badges

One badge makes one statement:

- **kind** (identity): `frozen` (faint), `sdk` (accent),
  `instrument` (foreground). Which lab contract the app is under.
- **state** (adjudication): `ok` / `pending` / `alert` on the semantic
  tier. How a claim currently stands. An instrument-view's verdict
  slot renders `pending` until a ledger decision entry exists, then
  cites it.

Kind and state may sit side by side; one badge is never both.

## Theming recipe

A theme is a set of custom-property overrides and nothing else: declare
the same names after linking tokens.css (or set them on `:root` at
runtime), and every module follows. The specimen ships two alternates
(`ink & madder`, a paper-light theme; `tide`, a teal-dark) to prove the
flow-through is total. If restyling ever requires overriding a *rule*
in kit.css or panel.css, that is a kit defect: file it, do not fork it.

## Promotion status

`kit.css`'s shapes were promoted from `hub/index.html`'s local styles
under the rule of three (hub, specimen, and the arriving
instrument-views). The hub shell still carries its local copies;
migrating it onto `kit.css` is a declared follow-up, kept out of the
kit's own commit so the two changes stay separately revertable.

## Non-goals

- Not a component framework. Four chrome shapes, one panel, one token
  file. Anything richer belongs to the page that needs it.
- No layout opinions. Kit modules take containers; grids, columns,
  breakpoints, and stacking order are the consuming page's.
- No light-theme default. The lab is dark; `ink` exists to prove the
  contract, not to schedule a redesign.
