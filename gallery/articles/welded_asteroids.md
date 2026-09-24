---
sim: welded_asteroids
title: Welded Asteroids: the field glued into a Klein bottle, measured on a flat square
subtitle: Gluing-aware agents and diffusion on four quotient surfaces, a chirality heuristic, a topology census that never sees the gluing, and a borrowed confinement time
papers: [massey1977, hatcher2002, jones2010, crank1975, gray1971]
---
## The idea

`welded_asteroids` takes the closed-loop simulation from `welded_fields` (Jones agents, a trail, and a momentum field the agents write themselves) and moves it off the torus. The 300×300 square becomes a fundamental polygon, and the user chooses how its edges are glued: torus, Klein bottle, projective plane or Möbius strip. Agents that cross a mirrored edge come back reflected, and the trail and momentum fields diffuse through the same reflection. A tour of "levels" sets each one's target as a $b_1$ count.

The file is `apps/welded_asteroids/index.html`, 2,588 lines at commit `d183990`. Between that commit and `a45a44e` only its YAML frontmatter changes. This article covers five parts of it: the gluing map, gluing-aware diffusion, the modified sensor rule, the topology census, and the confinement ledger. The gluing itself is careful work. The measurement does not follow it.

## The sources

### Massey (1977), *Algebraic Topology: An Introduction*

Springer GTM 56, ISBN 0387902716. The standard classification presents a closed surface as a polygon with its edges identified according to a word. Opposite sides glued with the same orientation give the torus, $aba^{-1}b^{-1}$. Flip one pair and you get the Klein bottle, $aba^{-1}b$. Flip both and you get the projective plane, $abab$. The registry cites Massey for this. We did not have the full text, and the statements above are standard.

### Hatcher (2002), *Algebraic Topology*

