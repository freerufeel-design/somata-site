# RELEASE VALIDATION — Somata 11.0.24

## Проверенный дефект

В Chromium на неизменённой базовой 11.0.23 `node tests/v1124-live-corner-angle-continuity.js` обнаружил скачок при 24,9999°→25,0001°: сумма абсолютных изменений альфа-канала **123,988 / 255**, 257 пикселей с изменением более 40 из 255. Причина — булево переключение дополнительного скругления при 25° в рендерере Morph. В исправленной версии новый тест прошёл **84** сравнений по порогам 15°, 25° и 30°, обычным/сплайновым профилям, открытым/замкнутым контурам и фазам у границ цикла. Максимальная сумма изменения в этом наборе — **14,078 / 255**, в основном из-за антиалиасинга. Сравнения выполняются при разнице угла 0,0002°.

## Проверки

- `node tests/v1124-live-corner-angle-continuity.js` — **PASS**, 84 браузерных сравнения.
- `node tests/v1124-fractional-fillet-g1-regression.js` — **PASS**, 180 контуров, 3466 G1-соединений, max 5,06e-7 градуса, свободные концы не изменены.
- `node tests/v1123-tangent-kernel-exact-parity.js` — **PASS**, 1845 точных совпадений булевого Bézier-построителя с прежним кодом.
- `node tests/v1105-unified-fillet-overlay-regression.js` — **PASS**, 900 случайных случаев.
- `node tests/v1106-fillet-phase-stability-regression.js` — **PASS**, 351 сравнение.
- `node tests/v1107-mixed-micro-profile-continuity-regression.js` — **PASS**, 240 случаев.
- `node tests/v1111-radius-micro-phase-stress-regression.js` — **PASS**, 3995 пар.
- `node tests/v1111-low-radius-budget-phase-regression.js` — **PASS**, 3995 пар.
- `node tests/v1113-open-endpoint-spiral-fillet-regression.js` — **PASS**, 270 случаев.
- `node tests/v1114-partial-activation-tangent-regression.js` — **PASS**, 2374 сопряжения.
- `node tests/v1116-micro-edge-signed-guard-regression.js` — **PASS**, 4 старых проблемных случая.
- `node tests/v1116-radius-safety-sweep-regression.js` — **PASS**, 1000 случайных фигур.
- `node tests/v1123-subpixel-neighbor-stability-regression.js` — **PASS**, 1130 пар.
- `node tests/v1108-phase-gate-continuity-regression.js` — **PASS**, 6 сценариев × 23 состояния.
- `node tests/v1108-real-spiral-phase-regression.js` — **PASS**, 8 сценариев × 21 состояние.
- `node tests/v1107-k2-spiral-phase-browser-regression.js` — **PASS**, 24 сценария N=4/K=2.
- `node tests/v1113-real-open-spiral-browser-regression.js` — **PASS**, 60 проверок.
- `node tests/v1114-live-morph-tangent-browser-regression.js` — **PASS**, 120 проверок.
- `node tests/v10419-38-monoradius-primary-circle-fit.js` — **PASS**.

## Производительность

Проверка браузерного рендера динамических углов `node tests/v1124-live-corner-benchmark.js`: на зубчатом контуре из 300 узлов медианное время **0,8 мс** (11.0.23) и **2,2 мс** (11.0.24). Это локальный CPU-бенчмарк только построения пути, не FPS приложения. Скругления плотных фигур требуют оптимизации без ущерба непрерывности.

## Изменённые рабочие модули

- `js/geometry/morph.js`: исключительно восстановление и плавная **отрисовка** динамических углов, без изменений движения и фаз.
- `js/geometry/unified-fillet.js`: дробные коэффициенты новых углов, прежние булевы флаги совместимы.

HTML-манифест/метки кэша обновлены на 11.0.24. Линейные интерполяторы, спиральный транспорт и фазовый контроллер побайтово не изменены.

**Известное ограничение:** старый `tests/v75-topology-monoradius-regression.js` не проходил и на 11.0.22–11.0.23; этот выпуск не исправляет отдельный контракт Topology/Монорадиуса. Строгая непрерывность G2, аппаратный WebGPU и конкретный проблемный сохранённый проект остаются непроверенными.
