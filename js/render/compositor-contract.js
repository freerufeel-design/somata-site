window.__spiroRegisterModule?.('js/render/compositor-contract');

// Tiny renderer-neutral predicates shared by geometry/effect modules.
// These used to be functions in main-pipeline.js, creating an inverted dependency
// where leaf modules imported behavior from the top-level compositor.
const SomataCompositorContract=Object.freeze({
    pathFxReplacesBase(frameCtx){return frameCtx?._pathFxReplacementCommitted===true;},
    forceCanvasBaseStroke(_frameCtx){return false;}
});
window.SomataCompositorContract=SomataCompositorContract;
window.isPathFxBaseReplacementActive=(frameCtx)=>SomataCompositorContract.pathFxReplacesBase(frameCtx);
window.shouldForceCanvasBaseStroke=(frameCtx)=>SomataCompositorContract.forceCanvasBaseStroke(frameCtx);
