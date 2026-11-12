---
sim: boid_vector_field
title: Boids without alignment, steered by a noise field
subtitle: Two of Reynolds' three rules, plus an external current they cannot change
papers: [reynolds1987, ebert2002]
---
## The idea

Hundreds of small triangles drift across a faint field of arrows. They move in groups, and the groups bend and turn together. It looks like flocking. The code shows that one ingredient of flocking is missing. There is no velocity-matching rule, so no boid ever reads another boid's heading. Whatever heading coherence you see must come from somewhere else. The obvious candidate is the field of arrows, a smooth procedural noise field that the boids feel but cannot change. The registry classifies this simulation as `coupling: exogenous`: the medium is fixed from outside, so there is no feedback loop through it.

## The sources

### Reynolds (1987), *Flocks, herds and schools: A distributed behavioral model*

Reynolds, C. W. (1987). *ACM SIGGRAPH Computer Graphics* 21(4), 25–34. doi:10.1145/37402.37406.

Reynolds builds a flock from three local rules, "in order of decreasing precedence": "1. Collision Avoidance… 2. Velocity Matching: attempt to match velocity with nearby flockmates 3. Flock Centering: attempt to stay close to nearby flockmates". The quote is from p. 6 of the author's OCR reprint. He is explicit about what the middle rule does: "Static collision avoidance and dynamic velocity matching are complementary… Static collision avoidance serves to establish the minimum required separation distance; velocity matching tends to maintain it" (p. 6). Flock centering pulls each boid toward "the centroid of the nearby boids" (p. 6).

The registry states the rules in their standard modern form. The equation below is that form, not a formula from the paper, which contains no equations.

$$\mathbf{a}_i=w_s\sum_{j\in N_i}\frac{\mathbf{x}_i-\mathbf{x}_j}{|\mathbf{x}_i-\mathbf{x}_j|}+w_a(\bar{\mathbf{v}}_{N_i}-\mathbf{v}_i)+w_c(\bar{\mathbf{x}}_{N_i}-\mathbf{x}_i)$$

Reynolds did consider steering by an environmental field. In "Avoiding Environmental Obstacles" (p. 9) he describes a model that "postulates a field of repulsion force emanating from the obstacle out into space". He reports that it "works in undemanding situations but has some shortcomings", and he prefers a vision-like alternative he calls "steer-to-avoid". In his flocks, the field is a local obstacle, not a current covering the whole domain.

