# Somata 13.0.10 — Spatial Rotation Focus

- Default focus is 4 in new layers, Corridor UI and Spiral UI. Old projects keep their explicitly stored focus number.
- Focus highlight and phase-driven rotation now use the same spatial Corridor position (accounting for hidden central copies). Previously rotation used copyId, which changed with tunnel travelPhase and did not point at the highlighted figure.
- Removed the 13.0.8 artificial -delta rotation that held the *carrier tip* rather than the physical first anchor. That compensation caused the whole focused profile to turn backwards as N/K changed. The authored carrier shape, N/K and Bézier paths remain unchanged.
- Inter-copy angular step is identical to the previous spiral delta, preserving seamless Corridor geometry in the continuous modes.
- Scope: rotation induced by spiral N/K phase. Explicit layer rotation, independent Motion rotation and geometric deformation are not suppressed.
- No claim that Glow performance is fixed; this is a focus correctness release.
