## 8.9.0 — ordinary Corridor / Glow-Base Canvas vector replay

- `node tests/v890-vector-replay-pixel-performance-regression.js` — five full Canvas pixel comparisons against the legacy replay, including rotated copies, override styles, fill suppression and local non-identity transforms. Timings are supplemental and do not certify hardware FPS.
- Confirm regular regression suite for shared FrameContour, Fill+Web, Blue/Orange, Lightning and strict Spiral.
- Hardware NVIDIA GPU profiling of stages 30/40 remains unverified; do not disable the freeze watchdog.

## 8.7.0 — Retained Bézier seam packing, без изменения картинки

- `v870-retained-bezier-seam-reuse-regression.js`: сравнение `Float32Array` побайтово с 8.6.0, включая discontinuities, degenerate width span, NaN/Infinity и несколько цветов; CPU benchmark отдельно от FPS.
- Не менять FrameContour, GPU shaders, порядок эффекта или качество Glow для локального CPU выигрыша; `ARCHITECTURE_8.7.0.png` и `PERFORMANCE_8.7.0_REPORT.md` показывают пределы измерений.
- В software Chromium общий FPS **не улучшился устойчиво**; аппаратный NVIDIA профиль `stage:30/40` по-прежнему требуется.

## 8.5.0 — Strict Spiral Bézier packing (performance-only)

- `v850-exact-bezier-pack-regression.js`: byte-for-byte float output against the original v8.4 function (or embedded v8.4 reference), invalid segments, mixed color and variable-width paths. Also benchmarks the packing hot path without claiming an end-to-end GPU FPS improvement.
- `PERFORMANCE_8.5.0_REPORT.md` and `ARCHITECTURE_8.5.0.png` document measurements, remaining GPU limitations and unchanged consumer contracts.

## 8.4.0 — Spiral/Corridor Interwinding Fill hot-path

- `v840-interwinding-fill-transform-regression.js` checks byte-identical Float32 geometry across the 8.3.0 baseline and 8.4.0, the number of phase calculations, and a populated GPU-ready Fill mesh. On 8.3.0 run with `SOMATA_BASELINE=1`; compare checksums.
- Changes are confined to `js/render/fill-plan.js`: calculate angle/scale/sine/cosine **once per Corridor copy per frame**, not per spiral point. Leave the exact strict Spiral carrier, stencil mesh, Fill/Line/Glow/Web/Graffiti/Lamps/Sweep/Lightning/Particles and composition order unchanged.
- FPS benchmarks must distinguish this Fill-intensive scenario from generic scenes; GPU timestamps / NVIDIA visual validation remain unverified.

## 8.3.0 — Corridor frame-derived appearance cache

- `v830-corridor-copy-attributes-regression.js`: проверка строгого совпадения цветов/углов с прежним API, общих данных Glow/Base/Fill и GPU callbacks, а также изоляции кадров и слоёв.
- `v830-corridor-attributes-benchmark.js`: одинаковый micro-benchmark для исходной 8.2.0 и 8.3.0 (не является FPS).
- `v830-corridor-fps-benchmark.js`: программный браузерный FPS sanity-сценарий с Corridor/Blue, результат сильно зависит от прогрева; нельзя сравнивать холодные кадры с прогретыми.
- Перед релизом: `node tests/static-modules.js`, v830/v820/v810, v8 coverage, FrameContour, все слои эффектов, GPU lifecycle, console error tests.

## 8.2.0 — Scoped Corridor CPU/GPU frame cache

- `v820-corridor-shared-frame-regression.js`: FeatureHost Glow/Base views reuse exactly one dynamic Corridor master per frame, one color cache and an identical original frame/copy cache key; the authored owner is stable across frame snapshots; changing frame ID rebuilds geometry; layers remain isolated.
- The optimized path is the CPU-side master/copy preparation for Corridor. No Geometry/Profile/Spiral shader, visual parameter, effect order or numeric geometry was changed.
- Run `node tests/static-modules.js`, new v820 test, v810 test, v782/v780 FrameContour, v8 coverage, plus effects tests before publishing. Hardware WebGPU graphics and long-duration NVIDIA soak remain separate release gates.

## 8.0.0 — производительность, Corridor, охват слоёв

- `v8-coverage-corridor-regression.js`: все Blue/Orange строки имеют `Слои %`, запись 0 и 40, 0–100% и плавные значения Corridor между цветами палитры.
- `v8-blue-runtime-coverage-regression.js`: 0%/50%/100% меняют 0/2/4 слоя, authored state неизменен.
- `v8-actual-coverage-regression.js`: реальное UI-действие Orange генерирует N для 0/2/4 слоёв при 0%/50%/100%.
- `v7122-special-values-audio-nested-regression.js`: тест двух исходных полей «Орбиты» теперь исключает независимое третье поле охвата.
- FPS: `BENCH_RUNS=3 BENCH_SCENARIO=0 node tests/v75-fps-benchmark.js`; это программный браузер, не сертификация аппаратного WebGPU.

