## 7.3.20 certification

- Resolved Morph/frame layers are transient and are excluded from the cross-project shared geometry LRU; canonical `state.layers` remain eligible for structural reuse.
- Resource Stability is a mandatory release gate and rejects scheduler/GPU error growth, published cache-limit violations, and monotonic retained-resource growth.
- Hardware GPU certification requires a real WebGPU adapter and `hardwareGpuExercised=true`; this container only certifies CPU and GPU-priority fallback behavior.

# Somata 7.3.20 deployment

Before deployment run **File → Settings → Self-test effects → Test CPU** and, on a WebGPU-capable machine, **Test GPU**. Release certification includes project persistence and final CSS-compositor checks in addition to playlist, visual, residency, composition, recovery and marathon gates. A hardware GPU release is accepted only when the GPU result reports `effectiveBackend: 'gpu'` and `hardwareGpuExercised: true`; CPU fallback remains functional coverage, not hardware-WebGPU certification.

The build/cache epoch is `20261012-v7320`. Serve through a normal HTTP/HTTPS origin for Storage/WebGPU validation. `__somataProjectPersistenceSmokeTest()` must report **21/21 PASS** and `__somataFinalCompositorSmokeTest()` must report **21/21 PASS**. In the shipped playlist, `Святая Спираль` is the active Scene Blend fixture and must own `mix-blend-mode: lighten`; a following normal project must reset the final compositor to `normal`.


# Somata 7.3.17 — deployment checks

## Canonical host

Use `https://somata.su/` as the canonical address. `www.somata.su` must be configured at DNS/reverse-proxy/web-server level to redirect to `https://somata.su/`. A client-side redirect is included as a secondary safeguard, but it cannot repair a server-side 502 before `index.html` is delivered.

## Static resources

Do not rewrite missing `/js/*` or `/styles/*` files to `index.html`. Return a real 404 instead. The browser must receive JavaScript and CSS with their proper content types. Recommended values:

- `.js`: `text/javascript` or `application/javascript`
- `.css`: `text/css`
- `.html`: `text/html; charset=utf-8`
- `.plist` used by Somata: JSON data; `application/json` is preferred, `text/plain` is acceptable to the app

## Caching

`index.html` should be revalidated or served with `Cache-Control: no-cache`. All Somata 7.3.17 JS/CSS URLs contain `?v=20261012-v7317`, so those versioned resources may be cached aggressively. Do not cache error/404 HTML under JavaScript URLs.

## 7.3.9 Web / spline-Morph regression checks

In `Мозголом`, verify `Паутина в углах` with large depth/multiplier: anchors must correspond to authored profile corners (or the angular fallback on paths that have none), never to technical De Casteljau cuts; threads must walk toward neighbouring detected corners over the complete retained contour. Then select `Паутина на самопересечении`: an ordinary closed contour keeps the 6.7 quarter-perimeter rule, while periodic Spiral uses neighbouring-corner span and exact retained-cubic sampling. With Corridor enabled, no WebGPU attachment-state error or invalid `SpiroStar GPU Morph Web` command buffer is allowed.

For Spline profile Morph, inspect intermediate frames at high zoom. Technical De Casteljau equalisation boundaries must remain tangent-continuous, but authored Segment corners must remain sharp. Square/discrete joins are only valid for Segment profile geometry.

Project-local `Морфить по умолчанию`, Orange default, and `Коридорить по умолчанию` must be reapplied after direct project load, manual playlist project selection, and the first project activated when a playlist opens. For `Святой`, Corridor must become active before Blue Morph begins strict-Spiral phase preparation; the Spiral Base must remain visible from the first animated frame. For `Мозголом`, both Blue Morph and Corridor must start automatically. `state.tunnel.active` may become true only as runtime state; a legacy saved `settings.tunnel.active` value must not suppress registration of the `tunnel` scheduler task.

## 7.3.9 GPU-path checks

For Spiral + Morph + Corridor + Web validation, the expected path is entirely WebGPU-resident: canonical retained cubics → periodic closure → Fast Visual Rail for Base/Glow, while Web exact Arc is sampled in master-thread compute and reused by raster/Corridor copies. A strict Spiral frame should not create a Canvas Web geometry or dynamic Fill mask fallback. In diagnostics, `__spiroGpuMorphWebStatus()` should describe resident master geometry and `__spiroSpiralBezierMorphRenderStatus()` should describe the canonical Fast Visual Rail.


## 7.3.9 strict-Spiral regression checks

Validate a static Spiral and an active Spiral Morph with Corridor enabled. Base must remain visible when Morph stops/rebases; diagnostics must not emit `CORRIDOR_BASE_GPU_ENCODE_FAILED`, `SPIRAL_BASE_GPU_UNAVAILABLE`, or `SPIRAL_BASE_MISSING_AT_FRAME_END`. With Web enabled, Web must remain below Base in the same resident Layer Scene. With Lightning enabled on a curved Spiral, Glow must be a smooth GPU blur of the exact strike rather than radial microsegment wedges; Inside/Outside clipping must remain intact.

