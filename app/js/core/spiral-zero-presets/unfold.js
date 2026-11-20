import '../spiral-zero-transition.js'; // initialisation order: this module runs after it

// Direct winding without Corridor. With Corridor the common planner adds
// reversible closing and opening stages around this geometry phase.
window.SomataZeroOrderModeProfiles.unfold = Object.freeze({
  populated: false,
  shapeProgress: (t) => t,
  orderProgress: (t) => t,
});

// A separate preset: never replace the linked (twisted) Unfold route.
window.SomataZeroOrderModeProfiles.unfoldUntwisted = Object.freeze({
  populated: false,
  shapeProgress: (t, ease) => ease(t),
});

// Same timing; the Seaweed preset restores the original single-seam geometry.
window.SomataZeroOrderModeProfiles.seaweed = window.SomataZeroOrderModeProfiles.unfoldUntwisted;
