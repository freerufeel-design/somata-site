# Somata 10.4.19.36 — Late-phase spline horn / tangent continuity patch

Base: `Somata_10.4.19.36_Spline_Rounding_Mixed_Morph_Fix.zip`.

## Root cause

The edge-local spline fillet builder rotates a Bézier's incoming and outgoing
end tangents toward the chord between fillet endpoints. When a temporary edge
contracts during Morph, that corrective rotation can oppose the actual
neighboring cubic tangent, producing a very sharp seam near the end of a phase.
A browser reproducer changing Polygon N/K 13/3 → 10/2 with spline profiles
measured an approximately 163-degree cusp at phase t=0.9.

## Fix

- `splinePathForDraw` / `appendLocalSplineFillet` now accept an **opt-in**
  live-Morph tangent blend. At full strength the fillet exactly follows the
  neighboring cubic's measured tangent instead of reorienting toward its chord.
- The live render helper smoothly enables this correction from 76% to 81% of
  the phase, then smoothly returns to the Static endpoint path from 97% to 100%.
  This is **not** a cross-fade between contours, nor a remapping of vertices.
- The static renderer, start/end authored contours and non-Morph calls continue
  to use their original tangent handling.
- No changes to Morph vertex trajectories, path pairing, Topology/Calm,
  Circle Slide, Topo-Circle, Spiral, phase clock, or MonoRadius radius fitting.

## Checks

- `tests/v10419-41-terminal-spline-horn-continuity-regression.js`:
  96 geometry/mode/profile combinations × 5 late-phase positions = 480
  actual Chromium path traces; no measured tangent discontinuity >80°.
  The previous renderer had 6 problematic combinations on this grid.
- Existing rounded mixed spline test: 100 traces pass.
- Existing MonoRadius test: 144 static and 432 live states pass.
- Existing terminal spline curve and profile timing tests pass.
- Original vertex transport: 168 reference snapshots remain identical.
- All JavaScript syntax checks pass.

## Scope and open items

- The exact screenshot configuration is unknown: this fix addresses a
  reproduced equivalent mechanism but is not a guarantee for all user presets.
- The earlier `v10460-topology-calm-v19-anchor-drawing-regression.js` contains
  a spline trace hash that already fails on the unmodified base archive; this
  same pre-existing mismatch remains (the patch did not add it).
- Real hardware WebGPU and complex self-crossing custom spline profiles have
  not been exhaustively tested.
