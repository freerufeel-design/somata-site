# Somata 7.3.20 — Spiral seam rounding hotfixes

## Fixed regression 1 — 0% still curved a hard seam

### Symptom
For a Closed Spiral with tangentiality disabled, **0% vertex rounding** could still produce a visibly curved/bowed period span. Moving the slider above zero switched to a different geometry path and made the rail look correct.

### Root cause
`finalizePeriodicSpiralBezierCarrier()` always rewrote the last cubic's C2 control point to enforce C1 continuity across the rotate+scale period seam. A segmented non-tangential Spiral at 0% intentionally has a hard seam, so that unconditional C2 rewrite bowed the span. The dynamic WebGPU Morph closure pass had the same position/tangent coupling.

### Fix
- Periodic endpoint **position** remains exact in all cases.
- Periodic **C1 tangent** repair is applied only to a tangential continuous period or to an explicitly generated seam fillet.
- A hard auto-close bridge remains hard unless it owns a real fillet.
- Morph packs positional periodicity and tangent ownership independently and excludes intentional hard seams from tangent-error diagnostics.

## Fixed regression 2 — tails/hooks above ~33% rounding

### Symptom
With a straight Segment profile, Closed Spiral + Corridor and seam rounding enabled, increasing rounding to about **34% and above** could produce a hook/tail at the transition to the next period. The supplied screenshot showed the defect at **38%**.

### Root cause
The 90-degree Segment period is compacted to two mapped spans. Seam rounding trims the final span before the original period endpoint. The new clipped endpoint was emitted without a fillet-protection tag, so the retained-cubic builder reused the preceding knot's Bézier controls from the **old untrimmed span**. Once the trim passed the old C2 handle (around one third rounding for this layout), the endpoint derivative reversed: the cubic overshot the clipped endpoint and doubled back, creating the visible tail.

This was a geometry-metadata ownership bug, not a Corridor copy-spacing or playlist problem.

### Fix
- Every clipped closure-fillet boundary is now explicitly protected, including a boundary already emitted by a polyline slice.
- The periodic seam's trimmed end boundary is protected before retained cubics are rebuilt, preventing stale full-span C1/C2 controls from crossing into the shortened span.
- The same boundary rule is applied to interior closure fillets and final-space profile fillets to prevent the same class of stale-control tail at other rounded cuts.
- The older seam diagnostic helper was kept consistent with the same ownership rule.

## Fixed regression 3 — Tangentiality broke as soon as rounding became non-zero

### Symptom
With **Tangentiality from both ends** enabled, the Spiral is correct at 0% rounding. As soon as the vertex-rounding slider moves above zero, the transition between self-similar periods is visibly bent and no longer follows the authored tangential trajectory.

### Root cause
`buildClosedSpiralAutoCloseGeometry()` decided whether the period seam was a kink by comparing the first and last **tessellation chords**. A true logarithmic spiral is curved, so a coarse sampled chord pair has a measurable angle even when the mathematical endpoint derivatives are exactly C1. At 0% the closure-rounding stage exits early; at any non-zero value the false angle exceeded the kink threshold and an unnecessary `period-seam` fillet was inserted.

### Fix
- For a continuous Tangential period, seam classification now uses the retained mapped endpoint derivatives and their rotate+scale periodic transform.
- Tessellation-chord fallback remains for non-tangential, legacy, or derivative-less geometry.
- A true tangent mismatch is still rounded normally; Tangential mode is not used as a blanket bypass.
- Full endpoint slices preserve the mapped derivative metadata required by this classifier, while clipped interior boundaries stay metadata-safe so the high-rounding tail fix remains intact.

## Validation

- `tests/spiral-zero-rounding-seam-invariants.js` — PASS.
- `tests/spiral-tangential-rounding-invariants.js` — PASS at 1%, 38%, 100%, and 200% on an exact C1 Tangential seam; deliberate 20° mismatch still rounds.
- New numerical regression `tests/spiral-high-rounding-tail-invariants.js` — PASS at 34%, 38%, and 75%.
  - It checks the actual retained cubic endpoint derivative and rejects any cubic whose C2 lies beyond a newly clipped P3 and makes the curve reverse into a tail.
  - The same test fails on the pre-fix source at 34%, 38%, and 75%, reproducing the reported threshold/shape.
