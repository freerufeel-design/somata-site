# Somata 7.8.3 — Fill/Web FeatureHost scope fix

## Симптом

После разделения Fill и Geometry паутина и заливка снова могли перестать работать одновременно.

## Корень

`SomataEffectStackOrder.plan(frameCtx)` использовал `frameCtx.effectsPlan` для определения активных художественных групп.

Но render-pass выполняется через `SomataFeatureHost`, который намеренно выдаёт каждому feature только объявленную часть `effectsPlan`.

В частности Fill feature объявляет только `glow`, а не `web`. Поэтому внутри реального Fill-pass происходило следующее:

1. полный frameCtx: Web включена;
2. Fill feature-view: `effectsPlan.web` скрыта;
3. `EffectStackOrder.plan()` ошибочно считал Web выключенной;
4. Fill разрешал fused Fill+Geometry fast-path и не создавал самостоятельную Fill-команду;
5. позже `StrokeBatch`, уже на полном frameCtx, видел Web включённой и запрещал включать Fill в Geometry;
6. Fill оказывалась ни в standalone scene, ни в Geometry batch.

Это объясняет реальное взаимоисключение Fill/Web и одновременно объясняет, почему старые тесты, вызывавшие части pipeline напрямую вне FeatureHost, могли быть зелёными.

## Исправление

`SomataEffectStackOrder.activeGroups()/plan()` теперь восстанавливает полный родительский frameCtx через `__somataFeatureParent` и принимает frame-wide compositor decision по полному `effectsPlan`.

Feature isolation при этом не ослаблена: отдельные effect-pass по-прежнему не получают чужие планы. Полный context используется только внутренней frame-wide службой порядка эффектов.

Также в multilayer admission отдельно закоммиченная standalone Fill теперь считается уже существующей, даже если она намеренно не входит в Geometry stroke batch.

## Fast path сохранён

При Web OFF и стандартном порядке:

`Fill + Geometry` по-прежнему могут использовать fused fast-path без отдельной Layer Scene.

При Web ON:

`Fill` становится standalone compositor group, `Web` — отдельной group, `Geometry` не может поглотить Fill обратно.

## Новые regression tests

### `v783-effect-order-feature-scope-regression.js`

Проверяет, что один и тот же stack-plan виден:

- снаружи FeatureHost;
- внутри Fill feature-view;
- внутри Base feature-view.

При активной Web во всех трёх случаях обязательны:

- `webActive === true`;
- `standaloneFill === true`;
- active order содержит Fill/Web/Geometry.

### `v783-fill-web-featurehost-gpu-order-regression.js`

Проверяет фактический runtime path через реальный `SomataFeatureHost`.

Матрица: 3 Web режима × 2 порядка × Static/Morph = 12 случаев:

- `corners`;
- `selfIntersection`;
- `selfIntersectionCorridor`;
- default `Fill → Web`;
- custom `Web → Fill`;
- Static;
- Morph.

В каждом случае обязательно:

- standalone Fill реально committed;
- Web реально committed;
- обе GPU-команды одновременно присутствуют в очереди;
- compositor phases соответствуют пользовательскому порядку.

Результат: **12/12 PASS**.

## Повторно проверено

PASS:

- Fill/Web FeatureHost generation — 3 режима Static + Morph;
- Fill/Geometry structural separation;
- effect-order fast path;
- Fill/Web retry ordering;
- Web/Fill/Line shared authority;
- Fill follows FrameContour;
- FrameContour authority;
- Corridor Static/Morph;
- exact Spiral carrier/profile;
- GPU effect scene routing — 6/6;
- effect-render-impact — 12/12;
- palette Fill/Web color;
- Graffiti/Glow/Lamps;
- Graffiti/Lightning aftershock;
- Lightning impact.

## Архитектурное правило после исправления

`EffectStackOrder` — frame-wide compositor service. Его решение не может зависеть от того, из какого isolated FeatureHost view оно было запрошено.

Иначе разные pass одного кадра получают разные ответы на вопрос «активна ли Web / должна ли Fill быть отдельным слоем».
