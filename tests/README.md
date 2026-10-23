# Somata 9.0.7 — тесты текущей версии

Тесты **восстановлены** из полной Somata 9.0.3, а не из пакета 7.x. Приложение и три плейлиста остаются неизменными. Исторические имена файлов сохранены: они указывают, когда появилась регрессия, а не какую версию надо жёстко требовать.

## Запуск

Из корня программы при установленном Node.js и Chromium:

```sh
node tests/run-all.js       # короткий актуальный набор: UI → состояние → геометрия → GPU preparation → scheduler
node tests/run-extended.js  # все регрессии, кроме микробенчмарков и soak; может выполняться долго
node tests/run-v9.js --full --bench  # включить микробенчмарки
node tests/stability-soak.js # долгий stress: запускать отдельно
```

Каждый тест выполняется на файлах **этого же каталога Somata 9.0.5**; исключён глобальный timeout 7.x, который останавливал длинный набор раньше завершения. По умолчанию timeout на отдельный тест — 35 секунд; на медленном ПК можно задать `SOMATA_TEST_TIMEOUT_MS=60000`. Ошибка или timeout дают ненулевой код выхода. Тесты нельзя объявлять зелёными из-за исключения из `run-all`.

## Актуальная последовательность проверки

1. Статическая целостность production JS и порядок загрузки (`static-modules`, `browser-preflight`).
2. TAP Tempo Lock, тишина, ложные 64/256 BPM и реальное управление (`v900-*`, `v7123-*`).
3. Список проектов/Green Morph и автоматическая смена сцен (`v902-*`).
4. Corridor, множитель глубины, реальный UI и молния без предварительного проблеска (`v901-*`).
5. Согласованность Parameter Matrix, Blue/Orange, Audio и Master (`v7122-*`, `orange-family-pools`).
6. Один геометрический контур Static/Morph, точная retained Spiral, carrier для Web/Lightning (`v762-*`, `v763-*`, `v770-*`, `v779-*`).
7. GPU-pass fault injection **через SomataRenderPassRegistry**, а не замену `globalThis` после регистрации (`v75-spiral-effect-fault-recovery`).
8. Динамическое optical-scene capture, Ambients и лимиты GPU-кэшей (`v8210-*`, `v8214-*`, `v7117-*`).
9. Полный `run-extended` и долгий soak на релизном архиве.

## Изменения в тестах относительно 9.0.2 до уборки

- `v768` больше не требует заголовка `7.7.x` и старого cache-busting токена; поколение GPU и восстановление retained ресурсов остаются обязательными.
- `v770` больше не требует SHA256 исходников 7.5 при функционально изменённом Web GPU; теперь проверяются реальные shader/encoder/bridge contracts и отказ от generic geometry вместо точной Spiral.
- `v765`, `v7612` больше не требуют фиксированных исторических строк версии во внутренних diagnostics; точность Bézier, copy-alpha и reuse остаются обязательными.
- `v778`, `v773` не используют количество строк как измерение модульности и отличают readiness guard от прямого вызова GPU renderer в main pipeline.
- `v783`, `v779-lightning` различают авторский `default.plist` и сохранённый `STANDARD_ORIGINAL_23_PROJECTS.plist`; художественные настройки нового плейлиста не обязаны совпадать с 7.x.
- `v8210` проверяет cache-busting 9.0.2 вместо `8.20.14`.
- `v71116` учитывает плавную интерполяцию цветов Corridor и сохраняемую alpha, а не старую форму строкового шаблона.
- `orange-family-pools`, `runtime-user-actions` используют актуальные Orange profile/pool controls; скрытый `minimalMorphMode` не считается пользовательским UI.
- `v75-checkbox-functional-coverage` ищет *живые*, а не удалённые после UI rerender DOM-узлы; один родительский Shape-контрол проверяется отдельными сценариями Orange routing.
- `v75-spiral-effect-fault-recovery` действительно внедряет ошибки в зарегистрированные `web / lamps / sweep / particles / base` passes и проверяет изоляцию, продолжение scheduler, новые кадры и progress Morph.

