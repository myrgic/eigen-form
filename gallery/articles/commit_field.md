---
sim: commit_field
title: Commit Field
subtitle: A pre-registered, causal backtest of whether "repository heat" predicts the next commit. Result is null — recency already carries the signal.
papers: [rutherford1903, chung1997, voorhees1999]
---
## The idea

Designs for agent boards inspired by slime moulds share an assumption: a repository has a "heat field" that shows where work is heading, and heat that spreads along the links between files shows it better than heat that stays put. The README states the gap plainly: "Nobody checks. This app checks." (`apps/commit_field/README.md`).

The method is a causal replay. The app walks a real commit log from oldest to newest. Before it applies each commit, it asks three models to rank every file seen so far. It then scores how highly each model ranked the files that commit actually touched. No model sees a commit before it is scored on it, and the co-change graph used at time $t$ is built only from earlier commits. The three models:

- **frequency**: how often each file has been touched;
- **recency**: each touch adds heat, and heat decays exponentially;
- **field**: recency plus one hop of diffusion over the co-change graph.

The experiment was pre-registered. The pre-registered expectation held, and the headline is a null result: diffusion added a parameter and no predictive power.

## The sources

### Rutherford & Soddy (1903), the exponential law

E. Rutherford and F. Soddy, "Radioactive Change," *Philosophical Magazine* (6) 5, 576–591. §4, "The Law of Radioactive Change," reports that for every separated product "the activity under all conditions investigated falls off in a geometrical progression with the time" (p. 580). It then derives, from one ray per changing system (p. 581):

$$
\frac{N_t}{N_0}=e^{-\lambda t},\qquad \frac{dN}{dt}=-\lambda N_t ,
$$

The authors read this as "the proportional amount of radioactive matter that changes in unit time is a constant", with $\lambda$ called "the 'radioactive constant'" (p. 581). The paper reports half-lives as measurements: thorium emanation "falls to half-value in one minute" (p. 578). In the parts we read it does not state the relation $t_{1/2}=\ln 2/\lambda$ that appears in the registry. That relation follows directly from the law. We read the full text.

### Chung (1997), graph diffusion

F. R. K. Chung, *Spectral Graph Theory*, CBMS 92, AMS. The registry cites **Chapter 10**, on the heat kernel. **We did not have Chapter 10.** We read Chapter 1 only. It defines the normalised Laplacian $\mathcal L=I-T^{-1/2}AT^{-1/2}$ (§1.2, p. 3) and the random-walk transition matrix $P=T^{-1}A$ (§1.5, p. 15). The registry's graph heat flow

$$
\frac{d\mathbf h}{dt}=-(I-D^{-1}A)\,\mathbf h
$$

is the standard continuous-time diffusion built on $P$. The field model in this app corresponds to a single weighted averaging step with $P$, described below.

### Voorhees (1999), mean reciprocal rank

E. M. Voorhees, "The TREC-8 Question Answering Track Report," in *The Eighth Text REtrieval Conference (TREC-8)*, NIST Special Publication 500-246, pp. 77–82. The report defines the track's score (p. 77, first page of the PDF):

> "An individual question received a score equal to the reciprocal of the rank at which the first correct response was returned, or 0 if none of the five responses contained a correct answer. The score for a submission was then the mean of the individual questions' reciprocal ranks."

$$
\mathrm{MRR}=\frac1{|Q|}\sum_{q\in Q}\frac{1}{\mathrm{rank}_q}\quad(\text{0 if no correct answer in the top 5}).
$$

The report notes that the measure "is bounded between 0 and 1, inclusive, and averages well", and that a per-question score "can take on only six values (0, .2, .25, .33, .5, 1)" (pp. 77–78). We read the full text (an OCR of the NIST scan).

**Citation correction.** The registry cites a different paper: Voorhees & Tice, "The TREC-8 Question Answering Track Evaluation," DOI 10.6028/nist.sp.500-246.qa-overview. According to Crossref, that DOI resolves to `trec.nist.gov/pubs/trec8/papers/qa8.pdf`. That is the companion paper on how the evaluation was carried out (proceedings p. 83). The report cited here refers to it by name (p. 77). The report itself (`qa_report.pdf`, proceedings p. 77) **has no Crossref DOI**. We found no match among the 809 NIST records in prefix 10.6028 dated 1999–2000, or in title and author searches. It is cited here by its NIST SP number and URL.

## What the code does

All line numbers refer to `apps/commit_field/index.html` at `d183990`. The engine is a JavaScript port of `tools/extract.py`. It is kept separate on purpose: "a shared implementation could only ever agree with itself" (`index.html:218-224`).

- **Exponential decay** (`index.html:228-239`, fidelity *exact*). Here $\lambda=\ln 2/(14\cdot 86400)$ per second, and a file's heat is $h\,e^{-\lambda\,\Delta t}$. Each touch adds 1 to the decayed heat (`index.html:283`). This is the Rutherford–Soddy law applied to a sum of deposits.
- **One-hop field** (`index.html:263-278`, *modified*). For each file $i$ with co-change neighbours,
  $$
  s_i = r_i + \alpha\,\frac{\sum_j w_{ij}\,r_j}{\sum_j w_{ij}},\qquad \alpha=0.35 ,
  $$
  where $r$ is the recency score. The code applies this correction once and does not iterate it; the term is one row of $P\mathbf r$ on the weighted co-change graph. Edge weights are $1/(k-1)$ for each pair in a $k$-file commit, and only commits with at most 16 files contribute edges (`index.html:288-299`; cogdoc `index.html:64-71`).
