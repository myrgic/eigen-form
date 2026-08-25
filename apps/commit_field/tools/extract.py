#!/usr/bin/env python3
"""extract.py — build the commit_field dataset and its reference scores.

Reads a git repository's history and emits three files into data/:

  events.json    the event log: file table + one entry per commit
                 (timestamp, short sha, touched file indices)
  results.json   the REFERENCE scores: this file is the pinned
                 declaration the browser page reconciles itself
                 against. The page re-runs the same field models in
                 JavaScript over the same events.json and must land on
                 these numbers.
  manifest.json  provenance: repo, commit range, content hashes,
                 extractor version, and the model parameters the
                 reference scores were produced under.

The measurement
---------------
Walk commits oldest -> newest. Before applying commit c, ask each model
to rank every file it has seen so far. Score how highly it ranked the
files c actually touched. This is a strictly causal backtest: a model
never sees a commit before being scored on it, and the co-change graph
at time t is built only from commits strictly before t.

Files touched by c that the model has never seen are UNPREDICTABLE by
construction (nothing can rank a file it has no record of). They are
excluded from the scored set and reported separately as
`unseen_fraction`, rather than silently counted as misses (which would
flatter every model equally) or silently dropped (which would hide how
much of the work is on new files).

Models
------
  frequency   rank by total touch count. No time, no structure.
  recency     rank by exponentially decayed touch heat. Time, no
              structure. THIS IS THE BASELINE THE FIELD MUST BEAT.
  field       recency heat plus one-hop diffusion across the co-change
              graph. Time and structure.

The `random` row is the analytic expectation for ranking uniformly at
random over N candidates, not a sampled run: MRR = H_N / N.

Pre-registered expectation (written before the first run, see
app.json's cogdoc `prereg` block): recency alone beats frequency, and
field does NOT beat recency by more than 0.02 MRR on this corpus. If
field wins big, that is a surprise and should be treated as one.
"""

import argparse
import hashlib
import json
import math
import os
import subprocess
import sys
from collections import defaultdict

EXTRACTOR_VERSION = "1.0.0"

# ---------------------------------------------------------------------
# Model parameters. Declared here, copied into manifest.json, and read
# by the page: the browser must run the same numbers or its measured
# scores will not reconcile with results.json.
# ---------------------------------------------------------------------
PARAMS = {
    # heat half-life in days for the recency and field models
    "half_life_days": 14.0,
    # one-hop diffusion gain for the field model (0 = field degenerates
    # to recency exactly)
    "alpha": 0.35,
    # commits touching more than this many files are treated as bulk
    # (vendoring, mass rename, generated output). They still update
    # model state but are never scored: predicting "a 400-file commit
    # touched X" is not the question.
    "bulk_commit_threshold": 32,
    # a co-change edge from a commit of size k gets weight 1/(k-1), so a
    # 2-file commit is strong evidence for that pair and a 30-file
    # commit is weak evidence for each of its 435 pairs
    "cochange_size_normalized": True,
    # pairs are only recorded for commits at or below this size, to keep
    # the graph from being dominated by bulk edits
    "cochange_max_commit": 16,
}

SECONDS_PER_DAY = 86400.0


def run_git(repo, args):
    out = subprocess.run(
        ["git", "-C", repo] + args,
        check=True, capture_output=True, text=True,
    )
    return out.stdout


def read_history(repo, max_commits=None):
    """Return commits oldest-first: [{sha, t, files:[path,...]}, ...]"""
    fmt = "\x01%H\x1f%ct"
    raw = run_git(repo, [
        "log", "--reverse", "--no-merges", "--numstat",
        "--pretty=format:" + fmt,
    ])
    commits = []
    cur = None
    for line in raw.split("\n"):
        if line.startswith("\x01"):
            if cur:
                commits.append(cur)
            sha, ts = line[1:].split("\x1f")
            cur = {"sha": sha, "t": int(ts), "files": []}
            continue
        line = line.strip()
        if not line or cur is None:
            continue
        parts = line.split("\t")
        if len(parts) != 3:
            continue
        path = parts[2]
        # git renders renames as "a/{b => c}/d"; take the destination
        if " => " in path:
            if "{" in path and "}" in path:
                pre, rest = path.split("{", 1)
                mid, post = rest.split("}", 1)
                path = pre + mid.split(" => ", 1)[1] + post
            else:
                path = path.split(" => ", 1)[1]
        path = path.replace("//", "/")
        cur["files"].append(path)
    if cur:
        commits.append(cur)
    # drop commits that touched nothing parseable, dedupe file lists
    out = []
    for c in commits:
        files = sorted(set(c["files"]))
        if files:
            c["files"] = files
            out.append(c)
    if max_commits:
        out = out[-max_commits:]
    return out


