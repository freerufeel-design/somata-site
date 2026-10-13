# Somata 7.5

Somata 7.5 is a GPU-only visual renderer. There is no CPU/reference renderer and no CPU geometry/effect fallback. CPU-side JavaScript may still prepare compact geometry/metadata for GPU upload. If the final WebGPU compositor declines a current frame, a presentation-only bridge may copy the current GPU texture to the main surface; it must never retain stale pixels from an older frame.



## 7.5 — test-first effect stack, Bézier Web truth, balanced Lightning

- The required per-layer visual stack is now **Web → Line/Glow/Base + Graffiti → Lamps → Glint/Lightning → Particles**. Web owns the transparent resident Layer Scene at phase 1; the prepared Base/Line batch appends at phase 5 with `loadOp:'load'`, avoiding the old Web materialization/readback path on the normal GPU route. Graffiti remains below Lamps, Glint/Lightning stays at phase 60, and Particles stays at phase 70.
- Static Web no longer derives its visible contour from the independent rounded-polyline helper. `prepareLayerFrameWebData()` consumes the same retained cubic Bézier rail/flattening truth used by exact contour effects. Web therefore follows the actual rendered curve rather than a separate approximation.
- Lightning exact precision uses a balanced 4× direct cubic raster per Arc microsegment (previously 6×). Precharge, strike and afterglow all use the analytic GPU halo field; the legacy separable-blur/Graffiti-glow dependency is removed from Lightning impact frames.
- Every settings checkbox is exercised by a native browser `click/change` audit. A checkbox must toggle, produce an observable state/UI effect, avoid uncaught errors, and not leave the scheduler stuck. The audit also has a 100 ms synchronous-handler guard; 7.5 reference headless runs stay at or below 7.2 ms worst-case and about 0.8 ms average.
- The hidden `lineSpriteEnabled` checkbox was a Legacy no-op: Sprite enablement is derived from the selected line mode and the checkbox was never renderer-authoritative. 7.5 removes that control and its synchronization/listener code instead of preserving a dead compatibility switch.
- New field regressions are test-first: `v75-effect-stack-order.js`, `v75-web-bezier-contour.js`, `v75-lightning-performance.js`, and `v75-checkbox-functional-coverage.js`. The clean 7.4.30 baseline fails these contracts before the runtime fixes are applied.

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
3. GPU passes consume that frame: Web, base/fill + Graffiti/profile, Lamps, Sweep/Glint/Lightning, path motion/Sprite and Particles.
4. Web owns/creates the transparent GPU Layer Scene when enabled; Sweep/Particles may create one when earlier phases did not. Per-layer GPU phase order is Web → Base/Line/Graffiti → Lamps → Glint/Lightning → Particles; Lamps are interleaved into the resident Layer Scene so final output capture preserves the whole stack.
5. A pass failure is contained: it is logged with a `GPU-XXXXXXXX` id, that pass is skipped, and the shared scheduler remains alive.
6. One shared scheduler owns continuous `requestAnimationFrame` rendering, with a Morph watchdog that does not depend solely on `renderPending`.

## Required intersections

- Effects switch immediately in static scenes and while Morph is active.
- Sweep profile has `current` (default) and `line`. With Graffiti, `current` uses the calligraphic ribbon/profile rather than substituting a thin line.
- Spiral geometry remains a first-class geometry source and is consumed by the same effect passes.
- Blue, Orange and Green Morph, Corridor, palettes, transforms, audio bindings and playlist load/save remain core features.
- Corridor center shading is count-based: `centerHiddenCopies=N` makes the N deepest copies fully invisible at the phase boundary, while the next moving copy is generated inside the center and fades in over one copy-spacing interval. The reveal is per-instance before glow/composite; no final center mask may cover rendered glow.

## Deliberately removed

CPU/reference renderer, backend selector, raster Graffiti worker/bitmap path, HD/raster lamp modes, raster lightning switches, historical runtime probes, old duplicated Sweep migration fields, the hidden no-op `lineSpriteEnabled` checkbox, and legacy source layout.

## Preflight

`tests/` is development-only and is never loaded by `index.html`. Before packaging, run `node tests/run-all.js`. The suite checks every JS file, browser load order, critical cross-module bindings, geometry invalidation, live effect ownership/profile switching, pass fault containment, every checkbox, and a render-impact matrix in which each core slider must change renderer-driving geometry/style/GPU input. Every effect case is followed by a scheduler liveness watchdog. Hardware WebGPU draw/present still requires a final smoke-test on a GPU-capable machine. Real hardware logs take precedence over headless assumptions.

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
