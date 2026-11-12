---
sim: smoke_rings
title: Smoke rings in a softened well
subtitle: Orbits in Plummer's potential, stirred by Ornstein–Uhlenbeck noise and drawn as contour lines
papers: [plummer1911, uhlenbeck1930, maruyama1955]
---
## The idea

About 190 invisible tracer particles orbit a central anchor. They lose energy slowly to friction and are nudged by random kicks. Each tracer leaves density on a grid as it moves. The grid spreads out and fades over time, and the page draws it only as seven iso-contour lines. The anchor also moves: it drifts randomly and is pulled back toward the centre. The plate text reads "settling toward the center — drawn as the field's own contours" (`apps/smoke_rings/index.html`, line 31, d183990).

Three older ideas are packed into this picture: Plummer's 1911 cluster law for the anchor's pull (though the file's own comments name a different force), Uhlenbeck–Ornstein Brownian motion for the wander and jitter, and Euler–Maruyama time stepping with an adjusted noise.

## The sources

### Plummer (1911), *On the Problem of Distribution in Globular Star Clusters*

Plummer, H. C. (1911). *MNRAS* 71(5), 460–470. doi:10.1093/mnras/71.5.460.

Plummer went looking for "a physical basis on which the distribution of stars in clusters may be established" (pp. 460–461). He treated a globular cluster as if it were a sphere of gas in convective equilibrium. That gave him the equation now called the Lane–Emden equation, his (7) on p. 463:

$$\frac{d}{dr}\Big(r^2\frac{d\phi^{\gamma-1}}{dr}\Big)+r^2\phi=0.$$

It has two solutions in closed form. The one Plummer uses is Schuster's, for $\gamma=1.2$: "$\phi(r)=(1+r^2)^{-5/2}$ … except for a numerical factor which we can omit" (eq. 11, p. 463). His equation (12) on p. 464 gives the space density $\phi(r)=N(1+r^2)^{-5/2}$, together with the strip and cumulative counts. In §§6–8 he fits these counts to star counts for ω Centauri and to Pickering's reduced curves. In §§9–11 he shows that M 3 is "marked by a higher degree of condensation towards the centre than can be reconciled with the law" (p. 470).

Plummer never writes down a potential or a force. The acceleration the registry attributes to him,

$$\mathbf{a}=-\frac{\mu\,\mathbf{r}}{(r^2+\varepsilon^2)^{3/2}},$$

is our inference from his density law, not a formula he states. In his equation (7), $\phi^{\gamma-1}$ plays the role of the depth of the gravitational potential. For $\gamma=1.2$ that gives $\phi^{0.2}=(1+r^2)^{-1/2}$, the familiar Plummer potential shape $\Phi\propto-(r^2+a^2)^{-1/2}$. Its gradient is the force above, with the scale radius $a$ serving as the "softening length" $\varepsilon$. The use of this form to soften point masses in N-body codes came later, and it is not in this paper.

*Full text read (NASA ADS scan, OCR plus page-image check).*

### Uhlenbeck & Ornstein (1930), *On the Theory of the Brownian Motion*

Uhlenbeck, G. E. & Ornstein, L. S. (1930). *Physical Review* 36(5), 823–841. doi:10.1103/physrev.36.823.

The paper starts from the equation of motion $m\,du/dt=-fu+F(t)$ (eq. 2, p. 824). The medium's influence is split into "a systematic part $-fu$, which causes the friction" and "a fluctuating part $F(t)$". With an external force added, this becomes (2a) on p. 825:

$$m\frac{du}{dt}=-fu+F(t)+K(x).$$

With $\beta=f/m$ and $A=F/m$, §5 (p. 827) integrates $du/dt+\beta u=A(t)$. The mean velocity decays as $\overline{u}=u_0e^{-\beta t}$ (eq. 12). Equipartition then fixes the noise strength: $\tau_1=2\beta kT/m$ (eq. 13, p. 828). The velocity therefore relaxes to a Gaussian distribution, "which shows how the Maxwell distribution is reached" (p. 828). Part IV (p. 833) takes up "The Brownian Motion of a Harmonically Bound Particle", with $\frac1mK(x)=-\omega^2x$. In the strongly damped limit it arrives at

$$\frac{\partial F}{\partial t}=\frac{\omega^2}{\beta}\frac{\partial}{\partial x}(xF)+D\frac{\partial^2F}{\partial x^2}.$$

This is the Fokker–Planck equation for what is now written $dX=-\theta X\,dt+\sigma\,dW$, with $\theta=\omega^2/\beta$.

*Full text read (Internet Archive scan, OCR plus page-image check).*

### Maruyama (1955), *Continuous Markov processes and stochastic equations*

Maruyama, G. (1955). *Rendiconti del Circolo Matematico di Palermo* 4(1), 48–90. doi:10.1007/bf02846028. The bibliographic details come from Crossref.

This paper is the standard citation for the Euler–Maruyama scheme. In its usual form the scheme is $X_{n+1}=X_n+b(X_n)\Delta t+\sigma\,\Delta W_n$, where each $\Delta W_n$ is drawn independently from $\mathcal N(0,\Delta t)$.

*Full text not available to us. The scheme is described here in its standard form only.*

## What the code does

All line numbers refer to `apps/smoke_rings/index.html` at d183990. The file is unchanged at a45a44e. There is no embedded cogdoc block, and the registry records `claim: null`.

**The anchor (lines 116–119). Fidelity: modified.** The anchor follows an Ornstein–Uhlenbeck process in position, stepped explicitly:

$$a_{n+1}=a_n-\theta a_n\Delta t+\xi_n\sqrt{\Sigma\,\Delta t},\qquad \xi_n\sim\mathcal U[-1,1].$$

Here $\theta=0.7$ (line 82) and $\Sigma=0.34\times$ the wander slider, which gives 0.129 at the default setting (line 87). This matches the strongly damped harmonic case from Uhlenbeck and Ornstein's Part IV, not their velocity process.

**The force (line 95). Fidelity: exact.** `gmag(r2) = MU/(r2+EPS2)^1.5` is Plummer's force, measured relative to the moving anchor (lines 123–124). $\varepsilon^2=0.05$, so $\varepsilon\approx0.22$ (line 78). $\mu=0.04+1.28\times$ the settle slider, which gives 0.45 at the default setting (line 86).

**The tracers (lines 120–127). Fidelity: modified.** The tracer update is

$$\mathbf v\leftarrow\mathbf v+\big(-g(r^2)\,(\mathbf x-\mathbf a)-\gamma\mathbf v\big)\Delta t+\boldsymbol\xi\sqrt{J\Delta t},\qquad \mathbf x\leftarrow\mathbf x+\mathbf v\,\Delta t,$$

with $\gamma=0.085$ (line 93), $J=0.012$ (line 78), and uniform $\boldsymbol\xi$. This is Uhlenbeck and Ornstein's (2a), with $K$ equal to the Plummer force. Here $\Delta t$ is the wall-clock frame interval in seconds, capped at 0.05 (line 247).

**The field (lines 107–112 and 141–154). Fidelity: modified.** Each tracer adds $8.5\,\Delta t$ of density through a 3×3 Gaussian splat (lines 106 and 128). It adds an extra 9 each time it completes a full turn around the anchor (lines 129–132). Every frame, the grid gets two explicit five-point diffusion passes with coefficient 0.19 (lines 142–150), then a multiplication by 0.992 (line 152). Everything outside the unit disk is zeroed (line 152). Contour levels are fixed fractions of a slowly tracked maximum (lines 187 and 191–197), and they are extracted by marching squares (lines 160–184).

## Where it departs from the source

- **The comment names the wrong force.** Lines 90–91 say "Ornstein-Uhlenbeck in a harmonic well, v += (-K*pos - DAMP*v)dt". The force actually used is Plummer's (lines 95 and 124–126). The comment at lines 74–77, which describes a softened gravitational anchor, is the accurate one. The harmonic description holds only well inside the core: for $r\ll\varepsilon$ the acceleration is approximately $-(\mu/\varepsilon^3)\mathbf r$. Tracers are born at radii from 0.28 to 0.9 (line 97), which is outside the core, and they are removed below $r=0.04$ (line 134).
- **The tracers are not an OU process.** In a harmonic well the pair $(\mathbf x,\mathbf v)$ would form a linear SDE, which is a multivariate OU process. The Plummer force is nonlinear, so the tracer process is underdamped Langevin dynamics, not OU.
- **The noise is uniform, not Gaussian.** Lines 116–117 and 125–126 draw from $\mathcal U[-1,1]$, whose variance is $1/3$. The per-step variance is therefore $\Sigma\Delta t/3$ and $J\Delta t/3$, not $\Sigma\Delta t$ and $J\Delta t$. Over many steps the increments add up to a nearly Gaussian result, so the practical effect is that the true diffusion coefficient is one third of the nominal value.
- **Noise and friction are not linked.** Uhlenbeck and Ornstein fix the noise strength from the friction and the temperature (eq. 13, p. 828). Here $J$ and $\gamma$ are separate constants (lines 78 and 93).
- **No tracer reaches equilibrium.** The velocity relaxation time is $1/\gamma\approx12$ s, and a tracer lives 9–22 s (line 101). Tracers are also removed if they escape past $r^2>1.5$ or fall below $r^2<0.0016$ (line 134). The steady look of the picture comes from constant replacement, not from a stationary distribution.
- **The integrator is semi-implicit Euler, not Euler–Maruyama.** Position is updated with the velocity from the same step (line 127). For the deterministic part, this ordering is symplectic Euler.
- **The anchor has three extra forces.** Pointer input pulls the anchor (line 118), and the anchor is hard-clamped to $|a|\le0.62$ (line 119). With uniform noise, the stationary per-axis variance is $\Sigma/(6\theta)\approx0.031$ at the default setting, so the clamp is active less than 0.2% of the time. At full wander it is active about 9% of the time.
- **Two clocks.** Tracer motion and deposits scale with $\Delta t$. Diffusion and decay run once per frame (line 248). At 60 Hz the field's half-life is about 1.4 s; at 120 Hz it is about 0.7 s. The rendered picture therefore depends on the display's refresh rate.
- **The disk rim absorbs density.** The diffusion stencil reads zeroed cells outside the disk (lines 144–145 and 152), so density leaks out at the rim.

## What it shows, and what it doesn't

The page makes no measured claim. The contours are normalised by a running maximum (line 192), so they show the shape of the density and hide its absolute size. The piece shows a population of damped orbits in a softened Kepler well. Their periods lengthen with radius, so, as lines 75–76 say, the orbits drift out of phase rather than moving in lockstep. The rings on screen are the time-averaged footprint of those orbits, and their shape is also shaped by the extra deposits at each completed turn (lines 131–132).

The comments at lines 79–81 describe a "dyad" in which the tracers act as "the LISTENER, tracking the moving well a beat late". That is a reasonable qualitative reading, but nothing in the code measures it. No lag, correlation, or response function is computed. `window.TOPO.stat` (lines 260–261) reports only the maximum, the mean, and their ratio.

The page does not demonstrate Plummer's cluster law, Brownian equilibrium, or any quantitative result. It borrows the forms of those equations and pairs them with a visual encoding that is honest about shape and deliberately says nothing about absolute amounts.

## Further reading

- Plummer 1911: https://doi.org/10.1093/mnras/71.5.460. Scan: https://articles.adsabs.harvard.edu/pdf/1911MNRAS..71..460P
- Uhlenbeck & Ornstein 1930: https://doi.org/10.1103/physrev.36.823. Scan: https://archive.org/details/sim_physical-review_1930-09-01_36_5
- Maruyama 1955: https://doi.org/10.1007/bf02846028 (not held)
