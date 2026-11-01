# Проверки Somata 11.0.15 — Continuous Radius Fillets

База: 11.0.14. В рабочем JS изменён только `js/geometry/unified-fillet.js` (ограничитель внешнего радиуса); обновлены подписи версии в `index.html`, `manifest.webmanifest` и документации.

## Воспроизводимый дефект 11.0.14

`SOMATA_FILLET_SOURCE=/путь/к/11.0.14/js/geometry/unified-fillet.js node tests/v1115-continuous-radius-budget-regression.js`

**FAIL:** расстояние между соседними контурами при изменении допуска 11.6% → 11.8% составляло ~39.996 единицы. На том же фиксированном контуре построитель выбирал резко отличающиеся ширины скругления.

## Новая версия

`node tests/v1115-continuous-radius-budget-regression.js`

**PASS:** отклонение ~0.512 единицы; 36 сочетаний открытых/замкнутых фигур, уровней 25%, 100%, 200% и допусков 0–60% с микроскопическим движением точек; максимальное отклонение соседних состояний ~0.0000026 единицы. Свободные концы и оригинальные входные точки Morph неизменны. Ограничение внешнего радиуса соблюдено в проверенных конфигурациях.

## Повторные тесты после исправления

- `v1105-unified-fillet-overlay-regression.js`: PASS, 900 случайных профилей.
- `v1106-fillet-phase-stability-regression.js`: PASS, 351 сравнение фаз, швы и спирали.
- `v1111-radius-micro-phase-stress-regression.js`: PASS, 3995 соседних фаз.
- `v1111-low-radius-budget-phase-regression.js`: PASS, 3995 соседних фаз.
- `v1114-partial-activation-tangent-regression.js`: PASS, 174 профиля, 2374 касательных сопряжения.
- `v1113-open-endpoint-spiral-fillet-regression.js`: PASS, 270 проверок.
- `v1110-dense-morph-spiral-fillet-continuity.js`: PASS, контуры до 5000 точек.
- `v1110-radius-witness-equivalence-regression.js`: PASS, 125 вариантов.
- `v1114-live-morph-tangent-browser-regression.js`: PASS, 120 браузерных вариантов.
- `v1107-k2-spiral-phase-browser-regression.js`: PASS, 24 сценария N=4/K=2.
- `v1108-real-spiral-phase-regression.js`: PASS, 8 браузерных спиральных носителей × 21 фазовое состояние.
- `v1105-unified-fillet-browser-regression.js`: PASS, Canvas2D, MonoRadius 0–200%.

## Производительность

Локальный тест (только построитель, Node/V8, паттерн с 5000 плотными зубцами, медиана 3 прогонов): 11.0.14 — ~84.3 мс, 11.0.15 — ~86.4 мс. Целевая максимальная частота отрисовки такого паттерна на конкретных GPU **не измерялась**.

## Не проверено

Полная историческая батарея проекта, пользовательская конфигурация с исходного скриншота, реальный аппаратный WebGPU, строгая G2-непрерывность для каждой фигуры.
