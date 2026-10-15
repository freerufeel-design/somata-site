# Somata 7.8.3 — Topology Lamps: spline motion, exclusive corners, corner inertia

## Base

Built on `Somata_7.8.3_stable_fill_fade_hardness_fix.zip`.

The Fill/Web/MSAA/fade/Topology-Particle fixes from that stable baseline are preserved.

## User-visible problems fixed

### 1. Topology lamps could teleport along the profile

After the previous FrameContour attachment fix, lamps were on the correct visible profile, but the final coordinate was still solved using a fresh nearest-point projection every frame.

On a spline with self-intersections or two spatially close branches, the geometrically nearest segment can change abruptly. The lamp therefore remained on the profile but jumped to a remote arc position.

### 2. `На изломах` duplicated key lamps

The later code explicitly merged:

```text
key lamps + corner lamps
```

for `positionMode='corners'`, in both Static and Morph.

That behavior was different from the useful v505 corner semantics and produced two lamps at the same position when a key point was also a bend.

### 3. Corner inertia was visually masked / did not express a full attack

Corner lamps already had a motion runtime, but key lamps were simultaneously visible at the same location. In addition, geometric bend strength was used as the target lamp level, so the configured corner inertia did not necessarily mean “time to full brightness”.

## New contract

### Stable identity first, spline attachment second

For ordinary Topology/Calm Morph with contour sticking enabled:

```text
Topology lineage / identity
          ↓
stable blue lamp identity
          ↓
FrameContour profile-arc state
(pathIndex + arc fraction)
          ↓
point sampled on current FrameContour.paths
```

The final attachment never uses a fresh unconstrained nearest-point solve as the displayed coordinate.

If topology publishes `lampAttachFraction`, it is used directly as the continuous arc coordinate. Otherwise nearest projection only establishes/updates a target fraction relative to the previous arc position, and the lamp advances along the spline with bounded arc motion.

A profile-attached lamp no longer uses the short straight-line XY handoff from `preserveBlueMorphLampIdentity`; that would create a chord away from the spline.

Stable identity is resolved before profile attachment, so a new raw topology slot at a Morph-cycle boundary reuses the same `profile-arc` state instead of creating a new attachment at a remote point.

### `На изломах` is exclusive

`positionMode='corners'` now means:

```text
corner/bend lamps only
```

Key lamps are emitted only by the Key mode.

This is true in both Static and Morph.

### `Инерция излома` is Morph-only brightness timing

During Morph:

- a newly detected bend starts at lamp level 0;
- it reaches full level 1.0 in exactly the configured corner-inertia duration under uninterrupted frame time;
- a disappearing bend releases toward 0 through the same temporal mechanism.

In Static:

- a detected corner is immediately level 1.0;
- corner inertia is not applied.

## Files changed

- `js/app/lamp-audio-core.js`
- `js/geometry/frame-paths.js`
- `js/geometry/lamp-corner-resource.js`
- `js/app/ui-project-runtime.js`
- `index.html`
- `ARCHITECTURE.md`
- new regression: `tests/v783-topology-lamp-spline-motion-corners-regression.js`

No changes were made to Particle geometry, Fill/Web geometry, Morph geometry, FrameContour construction or strict-Spiral carrier mathematics.

## New regression

`tests/v783-topology-lamp-spline-motion-corners-regression.js`

It checks:

1. a published topology arc fraction is sampled exactly on the profile spline;
2. a spatial move between two nearby but arc-distant branches cannot teleport the same lamp in one frame;
3. Static corner mode contains only the direct corner population;
4. Morph corner mode contains only the direct corner population;
5. with `cornerInertiaSec=1` a new Morph corner is dark at t=0, ~25% at 0.25 s and 100% at 1.0 s;
6. Static corner mode is immediately 100% bright.

Result: **PASS**.

## Regression gate

Passed after the fix:

- `v783-topology-lamp-spline-motion-corners-regression.js`
- `v783-topology-profile-attachment-authority-regression.js`
- `v783-topology-lamp-v505-sticking-regression.js`
- `graffiti-glow-lamp-blend-regression.js`
- `v780-shared-frame-contour-regression.js`
- `v782-corridor-frame-contour-regression.js`
- `v763-spiral-carrier-profile-invariant.js`
- `gpu-effect-scene-routing.js` — 6/6
- `v783-fill-fade-modes-regression.js`
- `v783-fill-fade-hardness-monotonic-regression.js`
- `v783-fill-msaa-isolation-regression.js`
- `static-modules.js`
- `contracts.js`
- `effect-render-impact.js` — 12/12

Known baseline failure remains unchanged:

- `lamp-freeze-static-regression.js` → `Graffiti glow warm-up misses are not retried`

This failure existed before the current Lamps fix and is unrelated to topology lamp attachment/corner semantics.
