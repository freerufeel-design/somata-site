window.__spiroRegisterModule?.('js/render/morph-provider-service');

// Morph systems publish one neutral per-frame provider contract. The render orchestrator
// consumes this service and does not own Blue/Orange/Green provider construction. Optional
// effects consume semantic frame fields later; they do not participate in provider choice.
function prepareMorphProviderFrameSnapshot(renderFrame) {
    const bundle=renderFrame.morphProviders || (renderFrame.morphProviders={blue:{},orange:{},green:{}});
    const blueConfig=state.morph || {}, blueRuntime=runtimeState.morph;
    const orangeConfig=state.minimalMorph || {}, orangeRuntime=runtimeState.minimalMorph;
    const greenConfig=state.projectMorph || {}, greenRuntime=runtimeState.projectMorph;
    const blue=bundle.blue, orange=bundle.orange, green=bundle.green;

    blue.config=blueConfig;
    blue.runtime=blueRuntime;
    blue.active=Boolean(blueRuntime.active && blueRuntime.exactStartPending !== true);
    blue.paused=blueRuntime.paused===true;
    blue.mode=blueConfig.mode || 'circleSlide';
    blue.options=blueConfig.options || {};
    blue.geometryT=Number.isFinite(blueRuntime.geometryT)?blueRuntime.geometryT:0;
    blue.progress=Number(blueRuntime.progress)||0;
    blue.monoOrbitTransforms=blueConfig.monoOrbitTransforms===true;
    blue.sourceGeometry=blueRuntime.sourceGeometry || [];
    blue.targetGeometry=blueRuntime.targetGeometry || [];
    blue.sourceProfiles=blueRuntime.sourceProfiles || [];
    blue.targetProfiles=blueRuntime.targetProfiles || [];
    blue.sourceVisuals=blueRuntime.sourceVisuals || [];
    blue.targetVisuals=blueRuntime.targetVisuals || [];
    blue.renderSourceLayers=blueRuntime.renderSourceLayers || [];
    blue.renderTargetLayers=blueRuntime.renderTargetLayers || [];
    blue.lightLayers=blueRuntime.lightLayers || [];
    blue.lightDrawData=blueRuntime.lightDrawData || [];
    blue.lightScales=blueRuntime.lightScales || [];
    blue.lightRotations=blueRuntime.lightRotations || [];
    blue.lightningCycleColor=blueRuntime.lightningCycleColor || '#ffffff';
    blue.frameLayers=blueRuntime.frameLayers || [];
    blue.profileCarrierPlans=blueRuntime.profileCarrierPlans || [];
    blue.phaseSerial=Math.max(0,Number(blueRuntime.phaseSerial)||0)>>>0;

    orange.config=orangeConfig;
    orange.runtime=orangeRuntime;
    orange.active=orangeRuntime.active===true;
    orange.transitioning=Boolean(orange.active && orangeRuntime.transitioning);
    orange.progress=Math.max(0,Math.min(1,Number(orangeRuntime.progress)||0));
    orange.sourceLayers=orangeRuntime.sourceLayers || [];
    orange.targetLayers=orangeRuntime.targetLayers || [];
    orange.sourceDrawData=orangeRuntime.sourceDrawData || [];
    orange.targetDrawData=orangeRuntime.targetDrawData || [];
    orange.sourceLampPoints=orangeRuntime.sourceLampPoints || [];
    orange.targetLampPoints=orangeRuntime.targetLampPoints || [];

    green.config=greenConfig;
    green.runtime=greenRuntime;
    green.enabled=greenRuntime.active===true;
    green.active=greenRuntime.active===true && greenRuntime.transitionActive===true;
    green.transitionType=greenConfig.transitionType || 'smooth';
    green.renderMode=greenRuntime.renderMode || ((green.transitionType==='fade'||(green.transitionType==='linear'&&greenConfig.advancedLinear!==true))?'crossfade':'morph');
    green.progress=Number.isFinite(Number(greenRuntime.renderProgress)) ? Number(greenRuntime.renderProgress) : (Number(greenRuntime.progress)||0);
    green.parameterProgress=Number.isFinite(Number(greenRuntime.parameterProgress)) ? Number(greenRuntime.parameterProgress) : green.progress;
    green.fadeProgress=Math.max(0,Math.min(1,Number(greenRuntime.fadeProgress)||0));
    green.frameGeometry=greenRuntime.frameGeometry || [];
    green.sourceGeometry=greenRuntime.sourceGeometry || [];
    green.targetGeometry=greenRuntime.targetGeometry || [];
    green.sourceRenderLayers=greenRuntime.sourceRenderLayers || [];
    green.targetRenderLayers=greenRuntime.targetRenderLayers || [];
    green.frameExtents=greenRuntime.frameExtents || [];
    green.frameLampPoints=greenRuntime.frameLampPoints || [];
    green.lampPlans=greenRuntime.lampPlans || [];
    return bundle;
}

