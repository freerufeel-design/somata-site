# Проверка Somata 11.0.2

Дата: 2026-10-29. Основа: 11.0.1 с оригинальным транспортом опорных точек из переданной рабочей 10.4. Запуск: локальный headless Chromium с Canvas2D, проверены исходные JavaScript-файлы. Отдельное аппаратное GPU/WebGPU-исполнение НЕ проверено.

## Новые тесты 11.0.2 — PASS

- `tests/v1102-high-angle-half-radius-no-hooks-regression.js`: три настоящие диаметральные орбиты N6/K3/S3, ни одной петли при 100% или 200%; двухточечный сплайн остаётся линией; высокий угол ограничен R/2; 200%-ное предварительное смещение тоже ограничено; обычное 90° скругление сохраняется.
- `tests/v1102-high-angle-radius-sweep-regression.js`: 48 сочетаний угла 138–180° и скругления 50–200%; проверяются не только точки начала скругления, но и **все промежуточные точки реальных Q/C кривых**. Для поворотов ниже 180° радиус закруглённого участка ≥109.5 при исходном R=220; при 180° никаких Q/C нет. Дополнительно воспроизведён и исправлен случай 140°/200%, где предсглаживание ранее снимало защиту R/2. PASS.
- `tests/v1102-rounding-morph-endpoints-regression.js`: 12 точных сравнений Canvas2D на начале и конце фаз, режимы topology/calm/circleSlide × segments/spline × оба направления 7/2 ↔ 6/3, в том числе при округлении до 200%. Порог средней разницы по контуру: <0.25 для точных концов, <3 для кадров t=0.0005/0.9995. Все 12 PASS.

## Повторные проверки наследия 10.4 — PASS

- `v1101-104-original-motion-regression.js`: 144 оригинальных трассы опорных точек + 72 нескруглённых пути.
- `v1101-104-flat-motion-regression.js`: 144 оригинальные трассы плоских профилей + 66 нескруглённых путей.
- `v1101-canonical-endpoint-pixel-regression.js`: 21 сочетание Static ↔ Morph, включая скругления и разные профили.
- `v110-blue-two-phase-authored-endpoints-regression.js`: 6 реальных двухфазных переходов.
- `v110-static-animation-exact-endpoint-regression.js`: 18 ручных анимаций.
- Пройдены также `v10419-36-live-horn-fillet-regression.js`, `v10419-36-rounded-segments-morph-static-handoff-regression.js`, `v10419-36-rounded-segment-monoradius-canonical-handoff-regression.js`, `v10419-38-monoradius-canvas-endpoints.js`, `v10419-43-full-profile-arc-rounding-regression.js`, `v10419-44-morph-dynamic-profile-joint-rounding-regression.js`, `v10419-42-live-spline-segment-bends-regression.js`, `v10446-closed-spiral-round-seams-regression.js`, `v10447-spline-seam-live-morph-parity-regression.js`, `v10448-whole-curve-spline-unified-regression.js`, `v10449-linear-rounded-polygon-morph-boundary-regression.js`, `v10457-topocircle-mode-legacy-seam-regression.js`, `v10461-topology-calm-two-real-phases-v19-regression.js`, `v10419-45-segment-spline-phase-and-corridor-regression.js`, `v75-rounding-immediate-morph-regression.js`, `v75-rounding-morph-stall-jump-regression.js`, `v924-rounding-continuity.js`, `v924-electro-rounding-stability.js`, `v9212-spiral-phase-finish-no-jump.js`, `v1045-blue-morph-frame-rules-regression.js`.

## Старые тесты, не прошедшие (не скрыты)

- `v10419-45-transient-cusp-continuity-regression.js`: ожидает двухкубическую гладкую *боковую U-петлю* на развороте 180°. В 11.0.1 PASS, в 11.0.2 FAIL **по дизайну**: теперь такой разворот рисуется без искусственной петли. Тест оставлен неизменным как зафиксированное противоречие старого поведения новому требованию.
- `v10419-42-asymmetric-short-spline-segment-fillet.js`: FAIL в 11.0.2, но та же ошибка `displacement=0` воспроизводится в неизменённой 11.0.1. Не является новой регрессией.
- `v10450-linear-rounded-topology-suborbit-handoff-regression.js`: FAIL с очень малым несовпадением `end=0.003999` в 11.0.2; исходная 11.0.1 даёт ту же ошибку `end=0.003999`. Не является новой регрессией.
- Прочие исторические ошибки, перечисленные в `RELEASE_VALIDATION_11_0_1.md`, автоматически данным коротким прогоном не устранены.

## Границы подтверждения

Не тестировалось физическое GPU/WebGPU на устройстве пользователя и все возможные комбинации сложных проектов/эффектов. Порог R/2 здесь — защита от **дополнительного скругления**, а не запрет исходной геометрии (например, диаметра) пересекать центр. Данная сборка не объявлена полностью безрегрессионной.
