# Somata 7.3.7

## Spiral shader startup repair

- Fixed the strict-Spiral tangent-repair WGSL startup failure introduced in 7.3.4: the shader used `do`, which is a reserved WGSL keyword. The output tangent is now named `dout`, so the retained-cubic Spiral renderer can initialize and create Base/Glow resources again.
- This also restores default Blue Morph startup for Spiral projects such as `Святой`: `prepareMorphCycle()` no longer stalls behind a permanently failed Spiral renderer.
- Added a regression invariant that rejects reserved `do` declarations in the embedded tangent-repair WGSL and checks the factory `Святой` Morph+Corridor defaults remain enabled.
- Runtime/build/cache identifiers are 7.3.7 / `20261012-v737`.

# Somata 7.3.6

## Atomic project defaults / Spiral startup repair

- Project activation now quiesces the previous runtime Corridor before committing new project geometry, then applies the target Corridor default before Blue Morph starts preparing any strict-Spiral GPU phase resources. This fixes projects such as `Святой` where both Morph and Corridor are enabled by default.
- The post-paint verification no longer replays the complete default-mode transition while Blue is inside its exact-start/GPU-prewarm handoff; it only repairs missing scheduler ownership.
- `tunnel.active` is now truly runtime-only: project serialization no longer writes the transient active flag. `tunnel.defaultActive` remains the sole persisted startup command.
- Manual playlist selection, first-project playlist activation, direct project loading and Green target commits all use the same Corridor-before-Morph ordering.
- Project-boundary Corridor teardown can be silent, preventing a half-loaded intermediate frame from being rendered while layers/canonical Spiral resources are being replaced.
- Added a factory regression contract for `Святой` (Spiral + Morph default + Corridor default) in addition to the existing `Мозголом` coverage.
- Default FPS cap remains 60. No Canvas/CPU strict-Spiral fallback was added.
- Runtime/build/cache identifiers are 7.3.6 / `20261012-v736`.

# Somata 7.3.5

## Project / playlist default-mode activation

- `Коридорить по умолчанию` and `Морфить по умолчанию` are now activation commands applied after the target project has been fully committed, rather than mixed into the settings loader at different points. The same owner is used for direct project files, manual playlist project switches, and the first project activated when a playlist opens.
- Corridor `active` is runtime-only. Legacy project snapshots containing `tunnel.active` can no longer make `setTunnelMode(true)` believe the Corridor scheduler is already running; only `tunnel.defaultActive` controls project startup.
- `setTunnelMode(true)` is idempotent and always repairs/registers the single scheduler task without resetting an already-running Corridor phase.
- Default-mode activation is verified once after the committed project's first paint. This covers startup ordering without creating a second transition or a fallback path.
- Green project transitions apply their target defaults directly at the atomic target commit, avoiding a stale deferred activation during the next Green transition.
- The default FPS cap remains 60. No Canvas/CPU strict-Spiral fallback was added.
- Runtime/build/cache identifiers are 7.3.5 / `20261012-v735`.

# Somata 7.3.4

## Web 6.7 semantics / Corridor validation / spline-Morph continuity

- Fixed the native `Самопересечения + коридор` WebGPU validation failure. The cross-copy Web pipeline now declares the same `Depth24PlusStencil8` attachment state as its render pass; its stencil compare is `always`/read-only so cross-copy links keep the unclipped 6.7 behaviour instead of being cut by one copy's contour mask.
- Restored the 6.7 `В углах` depth rule on the canonical retained-cubic Arc. A GPU span pass measures each accepted corner to the neighbouring **detected** corners along the complete path; closed contours and self-similar periodic Spiral wrap by one canonical period.
- Removed the 7.3.3 post-compaction clamp that reduced corner threads back to one Arc microsegment. `Глубина в угол` can therefore extend across the intended contour distance again.
- `Самопересечения` keeps the historical quarter-perimeter depth rule (`25% of path length × depth × multiplier`), but point lookup remains on the modern exact retained cubic Arc. Periodic Spiral wrapping applies its rotate+scale period transform rather than pretending the Spiral is an ordinary closed polygon.
- Added a canonical spline tangent-repair compute pass after current-cubic interpolation/periodic closure and before Fast Rail / Exact Arc consumers. Technical De Casteljau equalisation cuts can no longer become visible G1 saws at intermediate Morph frames. Segment profile endpoints remain intentionally angular; spline strength follows the source/target profile modes across the transition.
- Re-audited project-local `Морфить по умолчанию`, `Коридорить по умолчанию`, and Orange/default-mode activation against 6.7. Their authoritative project/playlist application logic is preserved and is now covered by a dedicated regression invariant; the 7.3.3 invalid Web command buffer could previously make those modes appear to have failed visually.
- No Canvas/CPU strict-Spiral fallback was added. The default FPS cap remains 60.
- Runtime/build/cache identifiers are 7.3.4 / `20261012-v734`.

# Somata 7.3.3

## Web placement / Corridor cross-links / Spline authority repair

- Fixed GPU Web indirect-compaction overflow: the last 256-thread workgroup can contain surplus lanes, and those lanes now stop against the compacted active-corner count before reading a corner index. This removes stale-index fan/triangle artefacts such as those visible in `Мозголом`.
- `В углах` restores the historical semantics on the canonical retained-cubic Arc: authored structural corners are preferred; rails without authored markers fall back to angular logical-boundary classification; accepted corners get a full placement target; thread depth is bounded by the exact incoming/outgoing logical-cubic Arc span.
- Technical Bézier microsegment ends are no longer added as independent Web corner candidates. Web classification stays on logical retained-cubic boundaries.
- `Самопересечения + коридор` no longer leaves the native Web bridge. Cross-links between adjacent Corridor copies are emitted by the same fused WebGPU renderer from the compacted canonical corner list, preserving the historical 64-corner cap and avoiding Canvas/WebGL compatibility ownership conflicts.
- Static Spiral Web is routed through `currentGpuBezierResourceForFrame()` as well as Morph Spiral, so the same canonical retained resource drives both states.
- Strict Spiral Layer Scene ownership now trusts only the resident scratch record, not the frame-wide `gpuLayerSceneDeferred` history flag. The strict GPU root is opened before multi-layer ordering checks when ordered Web/Fill/Corridor consumers require it.
- `profileMode='spline'` is authoritative throughout static geometry, Spiral retained carriers, Morph endpoint preparation and Morph budgets. A stale `splineRenderMode='discrete'` can no longer downgrade a Spline profile to square/discrete polyline geometry; discrete rendering remains a Segment-profile behavior.
- No strict-Spiral CPU/Canvas Web fallback was added. The default 60 FPS cap is unchanged.
- Runtime/build/cache identifiers are 7.3.3 / `20261012-v733`.

# Somata 7.3.2

## Sex preset / indexed Corridor regression repair

- Fixed a 7.3.1 `ReferenceError: segmented is not defined` in the indexed Morph Corridor renderer.
- The indexed Corridor pass now derives Uniform/Segmented layering from the resident Morph record inside the helper that encodes the draw, so `circleSlide` cannot lose Base/Glow before joining the FullGPU Layer Scene.
- This prevents the downstream strict-Spiral materialization cascade (`SPIRAL_BASE_GPU_UNAVAILABLE`, `SPIRAL_BASE_MISSING_AT_FRAME_END`, `STRICT_SPIRAL_MATERIALIZATION_ATTEMPT`, `FINAL_FULL_GPU_PRESENT_FAILED`) caused by that exception.
- The factory project `Секс` is covered by a dedicated invariant because its 3-layer + Corridor + `circleSlide` combination reliably exercises this path.
- Runtime/build identifiers are 7.3.2 / `20261012-v732`.

# Somata 7.3.1

## Spiral lamps, generic line layering, and cross-family Morph repair

- Spiral Lamp **Key** and **Corners** are separate identity domains again. Key uses only authored profile key markers plus path endpoints; geometric corner flags and exact De Casteljau equalization cuts can no longer become Key lamps.
- Spiral **Corners** lamps pin directly to the current retained-cubic corner boundary. A smooth Spiral with no authored corners is an authoritative empty result, not a FullGPU Arc-resource failure.
- The Spiral profile builder no longer ORs `__profileCorner` into `lampCornerFlags`; this removes the regression where Key visually mirrored the bend/corner mode.
- Exact Arc frame caching is authority-aware. After a retained Spiral atomic phase swap, a stale/null same-frame Arc decision is rejected and rebound to the current canonical cubic rail instead of leaving Lamps in `strict-spiral-arc-wait`.
- **Равномерный / Сегментный** is now the generic **Тип наслоения** setting for line rendering, not “Тип линии спирали”. `lineLayerMode` applies to supported Base/Glow/Morph/Corridor GPU stroke passes; old `spiralLineType` project data is migrated as a compatibility alias.
- Uniform mode keeps non-accumulating MAX coverage where supported. Segmented mode uses source-over segment accumulation, including Glow, so the setting describes overlap semantics rather than Spiral geometry.
- Spiral↔non-Spiral `phase`, `phaseCircle`, and `minimalTurn` transitions keep exact endpoint cubics and exact De Casteljau normalization, but use one Cartesian transport decision for the whole retained path. This removes the saw/tooth discontinuities caused by independently polar-interpolating technical split cubics.
- Existing Spiral Morph design contracts remain enforced: phase modes preserve the authored open Spiral seam/order, Minimal Turn selects one metric per retained path, and the retained cubic rail remains the single contour authority for Base and exact effects.
- The 60 FPS default cap is preserved. No Canvas/CPU strict-Spiral fallback was added.
- Runtime/build/cache identifiers are 7.3.1 / `20261012-v731`.

# Somata 7.3.0

## Strict Spiral scene ownership + Lightning Glow repair

- Strict Spiral now has one retained-cubic Base/Glow owner in Corridor for both Morph and static frames. The generic Corridor stroke path no longer steals strict-Spiral Base/Glow ownership.
- Static Spiral Fast Visual Rail resources are now valid while Corridor is active; the stale `tunnel.active -> null` gate that produced `staticVisualResources: 0` after Morph stop/rebase is removed.
- Retained Spiral rendering can join an already-resident GPU Layer Scene without re-requesting the external-root slot. Resident commands are queued instead of being misclassified as new roots.
- Ordered strict-Spiral scenes use GPU prerequisite phases Morph 1 / Exact Arc 2 / Glow 3 / Fill 4 / Web 4.5 / Base 5, preserving Web-under-Base while keeping one canonical contour authority.
- Lightning keeps exact retained-Arc core placement, but Glow is now generated from the exact narrow-strike GPU mask by separable GPU blur. The old expanded per-microsegment halo path that produced radial wedges on curved Spirals is not used as a warming fallback.
- Inside/Outside Lightning blur composites through the existing stencil mask, and the stencil is preserved across multiple halo passes before the core composite.
- The 60 FPS default scheduler cap from 7.2.9 is preserved. No strict-Spiral Canvas/CPU geometry fallback is added.
- Runtime/build/cache identifiers are 7.3.0 / `20261012-v730`.

# Somata 7.2.9

## Default 60 FPS scheduler cap

- Added **File → Settings → FPS limit** with a default value of **60** and persistent local preference.
- The single-rAF scheduler now phase-locks animation tasks and heavy scene paints to the selected cap before any render work begins.
- A rolling due-time keeps the limiter close to the requested rate on 120/144 Hz displays instead of using a crude every-Nth-refresh divisor.
- No geometry quality, DPR, effect count, canonical Spiral, Fast Rail, Exact Arc, or backend fallback policy was changed.
- Added FPS-limit invariants and scheduler diagnostics (`fpsLimit`, `fpsFrameIntervalMs`, `fpsGateSkips`).

# Somata 7.2.8

## Canonical Spiral Fast Rail + compute-once Web geometry

- The retained Bézier Spiral remains the single source of truth. Dynamic Morph cubics are generated first and periodic rotate+scale/C1 closure is patched before any derived visual data is produced.
- Base/Glow/Corridor now rasterize a resident **Fast Visual Rail**. One GPU compute pass samples each canonical cubic at the existing 12 visual subdivisions; the raster shader reads those segment endpoints and widths instead of re-evaluating the cubic for every vertex and every Corridor copy.
- Static Spiral reuses its existing canonical cubic buffer and builds the derived Fast Visual Rail once when the static visual resource is created. It does not run Morph cubic compute.
- GPU Web now builds one resident `{A, Control, B}` record per active master thread during active-thread compaction. Exact retained-cubic Arc is sampled only twice per visible thread; all bevel/rounding vertices and Corridor copies reuse the result.
- Web raster shaders no longer contain path binary search, periodic wrapping, Arc inversion or retained-cubic evaluation. Those correctness-sensitive operations remain in the one-time GPU thread-geometry compute stage.
- Exact-Arc consumers are intentionally unchanged in this release. Fast Visual Rail is a derived raster view, never an independent contour authority. No Canvas/WebGL/CPU fallback was added.
- Runtime audit/build/cache identifiers are 7.2.8 / `20261011-v728`.

# Somata 7.2.7

## Web GPU pressure / fused Halo + Core

- The native topology-Morph Web renderer no longer rasterizes every thread twice (Halo then Core) through separate 4x-MSAA scratch passes. Halo and Core are emitted together by one fragment invocation into two single-sample MAX-union render targets.
- The two Web scratch textures are composited into the resident Layer Scene once with the exact premultiplied `Core over Halo` equation. Existing analytic fragment coverage supplies edge antialiasing, so the redundant 4x-MSAA resolve path is removed without changing the 12-step rounded-thread geometry.
- The compatibility/CPU-command WebGPU renderer now uses the same fused dual-attachment path, including Corridor copies. Outside/multi-path Web variants therefore do not fall back to the old double-pass 4x-MSAA workload.
- No Canvas/WebGL/CPU presentation fallback was added. The optimization remains GPU-resident and preserves stencil clipping, MAX-union overlap semantics, Corridor copy transforms and existing thread counts.
- Runtime audit exposes the fused Web contract and build/cache identifiers were bumped to 7.2.7 / `20261011-v727`.

# Somata 7.2.6

## Dynamic Corridor Morph stays GPU-resident

- Dynamic Corridor Fill no longer enters the Canvas2D mask path during Morph. `prepareLayerFillMaskGPU()` explicitly rejects the dynamic-Corridor-native contract, so the old GPU → Canvas-mask → GPU/wait mixed path cannot occur for this case.
- The native Fill path reuses the exact frame-resident dynamic Morph command rail already produced for Corridor Base. Closed dynamic subpaths are packed into the existing stencil-fan renderer without rerunning the geometry evaluator.
- Dynamic Fill uses a persistent grow-only GPU vertex buffer per logical layer. Each frame updates only the active vertex prefix; no extra WGSL binding, readback, canvas upload, or per-frame GPU buffer recreation is introduced.
- Dynamic command points are already in screen space, so Corridor Fill copy transforms now apply the same scale/lag similarity around the render origin as Corridor Base instead of applying the layer transform twice.
- Web/Motion/Sprite effects are no longer blanket reasons to abandon the resident Corridor Layer Scene when their direct GPU bridge is available. Particles remain conservatively gated until their ordering contract is equivalent.
- Runtime/build identifiers and cache epoch are bumped to 7.2.6 / `20261011-v726`.

# Somata 7.2.5

## Corridor resident Fill + Morph rebase

- Corridor Fill + Glow now share one resident WebGPU Layer Scene by construction. Glow may become the scene root only after native Fill preflight proves that the exact static Fill mesh can join the same texture; Fill and Base then append in phases 4 and 5. This removes the healthy-WebGPU `corridor-gpu-wait` loop caused by the old blanket `fillRequested` rejection.
- The preflight reuses the exact canonical native Fill mesh in the Base pass, so Glow/Fill cannot disagree about topology inside one frame. No Canvas bridge, GPU readback, extra texture, or extra WGSL binding is introduced.
- All Circle Slide variants now skip the generic dense endpoint topology snapshots. Those snapshots were not consumed by Circle Slide; an Orange/Minimal instant switch that introduced a Chaos layer could nevertheless synchronously build both dense endpoints during Blue rebase and trigger a 100+ ms main-thread task.
- Chaos Circle Slide remains dynamic without dense endpoint snapshots and uses its dedicated direct frame path evaluator; rasterization continues through the existing GPU geometry path where eligible.
- Runtime/build identifiers and cache epoch are bumped to 7.2.5 / `20261011-v725`.

# Somata 7.2.4

- Все локальные JS/CSS получают единый cache-busting `?v=20261011-v724`, чтобы браузер не смешивал файлы разных сборок.
- Добавлена полностью inline boot-диагностика: она показывает URL ресурса, HTTP-статус, Content-Type и rewrite в HTML даже если основной error-overlay.js не загрузился.
- Добавлен 15-секундный watchdog запуска для случаев «загрузился только index.html».
- Диагностика ранней загрузки умеет копировать весь отчёт одной кнопкой.

# Somata 7.2.3

