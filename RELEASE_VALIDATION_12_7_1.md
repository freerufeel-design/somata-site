# Somata 12.7.1 — validation, scope and known limitations

## Evidence and root cause

User's hardware screenshot showed rounded / doubled-back Spiral tips at the beginning of the next phase while preceding tips were sharp. Somata 12.7.0 only tested exact constructed `old t=1` vs `new t=0`; these match in software but do **not** prove that `new t=epsilon` matches `new t=0`.

With a real UI-driven Blue Morph, Spline+, topology mode, changing Shape and N/K, `__somataSpiralCarrierMorphPlan(0, t)` returned different spline controls at the boundary because `ensureCarrierMappedCurrent()` treats exact t=0/1 as frozen endpoints but rebuilds live rounded spline in all interior frames. For phase 2, the maximum corresponding Bézier control difference `t=0 ↔ t=0.000001` on the base 12.7.0 was **92.2612 coordinate units**, while approaching `t=1` from `t=0.9999` produced up to **58.8157 units**. These are control-point distances, **not measured pixels or rotation degrees**.

## Patch

Only `js/gpu/spiral-bezier-morph-renderer.js` behavior modified. For `liveRoundedSpline` only, smoothly blend the dynamically constructed current rail toward immutable prepared endpoint rails over the first and last 15% of geometric progress (with smoothstep and zero abrupt boundary value jumps). Exact t=0/1 paths remain unmodified; the middle 70% is unaltered. The prior, per-branch rotational template cache is preserved using a defensive clone only for the shared reference in the two boundary windows; output controls are modified in place rather than allocating an additional complete rail per branch. No change to Spline+ builder itself, phase clocks, N/K, normal rotation, Fill band pairing, or authored project data.

## Test results

- **New regression on old 12.7.0:** FAIL, as expected, already on phase 1 end. Additional diagnostic raw output showed up to ~92.26 at phase 2 start.
- **Same regression on 12.7.1:** PASS, five consecutive phases. `t=0 ↔ 0.000001` maximal control deltas per phase: ~1.61e-13, 1.23e-8, 7.84e-9, 9.43e-9, 4.68e-9. `t=.9999 ↔ 1` deltas all <0.0001 in this test.
- **Three spiral layers, three consecutive handoffs each:** PASS: 9 old-end/new-start comparisons with zero Canvas2D alpha difference; 9 new-start/epsilon control differences <0.003 units.
- **13 existing regression checks:** PASS: `static-modules`, `browser-preflight`, 5-phase strict t=1↔0, three-layer, Topology spline rotation, Calm spline rotation, 14-phase soak, golden 12.6.3 Spline+, GPU cubic carrier browser, exact fast parity, Fill cyclic band seam, legacy spline seam, Fill toggle continuity.
- **Short software Chromium 900×600 benchmark with three spirals:** 12.7.0: 29.96 / 35.05 FPS (two windows); 12.7.1: 31.89 / 35.87 FPS. This is a noisy **CPU/software** comparison, not a GPU FPS claim or robust performance improvement.

## Not certified

The screenshot represents real hardware behavior that software tests cannot certify. Hardware NVIDIA GPU output, all branch/shape combinations, exact Fill pixel parity under every topology, and C1 time-velocity continuity are not verified. Especially, endpoint taper guarantees C0 limits at tested seams but does not guarantee nonzero smooth velocity across every randomly chosen next phase; full infinite-time C1 transport remains future work. The known hardware FPS problem is not solved by this patch.