Cambridge University Press (free author's edition). Hatcher gives the same constructions: "the more usual representation of the Klein bottle is as a square with opposite sides identified via the word $aba^{-1}b$", and $\mathbb{RP}^2$ is "the quotient of $D^2$ with antipodal points of $\partial D^2$ identified" (§1.2, p. 51). The Euler characteristic is the alternating sum of Betti numbers (Theorem 2.44, p. 146):

$$
\chi(X) = \sum_n (-1)^n \operatorname{rank} H_n(X).
$$

Example 2.47 (p. 151) computes $H_1(K) \approx \mathbb{Z}\oplus\mathbb{Z}_2$ and $H_2(K) = 0$ for the Klein bottle. So $b_1(K) = 1$, whereas $b_1(T^2) = 2$ and $b_2(T^2) = 1$. The identity $b_1 = b_0 - \chi$ holds only when $b_2 = 0$, as it does for a planar pixel complex. We read the full text.

### Jones (2010), Crank (1975), Gray (1971)

The agent rule is Jones's (Figure 3, p. 133; full text read). The trail obeys the standard $\partial_t u = D\nabla^2 u - ku$ (Crank; not held). The mask's Euler number uses Gray's bit-quad formula, $\chi_8 = \tfrac14(n(Q_1) - n(Q_3) - 2n(Q_D))$ (not held; statement as recorded in the registry). The `welded_fields` article covers all three.

### In-house: the confinement time

The ledger borrows the *form* of the tokamak energy confinement time, $\tau_E = W/P_{\text{loss}}$. It is documented in `docs/confinement-field.md` in the eigen-form repo, not in a paper. The registry marks it as an *analog*.

## What the code does

All line numbers refer to `apps/welded_asteroids/index.html` at `d183990`.

- **Gluing map** (L484–492), fidelity: *exact*. `flipP` sends $(x, y, a) \mapsto (W-x,\, y,\, \pi - a)$ when x mirrors, and $(x,\, H-y,\, -a)$ when y mirrors. `flipV` sends a vector to $(-v_x, v_y)$ or $(v_x, -v_y)$. These are the correct reflections of a point, a heading and a tangent vector. The surface table (L467–480) marks which crossing mirrors which axis. On the Klein bottle, crossing the y seam mirrors x. `wrapPos` (L527–549) applies one flip for each crossing on each axis. Its comment records an earlier bug in which a double flip teleported agents.
- **Gluing-aware diffusion** (L641–679, trail; L680–711, momentum), fidelity: *modified*. The same separable 3-point box mean as `welded_fields`, but a neighbour across a mirrored seam is read from the mirrored cell (`nb`/`nbT`, L647–653, L664–671). For momentum, the vector component normal to the mirror changes sign (L687–690). We checked the stencil headlessly. It conserves mass exactly on all four surfaces over 200 steps at `dec = 1`. On the Klein bottle, mass at $(100, 0)$ reaches bottom-row cells 198–200, the mirror image $W-1-100 = 199$.
- **Glued reads** (L561–612). `foldRead` maps any sample point to its image in the base square, and `momRead` flips the vector it reads to match.
- **Sensor rule** (L839–866), fidelity: *modified*. This is Jones's rule with the `welded_fields` random tie-break (L866), plus one addition. If the front sample and a flank sample fall on different images of the square, the code swaps L and R before comparing them (L860–861).
- **Topology census** (L1013–1049), fidelity: *approximation*. Bit-quad $\chi$ on the zero-padded mask (L1015), $b_0$ by flood fill that stops at the square's edges (L1036), and $b_1 = b_0 - \chi$ (L1049). The level tour (L1058ff.) marks a level solved when this $b_1$ reaches its target on three consecutive measurements (L1107–1115).
- **Confinement ledger** (L748–827), fidelity: *analog*. $W_{\text{stored}} = 0.01\sum_i \max(0, u_i - \bar u) + 100\cdot|\sum \mathbf m|/\sum|\mathbf m|$ (L766, L789, L820). $P_{\text{in}} = 40\kappa/q$ in field-on mode (L817). $\tau_{\text{sim}} = W_{\text{stored}}/P_{\text{in}}$ in field-on mode, and 0 in every other mode (L823).

## Where it departs from the source

- **The topology census is flat, which contradicts the claim.** L1015 zero-pads and L1036 refuses to cross edges, so the census measures the square as a planar picture. We tested the functions on synthetic masks. A band spanning the square, which on every one of these surfaces is a closed loop, scores $b_1 = 0$. A ring cut by a seam scores two components and no hole. The registry's summary says "$\beta_1$ measured on the surface". The cogdoc claim (L30–38) says the readout is honest "only … when both the agent writes and the agent reads obey that surface's gluing rule". Its own limitation (L215–219) concedes the measurement is on the square. Nothing in the census reads the gluing, so the $b_1$ shown under "Klein bottle" is the same function of the mask as under "torus".
- **$b_2$ is assumed to be zero.** Even a glued census would need $b_1 = b_0 + b_2 - \chi$ on a closed surface. For the torus $b_2 = 1$ (Hatcher, Theorem 2.44 applied).
- **The chirality swap looks wrong in at least one case we tested.** `foldRead` already returns the correct physical point for every sample. A flank that stays on the agent's own side of the seam is still that agent's left or right. We placed an agent at $(150, 296)$ on the Klein bottle heading toward the seam, put trail only at its left sample, and ran L845–866. The front sample crossed the seam and the flanks did not, so `swapLR = 1`. The agent turned *away* from the trail. The comment (L833–838) says the swap cures agents pinning at the seam. That may be true empirically, but it does so by departing from gradient following, and the file includes no test that it is correct.
- **The Möbius field is not clipped.** The limitation (L211–213) and the surface note (L479) say "the field stops at the strip's edges; agents bounce off them". In the code, agents are clamped at the free edges, not reflected: position is pinned, heading unchanged (L545–547). Meanwhile `nb`/`nbT` and `foldRead` wrap y periodically for every surface (L648, L562). Mass at $(150, 0)$ diffuses into the bottom row at $x = 149$–$151$, and a sensor above the top edge reads the bottom row. The *field* therefore lives on a Klein bottle (mirrored x-seam, periodic y), while the *agents* live on a Möbius strip with sticky walls.
- **The Möbius edge word is a cylinder's.** It is shown as `a b a⁻¹ c` (L477). With the x-pair flipped, the word should give the pair the same exponent, $a\,b\,a\,c$. This is a display string only.
- **$\tau$ divides by the wrong power.** In a tokamak, $\tau_E = W/P_{\text{loss}}$, which equals $W/P_{\text{in}}$ only in steady state. Here $P_{\text{in}}$ is a bookkeeping constant, $40\kappa/q$, while $P_{\text{loss}}$ is computed separately (L819) and is never forced to equal it. $W_{\text{stored}}$ adds a trail-contrast sum to a dimensionless order parameter weighted by 100 (L820), so it is not an energy. A `coherent` sum is computed at L762–763 and never used.
- **Frontmatter.** At `d183990` the cogdoc fails to parse as YAML (unquoted `: ` at L44 and L112), which is why the registry lists it as "unparseable". `a45a44e` quotes those lines.

## What it shows, and what it doesn't

The gluing is the real achievement. Positions, headings, trail diffusion and momentum diffusion all transform consistently through the seams, apart from the Möbius y-axis. A trail crossing a Klein seam and coming back mirrored is a faithful picture of a non-orientable surface.

The claim goes further (L30–38). It says re-reading the same agents under other gluings "produces surfaces whose beta_1 the flat proxy cannot see". But the only $b_1$ in the file *is* the flat proxy. The level targets, from 12 up to 48, are thresholds on that proxy. Reaching one shows the swarm made enough holes inside the square, not that it built loops on the surface. The claim needs a census on the glued cell complex, using the neighbour map already in `nb` for the flood fill and the quad counts, plus a $b_2$ term. Until then the honest reading is "structures that look different on different surfaces", not "topology measured on the surface".

The confinement ledger's own design doc is candid. It records that the bootstrap and rational-locking signatures were "refuted by their own controls", and that bootstrap is "NOT YET ESTABLISHED" as of v2.11.3. We agree. $\tau_{\text{sim}}$ is a ratio of two constructed indices. It can rank runs that share a $\kappa$ and $q$, but it has no units that would make "confinement time" more than a metaphor.

## Further reading

- Hatcher (2002), *Algebraic Topology*, ISBN 0521795400 — free edition: https://pi.math.cornell.edu/~hatcher/AT/AT.pdf (§1.2 p. 51; Thm 2.44 p. 146; Ex. 2.47 p. 151)
- Massey (1977), *Algebraic Topology: An Introduction*, ISBN 0387902716 (not held)
- Jones (2010): https://doi.org/10.1162/artl.2010.16.2.16202 — open copy: https://core.ac.uk/download/323898340.pdf
- Gray (1971): https://doi.org/10.1109/t-c.1971.223289 (not held)
- Crank, *The Mathematics of Diffusion*, ISBN 0198533446 (not held)
- In-house: `docs/confinement-field.md`, myrgic/eigen-form at `d183990`
