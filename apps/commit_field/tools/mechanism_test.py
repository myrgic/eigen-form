#!/usr/bin/env python3
"""
mechanism_test.py -- is git's lower rule-sensitivity caused by MECHANICAL bulk?

PRE-REGISTERED 2026-08-22, BEFORE running. Kill condition stated up front.

HYPOTHESIS
  Citation corpora are ~2x more rule-sensitive than git repos (6.68x vs 3.27x
  swing in k_eff between cap 16 and cap 128; p = 0.00025). Proposed cause:
  git's large containers are MECHANICAL -- vendoring, generated code, mass
  renames, lockfiles, dependency bumps. Their pairs are junk, so capping them
  removes noise and k_eff barely moves. A large reference list is CURATED -- a
  human chose every entry -- so capping it destroys real signal and k_eff moves
  a lot.

PREDICTION
  If the hypothesis holds, removing MECHANICAL bulk commits should make git
  behave more like literature: git's swing should RISE toward the citation
  range, because the bulk that remains is genuine.

KILL CONDITION
  If excluding mechanical bulk commits does NOT raise git's mean swing
  materially (say < +20% of the 3.41x gap, i.e. mean stays below ~4.0x), the
  mechanism is WRONG. The medium effect would remain real but unexplained, and
  the curated-vs-mechanical story must be struck from the writeup.

  An equally interesting failure: if git's swing FALLS, then mechanical bulk was
  what little rule-sensitivity git had, and the story inverts.

CLASSIFIER (deliberately conservative, path/message based -- no LLM, so it is
deterministic and auditable). A commit is MECHANICAL if any hold:
  - touches vendor/, node_modules/, third_party/, dist/, build/, .venv/
  - >60% of its files are lockfiles or generated (package-lock.json, go.sum,
    yarn.lock, *.pb.go, *_generated.*, *.min.js, poetry.lock, Cargo.lock)
  - message matches vendor|bump|regenerate|generated|mass rename|reformat|
    lint|prettier|gofmt|license header|copyright|initial commit|merge branch
  - >80% of files share one extension AND commit size > 50 (mass mechanical op)

Usage: python3 mechanism_test.py <repo> [--max-commits N] [--boot 30]
"""
import argparse, json, re, subprocess, sys, random
from collections import defaultdict

MECH_DIRS = re.compile(r"(^|/)(vendor|node_modules|third_party|3rdparty|dist|build|\.venv|venv|target/debug|target/release)/", re.I)
MECH_FILES = re.compile(r"(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|go\.sum|poetry\.lock|Cargo\.lock|Gemfile\.lock|composer\.lock|\.min\.js|\.min\.css|\.pb\.go|_generated\.|\.generated\.|\.snap)$", re.I)
MECH_MSG = re.compile(r"vendor|bump|regenerat|generated|mass renam|reformat|\blint\b|prettier|gofmt|rustfmt|license header|copyright|initial commit|merge branch|update dependenc|dependabot|npm audit", re.I)


def commits(repo, max_commits):
    """Return [(sha, message, [files])]."""
    out = subprocess.run(
        ["git", "-C", repo, "log", "--no-merges", "--name-only",
         "-n", str(max_commits), "--pretty=format:\x01%H\x1f%s"],
        capture_output=True, text=True, timeout=900).stdout
    res, sha, msg, files = [], None, "", []
    for line in out.split("\n"):
        if line.startswith("\x01"):
            if sha:
                res.append((sha, msg, files))
            parts = line[1:].split("\x1f", 1)
            sha = parts[0]
            msg = parts[1] if len(parts) > 1 else ""
            files = []
        elif line.strip():
            files.append(line.strip())
    if sha:
        res.append((sha, msg, files))
    return [c for c in res if c[2]]


def is_mechanical(msg, files):
    n = len(files)
    if n == 0:
        return False, "empty"
    if MECH_MSG.search(msg or ""):
        return True, "message"
    if sum(1 for f in files if MECH_DIRS.search(f)) > 0:
        return True, "vendor-dir"
    gen = sum(1 for f in files if MECH_FILES.search(f))
    if gen / n > 0.6:
        return True, "generated-files"
    if n > 50:
        exts = defaultdict(int)
        for f in files:
            exts["." + f.rsplit(".", 1)[-1] if "." in f else "noext"] += 1
        if max(exts.values()) / n > 0.8:
            return True, "monoextension-bulk"
    return False, "genuine"


def k_eff(containers, cap):
    edges = defaultdict(lambda: defaultdict(float))
    for members in containers:
        k = len(members)
        if not (2 <= k <= cap):
            continue
        w = 1.0 / (k - 1)
        for i in range(k):
            for j in range(i + 1, k):
                edges[members[i]][members[j]] += w
                edges[members[j]][members[i]] += w
    if not edges:
        return 0.0
    eff = []
    for nb in edges.values():
        ws = list(nb.values())
        s1, s2 = sum(ws), sum(x * x for x in ws)
        eff.append(s1 * s1 / s2 if s2 else 0.0)
    return sum(eff) / len(eff)


def swing(containers):
    a, b = k_eff(containers, 16), k_eff(containers, 128)
    return (b / a) if a > 0 else float("nan")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("repo")
    ap.add_argument("--max-commits", type=int, default=2500)
    ap.add_argument("--out", default=None)
    a = ap.parse_args()

    cs = commits(a.repo, a.max_commits)
    name = a.repo.rstrip("/").split("/")[-1]

    allc, genuine, mech = [], [], []
    reasons = defaultdict(int)
    BULK = 16   # "bulk" = larger than the lower cap, i.e. what the cap decides about
    mech_bulk = 0
    for sha, msg, files in cs:
        allc.append(files)
        m, why = is_mechanical(msg, files)
        if m:
            mech.append(files)
            reasons[why] += 1
            if len(files) > BULK:
                mech_bulk += 1
        else:
            genuine.append(files)

    bulk_all = sum(1 for f in allc if len(f) > BULK)
    s_all, s_gen = swing(allc), swing(genuine)
    print("REPO: " + name)
    print("  commits=%d  mechanical=%d (%.1f%%)  genuine=%d" %
          (len(allc), len(mech), 100.0 * len(mech) / len(allc), len(genuine)))
    print("  bulk commits (>%d files): %d total, %d mechanical (%.1f%%)" %
          (BULK, bulk_all, mech_bulk, 100.0 * mech_bulk / bulk_all if bulk_all else 0))
    print("  classifier reasons: " + json.dumps(dict(reasons)))
    print("  swing 16->128   ALL = %.2fx    GENUINE-ONLY = %.2fx   delta = %+.2fx" %
          (s_all, s_gen, s_gen - s_all))
    res = {"repo": name, "commits": len(allc), "mechanical": len(mech),
           "mech_frac": len(mech) / len(allc), "bulk_all": bulk_all,
           "mech_bulk": mech_bulk, "swing_all": s_all, "swing_genuine": s_gen,
           "delta": s_gen - s_all, "reasons": dict(reasons)}
    if a.out:
        json.dump(res, open(a.out, "w"), indent=1)
    return res


if __name__ == "__main__":
    main()
