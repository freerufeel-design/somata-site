# Somata 7.8.3 — Stable Fast-Path Performance Fix

## База

Оптимизация выполнена поверх пользовательской стабильной сборки:

`Somata_7.8.3_fill_web_featurehost_fix.zip`

Сохранены исправления этой сборки:

- настраиваемый порядок эффектов;
- Fill + Web одновременно;
- все три режима Web;
- 7.3.20-style presentation fallback для ordinary Web;
- FeatureHost-контракт Fill → Web;
- единый FrameContour ordinary geometry;
- exact retained Spiral;
- Corridor;
- Static/Morph invariant.

Архитектурная миграция GeometryFrame/ProfileFrame/VisualCarrier не начиналась.

---

## Почему стабильная сборка стала медленнее

Предыдущее исправление effect-order сделало compositor слишком универсальным:

1. `main-pipeline` открывал `effect-stack-root` Layer Scene для каждого слоя/кадра независимо от активных эффектов.
2. Ordinary Fill был вынесен в standalone Layer Scene даже когда Web выключена и Fill можно безопасно объединить с Line/Glow batch.
3. Corridor/retained Spiral часто получали отдельный нейтральный root перед собственной Fill-командой.

Это увеличивало число offscreen scene операций, command buffers, texture/load-store операций и вероятность GPU→main presentation fallback. На пользовательском GPU это проявлялось длинными `renderMainCanvas` stalls.

---

## Что изменено

### 1. Effect-order planner

`SomataEffectStackOrder.plan(frameCtx)` теперь определяет только по фактически активным группам:

- `fillCanFuse`
- `standaloneFill`
- `fillCanSeedRoot`
- `requiresEarlyScene`

Меню порядка эффектов остаётся единственным художественным source of truth, но само наличие меню больше не означает обязательный offscreen compositor.

### 2. Убран безусловный Layer Scene root

Было:

```text
каждый layer/frame
→ ensure(effect-stack-root)
```

Стало:

```text
EffectOrderPlan
→ requiresEarlyScene ? ensure(effect-stack-order-root) : fast path
```

Neutral root создаётся только если пользовательская перестановка реально требует, чтобы технически поздняя группа физически оказалась ниже Geometry, и ни ранний Fill/Web не может сам открыть сцену.

### 3. Возвращён быстрый ordinary Fill path

При стандартном практическом случае:

```text
Fill ON
Line/Geometry ON
Web OFF
Fill непосредственно ниже Geometry среди активных групп
```

Fill снова остаётся владельцем общего Line/Glow stroke batch.

Отдельная Fill Layer Scene команда не создаётся.

Regression-тест инструментирует `SomataLayerSceneService.ensure()` и требует:

```text
ensureCalls === 0
```

для этого пути.

### 4. Web + Fill не оптимизированы ценой совместимости

Если Web активна:

```text
Fill → standalone ordered command
Web  → own ordered command
Geometry → above them
```

То есть исправление Fill/Web из стабильной версии остаётся нетронутым.

### 5. Custom Fill/Geometry order сохраняется

Если пользователь переставляет Geometry ниже/выше Fill так, что общий batch уже не может выразить выбранный порядок, planner автоматически возвращает standalone Fill.

### 6. Corridor и retained Spiral могут seed'ить Layer Scene сами

Если Fill является нижней активной художественной группой и ещё нет resident scene, Corridor/retained Spiral Fill может стать root-командой через `queueAsRoot`, без дополнительного пустого clear-pass.

Exact Spiral carrier не менялся.

### 7. Ordered Fill умеет сохранять содержимое нижних групп

Native Fill encoder получил `preserveTarget`.

Если Fill выполняется как не-root ordered command, первый color attachment использует `load`, а не `clear`. Если Fill сама является root, сохраняется корректный clear.

---

## Важное исправление, найденное тестом

`frameCtx` переиспользуется между кадрами. Первая версия fast-path пыталась читать закешированный `_effectOrderPlan`; это позволило плану прошлого кадра ошибочно пережить в кадр с Web и могло снова потерять эффект.

Regression сразу поймал это.

Финальная реализация не доверяет transient cached plan: admission Fill/Spiral пересчитывает `SomataEffectStackOrder.plan(frameCtx)` из текущего snapshot.

---

## Проверки Static / Morph / эффекты

После оптимизации подтверждены:

- Static/Morph shared profile/carrier architecture;
- Static/Dynamic geometry invariant;
- exact Spiral carrier/profile invariant;
- FrameContour authority;
- shared FrameContour;
- Corridor FrameContour;
- configurable Fill/Web order в Static и Morph;
- Fill + Web через настоящий FeatureHost;
- три режима Web в Static и Morph;
- 7.3.20-style ordinary Web fallback;
- GPU effect scene routing;
- Graffiti/Glow/Lamp blend;
- Graffiti/Lightning aftershock;
- Lightning impact;
- общий render-impact test: 12/12 секций.

### Три режима Web с Fill

Проверяются и в Static, и в Morph:

1. `corners`
2. `selfIntersection`
3. `selfIntersectionCorridor`

Web по-прежнему генерирует реальные commands и проходит presentation path.

### Configurable order

Проверены как минимум:

```text
Fill → Web
Web → Fill
```

в Static и активном Morph.

---

## Что сознательно НЕ оптимизировалось

Не трогались ради микропрофита:

- Web geometry;
- FeatureHost Fill/Web contract;
- Graffiti;
- Lamps;
- Sweep/Lightning;
- PathFX;
- Particles;
- Morph mathematics;
- FrameContour;
- strict Spiral carrier.

Причина: они не были доказанным источником текущей регрессии. Цель — вернуть fast-path, а не начать новый широкий рефакторинг.

---

## Что можно и чего нельзя утверждать о FPS

Автоматические/headless тесты доказывают, что дорогой ненужный compositor path устранён структурно:

- в стабильном baseline `main-pipeline` безусловно открывал `effect-stack-root`;
- в новой сборке root условный;
- ordinary Fill+Line без Web даёт `Layer Scene ensureCalls = 0`.

Но headless-среда не может честно измерить физический FPS/driver latency на пользовательской NVIDIA. Поэтому реальное ускорение нужно подтвердить тем же тяжёлым проектом, который давал stalls 250–640 ms.

Полезные признаки после установки:

- меньше `final/presentation-fallback`;
- меньше `layer-scene-not-ready`;
- меньше больших `renderMainCanvas` spikes;
- выше FPS при 3 слоях + Corridor + Morph;
- при включении Web цена Layer Scene появляется только там, где она действительно нужна.

---

## Приёмочный принцип

Оптимизация считается успешной только при двух условиях одновременно:

1. реальный GPU показывает заметно меньшую нагрузку;
2. ни один эффект стабильной версии не исчезает и не меняет художественную геометрию.

Если на реальном GPU какой-либо эффект пропадает, этот сценарий имеет приоритет над автоматическим PASS и должен стать следующим regression-тестом.
