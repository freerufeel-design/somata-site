# Somata 10.4.19.36 — Morph and Dynamic segment-joint rounding fix

## The reported defect

With the full-profile-length rounding change, the authored Static segment joints rounded correctly, but the same interior joints stayed pointed in moving Morph and Dynamic geometry.

## Confirmed causes

1. The legacy Topology/Calm movement renderer removed `options.profileMode` just before rebuilding its live segment-profile geometry. `applyProfileToVertexRing` only marked authored interior profile bends when `profileMode === 'segments'`. The result: a 12-corner path retained only 3 polygon-vertex markers during Morph.
2. The spline fillet solver treated the presence of a `bridgeRoundFlags` array as permission to round *only* true bridge entries. All non-bridge authored corners were therefore disabled when the optional bridge array existed, including during mixed Segments ↔ Spline transitions.
3. Morph topology resampling discarded the distinction between a non-bridge point and a deliberately straight, blocked bridge.

## Corrections

- Restore segment-profile corner classification when building Topology/Calm moving polygons, leaving vertex transport, movement clocks, and anchor trajectories unchanged.
- Use a three-state bridge policy: `null` = ordinary authored corner, `true` = rounded bridge, `false` = deliberately straight bridge. Only an explicitly disallowed bridge prevents its own rounding.
- Preserve the bridge policy through Morph topology resampling and keep the same distance-based, complete-profile-length fillet geometry in Static and live rendering.

## Verification

New browser regression: `node tests/v10419-44-morph-dynamic-profile-joint-rounding-regression.js`.

- 3 moving Topology Morph phases: 28 quadratic fillets per frame with valid coordinates.
- 3 dynamically displaced vertex rings: 16/16 authored segment joints marked and rounded per frame.
- 480-point resampled Morph paths preserve all 16 authored corners.
- Neutral bridge policy does not suppress spline fillets; a blocked bridge only affects the specified junction.

Other passing tests include full-profile-length rounding, 400 Canvas2D Morph frames across 4 modes, mixed profile transitions, 168 anchor-motion checks, 72 rounded topology handoffs, 18 rounded linear Polygon boundary scenarios, 32 MonoRadius/handoff scenarios and 32 segment-profile Spiral handoffs.

Three older historical checks still fail **unchanged in the supplied input archive**: `v10459-topology-calm-reference19-regression.js`, `v10458-circle-ui-27-parity-regression.js`, `v10419-42-asymmetric-short-spline-segment-fillet.js`. Those failures were reproduced on both the original supplied version and this corrected build; they are not newly introduced by this fix. Hardware WebGPU presentation is not exhaustively verified.
