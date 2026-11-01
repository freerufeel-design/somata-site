# Somata 11.0.22 — протокол проверок

## Изменение и инварианты

Из рабочего JavaScript изменён только `js/geometry/unified-fillet.js`. Не изменены исходные якорные координаты, их фазовый перенос, соответствия вершин, N/K и спиральный транспорт. Если локальный знаковый свидетель не позволяет гарантировать соблюдение радиального допуска, выполняется прежний полный расчёт. Это делает новую оптимизацию семантически безопасной — нет другой ветви построения формы.

## Подтверждённые проверки Node.js

- `node tests/v1121-arc-cursor-exact-parity.js`: **1845** точных совпадений с 11.0.20.
- `node tests/v1122-signed-guard-exact-parity-regression.js`: **687** точных совпадений с неизменённым построителем 11.0.21, в том числе **650** проверок с принудительным полным ограничителем, один сохранённый сценарий включения новой ранней проверки, контуры до **5000** точек.
- `node tests/v1105-unified-fillet-overlay-regression.js`: 900 случайных случаев.
- `node tests/v1106-fillet-phase-stability-regression.js`: 351 сравнение.
- `node tests/v1107-mixed-micro-profile-continuity-regression.js`: 240 проверок.
- `node tests/v1111-radius-micro-phase-stress-regression.js`: 3995 пар кадров.
- `node tests/v1111-low-radius-budget-phase-regression.js`: 3995 пар.
- `node tests/v1114-partial-activation-tangent-regression.js`: 174 кривых и 2374 G1-соединения.
- `node tests/v1117-fast-radius-witness-parity-regression.js`: 420 сравнений.
- `node tests/v1116-micro-edge-signed-guard-regression.js`: 4 сохранённых проблемных случая.
- `node tests/v1113-open-endpoint-spiral-fillet-regression.js`: 270 проверок концов открытого контура.
- `node tests/v1116-radius-safety-sweep-regression.js`: 1000 случайных фигур с ограничителем внешнего радиуса.

## Chromium с программной отрисовкой (`--disable-gpu`)

- `node tests/v1107-k2-spiral-phase-browser-regression.js` — 24 сценария N=4/K=2.
- `node tests/v1108-phase-gate-continuity-regression.js` — 6 сценариев × 23 состояния.
- `node tests/v1108-real-spiral-phase-regression.js` — 8 спиральных сценариев × 21 состояние.
- `node tests/v1113-real-open-spiral-browser-regression.js` — 60 проверок.
- `node tests/v1114-live-morph-tangent-browser-regression.js` — 120 проверок.

## Производительность и ограничения

На конкретном сохранённом сценарии (53 точки, допуск 30%) локальная медиана отдельного расчёта снизилась приблизительно с 0,217 до 0,143 мс в Node.js. **Это не универсальное ускорение и не FPS**: проверка включается редко, а некоторые контуры почти не ускоряются или могут оказаться немного медленнее. Геометрическая модель не менялась, поэтому эта версия не устраняет неизвестные исходные скачки. Реальный сохранённый проблемный проект и аппаратный WebGPU не проверялись.
