# Somata 7.8.3 — ordinary Fill / Web MSAA accumulation fix

## Симптом

При включённой Web полупрозрачная Fill могла визуально накапливаться от repaint к repaint. Особенно заметно при изменении масштаба/трансформации: на экране оставались предыдущие состояния заливки, как серия вложенных контуров. Без Web проблема практически не проявлялась.

## Что показала runtime-диагностика

Диагностика пользователя показала, что это не двойная презентация Layer Scene:

- `sceneComposites` не рос на каждом кадре;
- `externalFrames` и `externalSubmissions` росли примерно по одному на кадр;
- очередь после презентации была пустой.

Следовательно, накопление происходило внутри самого ordered Fill GPU path.

## Точная причина

Когда Web активна, Fill должна быть отдельной художественной группой и сохранять уже находящиеся ниже эффекты. В предыдущей реализации это делалось так:

```text
FillGPURenderer.encodeMeshCommandToTexture(..., preserveTarget = true)
```

Native Fill использует 4x MSAA. В `encodeMeshPass()` флаг `preserveTarget=true` превращал первый render pass в:

```text
MSAA color attachment: loadOp = "load"
resolveTarget: Layer Scene
```

Но `loadOp` относится к MSAA scratch texture, а не к resolve target. MSAA scratch texture переиспользуется между кадрами. Поэтому новый ordered Fill загружал предыдущую заливку из MSAA, добавлял текущую и resolve'ил накопленный результат обратно в свежую Layer Scene.

Root-clear Layer Scene не мог исправить это, потому что старая Fill возвращалась уже после clear — во время MSAA resolve.

Это полностью объясняет условие ошибки:

```text
Web OFF
→ Fill может идти быстрым объединённым путём
→ MSAA начинает кадр с clear
→ накопления нет

Web ON
→ Fill становится ordered/preserving
→ старый код загружал persistent MSAA scratch
→ Fill накапливается между repaint'ами
```

## Исправление

Ordered/preserving Fill больше никогда не использует persistent MSAA как историю.

Теперь путь такой:

```text
current frame Fill
    ↓
4x MSAA scratch — ВСЕГДА clear
    ↓ resolve
isolated current-frame Fill texture
    ↓ source-over exactly once
Layer Scene
```

Добавлена отдельная `isolatedFillTexture`, которая содержит только Fill текущего кадра. После построения Fill она одним fullscreen source-over pass композится в Layer Scene.

Это сохраняет возможность пользовательского порядка:

```text
Fill → Web → Geometry
```

и

```text
Web → Fill → Geometry
```

без накопления Fill.

## Fast path

Fast path без Web не убран.

Если Fill владеет корнем сцены и не должна сохранять находящуюся ниже группу, остаётся прямой более дешёвый путь. Isolated texture используется только там, где Fill действительно должна сохранить уже существующее содержимое target.

## Corridor / retained Spiral

Та же ошибка могла возникнуть в preserving-ветвях Corridor и retained Spiral Fill. Поэтому:

- root Fill, которая сама очищает target, остаётся direct;
- preserving Fill поверх resident Layer Scene использует isolated current-frame Fill texture.

Exact Spiral carrier при этом не менялся.

## Диагностика Fill

Исправлена отдельная ошибка диагностики. После успешного ordered Fill `SomataFillPassService.begin()` раньше мог снова записать runtime trace как:

```text
handled: false
stage: contract
```

хотя `_baseFillCommitted === true`.

Теперь committed Fill остаётся `handled:true`, поэтому `[SpiroStar Fill] NOT VISIBLE` больше не должен появляться только из-за перезаписи trace поздней стадией.

## Новая регрессия

Добавлен:

```text
tests/v783-fill-msaa-isolation-regression.js
```

Он проверяет архитектурный инвариант:

- ordered Fill использует isolated current-frame texture;
- isolated Fill вызывает `encodeMeshPass(... preserveTarget=false)`;
- ordinary Web-ordered Fill больше не вызывает direct MSAA path с `preserveTarget=true`;
- Corridor/retained Spiral preserving Fill используют isolated path;
- committed ordered Fill не перезаписывается диагностикой как `handled:false`.

## Повторно пройденные тесты

PASS:

- `static-modules.js`
- `contracts.js`
- `v783-fill-msaa-isolation-regression.js`
- `v783-effect-order-static-morph-regression.js`
- `v783-fill-web-featurehost-gpu-order-regression.js`
- `v783-fill-web-line-hidden-no-accumulation-regression.js`
- `v783-effect-order-fastpath-regression.js`
- `v783-effect-order-feature-scope-regression.js`
- `v783-fill-geometry-separation-regression.js`
- `v783-fill-web-featurehost-generation-regression.js`
- `v783-layer-scene-frame-generation-regression.js`
- `v780-shared-frame-contour-regression.js`
- `v782-corridor-frame-contour-regression.js`
- `v763-spiral-carrier-profile-invariant.js`
- `v7610-glow-fill-coexistence-regression.js`
- `v7611-morph-fill-without-corridor-regression.js`
- `v779-dynamic-fill-unified-regression.js`
- `v779-fill-follows-line-carrier-regression.js`
- `v782-web-fill-order-retry-regression.js`
- `v782-web-line-fill-authority-regression.js`
- `v783-static-web-render-pass-regression.js`
- `gpu-effect-scene-routing.js` — 6/6
- `effect-render-impact.js` — 12/12

## Что НЕ делалось

- новые типы Fill не добавлялись;
- intentional accumulation Fill пока не добавлялась;
- fading Fill пока не добавлялась;
- Web geometry не менялась;
- Morph mathematics не менялась;
- `FrameContour` не менялся;
- effect-order planner не менялся.

Сначала стабилизируется обычная Fill. После физической проверки этой сборки найденный accumulation-effect можно безопасно оформить отдельным типом заливки с собственной history texture и таймером.
