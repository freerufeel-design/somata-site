import './effect-owner-service.js'; // initialisation order: this module runs after it

const SomataCompositorContract = Object.freeze({
  pathFxReplacesBase(frameCtx) {
    return frameCtx?._pathFxReplacementCommitted === true;
  },
  forceCanvasBaseStroke(_frameCtx) {
    return false;
  },
});
window.SomataCompositorContract = SomataCompositorContract;
window.isPathFxBaseReplacementActive = (frameCtx) => SomataCompositorContract.pathFxReplacesBase(frameCtx);
window.shouldForceCanvasBaseStroke = (frameCtx) => SomataCompositorContract.forceCanvasBaseStroke(frameCtx);