## 7.11.13 — Orange popup/row parity, TAP/BPM wheel

`v7123-orange-row-popup-lifecycle-regression.js` verifies that adding/removing several parameters keeps exactly one open Orange catalog menu, does not hide the panel, and that Blue and Orange render the Orbit setting through the same row structure and canonical 0..19 range.

`v7123-tap-wheel-bpm-regression.js` verifies the physical mouse wheel over TAP, exact ±1 BPM, boundaries, automatic-to-manual handoff and normal wheel behaviour elsewhere.

## 7.11.13 — TAP/BPM mouse wheel

`v7123-tap-wheel-bpm-regression.js` verifies +1/−1 BPM wheel increments and clamps, one event independent of pixel delta, auto-to-manual handoff, live sync and exclusion of non-TAP controls.

# Somata 7.11.7 — regression tests

7.11.7 memory retention: `v7117-memory-retention-regression.js` simulates 450 distinct Orange/Morph topology owners and 100 per-layer accumulation Fill histories at desktop resolution. It verifies bounded topology GPU records (<=32), GPU history textures (<=8), layer-scene uniforms (<=32), GPU buffer/texture destruction, and a surviving current topology. Regression covers retention contracts in a mocked GPU, not real-driver memory use.

7.11.2 mobile single-mode UI: `v7112-mobile-single-mode-regression.js` verifies Easy/Pro disappears on 390px and 360px phones, as well as coarse-pointer landscape 844×390, while all Pro controls remain available. It also checks desktop Easy/Pro switching and saved preference restoration after responsive transitions, including a programmatic attempt to enter Easy on mobile.

7.11.1 mobile touch hotfix: `v7111-mobile-dock-real-touch-regression.js` sends actual Chromium DevTools touch events (not just scripted `.click()`) to the bottom dock buttons and native labels. It locks the touch-to-click chain through the real DOM, verifies the Mic/Audio Routing/Reset View actions and label toggle, and confirms canvas gestures still cancel native page scroll. Also run `v75-mobile-audio-panels-spiral-regression.js` to catch overlap of mobile audio panels with the two-row mobile header. Browser headless checks do not certify physical WebGPU driver behaviour.


7.11.0 adds two primary regression gates:
- `v7110-orange-shared-routing-lifecycle-regression.js` — Orange/Blue/Audio group parity, Orange adaptive lamp brightness, RMB routing, manual override persistence, and non-stopping Orange lifecycle.
- `v7110-easy-pro-ui-regression.js` — Easy/Pro presentation switching over one shared project state, Easy navigation labels, progressive disclosure, and routing discoverability.


For 7.10.9, `v7109-blue-timing-shape-row-regression.js` restores the stable Blue timing visibility and compact Shape row contract: `Тип скорости` and the full `Период цикла` controls live in the top Blue block; active full TAP sync shows the `AUTO` badge; Shape/Orbits use the same row styling as normal Geometry bindings; Shape no longer exposes spline-point count in the routed row; and the five profile sets live inside one `Наборы профилей` dropdown.

For 7.10.8, `v7108-audio-blue-multitarget-regression.js` locks the Audio/Blue composition and the RMB routing UX: canonical Audio `Размер` must visibly scale the already-resolved Blue carrier instead of mutating an ineffective snapshot radius; the unified parameter popup exposes at most layer bubbles `1..5` plus `М` for Master; bubbles are independent multi-select controls that keep the popup open; and the left parameter shows matching burgundy target badges along its lower-left edge.
This directory contains the active regression suite. Historical development notes and iteration logs are intentionally not shipped with the 7.11 package.

Core validation order:

1. production JavaScript syntax / boot integrity;
2. browser boot and uncaught-error check;
3. real UI actions and state propagation;
4. individual effect render preparation;
5. Static and Morph parity;
6. Spiral / topology continuity;
7. multilayer / Master behaviour;
8. combined effect stress;
9. GPU lifecycle and fault isolation;
10. scheduler continuity / soak.

For the 7.10.5 Morph UI, `v710-compound-morph-ui-regression.js` verifies the compact multiplier contract: routed rows do not invent extra Morph multipliers; real source-side multipliers stay in their parent row, are always-on and labelled `X`; every visible `X` is docked immediately before the row close button; the Size row contains only its range plus proportional-size preservation (no extra radius/size-variation multipliers). `v7916-compound-morph-row-regression.js` additionally verifies that pure boolean on/off parameters are not available to Blue Morph, do not survive as active bindings, and do not appear in the Morph picker.

