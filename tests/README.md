# Somata 7.4.29 — development preflight

`tests/` is development-only and must never be loaded by `index.html`.

## Mandatory order

Run only:

```bash
node tests/run-all.js
```

`run-all.js` executes in this order:

1. `static-modules.js` — syntax, assets, module registration, no removed Legacy/CPU paths.
2. `contracts.js` — architecture invariants.
3. `browser-preflight.js` — production scripts load in real `index.html` order and critical bindings execute.
4. `desktop-logo.js` — desktop logo is visible/non-overlapping above 760 px and completely hidden on mobile.
5. `runtime-user-actions.js` — real UI events and field regressions.
6. `gpu-effect-scene-routing.js` — Web/Sweep GPU Layer Scene routing and initialization wait.
7. `effects-stability.js` — Line, Graffiti, Spiral, Lamps, Web, Sweep, Lightning, Corridor, 3 Morphs, Particles, Audio, combined fault containment.
8. `main-control-coverage.js` — every main UI control must have render-impact coverage.
9. `effect-render-impact.js` — controls must change renderer-driving data and the next frame must arrive.
10. `stability-soak.js` — fresh-browser repetitions of the desktop-output/user-action/routing/stability/impact suites.

Do not package on any fail or timeout.

## Field regressions that must stay covered

- RMB Geometry hides all authored lines immediately; second RMB restores the remembered set.
- RMB Web and RMB Sweep become live immediately in a static scene.
- LMB on a collapsed left rail expands it and opens the exact clicked section.
- Geometry circles (`circumscribed / inscribed / median / key-points`) produce non-degenerate full-circle GPU commands.
- Enabling Master preserves every layer as-is. A later edit broadcasts only the changed property/path to all layers; unrelated settings on each layer remain different.
- Web `initializing=true` means wait + repaint, not encode error.
- Web/Sweep can open a transparent GPU Layer Scene when Base did not create one.
- Per-layer effect stack is fixed: Base/Graffiti → Web → Lamps → Sweep/Glint/Lightning → Particles. GPU phase order must not change when Morph or Corridor changes the scene route.
- Lamps are interleaved into the resident Layer Scene between Web and Sweep using premultiplied/source-over semantics; particles remain the top resident phase so detachable Output capture sees the complete stack.
- Rejected final GPU composite must present the current GPU scene or disable the stale final surface.
- A transient missing Base stroke batch gets two repaint attempts before escalating to `console.error`; a persistent miss still reports diagnostics.
- Blue Morph survives `open → spiral-closed → spiral-open → closed`, recovers from an rAF gap, and completes at least 3 cycles without starving `afterNextPaint` boundary commits.
- Lightning owns an independent `Current profile / Line` selector. `Exact` uses the rounded/spline/Bézier carrier; `Simple` uses the raw unsmoothed polyline.
- Corridor center hiding is count-based. `centerHiddenCopies=N` means N deepest copies are fully invisible at the phase boundary, but the next moving copy is already generated inside the center and fades in over exactly one corridor-copy spacing.
- Corridor center reveal is applied to per-copy renderer alpha before line/glow/lamp/Web/Sweep/particle rendering. There must be no final-compositor center mask covering already-rendered glow.
- The reveal spacing must change when Corridor spacing changes.
- Adaptive brightness must use the persistent live lamp config during Morph; no per-frame config clone may reset exposure smoothing.
- With exposure time > 0, adaptive factors must evolve continuously during Morph and converge toward the moving target instead of restarting the tween each frame. `0` means immediate response.
- `Адаптировать яркость` ON keeps radius at 1 and changes brightness; OFF keeps brightness at 1 and changes radius.

## Control coverage

Required main controls:

- Line/Geometry: 12.
- Graffiti: 7.
- Spiral: 5.
- Lamps: 19.
- Web: 7.
- Glint: 11.
- Lightning: 11.
- Corridor: 4 (speed, spacing, hidden-center count, color shift).
- Morph: Blue fade + Green center/sector softness; Orange is functional-path tested.
- Particles: 9.
- Audio: master amplitude + live route-strength controls.

A new main control must first get a render-impact assertion; `main-control-coverage.js` must fail until it does.

## What “renders” means locally

Local Chromium does not provide reliable hardware WebGPU. The gate therefore proves: real UI event → live state → non-empty finite geometry/effect plan → GPU-bound commands/queue input → next frame arrives → scheduler leaves `inFrame`; uncaught exceptions and paint errors stay zero. Real hardware logs override headless assumptions.

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

- Graffiti and the ordinary Base line share the same stack contract: the contour is below Web (`profile phase 20`, `Web phase 40`), then Lamps are interleaved, then Sweep and Particles.
- Lamps remain above Graffiti/Web as well: Lamp HDR is blend-aware composited into the resident Layer Scene between the low effect phases and Sweep/Particles; the final-lamp path carries the same selected blend mode when interleaving is not needed.
- The historical Web-under-Base materialization path is disabled; Web ordering is now phase-stable for both ordinary and Graffiti contours.
- Corridor Web parity clipping is now reset per corridor copy, so nested masks no longer XOR neighboring copies into an every-second-ring pattern.
- Sweep/Glint/Lightning uses phase 60/61 and Particles phase 70. Lamp HDR is composited into the resident Layer Scene at the phase-50 boundary, so detachable Output sees the same Base/Graffiti → Web → Lamps → Sweep → Particles stack.
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
