# Somata 10.4.19.36 — transient sharp Morph / Dynamic cusp rounding fix

## Problem

Static profile joints were rounded, but intermediate Morph frames could acquire new, unmarked bends when shape topology, orbit multiplicity, or profile sampling changed. Some moving strokes could therefore approach a nearly 180-degree reversal, despite nonzero rounding. A single quadratic Bézier is not suitable for a full reversal because it develops a vanishing tangent and a visible cusp.

## Changes

- `js/geometry/morph.js`: `completeLiveMorphCornerFlags` identifies actual sharp changes of direction on the **current intermediate geometry** (rather than relying exclusively on source/target corner flags), keeping original authored/transported point coordinates intact. An explicit `false` in the bridge policy remains forbidden. Applied only to intermediate Morph frames with nonzero rounding; exact Static endpoint parity and zero-rounding behavior are preserved.
- `js/geometry/morph.js`: previously interpolated smooth rails also go through the transient-joint recovery stage if a new sharp bend appears, without altering their endpoint rails.
- `js/app/lamp-audio-core.js`: full reversals now use two tangent-connected cubic Bézier segments with a nonzero lateral cap instead of a degenerate quadratic. Standard corners continue using the existing full-profile-length, per-side shoulder solver.
- No changes to motion timing or carrier/vertex trajectories. All changes affect the displayed rounded contour.

## Verification (headless Chromium / Canvas2D)

- `node tests/v10419-45-transient-cusp-continuity-regression.js`: a synthetic exact 180-degree reversal is rounded with maximal observed turn ~8.47° over 80 samples per curve, vs 180° without rounding; tests direct, live Morph, stable rounded rails; confirms three Morph interpolation phases recover lost flags; verifies zero and explicitly blocked joints.
- `node tests/v10419-42-live-spline-segment-bends-regression.js`: 400 Morph frames across all four modes; maximum reported join angle 12.3° (30° threshold).
- `node tests/v10419-41-terminal-spline-horn-continuity-regression.js`: 96 combinations × five late phases.
- `node tests/v10419-43-full-profile-arc-rounding-regression.js`: full arc length, multi-segment shoulders, subdivision independence.
- `node tests/v10419-44-morph-dynamic-profile-joint-rounding-regression.js`: moving geometry markers, split profiles.
- `node tests/v10419-40-rounded-mixed-spline-contours-regression.js`: endpoint comparison and mixed spline modes.
- Other selected passing checks: MonoRadius, boundaries, linear polygon and topology handoffs, stable whole-curve spline compatibility.
- Syntax checks pass for all JavaScript sources.

The implementation has not been exhaustively verified on hardware WebGPU, nor with the exact project/animation settings from the screenshot (no project file was supplied). Historical baseline failures documented in `ROUNDING_MORPH_DYNAMIC_CORNERS_FIX.md` remain outside the scope of this fix.
