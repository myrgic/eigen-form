#!/usr/bin/env python3
"""
rule_sweep.py -- quantify Howison et al.'s (JAIS 2011) Issue 4 / Issue 10.

Issue 4 (Link Intensity) asks: "Should links be binary; if so what is a valid
threshold?" Issue 10 warns that network measures "may not be valid outside
their original context." Both are stated qualitatively, with recommendations.
This puts a number on them.

MEASURES, for a corpus of variable-size containers (git commits, or reference
lists):
  * <k>_eff  -- mean participation ratio per node, (sum w)^2 / sum(w^2). The
                effective number of neighbours actually carrying the weight.
  * <k>_raw  -- mean unweighted degree.
  * the RULE SWING: max/min of <k> across a sweep of the evidence rule (the
    container-size cap), i.e. how much the analyst's choice moves the answer.

BOOTSTRAP: containers are resampled with replacement (B times) and the whole
graph rebuilt each time, giving a percentile CI on <k> at each cap AND on the
swing itself. Resampling CONTAINERS (not edges) is the right unit because the
container is what the analyst's rule accepts or rejects.

METHODOLOGICAL TEMPLATE: Zheng, Mai, Yan & Nickerson (JMIS 2023) re-estimate
their dependent variable under 30-minute, 1-hour and 3-hour session cutoffs and
report that direction and significance are unchanged. This is the same move
applied to the commit-size cap, with CIs attached.

Usage:
  python3 rule_sweep.py git  <repo_path> [--max-commits N] [--boot 200]
  python3 rule_sweep.py cite <openalex query> [--n 600] [--boot 200]
"""
import argparse, json, random, subprocess, sys, time
from collections import defaultdict

CAPS = [4, 8, 16, 32, 64, 128, 10 ** 9]
UA = "cog-research/1.0 (mailto:chaz@myrgic.com)"


# ---------------------------------------------------------------- containers
def git_containers(repo, max_commits=None):
    """Each commit -> list of file paths touched. Merges excluded."""
    cmd = ["git", "-C", repo, "log", "--no-merges", "--name-only",
           "--pretty=format:\x01%H"]
    if max_commits:
        cmd += ["-n", str(max_commits)]
    out = subprocess.run(cmd, capture_output=True, text=True, timeout=900).stdout
    containers, cur = [], None
    for line in out.split("\n"):
        if line.startswith("\x01"):
            if cur:
                containers.append(cur)
            cur = []
        elif line.strip() and cur is not None:
            cur.append(line.strip())
    if cur:
        containers.append(cur)
    return [c for c in containers if c]


def cite_containers(query, n=600):
    """Each paper -> its reference list (OpenAlex work IDs)."""
    out, cur = [], "*"
    q = query.replace(" ", "%20")
    while len(out) < n:
        url = ("https://api.openalex.org/works?filter=default.search:" + q +
               "&per-page=200&cursor=" + cur + "&select=id,referenced_works")
        r = subprocess.run(["curl", "-sSL", "--max-time", "60", "-A", UA, url],
                           capture_output=True, text=True, timeout=75).stdout
        try:
            d = json.loads(r)
        except Exception:
            break
        if "results" not in d:
            break
        out += d["results"]
        cur = d.get("meta", {}).get("next_cursor")
        if not cur:
            break
        time.sleep(1)
    return [w["referenced_works"] for w in out if (w.get("referenced_works") or [])]


# -------------------------------------------------------------------- metric
def k_of(containers, cap, size_norm=True):
    """<k>_eff and <k>_raw for the one-mode projection under a size cap."""
    edges = defaultdict(lambda: defaultdict(float))
    for members in containers:
        k = len(members)
        if not (2 <= k <= cap):
            continue
        w = 1.0 / (k - 1) if size_norm else 1.0
        for i in range(k):
            mi = members[i]
            for j in range(i + 1, k):
                mj = members[j]
                edges[mi][mj] += w
                edges[mj][mi] += w
    if not edges:
        return 0.0, 0.0, 0
    eff, raw = [], []
    for nb in edges.values():
        ws = list(nb.values())
        s1 = sum(ws)
        s2 = sum(x * x for x in ws)
        eff.append(s1 * s1 / s2 if s2 else 0.0)
        raw.append(len(ws))
    return sum(eff) / len(eff), sum(raw) / len(raw), len(eff)


