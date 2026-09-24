---
sim: ast_diffusion
title: AST Topological Convolution Kernel
subtitle: Heat injected into an import graph and pushed along its edges. The textbook object is the graph Laplacian; the code implements something else.
papers: [chung1997]
---
## The idea

A codebase can be drawn as a directed graph in which each file points to the files it imports. When one file changes, which others will need attention? The page offers a heat metaphor. Click a node to inject heat, "a Git merge" in the page's words. Then press *Step* and watch a "convolution kernel" spread that heat through the graph (`apps/ast_diffusion/index.html:34`). Heat that flows *against* the import arrows is labelled "fixing breaks". Heat that flows *with* them is labelled "priming context" (`index.html:37-46`).

The obvious mathematical model is diffusion on a graph, $\dot{\mathbf h}=-\mathcal L\mathbf h$. The lab registry links the page to that equation. This article explains that equation, what the page actually computes, and why the two differ in kind, not just in detail.

## The sources

### Chung (1997), *Spectral Graph Theory*

F. R. K. Chung, *Spectral Graph Theory*, CBMS Regional Conference Series in Mathematics 92, AMS (ISBN 0821803158). The registry cites **Chapter 10**, on the heat kernel of a graph. **We did not have Chapter 10.** We read only Chapter 1, "Eigenvalues and the Laplacian of a graph," in the author's free copy (21 pages). The definitions and quotations below come from Chapter 1. Nothing here says what Chapter 10 contains.

Chapter 1 defines the normalised Laplacian of an undirected graph with degree matrix $T$ and adjacency matrix $A$ (§1.2, pp. 2–3):

$$
\mathcal L = T^{-1/2}LT^{-1/2} = I - T^{-1/2}AT^{-1/2}, \qquad L = T - A .
$$

In §1.5 ("Eigenvalues and random walks," p. 15) it defines the transition matrix of the simple random walk, which moves from $v$ to each neighbour with probability $1/d_v$:

$$
P = T^{-1}A = T^{-1/2}(I-\mathcal L)\,T^{1/2}.
$$

The registry's operator $I-D^{-1}A$ is therefore $I-P$, the random-walk Laplacian. It is similar to Chung's $\mathcal L$ and has the same spectrum. The standard continuous-time heat flow on the graph is

$$
\frac{d\mathbf h}{dt}=-(I-D^{-1}A)\,\mathbf h ,
$$

with the heat kernel as its solution operator, $e^{-t\mathcal L}$ in Chung's normalisation. That is textbook background, not a quotation from Chapter 10. Two properties of this flow matter below. It is linear. And on a connected graph that is not bipartite it relaxes to a stationary distribution, whose convergence rate is controlled by the spectral gap $\lambda_1$ (Chapter 1, §1.5, pp. 14–15). Both of Chapter 1's objects are defined for **undirected** graphs: $\mathcal L$ is symmetric (p. 3), and the random walk is taken on a weighted graph with $w(u,v)=w(v,u)$ (p. 14).

We read the full text of Chapter 1 only.

## What the code does

All line numbers refer to commit `d183990`.

The graph is hard-coded: seven files and eight import edges (`index.html:63-84`). In-degree and out-degree are counted once (`index.html:86-92`). One click on *Step* runs a single discrete update (`index.html:165-204`). Write $h_v$ for the heat on node $v$, $\gamma$ for the decay slider (default 0.9), and $\alpha,\beta$ for the upstream and downstream sliders (defaults 0.6 and 0.1, `index.html:94`). For every edge $s\to t$ ($s$ imports $t$), the update is:

