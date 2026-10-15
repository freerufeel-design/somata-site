window.__spiroRegisterModule?.('js/render/outline-pass');

function renderLayerOutlinePass(frameCtx) {
    const effect=frameCtx.effectsPlan?.outline;
    if(!effect?.enabled)return;
    const strictSpiralOutline=SomataGeometryPolicy.isStrict(frameCtx);
    if(strictSpiralOutline&&frameCtx.lineDisplayEnabled===true&&frameCtx.lineProfileStrokeOnly!==true&&
        frameCtx._baseStrokeCommitted!==true&&!(typeof isPathFxBaseReplacementActive==='function'&&isPathFxBaseReplacementActive(frameCtx))){
        renderBackendTelemetry.mark('outline','gpu','strict Spiral waits for committed Base; outline-only frame suppressed');
        return;
    }
    if(frameCtx._webgpuStrokeBatch?.outlineInScene===true){renderBackendTelemetry.mark('outline','gpu','Layer Scene');return;}
    const {layer,baseAlpha,visibleInstances,frameVectorMaster,frameVectorMasterScale,drawLayerInstances}=frameCtx;
    const mode=['outer','inner','median'].includes(effect.mode)?effect.mode:'outer';
    const outerAdd=Math.max(0,Number(effect.outerAdd)||0),coreInset=Math.max(0,Number(effect.coreInset)||0);
    if(frameCtx.lineProfileStrokeOnly&&frameCtx.lineProfileApplication==='stroke'){
        let ok=true;
        if(outerAdd>0)ok=tryRenderStrokeMarkerEffectGPU(frameCtx,{mode:'outline',extraLocal:outerAdd,colorOverride:effect.color,alpha:baseAlpha,composite:mode==='outer'?'destination-over':'source-over'});
        if(ok&&coreInset>0)ok=tryRenderStrokeMarkerEffectGPU(frameCtx,{mode:'core',colorOverride:effect.color,alpha:baseAlpha,composite:'source-over'});
        if(ok){renderBackendTelemetry.mark('outline','gpu','GPU marker outline');return;}
    }
    if(effect.graffiti){
        if(!effect.paths?.length&&effect.profilePrepared?.gpuMorphNative!==true)return;
        const encode=(targetTexture,styleLayer,composite,opts={})=>{
            if(!targetTexture||!styleLayer)return null;
            mainCtx.save();applyLayerFrameEffectTransform(mainCtx,frameCtx);
            let rec=null;
            try{
                if(effect.profilePrepared?.gpuMorphNative===true){
                    rec=effect.tunnelActive
                        ? WebGPUGraffitiMorphRenderer.encodeCorridorToLayerScene(targetTexture,effect.profilePrepared,styleLayer,baseAlpha,mainCtx,visibleInstances.copies,visibleInstances.alphas,frameCtx,effect.footprint,composite,opts)
                        : WebGPUGraffitiMorphRenderer.encodeToLayerScene(targetTexture,effect.profilePrepared,styleLayer,baseAlpha*Math.max(0,Math.min(1,Number(visibleInstances.alphas?.[0]??1))),mainCtx,composite,opts,frameCtx);
                }else if(effect.profilePrepared?.gpuRibbonEligible===true){
                    rec=effect.tunnelActive
                        ? WebGPUGraffitiRibbonRenderer.encodeCorridorToLayerScene(targetTexture,effect.profilePrepared,styleLayer,baseAlpha,mainCtx,visibleInstances.copies,visibleInstances.alphas,frameCtx,effect.footprint,composite,opts)
                        : WebGPUGraffitiRibbonRenderer.encodeToLayerScene(targetTexture,effect.profilePrepared,styleLayer,baseAlpha*Math.max(0,Math.min(1,Number(visibleInstances.alphas?.[0]??1))),mainCtx,composite,opts);
                }
            }finally{mainCtx.restore();}
            return rec;
        };
        const globalUnderlay=mode==='outer'&&Number(frameCtx.frame?.renderLayerCount||0)>1&&!effect.coreLayer;
        if(globalUnderlay){
            const under=WebGPUStrokeRenderer.prepareFrameUnderlay?.(frameCtx.frameId);
            const rec=encode(under?.texture,effect.outlineLayer,'destination-over',{width:effect.width,color:effect.color});
            if(rec?.handled&&(!rec.commandBuffer||WebGPUStrokeRenderer.submitFrameUnderlayCommand?.(frameCtx.frameId,rec.commandBuffer))){renderBackendTelemetry.mark('outline','gpu','GPU Graffiti underlay');return;}
            WebGPUStrokeRenderer.abandonFrameUnderlay?.(frameCtx.frameId,mainCtx);
        }
        if(frameCtx.frame?.gpuLayerSceneDeferred){
            const scene=SomataLayerSceneService.resident(frameCtx),composite=mode==='outer'?'destination-over':'source-over';
            const rec=encode(scene?.texture,effect.outlineLayer,composite,{width:effect.width,color:effect.color});
            if(rec?.handled){
                if(rec.commandBuffer)SomataLayerSceneService.queue(frameCtx,somataEffectPhase('geometry',25),rec.commandBuffer,effect.tunnelActive?'graffiti-outline-corridor':'graffiti-outline',rec.onSubmitted);
                if(effect.coreLayer){
                    const core=encode(scene?.texture,effect.coreLayer,'source-over');
                    if(core?.handled&&core.commandBuffer)SomataLayerSceneService.queue(frameCtx,somataEffectPhase('geometry',26),core.commandBuffer,effect.tunnelActive?'graffiti-outline-core-corridor':'graffiti-outline-core',core.onSubmitted);
                    else if(!core?.handled){somataGpuDiagnosticError('graffiti','outline-core','GPU core-inset encode unavailable',frameCtx,{fallback:'skip-core-inset',recovered:true});}
                }
                renderBackendTelemetry.mark('outline','gpu',effect.profilePrepared?.gpuMorphNative===true?'GPU-native Morph Graffiti outline':'GPU Graffiti ribbon outline');
                return;
            }
        }
        const rs=WebGPUGraffitiRibbonRenderer.status?.()||{},ms=WebGPUGraffitiMorphRenderer.status?.()||{};
        noteProfileGpuFailure('graffiti','outline',rs.lastError||ms.lastError||'Graffiti GPU outline unavailable',{ribbon:rs,morph:ms});
        somataGpuDiagnosticError('graffiti','outline','GPU outline skipped; no CPU/Canvas fallback',frameCtx,{fallback:'skip-outline-pass',recovered:true});
        try{requestMainCanvasRender?.();}catch(_){}
        return;
    }
    if(frameCtx.lineProfileStrokeOnly)return;
    if(strictSpiralOutline){renderBackendTelemetry.mark('outline','gpu','strict Spiral outline waits for resident GPU scene; Canvas composite forbidden');try{requestMainCanvasRender?.();}catch(_){}return;}
    const globalOuterUnderlay=mode==='outer'&&Number(frameCtx.frame?.renderLayerCount||0)>1;
    if(globalOuterUnderlay&&frameCtx._webgpuStrokeBatch?.roles?.has?.('outline')){
        if(WebGPUStrokeRenderer.compositeLayerBatchToFrameUnderlay?.(frameCtx._webgpuStrokeBatch,'outline',frameCtx.frameId)){
            if(coreInset>0&&frameCtx._webgpuStrokeBatch.roles.has('core')&&!frameCtx._webgpuStrokeBatch.sceneCombined)WebGPUStrokeRenderer.compositeLayerBatch(frameCtx._webgpuStrokeBatch,'core',mainCtx,'source-over');
            return;
        }
        WebGPUStrokeRenderer.abandonFrameUnderlay?.(frameCtx.frameId,mainCtx);
    }
    if(frameCtx._webgpuStrokeBatch?.roles?.has?.('outline')){
        const outlineComposite=mode==='outer'?'destination-over':'source-over';
        if(WebGPUStrokeRenderer.compositeLayerBatch(frameCtx._webgpuStrokeBatch,'outline',mainCtx,outlineComposite)){
            if(coreInset>0&&frameCtx._webgpuStrokeBatch.roles.has('core'))WebGPUStrokeRenderer.compositeLayerBatch(frameCtx._webgpuStrokeBatch,'core',mainCtx,'source-over');
            return;
        }
    }
    if(!state.showRoundingGuides&&LineEffectsGPURenderer.isAvailable()){
        const outlineCorridorOpt={effectMode:'outline',extraLocal:outerAdd,baseLineWidth:effect.baseLineWidth,colorOverride:effect.color,alphaScale:1,composite:mode==='outer'?'destination-over':'source-over'};
        if(tryRenderCorridorLineEffectGPU(frameCtx,outlineCorridorOpt)){
            renderBackendTelemetry.mark('outline','gpu','GPU Corridor outline');
            if(coreInset>0)tryRenderCorridorLineEffectGPU(frameCtx,{effectMode:'coreInset',extraLocal:coreInset,baseLineWidth:effect.baseLineWidth,alphaScale:1,composite:'source-over'});
            return;
        }
        const commands=getFrameGLStrokeCommands(frameCtx);
        if(commands){
            const outlineOk=LineEffectsGPURenderer.render(commands,mainCtx,{mode:'outline',extraLocal:outerAdd,baseLineWidth:effect.baseLineWidth,colorOverride:effect.color,alphaScale:1,composite:mode==='outer'?'destination-over':'source-over'});
            if(outlineOk){
                renderBackendTelemetry.mark('outline','gpu','analytic GPU outline');
                if(coreInset>0)LineEffectsGPURenderer.render(commands,mainCtx,{mode:'coreInset',extraLocal:coreInset,baseLineWidth:effect.baseLineWidth,alphaScale:1,composite:'source-over'});
                return;
            }
        }
    }
    if(SomataGeometryPolicy.isStrict(frameCtx)){renderBackendTelemetry.mark('outline','gpu','Spiral outline GPU-only warmup; Canvas fallback forbidden');somataGpuContractError('SPIRAL_OUTLINE_GPU_UNAVAILABLE',frameCtx);try{requestMainCanvasRender?.();}catch(_){}return;}
    somataGpuDiagnosticError('outline','render','GPU outline unavailable; pass skipped',frameCtx,{fallback:'skip-outline-pass',recovered:true});
    try{requestMainCanvasRender?.();}catch(_){}

}


