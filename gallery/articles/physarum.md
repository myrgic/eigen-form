---
sim: physarum
title: Physarum, and the torus that isn't
subtitle: Jones's sense–rotate–move–deposit agents on a decaying trail, faithful in the rule and unfaithful at the edges
papers: [jones2010, crank1975, massey1977]
---
## The idea

Eight thousand point agents move across a grid of numbers. Each one reads the grid at three points ahead of it, turns toward the largest reading, takes a step, and adds to the grid where it lands. Between steps the grid blurs and fades. No agent ever reads another agent, yet the population draws networks, rings and contracting loops.

This is the model Jeff Jones published in 2010 as an approximation of the transport networks of the slime mould *Physarum polycephalum*. The lab's version is the ancestor of every trail simulation in this gallery. It is a short file, `apps/physarum/index.html`, about 270 lines at commit `d183990`. The steering rule is Jones's almost verbatim. The boundary is not: the page gets the domain wrong, and so did our own registry until this review.

## The sources

### Jones (2010), *Characteristics of Pattern Formation and Evolution in Approximations of Physarum Transport Networks*

Jones, J. (2010). *Artificial Life* 16(2), 127–153. doi:10.1162/artl.2010.16.2.16202.

Jones sets up a "semi-continuous" framework. Each agent occupies a grid cell but keeps a floating-point position and heading. A trail map holds the chemoattractant, and after every system step it is "subjected to a simple diffusion operator … a pseudo-parallel simple mean filter in a 3 × 3 kernel that is subject to an adjustable decay value to affect chemoattractant persistence" (p. 132). Each agent has three forward sensors, F, FL and FR, at sensor offset SO and angles $0$ and $\pm SA$ (Figure 3, p. 133). The sensory stage in Figure 3 reads, in full:

$$
\theta \leftarrow \theta + \begin{cases} 0 & F>FL \text{ and } F>FR \\ \pm RA \ \text{(random)} & F<FL \text{ and } F<FR \\ +RA & FL<FR \\ -RA & FR<FL \\ 0 & \text{otherwise} \end{cases}
$$

Here $+RA$ means "rotate right" in Jones's wording. In the motor stage an agent attempts one step forward, $\mathbf{x} \leftarrow \mathbf{x} + s\,\hat{\mathbf e}(\theta)$. "If the movement is successful (i.e., if the next site is not occupied) the agent moves to the new site and deposits a constant chemoattractant value. If the movement is not successful, the agent remains in its current position, no chemoattractant is deposited, and a new orientation is randomly selected" (p. 133). Agents are visited in random order. Table 1 (p. 134) gives the defaults: SA of 22.5° or 45°, RA 45°, SO 9 pixels, step 1, depT 5, decayT 0.1, a 3×3 diffusion kernel, and **Boundary: Periodic** for both the diffusion and the agents. Jones names SA, RA and SO, together with population density and decay, as the parameters that most affect the pattern (p. 134).

We read the full text (CC-BY repository copy).

### Crank, *The Mathematics of Diffusion* (heat equation with first-order loss)

Crank, J. (1975). *The Mathematics of Diffusion*, 2nd ed. Oxford: Clarendon Press. ISBN 0198533446.

The standard statement of diffusion with linear decay is

$$
\partial_t u = D\nabla^2 u - k u .
$$

Jones's mean-filter-plus-decay is a discrete stand-in for this equation. We did not have the full text, and we cite the book only for the standard equation, not for any particular section.

### Massey, *Algebraic Topology: An Introduction* (the torus as an identified square)

Massey, W. S. (1977). Graduate Texts in Mathematics 56. Springer. ISBN 0387902716.

The standard construction of the flat torus identifies opposite sides of a rectangle, $(x,y)\sim(x+W,y)\sim(x,y+H)$. This is what Jones's "periodic" boundary means. An agent leaving through the right edge re-enters through the left **with its heading unchanged**, and the trail diffuses across the seam as though it were not there. We did not have the full text of Massey. The construction is textbook-standard.

## What the code does

All line numbers refer to `apps/physarum/index.html` at commit `d183990`.

