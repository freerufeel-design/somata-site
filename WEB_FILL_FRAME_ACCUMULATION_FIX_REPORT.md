# Somata 7.8.3 — Web + Fill frame accumulation fix

## Симптом

При включённой Web и Fill, особенно когда видимая Line выключена, изображение начинало накапливать предыдущие состояния: Fill/Web-команды визуально повторялись из кадра в кадр.

## Корень проблемы №1: deferred queue переживала кадр

`renderRuntime.frame` в Somata переиспользуется между кадрами. Вместе с ним переиспользовался массив `gpuLayerSceneEffectCommands`.

Очередь обычно очищалась после успешной GPU presentation. Но если конкретный кадр не проходил через обычный путь presentation/cleanup, команды Fill/Web оставались на объекте frame. Следующий кадр добавлял новые command buffers к старым.

При последующем submit после одного root clear могли выполняться несколько поколений `fill-ordered` / `web-*`, что и создавало накопление старых кадров.

### Исправление

- В начале каждого нового render frame вызывается `beginLayerSceneEffectCommandFrame()`.
- Очередь deferred Layer Scene commands и материализованный command-buffer list сбрасываются независимо от результата прошлого кадра.
- GPU scheduler также привязывает очередь к текущему `frameId` и сбрасывает её при смене поколения.
- Каждая queued command теперь хранит `frameId`.
- `peekLayerSceneEffectCommands()` возвращает только команды текущего `frameId`, поэтому даже случайно оставшаяся старая команда не может попасть в новый submit.
- Старые submit callbacks также очищаются на frame boundary, но не вызываются, потому что несостоявшийся submit не должен подтверждаться как committed.

## Корень проблемы №2: hidden Line ломала FrameContour внутри FeatureHost

`FrameContour` обязан существовать даже при визуально выключенной Line.

До исправления `recordLineCarrier()` временно ставил `lineDisplayEnabled=true` на объекте, переданном в функцию. Внутри FeatureHost это scoped child. Но `drawLayerInstances()` и `drawLayerGeometry()` являются closures над полным parent frame context.

В результате при `Line OFF`, особенно в Morph, child говорил «Line временно включена», а реальный geometry closure всё ещё видел `lineDisplayEnabled=false` и возвращал пустые stroke commands (`line-commands-empty`).

### Исправление

`SomataFrameContourService` теперь определяет полный owner frame context через `__somataFeatureParent` и:

- кэширует authoritative FrameContour на полном layer-frame;
- временно открывает Line visibility именно на owner context только на время геометрической записи;
- сразу восстанавливает исходную видимость;
- Fill/Web/Profile/Sweep внутри разных FeatureHost views получают один общий FrameContour текущего кадра.

Видимая Line при этом остаётся выключенной.

## Новые regression tests

### `v783-layer-scene-frame-generation-regression.js`

Эмулирует кадр N с queued Fill/Web, намеренно пропускает presentation cleanup, затем начинает N+1 на том же frame object.

Проверяется:

- до reset старые команды действительно присутствуют (валидность теста);
- после frame preparation очередь пуста;
- новые команды имеют только текущий `frameId`;
- принудительно подмешанная stale command прошлого frameId фильтруется из submit view.

### `v783-fill-web-line-hidden-no-accumulation-regression.js`

Сценарий пользователя:

- Line OFF;
- Fill ON;
- Web ON;
- три режима Web;
- Static и Morph;
- по 6 последовательных кадров;
- предыдущий кадр намеренно не получает presentation cleanup.

Итого: **36 последовательных frame probes**.

Для каждого кадра требуется:

- очередь перед текущими pass'ами пуста;
- Line остаётся выключенной;
- Fill и Web оба активны;
- Fill и Web оба committed;
- в очереди ровно одна текущая Fill-команда и одна текущая Web-команда;
- ни одной команды предыдущего frameId.

Результат: **36/36 PASS**.

## Повторно пройденные регрессии

- configurable effect order / FeatureHost scope;
- Fill + Web GPU order, оба пользовательских порядка;
- Fill + Web generation through real FeatureHost;
- Static/Morph effect order;
- Fill/Geometry separation;
- fast-path без Web;
- Web 7.3.20 fallback, все 3 режима Static + Morph;
- repeated Web toggle stability;
- FrameContour authority;
- shared FrameContour;
- Corridor FrameContour;
- dynamic Fill unified;
- Fill follows Line carrier;
- exact Spiral carrier/profile invariant;
- Web/Fill/Line authority;
- Fill/Web retry ordering;
- GPU effect scene routing: **6/6 PASS**;
- `effect-render-impact`: **PASS**;
- Graffiti/Glow/Lamps;
- Graffiti/Lightning;
- Lightning impact;
- Static/Dynamic Lightning unified;
- static modules;
- contracts.

## Не изменялось

- математика Web;
- математика Fill;
- порядок эффектов;
- exact/retained Spiral;
- Corridor semantics;
- Shape Profile / будущая Geometry architecture.

Исправление относится только к lifetime deferred-команд и authoritative carrier visibility при hidden Line.
