# Somata 11.0.9 — протокол проверки

Новые тесты действительно запускались с установленным Chromium. Геометрия проверялась по точкам Bézier, а не по флагу успешного запуска.

| Команда | Результат |
|---|---|
| `node tests/v1109-spiral-mapped-low-rounding-regression.js` | PASS: mapped-control и tangent-only спирали, два набора флагов, 12 уровней округления. Пример в 11.0.8 имел скачок примерно 13.006 единицы при .001; в 11.0.9 максимум у исследованных порогов .001 и .12 — 0.00132 единицы. |
| `node tests/v1109-spiral-width-carrier-regression.js` | PASS: неравномерные рёбра и widthScale. Максимальное отклонение widthScale на переходах 0, .001 и .12 — 1.31×10^-9. |
| `node tests/v1109-exact-bezier-blend-regression.js` | PASS: 96 различных пар кривых (от 2 до 25 против 4–50 кубик), без NaN/Infinity. Отклонение геометрии на концах перехода <= 0.03 в пределах точности используемой выборки; на малом смешивании 10^-6 — <= 3.51×10^-5. |
| `node tests/v1108-zero-rounding-spline-regression.js` | PASS: обычные и whole spline, 0–6%. |
| `node tests/v1108-phase-gate-continuity-regression.js` | PASS: 6 браузерных сценариев × 23 состояния, совпадение на точных концах Morph. |
| `node tests/v1108-real-spiral-phase-regression.js` | PASS: 8 сценариев реального спирального носителя × 21 состояние, открытый/замкнутый режим, segments/spline, 50/175%; на краях максимальное отклонение 0.0537 единицы. |
| `node tests/v1107-k2-spiral-phase-browser-regression.js` | PASS: 24 браузерных сценария N=4/K=2, поворот 167°, 3 режима Morph, profiles segments/spline, 40–200%. |
| `node tests/v1107-mixed-micro-profile-continuity-regression.js` | PASS: 240 геометрических проверок коротких мини-профилей. |
| `node tests/v1106-fillet-phase-stability-regression.js` | PASS: 351 фазово-геометрическое сравнение. |
| `node tests/v1105-unified-fillet-overlay-regression.js` | PASS: 900 псевдослучайных геометрических случаев. |
| `node tests/v1105-unified-fillet-browser-regression.js` | PASS: 0–200%, галочка скругления сплайнов, MonoRadius. |
| `node tests/v1104-phase-edge-pixel-continuity-regression.js` | PASS: 12 пар Static/Morph. |
| `node tests/v1102-rounding-morph-endpoints-regression.js` | PASS: 12 Static/Morph с N=6/K=3. |
| `node tests/v10419-38-monoradius-canvas-endpoints.js` | PASS: 12 сценариев MonoRadius. |
| `node tests/v10419-38-monoradius-primary-circle-fit.js` | PASS: статический, Morph и подготовленный MonoRadius. |
| `node tests/v10446-closed-spiral-round-seams-regression.js` | PASS: швы замкнутых спиралей, 0% = sharp. |

Всё вышеперечисленное прошло; полную многосотенную историческую тестовую батарею не запускали. Аппаратный WebGPU и конкретный проект пользователя не проверялись.
