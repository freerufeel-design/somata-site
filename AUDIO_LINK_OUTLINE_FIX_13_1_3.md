# Somata 13.1.3 — Audio Link: menus, simplified parameters, outline automation

## Changes

1. Audio Link category popups and route selectors now close on `pointerdown` outside their popup and launcher, including pointer interactions consumed by other elements of the Audio Link panel. Escape closes any open Audio Link popup. Clicking inside a popup still allows selecting multiple audio parameters.
2. The Audio Link parameter catalog shows only the primary artistic parameter when its `...Multiplier` sibling is also supported. This affects all categories and both the group-menu and route-picker catalogs. Internal multiplier controls and previously saved routes are unchanged for backward compatibility.
3. Outline settings are routable in the **Line** audio category: `outline.enabled`, `outline.width` (previously supported but not present in the catalog), `outline.color` (hue modulation), and `outline.mode` (`outer` / `inner` / `median`). Modulation runs per rendered layer without writing over `state.lineOutline` or altering saved authoring settings. Master Audio routes apply to all layers; individual audio routes remain layer-specific.
4. Render demand / Morph path checks account for outlines enabled dynamically by audio (not just by the global checkbox).

## Tests

- `node tests/v1313-audio-outline-menu-regression.js`
- `node tests/v1313-master-control-paths.js`
- `node tests/v1313-master-all-layer-controls-browser.js`
- `node tests/mobile-number-counters-1313.js`
- `node tests/mobile-responsive-workspace-regression.js`
- `node tests/static-modules.js`

Note: multipliers remain available in the underlying application's ordinary settings and any older persisted Audio Link routes, but are removed from the *new parameter selection list* when a corresponding primary parameter exists. This avoids destroying or silently reinterpreting saved projects.
