# Somata 8.19.2 — Morph Palette Allocation & Synchronization

Based on Somata 8.19.1; GPU startup FPS warmup changes retained.

## Behaviour

- **Static palettes**: untouched. Apply-to-project keeps authored sequential colour order.
- **Blue Morph**: `Фиксированные цвета` default OFF, creates a random allocation of the active palette's distinct colours for its target layers. Every unique stop is consumed before a new randomized pass; palettes are not stretched with invented colours. ON uses the authored palette order and wraps through its entries.
- **Orange Morph**: the same allocation policy, including dice-generated compositions, with the independent `Фиксированные цвета` flag (default OFF). Colours are set once in each generated static composition, not changed on every rendered frame.
- **Both Blue and Orange**: `Синхронизировать между морфингами` default ON (one shared setting, visible in both stroke colour parameter rows). Manual palette choices propagate in both directions. When both engines are running, Orange is the automatic palette authority. A manual Blue selection overrides and updates the Orange palette. With synchronization OFF, each engine has its own palette choice and own palette cycling.
- Flags are accessible from the `Цвет линии` rows in both parameter matrices, and from the compact line-colour controls. `Листать` remains a separate option controlling palette changes per cycle.
- Colour allocation happens once per Morph cycle/Orange composition and does not change Fill alpha, Corridor palette-lag interpolation or static authored colour order.

## Persistence

- New controls are written to project state. Blue flags are included in Blue profiles; Orange fixed colour flag in Orange profiles. Old projects/presets without fields load with Fixed Colors OFF and Sync ON.
- Green Project Morph is a **transition between saved projects**, not a per-layer palette generator; saved project colours are retained rather than replaced with randomly allocated palette colours. This release does not change Green project transition colour authoring.

## Verification

- Production JavaScript syntax check (103 files): PASS.
- `tests/v8192-morph-palette-allocation-sync-regression.js`: PASS (allocation, uniqueness, overflow, defaults, both matrices, manual changes, disabled-sync independence, Orange priority, persisted configs).
- `tests/v71116-orange-routing-palette-stop-corridor-regression.js`: PASS (legacy sequential palette behaviour explicitly enabled via Fixed Colors, Corridor colour/alpha).
- Existing Blue/Palette Lag, startup Corridor/Blue GPU warmup and Blue/Orange morphology profile regressions: PASS.
- Chromium tests run headless with hardware GPU disabled. Exact FPS/driver performance must be verified on an actual GPU.
- Known pre-existing issue: `tests/v7107-orange-static-generation-presets-regression.js` stained-glass fill count check also fails on the original 8.19.1 and was not caused or fixed by these changes.
