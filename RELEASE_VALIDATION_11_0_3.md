# Проверка Somata 11.0.3

Дата: 2026-10-29. Основа: неизменённый проект 11.0.2 плюс локальное исправление `limitHighTurnExtraKnotSmoothing`, обновление номера версии и новый тест.

## Новая воспроизводимая проверка

- Один почти развёрнутый угол в 10-узловом контуре ранее обнулял дополнительное сглаживание **всех 10 узлов**. Теперь угловой ограничитель действует на три соседних узла, шесть дальних точек сохраняют >95% рассчитанного сглаживания.
- 12 промежуточных кадров: статическое и анимированное построение совпали по пикселям в трёх режимах (circleSlide, topology, calm) при 35%, 90%, 130%, 190% (при одинаковом радиальном промежуточном состоянии N=8/K=1/R≈277.5, поворот 440.1°).
- 3 промежуточных смены топологии N/K содержат реальные кривые скругления, включая N=6/K=3 → N=8/K=1.
- 1 реальный переход редактора «Геометрия → Анимация», 7/1 → 8/1, при скруглении 165%: параметр скругления остаётся 165%, построитель выдаёт округлённые углы в середине фазы.
- Проверка безопасности прежнего правила R/2 и защиты 180°: 48 сочетаний угла и скругления прежнего теста — PASS.

## Выбранный регрессионный прогон

25/25 скриптов завершились успешно (код возврата 0):

- `v1103-local-rounding-static-dynamic-regression.js` — PASS
- `v1102-high-angle-radius-sweep-regression.js` — PASS
- `v1102-high-angle-half-radius-no-hooks-regression.js` — PASS
- `v1102-rounding-morph-endpoints-regression.js` — PASS
- `v1101-104-original-motion-regression.js` — PASS
- `v1101-104-flat-motion-regression.js` — PASS
- `v1101-canonical-endpoint-pixel-regression.js` — PASS
- `v110-blue-two-phase-authored-endpoints-regression.js` — PASS
- `v110-static-animation-exact-endpoint-regression.js` — PASS
- `v10419-44-morph-dynamic-profile-joint-rounding-regression.js` — PASS
- `v10419-43-full-profile-arc-rounding-regression.js` — PASS
- `v10419-36-rounded-segments-morph-static-handoff-regression.js` — PASS
- `v10419-36-rounded-segment-monoradius-canonical-handoff-regression.js` — PASS
- `v10419-40-rounded-mixed-spline-contours-regression.js` — PASS
- `v10419-41-terminal-spline-horn-continuity-regression.js` — PASS
- `v10419-45-segment-spline-phase-and-corridor-regression.js` — PASS
- `v10449-linear-rounded-polygon-morph-boundary-regression.js` — PASS
- `v10446-closed-spiral-round-seams-regression.js` — PASS
- `v10447-spline-seam-live-morph-parity-regression.js` — PASS
- `v10448-whole-curve-spline-unified-regression.js` — PASS
- `v1045-blue-morph-frame-rules-regression.js` — PASS
- `v924-rounding-continuity.js` — PASS
- `v9212-spiral-phase-finish-no-jump.js` — PASS
- `v75-rounding-immediate-morph-regression.js` — PASS
- `v75-rounding-morph-stall-jump-regression.js` — PASS

## Известные ограничения, не скрыты

- Тест `v10419-45-transient-cusp-continuity-regression.js` исторически ожидает боковую U-петлю при 180°. После требования убрать петли он не должен использоваться как эталон нового построения. Его ожидание не переписано.
- Унаследованные расхождения `v10419-42-asymmetric-short-spline-segment-fillet.js`, `v10450-linear-rounded-topology-suborbit-handoff-regression.js` и другие старые эталоны подробно перечислены в `RELEASE_VALIDATION_11_0_2.md` / `RELEASE_VALIDATION_11_0_1.md`; они не заявлены исправленными.
- Прогон был выборочным, не 100% тестового каталога. Реальная видеокарта/WebGPU, все сложные эффекты и точная `.plist`-сцена пользователя не тестировались.
- Изменение адресно исправляет исчезновение **дополнительного скругления выше 100%** от глобального ограничителя. Случаи с другими типами кривизны или графическими backend-эффектами могут требовать отдельной диагностики.
