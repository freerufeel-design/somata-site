
## 7.8.3 configurable artistic effect order regression

- `v783-effect-order-static-morph-regression.js` exercises the real File → Settings drag/drop list and reset-to-default action.
- The canonical bottom→top default is `Fill → Web → Geometry (Glow/Line/Profile/Graffiti) → Lamps → Sweep/Glint/Lightning → Motion/Sprite → Particles`.
- The regression requires real Fill mesh preparation and Web GPU-command preparation both in Static and during an active Morph.
- It also swaps Web and Fill and verifies that queued Layer Scene phases change with the user order rather than with technical pass execution order.
- `v75-effect-stack-order.js`, `contracts.js`, and `gpu-effect-scene-routing.js` protect the single-source-of-truth compositor contract instead of legacy fixed phase numbers.
# Somata 7.5 — development preflight
### 7.8.3 Fill/Web FeatureHost contract regression

- `v783-fill-web-featurehost-generation-regression.js` must execute Fill and Web through the real `FeatureHost`/`PassRegistry` boundary, never by calling the Fill helper directly.
- Fill owns `_fillBelowWebResolved`, `_fillRenderedBelowWeb`, and `_suppressLateFillForWeb`; Web explicitly reads `_fillBelowWebResolved`. Undeclared scratch state is intentionally masked by FeatureHost.
- With Fill enabled, all three Web placement modes (`corners`, `selfIntersection`, `selfIntersectionCorridor`) must remain visible in Static and during active Morph. A Fill warm-up/miss may suppress late Fill for that frame, but it must not stop Web generation/presentation.


`tests/` is development-only and must never be loaded by `index.html`.

## Mandatory order

Run only:

```bash
node tests/run-all.js
```

`run-all.js` executes the complete gate in this order:

1. Static integrity and architecture contracts: `static-modules.js`, `contracts.js`, `v75-legacy-dead-code-regression.js`, `browser-preflight.js`, `browser-harness-cleanup.js`.
   Current 7.7.9 core gate also runs `v779-line-effect-timeline-sync-regression.js`: an induced main-thread stall must advance the real Base/Line geometry plan to the same wall-clock point instead of leaving the line behind moving effects. `v779-dynamic-fill-unified-regression.js` requires ordinary dynamic Morph Fill to use the same current-frame Line command carrier and native GPU stencil Fill backend instead of falling into an empty GPU-mask chain.
2. 7.5 field regressions: `v75-effect-stack-order.js`, `v75-web-bezier-contour.js`, `v75-web-branch-rendering.js`, `v75-spiral-web-adversarial.js`, `v75-lightning-performance.js`, `v75-mobile-runtime-regression.js`, `v75-mobile-landscape-regression.js`, `v75-mobile-landscape-fps-copy-regression.js`, `v75-mobile-landscape-toast-visibility-regression.js`, `v75-mobile-narrow-hit-regression.js`, `v75-mobile-view-reset-regression.js`, `v75-mobile-landscape-desktop-brand-regression.js`, `v75-mobile-header-touch-regression.js`, `v75-mobile-parameter-focus-spiral-regression.js`, `v75-mobile-audio-panels-spiral-regression.js`, `v75-mobile-spiral-controls-touch-regression.js`, `v75-mobile-project-morph-panel-spiral-regression.js`, `v75-spiral-mobile-orientation-stress.js`, `v75-spiral-narrow-mobile-stress.js`, `v75-spiral-effect-fault-recovery.js`, `v75-spiral-mobile-fullscreen-stress.js`, `v75-spiral-mobile-dpr-budget-stress.js`.
3. Desktop, Spiral/Morph and profile continuity suites.
4. Real UI actions plus GPU scene routing and focused Graffiti/Lamp/Lightning regressions.
5. Full effect stability and main-control coverage.
6. `v75-checkbox-functional-coverage.js` — every settings checkbox is clicked through the real DOM event path; dead/disabled/no-op controls fail the build and synchronous handlers have a 100 ms stall guard.
7. `effect-render-impact.js` — renderer-driving controls must change real geometry/style/GPU-bound plans and the next frame must arrive.
8. `stability-soak.js` — fresh-browser repetitions of the critical UI/routing/Web/Lightning/checkbox/stability/render-impact suites.

Do not package on any fail or timeout. A wrapper timeout is not a PASS; run the interrupted constituent suite directly and require its own PASS marker.

## 7.5 field regressions that must stay covered

