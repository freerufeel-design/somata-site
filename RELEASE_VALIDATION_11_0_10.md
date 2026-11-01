# Somata 11.0.10 — фактический протокол проверок

## Новые регрессионные тесты

| Команда | Результат |
|---|---|
| `node tests/v1110-dense-morph-spiral-fillet-continuity.js` | PASS: 22 случая, квадрат из 1600/1601 точек при 6 уровнях, открытые/замкнутые спирали 1598–5000 точек; на коллинеарной вставке максимум 0,000007 геометрической единицы. |
| `node tests/v1110-radius-witness-equivalence-regression.js` | PASS: 120 сравнений быстрой и полной проверки радиуса по всем Bézier-командам, максимальная разница 0; ещё 5 случаев неизменности входных точек Morph. |

## Повторно пройденные геометрические и браузерные тесты

| Команда | Результат |
|---|---|
| `node tests/v1105-unified-fillet-overlay-regression.js` | PASS: 900 случайных фигур, радиусный предел, плавный переход через 100% |
| `node tests/v1106-fillet-phase-stability-regression.js` | PASS: 351 фазовая пара; max drift 0,0004 |
| `node tests/v1107-mixed-micro-profile-continuity-regression.js` | PASS: 240 микропрофилей, смешанные флаги, открытые/замкнутые спирали |
| `node tests/v1109-spiral-mapped-low-rounding-regression.js` | PASS: спираль с явными Bézier-контролями и одними касательными, на порогах максимум 0,00132 |
| `node tests/v1109-spiral-width-carrier-regression.js` | PASS: ширина спирали вдоль дуги, максимум отклонения 1,31e-9 |
| `node tests/v1108-phase-gate-continuity-regression.js` | PASS: 6 браузерных сценариев, 23 состояния |
| `node tests/v1108-real-spiral-phase-regression.js` | PASS: 8 реальных спиральных сценариев, 21 состояние, на границах максимум 0,0537 |
| `node tests/v1107-k2-spiral-phase-browser-regression.js` | PASS: 24 сценария N=4/K=2, поворот 167°, 40–200% |
| `node tests/v1105-unified-fillet-browser-regression.js` | PASS: Canvas2D, 0–200%, флаг дополнительного скругления сплайнов, MonoRadius |
| `node tests/v1104-phase-edge-pixel-continuity-regression.js` | PASS: 12 pixel-сравнений Static/Morph |
| `node tests/v1102-rounding-morph-endpoints-regression.js` | PASS: 12 Static/Morph N6/K3 |
| `node tests/v10446-closed-spiral-round-seams-regression.js` | PASS: замкнутый спиральный шов, 0% sharp |
| `node tests/v1108-zero-rounding-spline-regression.js` | PASS: 0–6% округления сплайнов (вся кривая и локальный режим) |
| `node tests/v1109-exact-bezier-blend-regression.js` | PASS: 96 пар точных Bézier-переходов |

Микробенчмарк одного вызова построителя для звёздчатого профиля из 5000 точек, 8 измерений после прогрева: медиана 15,0 мс для быстрого и 27,3 мс для полного поиска (одна машина, не FPS).

**Не заявляется:** полное тестирование аппаратного WebGPU, гарантированная G2 для произвольных самопересечений, полная историческая батарея и воспроизведение личного файла проекта со скриншота.