$$
h'_v = \gamma h_v
\;+\!\!\sum_{t\to\,\cdot\,:\,h_t>0.05}\!\!\pm\frac{\alpha\,h_t}{d^{\text{in}}_t}
\;+\!\!\sum_{s\to\,\cdot\,:\,h_s>0.05}\!\!\pm\frac{\beta\,h_s}{d^{\text{out}}_s},
\qquad h_v\leftarrow\max(0,h'_v).
$$

Each flow is subtracted from its origin and added to its destination. That is the "decay fix" recorded in `app.json`'s `changes[]` and implemented at `index.html:180-195`. The registry marks the fidelity **modified**. The d3 force layout is "purely for aesthetic rendering" (`index.html:146`) and plays no part in the dynamics.

## Where it departs from the source

- **It is directed and asymmetric.** Heat moves upstream at rate $\alpha$ normalised by the in-degree of the node it leaves, and downstream at rate $\beta$ normalised by that node's out-degree (`index.html:184-195`; registry deviation). Chung's Laplacian is symmetric and defined for undirected graphs (p. 3). There is no stationary distribution in the Chapter 1 sense to converge to.
- **It is nonlinear.** A node passes heat only while $h>0.05$ (`index.html:184`, `191`). Below that threshold it stops dead, so small heat never spreads. Heat flow on a graph is a linear map.
- **Global decay runs first.** Every node is multiplied by $\gamma$ before any transfer happens (`index.html:168-171`; registry deviation). The heat equation has no sink, so there total heat stays constant.
- **It takes one explicit step, not a flow.** Each click applies one discrete map. Nothing represents continuous time or a step size.
- **Normalisation is per edge, so a node can overdraw.** Each edge takes $\alpha h_t/d^{\text{in}}_t$ from the node it leaves, and a node can lose on both upstream and downstream edges in the same step. In total a node can give away more than it holds. The negative excess is then set to zero by the clamp at `index.html:200`. The clamp **creates heat**: it throws away the negative part of a node that went below zero, and that heat has already been credited to the neighbours. We checked this with a line-for-line Node replica of `index.html:165-201`, heat 5 injected on `auth.ts`:
  - At the defaults (0.6, 0.1, 0.9), the clamp never fires and total heat falls exactly as $0.9^k$ (4.5, 4.05, 3.645, …). This agrees with the `app.json` note that total heat "provably shrinks … once deposits stop". At these settings the update is mass-conserving.
  - At $\alpha=\beta=1$ with decay 0.5, total heat rises 5 → 10 → 20 → 28.75 → 57.5 → 81.9 → 163.8 over six steps.
  - At $\alpha=0.9$, $\beta=0.3$ with decay 0.9 it rises to 7.2 before decaying.

  All of these settings are within the sliders' ranges (`index.html:38-50`). So the conservation claim holds at the defaults but not across the whole control space. The registry's statement that the update is "mass-conservative per transfer" is true of each transfer on its own, but not of the step as a whole.
- **Degrees can be zero.** `app.ts` and `server.ts` have in-degree 0, and `utils.ts` has out-degree 0. The code falls back to a divisor of 1 (`index.html:185`, `192`), but on those nodes the edges that would use it do not exist.

## What it shows, and what it doesn't

The page has no embedded cogdoc and makes no formal claim. The registry lists `claim: null`, tier `demo`, state `frozen-golden`. It does carry an interpretation in its UI text: upstream flow means "fixing breaks", downstream flow means "priming context". Nothing on the page tests that interpretation. The graph is a seven-node toy invented for the page, not an actual codebase. Heat enters only through clicks. Nothing compares the resulting heat map with what engineers later touched.

The page shows how an asymmetric, thresholded message-passing rule behaves on a small DAG, and it shows that the "decay fix" brought the defaults back to geometric decay. It does not show that this rule, or graph heat flow in general, predicts anything about how a codebase changes. The lab later tested that question on real history in `commit_field`, whose cogdoc lists `app:ast_diffusion` with the relation `tests` (`apps/commit_field/index.html:98-99`). There, one hop of undirected co-change diffusion did not beat plain recency (field 0.1024 against recency 0.1029 mean reciprocal rank). The simpler model accounted for the whole signal.

The word "convolution" in the title is used loosely, in the graph-neural-network sense of one step of neighbourhood aggregation. It does not refer to a convolution operator from Chung. Treat the page as an illustration of a metaphor, and read the null result in commit_field as its test.

## Further reading

- Chung 1997, *Spectral Graph Theory* (AMS, ISBN 0821803158). No DOI is recorded in the registry. Chapter 1 author copy: https://mathweb.ucsd.edu/~fan/research/cb/ch1.pdf
- For the heat kernel itself, see Chung's Chapter 10, which we did not hold.