- **Diffusion and decay** (L190–202), fidelity: *modified*. For each cell the code sums the in-grid cells of its 3×3 neighbourhood and writes $(\text{sum}/9)\cdot d$, with $d = 0.99$ by default (L144, slider range 0.8–0.999). In the interior this is one explicit step of the heat equation. The per-axis kernel variance is $2/3$, so $D \approx 1/3$ cell²/frame, followed by a multiplicative loss with $k = -\ln d$ per frame. That gives a trail half-life of about 69 frames at the default, as the embedded cogdoc says (L46–47).
- **Sensing** (L214–226), fidelity: *exact* for the interior. The three samples are taken at distance `sensorDist = 9` (the same as Jones's SO) and angles $0, \mp SA$. The code's defaults are SA = RA = 45° (L144), inside Jones's range.
- **Motor rule** (L229–238), fidelity: *exact*. The branch order matches Figure 3, including the final "otherwise, keep heading" when $L = R$ and F is not strictly dominant. The code's "left" is $-SA$ and it turns by $-RA$ toward it, the mirror of Jones's labelling with identical behaviour.
- **Move and deposit** (L241–252), fidelity: *modified*. Every agent always moves. The deposit is `grid[idx] = Math.min(255, grid[idx] + 25)`.
- **Boundary** (L244–248), fidelity: *modified* — see below.

## Where it departs from the source

- **The field is not periodic. Its edges absorb.** The blur's bounds check (L197) drops out-of-grid neighbours but keeps the divisor at 9 (L202). A cell on an edge averages over six real neighbours and three zeros, so trail mass drains out through the boundary every frame. The sensors do the same: a sample that falls off the grid reads 0 (L218–221). Jones's Table 1 specifies periodic diffusion.
- **The agents are not on a torus either.** On crossing an edge the position wraps, and the heading gains $\pi$ (L245–248). The agent reappears on the opposite side travelling back toward the edge it just left. On the next step it wraps back again. We traced one such agent: it oscillates across the seam, alternating between $x \approx 399$ and $x \approx 0$, until a turn carries it away. A torus preserves heading, and a reflecting wall does not teleport. The combination is neither. The lab's simulation registry listed this app's domain as `torus` until 2026-09-23. It has since been corrected to `plane`, and the classification note there documents both defects.
- **Deposit saturates.** The clamp at 255 (L252) does not exist in Jones. Jones deposits a constant amount (depT = 5) only after a successful move.
- **No exclusion.** Jones allows one agent per cell and blocks moves into occupied sites, and a blocked agent picks a random new heading. Here any number of agents can share a cell, every move succeeds, and every agent deposits every frame (L241–252).
- **Update order.** Jones visits agents in random order in separate motor and sensory stages. The code updates each agent in array order, sensing, turning, moving and depositing in one pass (L212–253), so later agents see earlier agents' deposits from the same frame.
- **Spawn.** Agents start in a disc facing inward (L174–182), not scattered uniformly with random headings as in Jones (p. 132).

## What it shows, and what it doesn't

The embedded claim (L24–27) is that "deposit into a diffusing, decaying shared medium is sufficient for global structure to emerge among agents that never communicate directly … and read only three samples of the field per step." The code does support the architectural half of that claim. No line reads another agent's state. The only coupling is through `grid`. Each agent reads exactly three cells per frame. Structure does emerge. But "sufficient" is shown here by a demo, not by a measurement: the page has no observable, no test port and no statistic, only the rendered field.

The cogdoc's headline finding is that "saturation is reachable and destroys coordination". Its reasoning is that where cells pin at 255, $F = L = R$, so every branch of the motor rule is false and the field stops steering (L65–71). The code bears out half of this. To check the other half we ran the file headlessly: a 400×300 grid, one fixed seed, default sliders, 2000 frames. In that run about 99.7% of agents stood on a cell at the clamp. Yet only 0–0.3% saw three equal samples, and none of those were at the clamp after frame 500. The agents' own cells saturate, but their sensors nine cells ahead mostly do not, so steering continues. This comes from one seed, one grid size and our own harness, so it is not a characterisation. It does mean the cogdoc's "destroys coordination" is a hypothesis about a reachable regime, not something the page demonstrates at its defaults.

The boundary defects matter less visually than they do conceptually. In the same run no agent came within two cells of an edge in 3,000 frames, because the population contracts toward the centre of its spawn disc. The absorbing edges and the heading flip are latent at the defaults, and they shape results only when structure reaches the border. But the page presents itself as the canonical Jones model. On a periodic domain, loops that wrap the torus are legitimate structures. On this domain they are impossible. Anyone porting results from this page to Jones's setting, or the reverse, should know that the two domains differ.

The descendant `welded_fields` fixes all three of these problems: a periodic blur, a plain position wrap, and robust normalisation instead of a clamp. Its code comment "the original disagreed" refers to exactly this file.

## Further reading

- Jones (2010): https://doi.org/10.1162/artl.2010.16.2.16202 — open copy: https://core.ac.uk/download/323898340.pdf
- Crank, *The Mathematics of Diffusion*, 2nd ed., ISBN 0198533446 (no DOI; not held).
- Massey, *Algebraic Topology: An Introduction*, ISBN 0387902716 (no DOI; not held).
- Source at the cited commit: `git show d183990:apps/physarum/index.html` in myrgic/eigen-form.