function resetLayerMorphProvider(provider,system) {
    provider.system=system;
    provider.active=false;
    provider.geometryActive=false;
    provider.kind='static';
    provider.progress=0;
    provider.sourceLayer=null;
    provider.targetLayer=null;
    provider.renderLayer=null;
    provider.sourceData=null;
    provider.targetData=null;
    provider.sourceGeometry=null;
    provider.targetGeometry=null;
    provider.sourcePaths=null;
    provider.targetPaths=null;
    provider.framePaths=null;
    provider.frameLampPoints=null;
    provider.sourceLampPoints=null;
    provider.targetLampPoints=null;
    provider.extent=0;
    provider.lightMorphEnabled=false;
    provider.forcedLampMorph=false;
    provider.lightningFlashAlpha=0;
    provider.circleAngular=false;
    provider.topology=false;
    provider.byTopology=false;
    provider.sourceProfileMode=null;
    provider.targetProfileMode=null;
    provider.carrierKind='polygon';
    provider.spiralTransport='polygon';
    provider.circleAlgorithm=false;
    return provider;
}

function buildBlueExactEndpointLayer(baseLayer,visual,profile){
    const snap={...(baseLayer||{}),...(visual||{})};
    const raw=Array.isArray(profile?.rawNodes)&&profile.rawNodes.length?profile.rawNodes:(Array.isArray(profile?.nodes)?profile.nodes:(baseLayer?.profileNodes||[]));
    snap.profileMode=profile?.mode||baseLayer?.profileMode||'segments';
    snap.profileNodes=(raw||[]).map(p=>({x:Number(p?.x)||0,y:Number(p?.y)||0}));
    // Endpoint snapshots are authored/static geometry, never the paired/resampled Morph grid.
    try{if(typeof setPreSampledSplineLayer==='function')setPreSampledSplineLayer(snap,false);}catch(_){}
    return snap;
}

