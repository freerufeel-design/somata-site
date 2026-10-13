# Somata 7.4.30

Somata 7.4 is a GPU-only visual renderer. There is no CPU/reference renderer and no CPU geometry/effect fallback. CPU-side JavaScript may still prepare compact geometry/metadata for GPU upload. If the final WebGPU compositor declines a current frame, a presentation-only bridge may copy the current GPU texture to the main surface; it must never retain stale pixels from an older frame.


## 7.4.30 — Orange family/pools and Graffiti Lightning aftershock

- Orange Morph owns an independent shape family (`mix`, `square`, `triangle`, `sine`) and independent multi-select profile pools sourced from the same Profile Segment library as Blue Morph. Blue and Orange selections do not mutate each other.
- Dice generation and Orange Morph targets consume the union of Orange-selected pools plus the Orange family filter. A legacy single `mode` remains only for project/plugin compatibility.
- The Orange `Морфить по умолчанию` row is first in the Orange settings panel.
- Current-profile Lightning on a Graffiti carrier preserves afterglow micro-strikes: the strongest live micro-pulse is folded into the Graffiti retained-ribbon visual, with alternating primary/secondary pulse colour, rather than being discarded by the single Graffiti visual pass.

## 7.4.29 — Freeze continuity, Rain isolation, Master diff broadcast, Orange colour sampling

- Changing ordinary FreezeLight tail duration no longer clears history. The GPU renderer slews an effective tail duration toward the authored value, so the visible trail shortens/lengthens continuously instead of despawning.
- FreezeLight `Изменение цвета` is monotonic along trail age: the configured degree value is the maximum hue delta at the tail end; it never cycles through repeated hue periods.
- FreezeLight Rain owns a separate emitter snapshot and history. In Corridor, tunnel copy scale/phase is excluded from the Rain emitter refresh signature; the snapshot is transported only by the configured screen-space Rain vector, so Corridor motion cannot radially pull Rain toward the centre. Ordinary FreezeLight and Rain remain independently resettable and may run together.
- Master is a write-broadcast mode, not a layer-normalisation mode. Enabling it changes no layer. A UI interaction edits only the active source layer; the post-event diff mirrors only the changed property paths to every layer, preserving all unrelated per-layer values.
- Orange dice and Orange Morph share one final palette sampling pass. With colour randomisation enabled, generated layers sample distinct colours without replacement from the selected palette rather than reusing palette slots 0/1/2.

## Frame contract

1. Geometry selects static, Spiral, Corridor or one of the three Morph systems.
2. `frameCtx.layer` owns frame geometry; `frameCtx.effectLayer` resolves the persistent authored layer by id and owns live effect settings.
3. GPU passes consume that frame: base/fill, Graffiti/profile, Web, Lamps, Sweep/Glint, path motion/Sprite and Particles.
4. Web/Sweep/Particles may create a transparent GPU Layer Scene when Base did not create one. Per-layer GPU phase order is Base/Graffiti → Web → Lamps → Sweep/Lightning → Particles; Lamps are interleaved into the resident Layer Scene so final output capture preserves the whole stack.
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

## 7.4.29 — Freeze/Glow/static exposure correctness

- Freeze Light and Freeze Light Rain keep independent histories, reset paths, motion signatures and expiry; both may run together.
- Ordinary Freeze Light samples zero-shift history on exact integer texels, preventing half-pixel feedback drift in a static Corridor.
- Adaptive lamp brightness/radius reacts immediately whenever geometry Morph is static; unrelated camera/color motion no longer disables static exposure.
- Glow reads the live effect owner and exact Graffiti contour glow retries bounded warm-up misses instead of silently losing a layer.
- Unattributed browser rAF gaps are counted as external scheduling gaps while recovery remains active; they are no longer mislabeled as `morph.freeze` without measured Somata/GPU evidence.


## 7.4.29 stability corrections

- Spiral Morph branch pairing is now circular-order-preserving. Equal branch counts use the best cyclic shift; unequal counts use monotone cyclic merge/split bins. This prevents crossed branch correspondence (the visual “vermicelli” failure) while retaining no-fade merge/split semantics.
- Orange random composition and Orange Morph sample distinct palette colors without replacement for the first generated layers; Mandala no longer starts from fixed palette slots 0/1/2.
- Exact GPU Lightning keeps blurred precharge when useful, but strike and afterglow halos use the analytic GPU halo field. This removes the per-impact separable-blur chain that could stall the driver submission path.

## 7.4.29 — Graffiti Glow density and Lamp blend modes

- Exact Graffiti contour Glow keeps the same retained ribbon geometry but no longer uses a fixed sparse blur lattice at high radii. The separable blur grows its tap budget with radius (bounded at 32 taps per side), while ordinary radii keep the historical lower sampling cost.
- Because a normalized blur dilutes a thin ribbon as radius grows, the final contour Glow uses a width-aware density response before alpha composition. This makes equal Glow settings perceptually closer to the analytic ordinary-line Glow without creating extra profile vertices.
- Lamp blend mode is carried through both Canvas and GPU presentation. Supported modes are Lighter, Screen, Normal, Color Dodge, Difference/Inverted and Color/chromaticity.
- When Lamps must sit between Web and Sweep, the resident Layer Scene is copied to a scratch target and recombined by an explicit blend shader. The selected mode is no longer collapsed to hard-coded source-over.