- Full invariant suite: **45/45 PASS**.
- Application JavaScript syntax validation: **59/59 files PASS** (`node --check`).
- Default playlist/effect matrix and playlist invariants remain PASS as part of the full suite.

Hardware/browser visual execution is not available in this sandbox, so this package does not claim a live GPU screenshot certification. The reported 38% failure is reproduced and verified directly at the retained-cubic geometry level.

## Fixed regression 4 — Lamp position modes did not match the UI contract

### Required behavior
- **Key / «Ключевое»**: only the logical ends of ordinary/Spiral paths; interior profile bends must not leak into this population.
- **Corners / «На изломах»**: every Key endpoint **plus** authored bend points.
- Authored bends remain lamp identities even when the visible stroke has been rounded or evaluated as a Smooth spline.

### Fix
- Spiral Key anchors now contain only path start/end identities (with the shared periodic Corridor seam de-duplicated).
- Corners mode explicitly merges Key identities with bend identities in static, CPU Morph, and retained-Spiral GPU paths.
- A separate `lampCornerFlags` channel is consumed by the corner collector, so a rounded fillet/spline cannot erase an authored bend lamp.
- Smooth Spiral profiles now derive logical bend markers from the authored control polyline without feeding those markers back into the spline geometry (so the spline stays smooth).
- Blue Morph source/target endpoint snapshots carry those logical spline-bend flags across phase boundaries.

## Fixed regression 5 — Arbitrary lamp Density ignored on Spiral Morph

### Root cause
The retained-Spiral GPU lamp path had its own population rule and/or evaluated density outside the active per-layer lamp-config context. It could therefore keep a nearly fixed population while the UI Density control changed.

### Fix
- The special Spiral path now uses the same `allocateGpuArbitraryLampCounts()` population policy as ordinary Arbitrary lamps.
- Density evaluation accepts and receives the actual frame/layer lamp config (`density` and `densityMultiplier`) instead of falling back to the edited/global config.
- The count allocation is performed once per frame (O(pathCount)) instead of once per path.
- Regression execution verifies a 240-unit path produces 5 / 10 / 20 lamps at 50% / 100% / 200%, honors the multiplier, and produces zero at 0%.

## Fixed regression 6 — Spiral Morph could stall in Corridor Fill GPU wait

### Symptom from supplied diagnostics
`corridor-native-fill` reported no native topology, followed by `corridor-gpu-wait`, then `MORPH_SCHEDULER_WATCHDOG` / `MORPH_RAF_GAP`, while measured CPU frame work itself remained low.

### Root cause
Dynamic Corridor Fill was requested during a Spiral Morph frame, but the geometry contract excluded Spiral endpoints from native dynamic Fill eligibility. Because Corridor blocks Canvas fallback, that impossible combination retried as a GPU-only wait. A delayed browser rAF could also survive a watchdog recovery and later fire beside the replacement schedule.

### Fix
- Dynamic Spiral Corridor frames are allowed to run native Fill preflight.
- If the current retained Spiral rail is open and has no closed fill topology, Fill is explicitly suppressed for that frame (`corridor-no-closed-fill`) while Base/Morph continue; it no longer enters the impossible `corridor-gpu-wait` loop.
- If a real closed native mesh exists, it still uses the normal resident WebGPU Fill path.
- Scheduler watchdog recovery cancels the stale rAF before the synchronous recovery tick, preventing a later duplicate callback from double-advancing a Morph boundary.
- Modified runtime assets use the `v7320-hf4` cache-buster so a browser cannot silently execute the previous hotfix files.

## Validation after regressions 4–6

- New `tests/lamp-modes-density-spiral-morph-regressions.js` — PASS.
- Full invariant suite: **46/46 PASS**.
- Application JavaScript syntax validation: **59/59 PASS** (`node --check`).
- Existing zero-rounding, high-rounding-tail and Tangential+rounding regressions remain PASS.
- Default playlist/effect matrix and playlist invariants remain PASS.
- `default.plist` was not modified; SHA-256 remains `69ca8e228e099320acc198a6eec7a7dc326fd6cade8aa29ff5a30f156c005a6a`.

A real browser/WebGPU device is not available in this sandbox, so the package does not claim a live GPU visual certification. The exact control-flow condition from the supplied `corridor-gpu-wait` log is covered by the new regression assertions.