- Fixed WebGPU buffer lifetime races that could permanently poison Morph rendering: deferred Sweep instance/mask buffers and Web corner growth state are now retired through the shared two-frame + `queue.onSubmittedWorkDone()` recycler instead of being destroyed before frame-wide submit.
- Added a WebGPU resource-lifetime circuit breaker: a burst of `used in submit while destroyed` uncaptured errors intentionally resets the GPU device generation so all renderers rebuild instead of looping on dead resources.
- Added regression invariants for the two buffer labels seen in the 7.2.2 failure log.

# Somata 7.2.2 — Corridor Fill deadlock + console state

- Fixed a Morph deadlock where a final Corridor Fill could report `GPU Layer Scene target unavailable`, then enter `corridor-gpu-wait` with Canvas fallback blocked forever.
- The safe strict-Spiral late-overlay recovery now keys off both the entry intent and the already-raised per-frame FullGPU presentation latch, so it still works when the temporary Morph display layer no longer carries the authored Spiral tag.
- The resident strict-Spiral GPU prefix is never read back to Canvas; only the last compatibility layer may use the existing top-overlay path when its scratch GPU Layer Scene is unavailable.
- The in-app console now starts collapsed/minimized. Opening it from FPS preserves the current collapsed/expanded state.
- Auto-show reveals the console without forcing expansion. New errors keep the user's manual collapsed/expanded choice; Clear and Close no longer reset that choice.
- Version bumped to 7.2.2 and changed runtime files are cache-busted with `v722`.

# Somata 7.2.1 — Spiral Morph frame-residency hotfix

- Fixed repeated GPU → Canvas → GPU materialization when a strict Spiral Frame Scene was followed by a last compatibility/Fill layer during Morph.
- The resident Spiral prefix now stays on WebGPU; a last non-Spiral compatibility layer may be uploaded once as a late Canvas overlay and composited on top by Final WebGPU.
- Corridor Fill may use its exact Canvas path only in that explicitly ordered late-overlay case; the strict Spiral layer itself remains Canvas-forbidden.
- Added frame-local overlay state reset and cache-busting for the changed compositor/runtime files.
- Version bumped to 7.2.1.

# Somata 7.2 — File menu / playlist load / GPU diagnostics

- Reordered File menu into Project actions, a clear separator, then Playlist actions.
- Playlist open/import avoids redundant JSON stringify/parse deep clones of freshly parsed projects; multi-file project import reads/parses files concurrently.
- `default.plist` now uses normal browser HTTP caching instead of forced `no-store`, reducing repeated network cost on deployed sites.
- Recoverable FullGPU frame-contract states and GPU warm-up/wait diagnostics are throttled warnings, not red application errors; actual renderer/device/WebGPU validation failures remain errors.
- Runtime/version label updated to 7.2.
- Morph freeze diagnostics now record >=100 ms frame gaps, >=50 ms scheduler/render/phase-boundary work, browser Long Tasks, scheduler-watchdog recoveries, and >120 ms WebGPU phase-prewarm waits. Reports include a measured/likely cause, Morph progress/mode, recent GPU fault correlation, FPS/render/GPU timing, and top sampled CPU passes; `[Somata Morph Freeze]` is mirrored into the in-app console and included by “Копировать всё”.


## 7.0.13 — Graffiti Glint profile + post-profile GPU ordering

- Shared Glint and Lightning preflash now reuse the exact Graffiti ribbon geometry when the layer uses Graffiti: nib shape, Marker Angle, joins and width come from the same renderer instead of a round centreline capsule.
- Glint Glow is generated from that ribbon contour with the WebGPU contour-blur path; the Glint softness value is now forwarded to the contour blur profile.
- Graffiti overlay rendering now retains the current WebGPU canvas texture for the frame and exposes a post-Graffiti target. Lightning/Glint are encoded into that same target when the Graffiti core is on the transparent WebGPU overlay, so they cannot end up physically below Graffiti on `mainCanvas`.
- Deferred Glint/Lightning commands are ordered after Graffiti core (`40/41` versus `19/20`).
- Bézier Glint preparation retains cubic break markers so disjoint moving windows are not accidentally joined when converted to a Graffiti ribbon.
- No Canvas2D presentation fallback was added; failed post-Graffiti GPU encoding remains diagnostic.
## Shared Glint / Lightning preflash controls + GPU visual semantics

- `Проблеск` is now one shared settings block for both standalone Glint and the Lightning pre-strike phase: Moving/Spectral mode, length, Core opacity, real thickness, Glow brightness, intensity, size and softness.
- Removed the duplicated Lightning preflash UI (`Lightning Flash` colour/mode/opacity/length and separate pre-glow intensity). Historical fields remain migration-only so older projects preserve their look.
- Shared Glint thickness defaults to **75%** and is literal on Canvas/WebGL/WebGPU paths; hidden 2 px/brightness-based widening was removed.
- Core opacity now affects only the Glint/Preflash Core. Glow brightness affects only the halo and no longer changes Core colour, width or alpha.
- The Lightning visual subsection is directly below the shared Glint section. `Использовать мультипликатор проблеска` is enabled by default at **×2**: brightness, intensity and glow size are multiplied from Glint, while softness is inherited unchanged. Disabling the checkbox unlocks independent Lightning brightness/intensity/size/softness controls.
- Moving Glint length now supports the full 1–100% range across canonical/Bézier/GPU Morph paths.
- Old Lightning projects are migrated before default filling, including project settings templates, so the former pre-glow scale is converted into the new shared Glint + Lightning multiplier contract.

## Corridor center shading / delayed GPU birth

- Added `Затенение центра, %` to Corridor settings; default is 60%, with 0% preserving fully neutral Corridor brightness.
- Center shading is encoded in per-copy GPU alpha rather than a Canvas/fullscreen overlay, so it applies consistently to strokes, fills, particles, Graffiti and lamps.
- The same percentage raises a conservative perceptual culling threshold for deep copies, allowing distant figures to be submitted to the GPU later as they emerge from the center.
- Project save/load/reset and Project Morph interpolation preserve the new parameter.

# Somata 7.0.13 — Graffiti deferred-buffer + FullGPU fallback repair

- Fixed intermittent missing Graffiti cores/line centres after contour Glow was added. Glow + core are deferred until the frame-wide WebGPU submit, so the old three-buffer vertex ring could be overwritten by later layers before submission. Graffiti vertex buffers are now frame-safe and are never reused within the same render frame.
- Native Fill renderer now consumes the current v508+ canonical layer-wide stencil fan instead of only the retired per-record winding format.
- Static Corridor Fill is encoded directly into the resident WebGPU Layer Scene with per-copy scale/lag/alpha and 4x-MSAA stencil coverage. The old `exact Canvas fill` Corridor fallback is blocked while GPU mode is active.
- When a Corridor Fill cannot be represented by the native GPU contract (for example dynamic topology or per-copy colour-shift state), Canvas is not substituted silently; the frame emits a deduplicated `[Somata GPU diagnostic]` error and retries the GPU path.
- When Lamps are configured for GPU (`GPU` enabled and `Raster` disabled), a failed GPU queue no longer calls the Canvas lamp renderer. It emits a diagnostic error, warms/retries WebGPU, and skips that lamp frame instead of creating a mixed GPU/Canvas frame.
- Explicit Raster/Canvas lamp mode remains available when deliberately selected by the user.

# Somata 7.0.13 — Graffiti exact GPU contour Glow + fallback diagnostics

- Graffiti Glow is now generated from the **exact rendered ribbon silhouette**: the GPU rasterizes the same nib/variation/join geometry into a mask, applies a separable WebGPU blur, then composites the halo back into the GPU Layer Scene. It no longer glows a thin hidden centreline.
- Static Graffiti, Morph Graffiti, and Corridor copies share this contour-mask Glow contract, so the halo follows marker width, angle, size/rotation variation, and corner joins.
- Removed the hidden Graffiti carrier from the visible Glow batch; there is now a single visible Graffiti Glow source and no accidental thin-line double halo.
- Graffiti contour Glow has no Canvas blur/readback fallback. If its GPU path cannot run, the effect is omitted for that frame and a diagnostic `console.error` is emitted instead of silently changing renderer.
- Added throttled diagnostic `console.error` reporting for Canvas/legacy fallback selections and explicit CPU Graffiti geometry materialization requests.

# Somata 7.0.13 — Graffiti neutral-default / exact nib-space corner repair rev3

- `Size Variation` and `Rotation Variation` are now geometrically neutral when disabled or effectively zero: the plain pointed Graffiti path no longer averages corner tangents, so a straight segment cannot taper merely because it touches a corner.
- The default pointed marker (`45°`, stroke length `10`) now reproduces the legacy Canvas marker construction on GPU: constant-width stroke in nib space, transformed back to scene space.
- Corner joins use the same `miterLimit = 2.6` behavior as the legacy marker; sharp transformed joins fall back to bevel instead of opening a gap or inflating the nib.
- Morph direct Graffiti uses per-span nib support plus dedicated join primitives, so zero-variation Morph does not synthesize hidden size/rotation modulation at authored corners.
- Enabled size/rotation variation still uses the selected authored scope (`perSegment`, `everyNth`, `across`, `perPath`, `whole`); stored slider values remain inert while their toggle is off.

# Somata 7.0.13 — Graffiti zero-variation / corner join repair rev2

- Graffiti size/rotation variation now enters the variation renderer only when its toggle is enabled **and** the effective amount is greater than zero. A stored slider value remains editable while disabled but has no visual effect.
- Existing variation modes (`perSegment`, `everyNth`, `across`, `perPath`, `whole`) remain authored and are used only after variation is actually active.
- Removed the previous pointed-nib miter-size amplification, which could look like size variation at corners even with Size Variation off.
- Pointed Graffiti now keeps a stable nib support and fills the missing corner wedge separately; Morph cubic joins use a shared averaged endpoint tangent rather than miter scaling.

# Somata 7.0.13 — Graffiti defaults / reset / 45° corner repair

- Graffiti defaults are now explicit and stable: marker angle `45°`, stroke length `10`, size variation `0` and disabled, rotation variation `0` and disabled.
- Missing variation-enable fields from older projects normalize to `false`; authored project values are preserved.
- Double-click reset scopes for Marker Angle and Stroke Length are independent, so resetting one cannot reset the other.
- Pointed Graffiti uses a nib-space miter join for static and Morph GPU ribbons, removing the visible corner wedge/gap at a `45°` marker angle without adding a Canvas fallback.
- The previous Glow/Morph decoupling and profile-locked Graffiti Glow attachment remain unchanged.

# Somata 7.0.13 — Glow / Graffiti attachment patch

- Blue Morph no longer owns, randomizes, interpolates, or commits `Glow`; the authored/manual Glow value remains independent while morphing.
- Graffiti analytic glow now prefers the exact prepared path set used by the current ribbon frame, preventing the glow carrier from drifting away from the visible sprite.
- Kept the analytic glow path instead of restoring expanded glow ribbons, preserving the sharp-corner artifact fix and the FullGPU rendering contract.

# Somata 7.0.13 — FullGPU Corridor Brightness Fix

- Removed the implicit depth-brightness curve from Corridor copy alpha. Normal visible Corridor copies now keep carrier alpha at 1.0.
- Preserved the previous depth curve only as `copy.depthAlpha` diagnostic metadata.
- Corridor attenuation now comes only from explicit visibility mechanisms: oversize temporal fade, sub-pixel size fade, and central density fade for tightly packed stroke copies.
- Lamps inherit the same neutral Corridor carrier alpha, so the whole figure no longer pulses darker as the dominant copy moves through depth.
- Keeps the strict FullGPU contract; no Canvas/WebGL/Fast-GPU fallback was added.

# Somata 7.0.12 — FullGPU Effect Benchmark

- Added a console benchmark profiler for isolating Web/Lightning/Exact-Arc/Corridor bottlenecks.
- Benchmarking samples CPU passes every frame and temporarily raises whole-frame WebGPU timestamp-query sampling frequency.
- Reports FPS, average/p95 render time, average/p95 GPU time, top CPU passes and start-to-stop GPU subsystem counter deltas.
- Added comparison history so baseline / Lightning / Web / Lightning+Web runs can be viewed in one console table.
- No Canvas, WebGL or Fast-GPU fallback was added to the strict Spiral/Morph/Corridor path.

# Somata 7.0.11 — Phase-Circle Lamp Stability

- Phase-circle Spiral Morph now gates visible time on the exact retained Spiral rail, WebGPU Lamp pipeline, and Exact Arc resource whenever lamps are enabled.
- The phase clock is never released after a failed retained-rail/Lamp-Arc prewarm. No Canvas/WebGL/Fast-GPU fallback was added.
- Lamp/FreezeLight consume the same phase-serial retained rail before the phase starts.
- FullGPU diagnostics are reset per render frame and capped at 32 faults; FINAL diagnostics copy a snapshot instead of embedding the live fault array. This removes the unbounded/circular `faults[]` growth seen in DevTools.

# Somata 7.0.10 — FullGPU Lamp Arc + FreezeLight Fix

- Fixed `SPIRAL_LAMP_ARC_RESOURCE_UNAVAILABLE` caused by selecting Arc geometry from global Morph activity instead of the geometry authority of the current frame.
- Added `currentGpuBezierResourceForFrame(frameCtx)`; static Spiral frames use their static retained rail, active Spiral Morph frames use the exact retained Morph rail.
- Lamp Arc preparation, Corridor lamps, and FreezeLight now consume the same current-frame retained cubic authority as the visible Spiral Base.
- Expanded Lamp Arc FullGPU diagnostics with bridge, renderer, authority, and Arc-decision state.
- No Canvas/Fast-GPU fallback was added.

# Somata 7.0.9 — FullGPU Web Morph Fix

- Web/Pautina no longer participates in `gpuPhasePreparing`; a Web-only failure cannot stop the Blue Morph clock.
- GPU Web renderer now exposes an awaitable `ensureReady()` so its real render pipelines can prewarm explicitly.
- Removed the stale-corner-state eligibility deadlock. A topology change now rebuilds the persistent GPU Web growth state for the new phase instead of permanently rejecting it.
- Web renderer + corner resource are prepared asynchronously from the retained Morph rail and request a fresh frame when ready.
- Strict Spiral still has no Canvas/WebGL/Fast-GPU Web fallback. Until the FullGPU Web resource is ready the effect is omitted and logged, while geometry continues.
- `SPIRAL_WEB_GPU_RESOURCE_UNAVAILABLE` now reports bridge, Arc, corner and renderer status.

# Somata 7.0.9 — Double-click Fullscreen

- Double-click with the primary mouse button anywhere on the visual workspace toggles native fullscreen.
- The listener is attached to `mainContainer`, so it continues to work when WebGPU presentation layers replace/hide `mainCanvas`.
- Interactive controls inside the viewport are excluded from the gesture.
- Double-click while already fullscreen exits fullscreen.
- Fullscreen resize now schedules the redraw on the next animation frame and listens to both standard and WebKit fullscreen change events.

# Somata 7.0.7 — FullGPU Graffiti Glow + Defaults Fix

- Static Spiral Graffiti can now record its hidden analytic carrier explicitly into the WebGPU stroke batch, so Glow no longer receives an empty command stream solely because Graffiti suppresses ordinary Base.
- Hidden-carrier recording is opt-in and does not make the normal line visible.
- FullGPU Glow diagnostics now include Morph state, hidden-carrier state, batch roles, Spiral renderer eligibility reason and LayerScene eligibility.
- Graffiti defaults: marker angle 0°, rotation variation off at 0°, nib/stroke length 10.
- Canvas and Fast-GPU fallbacks remain forbidden for strict Spiral.

# Somata 7.0.6 — FullGPU Graffiti + Spiral Carrier Fix

- Fixes strict Spiral + Graffiti failures reported as `SPIRAL_GLOW_GPU_UNAVAILABLE`, `SPIRAL_BASE_GPU_UNAVAILABLE`, followed by `FINAL_FULL_GPU_PRESENT_FAILED`.
- Graffiti now treats the ordinary Spiral Base as intentionally suppressed. The hidden carrier exists only for Glow/Arc/effect placement and is never drawn as a normal line under the Graffiti core.
- Active Spiral Morph Graffiti allows the retained Bézier renderer in `glow` mode while keeping `base` ineligible. The fused Glow+Base path is explicitly disabled when a profile replaces the carrier.
- Graffiti Glow is allowed to own the deferred FullGPU LayerScene root. The preflight no longer occupies the single external LayerScene slot with an empty clear before the real Glow producer can publish its command buffer.
- Static Spiral Corridor master generation now has an explicit `allowHiddenGraffitiCarrier` contract. The old unconditional `lineProfileStrokeOnly` rejection no longer drops the analytic carrier needed by Graffiti Glow.
- Strict Spiral Corridor ignores legacy compatibility-disable flags that would otherwise request a forbidden fallback backend.
- Multi-layer FrameScene join logic now propagates the hidden-Graffiti-carrier contract, so a Graffiti Spiral layer cannot be rejected before its Glow pass merely because another GPU layer already opened the frame scene.
- FullGPU policy remains unchanged: no Canvas fallback and no Fast-GPU fallback for strict Spiral/Morph/Corridor.
- Runtime diagnostics identify this build as 7.0.6 and expose the new Graffiti carrier invariants.

