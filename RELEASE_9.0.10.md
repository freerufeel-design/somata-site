# Somata 9.0.10 — Spiral Continuity + Raster Budget

Base: Somata 9.0.9 (all Ambients Clouds / Noise / Glitch and GPU Stability Protection retained).
Reference: supplied Somata 6.7 stand-alone HTML (Spiral Bézier construction and joined appearance).

## Confirmed critical defect

In `js/gpu/spiral-bezier-morph-renderer.js`, `buildLayerCpuResource()` constructed GPU `pathRanges` with the **point** offsets `pointBase` and **point** length `n+1`. But the WebGPU `CLOSURE_WGSL` consumes `currentCubics` and expects **cubic segment** offset and count. For every multi-branch spiral the closure kernel could therefore modify incorrect cubics; in later branches it could access outside the cubic buffer.

9.0.10 maintains **two distinct path range layouts**:

- `cpuPathRanges` remains in points (`pointBase`, `n+1`) for existing arc/geometry consumers;
- `closureCubicRanges` (`seg`, `n`) is uploaded to the GPU closure pass as `pathRanges`.

A new browser regression creates 13 spiral branches, verifies all 13 address ranges and their upper bounds, and asserts subdivision configuration. The test **fails on 9.0.9** with wrong ranges for 13/13 branches and **passes on 9.0.10**.

## Continuous joins

`WebGPUStrokeRenderer`'s ordinary/static Bézier fallback now overlaps neighboring GPU micro-quads by a limited fraction of a pixel along the joined tangent, matching the already implemented Spiral fast-rail approach. This avoids triangular cracks at sharp curvature changes without modifying authoritative Bézier control points, custom profile logic or closed Spiral semantics.

## GPU workload

- Spiral specialized Morph fast rail: **12 → 8** raster subsegments per cubic.
- Static Spiral visual fast rail: **12 → 8**.
- Generic WebGPU Bézier stroke raster: **12 → 8**.
- Static Spiral arc metadata declares matching `bezierSubdiv=8`.
- That reduces this part's per-cubic raster instances / fast-rail storage by **33%**. It is *not* a measured FPS gain on the user's physical GPU.
- In a representative 19-branch, 1026-cubic spline example at radius 250, chord midpoint deviation was ~0.666 px with 8 subdivisions vs ~0.302 px with 12 (Somata 6.7 used 6). Cubic control points remain unchanged, but raster tessellation remains an approximation.

## Retained behavior

- GPU backpressure, device-loss recovery and buffer limits of 9.0.8 remain.
- 9.0.9 Ambients (new Clouds, Noise, Glitch) preserved. Additionally corrected Clouds so `speed=0` freezes the entire cloud drift and bob; updated an obsolete 8.20.14 cloud test to inspect bounded layered textures rather than legacy radial arcs.
- Lightning, Corridor, Morph timing, exact geometry data and playlists untouched.

## Verification

- New closure regression passes on 9.0.10, fails on 9.0.9.
- JS syntax check: all source JS files.
- 14 targeted Spiral/Corridor tests passed. Main acceptance suite is rerun after the Clouds test update; see its final log/report.

Hardware GPU display continuity and FPS on the user's NVIDIA could not be directly tested in this environment. In particular, the new regression confirms a serious underlying buffer-indexing bug and its fix, not guaranteed visual parity for all scenes.
