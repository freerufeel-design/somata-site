# Somata 11.0.12 — протокол проверки

## Проблема и воспроизведение

Было: при неизменных точках spline-контура разбиение менялось на `edge=18/20/22/…`, что могло менять саму кривую. В воспроизводимом случае `edge=17.999999 -> 18.000001` старая версия давала расхождение примерно **0.155** геометрической единицы; число Bézier-частей менялось. Новый тест `v1112-spline-subdivision-seam-regression.js` на исходной версии 11.0.11 завершался ошибкой `60 !== 66`.

Стало: постоянное 16-кратное разбиение. За 180 пар пороговых испытаний (открытый/замкнутый контур, 0.25–2.00 скругления, бюджеты 30% и 95%) максимальная геометрическая разница при изменении базового ребра на `0.000002` составила около **0.00000006** единицы. Число команд одинаково у обеих фаз.

## Тесты

| Команда | Наблюдение |
|---|---|
| `node tests/v1112-spline-subdivision-seam-regression.js` | PASS — 180 пар, max ~0.00000006 |
| `node tests/v1112-spline-browser-rail-regression.js` | PASS — 54 браузерных случая, max координат управляющих точек ~0.000002, одинаковое количество команд |
| `node tests/v1105-unified-fillet-overlay-regression.js` | PASS — 900 случайных случаев |
| `node tests/v1106-fillet-phase-stability-regression.js` | PASS — 351 сравнение фаз |
| `node tests/v1107-mixed-micro-profile-continuity-regression.js` | PASS — 240 проверок |
| `node tests/v1110-dense-morph-spiral-fillet-continuity.js` | PASS — 22 плотных случая |
| `node tests/v1110-radius-witness-equivalence-regression.js` | PASS — 125 сравнений и проверок неизменности входных точек |
| `node tests/v1111-radius-micro-phase-stress-regression.js` | PASS — 3995 близких фаз |
| `node tests/v1111-low-radius-budget-phase-regression.js` | PASS — 3995 строгих бюджетов |
| `node tests/v1111-mini-profile-collapse-boundary.js` | PASS — 96 переходов микроребра |
| `node tests/v1102-rounding-morph-endpoints-regression.js` | PASS — Static/Morph, N6/K3, 0–200% |
| `node tests/v1104-phase-edge-pixel-continuity-regression.js` | PASS — 12 пиксельных фазовых швов |
| `node tests/v1105-unified-fillet-browser-regression.js` | PASS — Canvas2D, настройки и MonoRadius |
| `node tests/v1107-k2-spiral-phase-browser-regression.js` | PASS — 24 сценария N4/K2 |
| `node tests/v1108-real-spiral-phase-regression.js` | PASS — 8 реальных браузерных спиральных носителей |
| `node tests/v1108-zero-rounding-spline-regression.js` | PASS — малые значения скругления; измерение по редким точкам даёт собственную погрешность |
| `node tests/v1109-spiral-width-carrier-regression.js` | PASS — ширина штриха по длине контура |
| `node tests/v1109-spiral-mapped-low-rounding-regression.js` | PASS — плавное включение спирального скругления |
| `node tests/v1109-exact-bezier-blend-regression.js` | PASS — 96 пар смешивания Bézier |

## Не проверялось

Пользовательский исходный проект, аппаратный WebGPU, доказательство G2 для всех самопересечений и полная историческая батарея Somata. Тесты с отключённым GPU проверяют браузерные пути и геометрию, но не производительность на конкретной видеокарте.