# Somata 7.0.5 — FullGPU Spiral Morph Pipeline Layout Fix

- Fixed WebGPU validation failure in fused Spiral Morph Glow+Base: regular and Uniform Spiral Morph pipelines now share one explicit `GPUPipelineLayout`.
- Render bind groups for uniforms, retained cubics and Corridor copies are created from shared explicit `GPUBindGroupLayout` objects, never from a pipeline-private `layout:'auto'` result.
- FullGPU policy is unchanged: no Canvas fallback and no Fast-GPU fallback.
- Runtime audit exposes `spiralMorphSharedExplicitRenderLayout: true`; FullGPU diagnostics identify this build as 7.0.5.

# Somata 7.0.4 — FullGPU Graffiti Carrier Fix

- Corridor + Graffiti may now open the resident GPU LayerScene with the hidden carrier **only for Glow**. The ordinary Base carrier remains suppressed.
- Graffiti core is then encoded into the same deferred GPU LayerScene, avoiding the normal need for the independent overlay path.
- GPU profile diagnostics now say `ERROR` instead of `FALLBACK`; no Canvas/Fast-GPU path is introduced.
- Added richer Graffiti carrier diagnostics (corridor/hidden-carrier/stroke renderer state).

## 7.0.3 — Full GPU shader validation fix

- Fixed `Somata Smooth Spiral Bézier WGSL` compilation: explicit parenthesization for the mixed `&&` / `||` expression in `joinedTangent()`.
- This restores the shared Smooth Spiral WebGPU pipeline used by the base Spiral renderer and dependent GPU passes such as Graffiti glow/overlay.
- Full-GPU policy remains unchanged: no Canvas fallback and no Fast-GPU fallback for strict Spiral/Morph/Corridor.
- Diagnostic prefix updated to `[Somata 7.0.3 FullGPU]`.

# Somata 7.0

## 7.0.2 — Full GPU stabilization / diagnostic build

- Canvas geometry/effect fallbacks remain forbidden for strict Spiral/Morph/Corridor frames.
- No reduced Fast-GPU fallback is introduced: only the authoritative Full WebGPU graph may present a strict Spiral frame.
- Previous-frame preservation was removed. A failed Full GPU frame becomes visibly absent instead of looking like FreezeLight.
- Exact Morph Arc and Web corner resources are compiled/allocated before the visible Morph clock starts, restoring the stable 6.6 prewarm principle without restoring CPU/Canvas rendering.
- Full-GPU contract failures are throttled into DevTools as `[Somata 7.0.2 FullGPU] ...` with frame/layer/status context.
- `__somataFullGpuDiagnostics()` exposes accumulated failure codes.

## 7.0.1 — FreezeLight / lamp-frame reliability

- Added **FreezeLight** to the Lamps section. It is **off by default**.
- Added **Tail length** in seconds (`0.05–30 s`, default `1.5 s`).
- FreezeLight uses a GPU ping-pong `rgba16float` history and `MAX(current, decayed history)`, so moving lamps leave a fading trail without repeatedly pumping stationary lamps brighter.
- Switching FreezeLight off invalidates the history immediately; normal lamp rendering does not retain old positions.
- Fixed Morph Arc / Topology lamp WebGPU bind groups: the non-Corridor shaders now receive the required dummy storage binding 1, preventing the recurring `4 entries / expected 5` validation failure and dropped lamp frames.

## GPU Spiral performance pass

- Strict retained-Bézier Spiral layers no longer build the dense generic CPU Morph topology in parallel with the GPU carrier. Polygon/non-Spiral compatibility paths are unchanged.
- The Blue Morph phase clock now waits only for immutable geometry carriers. Arc/Web helper compilation and resource allocation warm asynchronously in small idle/task slices, so optional effects cannot stall the beginning of a morph.
- Visual Spiral quality remains at **12** Bézier micro-intervals per cubic, while Arc-driven effect placement uses **8**. Lightning/Web/Lamps keep the exact retained cubic rail but perform less prefix/segment work.
- Web corner detection now scans a compact list of logical Bézier boundaries (plus authored terminal corner marks) instead of every raster microsegment. This removes most of the redundant Web classify/prefix/scatter work on Spirals.
- Glow/Base reuse the same ordered current-cubic GPU producer inside a frame when possible, avoiding duplicate cubic interpolation/closure compute dispatches. Per-frame cubic uniform staging is persistent instead of allocating new ArrayBuffers.
- Minimal Turn caches each endpoint rail's Bézier arc metric during path matching, then reuses the same arc map for knot fractions, rail equalization and endpoint lengths. This removes repeated Gauss/LUT construction from the phase-start hot path.
- Blue resolved frame layers now copy the canonical layer object only when its version/cycle changes instead of `Object.assign` on every animation frame.
- Bézier Sweep / precise Glint / spectral-preflash rendering now pools Core/Glow uniform GPU buffers and caches bind groups for retained cubic/corridor buffers; the driver no longer allocates those objects every frame.
- Strict Spiral presentation keeps the previous complete GPU frame while a carrier is temporarily unavailable; optional effect readiness does not suppress the base line.
- Runtime diagnostics identify **7.0 / iteration 2** through `__somataSpiral70Audit()` (older audit names remain compatibility aliases) and expose the new performance contracts.

# Somata 6.9

## Rev3 — Spiral Lightning/Web/rounding reliability

- Lightning precharge now keeps its halo on the selected **Glow** blend, but composites the colored flash core afterward with the selected **Core** blend. The flash core preserves the chosen RGB instead of whitening it through brightness, so the glint reads on top of the carrier line rather than being blended into it. Spectral preflash follows the same rule.
- Increased the retained Spiral Bézier raster/effect rail from 6 to 12 GPU micro-intervals per cubic. This reduces visible faceting/pixel-like stepping on high-curvature Spiral Lightning and keeps the static and Morph carriers on the same subdivision contract.
- Fixed Spiral Web corner detection: the Arc expansion now marks every logical retained-cubic boundary, and the Web classifier evaluates construction turns at those boundaries instead of at tiny raster microsegments. Authored Corner placement still uses authored corner markers.
- Removed the stale closed-path-only gate from the GPU Web corner resource; open Spiral rails now use the same explicit open/closed path metadata already handled by the shader.
- Strong adjacent spline fillets no longer collapse their shared run to a zero-length cusp. Trim distances are proportionally backed off by a tiny amount so the original spline provides a continuous tangent handoff when two roundings meet.
- Strict Spiral presentation now rejects an effects-only transaction when a visible line carrier failed to commit in that frame. The previous complete GPU frame stays onscreen while the carrier retries, preventing intermittent missing lines without introducing a Canvas fallback.
- Runtime audit is `6.9 / iteration 3`.

## Rev2 — Static lamps, viewport gestures, Sweep compositing, Static Spiral+Lamps

- Static Corner lamps now bypass bend inertia completely: switching to Corners on a non-Morph frame lights every detected bend immediately. The authored corner-inertia parameter remains active only while Morph geometry is moving.
- Restored workspace pan/zoom after GPU presentation: mouse drag, wheel zoom, and touch gestures are bound to the persistent `mainContainer` rather than the `mainCanvas` that can be hidden by Final WebGPU presentation.
- Added independent Photoshop-style **Core** and **Glow** blend selectors directly below the Glint/Lightning effect type, in one row. Both default to `Normal`; available native modes are Normal, Screen, Multiply, Linear Dodge (Add), Darken, and Lighten.
- Core/Glow blend selection is implemented in the actual Canvas and WebGPU compositors. Lightning precharge/flash, including spectral preflash, is deliberately classified as **Glow** and uses the Glow blend mode.
- Lightning microstrike count is now an unrestricted non-negative integer input with no upper UI cap. Small counts preserve exact legacy evaluation; large counts use bounded strongest-pulse evaluation so arbitrary values cannot create an O(N) per-frame loop.
- Fixed Static `Spiral + Lamps`: the static retained-cubic Spiral resource now exports the same `common` knot fractions and `pathRanges` contract consumed by the GPU Lamp/Arc bridge, with a guarded static fallback. This keeps Lamps on the retained cubic Bézier rail instead of crashing on Morph-only metadata.
- Runtime audit is `6.9 / iteration 2`; `__spiro69StaticSpiralLampProbe()` reports the live static Spiral/Lamp rail contract.

- Spiral Morph remains retained cubic Bézier end-to-end.
- Removed Morph-only dotted/beaded stroke artifacts: Bézier micro-segment coverage is unioned with MAX blending inside an isolated per-layer GPU scene, then composited source-over into the frame.
- Glow uses the same MAX coverage union, preventing bright subdivision hot-spots.
- Closed Spiral Morph now has an explicit GPU periodic-seam constraint: Continuous, Phase, Phase-Circle and Minimal-Turn patch the final retained cubic endpoint **and seam tangent** to the exact current rotate+scale image of the first cubic on every frame. Torn remains allowed to break continuity by design.
- Morph Spiral direct-to-frame fast path is disabled so coverage union cannot alter previously rendered layers; static Spiral keeps its existing fast path.
- Runtime diagnostics identify 6.9 and expose periodic path counts / endpoint/tangent closure error through `__somataSpiralBezierMorphStatus()` and the 6.9 contract through `__somataSpiral69Audit()`. `__spiro69MorphStrokeProbe()` summarizes the live Morph stroke/glow/closure state.

## Somata 6.8 — Spiral GPU Bézier contract (iteration 40)

- Restored all Spiral Morph types on the retained cubic Bézier carrier: `torn`, `continuous`, `phase`, `phaseCircle`, and `minimalTurn`.
- `continuous` and `torn` now interpolate exact endpoint cubic controls in Cartesian space; `phase` / `phaseCircle` retain polar phase interpolation; `minimalTurn` keeps the least-turn polar path with its path-wide Cartesian safety fallback.
- In Blue `topology` / `calm`, Spiral layers can use the special retained Bézier resource while non-Spiral sibling layers keep the ordinary topology resource; selecting a Spiral Morph type no longer forces the whole layer stack onto Circle Slide.
- Base and GPU effects now resolve the same special Spiral resource for all retained-Bézier Spiral Morph types, preserving the one-carrier contract introduced in 6.8.

## 6.8 Iter39 — real Spiral transform restored / Polygon profile spline carrier
- Fixed the critical ordinary-Spiral transform regression: optional `directionOverride` / `exponentOverride` defaults were `null`, but `Number(null) === 0` made them look like explicit zero overrides. As a result normal Spirals were built with `direction=0`, `exponent=0`, `delta=0`, and `targetScale=1`, collapsing each arm into the short local bars seen in the N=4 / 45° screenshot.
- `null` / `undefined` now mean “no override”; an explicitly supplied numeric `0` remains valid for Morph interpolation. Ordinary Spiral paths once again receive their authored turn and radial growth.
- Restored the Polygon-style Smooth profile contract from Iter37: the same authored centripetal Catmull–Rom → cubic Bézier profile carrier used by Polygon is evaluated in profile space and then mapped through the nonlinear Spiral transform. Arbitrary backtracking, loops and overshoot therefore follow the authored spline instead of a different final-space re-spline.
- Retained Iter38 WebGPU limit negotiation: the shared device requests `maxStorageBuffersPerShaderStage: 9` only when the adapter advertises at least that limit.
- Strengthened `__spiroSpiralProfileRailProbe()` and `__spiroSpiralProfileCarrierProbe()` so they reject collapsed “spirals” by checking non-zero Spiral delta and non-unit radial scale, not just finite/count/carrier structure. Added `__spiroSpiralTransformProbe()` reproducing the reported N=4 / 45° V-profile case plus an arbitrary Smooth backtracking spline.

## 6.8 Iter38 — superseded spline-order experiment / WebGPU storage-limit negotiation
- Historical note: this iteration changed Smooth Spiral to a final-space re-spline. Iter39 reverted that geometric experiment because it does not preserve the same authored profile spline contract as Polygon under a nonlinear Spiral map.
- At the time this was intended to replace Iter37's profile-space mapping; Iter39 established that this was the wrong equivalence for the Polygon-authored profile contract and restored the profile-space cubic carrier.
- Static Smooth Spiral paths now retain one final-space Bézier carrier while keeping mapped authored knots available so Canvas fallback can rebuild the same curve rather than drawing a chord chain.
- Pre-sampled Morph spline snapshots remain exempt from the final-space re-spline step to avoid double interpolation.
- The shared WebGPU device now checks `adapter.limits.maxStorageBuffersPerShaderStage` and requests the minimum required value of 9 when supported. This fixes PipelineLayout creation on adapters whose hardware limit is >8 but whose default requested device limit remains 8.

## 6.8 Iter37 — polygon-profile Bézier contract generalized to Spirals
- Smooth Spiral profiles now start from the same authored centripetal Catmull-Rom → cubic Bézier spans used by polygon rendering instead of treating neighbouring sampled spline points as straight profile segments.
- The polygon profile cubics are split into compact sub-cubics in profile space and each true sub-curve is mapped through the nonlinear Spiral transform before the retained final-space cubic is solved.
- Backtracking loops, open-profile overshoot beyond x=0/1, asymmetric spline profiles and hand-authored arbitrary profiles therefore keep their intended profile geometry on Spiral contours.
- The retained Spiral path records whether it came from the polygon spline carrier and exposes source-cubic counts for regression diagnostics; the carrier probe now covers closed/open loop presets.

## 6.8 Iter36 — unified static Spiral retained-Bézier LayerScene

- Removed the redundant static presentation fork through `WebGPUSpiralBezierMorphRenderer`. Closed/Open Spiral and every static profile preset now use the same retained-cubic `WebGPUStrokeRenderer.renderLayerBatch()` / GPU LayerScene path that already powers the stable Corridor master rail.
- The dedicated Spiral Bézier renderer is now reserved for an **active Morph frame** only, where GPU endpoint interpolation is actually required. Static eligibility can no longer bypass the ordinary retained-cubic batch and leave a valid profile carrier without a visible Base.
- Static Glow remains fused into the same internal retained-Bézier LayerScene and is published by the Base pass; no hidden Canvas/legacy presentation branch is introduced.
- Static fallback logic and dynamic-vector preparation also gate the dedicated renderer on `morphFrameActive`, preventing a second late static re-entry into the Morph renderer.
- Profile carrier construction from Iter35, Corridor transforms, Morph interpolation/Minimal Turn, Stop handling, buffer capacity/reuse, and all WGSL shaders are unchanged.

## 6.8 Iter35 — frozen Spiral profile carrier / WebGPU validation cleanup

- Spiral profile geometry now freezes one authoritative final-space retained cubic Bézier carrier at `buildOrbitPolylines()` time. Base, static Arc/effects, Corridor recorder and Morph endpoints consume the same carrier instead of rebuilding it from a partially copied point list.
- Spiral path cloning now preserves all mapping/closure/rounding metadata instead of whitelisting a subset, preventing profile edits from silently dropping curve-control semantics.
- Fixed `SpiroStar GPU Morph Web WGSL` hash precedence: multiply/XOR terms are sequenced explicitly for Dawn WGSL parsing.
- Fixed `SpiroStar particle WGSL`: the screen-space particle position is mutable (`var`) because helix/scatter/style stages modify it.
- Fixed Corridor Web Threads pipeline validation: the corridor vertex entry point now declares only `@location(0)` because segment/color data comes from storage buffers, matching the bound vertex state.
- `__spiroSpiralProfileCarrierProbe()` now reports/validates the exact path-owned retained carrier (`retainedCarrierPaths`, `allPathsRetained`, per-path details) rather than reconstructing a second carrier just for diagnostics.

## 6.8 Iter34 — mapped profile Bézier carrier / copyExternal texture validation
- Fixed the remaining static Spiral profile carrier issue: each profile span now retains direct final-space cubic Bézier controls solved from the nonlinear Spiral/profile mapping at 1/3 and 2/3 of the span. Static Base/effects consume those controls instead of reconstructing the mapped profile from a point chain/Hermite guess after a preset change.
- Preserved the direct mapped controls through the static Spiral path hand-off; closure/fillet compatibility spans can still fall back locally without downgrading unrelated mapped spans.
- Fixed Chromium/Dawn `Destination texture needs to have CopyDst and RenderAttachment usage` validation failures. Every texture used as a `copyExternalImageToTexture` destination in Fill, Final scene/background, resident LayerScene masks, and Graffiti bitmap upload now includes both `COPY_DST` and `RENDER_ATTACHMENT` while retaining `TEXTURE_BINDING` where sampled.
- Added `__spiroSpiralProfileCarrierProbe()` which checks that Closed/Open straight, Segment and Smooth presets produce finite retained cubics with direct mapped-control spans; this is stronger than the Iter33 finite/count-only probe.
- Corridor transforms, Morph timing/Minimal Turn, Stop, retained-buffer capacity, and strict Spiral Canvas/GPU firewall are unchanged.

