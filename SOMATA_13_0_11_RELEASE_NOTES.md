# Somata 13.0.11 — Suborbits Morph Routing

- The sidebar “Количество суборбит (S)” row now accepts right-click even when gcd(N,K)=1 or Chaos Star prevents direct editing. Its numerical controls remain disabled in invalid topology; a routing menu is always available.
- The context menu toggles the **existing** Blue `monoOrbitTransforms` and Orange `geometry.orbits` special Orbit controls. It does not add an incompatible duplicate `customSuborbits` binding. Existing percentage and layer-coverage settings are retained.
- New/factory Blue Morph settings no longer include Orbits by default. Explicit choices in saved profiles continue to load as authored.
- No geometry, Spiral, GPU or Lamp algorithms were modified.