- Legacy dead-code cleanup is locked by `v75-legacy-dead-code-regression.js`: the obsolete full Master snapshot normalizer and unused morph-like activity wrapper must stay absent, while changed-path Master broadcast and `getMorphActivityState()` diagnostics remain present.
- Effect stack is user-configurable in **File → Settings → Порядок эффектов**. Default bottom→top: **Fill → Web → Geometry (Glow/Line/Profile/Graffiti) → Lamps → Sweep/Glint/Lightning → Motion/Sprite → Particles**. Every GPU Layer Scene command derives its compositor phase from the same central stack; tests must not depend on historical hard-coded phase numbers.
- Web must follow the real rendered Bézier contour, not an independent rounded-polyline contour. The regression requires retained cubic truth, curved segments, dense adaptive preview geometry and a measurable departure from the legacy rounded path.
- Fresh-browser cleanup is itself a regression: `browser-harness-cleanup.js` requires `close()` to wait for Chromium exit (SIGTERM with bounded SIGKILL fallback), so long soak chains cannot accumulate browser teardown races.
- Web branches (`inside`, `outsideStraight`, `outsideArc`) must each emit finite thread commands on `closed`, `spiral-closed` and `spiral-open`, including topology switches during active Blue Morph. Spiral corner identity comes from authored topology while the thread carrier remains the exact rendered contour.
- Spiral/Web adversarial coverage runs 48 deterministic non-degenerate N/K/order/step/rounding/profile geometries through closed/open Spiral and all three Web branches (288 render cases); every case must keep finite non-empty contour/corners/thread commands.
- Mobile bottom-dock/FPS controls must expose at least 44×44 px touch targets. Android native-fullscreen no-op falls back to app fullscreen, iPhone uses the app fullscreen path, and tapping FPS on mobile copies captured errors with the toast `Ошибки скопированы`. Installed PWA display mode requests fullscreen.
- Mobile portrait ↔ landscape must remain in the touch UI even when landscape width exceeds 760 px: dock/FPS/sidebar launcher stay reachable, launcher → tool → sidebar uses the real mobile handlers, sidebar/fullscreen exits are at least 44×44, pseudo-fullscreen follows viewport rotation, and the scheduler leaves `inFrame`.
- Mobile FPS error-copy behavior uses the same short coarse-touch landscape contract as the rest of the mobile UI; 844×390 must copy the diagnostic log and show `Ошибки скопированы`, never silently switch to desktop console behavior.
- Mobile FPS confirmation must be physically visible, not merely class-active: in 844×390 coarse-touch landscape the toast must have non-`none` display, visible opacity, a non-zero viewport rect and the exact text `Ошибки скопированы`. The legacy width-only desktop hide rule must not return.
- Narrow 320×568 mobile portrait must keep bottom-dock content inside the scrollable dock origin. Flex overflow is left-anchored so ordered controls never escape into negative/unscrollable space or sit under the FPS counter.
- Mobile `Reset View` uses the same mobile viewport contract in portrait and short coarse-touch landscape; both reset to 90% and clear pan instead of landscape jumping to the desktop 100% default. Initial state uses the same query.
- Desktop detached-output/brand UI must never leak into short coarse-touch mobile landscape. At 844×390 the launcher and stage stay hidden, runtime reports non-desktop, and programmatic toggle is rejected; desktop 1280×720 behavior remains covered separately.
- Mobile top-header actions follow the same touch contract as the bottom dock: portrait and short coarse-touch landscape use one horizontally scrollable row, every live button/select is at least 44×44, and a real touch on a scrolled header control must still reach live state and the Spiral/Web renderer.
- Mobile long-press parameter focus uses the same portrait/short-coarse-landscape contract. Service `.blue-morph-dual` ranges must not hide the authored slider from focus detection; a real long-press on Radius must open a visible focus dock, preserve ≥44×44 step controls, change live Spiral geometry/Web output, then restore the authored control on close.
- Mobile audio-reactive/routing panels use the same portrait/short-coarse-landscape contract as the rest of the touch UI. In 844×390 they must start below the 60 px header, remain fully inside the viewport, expose reachable ≥44×44 close controls, and opening/closing either panel must not stall active Spiral + Morph or invalidate Web commands.
- Mobile Project Morph settings use the same portrait/short-coarse-landscape contract: the fixed panel must stay inside the visual viewport, use `100dvh` height budgeting, expose ≥44 px numeric/select/checkbox-label targets, and a real touch/edit of transition time must preserve active Spiral + Morph + Web render stability.
- Spiral combined mobile orientation stress keeps Spiral + Web + Graffiti + Lamps + Sweep + Particles + Corridor + active Morph alive across repeated portrait↔landscape changes and Spiral open/closed switches; render plans stay finite/non-empty, Morph advances and the scheduler never remains `inFrame`.
- The same combined Spiral stress also runs on narrow 320×568 ↔ 568×320 mobile viewports, covering compact-device rotation without changing the production Spiral renderer.
- Spiral pass fault recovery runs the real render scheduler with active Spiral + Morph + Web/Lamps/Sweep/Particles/Corridor and injects one fault each into Web, Lamps, Sweep, Particles and Base across portrait/landscape. Every pass must be isolated, the next frames/paints must arrive, Morph must advance, render plans must recover and `paintErrors` must stay zero.
- Spiral mobile fullscreen stress enters/exits fullscreen through the real mobile buttons while Spiral + Morph + Web/Lamps/Sweep/Particles/Corridor is live, rotates repeatedly, changes emulated device DPR, requires finite non-empty effect plans and scheduler liveness, restores pre-fullscreen pan, and verifies that the mobile canvas backing-store scale stays capped at the renderer DPR budget (≤2.05× logical size).
- Spiral mobile DPR budget stress covers normal (non-fullscreen) portrait/landscape viewports from 320×568 to 915×412 and emulated DPR 1→5. Web/Sweep/Corridor stay non-empty, Morph advances, the scheduler stays live, and each canvas backing-store axis remains within the ≤2.05× renderer budget relative to its actual CSS size.
- Lightning exact mode remains on the retained cubic Arc, but 7.5 uses a balanced 4× raster lattice and analytic halo for precharge/strike/afterglow. The legacy separable-blur and Graffiti-contour-glow dependency must not return.
- Every settings checkbox must perform an observable intended action through native `click/change`, produce no uncaught exception, leave the scheduler alive and stay below the synchronous-handler stall guard. The hidden no-op `lineSpriteEnabled` control is deliberately removed.
- RMB Geometry hides all authored lines immediately; second RMB restores the remembered set.
- RMB Web and RMB Sweep become live immediately in a static scene.
- LMB on a collapsed left rail expands it and opens the exact clicked section.
- Geometry circles (`circumscribed / inscribed / median / key-points`) produce non-degenerate full-circle GPU commands.
- Enabling Master preserves every layer as-is. A later edit broadcasts only the changed property/path to all layers; unrelated settings on each layer remain different.
- Web `initializing=true` means wait + repaint, not encode error.
- Rejected final GPU composite must present the current GPU scene or disable the stale final surface.
- Blue Morph survives `open → spiral-closed → spiral-open → closed`, recovers from an rAF gap, and completes at least 3 cycles without starving `afterNextPaint` boundary commits. After a delayed frame it resumes from the current wall-clock timeline; it must not shift `cycleStart` to create a Morph-only catch-up lag while effects continue on current time.
- Topology/Calm/circleSlide all obey the same frame-time rule: there is no Morph-only stall clamp. Live rounding preview may update an active frame immediately only for ordinary non-topology Standard rounding. Topology and Mono Radius must still rebase geometry atomically so a rounding edit cannot hard-snap the current Morph frame or desynchronize radius compensation.
- Lightning owns an independent `Current profile / Line` selector. `Exact` uses the rounded/spline/Bézier carrier; `Simple` uses the raw unsmoothed polyline.
- Corridor center reveal is applied per instance before line/glow/lamp/Web/Sweep/particle rendering and follows real copy spacing.
- Adaptive Lamp exposure uses the persistent live config and keeps continuous timing through Morph.