## 6.8 Iter33 — profile-space Spiral rail / GPU Arc + composite validation
- Spiral Smooth profiles are now evaluated in profile space before the nonlinear Spiral rotation/scale mapping. The mapped sampled rail is marked as already spline-baked and converted directly to retained Hermite cubic Béziers, instead of fitting a second final-space spline through mapped control knots. This targets the four dangling-arm degradation after switching away from the straight profile and keeps Open/Closed Spiral on the same retained-curve contract.
- Fixed `SpiroStar Morph Arc finalize` WGSL: the mutable segment metadata vector is now declared with `var`, not immutable `let`, before updating `.x/.z/.w`.
- Fixed WebGPU pipeline-layout validation in legacy Sweep, canonical Sweep, and GPU Lightning Arc. Composite pipelines now share explicit bind-group layouts rather than embedding `getBindGroupLayout()` objects originating from `layout:'auto'` pipelines.
- Corridor copy math, Morph timing/Minimal Turn, Stop semantics, retained-buffer capacity policy, and Canvas/GPU firewall are unchanged.

## 6.8 Iter32 — Spiral profile topology preservation / Open Spiral integrity
- Fixed profile-preset mode preservation: the old handler compared `getContourMode(layer)` to the impossible literal `spiral`, even though the real modes are `spiral-closed` and `spiral-open`. Profile changes could therefore be treated as ordinary contour-topology edits.
- Profile presets now change only profile geometry while preserving `spiralEnabled`, `spiralClosed`, `spiralOrder`, and the Spiral-owned `closedLoop=false` contract. Preset `closed/open` metadata is ignored for topology matching while a Spiral is active.
- Open Spiral now runs the same finite/non-collapsed edge integrity guard as Closed Spiral, using the original mapped open rail as fallback and never adding a closure bridge. The Morph geometry helper uses the same Open-Spiral repair contract.
- Added `__spiroSpiralProfileModeProbe()` and `__spiroStaticSpiralBezierStatus()`; `__somataSpiralTrace()` now includes the static retained rail and Spiral metadata count.
- Corridor and dedicated Morph renderers, Stop, retained-buffer policy, WGSL shaders, and Final compositor are unchanged.

## 6.8 Iter31 — WGSL reserved-identifier compatibility / Spiral pipeline compile recovery
- Fixed the actual Iter30 runtime blocker reported by Chromium/Dawn: current WGSL reserves identifiers such as `meta`, `target`, and `active`; the retained Spiral Bézier raster, GPU Arc finalize, and profile Arc marker modules therefore failed shader validation before any strict-Spiral frame could present.
- Renamed those identifiers in every WebGPU WGSL block across Spiral Base/Arc/Profile plus Web, Particles, Lamps, Graffiti, Lightning, and Sweep so enabling the next effect cannot immediately expose the same compile failure.
- No geometry, Corridor copy math, Morph timing, retained-buffer policy, Stop behavior, or Canvas/GPU presentation policy changed in this iteration.
- Added a source invariant that scans all GPU WGSL template blocks and rejects the reserved identifiers before packaging.

## 6.8 Iter30 — strict Spiral async readiness handoff

- Fixed a strict-Spiral first-use stall where the dedicated Bézier, GPU Arc, or Profile Arc pipeline could finish compiling after the warmup frame but never schedule the frame that consumes it.
- Spiral mode selection now prewarms the retained Bézier Base, GPU Arc, and GPU profile-marker pipeline together.
- Line profiles that replace the Base carrier no longer remain invisible until an unrelated UI event after asynchronous GPU compilation.
- Added Profile Arc state to `__somataSpiralTrace()`; no Canvas fallback or Corridor/Morph shader changes.

## Somata 6.8 SpiralGPUBezier Iter29

- Fixed the retained Spiral Bézier capacity comparison that accidentally treated every non-zero capacity as a grow request (`capacity || 0 < cubicCount`). This caused exponential 1.6x Float32Array/GPU-buffer growth and eventually `RangeError: Array buffer allocation failed` during Corridor/profile edits.
- Static Spiral Corridor master commands are now marked persistent, so an unchanged retained cubic rail is packed/uploaded once and reused across display frames.
- Static/Corridor cache invalidation now explicitly releases the associated retained Bézier GPU buffer; repeated profile edits no longer orphan old records.
- Mutable phase recorders keep and invalidate their existing retained Bézier allocation instead of deleting the WeakMap entry and leaking the strong record-set entry.
- Added an allocation guard based on the device storage-buffer limit before CPU staging allocation, plus `__spiroBezierBufferProbe()` telemetry (`bufferGrows`, `bufferReuses`, `capacityPeakCubics`, `oversizeRejects`, `releases`).
- Corridor/Morph shaders, geometry, Final compositor, scheduler and Stop semantics are unchanged from Iter28.

## Somata 6.8 SpiralGPUBezier Iter28

- Fixes the runtime Corridor crash reported from pass isolation: the outer static/dynamic Corridor master builders referenced `corridorSpiralMasterBuilds` / `corridorSpiralMasterHits`, counters that exist only inside the private `WebGPUStrokeRenderer` closure. Outer builders now use their own scope-safe telemetry object; renderer/shader behavior is unchanged.
- Morph Stop is now deterministic: it immediately removes `morph` and `morph-arm` scheduler entries, increments the GPU phase-preparation serial, clears the pending-preparation latch/promise reference, then parks retained Spiral buffers. Late async completions cannot re-arm or mutate a stopped phase.
- Adds `__spiroMorphStopProbe()` plus build/hit counters to `__spiroCorridorScopeProbe()` for copy/paste runtime diagnosis.
- The dedicated retained-Bézier raster pipeline is compiled during browser idle time when WebGPU is available. No geometry is created and no animation starts; this only removes first-use Spiral shader/pipeline latency.
- Static Spiral Base, Corridor geometry, Morph interpolation, FrameGraph and GPU-only/Canvas firewall semantics are otherwise unchanged.

## Somata 6.8 SpiralGPUBezier Iter27

- Fixes the UI/canonical state rollback exposed by `__somataSpiralTrace()`: during live Blue Morph a sidebar edit was applied first, then `activeRebaseMorphing()` committed the OLD morph frame over it. The UI could therefore show `spiral-closed` while the renderer immediately returned to `closed`.
- Sidebar edits now run as an authored rebase transaction. Legacy rebase calls fired by target handlers are deferred until the control finishes committing; only the paths actually changed by the user are preserved across the current-frame continuity commit.
- This is generic for geometry/style controls, not Spiral-only, so live Blue Morph no longer silently discards freshly authored size/rotation/shape/Spiral edits for the same reason.
- `__somataSpiralTrace()` now reports the selected UI contour mode plus canonical, live frame, source and target Morph modes, making any future state divergence explicit.
- No Corridor, Spiral Bézier rasterizer, FrameGraph, Final compositor, Canvas/GPU policy or shader code is changed in this iteration.

## Somata 6.8 SpiralGPUBezier Iter26

- Fixes blank static Spiral: visible Base now consumes the existing static retained cubic Bézier GPU buffer through the dedicated Spiral rasterizer.
- Static Base writes directly into the shared GPU Layer/Frame scene; no hidden WebGPU canvas or Canvas2D materialization.
- Static Base no longer waits for GPU Arc compute pipelines; Arc/effect warmup is non-blocking.
- Static retained cubic width scales are preserved by the dedicated rasterizer.
- Corridor remains on its existing instanced master path; Morph behavior is unchanged except sharing the same raster core.
- Spiral trace now includes dedicated Bézier renderer and GPU-Arc status.

## 6.8 Spiral GPU/Bézier — Iter25

- **Stale polygon frame on Spiral entry fixed at the GPU-init latch:** Final and Stroke WebGPU initializers previously treated one failed asynchronous startup attempt as permanent (`attempted && !ready`). Ordinary polygon rendering could silently continue on Canvas, while strict Spiral preserved that old polygon forever because Canvas presentation is forbidden. DeviceHub, Stroke and Final now expose an explicit retry path, and selecting a Spiral contour invokes it before warmup.
- **Internal retained-Bézier scene no longer waits for Final compilation:** a successful static `renderLayerBatch()` may publish its GPU `sceneTexture + commandBuffer` immediately. Only external LayerScene writers keep the Final readiness gate. Final presentation can retry independently without preventing Base from being committed.
- **Targeted runtime trace:** `__somataSpiralTrace()` reports contour mode/state, canonical path counts and current Hub/Stroke/Final state so UI/state/geometry failures can be distinguished from GPU presentation failures in one console call. `__somataReport()` is updated to Iter25.
- **Regression containment:** Corridor marker scope, Corridor renderer, Spiral Morph renderer, effect shaders and the Iter21 no-frame-wide-abort behavior are unchanged. No Canvas fallback or Canvas↔GPU Spiral bridge was added.

## 6.8 Spiral GPU/Bézier — Iter24

- **Corridor/Morph scope regression fixed:** `markSpiralCorridorMaster()` was defined only inside the private `WebGPUStrokeRenderer` closure but called by the outer static and dynamic Corridor master builders. Pass isolation caught the resulting `ReferenceError`, leaving Corridor/Glow and Corridor-during-Morph without master commands. The shared marker now exists in the callers' scope.
- **No renderer rewrite:** Corridor instancing, Spiral Morph, FrameGraph, scheduler, shaders and effect backends are unchanged; this iteration only repairs symbol visibility and adds a scope regression invariant.
- **Console probe:** `__spiroCorridorScopeProbe()` reports whether the marker and both master builders are visible without starting a render pass.

## 6.8 Spiral GPU/Bézier — Iter23

- **Static Spiral publication deadlock fixed:** an internally encoded retained-Bézier `renderLayerBatch()` already owns its LayerScene texture and command buffer. It no longer has to pass the unrelated `canUseExternalLayerScene()` gate that is only required by dedicated Morph/Corridor/effect writers. External writers keep the old gate.
- **First event-driven repaint self-heals:** the single-rAF scheduler has a dormant 120 ms watchdog for a genuinely lost/stale scheduled repaint. Normal rAF remains unchanged; hidden tabs do not enter a watchdog render loop. This targets the startup symptom where controls update state but nothing paints until Randomize calls `renderMainCanvas()` directly.
- **Runtime diagnostics added:** `__somataReport()`, `__somataReportText()`, `__somataRenderNow()`, `__somataSchedulerDiag()` and `__somataDiagEvents()` expose scheduler state, recent control clicks/errors, WebGPU device/stroke/final status, and the exact strict-Spiral LayerScene gate/stage without enabling verbose per-frame logging.
- **Regression containment:** Corridor and the Spiral Morph renderer are not rewritten in this iteration; the internal/external LayerScene distinction is explicit so the static fix cannot silently relax Corridor/Morph ownership rules.

## 6.8 Spiral GPU/Bézier — Iter22

- **Static Spiral visibility fix:** offscreen WebGPU stroke/Bezier uniforms now use the real `mainCanvas`/LayerScene viewport instead of the legacy hidden WebGPU canvas dimensions. Strict Spiral never configures that hidden canvas, so its old `0×0` viewport could make valid retained cubic Bézier geometry disappear in the shader.
- **Morph starts without optional-effect stalls:** only the retained Spiral Bézier endpoint rail gates the phase clock. Sweep/Lightning/Web/Graffiti/Profile/Particles/Lamps and Arc helper pipelines warm in parallel and attach on later GPU frames instead of imposing up to ~900 ms startup waits.
- **Regression containment:** Iter21 Corridor behavior and the no-frame-wide-abort policy are unchanged. No Canvas fallback or Canvas↔GPU Spiral bridge was added.

## Somata 6.8 — Spiral GPU/Bézier iteration 21

- **Regression rollback:** Iter21 is rebuilt from Iter19, not Iter20. The frame-wide `_strictSpiralMissingBase` abort/freeze and the global circle-angular Blue Morph reroute are removed.
- **Corridor starts without optional-effect deadlock:** only strict Spiral Corridor may open the permissive GPU LayerScene root while Web/Particles/Path-FX are warming. Non-Spiral policy is unchanged.
- **Corridor per-copy colors remain GPU-native in strict Spiral:** color shift / palette lag no longer force the impossible Canvas fallback in strict Spiral; non-Spiral behavior is unchanged.
- **Blue Morph fix is Spiral-only:** size/rotation/rounding/order/layer-only Spiral phases now select `blue-circle-slide`; unrelated circle-angular morphs keep their previous backend selection.
- **No outline without Base:** `_baseStrokeCommitted` is set only after a real Base draw/defer. Strict Spiral Outline skips that frame if Base is not committed, but the rest of the frame and animation continue — there is no frame-wide abort.
- **Stale incomplete-frame latch fixed:** `_strictSpiralGpuFrameIncomplete` resets at the beginning of every reused render frame.

## Somata 6.8 — Spiral GPU/Bézier iteration 19

- **Black canvas on Spiral entry fixed at the geometry contract:** Spiral canonical paths deliberately remain open stroke rails (`closed:false`) even when `spiralClosed` is enabled, because the auto-close bridge is already baked into the retained Bézier carrier. A default-enabled Fill flag was incorrectly treated as an independent polygon Fill request, so strict GPU mode waited for a Fill mesh that cannot exist and returned before Base. Fill is now requested only when authoritative closed Fill topology actually exists.
- **Base can no longer be killed by optional Fill:** a defensive strict-Spiral branch publishes the retained-Bézier Base/Glow LayerScene even if a future Fill contract is temporarily unavailable. Fill stays GPU-only and is retried; no Canvas split is introduced.
- **No black warmup frame when switching modes:** strict Spiral intent is detected before `mainCanvas` is cleared. The previous completed frame remains visible while WebGPU pipelines initialize and is replaced atomically by the first successful `finalGpuCanvas` frame. The preserved image is presentation-only and is never uploaded into or composited with the strict Spiral GPU frame.
- **Earlier GPU prewarm:** selecting a Spiral contour starts DeviceHub, Stroke, Spiral Morph and Final compositor warmup immediately at the UI gesture, before frame construction.
- Runtime audit is iteration 19 and exposes `strictTopologylessFillCannotBlockBase`, `strictEntryPreservesPreviousFrame` and `strictEntryPrewarmsGpu` in addition to the iteration 18 GPU-only / Minimal Turn contracts.

## Somata 6.8 — Spiral GPU/Bézier iteration 18

- **Blank Spiral fix / independent GPU root:** retained-Bézier Base no longer waits for every optional Spiral effect pipeline to be ready before opening the LayerScene. Web, lamps, Graffiti, particles, Sweep/Lightning and profiles attach to the resident GPU scene when ready; a warming effect can no longer make the whole Spiral disappear.
- **Effects-only Spiral is GPU-native:** profile/Graffiti/base-replacement cases can open a transparent WebGPU LayerScene root. This preserves the same GPU-only effect carrier even when the ordinary line is hidden or replaced, without synthesizing a Canvas path.
- **No Canvas→GPU final upload in strict Spiral:** Final now requires a resident GPU layer/frame texture for strict Spiral and uses a dummy transparent GPU scene underneath it. The cleared `mainCanvas` is not uploaded every frame, removing a full-frame copy and closing the remaining mixed Canvas/GPU presentation path.
- **Central no-materialization firewall:** `materializeDeferredLayerScene()` now rejects strict Spiral centrally, and the late tunnel vignette is never rasterized into Canvas2D while strict GPU presentation is required. This protects future/optional passes from accidentally reintroducing a GPU→Canvas mixed frame.
- **Failure stays on the last good GPU frame:** a strict Final exception no longer hides `finalGpuCanvas`; multi-layer seal failure also discards/retries the GPU frame instead of materializing FrameScene/LayerScene through Canvas2D.
- **Strict Web + Glow/Base stays fused:** Web no longer prevents the dedicated Spiral Morph renderer from producing Glow+Base as one root command, avoiding the one-deferred-root conflict and preserving the base line when Web is enabled.
- **Geometry-circle parity stays resident:** strict Spiral geometry circles may only encode into the resident LayerScene; warmup/failure cannot force a GPU→Canvas materialization.
- **Minimal Turn anti-spin tightened:** a coherent visible outer-rail rotation above 22.5° now switches the complete retained path to endpoint-exact Cartesian cubic interpolation. Local opposing bends may still use polar interpolation, but whole-spiral rotational sweeps are suppressed much earlier.
- Runtime audit is iteration 18 and exposes `strictBaseIndependentOfEffectReadiness`, `strictEffectsOnlyGpuSceneRoot`, `strictPresentationKeepsLastGpuFrame`, `strictCentralMaterializationFirewall`, `strictLateCanvasVignetteBlocked` and the 22.5° Minimal Turn coherent-spin guard.

## Somata 6.8 — Spiral GPU/Bézier iteration 17

