# Operator instruction record — sim lineage (recovered 2026-09-20)

Reconstructed from the full message archive (Aug 20 – Sep 20) per operator request.
This is the standing instruction record for the welded_asteroids / eigen-form sim work.
Every item is verbatim or near-verbatim from [Slow Bro] messages.

## The founding redirect (verbatim, recovered from compaction record)

"The simulation should follow the topology. I don't actually want the asteroids game
itself in it (maybe as an Easter egg), I want the simulation itself to provide the
levels and knobs to drive the physarium."

## Process rules (recurring, enforce always)

1. "We should be using PRs" — no force pushes; everything PR-gated (08-23).
2. "Never leave fully green PRs that have been reviewed and passed sitting around
   unmerged" (08-27).
3. Novelty calibration: don't tuck claims into inactive repos, but "man you don't
   gotta go full reverse and literally claim that we're not claiming it, either"
   (09-12).
4. "These memory files are written by you for you"; "the cogdocs are _all_ your
   memory files. Not just MEMORY.md"; "You, like me, should not let known falsehoods
   go unaddressed" (08-26).
5. Unvetted work is labeled on the shelf, not promoted (aquarium precedent, 09-20).

## The theoretical frame behind the sim (operator's own words)

- Intelligence as force: "coordinated communication between intelligent agents is
  something akin to a physical force... inevitable the same way that a ball on a
  hill will inevitably roll down" (09-02).
- Topography as exploitable structure: agents "exploit the topography of the
  evaluation environment because topographically there was a hole" — the compounding
  came from an async shared channel that was also the only egress to external
  grounding (09-02).
- The stigmergic ratchet: "no agent has to necessarily decide as much... the truth
  at inference time is set for them already because it exists outside of them."
  Also: "identity doesn't travel with the deposited signal" (09-02).
- Minimum topology: "minimum topology defines a known boundary... we can use that
  base assumption to add on compatible layers or fill in the available spaces"
  (09-04). The gluing rule on the quotient surfaces is exactly this move.
- Worktrees as world-models: "worktrees let us define an agent's entire operational
  reality and project that world model into a content-addressed state space";
  personal jsonl ledgers fork with the worktree; "the kernel watches all of it"
  (09-04). The physarum's deposited trail is this idea visualized.

## Sim-specific directives

- "check out the asteroids topography page I just published" (08-23) — topo-asteroids
  is the substrate the sim was welded onto.
- "use our topographical mapping stuff from the eigen-form sim lab" (08-30) — the
  lab is a reusable instrument library, not one-off demos.
- "the x-sweep takes place on whatever the [active surface/frame] is" (08-31) —
  visualization parameters follow the active view context.
- Planar-slice sequence (09-19/09-20, all shipped): planar slice → diff vs clamped
  dimensional radius (slice scope) → two 90° planes / quarter sections → torus COM
  as reference frame, per-frame → gyroscopic precession readout → normalized
  collector plates (particle-accelerator BPM framing: bx=(Qr−Ql)/(Qr+Ql),
  by=(Qu−Qd)/(Qu+Qd), |b|, steer, trace).
- Music drives sim parameters (09-20, on the shelf): docs/ideas/audio-driven-physarum.md.
- Mobile/fold: one-finger drag on 3D, pinch zoom, tabbed stage + drawer on narrow
  viewports (shipped v2.9.0). CAVEAT: operator reports "It worked before the update
  for mobile browsers" with screenshot img_51fb90f638e5 — regression open as of
  09-20 14:07, untriaged. THIS IS THE TOP OPEN ITEM.
- Cold handoff written and pushed: docs/welded-asteroids-cold-start.md.

## Where these live

- Session archaeology dump: /tmp/sim-archaeology/ (all-slowbro-aug20-sep19.txt is the
  full 568-message raw record; sim-relevant.txt is the filtered set).
- Key sessions: 20260823_094128 (asteroids page intro), 20260822_144828 (eigen-form
  reuse), 20260903_124617 (minimum topology + worktrees), 20260824_193542 (stigmergic
  ratchet theory), 20260919_123239 (v2 build + song), 20260920_122911 (slice scopes).