## Feature — FreezeLight Rain + trail hardness (hotfix 5)

### Requested behavior
- Add **FreezeLight Rain** as a separate checkbox under ordinary FreezeLight.
- Rain is independent from ordinary FreezeLight: either mode can run alone, or both can be enabled together.
- Rain controls: **degrees** (fall direction), **length in seconds**, and **hardness**.
- Ordinary FreezeLight also gains **hardness**.
- Hardness contract:
  - **50%** = exactly linear opacity falloff with trail age.
  - **0%** = no visible historical trail (the current lamp itself remains visible).
  - **100%** = uniform historical opacity until the configured time limit, then a hard cutoff.
  - Values below/above 50% bend the age envelope below/above the linear curve with a hyperbolic-style response.

### Implementation
- Ordinary FreezeLight and FreezeLight Rain have separate RGBA16F ping-pong histories; they do not feed into one another.
- The history alpha channel stores trail age in seconds; RGB stores the already age-weighted historical lamp energy. This allows the feedback pass to apply an age envelope instead of a single frame-wide exponential multiplier.
- Rain advects its own previous history in screen space. Degree convention is **0° right, 90° down, 180° left, 270° up**. The advection speed is resolution-scaled and fixed, so the requested Rain UI remains exactly direction + lifetime + hardness.
- When both modes are active, their independent histories are merged only in a final max-combine pass before lamp tone mapping.
- Enabling Rain on a static scene explicitly starts an initial history-build interval, so a rain streak appears even without geometry movement.
- Each mode has its own reset path; toggling or changing ordinary FreezeLight parameters does not erase the Rain history, and vice versa.
- Old projects remain compatible: missing fields default to FreezeLight hardness 50%, Rain off, Rain 90°, 1.5 s, hardness 50%.
- New fields are stored automatically in project/layer lamp settings and playlist default settings through the existing lamp config clone path.

### UI / persistence fields
- `freezeHardness`
- `freezeRain`
- `freezeRainDegrees`
- `freezeRainTailSec`
- `freezeRainHardness`

### Validation
- New `tests/freezelight-rain-hardness-invariants.js` — PASS.
- Numerical envelope regression verifies 0%, 50%, 100% and both sides of 50%.
- Independent history, independent reset, Rain advection and static-scene startup contracts are asserted.
- Full invariant suite: **47/47 PASS**.
- Application JavaScript syntax validation: **59/59 PASS** (`node --check`).
- `default.plist` was not modified; SHA-256 remains `69ca8e228e099320acc198a6eec7a7dc326fd6cade8aa29ff5a30f156c005a6a`.
- Changed/hotfixed runtime assets are cache-busted with `v7320-hf5`.

A live browser/WebGPU visual run could not be completed in this sandbox: the installed Chromium is blocked by the environment policy from opening the local test origin, and its GPU process cannot initialize the available display backend. The package therefore does not claim live GPU visual certification; shader/control contracts are covered by static invariants and the existing WebGPU validation suite.

## Feature refinement — FreezeLight Rain controls (hotfix 6)

Requested behavior implemented:
- Rain direction default is now **180° = down**. New convention: 0° up, 90° right, 180° down, 270° left.
- Direction slider snaps in **5°** increments; an adjacent numeric field accepts exact **1°** manual values.
- Existing hotfix-5 Rain angles are migrated by +90° so an old saved 90°-down project still points down after loading.
- Added **Rain glow source**: `Только core` (default) or `Вся лампа`.
  - Core mode filters the low-alpha outer halo only in the Rain feedback seed.
  - The full current lamp is composited back after the Rain feedback pass, so enabling core-only Rain does not shrink the live lamp itself.
- Added **Rain speed** 0–100%:
  - 0% = no advection,
  - 50% = the previous fixed Rain velocity,
  - 0–99% follows a hyperbolic `p/(1-p)` speed law around the 50% reference,
  - 100% moves history beyond at least one canvas diagonal per frame (instant endpoint).
- FreezeLight Rain remains independent of ordinary FreezeLight; both histories and reset paths remain separate.

Verification:
- invariant suite: **47/47 PASS**;
- application JavaScript syntax: **59/59 PASS** (`node --check`);
- `default.plist` unchanged.

## Spiral Topological Morph smoothness (hotfix 7)

