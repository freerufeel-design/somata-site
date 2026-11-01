# Somata 13.0.17 — Morph crash repair + spiral cost trimming

Based on **13.0.16**. This is a targeted experimental optimization; it does **not** establish a hardware FPS gain.

## Crash fix (confirmed from user log)

- `sampleProfileForMorph()` called `getMorphLongPeriodDetailScale()` which was declared inside the separate MorphPlayback module. Moved the helper into the common lexical scope of MorphInterpolation and MorphPlayback. The repeated `ReferenceError` on active Blue Morph no longer occurs in the reproduction test.
- Boundary commit is now resilient to a missing per-layer target after an interrupted/rebased phase. Existing authored layer geometry is preserved instead of throwing `Cannot read properties of undefined (reading 'mode')` for the entire animation.

## Spiral optimizations

- GPU Base and Glow now reject fully transparent spiral branches *at the vertex stage* using the **identical alpha thresholds** already checked by the fragment shaders. During N/K phase-circle branch split/merge, absent branches no longer expand into full Glow raster quads.
- GPU glow rejects straight expanded segment quads conservatively when their entire supporting capsule quad is outside the viewport. Uses a `1.415 × pad` bound (`> sqrt(2)`) so no previously visible pixels are excluded.
- The CPU auxiliary Spiral path (`auxiliaryPaths`) caches four endpoint width logarithms per cubic **per prepared phase**, instead of recomputing them every frame and then evaluating `log(exp(mix(...)))`. Bézier shape formula unchanged, width values differ only at floating-point roundoff (< 6e-15 in the dedicated test).
- Tried replacing per-sample temporary points with object mutation, but an isolated V8 benchmark was **slower**. That proposal was reverted before release.

## Validation and limitations

- PASS targeted reproduction of the two console errors, including a real Morph animation callback and phase boundary.
- PASS 168 reference anchor transport states, 1,456 exact spiral configurations, 5 terminal phase handoffs, focused focus/lamps tests.
- PASS 60,000 width/sample parity checks; maximum numerical width difference ~5.33e-15; identical cubic coordinates.
- In an isolated Node width-only benchmark, 4,300 cubics × 50 updates, using cached endpoint logs reduced the timed width calculation from ~41.3ms to ~22.9ms (environment-dependent, **not FPS**).
- In software Chromium, three active spirals with Glow showed near-identical frame rates to 13.0.16, about 18–24 FPS. WebGPU is disabled in this test; the new vertex optimizations therefore cannot be measured there.
- The old `v10419-36-blue-phase-fill-handoff-regression.js` failure on closed-to-open Fill **also occurs in unmodified 13.0.16** and has not been fixed here.
- Hardware WebGPU pipeline compilation and production GPU FPS could not be verified in this environment. Full 15-layer / 60 FPS guarantee is not made.

No changes to anchor transport, Bezier geometry, eight-segment Base raster, superrounding, lamp kinetics, focus parameters, or phase hold policy. No new UI test buttons.
