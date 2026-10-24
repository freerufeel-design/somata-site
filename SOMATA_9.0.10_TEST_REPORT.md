# Somata 9.0.10 — Test report (2026-10-24)

## Summary

- **Quick acceptance:** 29/29 PASS, 0 FAIL, 0 TIMEOUT (`tests/run-all.js`).
- **Targeted Spiral and Corridor regressions:** 14/14 PASS. See `tests/v9010-spiral-closure-cubic-ranges-regression.js` and the other retained tests.
- **Confirmed red/green regression:** closure-cubic ranges test FAILS on 9.0.9 with wrong ranges for all 13 branches, PASSES on 9.0.10.
- **Source JS syntax:** PASS for all 108 JS modules.
- **Playlists:** three project files identical byte-for-byte to 9.0.9.
- **Full extended suite:** not run in this iteration.
- **Hardware NVIDIA WebGPU visible joins and FPS:** not measured in this environment; software/headless test results do not establish these.

## Geometry / resource change

- Fixed the point-offset vs cubic-segment-offset mismatch in the GPU periodic closure compute pass.
- Added limited screen-space overlap to fallback cubic join rasterization; Bezier control points and canonical geometry unchanged.
- Adjusted rendering tessellation from 12 to 8 microsegments per cubic. This reduces the number of generated stroke instances and the fast-rail size by 1/3, but FPS change on the actual hardware remains unverified.

## Side correction

- Updated an obsolete cloud test (9.0.9 clouds are texture layers, not 256 radial arcs).
- Cloud movement now freezes fully at speed 0; new test confirms.

See `RELEASE_9.0.10.md` for source locations and details.
