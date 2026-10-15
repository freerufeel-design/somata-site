## 7.8.3 — Web corner defaults and live Morph ownership

- Web defaults are now `style: web`, placement `corners`, with corner depth 60%. HTML, state defaults, layer defaults, GPU Morph bridge and dormant bundled project configs agree.
- Fixed first-frame corner Web: a newly enabled corner Web no longer starts at zero growth and wait for an accidental later repaint before becoming visible.
- Fixed Web blinking during Morph when an instantaneous smoothed angle briefly crosses the corner threshold: the last valid semantic corner template is re-projected onto the current authoritative Line carrier.
- Fixed the real ON/OFF race during Morph: effect ownership now resolves authored `state.layers` before Morph display snapshots, so Web UI state cannot be one frame (or one snapshot) behind the renderer.
- Added `v783-web-default-corners-regression.js`, `v783-static-web-render-pass-regression.js` and `v783-web-toggle-stability-regression.js`.
- Cache-busting advanced to `20261015-v78301`.

## 7.5.10 — mobile Spiral controls touch contract

- Fixed mobile Spiral topology/numeric/checkbox controls that remained below the established 44×44 touch target (38 px contour buttons and 34 px numeric fields), and extended the same contract to short coarse-touch landscape.
- Added `v75-mobile-spiral-controls-touch-regression.js`: portrait + 844×390 sizing checks plus a real touch on `Spiral closed` that must switch topology, produce a later frame and keep finite non-empty Web commands with a live scheduler.
- Spiral/Web/Morph renderer code is unchanged; this is a scoped mobile CSS correction only.
- No additional dead legacy functions were proven in this iteration.
- Cache-busting advanced to `20261014-v75010`.

## 7.5.9 — mobile audio-panel landscape parity + legacy cleanup

- Fixed Audio Reactive and Audio Routing panels on short coarse-touch landscape: both now use the same mobile contract as the header/dock, start below the 60 px top toolbar, remain inside the viewport and expose 44×44 close controls.
- Added `v75-mobile-audio-panels-spiral-regression.js`: real mobile Mic/Audio Routing clicks while Spiral + Morph + Web are live; both panels must be reachable/closable without stalling frames or invalidating Web commands.
- Removed two proven dead legacy functions: `applyMasterLayerSnapshotNow()` and `isAnyMorphLikeAnimationActive()`. Their active replacements (`mirrorMasterLayerDiff` and `getMorphActivityState`) remain covered.
- Added `v75-legacy-dead-code-regression.js` to prevent either legacy symbol from returning.
- No Spiral/Web/Lightning/GPU renderer architecture changed; the functional fix is CSS-only.
- Cache-busting advanced to `20261014-v75009`.

## 7.5.8 — mobile parameter-focus parity + Spiral live-impact regression

- Fixed mobile long-press parameter focus for morphable range rows: hidden service `.blue-morph-dual` sliders no longer make the authored range look ambiguous to the focus detector.
- Extended the parameter-focus CSS from width-only portrait to the shared short coarse-touch landscape contract used by the rest of the mobile runtime.
- Added `v75-mobile-parameter-focus-spiral-regression.js`: real landscape long-press on Radius → visible focus dock → 44×44 `+` → live Radius change → later frame → finite non-empty Spiral/Web commands → clean restore on close.
- No Spiral/Web/Lightning/GPU renderer or scheduler architecture changed; the fix is one focused JS filter plus one media-query correction.
- Cache-busting advanced to `20261014-v75008`.

## 7.5.7 — mobile header touch contract + Spiral DPR budget coverage

- Fixed the previously uncovered mobile top header: portrait and short coarse-touch landscape now use a single horizontally scrollable row instead of undersized wrapped desktop controls. Real header buttons/selects are normalized to at least 44×44 px.
- Added `v75-mobile-header-touch-regression.js`: checks portrait + landscape computed hit-target geometry, horizontal reachability and a real touch on the scrolled Corridor control through live state → next frame → finite Web commands.
- Added `v75-spiral-mobile-dpr-budget-stress.js`: six mobile viewport/DPR cases from DPR 1→5 with active Spiral + Morph + Web + Graffiti + Lamps + Sweep + Particles + Corridor. It requires finite non-empty effect plans, advancing Morph and a backing-store ratio capped at the renderer budget (≤2.05× CSS size).
- No Spiral/Web/Lightning/GPU renderer or scheduler code changed; the production fix is CSS-only.
- Cache-busting advanced to `20261014-v75007`.

## 7.5.6 — visible mobile FPS-copy confirmation + Spiral fullscreen stress