- **Line-profile parity is now retained-Bézier GPU-native too:** strict non-Fourier Spiral `slash/square/circle/cross` profiles no longer build a CPU path table or upload sampled marker centres. Marker positions are resolved in WGSL from the shared Bézier-derived GPU Arc and then evaluated back on the retained cubic carrier.
- **No hidden Canvas bridge for strict Spiral markers:** marker core/glow/outline encode directly into the resident WebGPU Layer Scene. The legacy hidden WebGPU canvas + Canvas2D composite remains compatibility-only outside strict Spiral.
- **Shared prerequisite scheduling:** profile markers join the same Arc prerequisite scheduler as lamps, web, particles, sweep and sampled graffiti, so one ordered Arc build feeds all consumers in the frame.
- **Minimal Turn coherent-spin guard:** visible outer-rail signed rotation is measured separately from RMS bend error. A coherent whole-spiral swing switches the entire retained path to endpoint-exact Cartesian cubic interpolation earlier, preventing the remaining large rotational sweeps while keeping source/target geometry exact.
- Runtime audit is iteration 17 and exposes `profile` in the per-effect Bézier/GPU contract plus `strictProfileMarkersGpuArc`, `strictProfileNoCpuShadow` and `minimalTurnCoherentOuterTurnGuard`.

## Somata 6.8 — Spiral GPU/Bézier iteration 16

- **No Canvas even on final-present failure:** strict non-Fourier Spiral no longer copies FrameScene/LayerScene/Underlay WebGPU textures into Canvas2D if the final WebGPU compositor fails. The failed frame is discarded and retried on WebGPU; the previous displayed frame remains intact.
- **Strict Morph CPU-path firewall:** any legacy request to materialise a CPU point rail during non-Fourier Spiral Morph is blocked and counted. Effects must consume the retained cubic buffer or the shared cubic-derived GPU Arc.
- **Minimal Turn now pairs paths using retained Bézier geometry:** cyclic/split/merge pairing is scored on 13 arc-distributed samples evaluated from the actual endpoint cubic rails. The visible-spin fallback is also slightly more conservative, reducing large coherent spiral rotations while preserving exact endpoints.
- Runtime audit is iteration 16 and now reports observed mixed-backend telemetry, CPU-path firewall blocks, final-presentation policy, and retained-Bézier Minimal Turn pairing.

## Somata 6.8 — Spiral GPU/Bézier iteration 15

- **Strict Spiral exceptions are GPU-only fail-closed:** render-pass isolation can no longer invoke compatibility/Canvas retry, nor session-disable a GPU pass into a compatibility route, when either Morph endpoint is a non-Fourier Spiral. A failed/warming pass is retried on a later GPU frame instead of creating a mixed frame.
- **Arc reuses Base current cubics:** when the retained Spiral Base has already queued the exact `currentCubics` producer for the deferred LayerScene, the shared GPU Arc builds directly from that ordered buffer. Lamps, Web, Particles and Lightning no longer trigger a duplicate polar current-cubic compute in the same frame.
- **Minimal Turn outer-rail guard:** large perceived spin is now measured explicitly on controls outside 28% of the path radius. A coherent outer swing switches the entire retained path to endpoint-exact Cartesian cubic interpolation earlier, preserving shared-knot continuity and exact source/target geometry.
- Runtime audit is iteration 15 and reports ordered Base→Arc cubic reuse plus the strict exception fallback prohibition.

## Somata 6.8 — Spiral GPU/Bézier iteration 14

- Strict Spiral render graph no longer requests a sampled CPU shadow path for native GPU fill; line-profile markers keep their CPU placement table but remain GPU-rendered for parity.
- GPU-only presentation is now a per-frame latch and is reset at frame preparation; a Spiral frame cannot poison later non-Spiral presentation.
- Minimal Turn now scores all controls against one final path radius scale (order independent) and switches the whole retained cubic path to endpoint-exact Cartesian interpolation earlier when a coherent visible spin would otherwise exceed roughly a quarter-turn.
- Static retained-Bézier rasterization now uses six GPU intervals per cubic (matching Morph/Arc), halving the previous static Spiral instance budget. Runtime Spiral audit is iteration 14 and includes Base plus every named Spiral effect.

## Somata 6.8 — Spiral GPU/Bézier iteration 13

- **Effect graph is gated with the Spiral phase:** phaseCircle/minimalTurn now holds the exact source frame until the retained cubic rail, shared cubic Arc and active WebGPU effect pipelines/resources are prepared. Lamps/Web/Glint/Lightning/Graffiti/Particles no longer start a moving phase while their GPU carrier is still warming.
- **Strict render graph no longer materializes a CPU shadow contour:** GPU readiness is not used to decide whether strict Spiral needs `CPU_PATH`. A compiling effect waits on the same retained Bézier resource instead of causing eager CPU/Canvas geometry work.
- **t=0 Arc is primed before motion:** the first visible moving frame reuses an already committed current-cubic/Arc state; Web-corner and Graffiti-sampler resources are allocated from that same phase rail before the clock runs.
- **No final lamp Canvas escape hatch:** if the final GPU compositor is unavailable, strict Spiral does not present deferred lamp pixels through a browser WebGPU canvas and Canvas2D; the GPU frame is retried instead.
- **Minimal Turn visible-spin guard:** a coherent large 120–180° path swing now chooses one path-wide endpoint-exact Cartesian cubic interpolation, preventing visually wild rotations even when the polar branch was formally the shortest one.

## Somata 6.8 — Spiral GPU/Bézier iteration 12

- **Strict no-round-trip Spiral scene:** non-Fourier Spiral no longer allows Glow/Base/Outline or multi-layer ordering to materialize a WebGPU scene through Canvas2D. If the shared GPU scene is warming, the Spiral layer waits for the next frame instead of mixing backends.
- **GPU-only Fill in strict Spiral:** Canvas fill-rule masks are also disabled; closed Spiral fill uses the native GPU mesh path or waits for GPU support instead of becoming a mixed Canvas/GPU frame.
- **Static profile edits stay compact Bézier:** mapped Segment-profile Hermite controls are retained per span; closure/fillet compatibility spans no longer downgrade the entire Spiral to line cubics.
- **Static effects skip compatibility sampling:** the static Spiral GPU resource is built directly from the same retained cubic controls as the visible stroke; it no longer allocates a six-sample-per-cubic point rail just to recover those controls.
- **Morph lamps bind to exact cubic boundaries:** Key/Corner lamps use stable retained-boundary identities and direct cubic evaluation, eliminating nonlinear endpoint-arc-fraction drift during Spiral morph.
- **One morph authority:** strict Spiral Base/Glow/Lamps no longer fall through to generic Green/Topology morph geometry while the Spiral retained rail is warming; effects wait for the authoritative Spiral cubic resource.
- **Minimal Turn centre guard:** a near-origin control with an unstable large polar phase switches the whole retained path to endpoint-exact Cartesian interpolation, preventing handle whips while preserving C0 continuity.

## 6.8 Spiral GPU/Bézier iteration 11
- Minimal Turn safety is now path-wide, not per-cubic. If one control on a retained path would still travel more than 180° after the global 2π alignment, the whole path uses endpoint-exact Cartesian cubic interpolation. Adjacent Béziers therefore always move shared knots with the same metric; no transient gaps/corkscrews can be introduced by mixed interpolation modes.
- Removed a duplicate per-frame Spiral Morph compute dispatch. When Base/Glow owns the root deferred WebGPU Layer Scene, its current-cubic compute is recorded as the ordered producer and all later GPU effects reuse that exact buffer. Independent command buffers still require the explicit prerequisite, preserving the Iter9 correctness rule.
- Hardened static Spiral content addressing with additional construction switches (`lineJoinType`, `spiralEnabled`) so profile/editor/import mutations cannot reuse a stale retained cubic cache.
- Strict non-Fourier Spiral remains one WebGPU scene: retained cubic Base/Glow plus Bézier-derived Glint/Lightning/Web/Lamps/Graffiti/Particles. No Canvas raster fallback is permitted for those Spiral passes.

## 6.8 Spiral GPU/Bézier iteration 10
- Preserved authored Spiral profile-corner metadata through exact De Casteljau rail equalization and packed it into the shared GPU Arc metadata, restoring Web corner anchoring in static and Morph Spiral.
- Added local arc-fraction correction for lamps, Web, particles, sweep/glint, graffiti sampling and lightning. The retained rail remains six GPU micro-intervals per cubic; a cheap closed-form endpoint-speed inverse maps distance fractions back to Bézier `t`, improving placement without multiplying splines.
- Minimal Turn now keeps the safe global 2π path branch, but any individual cubic that would still rotate a control by more than 180° uses endpoint-exact Cartesian control interpolation. This removes pathological corkscrews while keeping t=0/t=1 geometry exact and shared by every effect.
- Static Spiral profile cache signatures now include the global spline construction point count, preventing stale retained cubics after profile-quality edits.
- Strict non-Fourier Spiral remains WebGPU-only for its visual/effect path; no Canvas raster fallback was added.

## Somata 6.8 — Spiral GPU/Bézier iteration 9

- **Morph effects ordering fix:** the shared Spiral Arc no longer trusts `currentCubicsScheduledFrameId` from another deferred command buffer. The Arc prerequisite encodes the exact current retained cubics in its own command buffer, and the scheduler queues that prerequisite before Lightning, Glint, Web, Lamps, Particles and sampled Graffiti.
- **Direct retained-cubic effects:** custom Spiral rails now expose an explicit ordered current-cubic prerequisite. Plain GPU Graffiti and Bézier Glint/Spectral consumers reuse the scheduler dependency rather than privately recomputing or depending on Base-pass timing.
- **Lower Arc cost:** the retained-cubic Arc uses six GPU micro-intervals per cubic (matching the visible Spiral lattice); Gauss-3 cubic length keeps distance placement accurate without restoring a dense sampler.
- **Better arc placement without denser rails:** GPU micro-arc length uses 3-point Gauss-Legendre integration of the cubic derivative instead of chord length. The micro-segment count stays fixed, while Lamps/Particles/Web/Lightning get materially better distance mapping on tight turns.
- **Minimal Turn endpoint exactness:** replaced per-control non-equivalent angular clamps with one global integer `2π` phase for the whole unwrapped destination cubic rail. This preserves the exact target at `t=1` and prevents C1/C2 controls from selecting different wrap branches that create artificial corkscrews.
- **Static profile-edit stability:** compact Segment-profile cubics use <=45° angular spans and cap pathological Hermite derivative magnitude while retaining tangent direction, preventing edited profiles from launching giant cubic loops/offscreen spikes.
- Strict non-Fourier Spiral remains GPU-only for Base/Glow and all supported effects; Canvas/WebGL compatibility code is not entered by the strict Spiral effect graph.

## Somata 6.8 — Spiral GPU/Bézier Iteration 8

- Strict Spiral detection follows Morph endpoints and the authoritative retained cubic resource for the entire polygon↔Spiral handoff.
- Lamps and Particles cannot silently fall back while the temporary render layer still looks polygonal.
- GPU Arc eligibility trusts the retained Spiral Bézier rail directly; effects no longer disappear because of provider metadata mismatch.
- Authored Spiral key/corner lamps use exact retained-cubic boundary attachments when possible, avoiding non-linear arc-fraction drift during morph.
- Minimal Turn adds neighbouring endpoint-travel continuity on top of shortest-angle, path-pair and handle guards.
- Runtime audit is iteration 8 and is endpoint/resource aware.

## Somata 6.8 — Spiral GPU/Bézier iteration 7

- Strict Spiral mode is now Morph-wide: current layer, source/target geometry and the active special retained Spiral resource all keep the phase on one WebGPU/Bézier contract.
- Strict Spiral no longer permits Canvas fallback for Sprite base replacement, Fill, Outline/Graffiti outline or Line Profile. Extracted Sweep/Web/Particles/Graffiti/Path-FX passes use the same endpoint-aware strict test.
- Minimal Turn adds per-cubic C1/C2 angular-travel projection on top of shortest-±180°, whole-rail phase and neighbour continuity guards, preventing handle-only corkscrews.
- Static Spiral profile signatures now include authored corner/key/type metadata as well as node coordinates, further hardening immediate cache invalidation after profile edits.
- Visible Spiral and Glint/Lightning/Web/Lamps/Graffiti/Particles remain on shared retained cubic / Bézier-derived WebGPU resources; Arc micro-segments are distance/index accelerators only.

## Somata 6.8 — Spiral GPU/Bézier iteration 6

- **Graffiti variation sampler:** GPU arc lookup is now only a distance/index accelerator; the final sampled position is evaluated on the shared retained cubic Bézier. Per-path/whole/every-N/across variation no longer ends on a chord-interpolated point.
- **Lightning:** exact Morph/Spiral Lightning now binds the same current cubic buffer as the visible contour. Its micro-rail endpoints and parity mask resolve from retained cubics on GPU; Arc remains only the distance accelerator.
- **Minimal Turn:** added a hard post-DP neighbouring angular-travel guard in addition to the coherent-phase DP and shortest-±180° rule. This prevents a seam/near-origin ambiguity from turning into a corkscrew.
- **Strict Spiral audit:** `__somataSpiral68Audit()` now reports an effect-by-effect GPU/Bézier contract and a `strictViolation` flag. In non-Fourier Spiral, Canvas effect fallback remains forbidden.
- All listed Spiral effects remain in the shared WebGPU Layer/Frame Scene; no new Canvas/WebGL presentation path was introduced.

## Somata 6.8 — Spiral GPU/Bézier iteration 5

- **Exact Bézier sampling for Arc consumers:** the GPU Arc remains a compact distance/index accelerator, but Lamps, Particles and Web now evaluate the original retained cubic at the resolved `(cubic,t)` instead of linearly interpolating a micro-segment chord. This improves tight Spiral contour fidelity without increasing sampling density.
- **Particles:** bind the shared current-cubic buffer and use the cubic derivative for tangent/normal orientation; strict Spiral still has no CPU/Canvas carrier.
- **Lamps:** Arc lookup resolves directly back into the retained cubic buffer on GPU, including static Spiral and phaseCircle/minimalTurn Morph.
- **Web:** procedural thread endpoints now come from direct retained-cubic evaluation after GPU arc lookup.
- **Moving Glint:** whole/per-path/per-segment/every-N GPU arc windows now map their clipped endpoints back to the retained cubic, eliminating another tight-turn chord shortcut.
- **Minimal Turn:** added whole-rail coherent phase bias and a neighbouring-control twist guard on top of the existing hard ±180° per-control limit and whole-path orbit pairing.
- No new Canvas/WebGL fallback was added; non-Fourier Spiral remains strict shared Layer-Scene WebGPU.

## Somata 6.8 — Spiral GPU/Bézier iteration 4

- Minimal Turn now uses whole-path angular + radial cost for unequal orbit populations too; split/merge phases no longer fall back to the generic first-angle matcher that could choose a remote spiral turn.
- The retained Spiral Base current-cubic compute is reused by the Bézier-derived GPU Arc and direct cubic effects in the same deferred Layer Scene. This removes repeated polar `sin/cos` work and guarantees those effects read the exact control buffer queued by the visible Spiral.
- Static Spiral retained-resource signatures now include radius, radius multiplier, rotation, step-linking and rounding mode in addition to profile content, making profile/geometry edits self-invalidating even when an editor/import path misses a revision bump.
- Added `__somataSpiral68Audit(layerIndex)` for runtime inspection of retained Bézier, GPU Arc, effect backends and the strict no-Canvas-fallback contract.

## Somata 6.8 — Spiral GPU/Bézier iteration 3

- Static Spiral retained-cubic caches are now content-addressed by the authored profile as well as geometry revision, eliminating stale GPU rails after profile edits/import/handoffs.
- The same profile signature invalidates Base, the shared effect cubic resource and the packed WebGPU cubic buffer together.
- Raw freehand profile commit now explicitly invalidates Spiral geometry.
- `minimalTurn` cyclic orbit matching scores the whole visible path instead of only its first non-zero angular sample, reducing pathological interior twists while keeping per-control motion in the shortest ±180° representative.
- The strict non-Fourier Spiral contract remains WebGPU-only for Base and listed path effects; all consume the retained cubic rail or its GPU-derived arc table.
- Graffiti size/rotation variation modes `perSegment`, `everyNth`, `across`, `perPath`, and `whole` now stay GPU-native in Spiral Morph instead of requesting a forbidden compatibility carrier.
- Strict Spiral Sweep/Profile warmup no longer materializes the deferred GPU scene into Canvas; the frame waits/retries on WebGPU instead of creating a mixed presentation path.

## Somata 6.8 — Spiral GPU/Bézier iteration 2
- Segment-profile spirals use compact mapped Hermite→cubic Béziers instead of dense straight samples.
- phaseCircle/minimalTurn effects never substitute the generic topology rail while the special Spiral cubic resource warms.
- Motion/Sprite wait for the shared GPU Bézier-derived arc in strict Spiral mode; no CPU path-table fallback.
- Minimal Turn pairs equal orbit populations with one minimum-cost cyclic shift before per-control shortest-angle alignment.

# Somata 6.8 — Spiral GPU Bézier iteration 1

