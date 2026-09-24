---
sim: boid_drafting
title: Boids in their own wake
subtitle: Reynolds' three steering rules, plus a decaying vector grid that each boid writes to and then reads back
papers: [reynolds1987, crank1975]
---
## The idea

The page's sidebar makes the pitch: boids "inject momentum to create wakes. The grid diffuses and dissipates this energy. Trailing boids seek these wakes to draft, forming echelon and V-formations naturally" (`apps/boid_drafting/index.html`, line 23, commit d183990). Two couplings run side by side. The first is direct: each boid steers by the positions and velocities of its neighbours, as in Reynolds' 1987 flocking model. The second goes through a medium: boids write their velocity into a coarse grid, and every boid, the writer included, is later pushed by what the grid holds. The lab's registry files this simulation as `coupling: hybrid` for exactly this reason.

Nobody has tested the V-formation sentence. This article sets out what the sources give, what the code computes, and what a headless run of it shows.

## The sources

### Reynolds (1987), *Flocks, herds and schools: A distributed behavioral model*

Reynolds, C. W. (1987). *ACM SIGGRAPH Computer Graphics* 21(4), 25–34. doi:10.1145/37402.37406.

Reynolds modelled a flock as many copies of one bird, each steering by what it perceives locally. Page references here are to the author's OCR reprint, which has no figures. In that reprint he states the core rules on p. 6: "Stated briefly as rules, and in order of decreasing precedence, the behaviors that lead to simulated flocking are: 1. Collision Avoidance: avoid collisions with nearby flockmates 2. Velocity Matching: attempt to match velocity with nearby flockmates 3. Flock Centering: attempt to stay close to nearby flockmates." He explains why he needs both of the first two rules (p. 6): "Static collision avoidance serves to establish the minimum required separation distance; velocity matching tends to maintain it."

The paper contains no equations. The lab's registry writes the rules in their now-standard form:

$$\mathbf{a}_i=w_s\sum_{j\in N_i}\frac{\mathbf{x}_i-\mathbf{x}_j}{|\mathbf{x}_i-\mathbf{x}_j|}+w_a(\bar{\mathbf{v}}_{N_i}-\mathbf{v}_i)+w_c(\bar{\mathbf{x}}_{N_i}-\mathbf{x}_i),\qquad N_i=\{j:|\mathbf{x}_j-\mathbf{x}_i|<r\}$$

That formula is a modern reading of the paper, not something Reynolds wrote. It also leaves out three things he does specify:

- **Priority.** He considers weighted averaging, then sets it aside for "prioritized acceleration allocation", in which requests fill a fixed acceleration budget in priority order (p. 7).
- **Distance weighting.** His neighbourhood sensitivity is "an inverse exponential of distance" (p. 8). He also reports: "In an early version of the flock model, the metrics of attraction and repulsion were weighted linearly by distance… The model was changed to use an inverse square of the distance" (p. 8).
- **Speed limits.** He specifies "a simple model of viscous speed damping" and "a maximum acceleration, expressed as a fraction of the maximum speed" that truncates acceleration requests (p. 4).

Reynolds does not model aerodynamics between birds. He notes that fish school partly by the "lateral line" organ, which senses pressure waves (pp. 7–8), but his boids do not simulate the senses, and no bird feels another bird's wake.

