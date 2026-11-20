import '../../geometry/morph-math.js'; // initialisation order: this module runs after it

window.SomataMorphRegistry.register('topology', {
  corridorPhase: false,
  style: 'linear',
  spiral: true,
  polygonVertex: SomataMorphMath.linear,
  polygonPlan: (ctx) =>
    SomataMorphMath.polygonCorrespondence(ctx, { pairing: 'cycle', phaseOnOrbitChange: true }),
  prepareAnchors(ctx, h) {
    return h.polygon(ctx, this.polygonVertex.bind(this), this.polygonPlan(ctx));
  },
});
