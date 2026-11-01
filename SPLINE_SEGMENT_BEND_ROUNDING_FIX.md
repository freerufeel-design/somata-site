# Somata 10.4.19.36 — Live spline segment-bend rounding fix

Based on `Somata_10.4.19.36_Spline_Terminal_Horns_Fix.zip`.

## Root cause

There were two independent issues in live Morph drawing:

1. The edge-local spline fillet steered its end controls toward the chord
   between cut points. In a Morph with changing N/K that chord can point away
   from the neighboring spline tangent. The earlier terminal-only correction
   was active only at 76–97% of the phase, leaving sharp joins elsewhere.
2. A fillet on unequal neighboring spans was trimmed on *both* sides by half
   the length of the *shorter* span. When a transient segment collapsed, its
   neighbor also lost almost its entire visible rounding radius.

## Change

- All live Morph spline fillets now use the incoming and outgoing tangents
  directly (G1 continuity at the constructed fillet boundary).
- For live Morph only, the two fillet shoulders are allowed to have independent
  lengths, limited by the geometric mean of the shorter and longer adjacent
  spans. This avoids both microscopic fillets and consuming half a long edge.
- Original authored Static spline paths and path behavior at zero rounding are
  unchanged. No anchor transport, phase interpolation, mode selection,
  spline-spiral transition or MonoRadius fitting logic was edited.

## Tests

- `tests/v10419-42-live-spline-segment-bends-regression.js`: 400 actual
  Chromium Canvas2D paths, covering four movement modes, five N/K pairs,
  four spline/segment source/target profile pairs and five phase positions.
  The worst measured spline join angle dropped from about 166 degrees to
  16.4 degrees; no tested join exceeded 30 degrees.
- `tests/v10419-42-asymmetric-short-spline-segment-fillet.js`: short-run/long-run
  asymmetry now has a measurable longer shoulder, while zero-rounding paths
  remain identical.
- Historical 168 anchor motion snapshots, MonoRadius primary circle and
  canvas endpoint tests, Circle Slide reference UI snapshots, Topo-Circle
  and Polygon boundary tests, mixed spline endpoint and old spiral tests pass.
- All JavaScript sources pass `node --check`.

## Limits

This tests the real Canvas2D path builder, not hardware WebGPU. The precise
preset from the user's screenshots is not available; severe geometric
self-intersections and nonuniform custom profiles might need separate work.
