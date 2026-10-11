## Corridor center shading

Corridor center shading is not a post-process. `state.tunnel.centerShadePercent` blends the retained depth curve into each copy's instance alpha (`0% => 1.0` exactly). Visibility preparation reuses the same strength to cull contributions below a small perceptual threshold before GPU submission. This keeps the effect backend-native and provides headroom for increasing Corridor figure complexity/count later without introducing a Canvas fallback.

# Somata 7.0.10 FullGPU Lamp Arc / FreezeLight stabilization

## 7.0.10 frame-authoritative Lamp Arc

Strict Spiral effects now resolve their retained Bézier authority from the current `frameCtx`. A globally active, paused, or preparing Blue Morph no longer makes static Spiral lamps request an unrelated Morph rail. The Base frame, Exact Arc, Lamp GPU sampler, Corridor lamp instances, and FreezeLight current source therefore share the same retained cubic resource. No Canvas, WebGL, or Fast-GPU substitution is introduced for the strict Spiral path.

# Somata 7.0.9 FullGPU Web/Morph stabilization

Web is an optional FullGPU consumer of the authoritative retained Bézier Morph rail. It may never own or stop the Morph clock. Pipeline/corner preparation is asynchronous; failure is diagnostic-only for the Web pass and never enables CPU/Canvas/WebGL/Fast-GPU fallback. Topology changes replace stale GPU corner-growth buffers during resource build.

## Somata 6.9 — Morph stroke union and periodic Bézier closure

Spiral Morph keeps one authoritative retained cubic Bézier rail. Raster subdivision is only a GPU coverage detail: micro-capsules are MAX-unioned in a transparent per-layer scene, preventing subdivision dots and glow accumulation. The finished layer is composited source-over into Frame Scene. Closed Spiral is periodic, not a conventional `closePath`; continuity-preserving morph modes patch the current final `P3` **and final `C2`** to the interpolated rotate+scale image of the current first `P0/C1` in GPU compute before Base/Glow/effects consume the cubic buffer. This enforces both periodic position and C1 tangent continuity at the seam. Torn intentionally skips this constraint.

## Somata 6.8 — Spiral GPU/Bézier Iteration 9

The strict Spiral effect graph now has an explicit command-order contract. A retained current-cubic buffer is not considered ready because another command buffer merely recorded a write. Arc-dependent effects receive one ordered prerequisite that computes current cubics and then builds the GPU arc; direct retained-cubic effects receive one ordered current-cubic prerequisite. This removes stale-rail reads during Morph without materializing CPU geometry.

Arc distance is derived from the cubic itself. Each fixed micro-interval uses 3-point Gauss-Legendre integration of `|B'(t)|`; the endpoint position still comes from the retained cubic. This improves placement on tight turns without increasing the number of GPU micro-segments.
The strict Spiral Arc uses six micro-intervals per retained cubic. Direct Bézier Glint/Spectral passes participate in the same ordered current-cubic prerequisite, so enabling several effects does not create independent CPU rails or a second Morph geometry.

`minimalTurn` now preserves both endpoint rails exactly. `polarSequence()` unwraps each rail internally, and the destination receives one global integer `2π` phase shift selected by a radius-weighted whole-rail cost. There are no post-selection non-equivalent angle clamps, so `t=1` is mathematically the authored destination and controls cannot choose independent wrap branches.

## Somata 6.8 — Spiral GPU/Bézier Iteration 8

- Strict Spiral detection follows Morph endpoints and the authoritative retained cubic resource for the entire polygon↔Spiral handoff.
- Lamps and Particles cannot silently fall back while the temporary render layer still looks polygonal.
- GPU Arc eligibility trusts the retained Spiral Bézier rail directly; effects no longer disappear because of provider metadata mismatch.
- Authored Spiral key/corner lamps use exact retained-cubic boundary attachments when possible, avoiding non-linear arc-fraction drift during morph.
- Minimal Turn adds neighbouring endpoint-travel continuity on top of shortest-angle, path-pair and handle guards.
- Runtime audit is iteration 8 and is endpoint/resource aware.

## Somata 6.8 iteration 7 — Morph-wide strict Spiral contract