## Control coverage

The existing render-impact matrix covers the main range controls for Line/Geometry, Graffiti, Spiral, Lamps, Web, Glint, Lightning, Corridor, Morph, Particles and Audio. The 7.5 checkbox audit adds all 129 settings checkboxes (including five data-driven Morph group checkboxes without IDs) on top of that matrix. A newly added range control must get a render-impact assertion; a newly added checkbox is automatically discovered and must have observable behavior or the build goes red.

## What “renders” means locally

Local Chromium does not provide reliable hardware WebGPU. The gate therefore proves: real UI event → live state → non-empty finite geometry/effect plan → GPU-bound commands/queue input → next frame arrives → scheduler leaves `inFrame`; uncaught exceptions and paint errors stay zero. Static Lightning performance contracts additionally prevent reintroduction of the expensive blur chain and 6× exact raster. Actual NVIDIA/AMD/Apple GPU pixels and true FPS remain the final authority.

## 7.5 verification rule

**field regression → reproducing red test on 7.4.30 → runtime fix → focused PASS → full old+new gate → package the exact bytes → unpack that ZIP fresh → run the gate again.**

Historical sections below document earlier releases; their old stack descriptions are historical, not the active 7.5 contract.

## 7.4.9 additions

- Adaptive lamp exposure now keeps stable layer-config identity through the render pass and uses a continuous time response during Morph.
- `lampAdaptiveFadeSec` is treated as exposure/settling time; changing Morph load no longer restarts the transition every frame.
- Brightness-channel adaptation is explicitly regression-tested independently from radius-channel adaptation.
- Corridor reveal remains per-instance before glow/composite.
- Reveal width is one actual corridor copy interval (`endScale - startScale`), so it follows spacing automatically.
- Runtime user actions include Corridor pre-glow emergence, adaptive-brightness Morph/exposure/channel behavior and the real Orange Morph Mandala selector/target path: `12/12` expected.
- `GPU-5DC05452 / geometry/base / WebGPU stroke batch was not created` is treated as transient for two consecutive frames with repaint/warmup; only a persistent miss escalates as an error.

Rule: **field regression → reproducing test → runtime fix → full gate → package**.

## 7.4.9 verification

Adaptive-brightness regression added after field failure: Morph + non-zero exposure + brightness/radius channel switching. The render pass must preserve persistent lamp-config identity. Two independent fresh-browser soak cycles passed after the fix.