- Fixed the 844×390 coarse-touch case where tapping FPS copied errors but the confirmation toast was physically hidden by a legacy `min-width:761px` CSS rule.
- Removed that obsolete width-only toast hide rule; the existing mobile JS contract remains authoritative.
- Added `v75-mobile-landscape-toast-visibility-regression.js`, which checks computed display/opacity/viewport geometry in addition to class/text state.
- Added `v75-spiral-mobile-fullscreen-stress.js`: real fullscreen buttons + active Spiral/Morph/Web/Graffiti/Lamps/Sweep/Particles/Corridor + rotation/DPR changes + pan restore + backing-store DPR budget.
- No Spiral/Web/Lightning/GPU renderer changes were required.
- Cache-busting advanced to `20261014-v75006`.

## 7.5.5 — mobile landscape desktop-output isolation + Spiral pass-fault coverage

- Fixed a mobile-landscape classification leak where 844×390 coarse-touch devices matched desktop-only Somata output/brand UI because that subsystem used only `min-width:761px`.
- Desktop brand/output now uses the same short coarse-touch mobile contract as fullscreen, FPS diagnostics, Reset View and the mobile sidebar; the launcher/stage stay hidden and the runtime refuses desktop-output activation on phone landscape.
- Added `v75-mobile-landscape-desktop-brand-regression.js`; it is RED on 7.5.4 (visible 52×52 launcher, `desktop:true`, toggle activates) and PASS after the focused CSS/JS fix.
- Added `v75-spiral-effect-fault-recovery.js`; while Spiral + Morph + Web/Lamps/Sweep/Particles/Corridor are live, it injects one real pass fault into Web, Lamps, Sweep, Particles and Base across mobile orientation. Every fault is isolated and the next frames/Morph progress recover with zero paint errors.
- No Spiral/Web/Lightning geometry or GPU pass architecture was changed.
- Cache-busting advanced to `20261014-v75005`.

## 7.5.4 — mobile diagnostic parity + narrow dock reachability

- Fixed FPS diagnostic copying in short coarse-touch landscape: 844×390 now follows the same mobile contract as the rest of the UI and copies captured errors with `Ошибки скопированы`.
- Fixed narrow 320×568 bottom-dock overflow: mobile flex content is left-anchored before horizontal scrolling, so Reset/Mic controls no longer escape into negative X or sit under the FPS counter.
- Added `v75-mobile-landscape-fps-copy-regression.js`, `v75-mobile-narrow-hit-regression.js`, and `v75-spiral-narrow-mobile-stress.js`; all are mandatory in `run-all` and soak.
- Spiral/Web/Graffiti/Lamps/Sweep/Particles/Corridor + active Morph remains stable on 320×568 ↔ 568×320 rotation; no Spiral renderer changes were required.
- Cache-busting advanced to `20261014-v75004`.

# Somata 7.5

## Rendering order

The active per-layer effect stack is now:

**Web → Line / Glow / Base + Graffiti → Lamps → Glint / Lightning → Particles**

Web starts the resident transparent Layer Scene at phase 1. The Base/Line batch appends at phase 5 using the existing scene as its load target, avoiding the normal-path Web readback/materialization that would otherwise defeat the requested bottom-layer ordering.

## Web contour

Web preparation now consumes the retained cubic Bézier contour truth used by the exact curve path instead of the separate rounded-polyline approximation. The regression verifies curved cubic segments and adaptive preview points against the rendered rail.

## Lightning performance balance

Exact Lightning raster density is reduced from 6× to 4× per retained cubic Arc microsegment. Precharge, strike and afterglow all use the analytic GPU halo field; the old separable-blur/Graffiti-contour-glow dependency is removed from Lightning. This targets the flash-time FPS drop without changing the feature set or introducing an aggressive quality downgrade.

## Settings and Legacy cleanup

The browser audit now discovers all 129 settings checkboxes, including the five data-driven Morph-group checkboxes that do not have IDs. Every checkbox is clicked through the real DOM event path and must toggle, produce an observable intended effect, avoid uncaught errors, leave the scheduler live, and keep synchronous handler work below 100 ms. The hidden `lineSpriteEnabled` checkbox was removed because Sprite enablement is derived from line mode and the checkbox was a true no-op.

## Test policy

7.5 is test-first for the reported regressions. The new tests are `v75-effect-stack-order.js`, `v75-web-bezier-contour.js`, `v75-lightning-performance.js`, and `v75-checkbox-functional-coverage.js`. They were red on the clean 7.4.30 baseline before the fixes and are part of the mandatory gate afterward.

## 7.5.1 — Spiral Web + mobile runtime regression pass

