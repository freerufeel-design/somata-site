# Somata 7.9 — Continuous Fade + Pixelization + Performance Iteration 1

## Baseline

Somata `7.9` is based on the previously accepted stable build `Somata_7.8.3_stable_lamp_spline_corner_fix.zip`.

No changes were made to:

- FrameContour geometry semantics;
- Web geometry/thread generation;
- Morph geometry;
- Corridor topology;
- exact/retained Spiral;
- Lamps/Particles topology attachment;
- effect-order planner;
- scheduler timing.

## 1. Smooth fading Fill is now a continuous gradient field

The previous `Затухающая — плавная` still estimated contour depth from 24 discrete full-resolution samples (8 directions × 3 radii). Alpha interpolation was smooth, but the depth field itself remained quantized. On simple geometry, especially a square, this appeared as large rectangular/stepped bands.

7.9 replaces the normal smooth path with an optional continuous GPU materialization:

```text
isolated current-frame Fill texture
        ↓
horizontal 9-tap Gaussian, 1/2 resolution
        ↓
vertical 9-tap Gaussian, 1/2 resolution
        ↓
continuous contour-depth texture
        ↓
final monotonic Fade composite
```

The final image still uses the original full-resolution Fill color/alpha. Only the auxiliary depth field is half-resolution and is linearly sampled.

This is deliberately a Fill post-process. It does not create a second geometry carrier.

### Fallback/firewall

The continuous Fade field is optional. If its WGSL/pipelines are rejected by a real driver:

- ordinary Fill remains available;
- accumulation remains available;
- the established Fade shader remains available as fallback;
- the advanced capability cannot poison the base `WebGPUFillMeshRenderer`.

## 2. Sharp Fade pixelization control

`Затухающая — резкая` now has:

`Пикселизация: 0 … 100%`

Contract:

- `0%` — coarser/larger steps;
- `25%` — the accepted stable sharp look from the previous build;
- `100%` — converges to the continuous gradient field.

Old projects that do not contain the property normalize to:

```text
fillFadePixelization = 25
```

The control is visible only for `Затухающая — резкая`. The dedicated smooth mode does not need it.

For `<=25%`, the renderer stays on the cheaper legacy binary-ring path. For values above 25%, it lazily requests the continuous field and blends sharp depth into smooth depth.

## 3. First performance/architecture iteration

This change follows the architecture direction discussed for Somata Next without starting the large Geometry/Profile migration.

### Demand-driven materialization

The expensive representation is not created globally:

```text
Dense / Mathematical / Accumulation
    → no continuous Fade resources

Sharp Fade <= 25%
    → no continuous Fade resources

Smooth Fade
or Sharp Fade > 25%
    → request continuous Fade materialization
```

The auxiliary textures are allocated lazily and are destroyed/rebuilt on device generation or viewport resize.

### Texture-sample budget

Previous smooth depth field:

- roughly 24 full-resolution contour samples + current-pixel sample per output pixel.

7.9 continuous field:

- horizontal 9-tap pass at 1/2 resolution;
- vertical 9-tap pass at 1/2 resolution;
- full-resolution final composite.

A 1/2-resolution surface has approximately 1/4 as many pixels. Therefore the blur sampling portion is roughly equivalent to `18 × 0.25 = 4.5` full-resolution samples, plus the final composite samples. This is a shader-work estimate, not an FPS claim; real driver timing must be measured on the physical GPU.

## 4. Monotonic Hardness contract preserved

For both directions and both Fade styles:

- `0% Hardness` = empty;
- `100% Hardness` = ordinary full Fill;
- increasing Hardness cannot reduce coverage for a pixel.

The continuous-field change does not reintroduce the previous inverted endpoint behavior.

## 5. Versioning

User-visible/runtime diagnostic baseline was bumped to `Somata 7.9`.

Changed production files compared with the accepted baseline:

- `index.html`
- `ARCHITECTURE.md`
- `js/app/geometry-gpu-core.js`
- `js/app/ui-project-runtime.js`
- `js/core/defaults-layers.js`
- `js/geometry/frame-contour.js` (contract label only)
- `js/render/render-diagnostics.js` (version label only)

New regression:

- `tests/v790-fill-fade-gradient-pixelization-regression.js`

## 6. Regression results

PASS:

- new 7.9 smooth-gradient/pixelization test;
- Sharp/Smooth Fade backward compatibility;
- Fade Hardness monotonicity;
- ordered Fill MSAA no-accumulation;
- Fill + Web: 3 Web modes × 2 user orders × Static/Morph;
- special Fill GPU contracts;
- Fill special modes Static/Morph × Web OFF/ON;
- FrameContour authority;
- Corridor FrameContour;
- exact Spiral carrier/profile invariant;
- v505 topology Lamp sticking;
- spline/corner/inertia Lamp regression;
- topology Lamps + Particles actual-profile attachment;
- GPU effect scene routing 6/6;
- static modules/contracts;
- `effect-render-impact` 12/12.

## 7. Next performance iterations (not included here)

After visual confirmation on the physical GPU, next safe iterations are:

1. separate logical frame identity/transient outputs from the physically reused `frameCtx` object;
2. formalize `GeometryCarrier` capabilities before Dreamcatcher/Tesseract;
3. add an explicit frame DAG trace (`prepare → encode → queue → submit → present`) and use it to remove redundant materializations;
4. merge compatible GPU sections into shared encoders without merging their artistic ordering semantics;
5. introduce one `FrameClock/VisualClock` for all time-based geometry/effects.

These are intentionally deferred so 7.9 changes only one performance domain at a time.
