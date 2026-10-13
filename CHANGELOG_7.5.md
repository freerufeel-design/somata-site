# Somata 7.5

## Rendering order

The active per-layer effect stack is now:

**Web → Line / Glow / Base + Graffiti → Lamps → Glint / Lightning → Particles**

Web starts the resident transparent Layer Scene at phase 1. The Base/Line batch appends at phase 5 using the existing scene as its load target, avoiding the normal-path Web readback/materialization that would otherwise defeat the requested bottom-layer ordering.

## Web contour

Web preparation now consumes the retained cubic Bézier contour truth used by the exact curve path instead of the separate rounded-polyline approximation. The regression verifies curved cubic segments and adaptive preview points against the rendered rail.

## Lightning performance balance

Exact Lightning raster density is reduced from 6× to 4× per retained cubic Arc microsegment. Precharge, strike and afterglow all use the analytic GPU halo field; the old separable-blur/Graffiti-contour-glow dependency is removed from Lightning. This targets the flash-time FPS drop without changing the feature set or introducing an aggressive quality downgrade.

## Settings and Legacy cleanup

The browser audit now discovers all 129 settings checkboxes, including the five data-driven Morph-group checkboxes that do not have IDs. Every checkbox is clicked through the real DOM event path and must toggle, produce an observable intended effect, avoid uncaught errors, leave the scheduler live, and keep synchronous handler work below 100 ms. The hidden `lineSpriteEnabled` checkbox was removed because Sprite enablement is derived from line mode and the checkbox was a true no-op.

## Test policy

7.5 is test-first for the reported regressions. The new tests are `v75-effect-stack-order.js`, `v75-web-bezier-contour.js`, `v75-lightning-performance.js`, and `v75-checkbox-functional-coverage.js`. They were red on the clean 7.4.30 baseline before the fixes and are part of the mandatory gate afterward.
