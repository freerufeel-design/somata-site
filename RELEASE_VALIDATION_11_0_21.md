# Somata 11.0.21 — результаты тестов скруглений

## Изменения

Базовая версия — 11.0.20. В рабочих JS-файлах изменён **только** `js/geometry/unified-fillet.js`. Частные сэмплы (`source`) больше не дублируются при построении `rail`: их запись и объединение коротких рёбер выполняются прямо при обходе исходного контура, в **прежнем порядке**. В функции поиска станции арк-длины используется курсор с неизменным правилом lower_bound; при движении назад и на шве он сбрасывается к оригинальному двоичному поиску. Нет зависимости от предыдущего кадра. Изменена только цена вычисления: те же координаты и порядок итоговых команд Bézier.

## Главная новая проверка

`node tests/v1121-arc-cursor-exact-parity.js`: **1845/1845 точных сравнений** с приложенной копией построителя 11.0.20 (`tests/fixtures/v1121-unified-fillet-1120.js`). Сценарии: случайные и звёздчатые/пилообразные открытые и замкнутые профили, смешанные разрешения скругления, рёбра порядка 1e-9, сплайны с реальной centripetal-аппроксимацией, до 5000 точек, спиральные кадры на фазах 0 и 1, ограничения радиуса от 0 до 90%. Проводится сравнение ВСЕХ числовых Bézier-команд; исходные опорные точки не модифицируются.

## Регрессии Node.js: все пройдены

- `node tests/v1105-unified-fillet-overlay-regression.js` — 900 сценариев
- `node tests/v1106-fillet-phase-stability-regression.js` — 351 сравнение
- `node tests/v1107-mixed-micro-profile-continuity-regression.js` — 240 сценариев
- `node tests/v1111-radius-micro-phase-stress-regression.js` и `node tests/v1111-low-radius-budget-phase-regression.js` — 3995 + 3995 пар состояний
- `node tests/v1112-spline-subdivision-seam-regression.js` — 180 переходов
- `node tests/v1113-open-endpoint-spiral-fillet-regression.js` — 270 случаев
- `node tests/v1114-partial-activation-tangent-regression.js` — 174 контура, 2374 сопряжения с G1
- `node tests/v1115-continuous-radius-budget-regression.js` — пороговый тест + 36 фиксированных пар
- `node tests/v1116-micro-edge-signed-guard-regression.js` — 4 сложных случая
- `node tests/v1116-radius-safety-sweep-regression.js` — 1000 случайных фигур
- `node tests/v1117-fast-radius-witness-parity-regression.js` — 420 точных проверок

## Chromium (GPU-ускорение отключено): все пройдены

- `node tests/v1107-k2-spiral-phase-browser-regression.js` — 24 сценария N=4/K=2
- `node tests/v1108-phase-gate-continuity-regression.js` — 6 сценариев x 23 состояния
- `node tests/v1108-real-spiral-phase-regression.js` — 8 сценариев x 21 состояние
- `node tests/v1113-real-open-spiral-browser-regression.js` — 60 проверок
- `node tests/v1114-live-morph-tangent-browser-regression.js` — 120 проверок

## Быстродействие

`node tests/v1121-arc-cursor-benchmark.js` измеряет медианы после прогрева на Node.js (не FPS полной программы). Результаты могут меняться от запуска к запуску. В одном из прогонов: волнистый spline 300 узлов 8.008→4.275 мс, зубчатый spline 600 узлов 8.022→4.439 мс, окружность spline 600 узлов 14.309→14.010 мс, обычная волна 2000 узлов 16.797→15.670 мс, обычная окружность 2000 узлов 20.291→20.951 мс, пила 2000 узлов 2.699→2.288 мс. Выигрыш **не универсален**.

## Ограничения

Сборка не меняет геометрическую модель 11.0.20 и потому не гарантирует устранение неизвестного дефекта в конкретном пользовательском Morph. На плотных волнах из 5000 точек полный расчёт всё ещё существенно превышает 16,7 мс; аппаратный WebGPU и реальный сохранённый проект не проверялись. Строгая G2 для любых самопересечений не доказана. Базовая линейная геометрия Morph, транспорт спиралей и фазовая интерполяция неизменны.