- Static non-Fourier Spiral profiles now share one retained final-space cubic Bézier carrier with the WebGPU stroke renderer. Segment profiles are exact straight cubics; rounded and smooth profiles retain the same curve commands used by the visible line.
- Spiral profile edits explicitly invalidate geometry caches; persistent stroke commands include canonical geometry version/key.
- `phaseCircle` / `minimalTurn` Spiral Morph no longer resamples endpoints into points and fits another spline. Endpoint curves are normalized only by exact De Casteljau cubic subdivision, then interpolated on WebGPU.
- `minimalTurn` unwraps every Bézier control angle to its nearest equivalent (bounded to the shortest ±180° representative) instead of shifting the entire destination rail from only its first point.
- Morph lamps, particles, Web, Graffiti, Glint and Lightning share the retained cubic / GPU Arc resource. In non-Fourier Spiral mode their Canvas/CPU effect fallbacks are disabled so a frame cannot silently mix Canvas geometry with the GPU Spiral carrier.
- Rotation compensation remains disabled by default.

## Somata 6.7 hotfix — Graffiti Master, 3× nib default, deterministic global Hue Morph

- Graffiti controls now write directly to the full layer edit target set, so `Мастер` and multi-selection work consistently for marker angle/mode, nib shape/length, profile variation and the Graffiti palette/swatches.
- New Graffiti layers default to `Длина штриха = 3`; all missing-value renderer/import fallbacks use the same value.
- `Морфинг общего смещения цвета` is now an authored 0–360° angular travel per morph instead of a random absolute target. A 360° value performs one visible full hue revolution and returns to the same endpoint hue.
- Full-turn hue interpolation also applies to fill colors and remains compatible with ordinary palette color morphing.

## Somata 6.7 hotfix — retained Bézier topology Morph and shared effect rail

- Topology/Calm Morph now builds one retained cubic Bézier rail on WebGPU and draws the visible base/glow from that same rail instead of rendering the interpolated topology as straight point chords.
- Distance-based effects (Lightning, moving line/sprites, particles, lamps, canonical glints and closed Web) derive their compact GPU arc from those exact retained cubics, so effect placement and the visible contour share one geometry source.
- Phase-circle / Minimal Turn Spiral Morph now exposes the same polar-interpolated cubic controls used by the visible Spiral to effects through a GPU current-cubic pass; Spectral glint and direct Graffiti can consume them directly.
- Straight rails remain mathematically exact degenerate cubics, while authored hard corners stay hard. Open rails such as spirals are not auto-classified as polygon corners.
- Dense per-frame CPU spline sampling is not used for the native paths: fixed small GPU subdivision budgets are used only where an arc-length/capsule representation is required. Open-path legacy Web remains a bounded compatibility fallback sampled from the exact current cubic rail.

## Somata 6.7 hotfix — Audio Routing + opaque glint source

- Added the new Glint and Lightning numeric controls to their `Аудиосвязи` parameter groups, including opacity, brightness/softness, pre-flash controls and spectral sector/speed.
- Glint/pre-flash source alpha is now controlled by the dedicated `Прозрачность` value instead of being multiplied by source brightness. At 100%, the source is opaque at the active/peak part of the effect.
- The selected Glint color is shared by the visible source and its glow; brightness changes luminance, not alpha.
- Glint opacity no longer inherits ordinary layer-line opacity, so a 100% glint remains opaque over a translucent base line.
- Raised the practical minimum visible source width to 2 px in the Bézier, canonical GPU and fallback paths.

## Somata 6.7 hotfix — visible Lightning pre-flash core and separate color

- Removed the Lightning-only `Тип проблеска` selector; glint precision remains available only in the standalone `Проблеск` effect.
- Added a separate `Проблеск` color beside the primary and secondary Lightning colors. The moving pre-flash halo and source now use this color.
- The moving pre-flash now renders as three distinct passes: halo, colored carrier and bright core. The core is always drawn over the halo and has a practical minimum width, so it no longer disappears into glow.
- Removed the hidden `0.58` peak attenuation from the pre-flash envelope. `Интенсивность предварительного свечения = 50%` now reaches 50% of the configured source brightness and glow size at the peak, instead of being attenuated again.
- Applied the same pre-flash source semantics to the resident exact GPU-arc path, the ordinary WebGPU sweep path and the emergency Canvas fallback.

## Somata 6.7 hotfix — seamless GPU Spiral phase handoff

- Spiral Morph phase resources now swap atomically. The previous WebGPU Bézier phase remains resident and renders its exact handoff endpoint while the next phase is prepared asynchronously, eliminating the temporary GPU→CPU→GPU fallback frame at a phase boundary.
- Each Spiral rail keeps a stable resampling lattice for the whole Morph run, so the same canonical endpoint is not rebuilt with a different spline sampling count merely because the next random target has a different density.
- Interactive rebase keeps the currently visible GPU fraction as the handoff frame; normal phase boundaries hold exactly `t=1`.
- Starting a new Morph run resets the rail-lattice cache; Stop clears the handoff state while retaining the existing cheap stable-point rollback semantics.

## Somata 6.7 — faster multi-layer Spiral GPU, outer-layer compensation, Minimal Turn

- Added Spiral Morph type **`Минимальный поворот`**. Spiral rails keep the phase-circle/open-end correspondence, while closed polygon circle morphs switch to minimum-motion correspondence. The planner also tests reversed closed-loop traversal (same edge set, opposite winding) and chooses the lower physical circular travel; unlike the generic Minimal fallback, this remains active when orbit topology changes.
- Rotation compensation is now anchored to the **largest / outermost visible Spiral layer** (effective radius including `radiusMultiplier`) instead of averaging all spiral layers. For phase-circle / Minimal Turn it follows the angular velocity of that layer's real outer rail tip, so the requested outer reference remains visually stationary. Torn, Continuous and Phase retain their separate mode-specific laws.
- Plain multi-layer Spiral Morph can render **directly into the frame-global WebGPU scene**. This removes the per-layer scratch texture and fullscreen LayerScene→FrameScene seal that was expensive with three or more spirals. Effect-heavy layers keep the previous shared Layer Scene path as a correctness fallback.
- GPU Spiral phase rails now use a smaller retained endpoint budget (`48` coarse-pointer / `80` desktop) and `6` analytic subsegments per cubic instead of `12`; cubic Bézier evaluation itself remains in WGSL.
- GPU-native Spiral Morph no longer records a hidden dynamic Canvas vector master every frame. That recording was rebuilding interpolated Spiral geometry on CPU even when Base/Glow/Corridor were already rendered on WebGPU.
- `Фазово-окружностный` remains the default Spiral Morph type; `Минимальный поворот` is opt-in and persists through the existing `spiralMorphType` project field.

## Somata 6.6 hotfix — Morph-only spiral limits and mode-aware rotation compensation

- Spiral layer `min/max` is now an active-Blue-Morph target constraint only. With Morph stopped, Add / Duplicate / manual Spiral mode can create any number of spiral layers even when the Morph range is `0–1`.
- Rotation compensation no longer depends on the generic `byRotation` checkbox; phase-based Spiral Morph can rotate the visible rail even when authored layer rotation itself is not being randomized.
- Compensation is mode-specific: `torn` follows only the shortest rigid authored rotation, `continuous` follows unwrapped authored rotation, `phase` also compensates spiral-step phase drift, and `phaseCircle` derives the rigid angular component from the same circle correspondence plan used by the morph.
- Phase-circle uses a circular mean of angular deltas, avoiding the `+179° / -179° -> 0°` seam bug that could make compensation appear disabled.
- Completed phase compensation is accumulated into a scalar and partial rebase commits carry their current fraction, so counter-rotation does not reset at phase boundaries.

## Somata 6.6 — Spiral Morph phase continuity and rotation compensation

- `Фазово-окружностный` is now the default Spiral Morph type for new/default configurations.
- Added persistent `Компенсация вращения` (enabled by default): while Spiral Morph rotates spiral layers, the viewport receives the opposite radius-weighted mean rotation so the composition does not globally spin. Somata 6.6 now keeps a phase accumulator so compensation stays continuous across cycle boundaries even though canonical Blue stable points no longer deep-clone their origin layers.
- Spiral Morph controls are split into two UI rows: layer/order controls first; morph type and rotation compensation second.
- Phase-circle plans no longer cyclically reindex open spiral endpoints at a new phase. The authored seam/order is preserved at both endpoints, eliminating the main phase-boundary teleport source.
- Signed spiral-order changes interpolate angular handedness and radial exponent independently, passing smoothly through a radial intermediate state instead of hitting the static enabled+zero-order direction jump.
- The new setting is included in project / morph settings persistence and reset/factory defaults.

## Somata 6.5 — Smooth Spiral WebGPU Bézier path

- Smooth Spiral no longer CPU-tessellates every cubic into 10–32 points when the native WebGPU stroke backend is active. Cubic `P0/C1/C2/P3` control points are recorded directly and evaluated in the WebGPU vertex stage.
- Variable width and per-end alpha stay attached to each cubic; Base, Glow, Outline, Core Inset and the Layer Scene batch consume the same compact cubic buffer.
- Dynamic/Morph recording reuses pooled Bézier command objects and CPU staging buffers to reduce per-frame garbage collection.
- Fourier and Corridor intentionally keep the proven sampled compatibility path in 6.5; this preserves their exact existing visuals while the ordinary Smooth Spiral path gets the GPU speed-up.
- Added device-loss cleanup and WebGPU telemetry for the Smooth Spiral Bézier path.

## Somata 6.4 — mobile playlist persistence, camera portability, Spiral Morph budget

- `.plist` project snapshots now serialize the complete persistent configuration objects for Corridor, Blue Morph, Orange/Minimal Morph, TAP and Audio; runtime animation fields remain excluded by the state/runtime boundary.
- `морфить по умолчанию`, Orange default and `коридорить по умолчанию` are explicitly preserved per project and remain authoritative when switching playlist projects.
- Green Project Morph playlist settings now restore the full persistent config object before normalization, so newly-added parameters are not silently dropped.
- Project camera saves both legacy pixel pan and viewport-normalized pan. On compact mobile viewports, old projects without normalized camera metadata discard desktop pixel pan to open centered; new projects scale pan to the current viewport.
- Mobile `.plist` save prefers the native Share/Files sheet when file sharing is available and uses a Safari-safe delayed Blob-download fallback instead of revoking the URL immediately.
- Dynamic Spiral Morph sampling now has a constrained-device budget (up to 480 smooth / 240 non-smooth samples per endpoint on compact/coarse devices). Static Spiral rendering quality is unchanged.
- Saved active-layer/master-edit selection is no longer overwritten immediately after project load.

## Somata 6.4 — Graffiti quick-toggle correction

- Right-click/long-press on the left Lines/Graffiti tool now toggles **Graffiti ↔ Point**.
- The second toggle always returns to Point rather than restoring Dash/Sprite.
- Graffiti size/taper variation defaults to disabled with a zero taper amount, preventing hidden taper from leaking through renderer branches.
- The modular build remains the source of truth; no corridor-brightness logic was changed in this split build.

# Graffiti angle modes and Lines right-click fix — 2026-10-08

- Graffiti marker angle now has `Абсолютный` and `Относительный` modes; `Абсолютный` is the default for new and imported layers when the field is missing.
- In Absolute mode, 45° remains 45° along the whole line profile; Relative mode adds the local path tangent, preserving the former tangent-following behavior.
- CPU ribbon, static WebGPU ribbon and GPU-native Morph Graffiti use the same angle-mode contract.
- Right-click/long-press on the left Lines tool now enables Graffiti without switching an already enabled Graffiti layer back off.

# SpiroStar 6.3.2 — Green/Blue intermediate-state ownership fix

- Green playlist playback no longer owns the rendered frame during its hold period.
- Blue Morph keeps running and remains visible until the configured Green transition window actually starts.
- At Green transition start, the currently resolved display layers and currently rendered Blue geometry are captured as the Green source.
- Green pauses Blue at runtime without calling `stopMorphing(false)` and therefore without committing the Blue intermediate frame into canonical `state.layers`.
- Added `projectMorph.transitionActive` to separate “Green timer enabled” from “Green owns pixels”.
- Added `morph.pausedByGreenProject` for explicit priority ownership.
- Green GPU preparation now holds the captured t=0 frame and pauses the Green clock while immutable phase resources are prepared.
- Manual Green stop restores the original cycle source project rather than the captured intermediate snapshot.
- Regression invariants cover Green hold ownership and forbid canonical Blue commits from Green quiesce.

# CHANGELOG

## v540 — Spiral lamp contour identity, Web line-colour link, complete Master mirroring
- Spiral key/corner lamps no longer find their attachment by nearest XY point. Each lamp keeps an ordered arc coordinate on its own spiral path and is re-evaluated on that same rendered rail, preventing branch swaps where neighbouring turns nearly overlap.
- Spiral lamp de-duplication preserves interior lamp identities and only collapses true shared edge endpoints within the same orbit.
- Added `Цвет паутины = цвету линии`. The Web primary colour follows the resolved layer stroke, including colour during Morph; the manual Web colour remains stored and becomes active again when the option is disabled.
- Master mode now mirrors the authored layer fields that actually changed, including nested Lamps/Web/Sweep-Lightning/Particles/Line Motion/Sprite settings. It is attached to the whole settings sidebar rather than a finite control-ID list.
- Master mirroring remains active during Morph. Non-morph-owned edits are also copied into live Blue runtime snapshots so they become visible immediately on every layer without waiting for the next cycle; parameters currently interpolated by Morph remain under Morph ownership. Runtime-only Sweep clocks are excluded so unrelated edits do not copy animation phase/timestamps or reset geometry.

## v539 — GPU-resident Corridor/lamps path for heavy playlist scenes
- Same-colour Tunnel/Corridor Glow and Base can now render directly into the WebGPU Layer Scene instead of round-tripping through the hidden GPU canvas and `CanvasRenderingContext2D.drawImage()`.
- The historical tiny-central-copy Canvas fallback is bypassed when Tunnel colour shift and palette lag are disabled; the WebGPU MAX-coverage Corridor path draws the complete line geometry.
- Deferred Corridor commands use dedicated uniform-buffer slots and persistent per-layer copy payloads so multiple deferred layers cannot overwrite one another before the final submit.
- Multi-layer Corridor scenes can remain in the GPU Frame Scene across compatible layers; Sweep/Lightning/Glint can continue in the same GPU command chain.
- Lamp textures may stay GPU-resident as a final overlay even when the already-resolved main scene contains Canvas2D work; Final uploads that resolved scene once and composites lamps on WebGPU.
- Conservative fallbacks remain for Tunnel colour-shift/palette-lag, exact Fill ordering, Web underlay, path FX/particles, compatibility mode, and dynamic Corridor stacks larger than three layers.

## v538 — state/update refactor: canonical Blue state, Morph Orchestrator, lamp context
- Синий Morph больше не пишет промежуточные кадры напрямую в `state.layers`. Каноническое состояние проекта меняется только на явных commit/rebase-границах; отображаемый кадр хранится в `runtimeState.morph.frameLayers`.
- Добавлен `SpiroMorphController`: единый владелец приоритета Orange > Blue, phase-serial для отмены устаревших callbacks, паузы/ребейза и единственного расчёта `linearT → easing → geometryT`.
- При старте оранжевого переключения текущий отображаемый Blue-кадр сначала атомарно фиксируется как canonical source, после Orange commit новая Blue-фаза строится только из новой фигуры.
- Морфинг общего Hue Offset переведён в derived runtime (`frameGlobalHueOffset`); сохранённое значение плейлиста больше не переписывается на каждом rAF и фиксируется только на boundary/commit.
- Лампы больше не используют временную подмену `state.lamps`. `withLampConfig()` стал стековым контекстом вычисления, поэтому nested Orange/Green/Blue preparation не может случайно изменить глобальную конфигурацию ламп.
- Main render pipeline и редактор профиля умеют читать derived Blue display layer, не заставляя UI/рендер писать обратно в canonical state.
- Добавлены diagnostics `__spiroMorphArchitectureStatus()` и `__spiroLampConfigContextStatus()`.
- Green Project Morph также переведён на runtime display layers (`frameRenderLayers`) и runtime lamp config (`frameLampConfig`): промежуточный Green-кадр больше не заменяет `state.layers`/`state.lamps` каждый rAF.
- Runtime layer lookup теперь следует фактически отображаемому слою, а Blue commit использует allow-list принадлежащих ему полей вместо полного `Object.assign` обратно в canonical layer.

## v537 — одновременный оранжевый + синий Morph
- Оранжевый и синий Morph теперь можно держать включёнными одновременно: ручное включение одного режима больше не выключает второй.
- Оранжевый имеет приоритет только в момент своего переключения/фейда. На это окно синий Morph временно замораживается, но остаётся включённым.
- После commit новой оранжевой фигуры полностью сбрасывается transient-состояние синей фазы (`progress`, geometry blend, light/runtime buffers, отложенные boundary callbacks), и новый синий source/target строится уже из новой фигуры.
- Старый синий boundary/GPU-prewarm больше не может поздним callback перезаписать оранжевый результат; добавлена проверка serial текущей синей фазы.
- Ручная пауза синего сохраняется через оранжевое переключение. Остановка одного из двух одновременно активных Morph не откатывает состояние второго к старому origin.
- Project/Playlist defaults теперь также разрешают одновременный Orange + Blue: между оранжевыми переключениями синий продолжает обычный цикл.