### Root cause
Polygon Topological Morph and Spiral Morph did not use the same intermediate geometry path. Spiral endpoints are retained as exact cubic Bézier rails and equalized by exact De Casteljau splits. During the morph, control points of the resulting cubic pieces are interpolated independently. A technical equalization split is not an authored corner, but the previous tangent-repair pass was dispatched only when either endpoint profile used `spline`. With an ordinary Segment-profile Spiral, those technical joins could therefore stay only C0-position-continuous while their handle directions diverged, producing visible stair/saw kinks in intermediate frames. The resident visual rail also used only 12 linear samples per retained cubic, which could expose additional faceting at large radii/high curvature.

### Fix
- Tangent repair now runs for every internal retained-cubic join on the same path, regardless of Segment/Spline profile mode.
- Authored source/target corner flags remain authoritative: real bends stay sharp; a corner that exists at only one morph endpoint fades the repair strength continuously instead of popping.
- The exact retained cubic remains the geometry authority; only technical De Casteljau cuts are made G1-continuous.
- The resident Fast Visual Rail sampling budget is increased from 12 to 24 intervals per cubic. Arc/effect metric subdivision remains independently bounded at 8.
- Modified runtime files use the `v7320-hf7` cache-buster.

### Validation
- Added `tests/spiral-topology-smoothness-invariants.js`.
- The test mirrors the tangent repair and verifies collinear incoming/outgoing handles at a technical join.
- A 300 px quarter-circle quality probe measures approximately 0.688 px maximum chord deviation at 12 intervals versus 0.173 px at 24 intervals.
- Full invariant suite: **48/48 PASS**.
- Application JavaScript syntax: **59/59 PASS** (`node --check`).
- `default.plist` unchanged; SHA-256 remains `69ca8e228e099320acc198a6eec7a7dc326fd6cade8aa29ff5a30f156c005a6a`.

A live browser/WebGPU visual run is not claimed by this package; the exact retained-cubic topology, tangent-repair dispatch, authored-corner preservation, and visual subdivision budget are covered by regression invariants.

## hf8 — restore authored 12-point budget; smoothness by topology, not brute-force density

- Reverted the hf7 visual Bézier rail increase from 24 back to the original 12 subdivisions.
- Restored static Spiral retained-cubic metadata and runtime audit values to 12.
- Kept the hf7 G1 repair at non-authored technical De Casteljau cuts: the staircase fix now depends on correct tangent continuity and exact arc-knot placement, not on doubling samples.
- Verified the user-visible spline point budget remains 12 by default and authored spline samples are distributed by arc length.
- Modified runtime files use the `v7320-hf8` cache-buster.

## FreezeLight Corridor tracking + color controls (hotfix 9)

### Corridor tracking regression
Ordinary FreezeLight is a screen-space feedback effect, but its scheduler decides whether to keep advancing the feedback history from a compact motion signature. Native WebGPU Arc/Topology lamps can move entirely inside resident GPU geometry while their CPU-side object identity/root transform stays unchanged. In Corridor, copy transforms are likewise supplied through the shared Corridor transform basis. The old signature omitted the packed native lamp attachment data and did not hash that exact basis, so a visibly moving lamp could be classified as static; the retained trail then looked pinned to an unrelated/old point.

The motion signature now hashes:
- every packed native Arc/Topology lamp attachment record (path/identity, fraction, local offsets, direct segment/t values, style/alpha);
- current Arc/Topology Morph phase/serial;
- the exact `WebGPUCorridorCopyStore.getTransformBasis(...)` values used by the Corridor lamp shader;
- root/frame transform terms already used by the renderer.

This does not invent a separate FreezeLight position. The trail is still built from the actually rasterized lamp pixels; the change makes the scheduler follow the same resident GPU motion that produces those pixels.

### UI structure
- Ordinary **FreezeLight** and **FreezeLight Rain** are now two independent bordered sub-blocks.
- Each block initially shows only its enable checkbox.
- Its parameters are revealed/enabled only while that effect is checked.
- Rain remains independent from ordinary FreezeLight and retains its own history/reset path.

### Ordinary FreezeLight color
Added `freezeColorMode` with four choices:
- `lamp` — original lamp color (default);
- `line` — current line color;
- `fixed` — user selected color;
- `hue` — the historical tail changes hue continuously through the requested ± degree range while the live lamp remains at its source color.