- Web thread placement on `spiral-closed` / `spiral-open` now separates the exact smooth render carrier from the authored corner source. Static Spiral uses its topology paths; active Morph falls back to stable endpoint topology anchors only when the dense interpolated rail contains no sharp corners. All three branches (`inside`, `outsideStraight`, `outsideArc`) remain on the exact current visual contour.
- Open Spiral rails no longer lose `outsideStraight` merely because polygon concavity is undefined for an open corner source.
- `v75-web-branch-rendering.js` drives real Web checkboxes and contour buttons and requires non-empty finite thread commands for closed + both Spiral topologies, including topology changes during active Blue Morph.
- Mobile bottom-dock controls now have 44×44 touch targets and horizontal overflow instead of clipped 32×32 hit areas. The FPS counter is a reachable 52×44 mobile target.
- Installed PWA presentation now requests `fullscreen` with `standalone` fallback. If Android/WebView exposes `requestFullscreen()` but resolves without actually entering fullscreen, Somata confirms the native state on the next frame and falls back to app pseudo-fullscreen. iPhone keeps the existing pseudo-fullscreen route.
- Mobile FPS-click error copying was already present in `error-overlay.js`; `v75-mobile-runtime-regression.js` now locks the exact `Ошибки скопированы` confirmation into the gate.
- New Web/mobile regressions are included in `run-all.js` and `stability-soak.js`. Asset cache-busting was advanced to `20261014-v75001`.


## 7.5.2 — mobile landscape + Spiral/Web adversarial coverage

- Coarse-touch landscape now stays on the mobile UI even when width exceeds 760 px; CSS and mobile event handlers share the same short-landscape media query.
- Mobile launcher, sidebar close and pseudo-fullscreen exit are normalized to at least 44×44 px. Closed/sliding mobile drawers no longer intercept the bottom dock during transitions.
- `v75-mobile-landscape-regression.js` drives launcher → tool → sidebar → close, verifies portrait/landscape hit targets, pseudo-fullscreen rotation and scheduler recovery.
- `v75-spiral-web-adversarial.js` adds 288 deterministic non-degenerate Spiral/Web branch cases across N/K/order/step/rounding/profile variations; no production Spiral renderer change was required.
- `browser-harness-cleanup.js` and a bounded wait/kill path in `browser-harness.close()` prevent fresh-browser soak teardown races.
- Requested layer-order, exact Bézier Web, Lightning/flash and 129-checkbox regressions remain green. Cache-busting advanced to `20261014-v75002`.

## 7.5.3 — mobile view consistency + Spiral orientation stress

- Mobile `Reset View` now uses the same portrait/short-coarse-landscape media contract as the mobile layout. A phone rotated to 844×390 no longer jumps from the mobile 90% reset to the desktop 100% reset. Initial `state.zoom` uses the same contract.
- `v75-mobile-view-reset-regression.js` reproduces the 7.5.2 landscape failure and verifies portrait + landscape reset through the real Reset View button.
- `v75-spiral-mobile-orientation-stress.js` adds 12 portrait↔landscape cycles with Spiral + Web + Graffiti + Lamps + Sweep + Particles + Corridor + active Blue Morph, plus Spiral open/closed switching. It requires finite non-empty effect plans, advancing Morph, live frames, zero paint errors and an unstuck scheduler. No Spiral/render production change was needed.
- Layer order, exact Bézier Web, Lightning/flash, 129 checkbox coverage, prior 288-case Spiral/Web adversarial coverage and mobile fullscreen/error-copy regressions remain mandatory.
- Cache-busting advanced to `20261014-v75003`.


## 7.5.11 — mobile Project Morph panel reachability + Spiral/Morph regression

- Fixed Project Morph settings on mobile portrait and short coarse-touch landscape: the panel now uses the shared mobile viewport contract, is bounded by `100dvh`, and no longer escapes below the 844×390 viewport after rotation.
- Project Morph numeric/select controls and checkbox labels now expose at least 44 px touch height on the mobile contract.
- Added `v75-mobile-project-morph-panel-spiral-regression.js`: real header touch opens the panel, verifies viewport geometry and touch targets, focuses/edits transition time through the live UI, then requires a later frame plus finite non-empty Spiral/Web commands while Morph remains active.
- Existing layer-order, exact Bézier Web, Lightning, 129-checkbox, 288-case Spiral/Web, 184-plan Spiral torture, fullscreen/DPR/fault-recovery and render-impact suites remain green.
- No Spiral/Web/Lightning/GPU renderer changes were required; cache-busting advanced to `20261014-v75011`.

## 7.5.12
- Fixed delayed live rounding while Blue Morph is active. `paramRounding` now updates the currently rendered Morph frame immediately (full/light snapshots) and invalidates that frame geometry before the existing Morph rebase runs.
- Added `v75-rounding-immediate-morph-regression.js`: on 7.5.11 it reproduced canonical rounding 95 while the active frame remained 10; on 7.5.12 the active frame becomes 95 in the same input event, then a later paint arrives with Morph still active and `paintErrors=0`.
- No Spiral/Web geometry algorithm or Morph scheduler architecture was rewritten.


## 7.5.13 — Morph stall catch-up smoothing with rounding

