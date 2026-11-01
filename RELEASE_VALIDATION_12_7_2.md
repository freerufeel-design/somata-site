# Somata 12.7.2 — release validation and limitations

## User report

A sharp target figure was seen at a phase end, followed by a newly rounded
shape immediately at the next phase start. The 12.7.1 terminal taper reduced
discontinuity at epsilon but continued to mix an independently rebuilt live
rounded Spline+ rail with the saved endpoint rail. The static target was also
built using paired Morph spline samples instead of the raw authored target
profile knots in some modes. Consequently the geometry at intermediate times
was not an interpolation of two stable static endpoints.

## Change

- `js/app/ui-project-runtime.js`: for Spiral source/target phase endpoint
  snapshots, use authored raw profile points and mark these endpoints **not**
  presampled. An exact previous-frame terminal rail still takes precedence at
  phase handoff. Polygon and authored project state are unchanged.
- `js/gpu/spiral-bezier-morph-renderer.js`: use the existing paired and exact
  subdivided Bézier endpoint rails for ordinary retained Spiral Blue Morph,
  bypassing the mid-phase live Spline+ rebuild. Use smoothstep for movement of
  Bézier controls and time-matched carrier frame closure. Auxiliary static-edit
  preparation is intentionally unaffected. Does not change mathematical
  Static Spline+ rounding builder.
- `tests/v1272-static-target-strict-endpoint-regression.js`: real UI click,
  four phases with changing N/K and Shape, static target built independently,
  exact handoff, no live rebuild, and near-boundary checks.
- `tests/v1266-live-profile-single-prep-regression.js`: retains original exact
  12.6.5 hashes for old live branch, adds a *separate* exact deterministic
  hash contract for 12.7.2 locked branch. New locked branch does zero live
  per-frame Spline+ preparations rather than the previous six.

## Observations on software Chromium

- Static target rebuilt twice gives identical pixels in four tested phases.
- Morph target vs independently static target: 0 pixels belonging to one
  contour were outside a 2px neighborhood of the other (four phases).
- Bitmap antialias coverage can differ when one Bézier curve is subdivided
  into more segments, with measured relative alpha differences 0 / 0 /
  3.07 / 5.11. These are NOT contour displacements or rotation degrees.
- Last completed phase terminal snapshot and new first phase: zero raster
  difference on tested boundaries. Five boundary near-epsilon tests PASS,
  three layers and fourteen phase soak PASS, no exponential cubic growth.
- Baseline v1266 hash snapshots of the *intermediate* old algorithm are
  deliberately changed; the approved static Spline+ 12.6.3 golden 2160
  configurations / 116664 commands remain untouched and PASS.

## Tests already run on the patched working build

PASS: v1272-static-target-strict-endpoint-regression,
v1271-live-spline-tip-boundary-continuity-regression,
v1271-three-layer-near-boundary-continuity-regression,
v1270-exact-terminal-spiral-phase-regression,
v1270-three-layer-exact-handoff-regression,
v1270-topology-spline-rotation-seam-regression,
v1270-calm-spline-rotation-seam-regression,
v1270-soak-phase-cubic-budget-regression,
v1266-live-profile-single-prep-regression (updated contract),
v1269-spiral-fill-cyclic-band-seam-regression,
v1263-only-spline-plus-browser,
v1263-golden-spline-plus-parity,
v9212-spiral-phase-finish-no-jump.

## Not certified

- Full NVIDIA physical WebGPU output, all stochastic Shape/N/K combinations,
  intermittent fallback frames, and absolute pixel-perfect equivalence.
- A formal C1 speed/velocity proof for *all* asynchronous Morph transitions.
- Static Spline+ corner fairness/uniform curvature: not changed. A screenshot
  could reveal curve-quality issues in the static target even while the
  handoff is mathematically exact.
- 60 FPS with three spirals on the user's GPU. No hardware measurement.
