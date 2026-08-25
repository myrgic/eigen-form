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
N candidates (H_N / N), not a sampled run.

## Result on myrgic/cogos

```
random     MRR=0.0075
frequency  MRR=0.0758
recency    MRR=0.1029   <- best
field      MRR=0.1024
```

Diffusion adds a parameter and no predictive power. Recency alone is the
whole signal. All three beat random by 10-14x, so the corpus *is*
strongly local — that locality is simply already captured by decay.

This was pre-registered (see the `prereg` block in the page's cogdoc
frontmatter) before the first run, precisely so the null result couldn't
be quietly tuned away.

## The verdict badge

`tools/extract.py` produces `data/results.json`: the pinned reference
scores. The page re-implements the same models in JavaScript, re-runs the
backtest in the browser, and reconciles its measured numbers against that
file. The badge is that reconciliation, not a self-report.

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
