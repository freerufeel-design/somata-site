# Somata 7.8.3 — Fill / Geometry separation fix

## Симптом

В редакторе порядка эффектов Fill и Geometry выглядели отдельными строками, но в runtime Fill мог снова попадать внутрь общего Geometry stroke batch. Из-за этого пользовательский порядок `Fill → Web → Geometry` не всегда означал три физически независимые compositor-позиции.

## Причина

Fast-path после предыдущей оптимизации разрешал Fill+Geometry fusion. Само это правильно для производительности, когда между ними нет активного эффекта. Ошибка состояла в том, что `SomataStrokeBatchService` решал, прикреплять ли Fill, по transient-флагам предыдущего Fill-pass (`_fillRenderedBelowWeb` / `_suppressLateFillForWeb`).

Если эти флаги не были выставлены/были потеряны/относились к другому пути кадра, Geometry мог снова запросить `prepareBatchAttachment()` и фактически забрать Fill в свой batch, хотя `SomataEffectStackOrder.plan()` уже требовал отдельный Fill.

## Исправление

`SomataEffectStackOrder.plan().standaloneFill` теперь является структурным контрактом всего кадра.

Если `standaloneFill === true`:

- Geometry stroke batch не имеет права прикреплять Fill;
- это не зависит от transient-флагов Fill-pass;
- Base не имеет права поздно дорисовать пропущенный ordered Fill поверх/внутри Geometry;
- при временной недоступности ordered Fill запрашивается repaint, но художественный порядок не нарушается.

При `Web OFF` и когда среди активных групп Fill и Geometry соседние, fast-path остаётся:

`Fill + Geometry → один GPU batch`.

При `Web ON` в порядке:

`Fill → Web → Geometry`

физически остаются три независимые позиции:

`Fill command → Web command → Geometry command`.

## Новый regression test

`tests/v783-fill-geometry-separation-regression.js`

Проверяет последовательные кадры одного слоя:

1. Web OFF → Fill разрешено fuse с Geometry.
2. Web ON → Fill обязан стать standalone.
3. Geometry batch не получает fillMask/nativeFillMesh.
4. Даже если вручную очистить transient Fill-флаги, Geometry не имеет права поглотить Fill обратно.

## Проверки

PASS:

- `static-modules.js`
- `contracts.js`
- `v783-fill-geometry-separation-regression.js`
- `v783-effect-order-fastpath-regression.js`
- `v783-effect-order-static-morph-regression.js`
- `v783-fill-web-featurehost-generation-regression.js`
- `v783-web-7320-render-fallback-regression.js`
- `v782-web-line-fill-authority-regression.js`
- `v782-corridor-frame-contour-regression.js`
- `v763-spiral-carrier-profile-invariant.js`
- `v7610-glow-fill-coexistence-regression.js`
- `v7611-morph-fill-without-corridor-regression.js`
- `gpu-effect-scene-routing.js` — 6/6
- `effect-render-impact.js` — 12/12

Таким образом исправление не отменяет fast-path, не меняет FrameContour/Spiral geometry и не теряет ранее восстановленные Web/Fill эффекты.
