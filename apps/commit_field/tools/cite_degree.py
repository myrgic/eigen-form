#!/usr/bin/env python3
"""
Measure <k> rule-dependence on a CITATION graph, using the same estimator and
weighting as apps/commit_field/tools/degree.py uses on a co-change graph.

Point: a reference list is structurally the same object as a commit -- a
variable-size container whose members are thereby declared adjacent. If <k> is
a property of the evidence rule rather than the medium, both should show the
same rule-dependence. They do (15-29x across four corpora).

Data: OpenAlex (no key required, be polite with a mailto UA).
Usage: python3 cite_degree.py "swarm intelligence"
"""
import subprocess, json, sys, time
from collections import defaultdict

UA = "cog-research/1.0 (mailto:chaz@myrgic.com)"


def oa(params):
    url = "https://api.openalex.org/works?" + params
    r = subprocess.run(["curl", "-sSL", "--max-time", "60", "-A", UA, url],
                       capture_output=True, text=True, timeout=75).stdout
    try:
        return json.loads(r)
    except Exception:
        return {}


def corpus(query, n=600):
    out, cur = [], "*"
    q = query.replace(" ", "%20")
    while len(out) < n:
        d = oa("filter=default.search:" + q + "&per-page=200&cursor=" + cur +
               "&select=id,display_name,referenced_works")
        if "results" not in d:
            break
        out += d["results"]
        cur = d.get("meta", {}).get("next_cursor")
        if not cur:
            break
        time.sleep(1)
    return [w for w in out if (w.get("referenced_works") or [])]


def degrees(W, cap, size_norm=True):
    edges = defaultdict(lambda: defaultdict(float))
    for w in W:
        r = w["referenced_works"]
        k = len(r)
        if not (2 <= k <= cap):
            continue
        wt = 1.0 / (k - 1) if size_norm else 1.0
        for i in range(len(r)):
            for j in range(i + 1, len(r)):
                edges[r[i]][r[j]] += wt
                edges[r[j]][r[i]] += wt
    eff, raw = [], []
    for nb in edges.values():
        ws = list(nb.values())
        s1, s2 = sum(ws), sum(x * x for x in ws)
        eff.append(s1 * s1 / s2 if s2 else 0.0)
        raw.append(len(nb))
    return (len(eff),
            sum(eff) / len(eff) if eff else 0.0,
            sum(raw) / len(raw) if raw else 0.0)


def main(query):
    W = corpus(query)
    if not W:
        print("no data for", query)
        return
    tot = sum(len(w["referenced_works"]) * (len(w["referenced_works"]) - 1) // 2 for w in W)
    print("corpus: " + query + "   papers-with-refs=" + str(len(W)) +
          "   total co-citation pairs=" + format(tot, ","))
    print()
    print("%6s %9s %9s %9s" % ("cap", "nodes", "k_eff", "k_raw"))
    vals = []
    for cap in (8, 16, 32, 64, 128, 10 ** 9):
        n, e, r = degrees(W, cap)
        vals.append((e, r))
        print("%6s %9d %9.2f %9.2f" % (cap if cap < 10 ** 8 else "none", n, e, r))
    ke = [v[0] for v in vals if v[0] > 0]
    kr = [v[1] for v in vals if v[1] > 0]
    print()
    print("k_eff swing %.2f -> %.2f = %.1fx" % (min(ke), max(ke), max(ke) / min(ke)))
    print("k_raw swing %.2f -> %.2f = %.1fx" % (min(kr), max(kr), max(kr) / min(kr)))
    print()
    print("biggest pair-generators (the 'refactor commits' of a literature):")
    big = sorted(W, key=lambda w: -len(w["referenced_works"]))[:5]
    for w in big:
        k = len(w["referenced_works"])
        print("   %4d refs | %8s pairs | %s" % (k, format(k * (k - 1) // 2, ","), w["display_name"][:70]))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "stigmergy")
