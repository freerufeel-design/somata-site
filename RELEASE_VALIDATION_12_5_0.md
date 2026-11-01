# Somata 12.5.0 — Unified Spline Rounding: release validation

## Purpose and reference sources

Two user-provided archives were reviewed: `Somata_11.0.4_Bounded_Fillets_Phase_Parity.zip` (fast historic reference) and `Somata_12.0.0_Approved_Smooth_Morph.zip` (approved phase-smooth geometry). The direct implementation base is the complete, previously tested `Somata_12.4.1_Rounding_Mode_And_Strength_Fix.zip` with the 12.0 Morph phase core already integrated. Nothing is taken wholesale from the obsolete 11.0.4 transport or phase controller.

## Architecture

- **Unified / Единое** (`roundingShape=hybrid`) is the default for newly created layers. It generates one cubic Bézier segment per source edge, with a single display-only tangent direction per shared knot. There is no per-edge spline tessellation before calculating this display path.
- Its physical smoothing shoulder is **0.5 of one edge of the authored base polygon at 100%** (base radius = `radius*radiusMultiplier`, `N` vertices, with data-derived fallback only for missing radius). For dense authored spline sampling, probes use two monotone arc-station cursors; this prevents the strength slider becoming inert on subpixel-spaced intermediate vertices.
- Both positive-strength joins and high-strength circle interpolation have one agreed tangent. For pre-existing splines, a smooth small-strength control-point alignment is used to prevent an instantaneous snap away from the 0% native path.
- The guard enforces max drop of the exterior knot radius, by default **30%**, using uniform scaling of the display rail. It does NOT stop a concave/intentional inner line passing through the centre. This guard is not an exact bound on every intermediate Bézier point.
- Above 100% a closed fully smoothed path progressively approaches the original exterior circumcircle. At exactly 200%, dense, reasonably uniform contours can be drawn as **16 exact arc-approximation Bézier cubics**; sparse or highly nonuniform contours retain their continuously parameterized n-segment circle representation. Open paths do not close: their smoothing reach continues to grow above 100% instead.
- Old **Сплайновое** and **Контурное** remain as individually selectable comparison/fallback methods. `js/geometry/unified-fillet.js` and `js/geometry/morph.js` remain byte-identical to the immediate 12.4.1 base; point matching, phase clock, actual Morph vertex transport and mathematical contour fillet are untouched.
- Changing `roundingShape`, `rounding` or the radius-drop limit in ordinary active Blue Morph now updates live prepared display layers and source/target rounding metadata instead of calling `rebaseMorphCycle()` (which restarts the phase). MonoRadius changes may still require an automatic rebase because the normalization is baked into prepared geometry; this is an acknowledged limitation.
- Variable-width spiral display (both native cubic and sampled Canvas routes) now receives the selected layer's rounding algorithm. This is display only; retained spiral transportation is unchanged.

## Reproducible checks

Run from the project root, with Node.js 22 and `/usr/bin/chromium`:

```sh
node tests/v1250-unified-tangent-and-radius-regression.js
node tests/v1250-live-panel-without-morph-restart-browser.js
node tests/v1250-three-modes-real-render-browser.js
node tests/v1250-speed-and-200-browser-regression.js
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
```

New tests verified: **352** strong/weak/over-100%-strength unified geometries, **66,744** tangent-compatible G1 joins (at the tested strengths >=15%), **192** sampled exterior-radius bounds, visibly different output in the 20/50/100/150/200% real-renderer cases for each algorithm, 3-way UI selection, 12.5 panel changes **without resetting `cycleStart`**, and 200% dense shape shortcut (512 cubics -> 16) with near-200% and 200% respective max radial errors ~1.3e-10 and 9.3e-6 in the tested shape.

Prior verified regressions: 900 stochastic unified-fillet frames, 351 phase/rounding comparisons, 2,304 live G1 joints, 3,462 fractional-weight G1 joints, 24 N4/K2 boundary browser cases, 60 real open spiral browser cases, 120 real live Morph tangent checks, 8 real spiral carrier scenarios ×21 samples, MonoRadius primary circle fit. The legacy 12.4 `v1240-dual-spline-browser-regression.js` was updated to expect **three choices/default hybrid** rather than its historical 2/default spline; the two old methods' outputs were preserved.

## Performance (local geometry calculation only, headless Chromium, timing varies)

| Vertices | Unified | Contour | Scope |
|---:|---:|---:|---|
| 300 | approximately 0.6 ms | approximately 1.6 ms | single closed wave |
| 1,500 | approximately 1.1 ms | approximately 4.5 ms | single closed wave |
| 3,000 | approximately 1.7 ms | approximately 17.4 ms | single closed wave |

Numbers are medians from one CPU microbenchmark of curve construction, **NOT measured overall FPS, GPU time or end-user device performance**. On very small simple profiles the lighter historic spline can be faster than Unified. 200% uniformly sampled closed profiles use only 16 cubics.

## Limits and risks

- **Not byte-identical to Somata 12.0.0**: Unified is a distinct visible shape and the 12.0 contour method remains selectable for artistic comparison. The 0% path is the original native profile; it can therefore be sharp. Between 0% and low positive rounding the renderer blends native spline controls towards aligned handles; exact G1 is not claimed below the tested 15% threshold.
- G1 is verified at selected joins and phases, not strict G2 curvature continuity or absence of extrema/cusps inside every possible cubic. The exterior-radius guard samples knots; full continuous-cubic envelope constraints are not proven.
- Active Morph updates for **MonoRadius** still trigger the legacy normalization rebase; non-MonoRadius changes keep the current phase. The same is true of structural/shape-changing controls, which are not part of this display-only optimisation.
- Self-intersecting polygons, highly degenerate profiles, rotations of the chosen starting index on closed contours and extremely large zoom levels may have visual discrepancies. Native WebGPU hardware and user-facing full-scene FPS have not been measured.
