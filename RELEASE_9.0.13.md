# Somata 9.0.13 — Spiral Fill Reference Alignment

## Эталон

`Somata_7.9_stable_gradient_performance_i1.zip` (предоставлен пользователем). В версии 7.9 линии Spiral и её Fill используют общий актуальный геометрический носитель. Сравнение проведено с базой Somata 9.0.12.

## Найденная регрессия 9.0.12

В 9.0.11 появился отдельный GPU-ресурс **Spiral static edit Morph**. GPU-линия выбирает `staticEditResources` и интерполирует по `frameCtx.spiralEditMorph.progress`, но вызов Fill-адаптера использовал `getGpuSpiralBezierMorphAuxPaths(layerIndex,t)` без контекста кадра. Вызов по умолчанию выбирал глобальный Blue Morph-ресурс `resources`, а не новый `staticEditResources`.

Даже если обычный Blue Morph был выключен, Fill не всегда получала актуальный набор витков. Это нарушало принцип 7.9: Line и Fill должны потреблять *один текущий носитель*.

## Исправление

- `js/gpu/spiral-bezier-morph-renderer.js`: `auxiliaryPaths` принимает необязательный `frameCtx`; при `spiralEditMorph` выбирает **тот же** ресурс, что и видимая GPU-линия, иначе поведение Blue Morph не меняется.
- `js/render/spiral-fill-adapter.js`: прогресс статического редактирования имеет приоритет; Fill передаёт контекст кадра в источник геометрии, выбирает активную Spiral edit mesh-подготовку.
- `js/render/fill-plan.js`: источником и целью Fill при статическом Spiral edit выступает его собственная пара слоёв, а не `blueMorphProvider`.
- Добавлен функциональный тест `tests/v913-spiral-static-edit-fill-authority-regression.js`, который специально задаёт разные фазы Blue и Spiral edit и проверяет правильный выбор носителя.

## Сохранено

- Правила топологии/замыкания Spiral и алгоритмы заливки из 7.9 не заменены.
- Blue/Orange/Green Morph, Corridor, Lightning, Noise/Glitch/Clouds, защита GPU из 9.0.8 и статическая настройка Fade из 9.0.12 не переписывались.
- Плейлисты `default.plist`, `COSMIC_ODYSSEY_10.plist`, `STANDARD_ORIGINAL_23_PROJECTS.plist` неизменны.

## Проверка

- Основной набор: 32 PASS / 0 FAIL / 0 TIMEOUT.
- Дополнительные: `spiral-profile-fill-continuity`, `v783-fill-geometry-separation`, `v783-fill-msaa-isolation`, `v783-fill-web-featurehost-gpu-order`, `v8170-exact-spiral-fragment-width` — 5/5 PASS.
- Функциональный тест приоритета статической пары — PASS.
- Физический GPU рендер NVIDIA и FPS **не проверены**. Данная версия исправляет установленный рассинхрон Line/Fill, но **не доказывает устранение всех видимых разрывов Spiral**, о которых пользователь сообщал ранее.
