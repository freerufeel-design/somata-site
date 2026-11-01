# Somata 12.6.0 — Radial Spline Rounding: verification

## Design contract

Directly derived from Somata 12.5.0. The **default `hybrid` display mode**, now labeled **«Радиальный»**, has an entirely new O(n) radial cubic spline, without the old perimeter-wide corner accumulation, neighbour-radius limiter, or per-corner clipping. It takes *current* Morph vertices and does not modify geometry point matching, morphology phase controller or spiral motion. Existing legacy `spline` and `contour` modes are still available, and the old `unified-fillet.js` remains unchanged.

- **0%:** input polyline, exact original vertices and edges (the straight-edge display contract).
- **0–200%:** smooth cosine position weight `0.5*(1-cos(pi * percent / 200))`. `100%` is exactly halfway between original display knots and the circular target. The target is constructed using contour arc-length stations, retaining the original vertex correspondence.
- **Any positive setting:** every nondegenerate cubic knot has a shared geometric tangent perpendicular to the current local centre-to-knot radius. Cubics are directly generated between adjacent knots; at the origin the radial direction is undefined and a fallback is used. The small-positive-strength limit approaches the exact 0% polyline continuously, although it cannot remain G1 at precisely 0% because original corners are sharp by design.
- **200% closed:** a near-circle, with 16 cubic segments used only for well-distributed high-density closed contours. Open paths remain open and gain extra curvature; they cannot become complete circles while preserving open topology.
- The max external radius drop parameter is intentionally **ignored/hidden** for Radial and retains meaning for old Contour only.
- The circular target uses a fixed positive index traversal. A target traversal based on the signed polygon area caused a 165-unit teleport when a crossing-star Morph reversed its signed area. The fixed traversal removes this discontinuity. Clockwise shapes can temporarily unwind toward the canonical circle as they round.
- Active ordinary Morph input updates its `renderSourceLayers`/`renderTargetLayers` and preserves the existing `cycleStart` (no manual restart). The pre-existing MonoRadius normalization may still require its automatic rebase on some changes.

## Reproducible checks (Node.js 22 + Chromium)

```
node tests/v1260-radial-spline-geometry-regression.js
node tests/v1260-winding-flip-phase-continuity.js
node tests/v1260-live-radial-slider-browser-regression.js
node tests/v1250-live-panel-without-morph-restart-browser.js
node tests/v1250-three-modes-real-render-browser.js
node tests/v1250-speed-and-200-browser-regression.js
node tests/v1250-unified-tangent-and-radius-regression.js
node tests/v1240-dual-spline-geometry-regression.js
node tests/v1240-dual-spline-browser-regression.js
node tests/v1241-density-and-phase-spline-regression.js
node tests/v1241-static-render-spline-slider-browser-regression.js
node tests/v1105-unified-fillet-overlay-regression.js
node tests/v1106-fillet-phase-stability-regression.js
node tests/v1114-partial-activation-tangent-regression.js
node tests/v1124-fractional-fillet-g1-regression.js
node tests/v1107-k2-spiral-phase-browser-regression.js
node tests/v1113-real-open-spiral-browser-regression.js
node tests/v1114-live-morph-tangent-browser-regression.js
node tests/v1108-real-spiral-phase-regression.js
node tests/v10419-38-monoradius-primary-circle-fit.js
node tests/v1124-live-corner-angle-continuity.js
```

## Results

- 468 radial shapes, 37,336 G1-aligned joints and 75,140 checked radial-perpendicular control tangents; first positive rounding keeps its radial derivative consistent. Twelve strength values and two winding patterns were covered.
- Ten stress samples near an **actual signed-area reversal**: maximum consecutive near-frame control-coordinate change ~0.0000785 (compared to ~165 before stabilizing traversal). This also checks that changing max-radius-drop 0% to 90% has **no effect** in Radial mode.
- In the real browser renderer, a 9-edge crossing-star shape used 8 `lineTo` and 0 cubics at 0%, and 9 cubics at 10/35/65/100/150/200%. Every step produced visibly distinct control geometry. Browser UI modified active Morph at 20/50/100/150/200% with exactly unchanged `cycleStart`; live source and destination snapshots updated to the selected rounding.
- 200% dense closed 512-knot shape used 16 Bézier cubics rather than 512. Radial geometry discrepancy near 200% in this particular wave was approximately 3.4e-11, and at 200% approximately 9.3e-6. A 3000-vertex wave in one headless-Chromium microbenchmark: radial ~0.4–0.6 ms; legacy spline ~2.25–2.35 ms; contour ~15.5–15.85 ms. These are **CPU geometry times, not frame rendering time or FPS**, and depend on device and input shape.
- Prior proven fillet regressions: 900 stochastic frames, 351 phase / rounding comparisons, 2304 G1 joins, 3462 fractional-corner G1 joins, 24 N4/K2 phase cases, 60 open-spiral cases, 120 live Morph tangent tests, eight full spiral scenarios × 21 frames. MonoRadius primary fit and real static slider tests passed.

## Deliberate limits

- The radial spline is a **new visible shape**; it is not pointwise equal to the approved contour renderer in Somata 12.0.0. Use old Contour mode for strict appearance comparison.
- G1 alignment at shared knots does not imply G2 curvature continuity or preclude geometrical self-intersection elsewhere, particularly for extremely crossed stars and profiles containing multiple centre crossings.
- If a vertex coincides with the contour centre, its radius has no unique perpendicular; a fallback circle-station direction is used. Near this degenerate case, unusually large tangent changes remain possible.
- Canonical counterclockwise circular correspondence avoids abrupt signed-area flips but can lead to unusual intermediate trajectories for clockwise/self-intersecting input; it never rearranges the actual Morph vertex order.
- Full-scene FPS, native GPU and all end-user interaction contexts have not been measured. Previous 12.0 and 12.5 releases are left untouched.
