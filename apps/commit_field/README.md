# commit_field

A causal backtest of stigmergic heat models against real git history.

## The question

Slime-mold-inspired agent-board designs assume a repository heat field
tells agents where work is going. Nobody checks. This app checks.

Walk a real commit log oldest to newest. Before applying commit *c*, ask
each model to rank every file it has seen. Score how highly it ranked the
files *c* actually touched (mean reciprocal rank). A model never sees a
commit before being scored on it, and the co-change graph at time *t* is
built only from commits strictly before *t*.

## Models

| model | uses time | uses structure |
|---|---|---|
| `frequency` | no | no |
| `recency` | yes (exponential decay) | no |
| `field` | yes | yes (one-hop co-change diffusion) |

`random` is the analytic expectation of ranking uniformly at random over
N candidates (H_N / N per target), not a sampled run. It is averaged per
target, like the models: sum(k * H_N / N) / sum(k) over scored commits
with k targets. (Extractor 1.0.0 averaged it per commit, which made it
smaller and every ratio to it larger.)

## Result on myrgic/cogos

```
random     MRR=0.0082   (per target; 0.0075 per commit)
frequency  MRR=0.0758   9.2x random
recency    MRR=0.1029   12.5x random   <- best
field      MRR=0.1024   12.4x random
```

Diffusion adds no next-file prediction over recency: field - recency =
-0.0005 MRR, paired bootstrap 95% CI [-0.0021, +0.0012] over the 627
scored commits, well inside the declared 0.02 margin. Recency beats
frequency (+0.027, CI [+0.020, +0.034]).

The third declared statement, "all three > 10x random", fails for
frequency (9.2x) on the like-for-like baseline, and the page says so.
The ratio grows with the number of candidate files and moves with the
bulk cutoff, so it is not comparable across corpora.

The expectations are declared in the `prereg` block of the page's cogdoc
frontmatter. They landed in the same commit as the first results, so
they are not independently timestamped.

## The verdict badge

`tools/extract.py` produces `data/results.json`: the pinned reference
scores. The page re-implements the same models in JavaScript, re-runs the
backtest in the browser, and reconciles its measured numbers against that
file. The badge shows only that the two implementations agree; the
declared predictions are evaluated and listed separately under it.

The JS is a deliberate port rather than a shared bundle — a shared
implementation could only ever agree with itself. The port has already
earned its keep: it caught a fold-order divergence between Python's
hash-ordered `set` and JavaScript's insertion-ordered `Set` (fixed in
both by `Field.order()`), leaving a residue of ~5e-7 MRR that traces to
V8 and CPython's `exp` differing by 1 ULP. The tolerance is 1e-5 —
two orders above that hardware residue, four orders below the smallest
difference the page actually claims.

## Regenerating

```bash
python3 tools/extract.py --repo /path/to/repo --label "org/repo"
```

Writes `data/events.json`, `data/results.json`, `data/manifest.json`.
Any git repository works; the single-corpus limitation is declared in the
page's `limitations`, and this is how you test it.

## Files

```
app.json              lab manifest (kind: instrument-view)
index.html            the page: cogdoc frontmatter + engine port + view
tools/extract.py      the extractor and reference scorer
data/events.json      file table + one entry per commit
data/results.json     pinned reference scores
data/manifest.json    provenance: repo head, hashes, params
```
