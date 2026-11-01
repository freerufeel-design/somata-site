# Somata 10.4.19.36 — Full-profile-length rounding correction

## Requested behavior

Corner rounding is a distance along the **entire visible contour**. It is
not capped by the single short point-to-point segment immediately before or
after a corner. With intermediate unmarked knots, rounding can extend over
many individual segments without depending on their subdivision density.

## Algorithm

- The full contour length is the sum of all path runs. For a spline, each
  cubic's actual arc is approximated by 16 equal-parameter samples (rather
  than using only the chord between its endpoints). The same arc-distance
  lookup is used to locate fillet shoulders within multi-cubic runs.
- A requested rounding fraction `f` in 0..1 has nominal per-side reach
  `0.5 * totalContourLength / numberOfRoundableCorners * f`.
- Each incoming/outgoing shoulder is individually limited to **half of its
  complete run between adjacent authored corners**, not to the closest raw
  segment or the shorter neighbor. This prevents overlap of distinct
  fillets while allowing arbitrary intermediate subdivisions in that run.
- The same rule applies to authored Static and live Morph paths, and to
  straight-segment and edge-local spline profiles. Spline fillets enter and
  leave with actual source-curve tangents (G1 join).
- The 100–200% supplementary spline knot smoothing is unchanged.
- A short native-Canvas2D-only crossfade at the endpoints of segment-profile
  Morph prevents subpixel rasterization jumps. GPU/geometry recorders still
  receive one canonical geometry rail.

## Verification

`node tests/v10419-43-full-profile-arc-rounding-regression.js` uses actual
browser path builders for both spline and segmented contours. It checks that:

- A 100%-rounded corner reaches across several successive short segments.
- Lengthening a far-away segment, without changing the short neighbor,
  increases the fillet shoulder according to the complete contour length.
- Adding collinear points does not change the geometric fillet placement.
- 0% rounding stays identical; cubic arc lengths exceed chord lengths when
  the profile bends; computed coordinates remain finite.

Additional Chromium tests passed: 400 live Morph path combinations (max
measured seam angle 14.9 degrees), 100 mixed-profile curves, 480 late-phase
spline checks, rounded segment handoffs, MonoRadius fitting, anchor transport,
and 18 native Canvas2D late-frame raster comparisons. All 501 JavaScript
files passed syntax checking.

## Boundaries

An authored corner is still a boundary between adjacent runs; the new
algorithm can pass across any number of intermediate *unmarked* segments,
but intentionally does not cross another separately marked corner. This
avoids overlapping independent fillets. Severe self-intersecting user
profiles, every possible UI preset, and hardware WebGPU presentation have
not been exhaustively tested.

`tests/v10460-topology-calm-v19-anchor-drawing-regression.js` already has a
known spline trace hash mismatch in the unmodified input archive; this
pre-existing historical hash check was not rewritten.
