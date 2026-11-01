# Somata 12.6.7 — Phase Boundary Handoff Fix

Дата: 31 октября 2026.

## Причина и решение

У Spiral Blue Morph при смене Shape вместе с N/K на границе фаз заново подготавливался renderSource из authored state и paired profile. Геометрия первого кадра новой фазы могла отличаться от последнего renderTarget старой фазы, хотя rotation, N/K и profileNodes совпадали. Из-за этого происходил дискретный сдвиг/поворот видимого профиля.

Правка локальная, только в `js/app/ui-project-runtime.js`. Последний `renderTargetLayers` для Spiral сохраняется при commit и передаётся ровно на один следующий `prepareMorphCycle`. Передача разрешена только для того же слоя, той же Spiral топологии и параметров N/K, radius, rotation, rounding, spiralOrder/step, замыкания, касательности, режима профиля и тех же координат профиля. Новый целевой профиль и авторская математика Morph не меняются; на следующем цикле снимок удаляется. При остановке Morph ссылка сбрасывается.

## Измеренное воспроизведение

Реальная кнопка Blue Morph, Spiral с `byShape=true`, `byVertices=true`, `bySteps=true`, `byRotation=false`, пять последовательных границ фаз. Сравнивалась альфа 520x520 Canvas2D-растров подготовки точных GPU Bézier rail, метрика: средняя абсолютная разница альфы по активным пикселям.

| Переход | Исходный 12.6.6 | Исправленный 12.6.7 |
|:--|--:|--:|
| 1 | 133.98 | 8.97 |
| 2 | 130.16 | 8.36 |
| 3 | 66.59 | 0.00 |
| 4 | 127.91 | 0.00 |
| 5 | 79.89 | 2.30 |

Все пять переходов соответствуют порогу <12. Сохранены N/K, rotation, профильные узлы. Это фиксирует GPU-подготовку/геометрию, **не** является сравнением аппаратных пикселей NVIDIA и не подтверждает FPS.

## Выполненные проверки

- `node tests/v1267-spiral-live-phase-handoff-regression.js` — PASS, 5/5.
- `node tests/v1266-live-profile-single-prep-regression.js` — PASS, 6/6, эталонные хэши сохранены.
- `node tests/v1265-spiral-exact-fast-parity.js` — PASS, 1 456 конфигураций и 3 461 856 совпадающих координат.
- `node tests/v1265-spiral-gpu-exact-browser.js` — PASS, 126 случаев.
- `node tests/v1262-visible-phase-seam-browser-regression.js` — PASS, 210 случаев.
- `node tests/v1262-cyclic-reindex-geometry-regression.js` — PASS, 540 случаев.
- `node tests/v110-blue-two-phase-authored-endpoints-regression.js` — PASS.
- `node tests/v10419-39-blue-spiral-ui-parity-regression.js` — PASS.
- `node tests/v10461-topology-calm-two-real-phases-v19-regression.js` — PASS.

Полный интеграционный suite не заявляется пройденным; аппаратный WebGPU/GPU FPS на целевой машине не проверен. Известные ошибки регистрации модулей в прежних `static-modules.js` и `browser-preflight.js` не относятся к этому исправлению и в данной сборке не менялись.
