# Somata 7.8.3 — Sharp / Smooth Fading Fill

## База

Изменения сделаны поверх `Somata_7.8.3_stable_fill_types_lamp_v505_fix.zip`.

Стабильные исправления Fill/Web/MSAA и v505 Topology Lamp sticking не откатывались.

## Что добавлено

В существующий список `Тип заливки` добавлен второй вариант затухающей заливки:

- `Затухающая — резкая` (`fillType = fade`)
- `Затухающая — плавная` (`fillType = fadeSmooth`)

Старый `fillType = fade` специально оставлен прежним внутренним значением. Поэтому проекты, сохранённые до этой правки, получают прежний layered/iso внешний вид без миграции.

Оба режима используют существующие настройки:

- `Направление: Из центра / К центру`
- `Жёсткость: 0–100%`

Контракт Жёсткости не менялся:

- `0%` — Fill отсутствует;
- `100%` — обычная сплошная Fill;
- промежуточные значения задают размер/ширину контурной зоны перехода.

## Резкий режим

Резкий режим сохраняет предыдущий shader-алгоритм без художественной замены:

- бинарные выборки маски;
- два характерных масштаба;
- выраженные contour/iso layers.

Это намеренный эффект и теперь он называется `Затухающая — резкая`.

## Плавный режим

Плавный режим не строит вторую геометрию и не меняет `FrameContour`.

Он получает ту же чистую current-frame Fill texture, после чего оценивает глубину внутри контура по трём концентрическим уровням выборок:

- near = 0.24 радиуса перехода;
- mid = 0.52;
- far = 0.84.

На каждом уровне берутся восемь направлений вокруг текущего пикселя. В отличие от sharp-ветки используются непрерывные alpha-значения через отдельный `linear` sampler.

Вес поля:

```text
depth = near * 0.50 + mid * 0.32 + far * 0.18
```

Затем применяется широкая сглаживающая функция `smoothstep(0.03, 0.97, depth)`.

Это приближение contour-distance field: центральная область остаётся подобна реальному контуру фигуры, но переход не разбивается на отчётливые кольца.

### Нормализация alpha

Isolated Fill texture содержит уже выбранную пользователем прозрачность Fill, а не бинарную маску 0..1. Поэтому smooth sampling нормализуется относительно локальной полной alpha. Без этого Fill с прозрачностью, например, 10% ошибочно считалась бы геометрической глубиной 0.1 и почти исчезала бы.

### Почему не JFA/SDF compute

Для настоящего signed-distance field можно было бы добавить Jump Flood / compute pipeline. Для этой задачи это слишком большой новый GPU-lifecycle и дополнительная память/синхронизация.

Текущий multiscale shader:

- не создаёт новых persistent textures;
- не меняет Fill geometry;
- не затрагивает Web/Line/Spiral/Lamps;
- значительно дешевле отдельного distance-transform pipeline;
- сохраняет существующий firewall: ошибка special Fill shader не может отключить Dense/Mathematical/Accumulation.

## Backward compatibility

- Старый `fade` остаётся sharp.
- `fadeSmooth` — только новый режим.
- Старые проекты без `fadeSmooth` не меняют вид.
- `Плотный`, `Математический`, `С накоплением` не изменены.
- Fade controls показываются для обеих fade-веток.
- Оба fade-режима остаются standalone Fill compositor sections и не сливаются с Geometry.

## Тесты

### Новые / обновлённые

- `v783-fill-fade-modes-regression.js` — sharp/smooth UI/state/backward compatibility.
- `v783-fill-types-ui-regression.js` — пять пунктов Fill menu, controls и compositor plan.
- `v783-fill-types-static-morph-regression.js` — Accumulation + Sharp Fade + Smooth Fade × Static/Morph × Web OFF/ON = 12 комбинаций.
- `v783-fill-special-gpu-contract-regression.js` — sharp branch, smooth multiscale branch и selector contract.

### Стабильностные regression PASS

- special Fill pipeline firewall — PASS;
- MSAA Fill isolation / no accidental accumulation — PASS;
- Fill + Web FeatureHost order — PASS;
- shared FrameContour — PASS;
- Corridor Static/Morph — PASS;
- exact Spiral carrier/profile — PASS;
- v505 Topology Lamp sticking — PASS;
- GPU scene routing — 6/6 PASS;
- `effect-render-impact` — 12/12 PASS;
- `static-modules.js` — PASS;
- `contracts.js` — PASS.

## Реальный GPU

Headless regression проверяет state, routing, shader source contract и отсутствие архитектурных регрессий, но окончательный визуальный характер smooth gradient должен быть подтверждён на физическом WebGPU device.

В первую очередь стоит сравнить `Затухающая — резкая` и `Затухающая — плавная` при одинаковых:

- Fill opacity;
- direction;
- hardness;
- geometry;
- zoom.

Sharp должен выглядеть как раньше; Smooth — без выраженных слоёв.
