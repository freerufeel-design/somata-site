# Somata 13.0.12 — automatic focus and manual percentage

- Automatic midpoint of the visible Corridor population, independent of a copy identity. New layers default to auto.
- Stable edge crossing estimated from continuous copy scale / position; manual 100% points to the penultimate stable slot, not an intermittently visible last copy.
- Spiral and ordinary Corridor show count above the same-row **Ручной фокус / Подсветить фокус** checkboxes. Percent range 0–100 appears only when manual focus is enabled.
- Saved fields: `spiralManualFocus` (boolean, false) and `spiralRotationFocusPercent` (number, 50). Legacy `spiralRotationFocus` retained for project compatibility but does not select the new focus. Old projects open in automatic mode until manual focus is enabled.
- The **spiral.focusPercent** parameter is a first-class Morph routing definition, with RMB on the slider. Only active in manual mode.
- Focus position feeds existing Corridor rotation and highlight in the render frame. No Bezier, Spline+, anchor transport, lamp, or Glow algorithm was changed.
- Test: `tests/v1312-automatic-focus-percent.js`. Previous physical-focus tests were adapted with an explicit fourth-slot fixture, so they still verify the old mathematical invariants.
- Known limitation: an actual change in visible geometric capacity (e.g. editing radius or Corridor spacing) may legitimately move the rounded focus by one figure; merely recycling the outer figure does not.