*Full text read (author's OCR reprint).*

### Crank (1975), *The Mathematics of Diffusion*, 2nd ed.

Crank, J. (1975). Oxford: Clarendon Press. ISBN 0198533446.

The registry cites Crank for the heat equation with first-order loss:

$$\partial_t u = D\nabla^2 u - k u$$

In its standard statement this is a parabolic PDE. Diffusion smooths $u$ at rate $D$, and the loss term removes it exponentially at rate $k$. The registry's locator is "Ch. 1 (diffusion equation); Ch. 14 (diffusion with first-order reaction)". We could not check it.

*Full text not available to us. We discuss it here from the registry entry and the standard form of the equation only.*

## What the code does

All line numbers refer to `apps/boid_drafting/index.html` at d183990. That file is byte-identical to the current main, a45a44e. The page has no embedded cogdoc block, and the registry records `claim: null`. The only statement of intent is the sidebar text quoted above.

**The medium (lines 89–111), fidelity: modified.** The canvas is divided into 15 px cells (line 51), each holding a 2-vector $(v_x, v_y)$. Every frame, each cell becomes the mean of its in-bounds 3×3 neighbourhood multiplied by $(1-\text{diss})$, with $\text{diss}=0.05$ by default:

$$\mathbf{u}^{n+1}_{ij}=(1-\delta)\,\frac{1}{|\mathcal{B}_{ij}|}\sum_{(k,l)\in\mathcal{B}_{ij}}\mathbf{u}^n_{kl}$$

One box-blur step is a discrete diffusion step. It adds $\tfrac19\sum_k(\mathbf u_k-\mathbf u_{ij})\approx\tfrac13h^2\nabla^2\mathbf u$, so $D\,\Delta t/h^2\approx1/3$. Multiplying by $(1-\delta)$ is the exact one-step solution of $\dot u=-ku$ with $e^{-k\Delta t}=1-\delta$. The update is therefore an operator split of the Crank equation, applied to each vector component separately. Edge cells divide by the number of neighbours actually present (lines 99–107). That gives an approximately zero-flux edge. The field does not wrap, even though the boids do (lines 169–170).

**Writing to the medium (lines 150–160).** Each boid reads its own cell first (line 154) and then adds $0.2\,\mathbf{v}_b$ to that cell, clamping each component to $[-2,2]$ (lines 158–159).

**The steering (lines 128–147 and 162–163), fidelity: modified.** Neighbours are the boids within 60 px (line 135). Cohesion steers toward the neighbours' centroid (line 145) and alignment toward their mean velocity (line 146). Separation sums unit vectors pointing away from every neighbour closer than 25 px (line 139). With $g=0.15$ (`maxForce`, line 125), the update is:

$$\mathbf{v}\leftarrow \mathbf{v}+g\big(w_c\,\Delta\bar{\mathbf{x}}+w_s\,\mathbf{s}+0.5\,\Delta\bar{\mathbf{v}}+w_d\,\mathbf{u}_{\text{cell}}\big),\qquad |\mathbf{v}|\le 3.5$$

The defaults are $w_c=0.5$, $w_s=1.5$ and $w_d=1.5$ (line 55). The alignment weight is fixed at 0.5 in the code, and no slider exposes it. Position then advances by $\mathbf{v}$ each frame (line 168).

## Where it departs from the source

- **`maxForce` is a gain, not a limit.** Lines 162–163 multiply every term by `maxForce`, and nothing bounds the summed steering. The registry's deviation note says "Force is clamped by maxForce". The code does not do this. The only bound is the speed clamp at line 166. Reynolds truncates each acceleration request (p. 4) and allocates a fixed acceleration budget in priority order (p. 7).
- **Weighted sum, no priority.** All four terms are simply added (lines 162–163). This is the averaging scheme Reynolds describes as working "pretty well" before he replaced it (p. 7).
- **Sensitivity has no distance weighting.** Neighbours count fully inside a hard 60 px disc (line 135). Separation uses unit vectors inside 25 px (line 139), whereas Reynolds reports inverse-square weighting (p. 8).
- **Neighbours are not found across the wrap seam.** Distances are raw differences (line 133), so boids on opposite edges of the torus cannot see each other.
- **Integration is per frame.** There is no $\Delta t$ (line 168), so speeds are in px/frame and the simulation runs faster on faster displays.
- **The medium is not a fluid.** There is no advection, no pressure and no incompressibility (lines 89–111). What the code maintains is a diffusing, decaying vector field. The page calls it a "reactive fluid grid" (line 23).
- **A boid can push itself along.** A boid reads its own cell before writing to it, and at 3.5 px/frame it stays in a 15 px cell for about four frames. It therefore reads back its own earlier deposits. A headless run of a single boid on an empty grid (lines 89–170, no neighbours) finds a steady forward push of 0.069 px/frame² from the drafting term alone.
- **The wake has no lateral upwash.** Momentum is deposited in the boid's own cell, directly along its track (lines 158–159). The usual aerodynamic account of V-formations depends on upwash beside and behind a wingtip. Nothing in this code places a benefit to the side.

## What it shows, and what it doesn't

Every run is unseeded (`Math.random`, lines 80–81), and no metric is computed. The page therefore shows, but does not measure. The sidebar's claim of "echelon and V-formations" has no instrument behind it.

To see what the drafting term actually does, we ported lines 89–170 unchanged into a headless loop. We added a seeded generator, a 1200×800 field and 3000 frames, discarded the first 1000 frames, and averaged over three seeds. We measured two quantities:

- **Global polarization:** the length of the mean unit heading, where 1 means every boid heads the same way.
- **Local polarization:** the same statistic over each boid's 60 px neighbourhood.

| drafting $w_d$ | alignment | local pol. | global pol. | $\cos(\mathbf{u}_{\text{cell}},\mathbf{v})$ |
|---|---|---|---|---|
| 1.5 | 0.5 | 0.99 | 0.89 | 0.99 |
| 0 | 0.5 | 0.95 | 0.57 | 0.93 |
| 1.5 | 0 | 0.99 | 0.76 | 0.99 |
| 0 | 0 | 0.82 | 0.44 | 0.82 |

A second set of three seeds gave the same ordering, with global polarization of 0.76, 0.66, 0.76 and 0.43. Three conclusions follow.

- **The medium does couple the boids.** With alignment switched off, drafting alone raises global polarization from about 0.44 to about 0.76. Wakes spread boids' headings to one another.
- **Most of that coupling works like alignment by another route.** The grid vector a boid reads points almost exactly along its own velocity (cosine about 0.99). What the boid mostly feels is a push along the road it and its neighbours are already travelling, not a pull toward a spot behind a leader.
- **Nothing here measures formation geometry.** Neither measurement tests for a V. A real test would compute, for example, the bearing of each boid's nearest leader relative to its heading, and look for a peak off-axis.

The page is a readable demonstration of stigmergic alignment: agents coordinating through marks left in a shared medium. It does not demonstrate aerodynamic drafting, and V-formations are not shown to emerge from it.

Our port and its outputs are in `.cog/mem/working/2026-09-23-gallery/repro/` (`boids.js`, `lone.js`).

## Further reading

- Reynolds 1987: https://doi.org/10.1145/37402.37406. Author's reprint: https://web.archive.org/web/2022id_/https://www.red3d.com/cwr/papers/1987/SIGGRAPH87.pdf
- Crank, *The Mathematics of Diffusion*, 2nd ed. (1975), ISBN 0198533446 (no DOI; not held)
