# Somata 7.8.3 — Fill Types + v505 Topology Lamp Sticking Fix

## База

Исправление сделано поверх `Somata_7.8.3_stable_fill_types.zip`, которая в свою очередь была построена поверх стабильной `Somata_7.8.3_stable_fill_msaa_fix.zip`.

В этой итерации не переписывались Web, FrameContour, Morph semantics, effect-order planner или strict Spiral carrier.

## 1. Почему после добавления типов перестали работать все Fill

Новый режим `Затухающая` добавил отдельный WGSL/pipeline, но его создание было включено в общий fatal init native Fill renderer.

Это нарушало важную границу: validation/error экспериментального специального Fill shader мог перевести весь `WebGPUFillMeshRenderer` в `ready=false`. В таком состоянии вместе с `Затухающей` переставали работать и старые `Плотный`/`Математический`, а также `С накоплением`, потому что они зависели от того же базового renderer lifecycle.

### Исправление

- базовые native Fill pipelines инициализируются независимо;
- Fade pipeline создаётся в отдельном non-fatal `try/catch`;
- ошибка Fade записывается в `fadeCompositeError`, но базовый renderer остаётся `ready=true`;
- diagnostics/status публикуют `fadeAvailable` и `fadeError`;
- fragment shader Fade переведён с implicit-derivative `textureSample()` на explicit LOD `textureSampleLevel(..., 0.0)`, включая соседние выборки;
- если специальный Fade pipeline недоступен, это ошибка только режима Fade, а не всех Fill.

Архитектурный инвариант теперь зафиксирован так:

> специальный Fill shader/pipeline не имеет права определять жизнеспособность базовой Fill.

`Плотный` и `Математический` должны продолжать работать даже при validation failure специального shader.

## 2. Почему в Topology Morph лампы перестали прилипать

Для сравнения использована предоставленная пользователем версия `SpiroStar_v505_Canonical_Geometry.zip`.

В v505 Topology/Calm path сохраняет topology identity, но после вычисления промежуточной позиции выполняет обязательную финальную проекцию ламп на **текущий реально отображаемый rail данного кадра**.

В поздней архитектуре появился ускоренный `gpuLampTopologyResource`. Он мог закончить подготовку ламп раньше canonical CPU path и интерполировал позиции по frozen source/target segment references. Это сохраняло identity, но обходило финальную current-rail projection v505. Поэтому лампа могла математически следовать правильной lineage, но визуально отлипать от текущего Morph-контура.

### Исправление

В `lamp-morph-bridge.js` восстановлен именно инвариант v505, а не весь старый renderer:

- если Morph активен;
- mode = `topology` или `calm`;
- geometry не strict Spiral;
- включено contour sticking / snap-to-contour;

то GPU topology shortcut намеренно не перехватывает кадр. `lamp-plan` использует существующий canonical path, который в конце проецирует лампы на текущий visual rail.

Если contour sticking выключено, GPU topology shortcut снова разрешён.

Strict Spiral не переводится на этот путь и сохраняет exact Arc / retained carrier.

## 3. Новые regression tests

### `tests/v783-fill-special-pipeline-firewall-regression.js`

Проверяет, что:

- Fade pipeline изолирован от fatal base Fill init;
- WGSL использует `textureSampleLevel`;
- failure Fade не может оставить base Fill renderer в `ready=false`;
- diagnostic status публикует availability/error специального pipeline.

### `tests/v783-topology-lamp-v505-sticking-regression.js`

Реальный browser test для Topology Morph:

- включает lamp contour sticking;
- требует canonical v505 route;
- запрещает topology GPU shortcut в этом режиме;
- строит текущий visual rail;
- проверяет, что каждая лампа лежит на нём.

Последний прогон:

- lamps: 11/11;
- max distance to current rail: ~`3.55e-15` (численная погрешность);
- при выключении sticking canonical override отключается.

## 4. Regression gate

На исправленной рабочей копии прошли:

- `v783-fill-special-pipeline-firewall-regression.js`
- `v783-fill-special-gpu-contract-regression.js`
- `v783-fill-types-ui-regression.js`
- `v783-fill-types-static-morph-regression.js`
- `v783-fill-msaa-isolation-regression.js`
- `v783-fill-web-featurehost-gpu-order-regression.js`
- `v783-fill-web-featurehost-generation-regression.js`
- `v783-fill-web-line-hidden-no-accumulation-regression.js`
- `v783-effect-order-static-morph-regression.js`
- `v783-effect-order-fastpath-regression.js`
- `v783-fill-geometry-separation-regression.js`
- `v780-shared-frame-contour-regression.js`
- `v782-corridor-frame-contour-regression.js`
- `v763-spiral-carrier-profile-invariant.js`
- `gpu-effect-scene-routing.js` — 6/6
- `graffiti-glow-lamp-blend-regression.js`
- `v75-topology-monoradius-regression.js`
- `v761-topology-calm-stall-continuity.js`
- `v783-topology-lamp-v505-sticking-regression.js`
- `effect-render-impact.js` — 12/12
- `static-modules.js`
- `contracts.js`
- `v76-profile-carrier-architecture.js`
- `v762-static-dynamic-geometry-invariant.js`

Один длинный пакетный shell-run упёрся во внешний timeout оболочки после уже пройденных тестов; оставшиеся тесты были запущены отдельно и прошли. Timeout не трактовался как PASS.

## 5. Что сознательно не менялось

- Web geometry и три режима паутины;
- FrameContour contract;
- effect stack ordering;
- Morph timing;
- Corridor carrier;
- strict Spiral exact carrier;
- основной Lamp compositor/render pass;
- значения/структура новых Fill UI controls.

## 6. Ограничение проверки

Headless/browser harness не предоставляет тот же физический WebGPU device/driver, что пользовательская система. Поэтому firewall гарантирует, что специальный Fade shader больше не может отключить базовые Fill, а WGSL-контракт исправлен, но окончательный внешний вид `Затухающей` Fill всё равно следует визуально подтвердить на физическом GPU.

Topology lamp sticking проверяется геометрически в browser regression: финальные lamp points принадлежат текущему visual rail с численной погрешностью.