## v536 — Corridor particles, fairy dust, twinkle и visual-Z twist
- Частицы теперь повторяют все видимые копии Коридора, включая внешние контуры: WebGPU particle-pass применяет `visibleInstances` scale/lag/alpha к каждой копии и сохраняет этот путь в deferred Layer Scene. GPU fallback также использует corridor-instancing ламп.
- Для `Количество` и `Скорость` добавлены логарифмические множители `×`; они входят в конфигурацию слоя/проекта. GPU-плотность может масштабироваться выше диапазона основного ползунка с защитным лимитом.
- `Мерцание` теперь явно модулирует alpha частиц, а не только их размер. Исправлена нормализация нулевых значений: `Скорость = 0`, `Мерцание = 0`, `Прозрачность = 0` и `Радиус Z = 0` больше не заменяются дефолтами.
- Эффект `Лазерные проблески` переименован в `Пыль феи` без смены внутреннего ключа проекта; палитра стала мягкой сказочной.
- `Перья` уменьшены и получили собственный процедурный feather-sprite, ориентированный вдоль касательной контура.
- Для режима `Вокруг линии · визуальная ось Z` добавлена настройка `Закручивание вокруг линии` (0–24 оборота). Радиус и число оборотов управляют визуальной 3D-спиралью независимо.

## v535 — phase-gated GPU prewarm, FPS-independent residency и retained auxiliary passes
- Performance governor больше не меняет количество вращающихся WebGPU ring-buffer/bind-group slots при переходе между FPS-уровнями. Резидентность выбирается один раз по грубой категории памяти устройства и остаётся стабильной на протяжении сессии; изменение FPS не должно само провоцировать GPU allocation hitch или менять позиционирование визуальных эффектов.
- Cache/segment residency для Lightning/Web/Corridor и связанных retained-ресурсов также отвязана от мгновенного FPS. Governor продолжает собирать диагностику нагрузки, но не перестраивает topology GPU-кэшей прямо посреди Morph.
- Blue Morph: после подготовки immutable `SharedGpuMorphPath` до старта видимых фазовых часов дополнительно создаются exact GPU Arc resources и, если нужна Паутина, GPU corner/thread resources. Тяжёлая Spiral-фаза больше не должна выделять эти буферы на первом движущемся кадре.
- Green Morph получил такой же GPU-prewarm: endpoint correspondence, pipeline/bind groups и — если в source/target включены частицы — иерархия Green particle Arc/prefix-scan готовятся заранее. `Linear`, который начинает переход сразу, держит `t=0` до готовности; `Smooth/Fade` прогреваются во время чистой части периода и не сдвигают музыкальный/проектный таймлайн.
- Точная Молния и GPU Паутина получили retained `GPURenderBundle` для стабильных stroke/thread/mask draw-команд. Покадрово обновляются uniform buffers и compute-state, но `setPipeline/setBindGroup/draw*` не кодируются заново без изменения topology.
- Проблеск / Moving Line / Sprite (`Path FX`) также получили retained draw bundles как для Layer Scene, так и для frame-wide overlay queue. Exact Morph Arc по-прежнему переиспользуется, а render-command churn в горячем rAF-пути сокращён.
- Лампочки: identity/inertia, morph-wave и adaptive exposure теперь читают единый timestamp активного render-frame. Несколько `performance.now()` внутри одного тяжёлого paint больше не могут дать разную временную фазу подсистемам ламп.
- Smooth high-order Spiral в Blue Morph может получить до `960` immutable samples (как плотный Green rail). Бюджет выбирается один раз на фазу: качество повышается без динамической смены N/K/индексации или sample count посреди движения.
- Единый spline/arc contract сохранён: smooth polygon visual rail, точная Молния, high-precision Проблеск и GPU-потребители Morph используют один geometry phase; Spiral не получает повторный spline поверх нативного variable-width rail.
- Добавлена сводка `__spiroV535SmoothnessStatus()`.

## v534 — dense Spiral Green Morph, stable corner lamps и retained Morph draw commands
- Green project Morph больше не срезает плотные endpoint rails до 480 samples: переход сохраняет исходную плотность до 960 samples. Это устраняет повторное «переукладывание» high-order Spiral именно в начале зелёного перехода.
- Фазовое совмещение длинных замкнутых Green rails больше не перебирает каждый cyclic offset. Для небольших контуров оставлен точный exhaustive search; для dense rail используется детерминированный coarse search + локальное уточнение нескольких лучших фазовых бассейнов с той же функцией стоимости. Это уменьшает transition-start CPU spike.
- Blue/Topology Morph и Green Morph base/glow получили retained `GPURenderBundle`: стабильные pipeline/bind-group/vertex/draw команды кодируются один раз на resident uniform slot и затем исполняются повторно. Fused Glow+Base также кэшируется как один bundle sequence.
- Угловые лампы во время Blue Morph больше не ищут ближайший сегмент для вершины: точная доля пути берётся из уже вычисленного cumulative arc table. В steady state identity lookup стал O(1) по `path+vertex`; timestamp больше не входит в ID лампы. Старые runtime-ID мигрируют один раз.
- Временная база угловых ламп берётся из общего timestamp кадра, поэтому изменение FPS не создаёт отдельные «часы» для их инерции.
- Добавлена сводка `__spiroV534SmoothnessStatus()`.

## v533 — единый Layer Scene для частиц и устранение hot-path GPU object churn
- Частицы: если слой уже находится в deferred WebGPU Layer Scene, particle-pass больше не рисуется в отдельный прозрачный WebGPU canvas. Compute prerequisites (Green particle Arc / Blue exact Morph Arc) и instanced particle raster входят в тот же упорядоченный GPU command stream между Sweep и Web. Это убирает отдельный particle `queue.submit()` и браузерную композицию второго canvas на тяжёлых Morph-сценах.
- Particle draw state кэшируется как `GPURenderBundle` по стабильной паре layer-uniform/arc-resource и плотности. В кадре обновляется только uniform buffer; `setPipeline + setBindGroup + draw` повторно не кодируются, пока topology/density не изменились.
- Если все активные частицы ушли в Layer Scene, overlay-pass теперь вообще не отправляет пустой clear-command buffer и остаётся скрытым. GPU overlay сохранён только как совместимый fallback для сцен, где основной Layer Scene материализован на Canvas.
- Web / exact Lightning / canonical Glint / Morph-Graffiti / variable Graffiti получили кэш `GPUTextureView` для стабильной Layer Scene texture. У canonical Glint отдельно кэшируется и scratch-view. Создание `GPUTextureView` удалено из горячего rAF-пути этих эффектов.
- Сохраняются v529–v532 изменения: immutable GPU phase prewarm, параллельные prefix-scan для Green particles/Web corners, shared exact Arc между потребителями, C2 smooth timing, fused Blue/Green Glow+Base, indirect Web workload, 4-vertex strip raster и immutable high-order Spiral budget до 720 samples.
- Добавлена сводка `__spiroV533SmoothnessStatus()`.

## v532 — второй GPU smoothness audit: strip-raster, Web C2, particle hold reuse
- Горячие аналитические quad-проходы переведены с 6-вершинных `triangle-list` на 4-вершинные `triangle-strip`: Blue/Topology Morph base+glow, Green Morph base+glow, GPU Паутина, exact Lightning, canonical Проблеск, Path FX, лампы и частицы. Геометрия/AA не меняются, но на этих проходах число vertex-shader invocation на сегмент/спрайт уменьшается на 33%. Polygon parity/stencil masks оставлены `triangle-list`, потому что это не quad-геометрия.
- Green Morph + Particles: рассчитанный GPU Arc теперь имеет committed-state. Пока `geometryT` и `parameterT` не меняются (например, чистая часть Smooth/Fade), повторные build + hierarchical prefix-scan не запускаются; частицы только читают уже готовый arc-buffer. Одинаковые Green-arc uniform uploads также пропускаются.
- Паутина: CPU fallback и WebGPU corner/thread path используют одну quintic C2 `smootherstep` для постепенного рождения/схлопывания нитей и смены типа. Частота колебаний не изменена; временная фаза по-прежнему абсолютная.
- Canonical Проблеск получил тот же 4-вершинный GPU strip-raster, сохраняя общий exact Morph Arc / финальный spline rail. Точная Молния и Проблеск продолжают брать тот же визуальный spline, что и базовый многоугольник; повторный spline-of-spline не вводится.
- Добавлена сводка `__spiroV532SmoothnessStatus()` поверх v531 diagnostics, включая canonical Sweep/Glint и Lamp GPU status и новый raster contract.

## v531 — fused Morph raster, indirect Web workload и frame-time polish
- Blue/Topology Morph: в сценах без Fill и Web-underlay аналитические Glow + Base теперь рисуются в одном WebGPU render pass и одном `queue.submit()`. SharedGpuMorphPath вычисляется один раз, прозрачный GPU canvas композится один раз; порядок Glow → Base сохраняется. Сцены, которым необходимо вставить Fill/Паутина между Glow и Base, автоматически остаются на точном раздельном пути.
- Green advanced/smooth Morph: тот же fused Glow+Base fast path использует resident source/target correspondence и независимые `geometryT`/`parameterT`. Green Fade намеренно остаётся раздельным, поскольку source/target могут иметь разные стили/цвета.
- GPU Паутина в углах: compact-pass теперь получает число workgroup'ов через GPU `dispatchWorkgroupsIndirect`, рассчитанное из фактического числа активных углов. Плотный spline/Spiral больше не запускает фиксированный максимум 220×96 thread slots, когда реально активны лишь несколько изломов.
- Сохранены v529/v530 оптимизации: параллельные prefix-scan для Green-particle Arc и Web corner compaction, resident uniform bind-group rings, reuse уже committed exact Morph Arc между main scene / Path FX / Particles, C2 `Плавный` easing и адаптивный immutable Spiral sample budget до 720 точек для больших/high-order форм.
- Добавлена диагностическая сводка `__spiroV531SmoothnessStatus()`: показывает Green/Blue Morph, exact Arc, Web, Lightning, Path FX, Particles, GPU scheduler и performance governor без включения дополнительного рендера.

## v530 — shared-frame GPU residency, C2 timing и high-order Spiral smoothness
- FrameGraph/overlays: Path FX и Particles отправляют WebGPU overlay после commit основного GPU scene в том же display-frame. Если Паутина/точная Молния/Проблеск уже построили exact Morph Arc, overlay переиспользует committed GPU buffer и не запускает второй interpolation + prefix-scan.
- Morph Arc получил явную проверку committed-state для межпроходного reuse; Path FX/Particles показывают отдельную статистику reuse. Особенно полезно для Blue Morph + Spiral + Lightning/Web + Particles.
- Скорость `Плавный` в Blue Morph и целевой характеристике Green Smooth переведена с вложенного cubic smoothstep на одну quintic smootherstep (C2): непрерывны скорость и ускорение на границах, без искусственного ускорения в середине длинного перехода.
- Spiral Morph sample budget остаётся фиксированным на всю фазу, но теперь учитывает порядок спирали и экранный радиус. Большие/high-order smooth-спирали могут получить до 720 immutable endpoint samples; простые формы сохраняют меньший бюджет. N/K/correspondence внутри фазы не меняются.
- Единый spline/arc contract сохранён: базовый visual rail, точная Молния, high-precision Проблеск, Паутина и частицы используют одну `geometryT`; FPS остаётся только частотой предъявления кадров.
- Path FX больше не применяет локальную Hermite-кривизну поверх уже resident exact visual rail (`gpuArcResident`): точная Молния/Проблеск и остальные потребители exact rail не получают скрытый «spline поверх spline» и остаются геометрически совпадающими с отображаемым многоугольником/спиралью.

## v529 — frame-time smoothing, resident GPU transition resources
- Blue Morph: таймер видимого цикла теперь стартует только после готовности immutable GPU phase-resource. До этого отображается точный source-кадр, поэтому тяжёлая Spiral-фаза не начинает первые кадры через CPU compatibility path с последующим переключением на GPU. Transition pipelines/compute resources дополнительно прогреваются до первого движущегося кадра.
- Blue Morph base/glow: source/target geometry читается напрямую из `SharedGpuMorphPath`; uniform-параметры переведены на resident ring, а одинаковый Corridor copy-payload внутри одного display-frame упаковывается/загружается один раз и переиспользуется между base/glow.
- Green Morph: uniform buffer/bind group переведены на resident ring; одинаковый Corridor copy-payload base/glow переиспользуется внутри display-frame. Intermediate-state компилирует дерево source/target один раз и помечает неизменяемые поддеревья статическими; rAF обходит только реально меняющиеся параметры. Геометрический carrier по-прежнему остаётся GPU-resident.
- Частицы: Green Morph arc-carrier больше не имеет последовательного однопоточного прохода длины — build + hierarchical prefix-scan выполняются параллельно на GPU. Source/target endpoint-buffer переиспользуется из Green Morph renderer вместо второй загрузки. Blue Morph `interpolate → exact arc scan → particle draw` кодируется в один GPU command buffer/submit. Видимость сегмента влияет на alpha, но больше не перенормирует arc-length и не сдвигает частицы вдоль контура во время fade/open seam.
- Паутина в углах: после параллельной классификации удалён однопоточный compact-pass; используется order-preserving GPU prefix-scan + scatter, поэтому dense spline/Spiral не создаёт сериализованный хвост compute-frame.
- Точная Молния, GPU Паутина и GPU Graffiti: uniform bind groups заранее создаются кольцом и только обновляют resident uniform buffers; создание WebGPU bind group из hot rAF-path удалено.
- Единый контракт времени/геометрии повторно проверен: `geometryT` является источником истины для базовой линии, exact arc, Молнии, Паутины и частиц; характеристика Morph не применяется повторно. Точная Молния и high-precision Проблеск продолжают использовать тот же уже отображаемый spline-rail, без spline-of-spline.
- Обычные просадки FPS не обрезают elapsed-time у постепенных эффектов; re-anchor остаётся только для настоящей длительной фоновой паузы. Визуальная траектория поэтому не должна менять фазу после восстановления FPS.

## v528 — единая временная шкала, GPU Morph rail и плавность
- Синий topology/calm Morph: базовая линия и Glow читают `SharedGpuMorphPath` напрямую на WebGPU (XY + `widthScale`). Для обычного stroke больше не строится полный arc/prefix-scan; Arc создаётся только для эффектов, которым нужна длина по контуру. Variable-width Spiral теперь остаётся в этом нативном GPU-пути.
- Smooth-spline Morph получил единый финальный визуальный rail: один и тот же sampled spline используется базовой линией, точной Молнией, Проблеском и GPU-частицами. Для спирали повторный spline-of-spline запрещён. Точность endpoint sampling увеличена.
- Green Morph разделяет `geometryT` и линейный `parameterT` до самого WGSL: геометрия следует выбранной характеристике перехода, а alpha/параметры больше не получают скрытый второй `smoothstep`. Горячий deep-interpolation кэширует пары цветов, ключи объектов и профильные дорожки вместо повторной рекурсии/аллокаций каждый rAF.
- Частицы: topology Blue Morph читает resident GPU Arc напрямую; Green Morph получил собственный GPU compute-carrier source→target с текущими сегментами/длинами без материализации промежуточного JS-контура. Поиск сегмента остаётся бинарным, bind groups/буферы переиспользуются.
- Паутина в углах: исчезнувший из классификации угол больше не выбрасывается мгновенно. Его GPU-state плавно затухает, поэтому нити схлопываются без однокадрового обрыва. Все обычные пропуски кадров учитываются по wall-clock; re-anchor происходит только после настоящей фоновой паузы.
- Спиральный Morph: при открытии/закрытии шва или смене порядка в аккуратном режиме N/K/структурный шаг фиксируются на фазу. Увеличен адаптивный budget для smooth-спиралей (до 360 точек) ради более ровной формы без возврата к прежним 720 точкам для всех случаев.
- Общая временная плавность: Corridor, motion/palette/rotation и инерция ламп больше не отбрасывают часть времени на тяжёлом кадре. FPS может уменьшить число показанных кадров, но не должен менять фазу, скорость или положение после восстановления.
- Live `profileNodes` синего Morph обновляются только с частотой вспомогательного редактора (~8 Гц); фактическая отрисовка остаётся full-rAF на GPU. Это убирает дублирующую CPU-интерполяцию длинных профилей/спиралей.

