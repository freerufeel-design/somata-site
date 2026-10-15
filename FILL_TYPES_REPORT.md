# Somata 7.8.3 — Fill Types + Zoom 100% report

## Baseline

Работа выполнена поверх стабильной сборки:

`Somata_7.8.3_stable_fill_msaa_fix.zip`

Критический MSAA-контракт обычной Fill сохранён: обычная ordered Fill всегда строится из чистой current-frame texture и не имеет права случайно накапливать предыдущие кадры.

## Что добавлено

### Единый список типов Fill

Существующий список Fill расширен до четырёх вариантов:

1. **Плотный**
2. **Математический**
3. **С накоплением**
4. **Затухающая**

Внутренне UI и renderer разделены:

- `fillRule = nonzero | evenodd` — topology-rule старых режимов;
- `fillType = normal | accumulation | fade` — способ композиции Fill.

Соответствие:

- Плотный → `fillType=normal`, `fillRule=nonzero`;
- Математический → `fillType=normal`, `fillRule=evenodd`;
- С накоплением → `fillType=accumulation`, сохраняет последний topology-rule;
- Затухающая → `fillType=fade`, сохраняет последний topology-rule.

Старые проекты без `fillType` автоматически загружаются как `normal` и сохраняют прежний `fillRule`.

## С накоплением

Добавлен параметр:

**Таймер накопления, сек.**

Диапазон UI: `0.1 ... 120` секунд, default `5` сек.

Механика:

```text
чистая current-frame Fill
        ↓
per-layer persistent GPU history texture
        ↓
source-over накопление
        ↓
один composite в Layer Scene
```

После истечения заданного количества секунд history texture очищается и начинается новый цикл накопления.

Если сцена статична и scheduler сам не запрашивает кадры, one-shot timer просит repaint в момент окончания цикла.

History texture привязана к layer + GPU generation + viewport size. GPU reset/device generation rebuild уничтожает старые history resources и timers.

Важно: этот режим является **явной управляемой историей Fill** и не использует старую ошибку persistent MSAA scratch.

## Затухающая

Настройки:

- направление:
  - **Из центра**;
  - **К центру**;
- **Жёсткость**: `0 ... 100%`.

Контракт жёсткости:

- `0%` → Fill отсутствует;
- `100%` → обычная Fill без ослабления;
- промежуточные значения → плавный градиент между нулевой и полной Fill.

Градиент строится как GPU post-process от маски самой текущей Fill. Внутренние iso-области оцениваются по соседним samples маски в восьми направлениях, поэтому центральная область следует форме/контуру текущей фигуры, а не независимому кругу.

Направление определяет, какая сторона градиента плотная:

- `Из центра` — плотнее центральная подобная контуру область, ослабление к границе;
- `К центру` — плотнее область у внешнего контура, ослабление к центральной области.

Fade не хранит историю между кадрами.

## Совместимость с effect order

`accumulation` и `fade` всегда являются самостоятельной Fill-командой compositor'а и не сливаются с Geometry batch.

Это позволяет сохранять физический порядок:

```text
Fill
Web
Geometry
```

или пользовательский обратный порядок Fill/Web.

Старые `Плотный/Математический` сохраняют существующий fast-path: если Web и custom order не требуют разрыва, Fill может оставаться внутри общего Geometry batch.

## Static / Morph

Новые специальные Fill-типы используют тот же authoritative geometry carrier, что обычная Fill.

Проверены 8 комбинаций:

- accumulation × Static × Web OFF;
- accumulation × Static × Web ON;
- fade × Static × Web OFF;
- fade × Static × Web ON;
- accumulation × Morph × Web OFF;
- accumulation × Morph × Web ON;
- fade × Morph × Web OFF;
- fade × Morph × Web ON.

Во всех комбинациях Fill standalone и committed; при Web ON также committed Web.

## Zoom 100%

Двойной клик по индикатору масштаба внизу справа (`100%`, `125%` и т. п.) теперь устанавливает:

`state.zoom = 1.0`

и отображает `100%`.

Панорамирование при этом **не сбрасывается** — изменяется только масштаб. Существующая команда Reset View остаётся отдельной функцией для полного сброса вида.

## Сохранение проекта

Новые поля живут непосредственно в layer state и сериализуются существующим `buildProjectData()` через `cloneData(state.layers)`:

- `fillType`;
- `fillAccumulationSeconds`;
- `fillFadeDirection`;
- `fillFadeHardness`.

Load migration нормализует их и даёт defaults старым проектам.

## Cache bust

Изменённые browser assets получили stamp:

`20261016-v78307`

для:

- `styles/app.css`;
- `js/core/defaults-layers.js`;
- `js/app/geometry-gpu-core.js`;
- `js/render/pass-registry.js`;
- `js/app/ui-project-runtime.js`.

## Новые тесты

### `v783-fill-types-ui-regression.js`

PASS. Проверяет:

- четыре пункта списка;
- old-rule semantics Плотный/Математический;
- условные controls accumulation/fade;
- timer seconds;
- fade direction/hardness;
- fast-path normal Fill;
- standalone special Fill;
- double-click zoom → 100%;
- pan remains unchanged.

### `v783-fill-special-gpu-contract-regression.js`

PASS. Проверяет source/GPU contracts:

- отдельную history texture;
- clear/load cycle accumulation;
- timer seconds + repaint deadline;
- fade shader/mask sampling;
- hardness boundary 0/100;
- direction wiring;
- special modes use isolated Fill path;
- normal Fill remains the only fusible type.

### `v783-fill-types-static-morph-regression.js`

PASS. Проверяет 8 комбинаций special Fill × Static/Morph × Web OFF/ON.

## Повторно прошедшие критические regressions

PASS:

- `static-modules.js`
- `contracts.js`
- `v783-fill-msaa-isolation-regression.js`
- `v783-effect-order-fastpath-regression.js`
- `v783-effect-order-static-morph-regression.js`
- `v783-fill-web-featurehost-gpu-order-regression.js`
- `v783-fill-web-line-hidden-no-accumulation-regression.js`
- `v763-spiral-carrier-profile-invariant.js`
- `v780-shared-frame-contour-regression.js`
- `v782-corridor-frame-contour-regression.js`
- `gpu-effect-scene-routing.js` — **6/6**
- `effect-render-impact.js` — **12/12**
- `graffiti-glow-lamp-blend-regression.js`
- `graffiti-lightning-aftershock-regression.js`
- `lightning-impact-regression.js`
- `v76-gpu-warmup-nonblocking.js`

## Что не менялось

В этой задаче не начата большая Geometry/Profile migration.

Не переписывались:

- Web geometry;
- Morph semantics;
- FrameContour contract;
- strict Spiral carrier;
- `fill-pass.js`;
- `spiral-fill-adapter.js`.

## Ограничение тестовой среды

В browser harness `navigator.gpu` недоступен как реальный secure-context WebGPU device. Поэтому JS routing, command contracts, source/WGSL contracts, Static/Morph и effect-order проверены автоматически, но **физический вид fading WGSL на реальной видеокарте необходимо визуально проверить**.

В первую очередь рекомендуется проверить:

1. Затухающая → Жёсткость 0%, 25%, 50%, 75%, 100%;
2. оба направления;
3. Polygon с острыми углами и rounding;
4. Morph;
5. Web одновременно с Fade;
6. Accumulation в течение нескольких timer cycles;
7. переключение accumulation → normal → accumulation (новый цикл должен начаться чисто).