A Spiral phase is identified by geometry ownership, not just by the temporary interpolated layer object. If a Morph endpoint is Spiral or the active layer owns the special retained Spiral Bézier resource, all dependent passes stay GPU-only for the whole transition. Missing GPU readiness causes a retry/wait, not a Canvas presentation fallback.

Minimal Turn now constrains angular travel at three levels: shortest representatives, neighbouring-control continuity, and per-cubic handle projection around endpoint travel. This preserves Bézier curvature while blocking hidden control handles from injecting a large visual turn.

### Somata 6.8 Iteration 5 — Arc lookup, exact Bézier position

For strict non-Fourier Spiral, the micro-arc buffer is now an **index/distance accelerator only** for Lamps, Particles and Web. Once a distance resolves to a micro-segment, the consumer maps that index back to the shared retained cubic and evaluates the cubic directly in WGSL. This keeps the arc table compact while avoiding chord-cutting on tight spiral turns. Tangent-sensitive particles also use the cubic derivative.

Minimal Turn additionally uses a whole-rail coherent angular phase plus a neighbour twist guard, while every control remains bounded to the shortest ±π representative.

# SpiroStar 6.3 — state / morph architecture

## Ownership layers

SpiroStar now separates persistent project data from animation-frame data.

1. **Canonical project state** — `state.layers`, saved project/playlist configuration.
   It is changed by user edits, project loading, and explicit morph commit boundaries.
2. **Morph runtime state** — `runtimeState.morph`, `runtimeState.minimalMorph`,
   `runtimeState.projectMorph`. It owns progress, prepared endpoints, derived frame layers,
   GPU phase serials, and temporary project-transition values.
3. **Resolved display state** — selected by `SpiroMorphController` with priority:
   **Green project morph > Orange transition > Blue morph > canonical**.
4. **Render/effect state** — consumes resolved display state and must not write animation
   results back to canonical project data.

## Blue morph

Blue Morph writes its visible scalar/profile frame to `runtimeState.morph.frameLayers`.
`state.layers` is read as the canonical source and is not rewritten on every rAF.

A single timeline is resolved by `SpiroMorphController.resolveBlueTimeline()`:

- `linearT` — absolute wall-clock progress;
- `transitionLinearT` — the active fade window when Fade mode is used;
- `geometryT` — exactly one easing transform of that linear progress.

No downstream renderer is allowed to ease the Blue timeline again. For `speedType=linear`,
`geometryT === linearT` (or the linearly remapped Fade window) apart from exact endpoint snapping.

Blue display values are committed to the canonical layer only at an explicit boundary.
The commit uses an allow-list of fields actually owned by Blue Morph instead of copying the
whole runtime layer object.

## Orange priority

When Orange starts a composition switch while Blue is active:

1. The currently resolved Blue visual state is explicitly committed.
2. Blue scheduled work is invalidated with a monotonically increasing phase serial.
3. Orange owns the transition window.
4. After Orange commits the new figure, Blue creates a completely new source/target phase
   from that new canonical figure.
5. A user's manual Blue pause is preserved and is never converted into an automatic resume.

Old boundary callbacks check the phase serial and cannot overwrite a newer Orange result.

## Green project morph

Green Morph keeps intermediate layers in `runtimeState.projectMorph.frameRenderLayers`.
It no longer replaces `state.layers` every frame. Its temporary global lamp configuration lives
in `runtimeState.projectMorph.frameLampConfig`.

`refreshLayerLookup()` follows the resolved display list, so target-only Green layers and effects
retain correct runtime indices without requiring canonical-state replacement.

## Lamp evaluation

`withLampConfig()` is a stack-scoped evaluation context. It never temporarily assigns
`state.lamps`. Nested Orange/Green/Blue preparation therefore cannot leak a temporary lamp
configuration into the persistent project or another renderer pass.

The fallback lamp configuration is the Green runtime lamp frame while Green owns the display;
otherwise it is the canonical `state.lamps`.

## Global palette hue

The Blue global Hue morph writes to `runtimeState.morph.frameGlobalHueOffset` during the cycle.
The saved `state.playlistPaletteHueOffset` is committed only at explicit boundaries. Manual Hue
editing operates from the currently visible offset and rebases the active Blue endpoint colors
without an accumulated hidden delta.