function resolveBlueMorphLayerProvider(frameCtx,renderFrame) {
    const layerIndex=frameCtx.layerIndex;
    const sourceLayer=frameCtx.sourceLayer;
    const snap=renderFrame.morphProviders.blue;
    const provider=resetLayerMorphProvider(frameCtx.blueMorphProvider || (frameCtx.blueMorphProvider={}), 'blue');
    provider.active=snap.active;
    provider.mode=snap.mode;
    provider.geometryT=snap.geometryT;
    provider.progress=snap.progress;
    provider.options=snap.options;
    const carrierPlan=snap.profileCarrierPlans?.[layerIndex]||null;
    provider.carrierKind=carrierPlan?.carrierKind||'polygon';
    provider.spiralTransport=carrierPlan?.spiralTransport||'polygon';
    provider.circleAlgorithm=snap.mode==='circleSlide';
    provider.lightMorphEnabled=Boolean(snap.active && snap.mode==='light' && !snap.monoOrbitTransforms);
    provider.forcedLampMorph=Boolean(snap.active && snap.mode==='lightning');
    provider.lightningFlashAlpha=provider.forcedLampMorph ? getLightningFlashAlpha(snap.progress) : 0;

    provider.renderLayer=provider.lightMorphEnabled ? (snap.lightLayers[layerIndex] || sourceLayer) : sourceLayer;
    provider.lightScale=provider.lightMorphEnabled ? Math.max(.05,Number(snap.lightScales[layerIndex])||1) : 1;
    provider.lightRotation=provider.lightMorphEnabled ? (Number(snap.lightRotations[layerIndex])||0) : 0;
    provider.lightDrawData=provider.lightMorphEnabled ? (snap.lightDrawData[layerIndex]||null) : null;
    provider.sourceGeometry=snap.sourceGeometry[layerIndex]||null;
    provider.targetGeometry=snap.targetGeometry[layerIndex]||null;
    provider.sourceProfileMode=snap.sourceProfiles?.[layerIndex]?.mode || snap.renderSourceLayers?.[layerIndex]?.profileMode || sourceLayer?.profileMode || 'segments';
    provider.targetProfileMode=snap.targetProfiles?.[layerIndex]?.mode || snap.renderTargetLayers?.[layerIndex]?.profileMode || provider.sourceProfileMode;
    const sourceChaos=(snap.renderSourceLayers?.[layerIndex]?.chaosStar===true)||(snap.sourceVisuals?.[layerIndex]?.chaosStar===true)||(sourceLayer?.chaosStar===true);
    const targetChaos=(snap.renderTargetLayers?.[layerIndex]?.chaosStar===true)||(snap.targetVisuals?.[layerIndex]?.chaosStar===true);
    const specialSpiralEndpoint=Boolean(snap.renderSourceLayers?.[layerIndex]?.spiralEnabled===true||snap.renderTargetLayers?.[layerIndex]?.spiralEnabled===true||sourceLayer?.spiralEnabled===true);
    const specialSpiralExtraGeometry=specialSpiralEndpoint&&Boolean(snap.options.byRounding||snap.options.bySize||snap.options.byRotation||snap.options.bySpiralOrder||snap.options.bySpiralLayers);
    const specialSpiralGeometryRequested=specialSpiralEndpoint&&Boolean(snap.options.byVertices||snap.options.bySteps||snap.options.byShape||snap.monoOrbitTransforms||specialSpiralExtraGeometry);

    const retainedSpiralMode=Boolean(specialSpiralGeometryRequested&&typeof spiralMorphUsesRetainedBezierRail==='function'&&spiralMorphUsesRetainedBezierRail());
    const strictContinuousSpiral=Boolean(retainedSpiralMode&&specialSpiralEndpoint&&typeof spiralMorphForcesContinuousRail==='function'&&spiralMorphForcesContinuousRail());
    const effectiveCircleMode=snap.mode==='circleSlide';

    const directChaosCircleMode=Boolean(!provider.lightMorphEnabled&&snap.active&&effectiveCircleMode&&(sourceChaos||targetChaos));
    provider.circleAngular=Boolean(!provider.lightMorphEnabled && !sourceChaos && !targetChaos && snap.active && effectiveCircleMode &&
        (snap.options.byVertices || snap.options.bySteps || snap.options.byShape || snap.monoOrbitTransforms || specialSpiralExtraGeometry));
    provider.topology=Boolean(!provider.lightMorphEnabled && snap.active && (directChaosCircleMode || (provider.sourceGeometry &&
        (sourceChaos || targetChaos || snap.options.byShape || snap.options.byVertices || snap.options.bySteps || snap.monoOrbitTransforms ||
         snap.options.byRounding || snap.options.bySize ||
         (snap.options.byRotation && !renderFrame.audioRotationOverride) || snap.mode==='fade' || snap.mode==='lightning'))));
    provider.geometryActive=provider.circleAngular || provider.topology;
    provider.progress=snap.geometryT;
    provider.byTopology=Boolean(snap.options.byVertices || snap.options.bySteps || snap.monoOrbitTransforms);
    if (snap.mode==='lightning') provider.kind='lightning';
    else if (provider.geometryActive && snap.mode==='fade' && !strictContinuousSpiral) {
        // Fade is a cross-fade of two exact static states. Do not rebuild either endpoint
        // through the Morph resampling pipeline: that changes spline tangents/corners.
        provider.kind='blue-fade';
    } else if (provider.geometryActive && provider.circleAngular && effectiveCircleMode &&
        (snap.options.byVertices || snap.options.bySteps || snap.options.byShape || snap.monoOrbitTransforms || specialSpiralExtraGeometry)) {
        provider.kind='blue-circle-slide';
    } else if (provider.geometryActive && effectiveCircleMode && (sourceChaos || targetChaos)) provider.kind='blue-prepared';
    else if (provider.geometryActive && !specialSpiralEndpoint && !sourceChaos && !targetChaos) {
        // Polygon Morph invariant: move only the carrier vertices; rebuild the contour from
        // the same authored profile used by static rendering. No resampling of the finished path.
        provider.kind='blue-anchor-linear';
    } else if (provider.geometryActive) provider.kind='blue-prepared';
    else provider.kind=provider.lightMorphEnabled?'light-static':'static';
    // Exact endpoint layers are consumed only by fade, circle-slide and
    // polygon-anchor providers. Building them for static/lightning/prepared
    // frames used to clone two layers and every profile node per render pass.
    if(provider.kind==='blue-fade'||provider.kind==='blue-circle-slide'||provider.kind==='blue-anchor-linear'){
        const exactSourceLayer=buildBlueExactEndpointLayer(sourceLayer,snap.sourceVisuals?.[layerIndex],snap.sourceProfiles?.[layerIndex]);
        const exactTargetLayer=buildBlueExactEndpointLayer(sourceLayer,snap.targetVisuals?.[layerIndex],snap.targetProfiles?.[layerIndex]);
        provider.sourceLayer=exactSourceLayer;
        provider.targetLayer=exactTargetLayer;
        if(provider.kind==='blue-fade'){
            provider.sourceData=getCachedLayerDrawData(exactSourceLayer);
            provider.targetData=getCachedLayerDrawData(exactTargetLayer);
        }
    }
    provider.lightningColor=snap.lightningCycleColor;
    return provider;
}

