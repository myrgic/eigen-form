# Shelf idea: audio-driven physarum (operator, 2026-09-20)

Music drives the simulation's parameters; the visualization is the song made
visible on the quotient surfaces. Not scheduled — parked here.

## The shape of it

A track's live features become the declared knobs:

- **onset/beat** → deposition burst or agent-release pulse (the kick seeds
  the field)
- **RMS envelope** → global energy: dep/decay scale with loudness, so the
  chorus literally brightens the trails
- **spectral centroid** → noise scale (brightness of the field's texture)
- **bass energy** → drift rate (low end pushes the swarm)
- **section changes** (verse/chorus detected) → level changes — each section
  of the song IS a tour level

The natural instrument pairing: the slice scope / BPM plates from
welded_asteroids v2.6–v2.8 become the visualization's readouts — the song's
passage through the song is a steering-vector trace. A closed loop closing
on the downbeat of the locked chorus would be the money shot.

## Why it fits the lab

- The knobs already exist and are all declared with `meaning` (lab rule).
- `simStep()` (v2.5) is steppable and seeded — an audio clock can drive it.
- Hue-is-data holds: the song adds a second time axis (musical form) on top
  of the topology's (spatial structure).

## When picked up, first questions

1. Source of features: real-time mic/system audio, or pre-analyzed track
   (ffmpeg/aubio offline → JSON envelope the sim samples)?
2. Which app: welded_asteroids gains an audio panel, or a new app?
3. determinism: same track + same seed → same visualization? (probably yes
   — that's a feature: the song has a canonical rendering)
