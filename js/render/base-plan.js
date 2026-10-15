window.__spiroRegisterModule?.('js/render/base-plan');

// Self-owned feature contract: changing this feature does not require editing the host.
SomataFeatureHost.register('base',{domain:'geometry',plans:['motion','sprite'],reads:['_webPassHandled','_fusedMorphBackend','_webgpuStrokeBatch','_webgpuFillPrepared','_nativeFillMeshCandidate','_corridorNativeFillPreflight','_fillMeshShadow','_geometryContract'],outputs:['_baseStrokeCommitted','_baseStrokeSuppressedByGraffiti','_baseFillCommitted','_corridorLayerSceneActive','_strictSpiralFillDeferred']});

// Base contributes only its semantic stroke role. Optional feature interactions
// (Motion/Sprite replacing Base) are declared as plan dependencies on the Base feature.
SomataFeatureHost?.provide?.('base','strokeBatchSpec',(frameCtx,plans)=>{
    if(shouldForceCanvasBaseStroke(frameCtx))return[];
    const pathFxReplace=isPathFxBaseReplacementActive(frameCtx);
    const motionReplace=pathFxReplace&&plans?.motion?.enabled===true&&plans?.motion?.cfg?.replaceBase===true;
    const spriteReplace=pathFxReplace&&plans?.sprite?.enabled===true&&!lineSpritePlacementIsSparse(plans?.sprite?.cfg?.mode);
    const profileReplace=frameCtx?.lineProfileStrokeOnly===true;
    return[{role:'base',mode:'base',alphaScale:(motionReplace||spriteReplace||profileReplace)?0:Math.max(0,Math.min(1,Number(frameCtx?.lineOpacityFactor??1))),composite:'source-over'}];
});
