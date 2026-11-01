# Somata 13.0.26 — Spiral connection-step limiter at the geometry boundary

- Authored K remains unchanged for the slider and persisted projects.
- `getSpiralGeometryLayer()` projects an ephemeral geometry view with bounded K, before static path creation, suborbit traversal, branch matching, and retained GPU morph carrier preparation.
- `getEffectiveSpiralStep()` remains the unique owner of the limit formula and optional N clamp; its output is passed to both angle and topology as `__spiralAnimatedEffectiveK` so it cannot be re-wrapped at a later stage.
- With the enabled cyclic limiter, phase-circle correspondence is one-to-one (unmatched paths fade) instead of split/merge. Unrestricted phase-circle retains its original clone/merge.
- Main render-pipeline gate: immediately after Geometry > Animation and Corridor entrance overlays, a render-only snapshot is projected BEFORE transform, path, Corridor and effect planning. It never writes to `state.layers`.
- Browser diagnostics: `__spiroSpiralLimiterProbe(layer)` returns authored K, effective K and rendered topology K.
- Regression contract: N=19, limit=2, K=8 -> 9 must behave exactly as K=2 -> 1; 3 -> 4 matches 1 -> 2. Phase curves must not acquire extra rails.
- GPU hardware performance not validated in this environment.
