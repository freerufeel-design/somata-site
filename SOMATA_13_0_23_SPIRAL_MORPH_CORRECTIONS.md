# Somata 13.0.23 — Morph spiral: semantic fixes

- Cyclic K limiter applies to **orbit traversal and suborbit topology** as well as to angular carrier, so 3/4 at L=2 are the same static geometries as 1/2.
- Morph target N and K are chosen according to their animation checkboxes in all five modes. A mode's `fix` controls **transport**, not the ability to choose a target value.
- Fixed N/K: fades N/K topology changes between stationary endpoint rails.
- Fixed N: N changes fade between two independent rails, each animating K.
- Fixed K: K changes fade between two independent rails, each animating N.
- Phase-circle: retains continuous branch mapping/splitting (where topology requires it).
- Torn: one-to-one pairing without cloning existing rays; unmatched paths are born or retire independently.
- Limiter with phaseCircle does not retain ghost boundary branches from earlier phases.

## Verification

- `node tests/v1323-five-modes-limiter.js`: N=20 with L=2, K=1..8; equality of repeated geometry and branch identifiers; 20 branches for non-fade K-only transitions; unique one-to-one Torn pairing.
- `node tests/v1323-animation-axis-modes.js`: Geometry > Animate, N-only and K-only edits in all five modes; required fade and angular animation paths; hybrid carrier checks at t=0, .25, .5, .75, 1 without overflow.
- On devices without the retained GPU edit rail, Fix N/K uses an opacity-based two-half fallback. For Fix N/Fix K, the unfixed axis is still interpolated in that fallback.
- Performance on a real hardware WebGPU device has not been measured.
