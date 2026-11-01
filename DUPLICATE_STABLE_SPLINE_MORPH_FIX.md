# Somata 12.7.2 — Duplicate-stable Spline+ Morph (scoped experiment)

## Problem

When a Morph phase gains or loses topological slots, the correspondence
planner may output two or more consecutive vertices in the same position.
Although the physical outline and rounding parameters are unchanged,
Spline+ computes a knot tangent from the *two array neighbors*. Inserting a
zero-length slot therefore changes adjacent cubic Bézier control handles by a
finite amount. At an open endpoint a second error exists: the true endpoint is
pinned, while a coincident inserted *interior* knot is rounded away from it.

## Change

- `js/geometry/spline-corner-mode.js`: added two small O(N) display-only guards
  for groups of extremely short neighboring edges. One aligns the tangent of
  coincident slots with the physical neighbor-to-neighbor tangent; the other
  pins coincident open-boundary slots to their original endpoint. Both effects
  fade out continuously before a group stops being recognized.
- `js/geometry/morph.js`: opted in to these guards only in the **live** Morph
  Spline+ drawing path (`drawMorphPathQuality` with a fillet layer).
- The **approved Static Spline+ algorithm is the default**, unchanged, including
  exact output for all 2160 configurations of the 12.6.3 golden regression.
- No change to the circleSlide angle plan, Topo-Circle transport, N/K pairing,
  point movement, phase timing, authored profile data, endpoint snapshot,
  or GPU phase-locked spiral rails. In particular, the existing legacy
  **«По окружности»** implementation was *not replaced* with a new one.

## What is guaranteed by the new tests

- With correction opted in, inserting one or two zero-length slots does not
  change surviving cubic control points on the tested open and closed shapes,
  including 0.001–200% rounding and the spiral branch.
- Very small separation of a newborn slot does not cause a finite geometric
  discontinuity on the tested configurations.
- The production `drawMorphPathQuality` call reaches the correction (tested in
  headless Chromium), rather than relying on a standalone geometry helper.

## Validation commands

```bash
node tests/static-modules.js
node tests/browser-preflight.js
node tests/v1263-golden-spline-plus-parity.js
node tests/v1272-duplicate-stable-spline-morph-regression.js
node tests/v1272-morph-duplicate-draw-browser-regression.js
node tests/v1230-circle-limit-regression.js
node tests/v1261-corner-not-circle-geometry-regression.js
node tests/v1266-live-profile-single-prep-regression.js
node tests/v1270-calm-spline-rotation-seam-regression.js
node tests/v1270-topology-spline-rotation-seam-regression.js
node tests/v1272-static-target-strict-endpoint-regression.js
```

All listed tests passed in software / headless Chromium.

**Baseline caveat:** `tests/v10458-circle-ui-27-parity-regression.js` fails its
archived snapshot in BOTH the unmodified input archive and this patched build
(same first mismatch: case 0 `start` 6.73853 vs archived 3.66208). It cannot
be used as evidence of a new regression in this patch, but it remains an
unresolved historical parity discrepancy.

## Scope / limitations

This patch addresses the duplicate-slot Spline+ *live rendering* instability.
The existing independent endpoint/interpolated-cubic code paths are deliberately
unchanged. A phase transition can still differ for other reasons (e.g. when the
transport deliberately moves a newborn point along a circle rather than an old
chord; or if N/K and profile definitions change the authored target geometry).
The tests are not a universal proof of all stochastic phase pairs, physical
WebGPU driver behavior, or 60-FPS throughput on production hardware.
