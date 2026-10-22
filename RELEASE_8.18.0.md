# Somata 8.18.0 — Solo, Graffiti и Glint

**База:** Somata 8.17.0. Эта итерация исправляет старые функциональные регрессии, не является заявкой на ускорение FPS.

## Изменения

1. **Solo третьего слоя при Green Morph.** Видимость authored-слоёв синхронизирована со снимком Green, чтобы выбор Solo и возврат общего отображения вступали в силу сразу. В Orange также учитываются source/target поколения.
2. **Graffiti при Orange regeneration.** Перегенерация сохраняет `lineProfileApplication` и пользовательские настройки Graffiti отдельно для каждого слота слоя. Исторический общий `featureOverrides.graffiti` больше не перезаписывает индивидуальный выбор. Один выбранный Graffiti-слой не превращается в обычный Point/Stroke.
3. **Исчезновение линии во время GPU warmup.** Для обычной геометрии Base остаётся видимой до готовности GPU Graffiti, не повреждая authored-режим. Для strict Spiral запрет на приблизительную CPU-геометрию сохранён.
4. **Проблеск Glint.** По умолчанию у новых слоёв используется `perPath` — отдельный проблеск на каждом независимом контуре. `perSegment` — явный вариант на каждом сегменте. Сохранённые режимы, включая `whole` (один проблеск на всю фигуру), *не меняются автоматически*.
5. **Маркер Graffiti.** Новая длина штриха по умолчанию — **3**, толщина продолжает наследоваться от ширины линии, если пользователь не указал отдельную. Существующие значения проекта сохраняются.
6. **Cache busting** обновлён для каждого изменённого JS в `index.html`; версия PWA обновлена.

## Проверено

- `v818-solo-orange-graffiti-regression.js`: **PASS**, три слоя, Solo при Green, восстановление, три поколения Orange, длина штриха и индивидуальный режим.
- `v818-graffiti-solo-line-warmup-regression.js`: **PASS**, при неготовом GPU Graffiti ordinary Base остаётся видимой, authored Graffiti остаётся Graffiti.
- `v818-glint-contour-coverage-regression.js`: **PASS**, три независимых контура, `perPath`, `perSegment`, сохранение `whole`.
- `v7116-orange-live-visibility-regression.js`, `v783-effect-order-static-morph-regression.js`, `v783-static-web-render-pass-regression.js`, `graffiti-glow-lamp-blend-regression.js`, `graffiti-lightning-aftershock-regression.js`, `v8-actual-coverage-regression.js`, `v71116-orange-routing-palette-stop-corridor-regression.js`, `v8100-gpu-buffer-fence-coalescing-regression.js`, `v8170-exact-spiral-fragment-width-regression.js`: **PASS**.
- Синтаксис всех **103** production JS: **PASS**.

## Честные ограничения

- Проверки выполнялись в Chromium без аппаратного NVIDIA WebGPU. Фактический GPU-рендер Graffiti при пропадании ресурса и сложные сочетания Green/Orange на NVIDIA ещё требуют проверки.
- `whole` в сохранённом проекте по замыслу освещает контуры поочерёдно. Для одновременного проблеска по каждому контуру нужно выбрать «По каждому контуру» (для каждого сегмента — «В каждом сегменте»). Автоматически менять пользовательский выбор опасно.
- Производительность и FPS **не измерялись как новое ускорение**: задача релиза — надёжность и исправление регрессий. Архитектура GPU-проходов и шейдеры не переписаны.
- Аппаратная компиляция экспериментального шейдера, унаследованного от 8.17.0, не подтверждена; 8.16.0 остаётся более консервативной точкой отката.