## 7.4.10 additions

- Fixed Web + base Glow ordering. A combined stroke batch no longer marks Glow as finished when Web forces a separate under-Base GPU scene. Glow is deferred, Web is materialized, then the same prepared Glow role is composited before Base.
- GPU routing regression now requires `Web + Glow ordering preservation`; 7.4.11 extends it with `Lamps above Base/contour`, so the expected routing marker is `5/5`.

## 7.4.10 verification

Field regression: enabling Web made the base-line Glow disappear because the combined stroke batch marked Glow as handled before Web forced a separate under-Base GPU scene. Regression coverage now requires Web materialization first, then the prepared Glow role, then Base. GPU routing is `4/4`. Two independent fresh-browser soak cycles passed after the fix.
## 7.4.11 additions

- Lamps must visually composite above the Base contour in both the final WebGPU compositor and direct/fallback presentation.
- Lamp accumulation remains additive inside the lamp HDR texture, but presentation is premultiplied `source-over`, so the contour cannot show through the opaque lamp body.
- GPU routing regression now includes `Lamps composite above Base/contour`; expected routing marker is `5/5`.


## 7.4.11 verification

Field regression: Lamps appeared visually below the Base contour because final/direct lamp presentation used additive-only composition. The lamp HDR accumulation stays additive internally, while both the final WebGPU compositor and direct/fallback presentation now use premultiplied source-over so the lamp body is above the contour. Focused GPU routing is `5/5`. The full mandatory suites through render-impact passed on the final 7.4.11 bytes; the wrapper command reached its external timeout only when entering the embedded soak. Two independent fresh-browser `SOMATA_SOAK_CYCLES=1` runs then passed on those same final bytes.


## 7.4.12 additions

- Desktop-only Somata logo is part of the header layout at widths above 760 px.
- The logo is hidden completely at 760 px and below and cannot intercept pointer input.
- `desktop-logo.js` verifies the real responsive CSS state at desktop and mobile viewport widths.

## 7.4.12 verification

Desktop logo regression verified at 1280 px: visible at 100×55 px, left-aligned before header controls with no overlap and `pointer-events:none`. At 390 px it is fully hidden (`display:none`, 0×0). The mandatory gate passed through render-impact; two independent fresh-browser one-cycle soak runs passed on the same final files.

## 7.4.13 additions

- Replaced `assets/somata-logo.webp` with the newly supplied logo artwork.
- Header geometry is unchanged: desktop-only, 100×55 px, non-interactive, hidden at 760 px and below.

## 7.4.13 verification

The replacement asset was loaded from the final build. `desktop-logo.js`, `static-modules.js`, and `browser-preflight.js` all passed; production rendering code was not changed.

## 7.4.19 additions

- Desktop header logo is reduced to the same 28 px height as the neighboring desktop icon buttons.
- Clicking the logo toggles a centered, non-interactive brand image over the real `mainContainer` workspace.
- The same click opens/reuses a normal resizable browser popup (`somataExternalOutput`) next to the main window so it can be dragged to another monitor.
- The popup mirrors the live GPU presentation via `HTMLCanvasElement.captureStream(60)`, preferring `finalGpuCanvas` while active and falling back to `mainCanvas`; the centered DOM logo is therefore not burned into the detached output.
- Popup blocking must not break the main runtime: the centered logo still activates and the failure remains a warning/status condition.
- A second logo click or `Escape` closes the centered-logo/output mode; resizing to mobile closes it as well.

## 7.4.19 desktop-output verification

`desktop-logo.js` must verify the real desktop button height against the neighboring toolbar button, exact centering inside `mainContainer`, a real `window.open` attempt with movable/resizable popup features, safe popup-blocked behavior, toggle-off behavior, and complete mobile hiding.

## 7.4.19 verification

The desktop-output regression exercises both popup-blocked and popup-open paths. In the open-path stub it verifies that the popup receives the live `mainCanvas` stream at 60 fps, begins playback, and stops its capture track when the mode closes. The centered logo is measured against the actual `mainContainer` center. The monolithic `run-all.js` wrapper reached the external command timeout during the later suites, so it is not used as a false PASS marker; all constituent suites were run directly, and two independent fresh-browser one-cycle soak runs passed after the final popup URL/capture fix.


## 7.4.19 Spiral Morph continuity correction