## Diagnostics

Browser console helpers:

- `__spiroMorphArchitectureStatus()` — current display owner, Blue phase serial and timeline state.
- `__spiroLampConfigContextStatus()` — lamp context depth and persistent-mutation flag.

Development invariant test:

```bash
node tests/refactor-invariants.js
```


## Green playlist ownership (6.3.2)

`runtimeState.projectMorph.active` means that the playlist Green clock is enabled. It does **not** imply render ownership.

`runtimeState.projectMorph.transitionActive` is the render-ownership flag. During Fade/Smooth hold time it is false, so Blue may continue to produce `runtimeState.morph.frameLayers` and remains visible. When the Green window begins, Green snapshots the currently resolved display layers plus the currently rendered geometry, sets `transitionActive`, and only then pauses Blue. The pause is runtime-only and must never commit the intermediate Blue frame into `state.layers`.

The intended ownership order is therefore:

`Green transitionActive > Orange transition > Blue active > canonical`.

A Green transition source may legitimately be an intermediate Blue frame. Canonical state remains unchanged until the target project is committed at the Green endpoint.
## Project / playlist persistence (Somata 6.4)

Project snapshots embedded in `.plist` files serialize persistent configuration, not live animation frames. The state/runtime boundary in `js/core/state.js` removes runtime-only fields from enumerable config objects; project serialization clones the complete remaining config for Corridor, Blue Morph, Orange Morph, TAP and Audio. Green Project Morph is playlist-level and is serialized with the same rule.

Camera pan is stored both in legacy CSS pixels and normalized to the canvas viewport. New saves therefore reopen proportionally across desktop/mobile sizes. Legacy files without normalized camera metadata keep their old pixel pan on desktop, while compact mobile loads reset that legacy pan to the centered origin.
## Smooth Spiral GPU Bézier path (Somata 6.5)

For an ordinary Smooth Spiral on the native WebGPU stroke backend, `js/legacy/app-a.js` keeps the final-space centripetal spline as cubic Bézier control points (`P0/C1/C2/P3`) instead of first producing the legacy 10–32 CPU samples per cubic. The geometry recorder applies the current affine transform once, stores compact cubic records, and the WebGPU vertex shader evaluates the curve into analytic capsule subsegments. Variable width and alpha are interpolated on the GPU. The same record is accepted by Base/effects and the Layer Scene batch.

The compatibility boundary is deliberate: Fourier deformation and Corridor rendering still use the pre-6.5 sampled path because those systems currently depend on pointwise centreline/copy transforms. Canvas and WebGL2 also keep the sampled fallback. This means the 6.5 optimisation does not alter Corridor brightness or fallback rendering semantics. GPU resources and staging arrays are pooled/reused and are destroyed on WebGPU device-generation changes.


## Spiral Morph phase continuity (Somata 6.6)

Phase-circle Spiral Morph treats an open spiral's first angular anchor as a real seam identity. Circle-plan preparation must not cyclically rephase the source or target sequence for spiral endpoints; differing anchor counts are handled by phase collapse/split mapping while preserving endpoint order. Signed spiral-order transitions use independent continuous winding-direction and radial-exponent carriers so `-K -> +K` cannot pass through the static enabled+zero-order fallback.

Rotation compensation is a viewport transform, not a mutation of layer geometry. During active Spiral Morph it computes the radius-weighted mean current rotation delta relative to the layers captured at Morph start and applies the exact negative angle to the main canvas transform. Because the baseline is the Morph origin rather than the current phase source, the compensation remains continuous when phases commit and new targets are prepared.

## 6.6 Spiral Bézier Morph GPU residency
Phase-circle Spiral Morph uses `js/gpu/spiral-bezier-morph-renderer.js` as a retained endpoint renderer. CPU builds source/target endpoint rails once per phase; WGSL performs polar endpoint interpolation, cubic evaluation, width interpolation and Corridor copy transforms per frame. When the layer's pass graph is GPU-compatible, the renderer targets `WebGPUStrokeRenderer.getExternalLayerSceneTarget()` and defers its command buffer into the existing Layer/Frame Scene. This avoids a GPU-canvas-to-Canvas2D bridge per layer. Per-layer copy and uniform buffers are required because the Frame Scene submits multiple layer command buffers after their individual render passes have been encoded.