function resolveOrangeMorphLayerProvider(frameCtx,renderFrame) {
    const layerIndex=frameCtx.layerIndex;
    const snap=renderFrame.morphProviders.orange;
    const provider=resetLayerMorphProvider(frameCtx.orangeMorphProvider || (frameCtx.orangeMorphProvider={}), 'orange');
    provider.active=snap.transitioning;
    provider.progress=snap.progress;
    provider.sourceLayer=snap.sourceLayers[layerIndex]||null;
    provider.targetLayer=snap.targetLayers[layerIndex]||null;
    provider.sourceData=snap.sourceDrawData[layerIndex]||null;
    provider.targetData=snap.targetDrawData[layerIndex]||null;
    provider.sourceLampPoints=snap.sourceLampPoints[layerIndex]||null;
    provider.targetLampPoints=snap.targetLampPoints[layerIndex]||null;
    provider.geometryActive=Boolean(snap.transitioning && (provider.sourceData || provider.targetData));
    provider.kind=provider.geometryActive?'orange-fade':'static';
    provider.extent=provider.geometryActive ? Math.max(Number(provider.sourceData?.maxRadius)||0,Number(provider.targetData?.maxRadius)||0,1) : 0;
    return provider;
}

function resolveGreenMorphLayerProvider(frameCtx,renderFrame) {
    const layerIndex=frameCtx.layerIndex;
    const snap=renderFrame.morphProviders.green;
    const provider=resetLayerMorphProvider(frameCtx.greenMorphProvider || (frameCtx.greenMorphProvider={}), 'green');
    const paths=snap.active?snap.frameGeometry[layerIndex]:null;
    const gpuPlan=snap.active?snap.runtime?.geometryPlans?.[layerIndex]:null;
    const crossfade=snap.active&&snap.renderMode==='crossfade';
    const hasEndpointGeometry=Boolean((snap.sourceGeometry[layerIndex]?.length||0)||(snap.targetGeometry[layerIndex]?.length||0));
    const hasMorphPlan=Boolean(gpuPlan?.pairs?.length);
    provider.active=snap.active;
    provider.geometryActive=Boolean(snap.active&&(crossfade?hasEndpointGeometry:(hasMorphPlan||(Array.isArray(paths)&&paths.length>0))));
    provider.framePaths=Array.isArray(paths)&&paths.length?paths:null;
    provider.progress=snap.progress;
    provider.parameterProgress=snap.parameterProgress;
    provider.frameLampPoints=snap.frameLampPoints[layerIndex]||null;
    provider.lampPlan=snap.lampPlans[layerIndex]||null;
    provider.gpuGeometryPlan=gpuPlan||null;
    provider.extent=provider.geometryActive?Math.max(1,Number(snap.frameExtents[layerIndex])||1):0;
    if(provider.geometryActive&&crossfade){
        provider.kind='green-fade';
        provider.progress=snap.fadeProgress;
        provider.sourcePaths=snap.sourceGeometry[layerIndex]||null;
        provider.targetPaths=snap.targetGeometry[layerIndex]||null;
        provider.sourceLayer=snap.sourceRenderLayers[layerIndex]||null;
        provider.targetLayer=snap.targetRenderLayers[layerIndex]||null;
    }else if(provider.geometryActive)provider.kind='green-morph';
    return provider;
}