# ---------------------------------------------------------------------
# The field engine. Pure state, no I/O. The JavaScript in index.html is
# a line-for-line port of this; if the two ever disagree the page's
# verdict badge goes red, which is the point.
# ---------------------------------------------------------------------
class Field:
    def __init__(self, params):
        self.p = params
        self.lam = math.log(2.0) / (params["half_life_days"] * SECONDS_PER_DAY)
        self.heat = {}        # file idx -> heat at t_last
        self.t_last = {}      # file idx -> when that heat was written
        self.count = defaultdict(int)   # file idx -> total touches
        self.edges = defaultdict(lambda: defaultdict(float))  # co-change
        self.seen = set()

    def decayed(self, i, now):
        h = self.heat.get(i)
        if h is None:
            return 0.0
        dt = now - self.t_last[i]
        if dt <= 0:
            return h
        return h * math.exp(-self.lam * dt)

    def order(self):
        """Deterministic iteration order over seen files.

        Python's set iteration is hash-ordered; JavaScript's Set is
        insertion-ordered. Floating-point summation is not associative,
        so two implementations folding the same terms in different
        orders land on different last-bit results — which is exactly
        what the page's reconciliation caught (a 3.9e-7 delta on the
        field model, and only on the field model, because it is the only
        one that sums a neighbourhood). Sorting by index makes the order
        a property of the data rather than of the language's hash
        implementation, so both ports fold identically and the
        reconciliation can hold an exact tolerance instead of a fudged
        one. The JS port sorts the same way for the same reason.
        """
        return sorted(self.seen)

    def score_recency(self, now):
        return {i: self.decayed(i, now) for i in self.order()}

    def score_frequency(self, now):
        return {i: float(self.count[i]) for i in self.order()}

    def score_field(self, now):
        base = self.score_recency(now)
        alpha = self.p["alpha"]
        out = dict(base)
        for i in sorted(self.edges.keys()):
            nbrs = self.edges[i]
            if not nbrs:
                continue
            tot = 0.0
            wsum = 0.0
            for j in sorted(nbrs.keys()):
                w = nbrs[j]
                bj = base.get(j, 0.0)
                if bj:
                    tot += w * bj
                wsum += w
            if wsum > 0 and tot > 0:
                out[i] = out.get(i, 0.0) + alpha * (tot / wsum)
        return out

    def apply(self, commit):
        """Fold a commit into the state. Called AFTER scoring on it."""
        now = commit["t"]
        idxs = commit["idx"]
        for i in idxs:
            self.heat[i] = self.decayed(i, now) + 1.0
            self.t_last[i] = now
            self.count[i] += 1
            self.seen.add(i)
        k = len(idxs)
        if 2 <= k <= self.p["cochange_max_commit"]:
            w = 1.0 / (k - 1) if self.p["cochange_size_normalized"] else 1.0
            for a in range(k):
                for b in range(a + 1, k):
                    i, j = idxs[a], idxs[b]
                    self.edges[i][j] += w
                    self.edges[j][i] += w


MODELS = ["frequency", "recency", "field"]


def backtest(commits, params):
    """Causal replay. Returns per-model aggregate scores."""
    field = Field(params)
    acc = {m: {"rr": 0.0, "hit10": 0, "hit50": 0, "n": 0} for m in MODELS}
    scored_commits = 0
    unseen_touched = 0
    total_touched = 0
    candidate_sizes = []

    for c in commits:
        idxs = c["idx"]
        bulk = len(idxs) > params["bulk_commit_threshold"]
        if not bulk and field.seen:
            target = [i for i in idxs if i in field.seen]
            total_touched += len(idxs)
            unseen_touched += len(idxs) - len(target)
            if target:
                scored_commits += 1
                candidate_sizes.append(len(field.seen))
                scores = {
                    "frequency": field.score_frequency(c["t"]),
                    "recency": field.score_recency(c["t"]),
                    "field": field.score_field(c["t"]),
                }
                for m in MODELS:
                    s = scores[m]
                    # rank: 1 + number of candidates strictly better.
                    # ties broken pessimistically (half the tied block),
                    # so a model that scores everything 0 gets the
                    # random-guess rank rather than rank 1.
                    for i in target:
                        si = s.get(i, 0.0)
                        better = 0
                        tied = 0
                        for j, sj in s.items():
                            if sj > si:
                                better += 1
                            elif sj == si and j != i:
                                tied += 1
                        rank = better + tied / 2.0 + 1.0
                        a = acc[m]
                        a["rr"] += 1.0 / rank
                        a["n"] += 1
                        if rank <= 10:
                            a["hit10"] += 1
                        if rank <= 50:
                            a["hit50"] += 1
        field.apply(c)

    results = {}
    for m in MODELS:
        a = acc[m]
        n = max(a["n"], 1)
        results[m] = {
            "mrr": a["rr"] / n,
            "hit10": a["hit10"] / n,
            "hit50": a["hit50"] / n,
            "n": a["n"],
        }
    # analytic random baseline: mean over scored commits of H_N / N
    rr = 0.0
    for N in candidate_sizes:
        rr += harmonic(N) / N
    results["random"] = {
        "mrr": rr / max(len(candidate_sizes), 1),
        "hit10": sum(min(10, N) / N for N in candidate_sizes) / max(len(candidate_sizes), 1),
        "hit50": sum(min(50, N) / N for N in candidate_sizes) / max(len(candidate_sizes), 1),
        "n": len(candidate_sizes),
        "analytic": True,
    }
    meta = {
        "scored_commits": scored_commits,
        "unseen_fraction": (unseen_touched / total_touched) if total_touched else 0.0,
        "mean_candidates": (sum(candidate_sizes) / len(candidate_sizes)) if candidate_sizes else 0.0,
    }
    return results, meta