def pct(xs, p):
    if not xs:
        return float("nan")
    s = sorted(xs)
    i = max(0, min(len(s) - 1, int(round(p / 100.0 * (len(s) - 1)))))
    return s[i]


def bootstrap(containers, caps, B=200, seed=1, frac=0.8):
    """Resample CONTAINERS and rebuild the graph each time.

    NOTE ON METHOD (learned the hard way, 2026-08-22): the classical
    with-replacement bootstrap is BIASED for this statistic. Duplicating a
    container repeats the same pairs, which concentrates edge weight and
    shifts <k>_eff systematically -- observed as a 95% CI that did not contain
    the point estimate at all (e.g. point 124.67 vs CI [128.47, 151.85]).
    A CI that excludes its own point estimate is a bug, not a finding.

    Fix: SUBSAMPLE WITHOUT REPLACEMENT (m-out-of-n, default m = 0.8n). No
    container is duplicated, so weight concentration is untouched, and the
    spread reflects genuine sampling variability in which containers exist.
    Intervals are therefore slightly conservative (built on less data).
    """
    rng = random.Random(seed)
    n = len(containers)
    m = max(2, int(frac * n))
    per_cap = {c: [] for c in caps}
    swings = []
    for _ in range(B):
        samp = rng.sample(containers, m)
        vals = []
        for c in caps:
            e, _, _ = k_of(samp, c)
            per_cap[c].append(e)
            if e > 0:
                vals.append(e)
        if len(vals) >= 2 and min(vals) > 0:
            swings.append(max(vals) / min(vals))
    return per_cap, swings


def report(label, containers, B=200):
    sizes = [len(c) for c in containers]
    print("=" * 78)
    print("CORPUS: " + label)
    print("  containers=%d   median size=%d   max size=%d" %
          (len(containers), sorted(sizes)[len(sizes) // 2], max(sizes)))
    total_pairs = sum(k * (k - 1) // 2 for k in sizes)
    p16 = sum(k * (k - 1) // 2 for k in sizes if 2 <= k <= 16)
    print("  pairs total=%s   from containers<=16: %.2f%%" %
          (format(total_pairs, ","), 100.0 * p16 / total_pairs if total_pairs else 0))
    print()
    print("  %8s %10s %10s %22s" % ("cap", "k_eff", "k_raw", "95% CI on k_eff"))
    per_cap, swings = bootstrap(containers, CAPS, B=B)
    point = {}
    for c in CAPS:
        e, r, nodes = k_of(containers, c)
        point[c] = e
        lo, hi = pct(per_cap[c], 2.5), pct(per_cap[c], 97.5)
        print("  %8s %10.2f %10.2f      [%7.2f, %7.2f]" %
              (c if c < 10 ** 8 else "none", e, r, lo, hi))
    vals = [v for v in point.values() if v > 0]
    swing = max(vals) / min(vals)
    print()
    print("  RULE SWING (max/min k_eff across the cap sweep) = %.1fx" % swing)
    if swings:
        print("     bootstrap 95%% CI on the swing: [%.1fx, %.1fx]  (B=%d)" %
              (pct(swings, 2.5), pct(swings, 97.5), len(swings)))
    return {"label": label, "containers": len(containers),
            "median_size": sorted(sizes)[len(sizes) // 2], "max_size": max(sizes),
            "bulk_pair_pct": 100.0 * (1 - p16 / total_pairs) if total_pairs else 0,
            "k_eff": {str(c): point[c] for c in CAPS},
            "ci": {str(c): [pct(per_cap[c], 2.5), pct(per_cap[c], 97.5)] for c in CAPS},
            "swing": swing,
            "swing_ci": [pct(swings, 2.5), pct(swings, 97.5)] if swings else None}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=["git", "cite"])
    ap.add_argument("target")
    ap.add_argument("--max-commits", type=int, default=3000)
    ap.add_argument("--n", type=int, default=600)
    ap.add_argument("--boot", type=int, default=200)
    ap.add_argument("--out", default=None)
    a = ap.parse_args()
    if a.mode == "git":
        cs = git_containers(a.target, a.max_commits)
        label = "git:" + a.target.rstrip("/").split("/")[-1]
    else:
        cs = cite_containers(a.target, a.n)
        label = "cite:" + a.target
    if not cs:
        print("no containers for", a.target)
        return
    res = report(label, cs, B=a.boot)
    if a.out:
        json.dump(res, open(a.out, "w"), indent=1)


if __name__ == "__main__":
    main()
