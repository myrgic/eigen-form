# goldens/

Two distinct kinds of committed hash live in this directory; both are
checked in CI, by different tools, against different content.

- `ops-v0.0.2.json`: op-stream goldens for the library's own rendering.
  Checked by `tools/golden.js --check`. A hash here covers a sequence of
  canvas calls `createTrefoilMark()` makes for one scenario; it moves
  when the engine's drawing changes.
- `originals.txt`: content hashes of the frozen simulation pages the
  lab's apps derive from (plus one vendored third-party asset). Checked
  by `tools/lab_build.js --check` against each app's
  `provenance.derivesFrom`. A hash here covers a whole file's bytes; it
  never moves, because the originals it points at are never edited.