- **Неразрывный** keeps the authored Spiral topology fixed (`N` and `K`) and transports the retained cubic rail without path disappearance.
- **Фазовый** now also keeps `N` and `K` fixed. The `Шаг K` morph control changes the independent effective `spiralStep` instead of rebuilding topology, and Corridor copies receive the matching continuously changing phase rotation.
- **Компенсация вращения** is anchored to the outermost visible Spiral layer. In Phase mode it measures the actual outer-tip angular displacement, so that outer reference point is stationary after the inverse viewport compensation.
- **Фазово-окружностный** may change `N` and `K`. When the number of Spiral orbit paths changes, extra retained rails merge into / split from coincident rails while staying fully present.
- **Минимальный поворот** is now the constant-step / variable-vertex mode: `K` and explicit `spiralStep` stay fixed while `N` may change. Its retained rail uses least-turn polar transport for ordinary moves, with Cartesian protection only for an impossible extra >180° winding.
- **Топологический · без блокировок** does not lock `N`, `K`, Spiral-order direction, or generated profile endpoints. It keeps retained rails present and performs topology merge/split with Cartesian transport, so unrestricted topology changes do not turn into multi-revolution polar spins.
- **Рваный** deliberately keeps the old appear/disappear topology behavior.
- Corridor **Затенение центра** for Spiral is applied as a radial geometry-space feather. Whole-copy center alpha is removed from the Spiral base/glow pass before the radial mask is applied, so a large Spiral copy cannot leak its own central segments back into the hidden center.

`spiral-morph-continuity.js` starts the real blue Morph from the UI and verifies all six Spiral modes. It checks fixed `N/K` plus changing effective step in Phase, constant `K/spiralStep` plus changing `N` in Minimal-turn, unrestricted `N/K/order` in Topological, exact Corridor phase, outer-layer rotation-compensation anchoring, retained-rail presence, finite coordinates, internal seam error, a <=180° polar-turn invariant, sampled frame-to-frame displacement, radial Spiral center shading, and aggressive profile/topology stress cases.

## 7.4.19 Spiral joints, profile-mode transition, and alternating band Fill

`spiral-profile-fill-continuity.js` is the focused regression for this release. It loads the real browser UI and verifies: retained Spiral cubic joints are position-continuous; closed even Spiral branches produce alternating neighboring-pair Fill bands; odd/open Spiral topology does not attempt that Fill; the `Отрезки ↔ Сплайн` transition control is present directly under spline mode; both `Вся фаза` and `1 сек` policies are monotone, endpoint-smooth and reversible; dynamic retained Spiral rails can prepare the same band Fill without changing the rail subdivision budget.

The visual transition is implemented by interpolating the existing Bézier handle field, not by adding curve samples. Internal GPU rail joins receive only a sub-pixel tangent overlap where a real neighboring segment exists; actual path ends are not lengthened.


## 7.4.22 focused regressions
- Spiral fill stays OFF by default, while its selected type defaults to `interwinding`; explicit legacy `chopped` projects remain chopped.
- Morph N has `vertexMultiplier`: generated target vertex counts are always multiples of it and min/max snap to valid multiples.
- `phaseCircle` and `minimalTurn` force retained continuous presence/closure even when the outer blue Morph mode is Fade.
- The 120 ms scheduler recovery watchdog remains active, but freeze diagnostics report only material stalls: render >= 160 ms, rAF gap >= 180 ms, watchdog delay >= 220 ms.

## 7.4.22 focused regression

- Ordinary geometry has one authoritative FrameContour. The current default artistic stack is Fill → Web → Geometry (Glow/Line/Profile/Graffiti) → Lamps → Sweep/Lightning → Motion/Sprite → Particles, but File → Settings may reorder these groups. Every Layer Scene phase must come from `SomataEffectStackOrder`; historical fixed phase numbers are no longer a contract. Palette/Fill regression remains mandatory: real palette contextmenu toggles Fill with static per-layer memory and Morph 0↔remembered range, Geometry contextmenu hides Line without disabling Fill, FrameContour recording must keep the layer stroke color, and Layer Scene must warm WebGPU before Web probes it.
- Lamps preserve their selected blend mode and are composited at the Lamps group's current artistic-stack position; the final-lamp path carries the same selected blend mode when scene interleaving is not needed.
- The historical Web-under-Base materialization path is disabled; Web ordering is now phase-stable for both ordinary and Graffiti contours.
- Corridor Web parity clipping is now reset per corridor copy, so nested masks no longer XOR neighboring copies into an every-second-ring pattern.
- Sweep/Glint/Lightning, PathFX and Particles derive their Layer Scene positions from the same configurable stack, so detachable Output and the main canvas consume the same bottom→top ordering.
- Orange Morph has a top-level `Режим оранжевого морфинга` selector with `Стандартный` and `Мандала`. Mandala generates nested layers with a shared N symmetry and alternating half-sector rotation, while preserving live layer effects through the existing Orange Morph effect-preservation bridge.
- Recovered one-frame GPU warm-up/scene-unavailable diagnostics are warnings, not error-console entries; repeated Fill-unavailable spam is deduplicated and downgraded from `console.error`.


## 7.4.29 focused regressions

