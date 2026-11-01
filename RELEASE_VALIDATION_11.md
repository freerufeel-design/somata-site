# Somata 11.0.0 — отчёт о регрессионных проверках

Дата: 2026-10-29. Основа: `Somata_10.4.19.36_Mixed_Profile_Phase_Handoff_Simulation_Fix.zip`.

## Новые обязательные проверки

- `v110-blue-two-phase-authored-endpoints-regression.js` — PASS. Шесть сцен: Topology, Calm, Circle Slide × Segments/Spline, с реальным завершением Blue-фазы и запуском следующей. Расхождение `last frame → first frame` и `first frame → Static` в проверенных сценах составило **0** средних единиц alpha на пиксель.
- `v110-static-animation-exact-endpoint-regression.js` — PASS. 18 сценариев ручных изменений: 3 режима × 2 профиля × изменение процента скругления / узлов / N+K. Проверены t=0, t≈0, t≈1, t=1 и первый неподвижный кадр. Все проверки имеют среднюю alpha-разницу <0.08 и полностью завершаются.
- Проверка синтаксиса: `node --check` для всех production JavaScript-модулей — PASS.

## Существующий быстрый набор

Был выполнен исходный быстрый набор из **115** тестов, который существовал на момент начала прогона (два новых теста проверены отдельно): **105 PASS / 10 FAIL / 0 TIMEOUT**.

Все 10 падений были воспроизведены *также на нетронутом исходном каталоге* `Somata_10.4.19.36`, до изменений версии 11:

| Тест | Состояние в исходном архиве | Результат v11 |
|---|---|---|
| `v904-settings-fill-diagnostics-regression.js` | FAIL: default playlist visibility | FAIL: то же |
| `v9010-spiral-closure-cubic-ranges-regression.js` | FAIL: closed spiral expected | FAIL: то же |
| `v8210-dynamic-optical-live-scene-regression.js` | FAIL: ожидаемый старый релиз в HTML title | FAIL: то же |
| `v102-corridor-spiral-order-monoradius.js` | FAIL: explicit order 0 must initiate collapse + repopulation | FAIL: то же |
| `v10434-profile-curvature-ui-timeline-regression.js` | FAIL: Polygon final curvature not controlled by UI schedule | FAIL: то же |
| `v10458-circle-27-probe.js` | FAIL: hash-эталон 10.4.19.27 | FAIL: то же |
| `v10458-circle-ui-27-parity-regression.js` | FAIL: pixel reference 10.4.19.27 | FAIL: то же |
| `v10459-topology-calm-reference19-regression.js` | FAIL: reference 10.4.19.4 | FAIL: то же |
| `v10460-topology-calm-v19-anchor-drawing-regression.js` | FAIL: spline draw trace reference | FAIL: то же |
| `effect-render-impact.js` | FAIL: Spiral seam control impact | FAIL: то же |

Это **не** означает, что старые проблемы исправлены: они остаются известными ограничениями. Для нового исправления не выявлено дополнительных красных проверок. Не обновлялись исторические эталоны и не удалялись падающие тесты.

## Отдельная проверка сохранения движения

Дополнительно пройдены тесты: `v10481-preserve-morph-anchor-motion.js`, `v10461-topology-calm-two-real-phases-v19-regression.js`, `v10457-topocircle-mode-legacy-seam-regression.js`, `v10419-45-segment-spline-phase-and-corridor-regression.js`, `v10419-44-morph-dynamic-profile-joint-rounding-regression.js`, `v10419-43-full-profile-arc-rounding-regression.js`, `v10419-38-monoradius-canvas-endpoints.js`, `v10419-38-monoradius-primary-circle-fit.js` и другие из набора. Они подтверждают сохранение основных путей морфинга в проверенных сценариях.

**Ограничения проверки:** Chromium headless в режиме Canvas2D (`disableGpu:true`). Аппаратный WebGPU, пользовательские `.plist` с неизвестными сочетаниями эффектов, а также производительность на целевом устройстве не проверены. Выполнен реальный запуск кода в браузерном тестовом окружении, а не только статический анализ.