A PASS means the real UI action reaches live state, produces finite frame/render data, does not leave an uncaught exception, and the scheduler remains able to produce the next frame. Physical GPU pixels remain the final visual authority when hardware-specific behaviour differs from headless validation.

For 7.10.5, `v7105-standard-79-default-parity-regression.js` locks the system Standard profile to the stable 7.9 default set: Shape, N, K, Size, Orbits, Rotation, Line Width, Line Color, Fill Color and Fill Opacity are present; Layer Opacity, Rounding, Spiral Layers and Chaos remain absent until explicitly added. The same contract is required after the factory reset. The intentional 7.10 rotation multiplier neutral value remains `1×`.

For 7.10.5, the Blue Morph catalog is consolidated to remove legacy duplicate controls: the old lamp-relative Morph block is retired, Fill Morph parameters are filed under `Линия`, while `Орбиты`, `Морфинг хаоса`, and `Скругление` live under `Геометрия`. `v792-morph-audio-ui-parity-regression.js` verifies that the retired left-sidebar sections are absent, routed/special rows have no duplicate IDs, and stale legacy lamp-Morph state cannot remain active.

For 7.10.6, `v7106-blue-speed-builtins-regression.js` locks the restored dedicated top `Тип скорости` selector to the exact stable-7.9 easing menu and verifies that it is not duplicated in the compact header. It also verifies the five built-in Standard-engine presets (`Дыхание`, `Кристалл`, `Орбитальный`, `Жидкий неон`, `Сингулярность`), unique IDs/bindings, profile switching, special Shape/Orbit/Chaos flags, and that the `Основной` Standard binding set remains unchanged.

For 7.10.7, `v7107-orange-static-generation-presets-regression.js` verifies the five built-in Orange static-generation recipes (`Солнечная розетка`, `Витраж`, `Кружево`, `Кристаллический собор`, `Спиральный гербарий`). Each recipe must generate a complete authored composition, remain static between Orange switches, reject inherited animated effects, preserve its own static Web/Lamps where applicable, keep unique system profile IDs, and leave `Standard Orange` as the default compatibility profile.

## 7.11.12: Shared Parameter Matrix

- `v7122-shared-parameter-matrix-parity-regression.js`: Chromium asserts the same 85 ordered parent parameter IDs in Blue, Orange and Audio Routing, canonical Orbit range `0..19`, and unified Fill subcontrol metadata/range `0..1`.
- `v7122-special-values-audio-nested-regression.js`: independent Blue/Orange profile values, actual Orange Chaos generation and disabling, working Audio nested multipliers, and safe live-frame Audio Orbit effects.
- The source of truth is `js/core/parameter-matrix.js`, backed by the existing numeric definitions in `js/core/parameter-routing.js`. Complex topology-changing Audio items are visible but disabled pending independent realtime-safe adapters, rather than silently changing layers.


## 7.11.14: Lightning, Orange Orbit Row, PC-Audio Default

- `v7125-lightning-orbit-audio-defaults-regression.js` verifies that the actual lightning strike clock is exactly 1/4 of the authored (unchanged 100% × 1) rate, Orange Orbit removal persists through re-render and can be reversed using the parameter menu, Blue/Orange Orbit labels are plain text, and the default audio source remains "Listen to PC" on desktop and mobile. A manually selected microphone remains respected.

## Somata 8.6.0

- `node tests/v860-corridor-gpu-transform-basis-regression.js` — byte-identical GPU transform basis, plus Morph-owner fallback parity.
- `node tests/v860-spiral-corridor-shared-attributes-regression.js` — exact retained Spiral GPU copy-payload parity with 8.5, FeatureHost cache reuse, frame invalidation, microbenchmark. With `SOMATA_BASELINE_ROOT` the test reads the unmodified 8.5 packer directly.
- Run existing 8.3 Corridor attributes tests, 8.4 Spiral Fill, 8.5 exact Bezier packing, Blue/Orange coverage, FrameContour, Fill/Web, Glow/Graffiti/Lamps, Lightning, and diagnostics on the unpacked release.
- CPU packing measurements do not certify NVIDIA/WebGPU image output.

## 8.8.0 — exact Spiral Morph arc-map lookup

