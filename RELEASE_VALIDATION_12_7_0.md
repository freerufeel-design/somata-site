# Somata 12.7.0 — exact phase-start rail validation

## Symptom, cause, scope

On 12.6.9 the final and next initial Morph layer could have identical authored N/K/rotation/profile nodes but different rendered rail branch pairing (e.g. 9 prepared branches with invisible clones vs 7 newly prepared branches). Thus previous phase t=1 and next phase t=0 did not agree in raster space. Morph rotation was not the cause.

## Minimal patch

- At the completed phase boundary (`commitFullMorphTargetAtBoundary`) capture each Spiral layer's *actual terminal* prepared Bézier cubics and branch visibility. Prefer a matching retained GPU resource; fall back to preparing the CPU rail only if not present.
- The boundary callback synchronously commits and prepares the next cycle. Accept the one-shot terminal snapshot for the same layer id instead of rejecting it by re-paired profile-node equality. Independent UI edits cannot occur between these two operations.
- In `buildLayerCpuResource`, use previous terminal rails as the next phase's source and retain ghost-branch alpha. When new correspondence needs additional cubic slots, append degenerate source cubics without re-tessellating any old rendered cubic. The next destination still uses the original exact target-rail builder.
- For carried live rounded splines, size the extra target-side budget once rather than add 20% of the carried source on every cycle. Non-carried/new-cycle geometry retains the original segment budget.
- No change to authored shape trajectories, phase clocks, rotation, N/K policy, Spline+ itself, or Fill band pairing.

## Executed checks on unpacked working copy

| Check | Result |
| --- | --- |
| Strict single layer, five real Blue UI Morph seams | PASS, alpha delta **0,0,0,0,0** |
| Strict three layers, three real Blue UI Morph seams each | PASS, nine alpha deltas **0** |
| Sequential 14-phase C0 soak | PASS, 14 deltas **0**, packed cubic count plateaued at 1157 in test seed |
| Topology with Spline+ and rotation enabled | PASS, 3 deltas **0** |
| Calm with Spline+ and rotation enabled | PASS, 3 deltas **0** |
| v1263 golden Spline+ parity | PASS |
| v1264 retained GPU cubic carrier browser | PASS |
| v1265 exact spiral fast parity | PASS |
| v1269 Fill band angular seam / Corridor | PASS |
| v10452 Fill toggle phase continuity | PASS |
| v10447 spline-seam live Morph parity | PASS |
| v110 authored endpoint transitions | PASS |
| Static modules and browser preflight | PASS |

## Acceptance boundary / what is NOT certified

- The tests validate prepared Bézier commands, visible branch alphas and software-rasterized C0 snapshots. **A physical NVIDIA/WebGPU screenshot is still required** for the final visual verdict; GPU tangent repair and closure passes may introduce differences not captured by software tests.
- C0 continuity (same position and contour at the seam) does not automatically prove C1 continuity (same speed/tangent of the time-dependent contour). This patch fixes endpoint **identity**, not a new time-continuous morph clock.
- Mixed Spiral↔Polygon paths, all possible effect combinations, and sustained three-layer NVIDIA FPS are not yet certified. This is a targeted bug fix, not an FPS promise.