Added `freezeColor`, `freezeHueDegrees` and persistence/default normalization for old projects.

### Chromatic aberration
Added an independent `freezeChromatic` checkbox (OFF by default) and `freezeChromaticColor`. The extra color is generated only at the outer FreezeLight fringe in the final tone pass, so it does not feed back into/pollute the persistent FreezeLight history.

### Validation
- New `tests/freezelight-corridor-color-invariants.js` covers the two collapsed UI blocks, color modes, hue range, chromatic fringe, native Arc/Topology attachment hashing and exact Corridor transform-basis hashing.
- Existing Rain/hardness/direction/source/speed regression remains PASS.
- Full invariant suite: **49/49 PASS**.
- Application JavaScript syntax: **59/59 PASS** (`node --check`).
- `default.plist` was not modified; SHA-256 remains `69ca8e228e099320acc198a6eec7a7dc326fd6cade8aa29ff5a30f156c005a6a`.
- Modified assets use `v7320-hf9` cache-busters.

A live WebGPU device is not available in this sandbox, so this package does not claim a hardware screenshot certification. The resident-Corridor motion ownership that caused the reported FreezeLight pinning is covered directly by the new runtime-signature invariants.

## Rainbow / CPU HD stall (hotfix 10)

### Why «Радуга» could look frozen
The bundled project **«Радуга»** is the only default-playlist project that combines rainbow lamps with `hd:true`. Its lamp is large (`radius:50`) and very soft (`softness:100`), so the CPU HD path supersamples a very large halo. At DPR≈2 one such lamp is roughly a 3M-sample temporary workload; twelve lamps can request >30M supersampled pixels in one frame. The existing CPU temporal-soak artifact already captured the symptom on this project: `lastTickDurationMs: 99.6`, one watchdog recovery and three Morph-freeze detections.

The rainbow hue calculation itself is not the main stall. The saved HD option makes the CPU fallback disproportionately expensive; the project name/color mode merely makes this regression easy to reproduce.

### Fix
- CPU HD lamp supersampling is now a bounded quality enhancement, not a mandatory all-cost render path.
- The per-frame SSAA cap is **8M temporary sample pixels** (resolution-aware lower budget down to 2M).
- Before painting an HD visual-plan batch, the renderer estimates the whole batch cost. If the batch would exceed the remaining frame budget, the entire batch uses the existing **exact final-resolution radial-gradient renderer** uniformly for that frame.
- The legacy direct-points lamp path uses the same batch preflight.
- Individual HD draws retain a hard budget guard as a second line of defense.
- Lamps are never skipped; only extra SSAA is dropped under overload.
- `default.plist` is intentionally unchanged, so the authored `HD` setting in «Радуга» remains saved.
- `js/legacy/app-b.js` uses cache-buster `v7320-hf10`.

### Validation
- Added `tests/rainbow-lamp-performance-invariants.js` using the actual «Радуга» project as the fixture.
- The regression test verifies the authored Rainbow + HD combination remains in the playlist and numerically exceeds the new HD budget, so the preflight must choose the direct-gradient path before expensive SSAA begins.
- Full invariant suite: **50/50 PASS**.
- Application JavaScript syntax: **59/59 PASS** (`node --check`).
- `default.plist` SHA-256 remains `69ca8e228e099320acc198a6eec7a7dc326fd6cade8aa29ff5a30f156c005a6a`.

A new live browser timing is not claimed in this sandbox; the historical 99.6ms timing is from the packaged browser soak artifact, while the hotfix is validated by the exact workload/budget regression and full invariant suite.

## Hotfix 11 — iPhone fullscreen / presentation mode

- Fixed the mobile fullscreen button on iPhone. iPhone WebKit still does not expose arbitrary-element Fullscreen API, so Somata now uses an app-owned presentation fallback instead of reporting a dead fullscreen action.
- The fallback fills the actual `VisualViewport`, tracks rotation and Safari viewport-size changes, hides editor chrome, centers the artwork, and provides an explicit safe-area-aware exit button.
- Added Apple standalone/PWA metadata and a web-app manifest. When Somata is launched from the iPhone Home Screen, the same presentation mode runs without Safari browser chrome.
- Added the missing sizing rules for the legacy/prefixed WebKit fullscreen branch used on supported Apple devices.
- Added `tests/iphone-fullscreen-invariants.js`.