SomataFeatureHost.provide('outline','sceneAdmission',(frameCtx,opt={})=>{
    const effect=frameCtx?.effectsPlan?.outline,batch=opt?.batch;if(!effect?.enabled)return true;
    if(batch?.outlineInScene===true)return true;
    if(effect.graffiti!==true||effect.mode!=='outer'||effect.coreLayer)return{admit:false,reason:'outline requires non-resident composition'};
    const multi=Number(frameCtx?.frame?.renderLayerCount||0)>1;if(multi&&!WebGPUStrokeRenderer.canUseFrameUnderlay?.(frameCtx.frameId))return{admit:false,reason:'global underlay unavailable'};
    if(effect.profilePrepared?.gpuMorphNative===true)return{admit:Boolean(typeof WebGPUGraffitiMorphRenderer!=='undefined'&&WebGPUGraffitiMorphRenderer.canEncode?.(effect.profilePrepared)),reason:'Morph Graffiti outline unavailable'};
    return{admit:effect.profilePrepared?.gpuRibbonEligible===true&&(effect.tunnelActive?WebGPUGraffitiRibbonRenderer.canEncodeCorridor(effect.outlineLayer,effect.profilePrepared):WebGPUGraffitiRibbonRenderer.canEncode(effect.outlineLayer,effect.profilePrepared)&&WebGPUGraffitiRibbonRenderer.isReady()),reason:'Graffiti outline ribbon unavailable'};
});

window.SomataRenderPassRegistry?.register?.('outline',{stage:window.SomataRenderPassRegistry.STAGES.POST_BASE,order:10,run:renderLayerOutlinePass});