## v527 — GPU smoothness, Web, particles, spiral continuity
- Колеблющаяся Паутина больше не отключает нативный WebGPU Morph-path: фаза колебаний считается по абсолютному времени в WGSL и не зависит от FPS/фазы Morph. Добавлен отдельный логарифмический множитель силы `×1`; существующая частота сохранена.
- `В углах` теперь ориентируется на структурные изломы/ключевые вершины. Для GPU Morph метки изломов объединяются между source/target, поэтому угол не пропадает посреди перехода. Глубина остаётся локальной относительно прилегающих ветвей.
- Для `Лазерных нитей` добавлен второстепенный цвет. `Шёлковые нити` заменены на `Паучье Солнце`: истинная биссектриса + радиальный веер дополнительных медиан с автоматическим числом по `Градусов на медиану` (20°); поперечины соединяют соседние медианы. На скруглённом угле центр веера привязывается к оценённому центру радиуса.
- Палитра стала состоянием проекта: выбор ЛКМ/ПКМ в быстром меню подсвечивает активную палитру и применяет её к линиям, синему Morph, минимальному/оранжевому Morph, цветовой анимации и particle palette.
- Частицы получили устойчивый рендер: основной WebGPU instancing + GPU fallback через retained lamp backend при прогреве/недоступности WebGPU overlay. Добавлены `Разброс` и `Вариация размера` с логарифмическими множителями; seed стабилен между кадрами. Поиск сегмента на длинном контуре заменён с O(N) на O(log N), bind groups переиспользуются.
- В синем Morph `Аккуратный морфинг спиралей` включён по умолчанию. При входе/выходе из спирали и смене её порядка N/K и custom topology фиксируются на фазу, а не спиральный endpoint представляется в совместимой спиральной топологии с практически нулевым порядком, чтобы профиль размыкался/сходился без дискретного topology-jump.
- Общая плавность: постепенные эффекты переведены на абсолютную фазу там, где возможно; убраны лишние покадровые quantize/double-easing и dt-clamp, которые меняли скорость после просадки FPS. Синий Morph рисует точный конечный кадр перед commit.
- Точная Молния и высокоточный Проблеск повторно используют уже отображаемый spline-rail (включая Green Morph rail), не строя spline поверх spline; адаптивная GPU-flatten точной Молнии ужесточена.
- Green Morph больше не переписывает живой `state.morph` на каждом кадре промежуточного проекта: frame-параметры хранятся отдельно, что уменьшает инвалидирование кэшей и микрорывки.

## v526 — Green Morph intermediate state + GPU transition rail
- Зелёный Morph получил чёткие режимы: `Фейд / слайд-шоу` держит исходный проект чистым до окна перехода; базовый `Линейный` делает непрерывный visibility-crossfade; галочка `Усложнённый линейный` включает настоящий линейный intermediate-state; `Плавное перетекание` держит проект чистым и перестраивает геометрию только в финальном окне.
- Новые defaults: период проекта `16 с`, время перехода `4 с`; при музыкальной синхронизации — `32 такта` на проект и `8 тактов` на переход. При появлении BPM/TAP музыкальная привязка включается автоматически. Старый `fadeSec` мигрирует в `Время перехода`.
- Advanced Linear/Smooth больше не пересобирают готовую CPU-геометрию базовой линии каждый кадр: correspondence source/target остаётся resident на WebGPU, XY/variable-width Spiral интерполируются в WGSL. CPU-геометрия материализуется лениво только для совместимых вспомогательных эффектов, которым она действительно нужна.
- Fade/Basic Linear также используют GPU source/target correspondence для base/glow, включая variable-width Spiral. Во время чистой части Fade/Smooth зелёный scheduler не инициирует бессмысленные canvas paints.
- Перед зелёным переходом снимается точный видимый source-кадр, после чего невидимый синий/оранжевый Morph приостанавливается; это убирает двойной расчёт геометрии в фоне. На commit целевой проект заново применяет только свои default-флажки Morph/Corridor.
- Intermediate-state разделяет `geometry progress` и линейный `parameter progress`: Smooth использует тип скорости синего Morph целевого проекта для перестройки геометрии, а числовые параметры идут линейно. Дискретные эффекты вроде Проблеска переключаются на границе веса `0.5`; лампы двигаются по geometry progress, а их появление/угасание — по линейному весу.
- Ручное выключение зелёного Morph теперь возвращает исходный/предыдущий проект и его default playback modes вместо замораживания полу-переходного состояния.
- `Точная молния`: arc-length Bézier-сегментов переведён с 5-точечной на 10-точечную Gauss–Legendre интеграцию, inverse distance→t уточнён до 9 итераций; для уже отрисованной Green Morph spline-rail исключён повторный spline-of-spline.

## v525 — Паутина, лампы, Audio Master, Corridor px
- `Паутина в углах`: `Глубина в угол` теперь является настоящим процентом расстояния до соседних углов по текущему видимому контуру; значение по умолчанию остаётся 20%. Скруглённый/Morph-контур больше не схлопывает глубину из-за плотной дискретизации.
- Включение/выключение паутины получило собственный scheduler tick: эффект начинает вылезать из углов сразу после нажатия, даже на статичной сцене. На reveal убран двойной slow-attack; исчезновение остаётся непрерывным, а внешняя прямая рвётся по одной линии.
- Угловые лампы получили детерминированные ID по контуру/слоту. Падение FPS и пропущенный nearest-rematch больше не создают новую лампу с новой позицией.
- Audio Routing → Master: глобальные связи теперь можно инвертировать одним нажатием `＋/−`; исправлено удаление `×` (Master-массив больше не заменяется за спиной UI, удаление дополнительно разрешает canonical route по id).
- Corridor: виньетирование задаётся в пикселях (`px`) вместо `×`. Старые проекты и плейлисты автоматически переводят legacy-величину в приблизительно эквивалентную ширину; старый default `0.5×` мигрирует примерно в `54 px`.

## v524 — Playlist GPU Morph и частицы
- Playlist: при ручном и автоматическом переключении `Морфить по умолчанию`, `Оранжевый Morph по умолчанию` и `Коридорить по умолчанию` теперь применяются строго по целевому проекту; состояние предыдущего проекта больше не переносится скрыто.
- Green/playlist Morph: убран лишний preserve/rebase на границе проекта; покадровые layer/config-объекты переиспользуются вместо глубокой аллокации, что уменьшает GC-скачки в первые секунды перехода.
- Green Morph WebGPU: соответствие source/target готовится один раз, а интерполяция XY, variable-width Spiral, Corridor copies и base/glow raster выполняются в WGSL. Legacy stroke/vector staging пропускается, когда нативный путь доступен.
- Green Morph и лампы используют один visual progress; исправлено расхождение raw/eased времени, из-за которого линия могла убегать от ламп на Smooth-переходе. Лампы сопоставляются по стабильному положению вдоль каждого контура вместо nearest-neighbour.
- Добавлен idle/prewarm GPU-пайплайнов Playlist, линии, ламп и частиц для уменьшения первого shader-compile hitch.
- Добавлен независимый эффект `★ Частицы` под Проблеском: `Звёздная пыль`, `Искры пламени`, `Лазерные проблески`, `Перья`, `Глаза`, `Плазма`; режимы `Вдоль всего контура`, `К углам`, `Спираль вокруг линии · Z`.
- Частицы не зависят от Morph и сохраняются в проекте. Цвет: специальный пресет (по умолчанию), цвет линии или выбранная палитра. Анимация, procedural sprite shading и raster — WebGPU-only; CPU хранит/обновляет только retained-таблицу сегментов контура.

## 5.2
- Спираль: WebGL2 теперь использует нативную variable-width команду вместо отдельной команды на каждый микросегмент; особенно снижена CPU/GC-нагрузка в Corridor без WebGPU.
- Спираль/Corridor: покадровые GPU-рекордеры переиспользуются между кадрами; при нулевом скруглении устранена повторная сборка одинаковой геометрии замыкания.
- Топологический и Спокойный Morph: восстановлена точная семантика всех типов скорости (`Плавный`, `Линейный`, `Ускорение`, `Замедление`, `Ускор.-замедл.`, `Fast Out Slow In`, `Anticipate`, `Overshoot`, `Anticipate Overshoot`, `Bounce`).
- GPU compute/arc и CPU fallback теперь получают один и тот же eased progress; `Anticipate`/`Overshoot` больше не обрезаются до 0…1. Лампы Topology/Calm синхронизированы с той же фазой.
- Диагностика: `__spiroReportMorphSpeedStatus()` показывает linear/eased/geometry/transmitted progress.

## v523 — Паутина
- Исправлена привязка нитей к реально отображаемому контуру: концы теперь идут по текущему скруглённому/Morph-контуру, а не по исходным рёбрам профиля.
- Старый внешний изгиб переименован в `Внешняя — дуговая`; добавлена `Внешняя — прямая` для вогнутых углов — хорды остаются строго линейными и отсечены внешней областью многоугольника.
- Селектор `Внутренняя / Внешняя / Комбинированная` заменён тремя независимыми флажками: `Внутренняя`, `Внешняя — прямая`, `Внешняя — дуговая`. Старые проекты мигрируют автоматически; историческая `Внешняя` соответствует новой дуговой.
- Добавлены стили `Паутина`, `Лазерные нити`, `Шёлковые нити`.
- Появление/исчезновение анимировано: дуговые нити схлопываются обратно в угол; прямые внешние нити рвутся по одной, начиная с самой дальней.
- Исправлена `Колеблющаяся паутина`: амплитуда стала заметной, кадры продолжают обновляться во время колебаний; у прямых хорд колеблются точки крепления по контуру без изгиба самой хорды.
- Рендер остаётся GPU-first: внутренняя топологическая Morph-паутина сохраняет нативный WebGPU fast path; динамические/внешние ветви растеризуются через WebGPU/WebGL2 со stencil-отсечением, Canvas используется только как fallback.

## v522.16
- Топологический Morph: добавлен GPU-native fast path для базовой линии — точки интерполируются compute-шейдером и сразу растеризуются WebGPU; несовместимые комбинации остаются на точном fallback. Диагностика: `__spiroTopologyMorphRenderStatus()` и `__spiroTopologyMorphGPUStatus()`.
- Штрих: длина маркера по умолчанию ×4. Молния: коэффициент частоты ударов по умолчанию ×1.
- Паутина: типы `Внутренняя / Внешняя / Комбинированная`, по умолчанию `Внутренняя`.
- Паутина: режимы `В углах / На самопересечениях / Самопересечения + Коридор`; текущий рабочий режим `На самопересечениях` сохранён и оставлен режимом по умолчанию.
- Паутина: добавлено колебание нитей (по умолчанию выключено), сила и логарифмический коэффициент частоты ×0.25…×64; ×1 = одно колебание за цикл Morph.
- Порядок композиции изменён: обычная линия и профильные эффекты рисуются поверх Паутины.

## v522.15
- Fill снова GPU-first: static Fill возвращён в native WebGPU Layer Scene; Canvas2D теперь только fallback.
- `__spiroReportFillStatus()` показывает topology → backend → final presentation и причину, если Fill не был отрисован.

## v522.14
- Исправлена потеря статической Canvas-заливки в многослойном GPU FrameGraph.

## v522.13
- Штрих/Graffiti: добавлена поэтапная GPU-диагностика без покадрового спама.
- Graffiti Glow: убраны треугольные ореолы, свечение вынесено в отдельный аналитический GPU pass.

## v522.12
- Sprite переведён в GPU-first; Corridor Web использует стабильный WebGL2 GPU path.

## v522.11
- Исправлен Corridor copy staging null access; убран покадровый GPU-line spam.

## v522.10
- Исправлены bootstrap/import race и WGSL validation errors базовой GPU-линии.


## Corridor particle visibility fix
- Added `visibleInstances.particleAlphas` as a sparse-effect alpha channel.
- Corridor particles no longer inherit stroke-only `densityFade`, which was multiplying with particle opacity/twinkle/envelopes and making them nearly invisible toward the corridor center.
- Stroke `alphas` and normalized fill `fillAlphas` are unchanged.

## 6.3.1 — Multi / Linear Blue Morph fix
- Removed the hidden `smoothstep` from Circle Slide edge-collapse profile amplitude.
- The blue Morph controller remains the only owner of easing; Circle Slide consumers now use its resolved clock without a second easing pass.
- Fixes visibly non-linear Linear morphing on non-flat multi-layer profiles such as the playlist project `Multi`.

## 6.3.3 — Background controls + transparent desktop
- Restored explicit **Choose custom background** and **Reset background** commands inside the bottom-right right-click scene/background menu.
- Re-selecting the same image now works because the hidden file input is reset before opening.
- Background set/reset explicitly invalidates the render/presentation path, including WebGPU presentation state.
- Added **Transparent desktop** mode. The workspace background, project background image and grid are suppressed while scene canvases keep alpha.
- Transparent mode bypasses the opaque Final WebGPU compositor/deferred composite path so lamp/particle/line alpha remains available to a transparent native window.
- Added an optional desktop-host bridge (`setTransparentDesktop`, `setWindowTransparent`, or `setTransparent`) for Electron/Tauri/native wrappers. In a normal browser the page workspace becomes transparent, but the browser window itself cannot expose OS desktop pixels.
- Transparent desktop state is stored with project settings.

## 6.6 stop/phase hotfix
- Fixed Spiral -> non-Spiral Morph stop/commit leaving `closedLoop=false`, which rendered detached profile strokes after stopping.
- Restored Morph origin now invalidates geometry/style/transform resources before the first static frame.
- Spiral handedness override stays continuous in geometry instead of being quantized back to -1/0/+1.

## Somata 6.6 — GPU Spiral Morph performance hotfix
- `Stop` for full Blue Morph is a rollback to the last completed stable phase. It no longer commits the intermediate frame and no longer destroys Spiral WebGPU resources synchronously on the click path.
- Phase-circle Smooth Spiral Morph keeps cubic endpoint rails resident on WebGPU and evaluates phase interpolation/cubic segments in WGSL.
- Compatible Spiral Morph layers now render directly into the shared WebGPU Layer/Frame Scene instead of performing a per-layer WebGPU-canvas → Canvas2D `drawImage()` bridge.
- Copy-transform buffers and base/glow uniform buffers are resident per layer so deferred frame submission cannot observe data overwritten by later layers.
- Repeated auxiliary CPU path requests at the same morph progress are cached; CPU path materialization remains only for effects that explicitly need path points.
- Old per-phase GPU resources are retired asynchronously instead of being synchronously destroyed at a phase/Stop boundary.

## Somata 7.0.13 — Compact precision sliders + multipliers
- Pixel-size sliders that previously used very wide ranges now use a precise compact base range no larger than 50, with a right-side multiplier for large effective values.
- Compact controls cover Line Motion amplitude/wavelength, lamp radius, Glint Glow size, Lightning Glow size, particle visual-Z radius, and main stroke width. Existing Glow/profile pixel controls already below 50 remain unchanged.
- Legacy project values above 50 are migrated to an equivalent base × multiplier pair, preserving the rendered effective size.
- Geometry vertex count `N` now uses a 2–30 base slider plus a right-side multiplier and an explicit effective vertex readout; canonical geometry remains capped at 120 vertices for backward compatibility/performance.
- Line Motion and particle-Z multipliers are part of the authored effect state and are consumed directly by the GPU render paths.
- Percentage, degree, time, frequency and hidden compatibility controls retain their semantic ranges instead of being incorrectly treated as pixel sizes.

## Spectral Glint — cycle-locked perimeter pass
- Spectral Glint is now locked to the authored Glint/Lightning-preflash cycle: one cycle performs exactly one 360° traversal and finishes at the starting seam.
- The active spectral sector no longer modulo-wraps across the seam near the end of a lap, so it cannot relight geometry already visited in that same cycle.
- Lightning spectral preflash uses normalized precharge progress, guaranteeing a complete lap within the preflash stage instead of depending on an unrelated wall-clock °/s phase.
- The retained Bézier WebGPU path and the diagnostic Canvas fallback use the same seam-safe cycle contract.

## 7.2 visibility / console patch
- Layer eye visibility now stays authoritative while Blue Morph is running; runtime frame/light copies mirror canonical visibility immediately.
- Right-click layer isolation restores/synchronizes visibility during live Morph instead of waiting for a phase rebuild.
- Strict Spiral failed FullGPU presentation keeps the last valid GPU frame on screen while retrying, avoiding transient blocky/blank flashes without enabling Canvas fallback.
- In-app console now mirrors important Spiral/FullGPU diagnostics (while still suppressing known-benign Canvas fallback telemetry).
- Added “Копировать всё” to the in-app console.

### 7.2.4 hotfix2 — ярко1 / Corridor Fill freeze
- Corridor native Fill now joins an already-resident GPU Layer Scene instead of requesting a second scene while Glow/Spiral owns the first one.
- Strict-Spiral materialization firewall now applies to the whole frame intent, preventing an earlier ordinary layer from poisoning a later strict Spiral presentation.
- Tunnel/strict FullGPU scenes bypass stale FrameGraph materialization cooldown so native Corridor Fill cannot wait for hundreds of frames.
- In-app GPU diagnostic serialization is bounded and hidden/collapsed console DOM is updated lazily to avoid diagnostic-induced main-thread Long Tasks.

## 7.2.4 hotfix5 — iOS/WebKit bootstrap

- Restored the complete original application DOM in `index.html`; no `app-shell.html`/XHR bootstrap is used.
- Removed parser-blocking inline JavaScript from `<head>` and moved the unchanged boot guard to `js/bootstrap/boot-guard.js`.
- Moved the existing classic application script manifest into `<head>` with `defer`, preserving its exact execution order while allowing Safari/WebKit to discover and download JS immediately.
- CSS is discovered before JavaScript. Runtime application modules and hotfix2 rendering/error-console fixes are otherwise unchanged.
