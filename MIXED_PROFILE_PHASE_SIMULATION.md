# Somata 10.4.19.36 — mixed profile phase handoff simulation

## Problem reproduced

When the Blue Morph runs a polygon with a `segments → spline` or `spline → segments` profile change, the `topology` and `calm` linear paths can draw a terminal contour that differs from Static's authored contour. The last animated frame is then replaced by a different curve on the next phase. This is particularly visible with whole-curve spline rendering or with differing numbers of profile knots.

The earlier `drawExactPolygonSplineProfileMorph()` explicitly excluded `topology` and `calm`, routing even a mixed segment/spline transition through the old sampled-profile fallback. The fallback is NOT guaranteed to reproduce both authored endpoint strokes.

## Change

`js/geometry/morph.js`: permit the exact-cubic contour pairing specifically when BOTH conditions hold:

- Morph mode is `topology` or `calm`, with the existing **linear** anchor movement;
- profile modes differ between `segments` and `spline`.

Other legacy pairings and angular/circle-slide behavior remain routed as before. The exact-cubic builder records real Static endpoint geometry and blends Bézier control handles on the profile mode timeline. This removes the profile-mode discontinuity without altering authoring data.

## Browser validation

`node tests/v10419-45-segment-spline-phase-and-corridor-regression.js`

- 48 Canvas2D boundary cases: both transition directions, topology/calm/circleSlide, local/whole spline, 0%/59% rounding and both equal/different node counts.
- Pixel differences between Static and the first/last Morph frames (and 0.00001/0.99999 adjacent frames) must stay below 0.03 average 8-bit alpha units. All pass.
- 42 Corridor samples with frozen geometry, 21 travel-phase positions × two profile modes: visible copy count is 12 in every sample. This establishes that simply changing the profile mode does not change Corridor population under the tested fixed conditions.
- Existing regression tests for rounded linear polygon morph, spline controls timing, mixed spline midpoint, animated rounding, spline seam and modal frames passed.

## Limitation

A separately reported *intermittent outermost figure disappearing* was **not reproduced** in the frozen-geometry Corridor simulation. It could depend on the original project, additional animated settings, fade/runtime state, WebGPU backend, or a simultaneous N/K/orbit change. This change must not be represented as a verified fix for that separate intermittent symptom. Browser tests used headless Chromium Canvas2D (GPU disabled).

`v10459-topology-calm-reference19-regression.js` fails against its historical digest in both the input archive and this modified version, so it is not a new failure introduced here.
