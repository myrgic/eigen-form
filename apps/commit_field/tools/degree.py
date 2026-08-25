#!/usr/bin/env python3
"""
Measure <k> (mean interaction degree) on the real co-change graph of a repo,
using the same construction commit_field's extractor uses.

The paper arXiv:2512.10166 defines rho_c = mu / (alpha * <k>), where <k> is the
"mean interaction degree" -- for their ants, the number of neighbours a agent
senses in a Moore neighbourhood of radius 2, stated as 3.5 after accounting for
obstacles.

The analogue here: for a file (cell), how many OTHER files does it share a
commit with? That is the number of places a deposit on this file can be sensed
from. We report several estimators because "mean degree" is ambiguous on a
weighted graph, and the choice matters:

MEASURED RESULT (2026-08-22), four myrgic repos:

    repo                 commits  files  bulk>16  %pairs from bulk  k_eff@16  iso%
    myrgic/cogos             734   1807       40            98.59%      7.63  49.3%
    myrgic/constellation      20     32        1            71.08%      6.74  34.4%
    myrgic/mod3              180    220        6            44.83%      7.75  16.4%
    myrgic/theseus            84    112        2            96.13%      5.23  71.4%

Two findings, and the second is the load-bearing one.

1. <k>_effective converges to 5-8 across repos spanning 20 to 734 commits and
   32 to 1807 files. That is 1.5-2.2x the ant baseline of 3.5, NOT the order of
   magnitude that was assumed before measuring.

2. <k> IS NOT A PROPERTY OF THE REPO. It is a property of (repo, what you count
   as a co-change). On cogos, raw <k> ranges 10.68 -> 177.17 (16x) purely on the
   commit-size cutoff, and effective <k> ranges 4.80 -> 124.67. The cause:
   98.59% of ALL co-change pairs in cogos come from just 40 bulk commits, which
   are refactors, renames and vendoring -- not evidence that two files are
   coupled. A single 414-file commit contributes 85,491 pairs on its own.

   So the cutoff is not a tuning knob, it is the central claim of the graph.
   Any <k> quoted without its cutoff is meaningless. Report the range.

  k_raw        : mean unweighted degree -- every co-change partner ever
  k_effective  : mean *participation ratio* per node = (sum w)^2 / sum(w^2),
                 i.e. the effective number of neighbours that actually carry
                 the weight. This is the honest analogue of a sensing
                 neighbourhood, because a node with 200 partners of which 3
                 matter does not sense 200.
  k_median     : median degree, since these distributions are heavy-tailed
                 and the mean is not the typical node.

Reads data/events.json produced by extract.py.
"""
import json, sys, math
from collections import defaultdict

MAX_COMMIT = 16          # matches extractor's cochange_max_commit
SIZE_NORMALIZED = True   # matches extractor's cochange_size_normalized


def build(events, max_commit=MAX_COMMIT, size_norm=SIZE_NORMALIZED):
    edges = defaultdict(lambda: defaultdict(float))
    n_commits_used = 0
    for ev in events:
        files = ev["f"]
        k = len(files)
        if not (2 <= k <= max_commit):
            continue
        n_commits_used += 1
        w = 1.0 / (k - 1) if size_norm else 1.0
        for i in range(len(files)):
            for j in range(i + 1, len(files)):
                a, b = files[i], files[j]
                edges[a][b] += w
                edges[b][a] += w
    return edges, n_commits_used


def stats(edges, n_files_total):
    raw, eff = [], []
    for node, nbrs in edges.items():
        ws = list(nbrs.values())
        raw.append(len(ws))
        s1 = sum(ws)
        s2 = sum(w * w for w in ws)
        eff.append((s1 * s1 / s2) if s2 > 0 else 0.0)

    def med(xs):
        if not xs:
            return 0.0
        s = sorted(xs)
        n = len(s)
        return s[n // 2] if n % 2 else 0.5 * (s[n // 2 - 1] + s[n // 2])

    connected = len(raw)
    return {
        "files_total": n_files_total,
        "files_in_graph": connected,
        "isolated_files": n_files_total - connected,
        "k_raw_mean": sum(raw) / connected if connected else 0.0,
        "k_raw_median": med(raw),
        "k_raw_max": max(raw) if raw else 0,
        "k_effective_mean": sum(eff) / connected if connected else 0.0,
        "k_effective_median": med(eff),
        # mean over ALL files, counting isolated ones as degree 0 --
        # the conservative reading, since an isolated file senses nothing
        "k_raw_mean_all_files": (sum(raw) / n_files_total) if n_files_total else 0.0,
        "k_effective_mean_all_files": (sum(eff) / n_files_total) if n_files_total else 0.0,
    }


def rho_c(mu, alpha, k):
    return mu / (alpha * k)


def main(path):
    data = json.load(open(path))
    events = data["events"]
    n_files = len(data["files"])

    edges, used = build(events)
    st = stats(edges, n_files)

    print(f"source: {path}")
    print(f"commits total          : {len(events)}")
    print(f"commits contributing   : {used}  (2 <= size <= {MAX_COMMIT})")
    print(f"files total            : {st['files_total']}")
    print(f"files in graph         : {st['files_in_graph']}")
    print(f"isolated files         : {st['isolated_files']}")
    print()
    print(f"<k> raw mean           : {st['k_raw_mean']:.2f}   (median {st['k_raw_median']:.0f}, max {st['k_raw_max']})")
    print(f"<k> effective mean     : {st['k_effective_mean']:.2f}   (median {st['k_effective_median']:.2f})")
    print(f"<k> raw, all files     : {st['k_raw_mean_all_files']:.2f}")
    print(f"<k> effective, all     : {st['k_effective_mean_all_files']:.2f}")
    print()
    print("paper's ant baseline   : <k> = 3.5, alpha = 0.025, mu = 0.20")
    print(f"paper rho_c            : {rho_c(0.20, 0.025, 3.5):.4f} agents/cell  (paper MISSTATES this as 0.23)")
    print()
    print("rho_c under our measured <k>, holding the paper's mu and alpha:")
    for label, k in [
        ("k_effective", st["k_effective_mean"]),
        ("k_raw", st["k_raw_mean"]),
    ]:
        r = rho_c(0.20, 0.025, k)
        print(f"  {label:<14} k={k:7.2f}  rho_c={r:8.4f}  -> {r*st['files_total']:9.1f} agents over {st['files_total']} files")
    print()
    print("alpha is the other term we control (paper: 0.025 = an ant reading pheromone).")
    print("rho_c with measured <k> and a range of alpha:")
    kk = st["k_effective_mean"]
    for a in (0.025, 0.10, 0.25, 0.50):
        r = rho_c(0.20, a, kk)
        print(f"  alpha={a:<6} rho_c={r:8.4f}  -> {r*st['files_total']:9.1f} agents")
    return st


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "data/events.json")
