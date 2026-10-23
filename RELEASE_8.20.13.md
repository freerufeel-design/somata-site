# Somata 8.20.13 — 3D click repaint and ambient rain controls

Based on 8.20.12. Surgical changes only to ambient/prism UI, rain rendering and optical redraw triggering; geometry, Blue/Orange, Corridor and WebGPU optics algorithms unchanged.

- A click/contextmenu enabling the 3D figure now invalidates the MAIN Somata render through the existing animationScheduler, so `afterScenePaint()` can draw foreground glass immediately after fresh GPU composition even if nothing moves. No independent animation loop. WebGPU asynchronous initialization also invalidates a frame once ready.
- Ambient panel uses the same compact label → slider + numeric multiplier layout as the figure/Lamp UI; a first rain toggle replaces the visual square checkbox with a switch, still accessible via keyboard. Removed old `совмещаются` badge.
- Rain speed and its multiplier affect actual time-based droplet movement. Removed the internal speed clamp of 500. At speed 0 droplets stop; multiplying by 8 changes movement by 8 for the same time interval.
- Rain density now multiplies the real number of rain stroke commands, with a 4800-stroke/frame performance budget instead of the former low 500-stroke cap. At high densities the budget may limit further visual growth; this is not an unbounded particle simulation. Rain speed/density multiplier input range expanded to ×64; corresponding Blue/Orange/Audio registry ranges match.
- Angle and opacity are controlled directly without multipliers, both UI and metadata. An old project with saved angle/opacity multipliers has its effective appearance converted to a bounded authored value once; unrelated ambient multipliers left as before.

## Tests

- `node tests/v8213-ambient-rain-prism-activation-regression.js`: PASS in Chromium; observed rain stroke count 12 → 98 at ×8 density (test canvas), speed ×8 changed rain positions, zero speed froze rain; real skull contextmenu triggered main scheduler invalidate.
- Legacy smoke tests run separately; physical optical GPU pixels on NVIDIA not certified.