def harmonic(n):
    # H_n, exact for small n, asymptotic above
    if n <= 256:
        return sum(1.0 / k for k in range(1, n + 1))
    return math.log(n) + 0.5772156649015329 + 1.0 / (2 * n)


def sha256_text(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", required=True)
    ap.add_argument("--label", required=True, help="dataset label, e.g. myrgic/cogos")
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "data"))
    ap.add_argument("--max-commits", type=int, default=0)
    args = ap.parse_args()

    repo = os.path.abspath(args.repo)
    outdir = os.path.abspath(args.out)
    os.makedirs(outdir, exist_ok=True)

    commits = read_history(repo, args.max_commits or None)
    if not commits:
        print("no commits found", file=sys.stderr)
        return 1

    # file table, ordered by first appearance
    table = []
    index = {}
    for c in commits:
        for f in c["files"]:
            if f not in index:
                index[f] = len(table)
                table.append(f)
        c["idx"] = sorted(index[f] for f in c["files"])

    events = [
        {"t": c["t"], "sha": c["sha"][:10], "f": c["idx"]}
        for c in commits
    ]
    events_doc = {
        "label": args.label,
        "files": table,
        "events": events,
    }
    events_text = json.dumps(events_doc, separators=(",", ":"), sort_keys=False) + "\n"

    results, meta = backtest(commits, PARAMS)

    head = run_git(repo, ["rev-parse", "HEAD"]).strip()
    results_doc = {
        "$comment": (
            "REFERENCE SCORES. The page re-runs these models in the browser "
            "over data/events.json and reconciles its measured values "
            "against this file. A mismatch is a defect, not a rounding "
            "difference: both implementations are deterministic."
        ),
        "dataset": args.label,
        "params": PARAMS,
        "meta": meta,
        "models": results,
    }
    results_text = json.dumps(results_doc, indent=2, sort_keys=False) + "\n"

    manifest = {
        "dataset": args.label,
        "repo_head": head,
        "commits": len(commits),
        "files": len(table),
        "span": {
            "from": commits[0]["t"],
            "to": commits[-1]["t"],
        },
        "extractor": {
            "path": "tools/extract.py",
            "version": EXTRACTOR_VERSION,
            "sha256": sha256_text(open(__file__, encoding="utf-8").read()),
        },
        "artifacts": {
            "events.json": "sha256:" + sha256_text(events_text),
            "results.json": "sha256:" + sha256_text(results_text),
        },
        "params": PARAMS,
    }
    manifest_text = json.dumps(manifest, indent=2) + "\n"

    with open(os.path.join(outdir, "events.json"), "w") as fh:
        fh.write(events_text)
    with open(os.path.join(outdir, "results.json"), "w") as fh:
        fh.write(results_text)
    with open(os.path.join(outdir, "manifest.json"), "w") as fh:
        fh.write(manifest_text)

    print(f"commits={len(commits)} files={len(table)} scored={meta['scored_commits']} "
          f"unseen={meta['unseen_fraction']:.3f} meanN={meta['mean_candidates']:.0f}")
    for m in ["random", "frequency", "recency", "field"]:
        r = results[m]
        print(f"  {m:10s} MRR={r['mrr']:.4f}  hit@10={r['hit10']:.3f}  "
              f"hit@50={r['hit50']:.3f}  n={r['n']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
