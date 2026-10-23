# Somata 8.20.8 — WebGPU scene capture fix for 3D optical glass

Дата: 22.10.2026. Основа: чистая распаковка поставленного `Somata_8.20.7_webgpu_glass_optics_shader_fix.zip`.

## Воспроизведённая ошибка

Пользовательский лог содержит многочисленные `[Somata WebGPU uncaptured] Destination texture needs to have CopyDst and RenderAttachment usage.` (160 повторений в переданном фрагменте). 3D-фигура отображается, статус показывает «сцена подключена», но текстура фона не поступает в оптический WebGPU pass и результат выглядит тёмным/непреломляющим.

Причина в `js/app/prism-3d-layer.js`, функция `uploadScene`: входная `rgba8unorm` текстура для `device.queue.copyExternalImageToTexture` создавалась с флагами `GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST` — без обязательного `GPUTextureUsage.RENDER_ATTACHMENT`. WebGPU/Dawn отвергает копирование. Так как это GPU validation error, она не обязана бросать синхронное исключение в JS; поэтому ранее `sceneUploaded=true` ошибочно показывал успешную загрузку.

## Исправление

Изменён только контракт создания текстуры при сохранении существующего WebGPU пайплайна:

`GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT`

Геометрия, оптический WGSL, два прохода Snell sphere, UI, Blue/Orange/Green Morph, Corridor и сохранённые пользовательские данные не изменялись. Версии ссылок JS/CSS/manifest в `index.html` обновлены до 8.20.8.

## Регрессия и результат

- НОВЫЙ `node tests/v8208-webgpu-scene-copydst-renderattachment-regression.js`: **FAIL на исходной 8.20.7** (не загружается фон), **PASS после изменения** (два последовательных реальных scene uploads с обязательными GPU usage битами; не используется однотонная текстура-заглушка; оптический pass, параметры и видимость корректны в test harness).
- `v8207-optical-webgpu-glass-regression.js`: PASS.
- `v8206-basic-glass-when-optics-fails-regression.js`: PASS.
- `v8205-webgpu-optics-modes-regression.js`: PASS.
- `v8206-glass-sphere-visibility-and-icons-regression.js`: PASS.
- `v8204-ambient-multipliers-blue-corridor-pkm-regression.js`: PASS.
- `v8203-independent-3d-and-corridor-glint-regression.js`: PASS.
- `v7122-shared-parameter-matrix-parity-regression.js`: тест вывел PASS, но процесс не завершился в установленный timeout (не засчитывается как полностью завершившийся run).
- `tests/static-modules.js`: PASS — полная загрузка production JS в index, синтаксис, зависимости, порядок модулей.

**Граница проверки:** GPU-мок проверяет именно причину ошибки и корректность формирования команд, но не пиксели на NVIDIA. Аппаратное подтверждение стеклянной рефракции и дисперсии ещё необходимо. Этот выпуск не содержит новой реализации трассировки лучей.

## Аппаратный контроль

1. Включить Corridor с несколькими видимыми прямоугольниками, поверх — WebGPU 3D sphere.
2. В консоли не должно быть `Destination texture needs to have CopyDst and RenderAttachment usage`.
3. Внутри сферы контуры позади неё должны стать видимыми и смещаться при увеличении «Преломления»; увеличение «Радужной дисперсии» должно разнести цветовые каналы.
4. Проверить 2–3 минуты активного Corridor+3D и переключение иконки черепа ПКМ — без лавины `uncaptured` и зависаний.
