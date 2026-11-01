# Somata 10.4.19.36 — live Morph horn / tangent continuity patch

Incremental patch over `Somata_10.4.19.36_Morph_Horns_Mode_Safe_Fix.zip`.

## Why previous fix was not enough

The preceding patch prevented some newly inserted flat-profile anchors from starting at a duplicated vertex. It did **not** prevent two separate *rendering* failures:

1. During flat-segment topology changes, `roundPolylineForDraw` trimmed both sides of a rounded corner by the **shorter** of the two adjacent corner-to-corner spans. When a newly created/closing edge becomes short, the entire rounded fillet abruptly contracts. This patch permits each side to trim by up to one half **of its own span**. It is opt-in only for non-spiral flat segment N/K/suborbit transitions in the anchor Morph renderer; the old Static, spline and authored profile rendering is retained. The optional flag carries through >100% rounding recursion.
2. The experimental Topo-Circle exact-cubic renderer interpolated the handles of endpoint curves independently. Although both endpoint curves were smooth, the intermediate pair of tangent directions could diverge >100 degrees, producing a sharp tip. A separate **render-only G1 tangent alignment** now adjusts neighboring cubic handles at each joined knot, preserving every interpolated cubic endpoint and both individual handle magnitudes. Used for rounded Topo-Circle, non-Spiral profiles; it is not used to remap the anchor transport.

## Original motion and constraints

- The Topology and Calm reference movement and phase timing have not been changed.
- Circle Slide's angular motion remains angular.
- Topo-Circle still uses its own exact Bézier interpolation; its adjacent handles now meet with consistent tangent directions in rounded transitions.
- Existing anchor count/indices, matching, source/target, and N/K routes are not rewritten by this patch.
- MonoRadius fits the rendered geometry after curve construction, as in the preceding archive.
- Spiral motion/rounding construction is not modified.

## Tested with actual Chromium Canvas2D runtime

- `node tests/v10419-36-live-horn-fillet-regression.js`: 20 rounded Topo-Circle live scenarios, no seam angles >30 degrees (old maximum 114 degrees), identical cubic endpoints, near-degenerate asymmetric corner check.
- `node tests/v10419-36-new-anchor-horns-regression.js`: 105 anchor transport and 35 Topo-Circle samples.
- `node tests/v10481-preserve-morph-anchor-motion.js`: 168 reference point-transport snapshots unchanged.
- `node tests/v10460-topology-calm-v19-anchor-drawing-regression.js`: reference unrounded, spline and previously updated rounded contour traces unchanged for the test cases.
- `node tests/v10457-topocircle-mode-legacy-seam-regression.js`: mode identity, clocks and prior topology guards.
- `node tests/v10419-38-monoradius-primary-circle-fit.js`: static + 432 live MonoRadius fit checks.
- Other targeted MonoRadius, rounded profile, N/K, Spiral and boundary regression tests run successfully.

## Not verified

- The exact uploaded green image's source/target N/K, progress value, chosen Morph mode and profile nodes are unknown, so the exact pictured frame has not been replicated from its source configuration.
- Physical WebGPU hardware path has not been exercised.
- This patch does not guarantee that every complex custom profile/self-crossing interpolated curve is free of all acute features. It removes **two verified rendering causes** of sharp tips without rewriting mode-specific geometric motion.
