# Somata 13.0.8 — experimental physical rotation focus

Not a final release. Based on 13.0.7; specialized Glow performance is **not fixed**.

The previous focus cancelled only `copyId * delta` at Corridor copy #7. For a continuous spiral, a visible carrier tip also rotates by `delta = 2πK/N`, so the seventh copy could still rotate visually while the copy-transform angle was zero.

This prototype retains the baseline carrier step angle per persistent layer and adds a common compensation `delta_reference - delta_current` to the copy transforms. It is NOT a geometry patch: N/K keypoint transport and cubic curves are unchanged. At the tracked tip of the seventh copy this cancels the change in carrier phase while preserving angular differences between adjacent copies. Other points of a deforming carrier may still move/rotate, so the fixed point should be confirmed visually.

Tests: `node tests/v1308-physical-spiral-focus-diagnostic.js` and `node tests/v1308-focus-mode-matrix.js`.

Tested: continuous, phase, minimalTurn, phaseCircle; open and closed; 7 phase instants each, plus static handoff. `torn` deliberately unchanged. The older `v1307-spiral-rotation-focus.js` test was replaced because it incorrectly asserted that copy rotation itself must remain zero.

Important: GPU Glow optimisation is NOT included. WebGPU visual behavior and FPS have not been measured here.
