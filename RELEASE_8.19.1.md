# Somata 8.19.1 — Corridor → Blue Morph startup warmup

**База:** Somata 8.19.0 (Blue Morph × Palette Lag). **Тип:** снижение однократных GPU-выделений и конкуренции компиляций при первом запуске Corridor и Blue Morph. Без изменений художественной математики, интерфейса параметров, порядка эффектов или цветовой маршрутизации.

## Изменения

1. `WebGPUStrokeRenderer.prewarmCorridorCopies()` резервирует кольцо из GPU-буферов для **до 256** копий Corridor (по 16 `float32` на копию и буфер). Буферы заполняются только штатным пакером во время реального кадра — никаких искусственных копий и изменений цветов нет. Подготовка запускается после получения WebGPU device, в свободное время, и не выполняется при потере устройства.
2. Ранее единый boot-warmup запускал большой набор независимых GPU pipeline почти одновременно сразу после получения `GPUDevice`. Теперь на старте готовятся обязательные Stroke/Final, а дополнительные Spiral Bézier Blue Morph, Topology, Sweep, Web/Graffiti/Lightning/Particle и другие pipeline распределены по нескольким idle-turns.
3. Когда Corridor уже активен, второстепенный прогрев продолжается **только при наличии свободного бюджета idle** (порог 8 мс), чтобы подготовить Blue, не отнимая обязательные кадры Corridor. При активном Blue прогрев остальных pipeline приостанавливается, затем возобновляется.
4. `window.__somataStartupModeWarmupStatus()` показывает `stage`, `completed` (этапы прогрева запущены, не обязательно все асинхронно завершены), `corridorRingReady` и `error`. Отсутствие аппаратного WebGPU не препятствует Canvas/WebGL fallback.

## Проверка

```bash
node tests/v8191-startup-mode-warmup-regression.js
node tests/v819-blue-palette-lag-stability-regression.js
node tests/v71116-orange-routing-palette-stop-corridor-regression.js
node tests/v818-solo-orange-graffiti-regression.js
```

`v8191` проверяет защиту раннего выделения, кап на 256 копий, отсутствие выделения после потери device, порядок GPU-acquire и реальный сценарий включения Corridor → Blue Morph → выключения в браузере без аппаратного GPU. Дополнительно выполнена проверка синтаксиса всех **103 production JS** (PASS), `static-modules.js` (PASS), `v8100-gpu-buffer-fence-coalescing-regression.js` (PASS), `v7912-corridor-palette-routing-signed-speed-regression.js` (PASS), `v818-graffiti-solo-line-warmup-regression.js` (PASS).

## Ограничения

* При немедленном нажатии Play после перезагрузки idle-prewarm может ещё не закончиться; в этом случае действует прежняя безопасная инициализация при первом использовании.
* Подготовка уникальных целевых профилей и геометрии `prepareMorphCycle()` остаётся синхронной: возможную CPU-просадку при тяжёлой сцене этот релиз **ещё не устраняет**.
* Тесты без WebGPU не измеряют реальное время компиляции шейдеров, визуальную идентичность GPU-пикселей или аппаратный p95 FPS. Для окончательного подтверждения нужен сценарий на NVIDIA/другой целевой карте.

## Изменено

- `js/app/geometry-gpu-core.js` — GPU ring prewarm и staged startup pipeline warmup;
- `index.html`, `manifest.webmanifest` — версия / cache-busting;
- `tests/v8191-startup-mode-warmup-regression.js` — регрессионная проверка;
- `RELEASE_8.19.1.md` и `tests/README.md` — описание и ограничения.
