import './fade.js'; // initialisation order: this module runs after it
import {
  getEffectiveSpiralOrder,
  getEffectiveSpiralStep,
  getSpiralAngularVertexCount,
} from '../../geometry/spiral/order-params.js';

// Light uses the current animation phase continuously, with no frame holds or opacity blending.
(() => {
  window.SomataMorphRegistry.register('light', {
    slideSetting: false,
    corridorPhase: false,
    style: 'discrete',
    spiral: false,
    sampledLayer: true,
    // The controller has already sampled the Light keyframe. Never replace
    // it with an artificial midpoint switch between the endpoints.
    prepareAnchors({ a, b }, h) {
      return (t, frame) => {
        const layer = frame?.layer || (t < 0.5 ? a : b);
        return h.anchors(layer).map((path) => ({
          ...path,
          profileLayer: layer,
          fixedOrder: getEffectiveSpiralOrder(layer),
          fixedTwist: layer.spiralTwist === true ? 1 : 0,
          fixedSpiralStep: getEffectiveSpiralStep(layer),
          fixedAngularN: getSpiralAngularVertexCount(layer),
          spiralConnected: layer.spiralClosed !== false,
        }));
      };
    },
  });
})();
