# Somata 10.4.19.36 — guarded Morph new-anchor / rounding correction

Based on `Somata_10.4.19.36_Monoradius_Base_Circle_Fix.zip`.

## Narrow scope

- **Only the inserted/deleted vertex slots** in polygon transport plans with changing angular-anchor counts get an edge-birth/death correction. Old slots continue with their existing per-mode trajectories.
- For `linear` transport (Topology / Calm), an inserted slot is introduced on the original polygon's straight edge and a disappearing slot ends on the destination edge.
- For `angular` transport (Circle Slide), inserted/deleted slots are distributed along the corresponding **circle arc**; their distance from the primary center remains equal to the current radius. This does not swap Circle Slide for linear movement.
- The correction is used only when both source and destination are **straight, flat segment profiles**. Complex authored profiles and Spiral paths do not use the new slot correction.
- Rounded segment contours with authored logical corners are passed to the same corner fillet solver as static rendering, without a separate global spline substitution. Mono Radius continues to be applied to the drawn path.
- Topo-Circle's separate **exact-cubic renderer** and all Spiral transport modes are left unchanged.
- No keyframe timing, orbit mapping, source/target modes, GPU shader code, or animation clocks were changed.

## Reproduction / validation

Headless Chromium executes the real browser scripts (not a separate approximated math implementation). New browser regression:

`node tests/v10419-36-new-anchor-horns-regression.js`

Validation completed on Canvas2D:

- 105 transport samples with tests for stable old vertex movement, straight-edge births/deaths (linear), constant-radius arc births/deaths (angular); 35 additional Topo-Circle samples use the original independent exact-cubic route.
- 168 existing profile/rounding/mode/movement-time anchor snapshots match their original reference.
- Existing Mono Radius Canvas2D endpoints, 144 static and 432 animated fits, rounded segment parity, N/K suborbits, Spiral/Blue Morph and UI timing tests passed.
- A legacy `v880-exact-morph-gpu-data-regression.js` 8.7.0 GPU-buffer hash test **does not pass in the original input archive either** and therefore cannot be used to claim new regression or GPU coverage.

## Known limitations

- Actual GPU/WebGPU hardware rendering has **not** been validated.
- This is not a global rewrite of all edge cases: non-flat custom profiles and Topo-Circle's independent exact-cubic path may still require separate work if the artifacts occur there.
- 6% endpoint display handoff is inherited from the input archive and remains unchanged.
