# Somata 7.4.9 — development preflight

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
4. `runtime-user-actions.js` — real UI events and field regressions.
5. `gpu-effect-scene-routing.js` — Web/Sweep GPU Layer Scene routing and initialization wait.
6. `effects-stability.js` — Line, Graffiti, Spiral, Lamps, Web, Sweep, Lightning, Corridor, 3 Morphs, Particles, Audio, combined fault containment.
7. `main-control-coverage.js` — every main UI control must have render-impact coverage.
8. `effect-render-impact.js` — controls must change renderer-driving data and the next frame must arrive.
9. `stability-soak.js` — fresh-browser repetitions of the user-action/routing/stability/impact suites.

Do not package on any fail or timeout.

## Field regressions that must stay covered

- RMB Geometry hides all authored lines immediately; second RMB restores the remembered set.
- RMB Web and RMB Sweep become live immediately in a static scene.
- LMB on a collapsed left rail expands it and opens the exact clicked section.
- Geometry circles (`circumscribed / inscribed / median / key-points`) produce non-degenerate full-circle GPU commands.
- Enabling Master immediately copies authored parameters from the active layer to all physical layers while preserving `id/name/visible`; later edits keep mirroring.
- Web `initializing=true` means wait + repaint, not encode error.
- Web/Sweep can open a transparent GPU Layer Scene when Base did not create one.
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
- Runtime user actions include Corridor pre-glow emergence plus adaptive-brightness Morph/exposure/channel behavior: `11/11` expected.
- `GPU-5DC05452 / geometry/base / WebGPU stroke batch was not created` is treated as transient for two consecutive frames with repaint/warmup; only a persistent miss escalates as an error.

Rule: **field regression → reproducing test → runtime fix → full gate → package**.

## 7.4.9 verification

Adaptive-brightness regression added after field failure: Morph + non-zero exposure + brightness/radius channel switching. The render pass must preserve persistent lamp-config identity. Two independent fresh-browser soak cycles passed after the fix.