- Orange `Мандала` now has its own `Мандала` profile library. The Orange factory selects its generated layer profiles from that library, while the left profile browser exposes it as a fifth group.
- The left profile-group tabs duplicate the Blue Morph membership checkboxes: clicking the tab body only browses that group, clicking its checkbox changes Morph membership. Blue Morph uses a compact checkbox dropdown and marks the currently browsed group without changing its checked state.
- `Отрезки ↔ Сплайн` transition timing supports `Вся фаза`, `Начало фазы`, and `Конец фазы`. Start/End expose a 0–100% phase-span control; 0% is an instantaneous hand-off and 100% consumes the whole phase.
- Graffiti in `Сплайн` mode now consumes the same high-precision spline carrier instead of the sharp auxiliary profile polyline.
- Morphable sidebar parameters can be toggled by RMB on the parameter label. Participating rows use an inset cyan highlight with no border-size change; while Blue Morph is running, numeric range controls swap in place to two cyan min/max thumbs that edit the allowed Morph range rather than the current authored value.
- The Morph header has a factory reset (`⟳`) in addition to clear/undo checkboxes.
- Fill/Web combined routing is covered explicitly. Physical per-layer invocation now follows Base/Profile → Web → Lamps → Sweep → Particles, matching the resident GPU phase order so Fill/Web are not lost by premature Layer Scene materialization.
- `profile-morph-ui-regression.js` drives the real UI and checks Mandala library selection, duplicate group checkboxes, RMB participation, live dual ranges, factory reset, Graffiti spline carrier, Fill+Web coexistence, and Orange Mandala profile output.

### 7.4.29 focused regression

`node tests/lamp-freeze-static-regression.js` verifies exact-texel static Freeze Light feedback, independent Freeze Light / Rain reset and motion state, immediate adaptive exposure in geometry-static mode, live-effect-owner Glow, bounded Graffiti Glow retry, and external/unattributed rAF-gap classification.


## 7.4.29 Spiral stability / lightning impact / Orange colors

- `spiral-stability-torture.js` runs four captured high-crossing Spiral regressions plus 180 deterministic adversarial source/target pairs across Continuous, Phase, Phase-circle, Minimal-turn, Topological and Torn. It requires finite retained-cubic data, exact internal joins and zero cyclic branch-pair inversions. The pairing contract is order-preserving around the circle, including merge/split when N changes, so topology changes cannot create a criss-cross “vermicelli” rail field.
- `orange-random-colors.js` drives the real dice and Orange Morph UI for all shared profile groups and requires the first three generated layer colors to be three different random colors from the selected palette path rather than fixed palette slots.
- `lightning-impact-regression.js` asserts that exact Lightning strike/afterglow halos use the analytic GPU halo field instead of per-style separable blur. Precharge may still use the smoother blur path; impact frames avoid the expensive blur chain.

### 7.4.29 Freeze/Master/Orange regression additions

- `lamp-freeze-static-regression.js` now requires history-preserving tail-duration slew, monotonic max-at-tail hue change, independent Rain emitter/history state, and a Corridor-independent Rain emitter snapshot that refreshes only when the Rain motion signature changes.
- `runtime-user-actions.js` enables Master on deliberately different layers, verifies that enable does not normalise them, changes one scalar and one nested Web property, and requires only those exact paths to broadcast.
- `orange-random-colors.js` performs repeated real dice and Orange Morph starts and rejects both duplicate first-three colours and the historical fixed first-three palette-slot pattern.


### 7.4.29 Graffiti Glow / Lamp blending

- Graffiti contour Glow keeps the normal 12-tap blur budget at ordinary radii, but increases the sample lattice up to 32 taps per side for large radii so high-power Glow no longer breaks into discrete bands.
- The normalized contour blur receives width-aware energy compensation before the final alpha composite, bringing Graffiti Glow power closer to the analytic ordinary-line Glow without changing the profile carrier.
- Lamp blending is now a six-mode contract shared by Canvas fallback and GPU presentation: `Lighter`, `Screen`, `Normal`, `Color Dodge`, `Inverted / Difference`, and `По цветности / Color`.
- Resident `Web → Lamps → Sweep` interleave uses a destination scratch and an explicit blend shader, rather than hard-coded source-over. Direct final composition transports the same selected blend mode.
- `graffiti-glow-lamp-blend-regression.js` verifies the adaptive Glow shader, all six UI modes, distinct Canvas reference pixels for Lighter/Screen and Normal/Color Dodge, plus the blend-aware GPU routing contract.


### 7.4.30 Orange family/pools + Graffiti Lightning aftershock

- Orange Morph owns an independent `family` (`mix`, `square`, `triangle`, `sine`) and an independent multi-select `profileGroups` pool. These controls use the same profile metadata/library as Blue Morph, but never read or mutate Blue Morph selections. The real dice button and Orange Morph target generator both consume the Orange family + union of checked pools.
- The Orange “Морфить по умолчанию” row is the first setting in the Orange panel.
- `orange-family-pools.js` verifies two simultaneous Orange pools plus a Square family filter through both real dice generation and a real Orange Morph start, while pinning Blue Morph to a conflicting family/pool to prove independence.
- Graffiti-profile Lightning afterglow now includes `microPulses`: the strongest live micro-strike drives the retained Graffiti carrier instead of being discarded by the single Graffiti visual pass. `graffiti-lightning-aftershock-regression.js` proves after-stage carrier persistence, pulse intensity recovery and alternating secondary/primary micro-strike colour.