Full Morph `Stop` is rollback, not commit: canonical `state.layers` is the last completed stable phase, while the live frame exists only in runtime state. Stop invalidates the runtime phase and parks Spiral GPU resources; resource destruction is deferred until replacement/idle cleanup so the UI click path does not synchronously tear down GPU buffers.


## Spiral Morph authoring limits and rotation compensation (Somata 6.6)

`spiralLayersMin/spiralLayersMax` belongs to the live Blue Morph target generator. It is not an authoring invariant. When `runtimeState.morph.active !== true`, manual layer creation, duplication and Spiral-mode editing must never be clamped by the configured Morph range.

Canvas rotation compensation is prepared once per Blue phase and consumed by `getMotionViewportTransform()`. It is deliberately mode-specific:

- `torn` — shortest authored rigid rotation only; topology re-pairing is not treated as a canvas rotation.
- `continuous` — unwrapped authored layer rotation, because N/K topology remains locked.
- `phase` — authored rotation plus the midpoint angular drift caused by changing spiral step/phase.
- `phaseCircle` — the rigid angular component of the actual circle anchor correspondence plan; deltas are combined with a circular mean so the ±180° seam cannot cancel a real half-turn.

Completed phases accumulate their compensation in `runtimeState.morph.spiralRotationCompensationBaseDeg`; the current phase contributes `spiralRotationCompensationPhaseDeg * geometryT`. Rebase carries the current fraction into the accumulator. The renderer therefore performs no per-frame geometry analysis for compensation, and GPU-native Spiral rendering receives the same viewport transform through the Canvas transform matrix copied into its WebGPU uniforms.


## Somata 6.7 — Spiral multi-layer GPU fast path and Minimal Turn

The retained Spiral Morph renderer owns compact source/target cubic Bézier rails for a complete Blue phase. For simple multi-layer Spiral scenes (no Fill and no later per-layer Outline/Profile/Motion/Sweep/Sprite/Web/Lamps/Particles/geometry-circle pass), it now encodes each layer directly into the persistent frame-global WebGPU source-over texture. The first queued command clears that texture; subsequent Spiral command buffers use `loadOp: load` and are submitted in layer order by the final compositor. This bypasses both the temporary per-layer texture and the fullscreen seal pass. If any pass needs exact per-layer interleaving, the renderer falls back to the established Layer Scene path.

The Spiral Bézier rail is intentionally lower density in 6.7: endpoint preparation is capped at 80 anchors on desktop and 48 on coarse-pointer devices, while each retained cubic is expanded into six short GPU capsule segments. No per-frame CPU curve tessellation is introduced. `prepareMainLayerVectorMaster()` also recognizes the retained Spiral renderer and does not pre-record an interpolated Canvas vector master unless a fallback consumer explicitly asks for CPU paths.

Rotation compensation is phase metadata, not geometry work. At phase preparation the engine selects the visible Spiral layer with the largest effective radius (`radius × radiusMultiplier`) as the reference layer. Phase-circle and Minimal Turn estimate the angular delta from that layer's real outer Spiral endpoint; the viewport applies the exact opposite angle using the same `geometryT`, making the outer reference angularly stationary. Torn / Continuous / Phase keep their own compensation laws.

`minimalTurn` is an enum value in the existing persistent `morph.spiralMorphType` field. Spiral geometry follows the same open-seam phase-circle rail as `phaseCircle`. Closed polygons use the minimum-motion circle planner instead: cyclic offsets and reversed closed-loop traversal are compared using physical chord travel, and the lower-cost correspondence is retained even when orbit topology changes. Reversing a closed traversal does not change the polygon's undirected edge set, so source/final stable shapes stay exact while intermediate vertex travel can be much shorter.

## Somata 6.7 hotfix — atomic Spiral phase handoff

A new Blue Spiral phase must never evict the currently visible retained Bézier resource before its replacement is ready. `WebGPUSpiralBezierMorphRenderer.preparePhase()` builds a separate next-resource map while the previous phase stays drawable. During this preparation window, the previous resource is pinned to `gpuPhaseHandoffT` (`1.0` at a normal cycle boundary, or the current fraction during an interactive rebase). Once all new buffers/bind groups are ready, the maps are swapped atomically and the old buffers are retired for deferred destruction. This prevents a one-frame WebGPU→CPU→WebGPU seam.

