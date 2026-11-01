# Somata 11.0.6 — результаты проверки

База: Somata 11.0.5, алгоритмы исходных Morph-транспортов не изменены.

- PASS: v1106-fillet-phase-stability-regression.js (351 пары фаз/скругления, цикл, спираль, пила, микроузлы).
- PASS: v1105-unified-fillet-overlay-regression.js (900 конфигураций).
- PASS: v1105-unified-fillet-browser-regression.js (Chromium, monoradius, smooth spline setting).
- PASS: v1102-rounding-morph-endpoints-regression.js (12 кадровых сравнений).
- PASS: v1104-phase-edge-pixel-continuity-regression.js (12 фазовых границ).
- PASS: v1103-local-rounding-static-dynamic-regression.js.
- PASS: v10446-closed-spiral-round-seams-regression.js.
- PASS: v1106-spiral-closed-geometry-density-regression.js (сходимость проверок замкнутого сплайнового окончания при уплотнении выборки).
- PASS: sim-spiral-rounded-linear.js (18 вариантов; закрытая спираль Spline имеет старую погрешность сравнения по редким точкам, см. отдельную проверку 11.0.6).
- Ожидаемая несовместимость: v1104-bounded-rounding-no-ears проверяет *отсутствие команды C*, а новая архитектура генерирует кубические кривые. Пространственная проверка U-turn вместо этого — PASS.

Не проверено: аппаратный WebGPU на видеокарте и точный файл проекта со скриншота.
