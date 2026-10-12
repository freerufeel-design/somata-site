# Somata 7.3.20 — Test Report

## Release status

**PASS on the available CPU/reference environment.** All recorded final browser gates are green and no runtime/unhandled errors were observed. Hardware WebGPU is unavailable in this container, so hardware GPU execution is **not** claimed as certified; GPU-priority tests certify the safe CPU fallback path.

## Production fixes in 7.3.20

- **Spiral / Circle Slide Morph phase hand-off:** Spiral properties are read from the resolved Morph frame, polygon `N` is interpolated continuously instead of snapping at a rounded boundary, and stale `frameLayers` are cleared atomically when Blue Morph commits a phase endpoint.
- **Morph GPU preparation recovery:** optional Web/Lamps/Exact-Arc preparation no longer holds the visible Morph clock indefinitely; failed GPU preparation is quarantined and can degrade to the CPU reference path instead of leaving Morph stuck in `active + gpuPreparing`.
- **Exact Lightning carrier:** exact Lightning now subdivides/evaluates the retained cubic Bézier carrier instead of reducing curves to endpoint chords.
- **Web + topology Morph regression:** fixed a real `ReferenceError: resolved is not defined` in `buildCurrentCircleMorphPaths()`. It caused `Fucking freak 3` Web to execute nominally but contribute **0 px** in the topology-Morph composition. After the scope fix, variant Web and the full composition matrix are green again.
- **Shared geometry cache leak:** short-lived resolved Morph/frame clones were entering the cross-project static LRU. Resource soak exposed `sharedGeometry.size` growth **25 → 31 → 37**. Transient frame layers are now WeakMap-only; only canonical `state.layers` enter the shared LRU. Final series is **19 → 19 → 19** on both CPU and GPU-priority fallback.

## Source / invariant suite

- **42/42 PASS**
- Build/cache identity: **7.3.20 / `20261012-v7320`**

## CPU browser certification

| Gate | Result |
|---|---:|
| Playlist runtime | **21/21 PASS** |
| Dormant/synthetic effects | **10/10 PASS** |
| Primary final-pixel visual | **10/10 PASS** |
| Playlist variant visual | **13/13 PASS** |
| Temporal soak | **6/6 PASS** |
| Authored branch coverage | **13/13 PASS** |
| Project × effect residency | **190/190 PASS** |
| Cross-effect composition | **39/39 PASS** |
| Session recovery / backend hand-off | **7/7 PASS** |
| Playlist marathon | **42/42 PASS** |
| **Resource stability soak** | **21/21 PASS** |
| Project save→JSON→load persistence | **21/21 PASS** |
| Final CSS compositor / Scene Blend | **21/21 PASS** |
| UI invalidation | **3/3 PASS** |
| User controls | **3/3 PASS** |
| Repeated toggles | **5/5 PASS** |
| Ownership transitions | **18/18 PASS** |
| Reported Spiral / Мозголом / Искры / Exact Lightning | **3/3 PASS** |

The resource gate traverses seven heavy fixtures for three complete cycles and checks scheduler errors, GPU diagnostics, published cache limits, and monotonic retained-resource growth. The shared geometry cache is stable at **19 / 19 / 19** after the fix.

The targeted regression gate additionally verifies the user-reported failures directly: `Мозголом` and `Искры` must actually start and advance, Spiral phase hand-off must have zero source-grid jump across repeated boundaries, and `exact` Lightning must make a visible contribution while using the retained cubic Bézier rail.

## GPU-priority fallback on this host

WebGPU/WebGL2 are unavailable here, so a GPU request resolves to the CPU reference backend. On the final code this mode passed:

- Playlist **21/21**
- Primary visual **10/10**
- Project × effect residency **190/190**
- Cross-effect composition **39/39**
- Recovery **7/7**
- Marathon **42/42**
- Resource stability **21/21**, shared geometry **19 / 19 / 19**

This confirms backend-selection/fallback correctness but **does not certify hardware WebGPU execution**. On a WebGPU machine, run **Файл → Настройки → Самопроверка эффектов → Тест GPU** and require `effectiveBackend='gpu'` plus `hardwareGpuExercised=true`.

## Hotfix 11 — iPhone fullscreen
- Invariant suite: **51/51 PASS**.
- Application JavaScript syntax: **59/59 PASS**.
- `manifest.webmanifest`: valid JSON.
- iPhone regression verifies Apple standalone metadata, iPhone capability detection, VisualViewport-sized presentation fallback, explicit exit control, native/pseudo centering parity, and prefixed WebKit sizing.
- `default.plist` unchanged: `69ca8e228e099320acc198a6eec7a7dc326fd6cade8aa29ff5a30f156c005a6a`.
- Native iPhone element fullscreen cannot be exercised because iPhone WebKit does not expose arbitrary HTML Fullscreen API; the application fallback is what is tested here.
