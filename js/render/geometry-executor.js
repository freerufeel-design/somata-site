window.__spiroRegisterModule?.('js/render/geometry-executor');

// Geometry execution boundary extracted from main-pipeline in 7.7.9.
// It owns geometry plans/transforms/snapshot execution only; optional effect passes
// consume its frameCtx outputs but do not live here.

function resetMainLayerGeometryPlan(plan) {
    if (!plan) return plan;
    plan.kind='static';
    plan.dynamic=false;
    plan.progress=0;
    plan.framePaths=null;
    plan.sourcePaths=null;
    plan.targetPaths=null;
    plan.sourceLayer=null;
    plan.targetLayer=null;
    plan.sourceData=null;
    plan.targetData=null;
    plan.sourceGeometry=null;
    plan.targetGeometry=null;
    plan.byTopology=false;
    plan.slideTypeOverride=null;
    plan.sourceProfileMode=null;
    plan.targetProfileMode=null;
    return plan;
}

function prepareMainLayerGeometryPlan(frameCtx) {
    const plan=resetMainLayerGeometryPlan(frameCtx.geometryPlan || (frameCtx.geometryPlan={}));
    frameCtx._topologyMorphGpuLazy=false;frameCtx._topologyMorphCpuFallbackMaterialized=false;
    const provider=frameCtx.geometryProvider || frameCtx.blueMorphProvider;
    plan.kind=provider?.kind || 'static';
    plan.dynamic=Boolean(provider?.geometryActive || plan.kind==='lightning');
    plan.progress=Number(provider?.progress)||0;
    plan.framePaths=provider?.framePaths||null;
    plan.sourcePaths=provider?.sourcePaths||null;
    plan.targetPaths=provider?.targetPaths||null;
    plan.sourceLayer=provider?.sourceLayer||null;
    plan.targetLayer=provider?.targetLayer||null;
    plan.sourceData=provider?.sourceData||null;
    plan.targetData=provider?.targetData||null;
    plan.sourceGeometry=provider?.sourceGeometry||null;
    plan.targetGeometry=provider?.targetGeometry||null;
    plan.byTopology=provider?.byTopology===true;
    plan.slideTypeOverride=provider?.slideTypeOverride||null;
    plan.sourceProfileMode=provider?.sourceProfileMode||null;
    plan.targetProfileMode=provider?.targetProfileMode||null;
    frameCtx._greenMorphGpuLazy=false;
    if(plan.kind==='green-morph'&&!plan.framePaths){
        const gpuReady=SomataGeometryRoleService.backendEligible(frameCtx,'green','base')===true;
        frameCtx._greenMorphGpuLazy=gpuReady;
        if(!gpuReady&&typeof ensureProjectMorphFrameGeometryLayer==='function'){
            plan.framePaths=ensureProjectMorphFrameGeometryLayer(frameCtx.layerIndex,plan.progress);
            if(frameCtx.greenMorphProvider)frameCtx.greenMorphProvider.framePaths=plan.framePaths;
        }
    }

    if(plan.kind==='blue-prepared' && !plan.framePaths) {

        const gpuTopologyLazy=SomataGeometryRoleService.backendEligible(frameCtx,'topology','base')===true;
        frameCtx._topologyMorphGpuLazy=gpuTopologyLazy===true;
        if(!gpuTopologyLazy){plan.framePaths=getLayerFrameAuxiliaryPaths(frameCtx);provider.framePaths=plan.framePaths;}
    }
    if(plan.kind==='static' || plan.kind==='light-static') plan.sourceData=frameCtx.staticDrawData;
    return plan;
}

function applyMainGeometryTransform(targetCtx,frameCtx) {
    if (frameCtx.hasCombinedRotation) targetCtx.rotate(frameCtx.combinedRotationRad);
    if (frameCtx.hasCombinedScale) {
        targetCtx.scale(frameCtx.combinedScale,frameCtx.combinedScale);
        targetCtx.lineWidth=(Number(targetCtx.__forcedLineWidth)||frameCtx.strokeWidth)/Math.max(.001,frameCtx.combinedScale);
    }
}

