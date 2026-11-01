# Somata 13.0.6 — Spiral Fast Rail width preparation (experimental)

Based on Somata 13.0.5. No added controls or UI.

Changed only `js/gpu/spiral-bezier-morph-renderer.js`:
* Precompute four logarithmic width endpoint parameters per cubic **once per phase** before uploading to the GPU. The WebGPU Fast Rail compute shader no longer recalculates four logarithms and two intermediate exponentials for every one of the eight subdivision samples; it now interpolates the log endpoints and evaluates the two final exponentials. This is mathematically equivalent, modulo float32 rounding.
* The same encoding applies to static Spiral paths so their shader remains correct.
* Leave the original CPU endpoint data untouched; lamp/fill auxiliary paths still read original width values.
* Remove duplicated CPU logarithms inside non-carrier auxiliary samples, reusing per-cubic results.

No changes: Spiral carrier or anchor motion; cubic control points; number of cubics, tessellation subdivision (8), copies, fill, glow, or lamps. This update does not freeze any frames.

Validated locally:
* `node tests/v1306-spiral-fast-rail-width-regression.js`: 60,000 f32 width samples, maximum relative difference 5.83e-7.
* `node tests/v1300-preserve-anchor-transport.js`: 168/168 original anchor states.
* `node tests/v1265-spiral-exact-fast-parity.js`: 1,456 golden cases.
* `node tests/v1270-exact-terminal-spiral-phase-regression.js`: 5/5 phase seams.
* `node tests/v1305-lamp-inertia-owned-rail.js`: passed.
* `node tests/v1305-spiral-cross-layer-profile-reuse.js`: passed.
* `node tests/v1305-spiral-morph-two-layer-shared-profile.js`: passed.

**Limitation:** Hardware WebGPU is not available in the test environment. This is a focused shader optimization, not a validated solution for 6 FPS on three spiral layers. The most expensive potential source remains per-copy/per-layer rasterization and overlapping Glow/Base fragments. Do not claim production FPS improvement without hardware testing.
