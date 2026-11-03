# Somata 13.1.3 — spectral glint seam, GPU workload and cloud controls

Based on `Somata_13.1.3_Lightning_Single_Contour_Clouds_Unbounded.zip`. All previous fixes remain.

## Spectral Glint

- The GPU Bézier sector previously used `tail = max(0, head - span)` and a zero-width sector at phase 0. As the clock wraps from just below 1 to 0, the effect disappeared, then reappeared at the start, perceived as an abrupt jump. The Graffiti/CPU fallback had the same discontinuity.
- The sector now always has the full authored angular width and is periodic across 0/360 degrees. Phase 0 and 1 correspond to identical masks, including backwards playback and 360-degree sectors.
- The GPU and Graffiti fallback use matching wrap-around behavior. No authored colors, opacity, shape, Morph or effect settings are overwritten.

## Performance improvements

- Static complex Bézier contours are checked for byte-identical geometry between frames. If unchanged, the same `Float32Array` is reused, enabling the persistent GPU cubic buffer and its bind-group cache to work even when the original path array was recreated on each frame. Changes to geometry invalidate this cache. Frame-dynamic paths are excluded.
- The Graffiti spectral fallback caches Bézier samples and polar midpoint angles keyed by the retained contour array. Per-frame progress only masks the cached values; the curve and atan2 values are no longer recalculated on every frame when the geometry is static.
- For a spectral contour with >180 cubics, the GPU uses 8 instead of 12 subdivisions; >450 cubics uses 6. Ordinary and short profiles retain 12. This reduces processed vertices for complex profiles. The GPU fragment stage conservatively classifies whole subsegments inside/outside the spectral mask, reserving per-pixel boundary calculations for crossings.
- The renderer continues to draw frames while animating; no claim is made that it pre-renders and replays an immutable image.

## Clouds density and speed

- Restored visible `range` sliders (0–100 adjustment scale) with adjacent numeric multiplier inputs. The multipliers have no `max` attribute, and the effective density and speed do **not** have a 100-point ceiling. For example, `50 × 20 = 1000`.
- The earlier release's numeric-only base values over 100 are normalized to `100 × (oldEffective / 100)` on loading, preserving the effective settings. For example, old `500 × 1.5` becomes `100 × 7.5`.
- Cloud color continues to come from the color picker; the removed redundant hue field stays removed.

## Verified

- Browser test `tests/v1313-spectral-cycle-seam-cloud-sliders.js`: 0/1 seam, positive/negative direction, quadrants, 360-degree sector, cache reuse and invalidation, CPU sampled profile cache, unbounded cloud multiplier and migration of numeric-only legacy settings.
- Browser regression tests: lightning single contour, cloud seamless visual, Master exact field isolation, glint core/halo, AudioLink outline, FreezeLight, unified catalog, Semiramida, and others.
- All JavaScript files pass `node --check`.

## Known limitation

The test browser does not provide real WebGPU hardware. Source-level and browser/Canvas behavioral tests passed, but actual GPU-compiled shader pixels and achieved FPS must be verified on the user's GPU and heavy profiles. Performance benefits are design-level expectations, not measured FPS gains.
