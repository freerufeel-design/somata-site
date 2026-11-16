import './layerwise.js'; // initialisation order: this module runs after it

window.SomataZeroOrderModeProfiles.beautiful = Object.freeze({
  populated: true,
  shapeProgress: (t, ease) => ease(t),
  orderProgress: (t, shapeProgress) => shapeProgress,
});