- Fixed visible Blue Morph jumps after a long main-thread/render stall. The Morph timeline no longer catches up the entire missed wall-clock interval in a single frame; an attributable long gap is converted into timeline compensation while normal frame cadence remains time-based.
- Added `v75-rounding-morph-stall-jump-regression.js`: with active Spiral + spline profile + rounding + Web, a deliberate ~240 ms main-thread block was RED on 7.5.12 (`progress delta ≈ 0.183`) and PASS after the fix (`delta < 0.08`) while scheduler recovery, finite geometry and later paints remain live.
- Morph freeze diagnostics now include cumulative stall compensation/count and the last raw stall advance, making future physical-device logs distinguish a render stall from a visual timeline catch-up.
- Existing immediate-rounding, 288-case Spiral/Web, 184-plan Spiral torture, runtime UI, effect stability and render-impact regressions remain green.
- No Spiral/Web geometry algorithm or GPU pass order was changed; cache-busting advanced to `20261014-v75013`.



## 7.5.14
- Restored Topology/Calm Morph timeline semantics by limiting the 7.5.13 stall compensation to modes it was designed for; topology/calm no longer have their cycle origin rewritten by the generic stall clamp.
- Restored Mono Radius atomicity during live rounding edits: direct active-frame rounding preview is skipped when Mono Radius is active, so rounding and compensation geometry are rebased together.
- The same guard prevents hard-snapping a Topology/Calm frame to the authored rounding value before topology geometry is rebased.
- Ordinary circleSlide + Standard rounding keeps the immediate live preview introduced in 7.5.12.
- Added `v75-topology-monoradius-regression.js` and made it mandatory in the gate/soak.

## 7.5.15 — Morph GPU prewarm deadlock recovery

- Fixed a Blue Morph startup deadlock in Topology/Calm/Fade/Light: a failed general GPU Morph prewarm no longer leaves `gpuPhasePreparing=true` forever.
- On general Morph GPU prewarm failure, retained Spiral layers that skipped CPU endpoint geometry are materialized into finite CPU morph geometry, interpolation plans are rebuilt, the scheduler ownership is restored, and the Morph timeline restarts at progress 0 while the GPU error remains diagnosed.
- Added `v75-morph-mode-gpu-prewarm-recovery.js`: real top-selector UI start matrix for Topology, Calm, Circle, Fade and Light plus a source contract forbidding the historical fail-closed latch in the general Morph path.
- No change to Circle specialized prewarm path in this iteration.

## 7.6.0 — shared Profile Morph / carrier architecture

- Blue Morph semantics are separated from carrier transport. `Topology`, `Calm`, `Circle`, `Fade`, and `Light/Slideshow` remain the selected profile Morph modes; Spiral `phaseCircle` / `minimalTurn` / continuous transport no longer rewrites the global mode.
- Polygon and Spiral now share one Profile Morph clock/contract. Polygon consumes the shared GPU path; Spiral keeps its specialized retained-Bézier GPU carrier as a carrier executor, not as a second Morph controller.
- The Spiral retained renderer explicitly carries both `profileMorphMode` and `spiralTransport`. Topology uses Cartesian profile interpolation, Calm uses bounded angular profile interpolation, while Spiral transport remains responsible for branch pairing, seam/winding/order/step continuity.
- GPU Morph resource warmup is non-blocking. `gpuPhaseWarming` is preparation/diagnostic state and cannot stop the Morph clock or reset `cycleStart` when warmup completes. CPU geometry remains a compatibility/recovery path when the retained GPU carrier is unavailable.
- Mobile Spiral orientation/narrow stress tests now start Blue Morph through the real UI/scheduler instead of fabricating `runtimeState.morph` progress.
- Added `v76-profile-carrier-architecture.js` and `v76-gpu-warmup-nonblocking.js`; both are mandatory in `run-all.js` and the fresh-browser soak.
- Existing Spiral/Web 288-case adversarial coverage, 184-plan torture, topology/Mono Radius, rounding, fault-recovery, mobile, effects, checkbox and render-impact regressions remain mandatory.
- Local no-GPU/headless startup benchmarks still exercise the compatibility CPU path and can be slower than 7.5.15. Physical GPU startup cost remains a release grey zone and is not claimed as improved by 7.6.0.
- Cache revision advanced to `20261014-v76000`.


### 7.7.9 diagnostic hotfix — FPS load analyzer
- FPS counter console now has separate **Ошибки** and **Нагрузка** tabs.
- Live analyzer ranks CPU/render passes, estimates unprofiled driver/present cost, shows GPU timing when available, and exposes Lightning encode/raster counters.
- `console.error`, `window.error`, `unhandledrejection`, WebGPU uncaptured errors and device-loss errors are visible in the FPS console.
- Exact Lightning failures preserve the renderer's real `rendererReason` instead of replacing it with a generic encode error.
