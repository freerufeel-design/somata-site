import './unfold.js'; // initialisation order: this module runs after it

window.SomataZeroOrderModeProfiles.honest = Object.freeze({
  populated: true,
  shapeProgress: (t, ease) => t,
  orderProgress: (t, shapeProgress) => t,
});
