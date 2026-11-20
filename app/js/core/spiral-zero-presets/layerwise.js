import './honest.js'; // initialisation order: this module runs after it

window.SomataZeroOrderModeProfiles.layerwise = Object.freeze({
  populated: false,
  shapeProgress: (t, ease) => ease(t),
  orderProgress: (t, shapeProgress) => shapeProgress,
});