function resolveMainLayerMorphProviders(frameCtx,renderFrame) {
    const blue=resolveBlueMorphLayerProvider(frameCtx,renderFrame);
    const orange=resolveOrangeMorphLayerProvider(frameCtx,renderFrame);
    const green=resolveGreenMorphLayerProvider(frameCtx,renderFrame);
    frameCtx.geometryProvider = green.geometryActive ? green : (orange.geometryActive ? orange : blue);
    return {blue,orange,green,geometry:frameCtx.geometryProvider};
}

function resolveMainLayerFrameSource(frameCtx, renderFrame) {
    const layerIndex=frameCtx.layerIndex;
    const orange=renderFrame.morphProviders.orange;
    const minimalTransition=orange.transitioning;
    const resolvedDisplayLayer=(!minimalTransition&&typeof SpiroMorphController!=='undefined')
        ? SpiroMorphController.getDisplayLayerAt(layerIndex)
        : null;
    const sourceLayer=minimalTransition
        ? (orange.sourceLayers[layerIndex] || orange.targetLayers[layerIndex])
        : (resolvedDisplayLayer || state.layers[layerIndex]);
    if(!sourceLayer)return false;
    const minimalSourceLayer=minimalTransition?orange.sourceLayers[layerIndex]:null;
    const minimalTargetLayer=minimalTransition?orange.targetLayers[layerIndex]:null;
    if(!minimalTransition){
        const authored=state.layers?.[layerIndex];
        if(authored&&sourceLayer!==authored)sourceLayer.visible=authored.visible!==false;
        if(sourceLayer.visible===false)return false;
    }
    if(minimalTransition && minimalSourceLayer?.visible===false && minimalTargetLayer?.visible===false)return false;
    frameCtx.sourceLayer=sourceLayer;
    frameCtx.minimalSourceLayer=minimalSourceLayer;
    frameCtx.minimalTargetLayer=minimalTargetLayer;
    return true;
}

const SomataMorphProviderService=Object.freeze({
    prepareFrameSnapshot:prepareMorphProviderFrameSnapshot,
    resolveLayerProviders:resolveMainLayerMorphProviders,
    resolveFrameSource:resolveMainLayerFrameSource
});
window.SomataMorphProviderService=SomataMorphProviderService;
window.__somataMorphProviderStatus=()=>({contract:'Blue/Orange/Green Morph provider selection is isolated from optional render effects.'});
