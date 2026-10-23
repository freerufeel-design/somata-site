# Somata 9.0.5 — Spiral edit controls / Corridor / Fill warmup

- In Geometry Star → Animation, a Spiral-specific morph type appears only for Spiral layers. Choices match the six Blue Morph spiral types. The value is stored per layer as `testMorph.spiralType` and remains independent of Blue.
- Static edit transitions remain event-driven. Structural changes in strict Spiral use a finite exact endpoint fade (no CPU approximation); this release does **not** claim full Blue GPU topology transport in static edits. The UI transport choice is available for upcoming parity work.
- During Spiral structural fades, geometry remains at the two exact static endpoints, including scalar fields. This avoids rematerializing intermediate Spiral/Corridor geometry on invisible frames.
- When Corridor phase does not advance, its task no longer forces a redundant full-scene render. Moving Corridor still renders normally; complex moving Corridor GPU cost is not eliminated.
- Initializing GPU Fill with 0×0 mask surface is treated as GPU warming for up to 2.5 seconds, not immediately as a permanent error. Failures after the grace window remain visible in diagnostics.
- All project playlists and tests retained. Real NVIDIA performance must be measured on-device.