- **Reciprocal rank** (`index.html:333-345`, *modified*). Each touched file $i$ is ranked against every file seen so far, as $\text{rank}=\#\{s_j>s_i\}+\tfrac12\#\{\text{ties}\}+1$. Every touched file counts as one query.
- **Random baseline.** The expected reciprocal rank of a uniformly random ranking over $N$ candidates is $H_N/N$, computed analytically (`index.html:303-306`, `358`).

## Where it departs from the source

- **MRR is not truncated.** Voorhees scores 0 unless a correct answer appears in the top five (p. 77). Here the rank runs over the whole candidate set, which averages 1,265 files (`data/results.json`, `mean_candidates`). A file at rank 400 still earns 1/400.
- **Every relevant file is its own query.** Voorhees takes the rank of the *first* correct response per question. Here each touched file is scored separately (registry deviation). There are 1,902 such queries from 627 scored commits (`results.json`).
- **Ties get a fractional mid-rank** (`index.html:340`; registry deviation). The TREC ranks are integers.
- **Unseen files are excluded, not counted as misses.** 33.1% of touched files had never been seen when their commit was scored, and they are left out (`index.html:320-322`; `unseen_fraction` 0.3308). Counting them as misses would lower every model's MRR by roughly a third, but would not change their order.
- **The random baseline is weighted differently.** It is averaged over the 627 commits, while the models are averaged over 1,902 file queries (`index.html:325`, `358-360`). Commits that touch many files weigh more in the model averages than in the baseline.
- **Graph diffusion is a single averaging step, not a flow** (`index.html:263-278`; registry deviation). The limitations say so: "One-hop diffusion only. A multi-hop or Laplacian formulation might behave differently; not tested, so not claimed either way" (`index.html:92`).

## What it shows, and what it doesn't

**The pre-registration** (`index.html:33-39`), as recorded:

- registered: 2026-08-21
- "recency MRR > frequency MRR"
- "field MRR - recency MRR <= 0.02 (field does not meaningfully beat recency)"
- "all three models MRR > 10x random MRR"
- locked parameters: `half_life_days` = 14, `alpha` = 0.35, `bulk_commit_threshold` = 32

**The result** on `myrgic/cogos` (734 commits, 1,807 files, repository head `6a8ad38`) is pinned in `data/results.json`:

| model | MRR | hit@10 | hit@50 |
|---|---|---|---|
| random (analytic) | 0.0075 | 0.0106 | 0.0529 |
| frequency | 0.0758 | 0.1656 | 0.3396 |
| recency | **0.1029** | 0.2014 | 0.4075 |
| field | 0.1024 | 0.2003 | 0.4180 |

All three pre-registered statements hold. Field minus recency is $-0.0005$ MRR. Recency beats frequency by 0.027. The weakest model, frequency, beats random by about 10×. The page's finding reads: "field (0.1024 MRR) does not beat recency (0.1029 MRR): diffusion adds a parameter and no predictive power on this corpus" (`index.html:86`). The page reruns the backtest in the browser and compares it with the pinned numbers at a tolerance of $10^{-5}$. The tolerance is justified in the code as two orders of magnitude above a 1-ULP difference between V8's and CPython's `exp` (`index.html:421-440`). The verdict badge reports that reconciliation. It is not a self-report.

**What the evidence supports.** The claim is narrow and properly hedged: "on this corpus", with one-hop diffusion, at locked parameters. A causal replay design, locked parameters, an analytic baseline and an independent reimplementation make this sounder than most lab demos. A null result that was reported and not tuned away is the most valuable thing on the page.

**Caveats:**

- **The main test is lenient.** Prereg 2 would have held even if field had beaten recency by up to 0.02 MRR, about 19% of recency's score. It rules out a large advantage for diffusion. It cannot tell "no effect" apart from a small positive one.
- **The comparison has no uncertainty estimate.** There is no confidence interval or paired test on the −0.0005 gap. The 1,902 queries come from 627 commits and are not independent. By hit@50, field is slightly *ahead* (0.418 against 0.407). "No predictive power" is accurate for MRR at these settings. It is not a finding that diffusion is useless under every metric.
- **The timing of the pre-registration can't be checked from git.** The prereg date matches the first commit containing the page and its results (`a70dbdd`, 2026-08-21). That the expectation "was written before the first run" (`index.html:31-32`) is the authors' statement. The repository history cannot confirm it independently.
- **It uses one corpus**, which the page itself lists as a limitation (`index.html:91`). The extractor accepts `--repo`, so other corpora can be tested. This result does not cover them.
In summary, on this repository a cheap exponential memory holds all the locality signal that one hop of co-change diffusion was expected to add. On this corpus, diffusion did not beat that baseline.

## Further reading

- Rutherford & Soddy 1903: https://doi.org/10.1080/14786440309462960 (scan: https://archive.org/details/londonedinburgh651903lond)
- Chung 1997, *Spectral Graph Theory* (ISBN 0821803158). Chapter 1: https://mathweb.ucsd.edu/~fan/research/cb/ch1.pdf
- Voorhees 1999, TREC-8 QA Track Report, NIST SP 500-246 (no Crossref DOI): https://trec.nist.gov/pubs/trec8/papers/qa_report.pdf
- Companion paper: Voorhees & Tice 1999, "The TREC-8 Question Answering Track Evaluation": https://doi.org/10.6028/nist.sp.500-246.qa-overview