## Итог полного тестирования 9.0.3 (23.10.2026)

- `run-all.js`: **19 PASS / 0 FAIL / 0 TIMEOUT**.
- `run-extended.js`: **215 PASS / 1 FAIL / 0 TIMEOUT** из 216 тестов.
- Единственное падение в полном прогоне — `v75-rounding-morph-stall-jump-regression.js`: после блокировки главного потока на 240 мс ошибка совпадения progress Morph с wall clock вышла за предел 0.035 (наблюдалось 0.0383). При отдельном повторном запуске тест прошёл (ошибка 0.033). Тест оставлен строгим и обязательным: воспроизводимость зависит от нагрузки; причина не исправлена.
- `runtime-user-actions.js`: **12/12 PASS**. Тест Orange Mandala обновлён для семантики v8.19.3: каталог/пулы определяют кандидатов, но активными значениями слоёв владеют только явно подключённые Orange routes.
- `v8201-prism-legibility-regression.js`: использует реальный 2D overlay для отключённого GPU; физические пиксели 3D WebGPU этим тестом не проверяются.
- User-reported неработающая молния на NVIDIA и задержки Spiral требуют отдельного аппаратного воспроизведения, общий PASS тестов не является их опровержением.

## Пределы проверки

Node/Chromium проверяет действия UI, состояние, finite geometry и подготовку GPU-команд, но не доказывает итоговые пиксели на физическом WebGPU/NVIDIA. Синтетический аудиотест не доказывает устойчивость TAP на любых реальных breakdown. Для спорных визуальных случаев аппаратный результат важнее headless PASS.

Новые баги сначала добавляются воспроизводимым тестом. Код приложения и существующие плейлисты нельзя менять только ради прохождения исторического буквального сравнения исходников.

## Версия 9.0.3 — «Анимация» в статике

- Галочка **Анимация** сама по себе не запускает повторяющийся геометрический Morph и не добавляет активную задачу в scheduler.
- После редактирования поддерживаемого параметра геометрии запускается **один конечный переход** от предыдущего видимого состояния к новому; затем задача удаляется и геометрия остаётся неподвижной.
- Структурные изменения обычного многоугольника используют существующий Blue fade carrier; Spiral не переводится в приближённую CPU-геометрию. Для топологической перестройки strict Spiral остаётся дискретный переход; непрерывная GPU-интерполяция топологии не добавлялась.
- `v903-static-edit-animation-regression.js`: настоящий клик/редактирование радиуса/N, проверка 5 секунд покоя, финальной геометрии и отсутствия конкуренции с Morph.
- `v903-static-animation-render-impact.js`: реальный рендер и проверка планировщика.
- `v8200-ambient-prism-test-morph-corridor-regression.js`: вместо устаревшей постоянной анимации проверяет изменение после редактирования.
- `v8201-prism-legibility-regression.js`: проверяет 2D optical fallback в Chromium без аппаратного GPU; реальные WebGPU-пиксели этим тестом **не** сертифицируются.
- `runtime-user-actions.js`: Mandala проверяется как выбранный генератор кандидатов с соблюдением нового Orange parameter-routing контракта (v8.19.3), без ожидания безусловной замены каждого свойства и имён слоёв.

Режимы Blue/Orange/Green, автоматический TAP и эффектовые анимации существуют отдельно от этой галочки. Полный регрессионный запуск по-прежнему обязателен перед релизом.


## Версия 9.0.4 — проверка настроек, GPU Fill и переходов

- `v904-settings-fill-diagnostics-regression.js`: дефолты меню как на пользовательском образце, сохранение COSMIC и стандартных плейлистов, попадание отказов GPU Fill во встроенную консоль, отсутствие самоперерисовки при `gpu-only`/`ordered-fill` FAIL.
- `v904-static-animation-blue-types-regression.js`: пять типов статических переходов, наследование общих Blue геометрических исполнителей для обычных форм и reuse подготовленных endpoint данных на нескольких кадрах.
- `v904-strict-spiral-static-edit-regression.js`: точная Spiral без прыжка при смене N: fade-out → смена топологии в нулевой непрозрачности → fade-in; по-прежнему не полноценная retained GPU интерполяция топологии Blue.

