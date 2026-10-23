# Somata 9.0.7 — GPU Lightning render fix

Base: Somata 9.0.6; single production code change, in `js/app/geometry-gpu-core.js`.

## Root cause

After removal of the Lightning precharge stage, `SweepGPURenderer.encodeToLayerScene()` continued to forward an undeclared `prechargeAsGlow` identifier. When a real WebGPU encoder was ready, evaluating this identifier caused `ReferenceError` before submitting a Lightning GPU command. Existing UI/phase/geometry tests did not execute this GPU-ready branch.

## Fix

Removed the sixth argument; the actual `WebGPUSweepRenderer.encodeToLayerScene` accepts five relevant arguments. No Lightning trigger modes, artistic math, profile carriers, other effects or playlists changed. Increased cache-busting version to 9.0.7.

## Regression

`tests/v907-lightning-gpu-encode-regression.js` executes the shipped adapter's function body with a controlled ready GPU backend and confirms an encode call without exception, then exercises real UI action and tests non-empty strike geometry via browser frame plan. Added to `tests/run-all.js` via `run-v9.js`.

## Test results

- New regression failed on original 9.0.6 with `ReferenceError: prechargeAsGlow is not defined`; after fix PASS.
- `node tests/run-all.js` — 26 PASS, 0 FAIL, 0 TIMEOUT.
- 108 production JavaScript files passed the static integrity test.
- All three playlist files match the previous release byte-for-byte.

## Limits

Real NVIDIA WebGPU output is not available in this environment. The test demonstrates the previous deterministic JavaScript error is fixed, not that every GPU device renders visible bolts or that Spiral performance issues are resolved.
