---
sim: welded_fields
title: Welded Fields: closing the loop, and measuring it honestly
subtitle: Jones agents on a true torus, a momentum field the agents write themselves, and a Betti-number readout pinned to coverage
papers: [jones2010, crank1975, massey1977, gray1971, hatcher2002, hyndman1996]
---
## The idea

`welded_fields` takes the physarum model and adds two things. The first is a second medium: a coarse vector field into which every agent writes its own heading, and which then carries and turns the agents. When the exogenous noise gain is zero, nothing outside the simulation drives anything. Every flow on screen was written by the agents. The second addition is an instrument. Every 20 frames the trail is thresholded into a binary mask, and the page reports its number of components, $b_0$, and its number of holes, $b_1$. The threshold is chosen so that a fixed fraction of cells lies inside the mask.

The file is `apps/welded_fields/index.html`, 939 lines at commit `d183990`. It draws on three bodies of work: Jones's agent rule, the heat equation, and a standard route from pixel counts to Betti numbers. It adds one piece of robust statistics.

## The sources

### Jones (2010), *Characteristics of Pattern Formation and Evolution in Approximations of Physarum Transport Networks*

*Artificial Life* 16(2), 127–153. doi:10.1162/artl.2010.16.2.16202. This is the source of the three-sensor rule (Figure 3, p. 133): keep heading if F beats both flanks, turn randomly by RA if both flanks beat F, otherwise turn toward the larger flank, "Else — Continue facing same direction". The trail diffuses by a 3×3 mean filter with decay (p. 132), and Table 1 (p. 134) makes both diffusion and agent boundaries **periodic**. Jones's defaults are SA 22.5° or 45°, RA 45°, SO 9. We read the full text.

### Crank, *The Mathematics of Diffusion* (1975)

ISBN 0198533446. The standard equation for diffusion with first-order loss is

$$
\partial_t u = D\nabla^2 u - k u .
$$

We did not have the full text. The equation is cited as standard.

### Massey, *Algebraic Topology: An Introduction* (1977)

ISBN 0387902716. The standard construction of the torus is $(x,y)\sim(x+W,y)\sim(x,y+H)$ on a rectangle. We did not have the full text.

### Gray (1971), *Local Properties of Binary Images in Two Dimensions*

*IEEE Transactions on Computers* C-20(5), 551–561 (Crossref). doi:10.1109/t-c.1971.223289. The lab's registry attributes the "bit-quad" formula to this paper. Slide a 2×2 window over the zero-padded image and count the windows with exactly one set pixel ($Q_1$), with three ($Q_3$), and with two diagonal set pixels ($Q_D$). The standard statement for 8-connected foreground is then

$$
\chi_8 = \tfrac14\big(n(Q_1) - n(Q_3) - 2\,n(Q_D)\big).
$$

We did not have the full text. The formula is quoted as it is commonly stated and as recorded in the registry, not from Gray's own pages.

### Hatcher (2002), *Algebraic Topology*

