# Somata 11.0.8 — протокол тестирования

| Проверка | Результат |
|---|---|
| `node tests/v1108-phase-gate-continuity-regression.js` | PASS: 6 браузерных сценариев × 23 значения фаз; статическое совпадение в 0 и 1; рядом с прежними порогами максимум среднего пиксельного расхождения 0.01835 из 255 на пиксель |
| `node tests/v1108-zero-rounding-spline-regression.js` | PASS: spline и whole-spline, 9 значений в 0–6%; на пороге старого алгоритма максимальное расстояние между контурами 0.663 условной единицы (численная дискретизация включена) |
| `node tests/v1108-real-spiral-phase-regression.js` | PASS: 8 реальных спиральных GPU carrier-сценариев × 21 фазовое значение, открытые/закрытые, segments/spline, 50/175%; максимальное измеренное смещение в наборе близких к границам фаз 0.0537 единицы |
| `node tests/v1107-k2-spiral-phase-browser-regression.js` | PASS: 24 сочетания N=4, K=2, поворот 167°, segments/spline, три режима Morph, 40–200%, совпадение с Static на точных границах |
| `node tests/v1107-mixed-micro-profile-continuity-regression.js` | PASS: 240 геометрических случаев мини-профилей |
| `node tests/v1106-fillet-phase-stability-regression.js` | PASS: 351 сравнение фаз/радиусов |
| `node tests/v1105-unified-fillet-overlay-regression.js` | PASS: 900 псевдослучайных конфигураций |
| `node tests/v1105-unified-fillet-browser-regression.js` | PASS: диапазон 0–200%, Монорадиус, включаемое скругление сплайнов |
| `node tests/v1104-phase-edge-pixel-continuity-regression.js` | PASS: 12 пар границ Static/Morph |
| `node tests/v1102-rounding-morph-endpoints-regression.js` | PASS: 12 Static/Morph границ |
| `node tests/v10446-closed-spiral-round-seams-regression.js` | PASS: закрытая спираль и ползунок округления её стыка |
| `node tests/v1106-spiral-closed-geometry-density-regression.js` | PASS: сходимость приближённого Hausdorff для спирального spline |
| `node tests/sim-spiral-rounded-linear.js` | Выполнен: 18 конфигураций реального спирального носителя, без JS-исключений. Сравнение концов сложных закрытых spline зависит от плотности дискретизации. |

Не проверены реальная видеокарта/WebGPU пользователя, его конкретный файл проекта и математически строгая G2 непрерывность для всех самопересекающихся контуров. Проверки не являются доказательством отсутствия артефактов для любой возможной фигуры.