function drawGeometryPlanSnapshot(targetCtx,frameCtx,snapshotLayer,drawData,alphaMultiplier,fadeAlpha) {
    if(!snapshotLayer||!drawData||fadeAlpha<=.001||snapshotLayer.visible===false)return;
    if(getLayerFillMatchStroke(snapshotLayer)||getLayerFillMatchStroke(frameCtx.sourceLayer))syncLayerFillColorToStroke(snapshotLayer,true);
    targetCtx.save();
    targetCtx.lineWidth=(Number(snapshotLayer.strokeWidth)||1.5)/Math.max(.001,frameCtx.audioScale*frameCtx.lightMorphScale);
    targetCtx.strokeStyle=snapshotLayer.strokeColor||'#ffffff';
    targetCtx.fillStyle=snapshotLayer.fillColor||'transparent';
    const opacity=(snapshotLayer.opacity!==undefined?snapshotLayer.opacity:100)/100;
    const lineFactor=targetCtx.__spiroLineOpacityOnly===true?Math.max(0,Math.min(1,(Number.isFinite(Number(snapshotLayer.lineOpacity))?Number(snapshotLayer.lineOpacity):100)/100)):1;
    targetCtx.globalAlpha=opacity*lineFactor*alphaMultiplier*fadeAlpha;
    renderLayerOrbitPaths(targetCtx,snapshotLayer,drawData);
    targetCtx.restore();
}

function drawGreenGeometryPlanSnapshot(targetCtx,frameCtx,snapshotLayer,paths,alphaMultiplier,fadeAlpha) {
    if(!snapshotLayer||!Array.isArray(paths)||!paths.length||fadeAlpha<=.001||snapshotLayer.visible===false)return;
    if(getLayerFillMatchStroke(snapshotLayer)||getLayerFillMatchStroke(frameCtx.sourceLayer))syncLayerFillColorToStroke(snapshotLayer,true);
    targetCtx.save();
    targetCtx.lineWidth=(Number(snapshotLayer.strokeWidth)||1.5)/Math.max(.001,frameCtx.combinedScale);
    targetCtx.strokeStyle=snapshotLayer.strokeColor||'#ffffff';
    targetCtx.fillStyle=snapshotLayer.fillColor||'transparent';
    const opacity=Math.max(0,Math.min(1,Number(snapshotLayer.opacity??100)/100)),lineFactor=targetCtx.__spiroLineOpacityOnly===true?Math.max(0,Math.min(1,(Number.isFinite(Number(snapshotLayer.lineOpacity))?Number(snapshotLayer.lineOpacity):100)/100)):1;
    MorphRendering.drawPreparedMorphGeometry(targetCtx,snapshotLayer,paths,0,opacity*lineFactor*alphaMultiplier*fadeAlpha);
    targetCtx.restore();
}