The retained Spiral rail also keeps a per-layer/per-path resampling count for the lifetime of a Morph run. A canonical endpoint therefore uses the same sampling lattice when it is the target of phase N and the source of phase N+1; target density from a newly randomized phase cannot silently change the spline approximation at `t=0`.


## Somata 6.8 — Spiral GPU Bézier contract (iteration 1)

For non-Fourier Spiral layers the visible contour is a retained cubic Bézier rail. Static Segment/Smooth/rounded profiles all enter WebGPU through that rail. `phaseCircle` and `minimalTurn` morph endpoints retain their exact cubic rails and equalize segment counts only by De Casteljau subdivision; no endpoint point-cloud spline fitting is allowed. The shared current-cubic buffer feeds the GPU Arc resource, and Morph Lamps, Particles, Web, Graffiti, Glint and Lightning consume that same resource. Canvas effect fallback is intentionally disabled for this Spiral contract to prevent mixed carriers.

`minimalTurn` performs per-control angular unwrapping to the nearest equivalent target angle, keeping each control's polar rotation on the shortest representative and preventing full-turn artifacts.

## Somata 6.8 — Spiral GPU Bézier contract (iteration 3)

Static Spiral geometry is validated by a compact content signature of the authored profile in addition to normal geometry revisions. Base stroke commands, the packed WebGPU cubic buffer, and the shared static effect resource all reject stale profile signatures together. This closes editor/import paths where a profile array can be mutated without a perfectly synchronized cache revision.

`minimalTurn` keeps the exact retained cubic rail and the ±180° per-control bound, but cyclic orbit pairing now scores several samples across each whole path. A candidate shift therefore cannot win just because its first point is close while the visible interior would perform a large twist.

The non-Fourier Spiral render contract remains GPU-only for the base and path-following effects. Effects consume either the current retained cubic buffer directly (for cubic-aware passes) or the GPU-derived arc table built from that same buffer; compatibility point views are not authoritative geometry.


## Somata 6.8 — Spiral GPU Bézier contract (iteration 4)

The visible special Spiral Morph pass is also the producer of the per-frame `currentCubics` buffer. When Base has already queued that compute in the deferred Layer Scene, later Arc/Graffiti/Spectral consumers reuse the same buffer by command-order dependency instead of repeating polar interpolation. This reduces GPU trigonometric work and, more importantly, makes the visible contour and every dependent effect read the same exact current control points in the same frame.

`minimalTurn` no longer delegates unequal orbit populations to the generic reference-angle pairer. Split/merge pairing evaluates several samples over each retained path, includes radial mismatch, preserves the existing fade-in/fade-out population semantics, and still applies the per-control ±180° angular representative.

Static Spiral GPU cache signatures include the complete geometry carriers that can be edited directly (profile, N/K, radius, multiplier, rotation, step/linking, order and closure/rounding flags), so a profile edit cannot leave Base and effects on different generations of the retained cubic rail.

## Somata 6.8 Spiral invariant — iteration 10
A non-Fourier Spiral has one retained cubic Bézier carrier. Static and Morph renderers expose that same carrier to the GPU Arc resource. Distance consumers use the compact six-micro-interval Gauss-3 arc table, then apply a local closed-form endpoint-speed inversion to recover a better Bézier parameter without densifying the rail. Authored profile corners survive De Casteljau normalization as metadata and are consumed by GPU Web classification. Minimal Turn uses one global equivalent polar phase per path; cubics whose remaining control travel exceeds 180° switch to exact-endpoint Cartesian control interpolation, so the shared current-cubic buffer cannot corkscrew from a bad polar branch. Strict Spiral rendering/effects remain in WebGPU scene targets; Canvas may be used only as a transform/state calculator in legacy orchestration, never as a Spiral raster/composite fallback.

