# Somata 10.4.19.36 — Rounded Segments↔Spline Morph

Incremental patch on top of Somata_10.4.19.36_Morph_Horns_Continuity_Fix.zip.

## Reproduced issue

In the live mixed Segments↔Spline Morph path, drawMorphSplineBlendPath interpolated cubic controls on a point carrier but broke the curve into independent runs at logical corners. It did not fillet those joins. At nonzero rounding it also applied a global triangular smoothing to all carrier knots. An 8/3 polygonal star with 80% rounding collapsed nearly to the center in a browser test, even when its endpoint Static spline remained large.

## Patch

- Edge-local spline Bézier controls accept a blend factor, using the same linear-to-centripetal handle interpolation over the existing carrier.
- When rounding >0, the live mixed-profile renderer constructs the blended edges and the fillets at logical corners in the SAME path. It no longer globally smooths away the moving anchors before creating the curve.
- Static, segment-only, pure spline, Fourier, Spiral and exact Topo-Circle paths retain their prior behavior.
- The phase timeline, transport of original and newly inserted anchors, movement modes and MonoRadius fitting are untouched.

## Browser regression

`node tests/v10419-40-rounded-mixed-spline-contours-regression.js`: 20 real browser profile paths at five blend values (100 cases): finite cubics, rounded joins, noncollapsed contours, exact Static spline command match at spline endpoint, distinct handle interpolation for multiknot profiles.

Other targeted tests: 168 historical anchor snapshots; 105 new-anchor transport samples + 35 Topo-Circle samples; MonoRadius fit test; rounded topology handoffs; 18 rounded linear Polygon Morph cases; 18 exact Topo-Circle phase handoffs; spiral spline seam; mixed profile midpoint; visible Polygon spline endpoints; historical exact-cubic tangent correction.

## Known scope

This is a focused fix for the rounded mixed-profile path. It does NOT prove that all sharp horns in a pure-spline-to-spline transition are removed: the exact original user screenshot lacks the associated saved source/target N, K, profile nodes and t. Hardware WebGPU was not verified.
