import './topology.js'; // initialisation order: this module runs after it

window.SomataMorphRegistry.register('circleSlide', {
  corridorPhase: false,
  style: 'angular',
  spiral: false,
  polygonVertex: SomataMorphMath.angular,
  polygonPlan: (ctx) =>
    SomataMorphMath.polygonCorrespondence(ctx, { pairing: 'cycle', phaseOnOrbitChange: true }),
  prepareAnchors(ctx, h) {
    return h.polygon(ctx, this.polygonVertex.bind(this), this.polygonPlan(ctx));
  },
});
