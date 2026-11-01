# Somata 13.0.24 — actual Spiral sliding mode corrections

- Cyclic K cap: one canonical **effective** K used for geometry and carrier, including decreasing N; K is capped against the current N after the cycle calculation, rather than letting the renderer and orbit generator disagree.
- Fixed N/K: geometry always uses an exact, stationary source/target crossfade, including local Geometry > Animation edits and changes besides N/K.
- Fixed N (mode `phase`): N fades between two independent rails while K animates on each rail; no interpolated N in the geometric rail.
- Fixed K (mode `minimalTurn`): K fades while N animates on each rail; no interpolated K in the geometric rail.
- Phase-circle preserves clone/merge as requested.
- Torn: one-to-one, no duplicates; globally minimum-distance one-to-one assignment (Hungarian algorithm), no periodic topology/mandatory endpoint closure during the transition. Unmatched rays fade in/out without cloning.
- Hardware WebGPU performance is not benchmarked.