- Active Blue Morph rounding changes are immediate: real `paramRounding` input must update the current Morph frame in the same event, then reach the next paint without scheduler/paint errors.

- `v75-rounding-morph-stall-jump-regression.js` — active rounded Spiral + Web + Blue Morph must not catch up a long main-thread/rAF stall as one large progress jump; scheduler recovery and finite render data must continue.

- `v75-morph-mode-gpu-prewarm-recovery.js` selects every Blue Morph mode through the real top selector and requires an active scheduler, advancing progress/geometry, paints and a finite frame. It also locks the general GPU-prewarm failure contract: `MORPH_FULL_GPU_PREWARM_FAILED` must release `gpuPhasePreparing`, rebuild skipped retained-Spiral CPU geometry and restore scheduler ownership instead of fail-closing the Morph timeline.


## 7.6.0 shared Profile Morph / carrier architecture

- `v76-profile-carrier-architecture.js` locks the 7.6 separation between Morph semantics and carrier mapping. The real top selector must keep `Topology`, `Calm`, and `Circle` distinct; a Spiral `phaseCircle` transport may change how the shared profile is laid onto the retained Spiral carrier, but it may not rewrite the selected global Morph mode. Polygon and Spiral share the same profile/Morph contract and clock; Spiral may execute that profile through its retained Bézier GPU carrier. Generic CPU geometry is compatibility/recovery only when the retained GPU carrier is unavailable.
- `v76-gpu-warmup-nonblocking.js` locks the non-blocking GPU contract. `gpuPhaseWarming` is diagnostic/preparation state only: progress, geometry time, paints, and scheduler ownership continue while specialized/shared GPU resources warm. Completing the warmup must not reset progress or restart `cycleStart`.
- The 7.6 invariant is `shared profile Morph -> carrier mapping -> renderer`. Polygon and Spiral use the same Morph clock and selected Morph mode. Spiral keeps its special order/step/seam/retained-Bézier transport and specialized renderer as a carrier implementation, not as a second Morph controller.


## 7.6.1 Morph stop / stall continuity

- `v761-static-morph-stop-continuity.js` reproduces the real `btnMorph` click path and requires user stop to freeze the last resolved Morph frame into canonical static state instead of rolling back to the pre-Morph geometry. It covers profile nodes plus N/K, radius/rotation/rounding, Spiral and chaos/carrier state.
- `v761-topology-calm-stall-continuity.js` blocks the main thread during active Topology and Calm Morph and requires the same bounded timeline catch-up already used by Circle Morph; progress must resume without a visible jump and scheduler state must remain healthy.
- User-triggered full-Morph stop (`btnMorph` and Space when Space is configured as stop) now commits the visible frame. Internal preset/random replacement paths keep the explicit rollback/default stop behavior because they immediately replace canonical layers.


## 7.6.2 Static/dynamic geometry invariant

- `v762-static-dynamic-geometry-invariant.js` renders an authored spline polygon in static mode, then probes Blue Morph at exact `t=0` in Fade and Topology.
- PASS requires pixel identity with the static frame at the Morph boundary. Fade must cross-fade exact static endpoint snapshots; Topology/Calm polygon motion must move carrier vertices and rebuild the contour through the same profile mapping used by static rendering.
- Regression target: no resampling of the finished spline contour as the primary polygon Morph representation; without rounding, polygon joins remain authored/sharp and only carrier-point motion changes.

## 7.6.3 Spiral carrier/profile invariant

- `v763-spiral-carrier-profile-invariant.js` certifies the Spiral counterpart of the 7.6.2 polygon rule: build/move the carrier first, then map the authored line profile with the same constructor used in static geometry.
- Both Spiral baselines are covered: linear/chord and tangential logarithmic-radial mapping.
- Static `buildOrbitPolylines()` output is compared against the explicit carrier builder at retained Bezier-control level. The allowed difference is numerical epsilon only.
- Non-torn Spiral Morph must advertise `carrierMapped=true`, keep finite/non-empty retained geometry, avoid carrier overflow, and move only a small amount at `t=0.001`; an immediate first-phase reshape is a failure.
- Endpoint cubic count normalization must use exact Bezier subdivision of each endpoint rail. Cross-endpoint arc re-segmentation is forbidden because it changes the static endpoint before Morph has moved.
- Torn transport remains a dedicated appear/disappear topology path and is not claimed to satisfy this carrier-remap invariant. Fade keeps its exact endpoint cross-fade semantics.

## 7.6.4 Static Spiral closure / recursive rounding / center reveal