## Somata 6.8 Spiral invariant — iteration 11
Minimal Turn selects its safety interpolation metric per retained path, never per cubic, because adjacent cubics share a knot and must use the same interpolation law. The ordinary least-turn path remains polar with one global equivalent 2π branch; a pathological path switches as one unit to endpoint-exact Cartesian cubic interpolation. In deferred Spiral Layer Scenes, Base/Glow's current-cubic compute is the ordered root producer. Effect command buffers execute after that root and reuse the same buffer; only unrelated/independent encoders emit their own prerequisite. This reduces duplicate GPU work without weakening dependency correctness. Strict non-Fourier Spiral rasterization remains WebGPU-only; Canvas APIs may be consulted for transform/state values but are not a Spiral raster/composite backend.

### 6.8 Iteration 12 — strict Spiral residency

For non-Fourier Spiral, WebGPU is now a hard residency contract rather than a preferred backend. The visible stroke and all Spiral effects consume retained cubic Bézier controls or the shared GPU arc derived from those controls. A WebGPU scene is never downloaded/composited through Canvas2D merely because a pass is warming; the layer retries on the following frame. Static profile edits rebuild compact per-span mapped Hermite cubics, while Morph Key/Corner lamps attach to exact retained cubic boundaries.

### 6.8 Iteration 13 — phase-gated effect residency

Strict non-Fourier Spiral treats the retained cubic rail and its Bézier-derived Arc as a phase resource. The visible morph clock does not advance until the special Spiral rail and active GPU effect graph have been warmed and allocated. Render-graph capability selection is backend-contract based rather than transient readiness based, so a warming GPU pass cannot trigger CPU path materialization. Final presentation also keeps the no-GPU-to-Canvas rule for deferred lamps. Minimal Turn adds a path-wide visible-spin threshold on top of exact global 2π alignment and centre singularity handling.


### 6.8 Iteration 14 — strict graph purity + stable minimal turn

For non-Fourier Spiral, native fill does not ask the capability graph for a parallel sampled CPU shadow path. Marker placement may still be prepared on CPU, but its pixels remain GPU-rendered; the named Spiral effects use the retained cubic/Arc GPU resources. The GPU-only presentation latch is frame-local. Minimal Turn computes one radius scale for the complete retained cubic rail before evaluating angular motion; high coherent visible angular travel switches the entire path to endpoint-exact Cartesian cubic interpolation, preserving C0 continuity and preventing control-order-dependent spin decisions.


### 6.8 Iteration 15 — ordered Base→Arc reuse and hard GPU-only failure semantics

A strict non-Fourier Spiral may not enter compatibility rendering even as an exception recovery path. Pass isolation therefore suppresses compatibility callbacks and session-level compatibility trip switches for strict Spiral frames. GPU warmup/fault recovery is frame-based.

The retained Spiral Base command is also an ordered producer of `currentCubics`. If the shared Arc is requested later in the same deferred LayerScene at the same morph parameter, the Arc prerequisite consumes that already queued buffer and runs only Bézier arc integration/prefix stages; it does not dispatch the polar current-cubic compute again. Independent encoders keep the self-contained prerequisite rule. Minimal Turn evaluates coherent angular travel of the outer visible rail and uses one path-wide endpoint-exact Cartesian fallback before a visually large spin occurs.


### 6.8 Iteration 16 — hard presentation boundary and retained-Bézier Minimal Turn pairing

Strict Spiral's GPU-only rule now includes the final presentation boundary. A compositor failure discards the failed GPU frame queues; it never performs GPU-texture → fallback canvas → Canvas2D. During Spiral Morph, legacy CPU-path materialisation is explicitly blocked and diagnosed. Minimal Turn path correspondence is evaluated from the same retained endpoint cubic rails that are later interpolated/rasterised, using arc-distributed Bézier samples; this aligns pairing decisions with visible geometry instead of a separate source point list.


### 6.8 Iteration 17 — GPU-Arc line profiles and coherent Minimal Turn guard

Strict non-Fourier Spiral now extends the retained cubic contract to discrete line-profile markers. The render graph does not request `CPU_PATH` for `slash`, `square`, `circle`, or `cross`; it prepares only scalar style/count metadata. Marker centres are located from the shared GPU Arc, and each selected micro-interval is mapped back to the authoritative retained cubic Bézier in WGSL before rasterization. Core, marker glow, and marker outline are encoded into the resident WebGPU Layer Scene, with no hidden presentation canvas or Canvas2D composite bridge.