function executeMainLayerGeometryPlan(targetCtx,frameCtx,alphaMultiplier=1) {
    const plan=frameCtx.geometryPlan;
    const layer=frameCtx.layer;
    const layerIndex=frameCtx.layerIndex;
    const strokeBaseAlpha=targetCtx.__spiroLineOpacityOnly===true?Math.max(0,Math.min(1,Number(frameCtx.lineAlpha??frameCtx.baseAlpha)||0)):frameCtx.baseAlpha;
    targetCtx.save();
    try {

        if(!frameCtx.lineDisplayEnabled)return;

        if(plan.kind==='green-fade' || plan.kind==='green-morph') {
            applyMainGeometryTransform(targetCtx,frameCtx);
            if(plan.kind==='green-fade') {
                drawGreenGeometryPlanSnapshot(targetCtx,frameCtx,plan.sourceLayer,plan.sourcePaths,alphaMultiplier,1-plan.progress);
                drawGreenGeometryPlanSnapshot(targetCtx,frameCtx,plan.targetLayer,plan.targetPaths,alphaMultiplier,plan.progress);
            } else {
                if((!Array.isArray(plan.framePaths)||!plan.framePaths.length)&&typeof ensureProjectMorphFrameGeometryLayer==='function'){
                    plan.framePaths=ensureProjectMorphFrameGeometryLayer(layerIndex,plan.progress);
                    if(frameCtx.greenMorphProvider)frameCtx.greenMorphProvider.framePaths=plan.framePaths;
                    frameCtx._greenMorphCpuFallbackMaterialized=true;
                }
                MorphRendering.drawPreparedMorphGeometry(targetCtx,layer,plan.framePaths||[],plan.progress,strokeBaseAlpha*alphaMultiplier,plan.sourceProfileMode,plan.targetProfileMode);
            }
            return;
        }

        if(plan.kind==='lightning') {
            if(frameCtx.lightningFlashAlpha>.001) {
                applyMainGeometryTransform(targetCtx,frameCtx);
                drawLightningCentralMorph(targetCtx,layerIndex,layer,plan.progress,strokeBaseAlpha*alphaMultiplier*frameCtx.lightningFlashAlpha);
            }
            return;
        }

        if(frameCtx.lightningStroke) {
            targetCtx.strokeStyle=frameCtx.lightningStroke;
            targetCtx.fillStyle='transparent';
            targetCtx.globalAlpha=Math.max(0,Math.min(1,frameCtx.lightningFlashAlpha*alphaMultiplier));
        }
        applyMainGeometryTransform(targetCtx,frameCtx);

        switch(plan.kind) {
            case 'orange-fade':
                drawGeometryPlanSnapshot(targetCtx,frameCtx,plan.sourceLayer,plan.sourceData,alphaMultiplier,1-plan.progress);
                drawGeometryPlanSnapshot(targetCtx,frameCtx,plan.targetLayer,plan.targetData,alphaMultiplier,plan.progress);
                break;
            case 'blue-fade':
                drawGeometryPlanSnapshot(targetCtx,frameCtx,plan.sourceLayer,plan.sourceData,alphaMultiplier,1-plan.progress);
                drawGeometryPlanSnapshot(targetCtx,frameCtx,plan.targetLayer,plan.targetData,alphaMultiplier,plan.progress);
                break;
            case 'blue-circle-slide':
                MorphRendering.drawCircleSlideMorph(targetCtx,layer,plan.sourceLayer,plan.targetLayer,plan.progress,strokeBaseAlpha*alphaMultiplier,plan.slideTypeOverride);
                break;
            case 'blue-anchor-linear':
                MorphRendering.drawLinearAnchorMorph(targetCtx,layer,plan.sourceLayer,plan.targetLayer,plan.progress,strokeBaseAlpha*alphaMultiplier,plan.slideTypeOverride);
                break;
            case 'blue-circle':
                MorphRendering.drawMorphGeometry(targetCtx,layer,plan.sourceGeometry,plan.targetGeometry,plan.progress,strokeBaseAlpha*alphaMultiplier,plan.byTopology,plan.sourceProfileMode,plan.targetProfileMode);
                break;
            case 'blue-prepared':
                if(!plan.framePaths){plan.framePaths=getLayerFrameAuxiliaryPaths(frameCtx);if(frameCtx.geometryProvider)frameCtx.geometryProvider.framePaths=plan.framePaths;frameCtx._topologyMorphCpuFallbackMaterialized=true;}
                MorphRendering.drawPreparedMorphGeometry(targetCtx,layer,plan.framePaths,plan.progress,strokeBaseAlpha*alphaMultiplier,plan.sourceProfileMode,plan.targetProfileMode);
                break;
            case 'light-static':
            case 'static':
            default:
                targetCtx.globalAlpha=strokeBaseAlpha*alphaMultiplier;
                renderLayerOrbitPaths(targetCtx,layer,plan.sourceData||frameCtx.staticDrawData);
                break;
        }
    } finally {
        targetCtx.restore();
    }
}

function prepareMainLayerGeometry(frameCtx) {
    const layer=frameCtx.layer;
    const blue=frameCtx.blueMorphProvider;
    const orange=frameCtx.orangeMorphProvider;
    const green=frameCtx.greenMorphProvider;

    frameCtx.canonicalGeometry=(!frameCtx.geometryMorphEnabled&&!frameCtx.lightMorphEnabled&&typeof getCanonicalLayerGeometry==='function')
        ? getCanonicalLayerGeometry(layer)
        : null;
    frameCtx.staticDrawData=frameCtx.geometryMorphEnabled?null:(
        frameCtx.lightMorphEnabled
            ? (blue?.lightDrawData || getCachedLayerDrawData(layer))
            : (frameCtx.canonicalGeometry?.drawData || getCachedLayerDrawData(layer))
    );
    if(frameCtx.canonicalGeometry&&typeof noteCanonicalGeometryConsumer==='function')noteCanonicalGeometryConsumer('prepareMainLayerGeometry');

    const baseExtent=frameCtx.staticDrawData?.maxRadius || frameCtx.canonicalGeometry?.summary?.maxRadius || Math.max(1,getEffectiveLayerRadius(layer,220)*1.8);
    frameCtx.layerExtent=(green?.geometryActive
        ? green.extent
        : (orange?.geometryActive ? orange.extent : baseExtent))*frameCtx.lightMorphScale;

    const plan=prepareMainLayerGeometryPlan(frameCtx);
    plan.extent=frameCtx.layerExtent;
    frameCtx.drawLayerGeometry=(targetCtx,alphaMultiplier=1)=>executeMainLayerGeometryPlan(targetCtx,frameCtx,alphaMultiplier);
}

