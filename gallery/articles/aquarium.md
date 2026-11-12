---
sim: aquarium
title: Aquarium
subtitle: Buoyant water, a nitrogen cycle and three populations in one tank. The simulation is unvetted and has been shelved.
papers: [spiegel1960, chorin1968, stam1999, monod1949]
---
## The idea

A fish tank combines several standard models. The water is an incompressible fluid. The heater makes it buoyant. Fish waste becomes ammonia, which two bacterial populations in the filter convert to nitrite and then to nitrate. The aquarium puts all of this on one 112 × 70 grid, together with fish, plankton and bubbles, using the lab's agent-substrate engine. Four of its equations come from published sources.

Read this page as a description of a demo, not a result. The app manifest sets `"vetted": false` (`apps/aquarium/app.json`), and the simulation registry lists it as tier `demo` and state `shelf`, with no declared claim and no test port. It has been shelved and not promoted. What follows says what the sources establish and what the code does, and sets out the distance between them.

## The sources

### Spiegel & Veronis (1960), the Boussinesq approximation

E. A. Spiegel and G. Veronis, "On the Boussinesq Approximation for a Compressible Fluid," *Astrophysical Journal* 131, 442–447. The paper sums up the approximation in two statements (p. 442). First, "The fluctuations in density which appear with the advent of motion result principally from thermal (as opposed to pressure) effects". Second, "density variations may be neglected except when they are coupled to the gravitational acceleration in the buoyancy force". It then derives when these hold for a compressible gas: the layer must be thin compared with every scale height, and fluctuations driven by the motion must not exceed the static variations (abstract, p. 442). The reduced momentum equation is their eq. (25), p. 445:

$$
\partial_t\mathbf v+\mathbf v\cdot\nabla\mathbf v=-\frac{1}{\rho_m}\nabla p'+g\alpha T'\,\mathbf k+\nu\nabla^2\mathbf v,\qquad \nabla\cdot\mathbf v=0\ \ \text{(eq. 20)}.
$$

The registry writes the buoyancy term as $\mathbf f_b=-g\beta(T-T_0)\hat{\mathbf z}$. In eq. (25) the term carries a plus sign, $+g\alpha T'\mathbf k$, with $\mathbf k$ the vertical unit vector. The registry form only gives the physical direction (warm fluid rises) if $\hat{\mathbf z}$ points down. We read the full text.

### Chorin (1968), the projection method

A. J. Chorin, "Numerical Solution of the Navier-Stokes Equations," *Mathematics of Computation* 22, 745–762. Chorin evaluates an auxiliary velocity at each time step and "decomposed [it] into the sum of a vector with zero divergence and a vector with zero curl" (p. 746). The divergence-free part is the new velocity and the curl-free part is the pressure gradient (eq. 4). He solves for the pressure by iteration and identifies the scheme as a finite-difference analogue of a pressure Poisson equation (eqs. 19–21, p. 753). In compact modern form:

$$
\nabla^2 p=\nabla\cdot\mathbf u^*,\qquad \mathbf u=\mathbf u^*-\nabla p .
$$

Chorin's divergence stencil spans $2\Delta x$. As a result "the pressure iterations split into two calculations on intertwined meshes, coupled at the boundary" (pp. 754–755). He runs the iterations until successive pressure changes fall below a set tolerance $\varepsilon$ (p. 755). The paper never uses the word "projection", which is the later name for the method. We read the full text.

### Stam (1999), stable fluids

J. Stam, "Stable Fluids," *Proc. SIGGRAPH '99*, 121–128. Stam splits each step into four parts: add force, advect, diffuse, project. He solves advection by the method of characteristics. Each grid point is traced backward through the velocity field and the old field is sampled where the trace lands (§2.2, p. 123):

$$
q^{n+1}(\mathbf x)=q^n\big(\mathbf x-\mathbf u(\mathbf x)\,\Delta t\big).
$$

Of this step he writes: "Most importantly it is unconditionally stable", and "All that is required in practice is a particle tracer and a linear interpolator" (p. 123). Stam also advects the velocity by itself (`Transport(U1[i], U0[i], U0, dt)`, §3.2, p. 125). He solves diffusion implicitly and traces particles with second-order Runge–Kutta (RK2) (p. 125). We read the full text.

### Monod (1949), growth kinetics

J. Monod, "The Growth of Bacterial Cultures," *Annual Review of Microbiology* 3, 371–394 (Crossref metadata). **We could not get the full text; nothing below reports what its sections say.** The standard statement that carries Monod's name is a hyperbolic growth rate that saturates in the substrate concentration $S$:

$$
\mu=\mu_{\max}\frac{S}{K_s+S}.
$$

In the textbook model, substrate is used up at the growth rate divided by a yield coefficient.

## What the code does

All line numbers refer to commit `d183990`. Each step runs in a fixed order: diffuse, decay and advect every channel, apply reactions, project, then move agents and let them deposit (`engine/cpu.js:18-21`, `635-640`). Time is measured in steps and there is no explicit $\Delta t$.

