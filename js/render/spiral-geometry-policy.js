window.__spiroRegisterModule?.('js/render/spiral-geometry-policy');

// Spiral is a geometry plugin. Its presentation quirks are registered here so optional
// effects do not depend on Spiral-specific globals. Compatibility aliases remain for
// older GPU kernels, but render passes use SomataGeometryPolicy.
(function(){
    const spiralLayer=(layer)=>Boolean(layer&&typeof isSpiralLayer==='function'&&isSpiralLayer(layer));
    function matches(frameCtx){
        if(typeof state!=='undefined'&&state?.fourierMode===true)return false;
        return Boolean(spiralLayer(frameCtx?.layer)||spiralLayer(frameCtx?.sourceLayer)||spiralLayer(frameCtx?.geometryPlan?.sourceLayer)||spiralLayer(frameCtx?.geometryPlan?.targetLayer)||spiralLayer(frameCtx?.blueMorphProvider?.sourceLayer)||spiralLayer(frameCtx?.blueMorphProvider?.targetLayer));
    }
    function strict(frameCtx){
        if(typeof SOMATA_STRICT_SPIRAL_GPU_PRESENTATION!=='undefined'&&!SOMATA_STRICT_SPIRAL_GPU_PRESENTATION)return false;
        if(typeof state!=='undefined'&&state?.fourierMode===true||!frameCtx)return false;
        if(matches(frameCtx))return true;
        try{const rec=typeof currentGpuBezierMorphResource==='function'?currentGpuBezierMorphResource(frameCtx.layerIndex):null;const liveMorphAuthority=frameCtx.morphFrameActive===true||frameCtx.geometryPlan?.dynamic===true;if(liveMorphAuthority&&rec?.specialSpiralBezierRail===true&&rec?.gpuOnlySpiralEffects===true)return true;}catch(_){ }
        return false;
    }
    function entryIntent(displayLayers){
        if(typeof SOMATA_STRICT_SPIRAL_GPU_PRESENTATION!=='undefined'&&!SOMATA_STRICT_SPIRAL_GPU_PRESENTATION)return false;
        if(typeof state!=='undefined'&&state?.fourierMode===true)return false;
        if(Array.isArray(displayLayers)&&displayLayers.some(layer=>layer?.visible!==false&&spiralLayer(layer)))return true;
        const rt=typeof runtimeState!=='undefined'?runtimeState?.morph:null;
        if(rt?.active===true){const src=Array.isArray(rt.renderSourceLayers)?rt.renderSourceLayers:[],dst=Array.isArray(rt.renderTargetLayers)?rt.renderTargetLayers:[],n=Math.max(src.length,dst.length);for(let i=0;i<n;i++)if(spiralLayer(src[i])||spiralLayer(dst[i]))return true;}
        return false;
    }
    function ineligibleReason(frameCtx,consumer){
        const kind=String(consumer||'');
        try{
            if(kind==='web'||kind==='outline')return typeof gpuMorphWebIneligibleReason==='function'?gpuMorphWebIneligibleReason(frameCtx,true):'exact geometry Web rail unavailable';
            if(kind==='lightning'||kind==='sweep'||kind==='profile'||kind==='motion'||kind==='sprite')return typeof gpuMorphArcIneligibleReason==='function'?gpuMorphArcIneligibleReason(frameCtx):'exact geometry Arc rail unavailable';
        }catch(_){ }
        return'exact geometry authority unavailable';
    }
    SomataGeometryPolicy.register('spiral',{
        matches,strict,entryIntent,ineligibleReason,
        graphRequiresNativeFill(frameCtx){return matches(frameCtx);},
        ensureEffectSceneRoot(frameCtx){return typeof ensureStrictSpiralEffectLayerSceneRoot==='function'?ensureStrictSpiralEffectLayerSceneRoot(frameCtx):false;},
        canUseFrameScene(frameCtx){return typeof canUseGpuSpiralBezierFrameScene==='function'?canUseGpuSpiralBezierFrameScene(frameCtx):false;},
        canUseLayerScene(frameCtx,allowHiddenGraffitiCarrier=false){return typeof canUseGpuSpiralBezierLayerScene==='function'?canUseGpuSpiralBezierLayerScene(frameCtx,allowHiddenGraffitiCarrier):false;},
        sceneRoute(frameCtx,allowHiddenGraffitiCarrier=false){return typeof resolveGpuSpiralBezierSceneRoute==='function'?resolveGpuSpiralBezierSceneRoute(frameCtx,allowHiddenGraffitiCarrier):null;}
    },100);

    // Compatibility surface for GPU modules that have not yet been converted to the
    // semantic policy API. These aliases contain no independent policy logic.
    window.__somataLegacyStrictSpiralFrame=(frameCtx)=>SomataGeometryPolicy.isStrict(frameCtx);
})();