- `v764-spiral-static-round-fade-regression.js` locks the static counterpart of the retained Spiral rules. Static upload is explicitly re-finalized with the same periodic endpoint/tangent transform used by Morph, rather than trusting a separate cached rail path.
- When authored rounding consumes a short following span and creates a secondary kink, every smooth/non-authored Bezier join is tangent-repaired after the fillet pass. This is the CPU/static analogue of the existing Morph GPU tangent-repair pass; authored hard corners are not reclassified as smooth.
- Corridor/Spiral center emergence has one owner: the Corridor copy alpha. Spiral base/glow/fill must not apply an additional radial screen-space center mask. The emerging copy fades continuously before composition, while any unrelated line that merely crosses the center remains untouched.

## 7.6.5 Spiral Glow / whole-copy center reveal

- `v765-spiral-glow-copy-fade-regression.js` locks two hardware-visible regressions reported after 7.6.4.
- Retained Spiral Morph must route Glow through the same retained Bezier rail as Base even when strict-Spiral presentation is disabled; otherwise `prepareLayerStrokeWebGPUBatch()` skips the general batch and Glow disappears only during Morph.
- Static/general Corridor uses one alpha per copy. Alpha interpolation from the current copy to the next copy along Spiral arc position is forbidden, because it darkens central portions of already-existing rails instead of only fading the newly spawned Corridor copy.
- The radial Spiral center mask remains disabled. `centerRevealAlpha` is the sole center-emergence owner.


## 7.6.6 Spiral key-carrier transports

- `v766-spiral-keypoint-transport-regression.js` checks the five continuous Spiral transport contracts plus Torn.
- Continuous must keep `N/K` fixed, preserve path presence, and retain periodic closure.
- Phase must keep `N` fixed, change `K` as the real phase step, use `delta = 2π*K/N`, and must not create branch merge/split merely from the `gcd(N,K)` change of a default full Spiral.
- Phase-circle must add continuous no-fade branch clone/merge when `N` changes.
- Constant-step/minimal-turn must clone/merge branches while its explicit step remains unchanged.
- Topology must move both carrier endpoint keys linearly in Cartesian space; the mapped profile must land on those keys, and changing the line profile must not alter the carrier motion.
- Torn must report exact-subdivision-only endpoint normalization with zero arc-equalized records.  Circular Torn follows the ordinary profile/polygon circular metric; Topology Torn follows Cartesian transport.  Matched Spiral rails keep periodic seam metadata.

## 7.6.7 Constant-step Corridor seam / stable Space pause

`v767-spiral-constant-step-corridor-regression.js` exercises the real constant-step (`minimalTurn`) Spiral carrier at several Morph values while N changes. It requires the endpoint of every retained rail in one Corridor copy to coincide with the start of the same rail in the adjacent outer copy after the live Corridor transform. The per-copy phase increment must equal the exact continuous-N carrier delta rather than a rounded/canonical N approximation.

The same test dispatches a real `Space` key event with `morphPauseOnSpace` enabled. A full Morph pause must snap `progress`, `geometryT`, `geometryBlend`, and the resolved presentation layer back to the exact source endpoint of the current phase. It must not freeze an intermediate clone/merge state. Glow routing is also required to stay on the retained Spiral rail, whose Base and Glow passes share one packed Corridor-copy transform.


## 7.6.8 Lightning/Web GPU generation recovery

`v768-lightning-device-generation-regression.js` locks the device-lifecycle invariant exposed by the NVIDIA log: a retained Arc, Web-corner pipeline, Web bind group, Lightning render bundle, or shared Morph rail from WebGPU generation G must never be encoded after `WebGPUDeviceHub` moves to G+1. The test requires generation stamps and hard gates on Shared Morph -> Arc -> Web/Lightning, plus immediate invalidation/rebuild of Arc and Web-corner resources. Cross-device `associated with [Device] ... cannot be used with [Device]` errors are also classified as resource-lifetime faults so any missed path self-recovers instead of flooding every frame.


## 7.6.9 Master exact-write broadcast + topology contract repair
- `v767-master-write-broadcast-regression.js` is now mandatory in `run-all.js` and the stability soak. It drives real sidebar UI on three intentionally different layers and requires Master to propagate exactly the paths changed on the active layer, without normalizing unrelated target state.
- Spiral closed/open no longer broad-copies `spiralOrder` while Master is active.
- Unlinking Spiral step broadcasts only `spiralStepLinked`; the target layers retain their own explicit `spiralStep` values. Linking still broadcasts the recomputed step because the source really changes it.
- Geometry-circle submodes are mirrored by the generic changed-path transaction, so toggling one mode cannot replace sibling modes on other layers.
- The old topology/monoradius regression expected the pre-7.6.6 metric label `cartesian`. Topological Spiral transport now deliberately reports `cartesian-keypoints`; the regression was updated to verify that exact contract while still requiring finite data and real merge/split branches.

## 7.7.9 FPS console / load analyzer regression
`v779-fps-load-analyzer-regression.js` verifies profiler plumbing, Lightning timing metrics and GPU error forwarding. `v779-fps-console-browser-regression.js` performs the real FPS-counter → Load tab → analysis toggle path and checks that `console.error` appears in the Errors tab.
