# Somata 11.0.14 — проверка устойчивости

Испытано 2026-10-31. База: 11.0.13. Из работающего JS-кода изменён **только** `js/geometry/unified-fillet.js`; обновлены номер версии в `index.html`, манифест и документация. Все входные координаты и правила Morph неизменны.

## Воспроизведение ошибки в базе

`SOMATA_FILLET_SOURCE=/путь/к/11.0.13/js/geometry/unified-fillet.js node tests/v1114-partial-activation-tangent-regression.js` — FAIL, измерен излом 65,785°. Непосредственный профиль `(0,0),(6,0),(6,30),(45,30)` при 100% скругления демонстрировал угол около 68,606°.

## Новые тесты после исправления

| Команда | Результат |
|---|---|
| `node tests/v1114-partial-activation-tangent-regression.js` | PASS — 174 открытых и закрытых профиля, 2374 проверенных сопряжения Bézier, максимальный угол 2,68e-11 градуса |
| `node tests/v1114-live-morph-tangent-browser-regression.js` | PASS — 120 браузерных маршрутов через `roundPolylineForDraw`, максимальный угол 1,32e-12 градуса, дрейф конца 1,42e-14 геом. единицы |

## Повторные регрессии

| Тест | Результат |
|---|---|
| `v1113-open-endpoint-spiral-fillet-regression.js` | PASS, 270 профилей и соседних фаз |
| `v1113-real-open-spiral-browser-regression.js` | PASS, 60 вариантов |
| `v1111-mini-profile-collapse-boundary.js` | PASS, 96 переходов |
| `v1111-radius-micro-phase-stress-regression.js` | PASS, 3995 близких фаз, максимум 0,000352 |
| `v1111-low-radius-budget-phase-regression.js` | PASS, 3995 фаз, максимум 0,000820 |
| `v1105-unified-fillet-overlay-regression.js` | PASS, 900 случайных контуров |
| `v1107-mixed-micro-profile-continuity-regression.js` | PASS, 240 мини-профилей |
| `v1112-spline-subdivision-seam-regression.js` | PASS, 180 соседних состояний |
| `v1106-fillet-phase-stability-regression.js` | PASS, 351 проверка фаз |
| `v1102-rounding-morph-endpoints-regression.js` | PASS, N=6/K=3 Static/Morph |
| `v1104-phase-edge-pixel-continuity-regression.js` | PASS, 12 фазовых швов |
| `v1105-unified-fillet-browser-regression.js` | PASS, Canvas2D, MonoRadius 0–200% |
| `v1107-k2-spiral-phase-browser-regression.js` | PASS, 24 браузерных N=4/K=2 |
| `v1108-real-spiral-phase-regression.js` | PASS, 8 спиральных носителей, 21 состояние |
| `v1112-spline-browser-rail-regression.js` | PASS, 54 браузерных перехода |
| `v1110-dense-morph-spiral-fillet-continuity.js` | PASS, до 5000 узлов |
| `v1110-radius-witness-equivalence-regression.js` | PASS, 125 вариантов |

## Что не проверено

Полная историческая батарея тестов, реальные видеокарты/WebGPU, пользовательский сохранённый проект. Условия тестирования браузера: Chromium headless с отключённым аппаратным GPU. Проверенные G1-соединения не означают строгой G2-непрерывности для произвольной фигуры.
