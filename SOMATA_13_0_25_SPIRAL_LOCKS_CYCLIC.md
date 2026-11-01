# Somata 13.0.25 — Morph-only locks, Animation-only fade, cyclic K/N transport

- Blue Morph locks **N and K** for continuous; **N** for phase; **K** for minimalTurn. Target generator and post-coverage routing respect these locks, so no change to locked axes is committed by the phase.
- Geometry > Animation is deliberately separate: these edits are accepted; fixed axes cross-fade between exact geometries. The local selector inherits the global Spiral slide type until explicitly overridden locally.
- Spiral cyclic K: render-only effective endpoint K is linearly transported between consecutive phases. A reducing N cannot cause interpolation through raw K=4,5,6,... and spawn multiple extra apparent revolutions. Corridor and GPU use the same effective interpolant.
- Under enabled cyclic K limiter, the phase-circle N-change correspondence becomes a one-to-one minimum displacement map, with unmatched rays fading, not clone-multiplying. Uncapped phase-circle retains its normal clone/merge.
- CPU-level and syntax validation done; final WebGPU on user hardware remains unverified.