- `node tests/v880-spiral-arc-lookup-regression.js` — проверяет полную численную совместимость и скорость поиска сегмента; опционально `SOMATA_BASELINE_ROOT` указывает на распакованную 8.7.0.
- `node tests/v880-exact-morph-gpu-data-regression.js` — проверяет CPU-generated GPU buffer hashes для пяти Morph-режимов. Эталон — чистая 8.7.0, код теста одинаков для обеих версий.
- `node tests/v880-arc-equalized-morph-benchmark.js` — отдельный короткий тест подготовки cross-family Morph в software Chromium.
- `node tests/v75-fps-benchmark.js` — общая сцена; не приравнивать прирост локального CPU к FPS аппаратного WebGPU.

## 8.10.0 — GPU completion fence batching

`node tests/v8100-gpu-buffer-fence-coalescing-regression.js` exercises the *production* recycler in a deterministic WebGPU queue mock: 2-frame retirement, one fence for 64 buffers, no early reuse, device reset, queue rejection and 90×100-buffer workload. Set `SOMATA_BASELINE_ROOT=/path/to/Somata_8.9.0` to also compare the unmodified 8.9.0 implementation (expected 9,000 vs 90 fences in that workload). This test does not certify hardware FPS. Continue with `node tests/static-modules.js`, FrameContour, Blue/Orange, Corridor, Fill/Web, exact Spiral, Lightning, Lamps/Graffiti, memory and full GPU hardware verification. See `PERFORMANCE_8.10.0_REPORT.md`.

### Somata 8.13.0 — Web nearest-point pruning

`node tests/v8130-web-nearest-pruning-regression.js` verifies **exact** nearest-point coordinates, distance, and tie precedence against the unchanged 8.12.0 projection for empty, short, dense, degenerate and 4096-segment contours. It also prints a comparative dense-Web CPU timing; this is **not** an FPS or hardware-WebGPU certification. Existing tests for static Web, Fill/Web ordering and shared FrameContour remain mandatory.

### Somata 8.15.0 — блочный AABB-отсев Web

`node tests/v8150-web-block-projection-regression.js` сравнивает точные проекции на контурах 0–4096 сегментов, включая один кадр с пересборкой таблицы, и выполняет браузерный сравнительный benchmark на 256/1024/4096 сегментах. Проверять также `v8130-web-nearest-pruning-regression.js`, Static Web, Fill/Web, эффекты Morph. Локальный CPU-бенчмарк не заменяет FPS и визуальную проверку на NVIDIA.


### Somata 8.16.0 — Render dispatch performance

`node tests/v8160-render-dispatch-cache-regression.js` проверяет повторное использование общего списка FeatureHost capability providers и приоритетов GeometryRoleService. Для сравнения с исходной 8.15.0: `SOMATA_BASELINE_ROOT=/path/to/Somata_8.15.0 node tests/v8160-render-dispatch-cache-regression.js`. Проверки включают регистрацию/перерегистрацию и замену provider после заполнения кэша; порядок ответов совпадает с базой. Также обязательны изоляция FeatureHost, Fill/Web, Glow+Graffiti+Lamps, Lightning, Blue/Orange и стандартный FPS-тест. GPU визуальную сертификацию на NVIDIA этот тест не заменяет.

## 8.18.0 — Regression gate (Solo / Orange / Glint)

Запускать из корня распакованного релиза:

```bash
node tests/v818-solo-orange-graffiti-regression.js
node tests/v818-graffiti-solo-line-warmup-regression.js
node tests/v818-glint-contour-coverage-regression.js
```

Проверяются: Solo третьего слоя с активным Green, перегенерации Orange с индивидуальным Graffiti, длина штриха 3, временно видимая Base при прогреве GPU Graffiti и охват всех контуров Glint. Не считайте `isReady` признаком фактической отрисовки пикселей на NVIDIA.

## 8.19.0 — Blue Morph × Corridor Palette Lag

```bash
node tests/v819-blue-palette-lag-stability-regression.js
node tests/v819-palette-lookup-benchmark.js
```

Проверяются стабильность выбранной Blue-палитры, плавность дробного индекса в 101 кадре, 3 независимых слоя и прозрачность Fill. Бенчмарк измеряет только CPU-поиск палитры, не FPS.

## Somata 8.19.1 — Corridor → Blue startup warmup

`node tests/v8191-startup-mode-warmup-regression.js` verifies that GPU copy-ring reservation never runs before the renderer becomes ready, is limited to 256 copies, and does not allocate after GPU device loss. In Chromium without hardware GPU, it also verifies Corridor → Blue Morph → Stop actions, no uncaught errors, and startup diagnostic availability. `RELEASE_8.19.1.md` documents GPU-specific verification limitations.

- V8.19.3: `node tests/v8193-orange-explicit-routes-regression.js` — Orange changes only explicitly routed layer parameters and persists an empty binding list.
- V8.19.3: `node tests/v8193-orange-special-row-style-regression.js` — real CSS parity for Forma/Orbits in Blue and Orange.
