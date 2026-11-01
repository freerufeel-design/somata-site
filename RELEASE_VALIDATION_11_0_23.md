# Somata 11.0.23 — протокол стабильности

## Область изменений

Версия создана на основе 11.0.22. Код линейной интерполяции Morph, фазового контроллера, исходных опорных точек, N/K и спирального транспорта побайтово не изменён. Из рабочего JavaScript изменён только `js/geometry/unified-fillet.js`. Также обновлены отображаемая версия, метки кэша в `index.html` и `manifest.webmanifest`.

Кубический отклик и его производная остались прежними. Общие произведения в расчёте входящих/выходящих производных вычисляются один раз, причём на событии скругления сохраняются требуемые противоположные односторонние знаки.

## Автоматические геометрические проверки (Node.js)

- `node tests/v1123-tangent-kernel-exact-parity.js`: **1845 точных совпадений** с сохранённым кодом версии 11.0.22 (сегментные и сплайновые профили, диапазон 0–200%, мини-рёбра, фазы, замкнутые и открытые кривые до 5000 точек).
- `node tests/v1123-subpixel-neighbor-stability-regression.js`: **1130** сравнений симметричного геометрического расстояния при малых сдвигах точек или базового радиуса и ограничителя. Максимальное измеренное расстояние **0,020752** единицы; порог теста **0,2**. Результат ограничен точностью дискретизации сравнения.
- `node tests/v1105-unified-fillet-overlay-regression.js`: 900 случайных случаев.
- `node tests/v1106-fillet-phase-stability-regression.js`: 351 сравнение.
- `node tests/v1107-mixed-micro-profile-continuity-regression.js`: 240 случаев.
- `node tests/v1111-radius-micro-phase-stress-regression.js`: 3995 пар.
- `node tests/v1111-low-radius-budget-phase-regression.js`: 3995 пар.
- `node tests/v1113-open-endpoint-spiral-fillet-regression.js`: 270 проверок.
- `node tests/v1114-partial-activation-tangent-regression.js`: 2374 проверки G1-сопряжений на 174 контурах.
- `node tests/v1116-radius-safety-sweep-regression.js`: 1000 случайных форм.
- `node tests/v1116-micro-edge-signed-guard-regression.js`: четыре сохранённых проблемных случая.
- `node tests/v1117-fast-radius-witness-parity-regression.js`: 420 совпадений.
- `node tests/v1121-arc-cursor-exact-parity.js`: 1845 совпадений со снимком 11.0.20.
- `node tests/v1122-signed-guard-exact-parity-regression.js`: 687 совпадений старого и ускоренного радиального ограничителя.

## Chromium (программная отрисовка, не аппаратный WebGPU)

- `node tests/v1107-k2-spiral-phase-browser-regression.js`: 24 случая N=4/K=2, 40/100/150/200%.
- `node tests/v1108-phase-gate-continuity-regression.js`: шесть сценариев × 23 состояния.
- `node tests/v1108-real-spiral-phase-regression.js`: восемь спиральных сценариев × 21 состояние.
- `node tests/v1113-real-open-spiral-browser-regression.js`: 60 проверок открытых спиралей.
- `node tests/v1114-live-morph-tangent-browser-regression.js`: 120 проверок касательности.
- `node tests/v10419-38-monoradius-primary-circle-fit.js`: PASS.
- `node tests/v10419-38-monoradius-canvas-endpoints.js`: PASS (12 сценариев).

**Известный сбой:** `node tests/v75-topology-monoradius-regression.js` сообщает `topology morph mode contract was lost`. Проверка воспроизводимо не проходит и на неизменённой 11.0.22; это не новая регрессия скругления, но также не исправленная проблема.

## Производительность

`node tests/v1123-tangent-benchmark.js` измеряет медианное время только построения геометрии в Node.js после прогрева. Например, на тестовой окружности из 5000 узлов: **121,0 мс → 102,9 мс**, волна 5000 узлов: **88,7 мс → 77,0 мс**. Замеры чувствительны к окружению, на некоторых профилях результат хуже. Это не частота кадров приложения.

## Ограничения

Нет гарантий строгой непрерывности кривизны G2 для всех самопересекающихся контуров. Аппаратный WebGPU и исходный сохранённый проект со скриншота не проверены. Производительность на особенно плотных спиралях всё ещё может давать задержки кадров. Изменение кода не является исправлением нового воспроизведённого скачка: в добавленных геометрических тестах скачков не обнаружено, а оптимизация сохраняет уже существующую форму.
