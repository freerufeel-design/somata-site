# Somata 11.0.13 — протокол проверки

## Воспроизведённый дефект

Сборка 11.0.12 на открытом контуре `(0,0),(30,0),(30,100)` при 200% скругления и `baseEdge=100` с выключенным радиусным поиском перемещает начало на **8.0846** единицы; у другого открытого профиля начальная точка дрейфует почти на **9.94** единицы. Новый `v1113-open-endpoint-spiral-fillet-regression.js` на исходной 11.0.12 закономерно падает с `open start drifted by 1.21747` уже на другом сценарии.

## Новые тесты

| Команда | Результат |
|---|---|
| `node tests/v1113-open-endpoint-spiral-fillet-regression.js` | PASS — 270 открытых профилей/спиральных состояний (0–200%, разные допуски), включая 60 сравнений соседних фаз; максимальное изменение Bézier-контролей около `0.000002374` для сдвига фазы `1e-7` |
| `node tests/v1113-real-open-spiral-browser-regression.js` | PASS — 60 браузерных маршрутов: polyline, профильный spline и whole-curve spline; максимальный дрейф конца `5.41e-14` |
| Побайтовое сравнение команд замкнутых контуров против 11.0.12 | PASS — 350 детерминированных профилей, бит-в-бит идентичный набор команд |

## Повторные тесты

| Команда | Результат |
|---|---|
| `node tests/v1102-rounding-morph-endpoints-regression.js` | PASS — Static/Morph N6/K3 |
| `node tests/v1104-phase-edge-pixel-continuity-regression.js` | PASS — 12 фазовых швов |
| `node tests/v1105-unified-fillet-browser-regression.js` | PASS — Canvas2D, 0–200%, Монорадиус |
| `node tests/v1107-k2-spiral-phase-browser-regression.js` | PASS — 24 случая N4/K2 |
| `node tests/v1108-real-spiral-phase-regression.js` | PASS — 8 открытых/замкнутых спиральных носителей |
| `node tests/v1109-spiral-width-carrier-regression.js` | PASS — ширина спирали |
| `node tests/v1109-spiral-mapped-low-rounding-regression.js` | PASS — слабое спиральное скругление |
| `node tests/v1110-dense-morph-spiral-fillet-continuity.js` | PASS — плотные контуры до 5000 точек |
| `node tests/v1110-radius-witness-equivalence-regression.js` | PASS — ограничитель и неизменность исходных точек |
| `node tests/v1111-mini-profile-collapse-boundary.js` | PASS — 96 коллапсов мини-профиля |
| `node tests/v1111-radius-micro-phase-stress-regression.js` | PASS — 3995 близких состояний |
| `node tests/v1111-low-radius-budget-phase-regression.js` | PASS — 3995 строгих бюджетов |
| `node tests/v1112-spline-subdivision-seam-regression.js` | PASS — 180 переходов сплайна |
| `node tests/v1112-spline-browser-rail-regression.js` | PASS — 54 браузерных перехода сплайна |
| `node tests/v1105-unified-fillet-overlay-regression.js` | PASS — 900 случайных конфигураций |
| `node tests/v1107-mixed-micro-profile-continuity-regression.js` | PASS — 240 мини-профилей |
| `node tests/v1106-fillet-phase-stability-regression.js` | PASS — 351 фазовая проверка |

## Ограничения

Не запускалась вся историческая батарея тестов, не проверен реальный аппаратный WebGPU и оригинальный сохранённый проект. Результаты с Chromium при `disableGpu:true` не являются тестом видеокарты.
