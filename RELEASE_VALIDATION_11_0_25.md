# RELEASE VALIDATION — Somata 11.0.25

## Найденная ошибка и исправление

В версии 11.0.24 восстановитель динамических углов `completeLiveMorphCornerFlags` искал соседние точки по условию `distance > 1e-6`. На почти совпадающих точках изменение **2e-9** геометрической единицы пересекало порог и мгновенно меняло входящую/выходящую касательную на другую. В браузерном тесте старая версия дала **725,25098** условных единиц разницы альфа-канала, более **1017** заметно изменившихся пикселей.

В новой версии точка пробы движется непрерывно вдоль исходного контура на расстоянии `min(0.04 * базовое ребро, 0.15 * длина контура)` (с нижним числовым допуском), вместо скачкообразного выбора соседнего индекса. Используется массив префиксных длин и бинарный поиск. Это позволяет мини-профилю воздействовать на скругление по мере роста. Никакие исходные точки Morph не изменены.

## Новые регрессионные тесты

- `node tests/v1125-arc-probe-micro-corner-continuity.js` — **PASS**: 352 пары браузерных рендеров, открытые и замкнутые контуры, переходы `0.999e-6` / `1.001e-6`, переходы через новую длину пробы, фазы 0.02 и 0.5. Максимум 2.2078 условных пиксельных единиц. Тот же тест на неизменённой 11.0.24 — **FAIL**: 725.251 единицы.
- `node tests/v1125-arc-probe-seam-and-density.js` — **PASS**: 4476 проверок восстановленных весов при циклическом изменении стартовой вершины, максимальное расхождение 2.5e-14. Медианное время только вычисления весов для 1000/2000/5000 вершин в локальном Chromium: 0.4 / 0.7 / 1.6 мс (не FPS всего приложения).

## Повторные тесты

- `node tests/v1124-live-corner-angle-continuity.js` — PASS, 84 проверки порогов угла 15/25/30°.
- `node tests/v1124-fractional-fillet-g1-regression.js` — PASS, 180 конфигураций и 3466 G1-стыков.
- `node tests/v1105-unified-fillet-overlay-regression.js` — PASS, 900 случайных геометрий.
- `node tests/v1106-fillet-phase-stability-regression.js` — PASS, 351 сравнение.
- `node tests/v1107-mixed-micro-profile-continuity-regression.js` — PASS, 240 сравнений.
- `node tests/v1111-radius-micro-phase-stress-regression.js` — PASS, 3995 сравнений.
- `node tests/v1111-low-radius-budget-phase-regression.js` — PASS, 3995 сравнений.
- `node tests/v1123-subpixel-neighbor-stability-regression.js` — PASS, 1130 сравнений.
- `node tests/v1113-open-endpoint-spiral-fillet-regression.js` — PASS, 270 проверок.
- `node tests/v1114-partial-activation-tangent-regression.js` — PASS, 2374 соединения.
- `node tests/v1116-micro-edge-signed-guard-regression.js` — PASS.
- `node tests/v1108-phase-gate-continuity-regression.js` — PASS, 6 × 23 состояния фаз.
- `node tests/v1108-real-spiral-phase-regression.js` — PASS, 8 × 21 спиральных состояний.
- `node tests/v1107-k2-spiral-phase-browser-regression.js` — PASS, 24 сценария N4/K2.
- `node tests/v1113-real-open-spiral-browser-regression.js` — PASS, 60 проверок.
- `node tests/v1114-live-morph-tangent-browser-regression.js` — PASS, 120 проверок.
- `node tests/v10419-38-monoradius-primary-circle-fit.js` — PASS.

## Изменения и ограничения

Из рабочих JavaScript-файлов изменён **только `js/geometry/morph.js` в функции восстановления дополнительных скругляемых углов**. `unified-fillet.js`, линейный перенос точек, N/K, контроллер фаз, спиральный транспорт — не тронуты. Версия ресурсов в `index.html` и имя приложения в `manifest.webmanifest` обновлены на 11.0.25.

Не проверены аппаратный WebGPU, конкретный проблемный сохранённый проект и строгая G2-непрерывность на любых контурах. Известный старый тест Topology/Монорадиуса не исправлялся. Новые тесты доказывают устойчивость **только** проверенных конфигураций.