- **Buoyancy** (`cpu.js:344-348`, fidelity *approximation*). The code runs `vec.y[i] -= r.beta * (T[i] - r.reference)` on every cell. Screen $y$ points down, so warm water gets an upward push. The single parameter `buoyancyBeta` (default 0.012, `spec.js:65`) combines $g$, $\alpha$ and the time step into one coefficient. The result is added straight to the velocity as an increment.
- **Semi-Lagrangian advection** (`cpu.js:263-274`, *discretized*). Each cell traces back one first-order Euler step, `x - vx[idx]`, and samples the field bilinearly (`cpu.js:84-93`). This is Stam's $q^n(\mathbf x-\mathbf u\Delta t)$ with $\Delta t=1$.
- **Projection** (`cpu.js:417-454`, *discretized*). The code computes divergence with backward differences, then runs a fixed number of in-place Gauss–Seidel sweeps of the 5-point Poisson equation, starting from $p=0$ every step (`cpu.js:431-444`). It subtracts a forward-difference gradient. The header comment (`cpu.js:385-415`) explains this pairing: centred differences on both sides decouple odd and even sub-grids. That is the same intertwined-mesh structure Chorin describes on pp. 754–755. Pairing backward and forward differences collapses $\nabla\cdot\nabla p$ to the compact 5-point Laplacian.
- **Monod kinetics.** The generic `monod` reaction at `cpu.js:333-340` computes the saturating conversion rate $\text{rate}\cdot a/(a+K)$. The tank's nitrifying bacteria use the `nitrify` reaction instead (`cpu.js:363-380`, *modified*). Per cell it computes $\mu=\mu_{\max}S/(S+K_s)$, uptake $=\mu b m$, and bacterial growth $=(\mu(1-b/K)-d)\,b\,m$. Here $m$ is the filter-media mask. The reaction runs twice, for ammonia to nitrite and nitrite to nitrate (`spec.js:253-260`).

## Where it departs from the source

- **The water does not advect itself.** The momentum channel is declared with `advectedBy: null` (`spec.js:229`), so `cpu.js:293` never transports velocity by velocity. The nonlinear $\mathbf v\cdot\nabla\mathbf v$ term in Spiegel–Veronis eq. (25), and Stam's first transport call, are missing. Only the scalars are advected (`spec.js:230-235`). The simulated water is a linear, forced, damped flow with projection. It is not Navier–Stokes.
- **Viscosity is an explicit blur.** Stam solves diffusion implicitly. Here each field is blended with a 3×3 box blur, `grid = grid(1-rate) + blur·rate` (`cpu.js:233-256`, weights at `kernel.js:436`).
- **There is also drag.** The momentum decays exponentially with a half-life of 220 steps (`spec.js:61`, `cpu.js:116-118`). The sources have no such term.
- **The Poisson solve does not converge to a tolerance.** It always runs 44 sweeps by default (`spec.js:62`) from a zero initial guess (`cpu.js:431`). Chorin iterates to a tolerance $\varepsilon$ (p. 755). The walls use clamped reads (`cpu.js:54-58`), which give zero-gradient conditions. Nothing explicitly sets the wall-normal velocity to zero.
- **Advection uses a first-order backtrace.** Stam used RK2 plus an adaptive tracer (p. 125).
- **The default backend is not the verified one.** It is `webgl2` (`spec.js:151`). Its projection is double-buffered Jacobi, which by its own comment "carries the same undamped-Nyquist-mode limitation the CPU path fixed". Projection is also "un-twin-verified" on that backend (`engine/webgl2.js:227-238`). The page calls the CPU engine "the instrument of record" (`index.html:68-72`), but by default it does not run the CPU engine.
- **Buoyancy lumps its constants.** $g$, $\alpha$ and $\Delta t$ are combined into one coefficient (registry deviation, `cpu.js:348`).
- **The live Monod term is not Monod's model.** The `monod` reaction the registry marks as *exact* (`cpu.js:333-340`) is not used by the aquarium spec, whose reactions are listed at `spec.js:246-261`. The term that actually runs is `nitrify`. That reaction adds a logistic (Verhulst) cap $(1-b/K)$ and a linear death rate, and gates both by a mask (registry deviation). Uptake uses the same $\mu$ as growth, with no yield coefficient (`cpu.js:375-378`).
- **The kinetics were tuned to the simulation.** The half-saturation default was cut to 0.001 after the bacteria kept dying out. The comment says this rescaled it "to the concentration scale actually achieved, not the one originally assumed" (`spec.js:130-144`). The chemistry also runs 8× faster by default (`spec.js:126`, `255`).

## What it shows, and what it doesn't

The aquarium makes no claim to test. The embedded cogdoc and the `claim` field are both absent (registry `claim: null`). The only description is the in-page note "The equations, in words" (`index.html:52-72`). That note says the water is "projected divergence-free every step" and that the tank runs "the nitrogen cycle a real fresh tank runs". The first statement is true of the CPU engine to within a fixed iteration budget. It is unverified for the default GPU engine. The second is a statement about how the demo is meant to look, not a measurement. No rates were fitted to aquarium data, and the Monod constant was tuned so the populations would survive.

The code does show that these ingredients can run together. The CPU projection comment is the most careful engineering on the page: it finds and fixes the odd/even decoupling that Chorin's 1968 stencil also faced. The `cpu.js:465` comment names an acceptance test, `tests/aquarium-engine.js`, with the criterion "mean |divergence| < 1e-3". That file does not exist in the tree at `d183990` (`tests/` holds only `engine.js` and `params.js`).

The convection plumes and nitrogen curves you see here are suggestive. They are not evidence of the physics they resemble. The simulation is correctly on the shelf.

## Further reading

- Spiegel & Veronis 1960: https://doi.org/10.1086/146849 (full text: https://articles.adsabs.harvard.edu/pdf/1960ApJ...131..442S)
- Chorin 1968: https://doi.org/10.1090/s0025-5718-1968-0242392-2 (full text: https://web.archive.org/web/2022id_/https://www.ams.org/journals/mcom/1968-22-104/S0025-5718-1968-0242392-2/S0025-5718-1968-0242392-2.pdf)
- Stam 1999: https://doi.org/10.1145/311535.311548 (author copy: https://www.dgp.toronto.edu/public_user/stam/reality/Research/pdf/ns.pdf)
- Monod 1949: https://doi.org/10.1146/annurev.mi.03.100149.002103 (not held)