Cambridge University Press (author's free edition). For a finite CW complex, the Euler characteristic is "the alternating sum $\sum_n (-1)^n c_n$ where $c_n$ is the number of $n$ cells" (§2.2, p. 146), and Theorem 2.44 (p. 146) shows that it depends only on homology:

$$
\chi(X) = \sum_n (-1)^n \operatorname{rank} H_n(X).
$$

The ranks are the Betti numbers (§2.1, p. 130). For a 2-D complex embedded in the plane, $b_2 = 0$, so $b_1 = b_0 - \chi$. We read the full text.

### Hyndman & Fan (1996), *Sample Quantiles in Statistical Packages*

*The American Statistician* 50(4), 361–365. doi:10.1080/00031305.1996.10473566. The population quantile is $Q(p) = F^{-1}(p) = \inf\{x : F(x) \ge p\}$ (p. 361). The paper then catalogues nine sample versions. Definition 1, "the oldest and most studied", is "the inverse of the empirical distribution function" (p. 362). We read the full text, which is a scan; we used an OCR transcript checked against the page image.

## What the code does

All line numbers refer to `apps/welded_fields/index.html` at commit `d183990`.

- **Trail diffusion and decay** (L605–631), fidelity: *modified*. A separable 1×3 then 3×1 box mean, with explicit wrap at every edge (L609–610, L616), followed by multiplication by `dec`. The kernel is identical to physarum's 3×3 mean, but the domain is now periodic. The comment at L601–604 says so and names the ancestor's disagreement. With the hormone on, the decay varies per cell: $d(1+h_{dc}(h-1))$, clamped to $[0.5, 0.9995]$ (L626–627). The loss rate $k$ is then a field that the agents release, not a constant.
- **Torus** (L605–616 for the field, L635/L655–656/L676–680 for the agents), fidelity: *exact*. Agent positions wrap with heading preserved, and the sensors read through the wrap.
- **Sensor rule** (L659–665), fidelity: *modified*. It matches Jones branch for branch, except for the final `else`, which is discussed below. The defaults are SA 60°, RA 18°, SO 5 (L445). The comment at L442–444 says these are "the operator's measured settings, not canonical Jones".
- **Momentum field.** Each agent adds its unit heading $(\cos a, \sin a)$ to a grid 8× coarser than the trail (L686–688). The field diffuses on a torus and decays by `mdec` (L520–539). Agents read it bilinearly (L574–584), scaled by `mass / momRef`, where `momRef` is a running mean magnitude with a 0.05 relaxation (L543, L595). The field acts on an agent in two separate ways. *Alignment* rotates the heading toward the flow (L675). *Advection* displaces the position without turning it (L676–677).
- **Measurement.** `refs()` (L868–884) histograms the trail into 1024 bins over $[0, \max]$ and scans down from the top. `ref` is the bin midpoint at which 0.5% of cells lie above it, and `cut` is the midpoint at which a fraction `thr` lies above it. `measure()` (L726–735) sets the mask to $u > \text{cut}$ and computes $b_0$ by 8-connected flood fill (L707–725). It computes $\chi$ by bit-quads on the zero-padded mask (L695–705), and $b_1 = b_0 - \chi$ (L729). Gray's formula and the $b_1$ identity are *exact* for the pixel complex. The quantile is an *approximation*.

## Where it departs from the source

- **Tie-break.** When $L = R$ and F does not strictly win, Jones continues straight. The code turns by $\pm RA$ at random (L665).
- **No exclusion and no conditional deposit.** Every agent moves and deposits `dep` every frame, with no occupancy check (L676–682). Jones blocks occupied sites and deposits only after a successful move (p. 133).
- **The readout is not on the torus.** The simulation lives on a torus, but `euler()` zero-pads outside the square (L697) and `components()` does not wrap (L718). Topologically, the mask is measured as a planar pixel complex. We fed the code synthetic masks to check the consequences. A band spanning the full width, which on the torus is a loop around a generator, reads $b_1 = 0$. An annulus cut in two by the seam reads $b_0 = 2$, $b_1 = 0$ where the torus has one ring. The cogdoc's limitation (L207–209) says the count ignores feature scale, but it does not mention this.
- **Quantile resolution.** The histogram quantile returns a bin midpoint with resolution $\max/1023$ (L872, L880–881), not an order statistic in the Hyndman–Fan sense. Because the bins span $[0, \max]$ and the maximum is a spike, most of the resolution is spent on empty range. In our headless run the realised coverage was 7.72–8.24% against a target of 8%. The cogdoc's "exactly this fraction" (L150) is therefore approximate.
- **Mislabels.** The "curl-noise" (L98) is smoothed value noise used as an angle (L388–401, L592). `mass` is described as the deposit strength (L80–84), but the deposit is always a unit vector (L688); `mass` scales the read (L595).

## What it shows, and what it doesn't

The claim (L27–34) has three parts.

*"The loop closes."* This is architecturally true and checkable. With `ng = 0`, `fieldAt` has no exogenous term (L592), and the only vector field is the one the agents wrote (L594–595). The claim that the governing quantity then "becomes an internal ratio of timescales", momentum half-life over trail half-life, is displayed (L908) but not tested. Nothing in the file sweeps `mdec` and `dec` jointly to show that runs with equal ratios behave alike. It is a hypothesis with a readout, not a result.

*"Normalization robust to single-cell deposit spikes."* This holds up. In a headless run (seed 7, default parameters, 2000 frames) the trail maximum was about 474 times the mean, against the "roughly two orders" in the finding (L176–180). The 99.5th percentile sat 15 times below the maximum.

*"Fix coverage, not level."* We ran the same seed with `dep` = 25 and `dep` = 50. $b_0$, $b_1$ and coverage matched at every checkpoint, while `ref` doubled. This confirms the invariance, but it is worth being precise about why it holds. With the hormone off, the trail update is linear in `dep`, and the sensor rule compares only ratios of trail values. The momentum field never reads the trail. So doubling `dep` doubles the whole field and leaves every trajectory unchanged. Any threshold defined relative to the field would pass this test, including a fixed fraction of the 99.5th percentile. What coverage-fixing adds beyond that is invariance to changes that alter the *shape* of the value distribution. The file asserts this but does not test it.

The larger caveat is the one above. This $b_1$ is the first Betti number of a flat picture of a torus. It cannot see loops that wrap the torus, and it splits rings that straddle a seam. That is defensible for a comparative statistic, but it is not the topology of the surface the agents inhabit. `welded_asteroids` inherits exactly this measurement.

## Further reading

- Jones (2010): https://doi.org/10.1162/artl.2010.16.2.16202 — open copy: https://core.ac.uk/download/323898340.pdf
- Gray (1971): https://doi.org/10.1109/t-c.1971.223289 (not held)
- Hyndman & Fan (1996): https://doi.org/10.1080/00031305.1996.10473566 — author copy: https://robjhyndman.com/papers/sample_quantiles.pdf
- Hatcher (2002), *Algebraic Topology*, ISBN 0521795400 — free edition: https://pi.math.cornell.edu/~hatcher/AT/AT.pdf
- Crank, *The Mathematics of Diffusion*, ISBN 0198533446; Massey, *Algebraic Topology: An Introduction*, ISBN 0387902716 (neither held).