## 7.3.9 lamp / layering / Morph checks

For Spiral Lamps, **Key** must show only authored key positions (path endpoints plus authored profile keys); **Corners** must show only actual retained-knot bends and may legitimately be empty on a smooth rail. During a live Spiral phase swap, diagnostics must not repeat `SPIRAL_LAMP_ARC_RESOURCE_UNAVAILABLE` while the current Arc authority reports ready.

In Style & Glow, **Тип наслоения → Равномерный / Сегментный** is available for all line geometry. Uniform should avoid brightness accumulation at adjacent segment joins; Segmented should permit source-over accumulation for both Base and Glow. Old projects that only contain `spiralLineType` must load into the corresponding `lineLayerMode`.

For polygon↔Spiral `phase`, `phaseCircle`, and `minimalTurn`, inspect the intermediate rail for saw/tooth discontinuities. Endpoint shapes must remain exact, the open Spiral seam must not cyclically jump, and the whole retained path must use one cross-family Cartesian transport decision.

## Quick browser check

In DevTools > Network, reload with cache disabled. Every `/js/...?...v7317` and `/styles/app.css?...v7317` request should return HTTP 200 and the expected JavaScript/CSS MIME type. Somata 7.3.17 also contains an inline boot guard which reports failed asset URL, HTTP status and `Content-Type` even when the normal in-app console cannot start.


## FPS cap check

Open File → Settings. `FPS limit` must default to **60** on a clean profile. On a 120/144 Hz display, `window.__somataSchedulerDiag().scheduler.fpsLimit` must report `60`, while the scene scheduler should not execute heavy animation/paint work above the selected cap.

## Renderer / playlist smoke check

Open **File → Settings → Приоритет рендера**. `Авто` uses an accelerated backend when available, `GPU` prefers acceleration but safely falls back to CPU if the browser exposes no usable GPU API, and `CPU` forces the reference Canvas path.

For routine release validation use the built-in controls:

**File → Settings → Self-test effects → Test CPU / Test GPU**

Each button runs the complete release certification rather than a single-frame smoke. The result must be **PASS**. `Test GPU` is considered a real hardware-GPU certification only when the result reports `requestedBackend: 'gpu'`, `effectiveBackend: 'gpu'` and `hardwareGpuExercised: true`. When WebGPU is unavailable, Somata intentionally falls back to the CPU reference renderer and the UI explicitly labels the result as CPU fallback; that validates fallback behavior but does not certify hardware WebGPU.

The equivalent DevTools commands are:

```js
await __somataReleaseCertification({ backend: 'cpu' })
await __somataReleaseCertification({ backend: 'gpu' })
```

The certification contains the full release gate set: static playlist validation; all 21 runtime projects; 10 dormant/synthetic effect fixtures; 10 primary final-pixel visual checks; 13 playlist-variant visual checks; 6 temporal-soak fixtures; 13 authored branch checks; the full project/effect residency matrix (95 visible project×effect pairs, loaded forward and reverse = 190 checks); 39 cross-effect final-pixel composition checks; 7 session-recovery/backend-handoff checks with real workspace reflow; 3 real UI/Morph invalidation checks; 3 user-control contracts; 5 repeated-toggle contracts; and 18 cross-project ownership transitions. A release candidate must pass every gate with zero runtime/unhandled errors, zero missing effect-pass/coverage issues and zero new GPU diagnostics. It must preserve each project's Blue Morph, Orange Morph and Corridor ownership semantics across repeated project changes.


## 7.3.17 additional release gates

Before deployment, require `__somataCompositionInterferenceSmokeTest({backend:'cpu'})` = 39/39, `__somataPlaylistVariantVisualSmokeTest({backend:'cpu'})` = 13/13, `__somataTemporalSoakSmokeTest({backend:'cpu'})` = 6/6, `__somataPlaylistBranchCoverageSmokeTest({backend:'cpu'})` = 13/13, and `__somataRepeatToggleSmokeTest()` = 5/5 PASS in addition to playlist/synthetic/primary-visual/UI/control/transition gates. On a WebGPU host repeat renderer-dependent gates with GPU priority and require `effectiveBackend='gpu'` / `hardwareGpuExercised=true` from the unified certification.

## 7.3.17 recovery gate

Before deployment, require `await __somataRecoverySoakSmokeTest({backend:'cpu'})` = **7/7 PASS**. On a WebGPU host repeat it with `{backend:'gpu'}` and require the returned backend to recover to `effectiveBackend:'gpu'` after the temporary CPU hand-off. The test must complete with zero new GPU diagnostics, no scheduler paint-error increase, no scheduler ownership growth, a non-blank Canvas after the real workspace resize/reflow, and restored Blue/Orange/Corridor ownership.

