# Somata 7.8.3 — Topology Profile Attachment Fix

## Симптом

В Topology/Calm Morph лампочки двигались по устойчивой траектории, но эта траектория не совпадала с фактически видимым Shape Profile. Пользователь также заметил, что Particles летят по той же неправильной траектории.

## Корень

Это оказался общий carrier bug, а не две независимые ошибки эффектов.

Поздняя 7.8.3 имела несколько представлений текущей Morph-геометрии:

- topology / endpoint-interpolated Morph rail;
- GPU Morph Arc;
- фактический Line/Profile carrier текущего кадра, зафиксированный в `FrameContour.paths`.

Для ordinary Topology/Calm визуальный Shape Profile может заметно отклоняться от topology/Morph rail. Lamps после восстановления v505 identity всё ещё могли финально проецироваться на повторно восстановленную topology-траекторию. Particles в Blue Morph ещё раньше выбирали generic GPU Morph Arc до обычного path-table fallback.

В результате оба эффекта были согласованы друг с другом, но не с линией, которую видел пользователь.

## Исправление

Введён общий контракт `useTopologyVisualProfileRail(frameCtx)`.

Для ordinary Topology/Calm Morph:

```text
Topology identity / Morph transport
             ↓
     FrameContour.paths
        ┌────┴────┐
        ↓         ↓
      Lamps    Particles
```

### Lamps

v505 остаётся эталоном identity/соответствия лампочек. Но при включённом contour sticking их финальная координата проецируется на `FrameContour.paths` текущего кадра.

То есть:

```text
v505 topology identity
        ↓
intermediate lamp position
        ↓
nearest projection to CURRENT FrameContour.paths
```

### Particles

В ordinary Topology/Calm Particles больше не выбирают generic GPU Morph Arc как визуальную траекторию. Для них строится typed GPU segment table непосредственно из `FrameContour.paths` через `getLayerFrameAuthoritativePathFxTable()`.

Это означает, что их движение следует тому же Shape Profile, который реально рисует Line.

### Strict Spiral

Не изменена. Strict Spiral не переводится на FrameContour и продолжает использовать exact retained Bézier/GPU Arc carrier.

## Новый regression

`tests/v783-topology-profile-attachment-authority-regression.js`

Тест намеренно создаёт сильный spline-profile, для которого старый auxiliary topology rail и реальный FrameContour заметно различаются.

Проверенный пример:

- расстояние между старым auxiliary rail и фактическим profile rail: ~30–65 px;
- Lamps: 11/11 находятся на FrameContour, максимальная ошибка порядка `1e-14`;
- Particle carrier: `frame-contour-profile`;
- Particle typed table: сотни сегментов текущего FrameContour;
- максимальное отклонение концов particle-сегментов от FrameContour: порядка `1e-5`.

Таким образом тест не сравнивает две одинаково неправильные аппроксимации.

## Повторные регрессии

PASS:

- `v783-topology-profile-attachment-authority-regression.js`
- `v783-topology-lamp-v505-sticking-regression.js`
- `v779-frame-contour-authority-regression.js`
- `v780-shared-frame-contour-regression.js`
- `v782-corridor-frame-contour-regression.js`
- `v763-spiral-carrier-profile-invariant.js`
- `gpu-effect-scene-routing.js` — 6/6
- `effect-render-impact.js` — 12/12
- Fill special-pipeline firewall
- Sharp/Smooth Fade UI/regression
- static modules/contracts

## Архитектурный вывод

Contour-following effect не должен выбирать собственный визуальный rail только потому, что Morph имеет специализированный transport representation.

Для ordinary geometry source of truth после построения Line текущего кадра — `FrameContour`.

Identity/transport может быть специализированным; финальная визуальная attachment trajectory — одна.
