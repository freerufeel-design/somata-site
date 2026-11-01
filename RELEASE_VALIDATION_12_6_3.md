# Somata 12.6.3 — Spline+ Only: validation

## Scope

- Base: **Somata 12.6.2 — Phase-Seam-Stable Splines (golden benchmark)**. The approved 12.6.2 archive and folder remain unmodified.
- **Only rounding algorithm: Spline+** (`roundingShape: 'hybrid'`). The retired `spline` / `contour` algorithms and their UI selectors are removed from the active application. Unused alternative cubic spline builder was removed from `spline-corner-mode.js`.
- **No changes** to the `somataDrawRadialSplineRounding` golden geometric kernel, Morph vertex transport, point mapping, or phase clock. The core kernel starting with `function somataDrawRadialSplineRounding` is byte-identical to 12.6.2.
- The **standard / monoradius** radius-policy selector is retained; it is not a separate rounding algorithm.
- Removed contour-only radius-drop, smooth-existing-splines, spline-density and polynomial-sweep experimental UI controls and handlers. Historical fallback code for unrelated special rendering paths is retained rather than risk altering approved animation semantics.
- All project/figure imports and presets normalize legacy `roundingShape` values to `hybrid`; runtime paths also render the approved Spline+ rail regardless of a stale cached legacy value.

## Tests executed

| Test | Result |
| --- | --- |
| `node tests/v1263-golden-spline-plus-parity.js` | **PASS**: **2,160** exact configurations; **116,664** command records exactly equal to the self-contained 12.6.2 golden fixture. Shapes include stars, circles, waves, open/closed and 0/100/200% boundaries. |
| `node tests/v1263-only-spline-plus-browser.js` | **PASS**: no retired shape controls; `Spline+` label; standard/monoradius buttons preserved; legacy `.spiroshape` and saved project modes migrated; active Morph slider values 25/50/100/150/200 propagate to frame snapshots with unchanged phase start. |
| `node tests/v1262-cyclic-reindex-geometry-regression.js` | **PASS**: 540 phase-seam reindex cases, 84 adjacent states; maximum cyclic parity error ~4.75e-12. |
| `node tests/v1262-visible-phase-seam-browser-regression.js` | **PASS**: 210 browser comparisons; worst mean alpha delta ~0.0556. |
| `node tests/v1261-corner-not-circle-geometry-regression.js` | **PASS**: 576 cases, 95,700 joints, 9,600 near-phase frames. |
| `node tests/v1260-radial-spline-geometry-regression.js` | **PASS**: 468 cases, 37,336 joints, 75,140 tangency probes. |
| `node tests/v1260-winding-flip-phase-continuity.js` | **PASS**: self-crossing winding-sign transition. |
| `node tests/v1106-fillet-phase-stability-regression.js` | **PASS**: 351 cases. |
| `node tests/v1114-partial-activation-tangent-regression.js` | **PASS**: 2,304 cubic join checks. |
| `node tests/v1107-k2-spiral-phase-browser-regression.js` | **PASS**: 24 cases. |
| `node tests/v1108-real-spiral-phase-regression.js` | **PASS**: 8 real spiral routes × 21 phase samples. |
| `node tests/v1113-real-open-spiral-browser-regression.js` | **PASS**: 60 open-spiral scenarios. |
| `node tests/v1114-live-morph-tangent-browser-regression.js` | **PASS**: 120 browser tangent comparisons. |
| `node tests/v10419-38-monoradius-primary-circle-fit.js` | **PASS**: 144 static + 432 Morph + 6 prepared checks. |

Historical UI tests explicitly checking for the now-retired mode buttons are retained for release history but are no longer applicable to the single-mode interface. No new whole-app FPS measurement was performed; the approved Spline+ geometry algorithm is unchanged.

## Known limitations

Spline+ remains a shape-changing display-only overlay; visually complex self-crossing inputs can still cross. A test run does not prove zero artifacts for every possible saved project or GPU driver. Full WebGPU hardware testing was not performed.
