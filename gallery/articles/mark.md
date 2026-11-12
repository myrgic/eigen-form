---
sim: mark
title: The Mark: a trefoil drawn in paint order
subtitle: A closed-form (2,3) torus knot projected to the plane, where recency decides which strand crosses over
papers: [hatcher2002, rolfsen1976]
---
## The idea

The Mark is the lab's logo, rendered live. A bright ball traces a three-lobed curve, a trefoil, and the stroke it leaves fades behind it. The registry records that "time is a drawing parameter, there is no dynamical state". In other words, this is a parametric curve being drawn, not a simulation. The questions worth asking are about the geometry. Which curve is being drawn? And what knot does the picture on the screen actually depict?

## The sources

### Hatcher (2002), *Algebraic Topology*

Hatcher, A. (2002). Cambridge University Press; free author edition.

Example 1.24, "Torus Knots" (p. 47), defines the family: "For relatively prime positive integers $m$ and $n$, the torus knot $K=K_{m,n}\subset\mathbb R^3$ is the image of the embedding $f:S^1\to S^1\times S^1\subset\mathbb R^3$, $f(z)=(z^m,z^n)$, where the torus $S^1\times S^1$ is embedded in $\mathbb R^3$ in the standard way." The example uses $(m,n)=(2,3)$ as a case, and it also states the coprimality condition: "Without this assumption $f$ would be $d$–to–1 where $d$ is the greatest common divisor of $m$ and $n$, and the image of $f$ would be the knot $K_{m/d,n/d}$" (p. 47). Written in coordinates on a torus with core radius $R_0$ and tube radius $\rho$, this is the formula the registry records:

$$r(\phi)=R_0+\rho\cos(q\phi),\qquad (x,y,z)=\big(r\cos p\phi,\ r\sin p\phi,\ \rho\sin q\phi\big),\qquad \gcd(p,q)=1.$$

*Full text read (author's free edition).*

### Rolfsen (1976), *Knots and Links*

Rolfsen, D. (1976). Publish or Perish. ISBN 0914098160. This is the registry's cited origin. By standard knowledge, it is a classic reference for torus knots and knot diagrams.

*Full text not available to us. We make no claim about its contents.*

## What the code does

Line numbers below refer to commit d183990.

- **`src/dynamics/torus-knot.js`, lines 47–54 (fidelity: modified).** `knotPoint` computes $r=R_0'+\rho'\cos\psi$. It then maps the point to $(x,y)=(c_x+r\cos(\alpha+\pi_p),\ c_y+r\sin(\alpha+\pi_p))$ and sets $z=\sin\psi$. Here $\alpha$ is the angular phase, $\psi$ the radial phase, and $\pi_p$ an optional precession angle.
- **Radii (lines 38–40).** $R_0=\tfrac23 s$ and $\rho=\tfrac13 s$, where the scale $s$ defaults to 215 px.
- **Engine, `src/eigen-form.js`, lines 190–191 and 222–226.** The engine advances $\alpha$ and $\psi$ with the Euler steps in `stepPhases` (`torus-knot.js`, lines 57–62), at rates $\omega_\alpha=2\pi p/T$ and $\omega_\psi=2\pi q/T$. The rates are multiplied by an emergence ramp that reaches 1 two seconds after the mark is created. For constant rates, the Euler update is exact because the phases are linear in time. So at steady state the drawn curve is the closed form with $\phi=2\pi t/T$, and it closes every period $T$.
- **Drawing (`src/backends/canvas2d.js`, lines 41–55; substrate fade, lines 31–35).** Each substep paints a round-capped segment on top of the canvas. The fade then erases the whole canvas by a fraction set by a half-life (6 s by default) (`src/dynamics/substrate.js`, lines 29–36).

## Where it departs from the source

- **The third coordinate is thrown away.** `knotPoint` returns `z` (line 52), but the engine destructures only `{ x, y }` (`eigen-form.js`, line 229). The comment at `torus-knot.js` lines 42–44 describes `z` as a "depth proxy (over/under crossing order)". Nothing reads it. The registry's deviation note says `z` is "kept only as a depth proxy". In practice it is not used at all.
- **What decides over and under is recency.** The engine's header states that "The crossings' over/under is not stored: it emerges from the drawing process itself — freshly deposited trail painting over the dimming trail beneath it" (`eigen-form.js`, lines 7–9; repeated at lines 262–264). That rule does not reproduce the trefoil. We checked numerically: the planar projection of the $(2,3)$ curve with $R_0=2\rho$ has three crossings. Walking once around the curve, the 3-D $z$ order alternates over, under, over, under, over, under, which is the standard alternating trefoil diagram. Recency order gives over, over, over, under, under, under, walking backward from the ball, and it does so wherever the ball is. A diagram in which each strand passes over everything drawn before it is a *descending* diagram. By a standard argument, a descending diagram always represents the unknot. At any instant, then, the screen shows a diagram of the unknot drawn along the trefoil's shadow. The over/under at each crossing flips as the ball comes round again.
- **The parameters can leave the family.** The panel allows $p,q\in\{1,\dots,7\}$ with no coprimality check (`apps/mark/index.html`, lines 120–121). When $\gcd(p,q)=d>1$, the curve retraces a $(p/d,q/d)$ curve $d$ times, as Hatcher's remark predicts. $(2,4)$, for example, draws the same closed curve twice. When $p=1$ or $q=1$, the torus "knot" is the unknot.
- **Precession turns it into a rosette.** A nonzero `precession` (`eigen-form.js`, lines 208–213) rotates the whole frame over time. Successive laps no longer coincide, and the fading trace becomes a spirograph rather than a closed knot.
- **Emergence is a transient.** During the first 2 s, $R_0$, $\rho$ and the rates are ramped by separate smoothstep factors (`eigen-form.js`, lines 177–191). Only after that does the curve settle onto the closed form.

## What it shows, and what it doesn't

The Mark reproduces the shadow of the (2,3) torus knot exactly. The lab's written claim goes further: that "the mark's depth is an eigenform of its own maintenance" and that the crossings' over/under "emerge from paint order" (`eigen-form.js`, lines 7–10, 262–264). The first half of that is true as a statement about rendering. The layering you see is made by the drawing process, not stored. The implied second half is false: the layering is not the trefoil's. The trefoil exists here only as a shadow; paint order supplies a different, unknotted crossing structure. The knot data needed for the real one is computed at `torus-knot.js` line 52 and then discarded. Using it would take a real change. The simplest version would be to paint each crossing's under-strand with a gap, choosing the under-strand by the sign of `z`.

Our crossing check is in `.cog/mem/working/2026-09-23-gallery/repro/knot.py`.

## Further reading

- Hatcher, *Algebraic Topology* (2002), Example 1.24, p. 47: https://pi.math.cornell.edu/~hatcher/AT/AT.pdf
- Rolfsen, *Knots and Links* (1976), ISBN 0914098160 (no DOI; not held)
