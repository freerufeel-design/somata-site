# Somata 7.4.9

Somata 7.4 is a GPU-only visual renderer. There is no CPU/reference renderer and no CPU geometry/effect fallback. CPU-side JavaScript may still prepare compact geometry/metadata for GPU upload. If the final WebGPU compositor declines a current frame, a presentation-only bridge may copy the current GPU texture to the main surface; it must never retain stale pixels from an older frame.

## Frame contract

1. Geometry selects static, Spiral, Corridor or one of the three Morph systems.
2. `frameCtx.layer` owns frame geometry; `frameCtx.effectLayer` resolves the persistent authored layer by id and owns live effect settings.
3. GPU passes consume that frame: base/fill, Graffiti/profile, Sweep/Glint, Web, Lamps, path motion/Sprite and Particles.
4. Web/Sweep may create a transparent GPU Layer Scene when Base did not create one; Web-under-Base is materialized before Base to preserve ordering.
5. A pass failure is contained: it is logged with a `GPU-XXXXXXXX` id, that pass is skipped, and the shared scheduler remains alive.
6. One shared scheduler owns continuous `requestAnimationFrame` rendering, with a Morph watchdog that does not depend solely on `renderPending`.

## Required intersections

- Effects switch immediately in static scenes and while Morph is active.
- Sweep profile has `current` (default) and `line`. With Graffiti, `current` uses the calligraphic ribbon/profile rather than substituting a thin line.
- Spiral geometry remains a first-class geometry source and is consumed by the same effect passes.
- Blue, Orange and Green Morph, Corridor, palettes, transforms, audio bindings and playlist load/save remain core features.
- Corridor center shading is count-based: `centerHiddenCopies=N` makes the N deepest copies fully invisible at the phase boundary, while the next moving copy is generated inside the center and fades in over one copy-spacing interval. The reveal is per-instance before glow/composite; no final center mask may cover rendered glow.

## Deliberately removed

CPU/reference renderer, backend selector, raster Graffiti worker/bitmap path, HD/raster lamp modes, raster lightning switches, historical runtime probes, old duplicated Sweep migration fields and legacy source layout.

## Preflight

`tests/` is development-only and is never loaded by `index.html`. Before packaging, run `node tests/run-all.js`. The suite checks every JS file, browser load order, critical cross-module bindings, geometry invalidation, live effect ownership/profile switching, pass fault containment, and a render-impact matrix in which each core slider must change renderer-driving geometry/style/GPU input. Every effect case is followed by a scheduler liveness watchdog. Hardware WebGPU draw/present still requires a final smoke-test on a GPU-capable machine. Real hardware logs take precedence over headless assumptions.