The profile pass participates in the common GPU prerequisite scheduler, so retained-current-cubic production and cubic-arc integration remain ordered and shared with Lamps, Web, Particles, Glint/Lightning and sampled Graffiti. This removes another CPU shadow geometry path from Spiral mode without increasing Bézier subdivision density.

Minimal Turn additionally scores coherent signed angular motion on the visible outer rail. A path whose outer controls would rotate together by a perceptually large amount uses one path-wide endpoint-exact Cartesian cubic interpolation law. The fallback remains path-wide to preserve shared knots and does not alter either morph endpoint.

### 6.8 Iteration 18 — independent retained-Bézier root + texture-only Final

Strict non-Fourier Spiral no longer makes the Base retained-Bézier Layer Scene conditional on transient readiness of optional effects. Base/Glow may establish the resident GPU scene as soon as the Spiral scene target and final compositor are usable; Web, Lamps, Particles, Sweep, profile markers and sampled Graffiti attach later through the same ordered GPU prerequisite scheduler. If Base is intentionally replaced or hidden (for example Profile/Graffiti/effects-only rendering), a transparent WebGPU Layer Scene root is created so effects still remain GPU-resident without introducing a Canvas2D carrier.

The final strict-Spiral presentation path is texture-only. When a resident GPU Layer/Frame Scene exists, Final does not upload `mainCanvas` as a lower layer, and it refuses presentation if scene-hot Canvas2D raster work occurred. A transient final-compositor failure keeps the previous valid WebGPU frame visible rather than exposing the compatibility canvas. Strict multi-layer seal failures and geometry-circle warmup likewise retry on GPU instead of materializing deferred GPU scenes through Canvas2D.

`materializeDeferredLayerScene()` also enforces this as a central firewall rather than relying only on each caller, and strict Spiral suppresses late Canvas2D vignette rasterization when the final compositor is warming.

Glow/Base fusion remains enabled when Web is active in strict Spiral, because Web is appended to the resident scene after the root producer. This prevents a separate Glow command from consuming the single external Layer Scene root before Base can encode. Minimal Turn additionally applies a coherent visible-spin guard at 22.5 degrees; if the retained outer rail would rotate farther as a unit, the whole path switches to endpoint-exact Cartesian cubic interpolation. The switch is path-wide, preserves shared knots and exact morph endpoints, and eliminates large apparent rotations without per-cubic discontinuities.


### Iter34 profile carrier validation
Static Spiral profile geometry retains per-span final-space cubic Bézier controls produced directly from the nonlinear profile→Spiral mapping (interpolating mapped values at t=1/3 and 2/3). The retained Base and effects use those controls; a profile preset change does not trigger a second curve fit. Textures receiving `copyExternalImageToTexture` are created with both `COPY_DST` and `RENDER_ATTACHMENT` as required by Chromium/Dawn, in addition to sampling usage when applicable.


### Iter35 frozen Spiral profile carrier

Profile mapping owns the retained curve. Once a Spiral profile edge has passed nonlinear mapping, final-space rounding and closure repair, `buildOrbitPolylines()` freezes its cubic Bézier rail on the path/points object. Static Base, GPU Arc/effects, Corridor recording and Morph endpoints consume that same rail. No downstream subsystem is allowed to infer a different spline from a reduced point list.

## 7.0.3 shader validation hotfix

The Smooth Spiral Bézier WGSL must compile before the shared stroke renderer can become ready. A WGSL precedence violation in `joinedTangent()` (`&&` mixed with `||` without explicit grouping) previously invalidated the base Spiral pipeline and cascaded into dependent GPU passes. 7.0.3 fixes that shader only; the strict Full-WebGPU/no-fallback policy is unchanged.


## 7.0.4 Graffiti carrier contract
In Corridor, a Graffiti profile may use the hidden retained carrier exclusively to rasterize Glow into the resident WebGPU LayerScene. This permission never authorizes Base rendering; the visible core remains the Graffiti ribbon renderer.


## 7.0.5 Spiral Morph render-layout contract

