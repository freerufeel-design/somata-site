import './circleSlide.js'; // initialisation order: this module runs after it
import {
  getEffectiveSpiralOrder,
  getEffectiveSpiralStep,
  getSpiralAngularVertexCount,
} from '../../geometry/spiral/order-params.js';

window.SomataMorphRegistry.register('fade', {
  slideSetting: false,
  fadeSetting: true,
  corridorPhase: false,
  style: 'opacity',
  spiral: false,
  prepareAnchors({ source, target, a, b }) {
    const group = (paths, layer, profileEndpoint) =>
      paths.map((path, i) => ({
        ...path,
        orbitIndex: profileEndpoint === 'source' ? i : source.length + i,
        profileEndpoint,
        fixedOrder: getEffectiveSpiralOrder(layer),
        fixedTwist: layer.spiralTwist === true ? 1 : 0,
        fixedSpiralStep: getEffectiveSpiralStep(layer),
        fixedAngularN: getSpiralAngularVertexCount(layer),
      }));
    const outgoing = group(source, a, 'source'),
      incoming = group(target, b, 'target');
    return (t) => [
      ...outgoing.map((p) => ({ ...p, alpha: 1 - t })),
      ...incoming.map((p) => ({ ...p, alpha: t })),
    ];
  },
});
