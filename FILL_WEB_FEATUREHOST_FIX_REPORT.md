# Somata 7.8.3 — Fill/Web FeatureHost fix

## Симптом

При выключенной Fill паутина отображалась, а при включённой Fill паутина переставала доходить до render/generation path.

## Корень проблемы

Проблема находилась в FeatureHost-контракте между Fill и Web.

Fill pass записывал служебные frame-поля:

- `_fillBelowWebResolved`
- `_fillRenderedBelowWeb`
- `_suppressLateFillForWeb`

но эти поля не были объявлены как `outputs` feature `fill`. FeatureHost по контракту отбрасывает незаявленные записи после pass-а.

Одновременно Web проверял `_fillBelowWebResolved`, но не объявлял это поле в `reads`. FeatureHost маскировал незаявленный scratch-input, поэтому Web видел `undefined` и выходил до построения/вывода нитей с причиной:

`Fill ordering pass has not resolved yet`

Старые тесты не ловили ошибку, потому что часть из них вызывала внутренний Fill helper напрямую, обходя FeatureHost.

## Исправление

`fill` теперь явно владеет тремя ordering outputs.

`web` явно читает `_fillBelowWebResolved`.

Никакая геометрическая логика Web/Fill не изменена. Сохраняются:

- общий FrameContour;
- три режима Web;
- exact strict Spiral carrier;
- configurable effect order;
- Static/Morph unified path.

## Новый regression

`tests/v783-fill-web-featurehost-generation-regression.js`

Тест выполняет Fill и Web через настоящий `PassRegistry + FeatureHost`, а не прямым вызовом helper-а.

Проверено с Fill ON:

| Режим Web | Static | Active Morph |
|---|---:|---:|
| corners | PASS | PASS |
| selfIntersection | PASS | PASS |
| selfIntersectionCorridor | PASS | PASS |

В GPU-disabled browser дополнительно проверяется фактический fallback-output и ненулевые Canvas pixels. Это специально воспроизводит путь, где раньше Fill блокировал Web.

## Дополнительные пройденные проверки

- `v779-self-owned-feature-contracts.js`
- `v774-feature-plugin-architecture.js`
- `v782-web-fill-order-retry-regression.js`
- `v782-web-line-fill-authority-regression.js`
- `v783-effect-order-static-morph-regression.js`
- `v783-web-7320-render-fallback-regression.js`
- `v783-static-web-render-pass-regression.js`
- `v783-web-default-corners-regression.js`
- `v783-web-toggle-stability-regression.js`
- `v780-shared-frame-contour-regression.js`
- `v782-corridor-frame-contour-regression.js`
- `v763-spiral-carrier-profile-invariant.js`
- `v762-static-dynamic-geometry-invariant.js`
- `v779-palette-fill-web-color-regression.js`
- `v7610-glow-fill-coexistence-regression.js`
- `v7611-morph-fill-without-corridor-regression.js`
- `effect-render-impact.js` — all 12 sections PASS
- `static-modules.js`
- `contracts.js`

## Cache bust

`web-plan.js` и `fill-pass.js` получили новый query cache-bust `20261015-v78303`, чтобы браузер не продолжал исполнять старый FeatureHost contract из кэша.