The retained Spiral Morph renderer has four render-pipeline variants: capsule MAX, capsule source-over, Uniform MAX and Uniform source-over. They switch inside the fused Glow+Base render pass. WebGPU `layout: 'auto'` bind-group layouts are pipeline-private even when their inferred bindings are structurally identical, so a bind group created from one auto-layout must never be set on another pipeline. Somata 7.0.5 gives all four variants one explicit `GPUPipelineLayout` built from shared uniform/cubic/copy bind-group layouts. This keeps the fused pass Full-GPU and validation-safe without introducing a fallback path.

## 7.0.6 Graffiti / Spiral hidden-carrier contract

Graffiti replaces the visible Base stroke, but several effects still need the exact Spiral carrier as geometry. In strict FullGPU mode that carrier has two distinct responsibilities: it may produce analytic Glow/Arc data, but it must never become a visible ordinary Base line. The Base pass therefore records an intentional suppression instead of a renderer failure.

For Corridor, the static retained-cubic master builder accepts `lineProfileStrokeOnly` only through an explicit `allowHiddenGraffitiCarrier` flag. For an active Spiral Morph, Graffiti Glow bypasses the generic dynamic Corridor recorder and uses the authoritative retained current-cubic Spiral renderer directly. The deferred LayerScene root is owned by the real Glow producer when Glow is enabled; an empty effects root is created only when no carrier pass can own it. This avoids the previous single-slot collision where preflight reserved the LayerScene and the actual Glow producer subsequently appeared unavailable.

The same exception is propagated through the multi-layer FrameScene join guard. A hidden Graffiti carrier is therefore considered a valid FullGPU participant before pass execution, preventing the scheduler from retrying the layer indefinitely when a previous layer already owns the frame-global scene.


## 7.0.7 hidden Graffiti carrier recording

Graffiti suppresses ordinary Base, but its Glow still needs the exact carrier rail. Static Spiral now records that carrier only when a GPU effect explicitly requests `allowHiddenGraffitiCarrier`; the normal draw path continues to suppress it. The resulting commands remain resident and can be consumed by the WebGPU LayerScene without Canvas presentation.

## 7.0.9 workspace fullscreen gesture

Desktop mouse double-click is owned by the visual workspace (`#mainContainer`) rather than the legacy `mainCanvas`. This keeps the gesture independent of which WebGPU presentation surface is currently visible. Interactive viewport controls are excluded. The gesture toggles the existing native fullscreen path and therefore preserves the same view-centering/restoration contract.


## 7.0.11 phase-circle atomic lamp contract
For phase-circle Spiral Morph, enabled lamps make the WebGPU lamp pipeline and Exact Arc resource phase-critical. The next phase does not release its visible clock until its retained Bézier rail and Lamp Arc belong to the same `gpuPhasePrepareSerial`. Web/other optional consumers remain asynchronous. FullGPU diagnostic faults are frame-local and bounded.


## 7.0.12 effect benchmark console profiler

The benchmark profiler observes the existing FullGPU frame graph; it does not add a Canvas, WebGL, or Fast-GPU rendering route. While a benchmark is active, CPU render-pass sampling is raised to every frame and whole-frame WebGPU timestamp sampling is temporarily increased. Arc/Web/Web-corner/Lightning/Lamp/Final renderer numeric counters are snapshotted before and after the run and reported as deltas.

Console API:
- `__somataFxBenchStart('baseline', 8)`
- `__somataFxBenchStop()`
- `__somataFxBenchStatus()`
- `__somataFxBenchLast()`
- `__somataFxBenchCompare()`

For meaningful A/B runs, keep the same scene, Morph state, Corridor state and viewport, and change only the tested effect.

## 7.0.13 Corridor brightness contract

Corridor depth is geometric, not an implicit opacity control. `getTunnelCopies()` now emits `copy.alpha = 1` for active Corridor copies and retains the historical `0.08..1` depth curve only in `copy.depthAlpha` for diagnostics. A normally visible copy therefore preserves the authored layer/stroke brightness regardless of its position in the Corridor.

Visibility attenuation is applied only by explicit mechanisms in `prepareTunnelVisibleInstances()` / `prepareTunnelLampInstances()`: temporal oversize exit/entry fade, sub-pixel size fade, and (for strokes only) central density weighting that prevents micro-copy overdraw. This keeps the center stable without causing medium/large Corridor figures to breathe in brightness while they travel.