Физический FPS на NVIDIA и исправление конкретного GPU Fill backend failure **не подтверждены** тестами без аппаратного WebGPU. Не отмечать это как PASS без проверки устройства.

## Версия 9.0.5 — Spiral Animation / Corridor / Fill GPU warming

- `v905-spiral-static-control-corridor-idle.js`: точное совпадение шести вариантов Spiral с меню Blue; выбор только в Spiral; сохранение опции; статический переход без самопроизвольного движения; Corridor при нулевой скорости не инициирует лишние GPU-перерисовки.
- `v905-fill-gpu-warmup-lifecycle.js`: `GPU Fill` различает асинхронную инициализацию (mask доступен, но 0×0, native ещё инициализируется), успешный запуск и настоящий отказ.

**Ограничение:** статическая анимация Spiral при структурных изменениях пока переключает две точные GPU-формы через Fade; сама визуальная интерполяция всех шести Blue Spiral transport ещё не перенесена. Тест намеренно не объявляет её полной реализацией.


## Версия 9.0.6 — источники ударов молнии

`v906-lightning-trigger-routing-regression.js` проверяет реальное изменение селектора в шапке «Молния», сохранение параметра `lightningTriggerMode` в конфигурации слоя и трёхвариантную маршрутизацию часов:

- `timer` — независимый таймер даже при работающем Morph и проблеске;
- `morph` (по умолчанию) — Glint при включённом проблеске, иначе Blue/Orange Morph при его активности, иначе таймер;
- `glint` — строго по завершению оборота проблеска, без удара при выключенном проблеске и без импульса при первом включении;
- контроль 120 BPM/8 долей/цикл = 4 секунды и отсутствия преждевременного удара.

И `lightningActiveCycleFraction`, и GPU/CPU-обработчик удара используют длительность выбранного источника, чтобы не разрывать длительности свечения и геометрию на разных проходах. Legacy проекты без `lightningTriggerMode` используют режим `morph`.


## Версия 9.0.7 — устранена блокировка WebGPU Lightning

- `v907-lightning-gpu-encode-regression.js` сначала исполняет фактическую функцию адаптера GPU с контролируемым готовым backend. Раньше она вызывала `prechargeAsGlow` (удалён после удаления предварительного проблеска) и завершалась `ReferenceError`, несмотря на успешные тесты GPU preparation. Теперь адаптер передаёт только пять допустимых аргументов.
- Тот же сценарий нажимает checkbox молнии в браузере, выбирает таймер через UI и проверяет непустой план `strike`.
- Без аппаратного WebGPU проверка не подтверждает физические пиксели на NVIDIA.


## 9.0.8 — GPU queue stall protection

- `v908-gpu-stall-backpressure-regression.js`: real recycler implementation in a VM with an unresolved GPU fence, 1 MiB/frame retirement, one outstanding completion promise, no destruction of submitted buffers, 96 MiB frame-backpressure threshold, safe recovery after fence completion and GPU generation rollover.
- A `renderMainCanvas` call under recycler pressure is skipped **before** geometry/GPU frame preparation; Morph time keeps advancing via scheduler and repaint is requested when the fence resolves.
- GPU frame governor avoids ×4–×8 retention and ×3 capacity growth if GPU timings identify a GPU bottleneck.
- WebGPU DeviceHub postpones recovery after device loss and stops automatic retries after repeated failures.
- These are simulated GPU tests, **not** an NVIDIA VRAM measurement or a physical 2-hour soak. Keep physical GPU validation mandatory.

- `v908-device-loss-circuit-regression.js`: repeated device loss cooldown, circuit breaker and general WebGPU queue watchdog with a deliberately unresolved fence.
