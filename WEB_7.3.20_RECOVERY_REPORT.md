# Web recovery from Somata 7.3.20 behavior

## Symptom

In 7.8.3 Web geometry could be prepared correctly, but the effect could still be completely invisible when the WebGPU Layer Scene or `WebGPUWebThreadSceneRenderer` was unavailable/warming. The render pass returned without any presentation fallback.

This affected all three placement modes at the final presentation stage:

- `corners` — Паутина в углах
- `selfIntersection` — Паутина на самопересечении
- `selfIntersectionCorridor` — Самопересечение + коридор

## Comparison with 7.3.20

7.3.20 had a resilient presentation ladder for ordinary geometry:

`deferred WebGPU → WebGL2 → Canvas`

Later 7.8.x code removed that ordinary fallback and made Web effectively GPU-only. The geometry itself was not the failure: current 7.8.3 still produced non-empty thread commands for all three modes in both Static and Morph.

## Fix

The 7.3.20 presentation principle is restored **only for ordinary geometry**.

The restored fallback consumes the current 7.8.3 Web data derived from the authoritative `FrameContour`; it does not rebuild an old 7.3.20 contour. Therefore Line / Fill / Web geometry authority remains the 7.8.3 shared contour.

When a deferred Layer Scene exists, it is materialized before the ordinary Canvas/WebGL fallback so work already ordered below Web (Fill in the default stack) is preserved.

`strict Spiral` is intentionally excluded from the fallback. Its exact retained Bézier/GPU carrier remains GPU-only.

## New regression

`tests/v783-web-7320-render-fallback-regression.js`

The browser is deliberately started without WebGPU. For each placement mode it verifies both Static and active Morph:

- Web plan enabled;
- semantic corners/anchors exist;
- real thread commands exist;
- Fill-before-Web dependency resolves;
- Web render pass is actually handled;
- ordinary fallback is selected;
- the Canvas contains non-zero visible Web pixels.

Result: 6/6 mode/state combinations PASS.

## Wider regression

The existing targeted suite remains green, including:

- configurable Fill/Web effect order in Static + Morph;
- static Web GPU render path;
- Web repeated ON/OFF in Static + Morph;
- shared FrameContour authority;
- Fill/Web/Line exact authority;
- Corridor shared FrameContour;
- exact Spiral carrier/profile invariant;
- GPU effect scene routing;
- render-impact combined stress;
- Lightning/Graffiti/Lamps/FPS/Master regressions.