*Full text read (author's OCR reprint).*

### Ebert, Musgrave, Peachey, Perlin & Worley (2002), *Texturing & Modeling: A Procedural Approach*, 3rd ed.

Morgan Kaufmann, ISBN 1558608486.

The registry cites this book for lattice value noise, and states it as:

$$n(\mathbf{p})=\sum_{\mathbf{c}\in\{0,1\}^3}h(\lfloor\mathbf{p}\rfloor+\mathbf{c})\prod_k s_k^{c_k}(1-s_k)^{1-c_k},\qquad s_k=f_k^2(3-2f_k)$$

In the standard construction, a pseudo-random value $h$ sits at each integer lattice point. The noise at any other point blends the eight surrounding corner values. Each axis is weighted by the smoothstep $3f^2-2f^3$, which makes the first derivative continuous across cell boundaries. Value noise differs from Perlin's gradient noise, where the lattice holds random gradients rather than random values.

*Full text not available to us. The book is covered here from the registry entry and standard knowledge only. We do not claim anything about the content of any particular chapter.*

## What the code does

All line numbers refer to `apps/boid_vector_field/index.html` at commit d183990. This file is identical on the current main (a45a44e). The page has no embedded cogdoc, and the registry records `claim: null`. The only statement of intent is the sidebar text: "Agents (boids) navigate a dynamic underlying flow field generated via continuous noise. They experience advection (being pushed) and rheotaxis (sensing flow)" (line 23).

**The field (lines 56–78 and 116–120). Fidelity: modified.** `PseudoNoise.get` evaluates the registry formula exactly:

- It takes the eight corner hashes (lines 68–71).
- It computes smoothstep weights (line 66).
- It interpolates trilinearly (lines 73–75).
- It maps the result from $[0,1]$ to $[-1,1]$ (line 76).

The hash is $h=\operatorname{fract}(43758.5453\,\sin(12.9898x+78.233y+37.719z+\text{seed}))$ (lines 58–60). The field value becomes a heading, $\theta=2\pi\,n(0.005x,\,0.005y,\,t)$, and the field vector is the unit vector $(\cos\theta,\sin\theta)$ (lines 116–120). Time enters as the third noise coordinate and advances by 0.005 per frame (line 123). With the default scale, one lattice cell spans 200 px, and the field decorrelates in time over roughly 200 frames.

**The steering (lines 147–175). Fidelity: modified.** Each boid gathers neighbours within 50 px (line 156). It computes two things:

- **Cohesion:** a vector toward the neighbours' centroid (line 167).
- **Separation:** a sum of unit vectors pointing away from every neighbour closer than 20 px (lines 159–161).

It then samples the field at its own position (line 171). With $g=0.1$ (`maxForce`, line 144), the update is

$$\mathbf{v}\leftarrow\mathbf{v}+g\big(w_c(\bar{\mathbf{x}}_{N}-\mathbf{x})+w_s\,\mathbf{s}+F\,\hat{\mathbf{e}}(\theta(\mathbf{x},t))\big),\qquad|\mathbf{v}|\le3,$$

using the default weights $w_c=0.5$, $w_s=1.5$, $F=1$ (line 84). The speed clamp is at lines 178–181, and $\mathbf{x}\leftarrow\mathbf{x}+\mathbf{v}$ at line 183. Only the variables `steerC` and `steerS` are declared (lines 147–148). Nothing sums the neighbours' velocities.

## Where it departs from the source

- **There is no alignment rule.** Lines 147–168 compute cohesion and separation only. Reynolds' second rule, velocity matching, is absent. The only term in the update that depends on a heading is the external field at lines 171–175. No boid ever reads another boid's velocity.
- **The field is not advection.** The page calls the field "advection (being pushed)" (line 23; comment at line 170). The code adds it as a steering acceleration (lines 174–175), and the speed clamp then limits it. True advection would add the flow velocity to the boid's displacement, independent of the boid's own velocity. The code does not do this.
- **The field is not rheotaxis.** Rheotaxis means orienting relative to the current, usually heading into it. Here every boid simply accelerates along the field direction.
- **The rules are summed, not prioritised.** The terms are added with fixed weights (lines 174–175). Reynolds (p. 7) instead describes allocating a limited acceleration budget in priority order, collision avoidance first. `maxForce` here is a gain, not a cap.
- **Neighbour weighting is uniform.** Every neighbour inside the hard 50 px disc counts equally, and separation uses plain unit vectors. Reynolds reports weighting by the inverse square of distance (p. 8).
- **The hash is not a permutation table.** The registry notes that the hash is the `fract(sin(·)·43758.5453)` construction (line 59). The seed comes from `Math.random()` (line 57), so no run can be reproduced.
- **Wrapping snaps boids to the edge.** A boid that leaves the canvas is placed exactly on the opposite edge, for example `x = width` (lines 186–187), rather than shifted by the canvas width. Neighbour distances also ignore the wrap seam (line 154).
- **A latent NaN bug.** Separation divides by $d$ (line 160) without guarding against $d=0$. Because wrapping snaps coordinates to exact edge values, two boids can land on the same point, typically a corner. We ported the code headlessly with a seeded generator on a 1200×800 canvas. In one seed out of three, two boids met exactly at (1200, 800) at frame 1384. On the next frame one boid's position became NaN. Every later distance comparison with it is false, so that boid silently disappears from the flock.

## What it shows, and what it doesn't

The page makes no measured claim, so our questions are about what the picture seems to show. The first is whether the field is solely responsible for heading coherence, as the first version of the registry's deviation note ("velocity matching comes solely from the exogenous noise field") claimed. That note has since been corrected, on the strength of the measurements below and a re-run on the live page.

Our headless port ran lines 56–187 unchanged, with a seeded generator, 150 boids and 3000 frames; we measured after frame 1000. We report two polarisation measures:

- **Global polarisation:** the length of the mean unit heading, where 1 means all boids point the same way.
- **Local polarisation:** the same quantity within each boid's 50 px neighbourhood.

Results over two independent sets of three seeds:

| flow $F$ | cohesion / separation | local pol. | global pol. |
|---|---|---|---|
| 1 | 0.5 / 1.5 | 0.87–0.88 | 0.54 |
| 0 | 0.5 / 1.5 | 0.84–0.86 | 0.48–0.49 |
| 1 | 0 / 0 | 0.80–0.83 | 0.27–0.28 |
| 0 | 0 / 0 | 0.49–0.50 | 0.08–0.09 |

(One seed in the $F=1$ default row hit the NaN bug above. Its global polarisation is excluded from that row.)

The noise field clearly imposes coherence. With no interaction rules at all, the field alone raises local polarisation from about 0.5 to about 0.8. It does this without any communication: a noise cell is 200 px across, four times the neighbourhood radius, so nearby boids sample nearly the same field vector and turn together.

The field is not the only source, though. Remove the field and keep cohesion plus separation, and headings still align strongly (local about 0.85, global about 0.48). There is a plausible mechanism: cohesion pulls a cluster together, separation spreads it into a lattice, and the speed clamp damps relative motion, so the cluster ends up moving as one body. We have not isolated this mechanism with a separate experiment.

The accurate summary is this. The page has no alignment rule. Its heading coherence comes partly from an exogenous field and partly from cohesion under a speed limit. None of it comes from boids matching velocities.

That matters for what the page can be used to argue. It illustrates how a shared external driver can produce the look of collective motion, a known confound in the study of real animal groups. It cannot demonstrate emergent alignment, because the mechanism Reynolds used for alignment is not in the code.

Our port and its output logs are in `.cog/mem/working/2026-09-23-gallery/repro/boids.js`.

## Further reading

- Reynolds 1987: https://doi.org/10.1145/37402.37406. Author's reprint: https://web.archive.org/web/2022id_/https://www.red3d.com/cwr/papers/1987/SIGGRAPH87.pdf
- Ebert et al., *Texturing & Modeling: A Procedural Approach*, 3rd ed. (2002), ISBN 1558608486 (no DOI; not held)
