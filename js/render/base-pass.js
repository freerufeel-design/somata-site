window.__spiroRegisterModule?.('js/render/base-pass');

// Base-only retry state. It is intentionally private to the Base pass: diagnostics and
// unrelated effects cannot mutate Base warmup/repaint bookkeeping.
const somataBaseBatchMisses=new Map();
function deferTransientBaseBatchMiss(frameCtx,reason){
    const transientReason=String(reason||'');
    if(transientReason!=='WebGPU stroke batch was not created'&&
       !transientReason.startsWith('GPU Corridor Base unavailable:'))return false;
    const key=String(frameCtx?.layer?.id||frameCtx?.layerIndex||'layer'),fid=Math.max(0,Number(frameCtx?.frameId||frameCtx?.frame?.id)||0);
    let rec=somataBaseBatchMisses.get(key);if(!rec||fid>rec.frameId+2)rec={count:0,frameId:fid};rec.count++;rec.frameId=fid;somataBaseBatchMisses.set(key,rec);
    if(somataBaseBatchMisses.size>64)somataBaseBatchMisses.delete(somataBaseBatchMisses.keys().next().value);
    const now=typeof performance!=='undefined'?performance.now():Date.now();
    // Renderer warmup is idempotent, but repaint requests from every layer and
    // pass can create a self-sustaining task storm while WebGPU initializes.
    if(!Number.isFinite(rec.lastWarmup)||now-rec.lastWarmup>=160){
        rec.lastWarmup=now;
        try{WebGPUStrokeRenderer?.warmup?.();}catch(_){}
        if(state.tunnel?.active===true)try{GeometryGPURenderer?.warmup?.();}catch(_){}
    }
    if(!Number.isFinite(rec.lastRepaint)||now-rec.lastRepaint>=180){
        rec.lastRepaint=now;try{requestMainCanvasRender?.();}catch(_){}
    }
    if(rec.count<=2){renderBackendTelemetry.mark('geometry','gpu',`Base batch deferred ${rec.count}/2`);return true;}
    return false;
}
function clearTransientBaseBatchMiss(frameCtx){const key=String(frameCtx?.layer?.id||frameCtx?.layerIndex||'layer');somataBaseBatchMisses.delete(key);}
function noteSuccessfulBaseGpuFrame(frameCtx){
    clearTransientBaseBatchMiss(frameCtx);
    if(state.tunnel?.active===true)SomataRenderDiagnostics?.noteRecovery?.('geometry','base',frameCtx);
}


function renderLayerBaseGeometryPass(frameCtx) {
    mainCtx.globalAlpha = 1;mainCtx.shadowBlur = 0;
    const strictSpiralGpu=SomataGeometryRoleService.isStrict(frameCtx);if(strictSpiralGpu)SomataLayerSceneService.markStrictPresentation(frameCtx,true);

    const forceCanvasBase=shouldForceCanvasBaseStroke(frameCtx)&&!strictSpiralGpu;
    const batch=frameCtx._webgpuStrokeBatch;
    if(strictSpiralGpu){const d=somataSpiralSceneDiag.base;d.frameId=Number(frameCtx.frameId)||0;d.stage='base-enter';d.hasBatch=Boolean(batch);d.sceneCombined=batch?.sceneCombined===true;d.hasSceneTexture=Boolean(batch?.sceneTexture);d.roles=batch?.roles?[...batch.roles]:[];}
    const fillPlan=SomataFillPassService.begin(frameCtx,batch,strictSpiralGpu,forceCanvasBase),contract=fillPlan.contract;
    const forceCanvasFill=fillPlan.forceCanvasFill,fillPrepared=fillPlan.fillPrepared,sceneHasAuthoritativeFill=fillPlan.sceneHasAuthoritativeFill,needsOutOfSceneFill=fillPlan.needsOutOfSceneFill,canKeepGpuSceneOverCanvasFill=fillPlan.canKeepGpuSceneOverCanvasFill;
    let layerSceneCompositeFailed=false;

    // Artistic ordering is owned by SomataEffectStackOrder. If a resident Layer Scene exists,
    // the prepared Line/Glow/Base batch appends at the Geometry group's phase; it must not infer
    // ordering from which earlier effect happened to seed the scene.
    const residentScene=SomataLayerSceneService.resident(frameCtx);
    if(residentScene?.texture&&batch?.sceneCombined&&batch?.preserveExistingScene===true&&!forceCanvasBase&&!forceCanvasFill&&!needsOutOfSceneFill&&canDeferLayerSceneForFrame(frameCtx,batch)){
        const command=batch.commandBuffer;
        if(command&&SomataLayerSceneService.queue(frameCtx,somataEffectPhase('geometry',20),command,'base-layer-scene')){
            batch.commandBuffer=null;batch.submitted=true;
            SomataLayerSceneService.markDeferred(frameCtx,{mainSceneEmpty:false});
            if(batch.roles?.has?.('base')){frameCtx._baseStrokeCommitted=true;noteSuccessfulBaseGpuFrame(frameCtx);}
            renderBackendTelemetry.mark('geometry','gpu','Line/Base appended above resident Web');
            SomataFillPassService.markSceneCommitted(frameCtx,batch,fillPlan,'web-root-layer-scene');
            renderLayerGeometryCirclesPass(frameCtx);return;
        }
    }

    if(!forceCanvasBase&&!forceCanvasFill&&batch?.sceneCombined&&!needsOutOfSceneFill){
        if(canDeferLayerSceneForFrame(frameCtx,batch)&&WebGPUStrokeRenderer.deferLayerScene(batch,frameCtx.frameId)){
            SomataLayerSceneService.markDeferred(frameCtx,{mainSceneEmpty:strictSpiralGpu?frameCtx.frame.gpuMainCanvasHasContent!==true:false});
            if(batch.roles?.has?.('base')){frameCtx._baseStrokeCommitted=true;noteSuccessfulBaseGpuFrame(frameCtx);}
            if(strictSpiralGpu)somataSpiralSceneDiag.base.stage='internal-batch-deferred';
            renderBackendTelemetry.mark('geometry','gpu','deferred WebGPU Layer Scene');
            SomataFillPassService.markSceneCommitted(frameCtx,batch,fillPlan,'layer-scene-deferred');
            renderLayerGeometryCirclesPass(frameCtx);
            return;
        }

        if(strictSpiralGpu){somataSpiralSceneDiag.base.stage='internal-batch-defer-wait';renderBackendTelemetry.mark('geometry','gpu','strict Spiral Layer Scene unavailable; no fallback');somataGpuContractError('SPIRAL_LAYER_SCENE_DEFER_FAILED',frameCtx,{internal:{...somataSpiralSceneDiag.internal},external:{...somataSpiralSceneDiag.external}});try{WebGPUStrokeRenderer.warmup?.();requestMainCanvasRender?.();}catch(_){}return;}

        if(WebGPUStrokeRenderer.getFrameSceneTexture?.(frameCtx.frameId)){WebGPUStrokeRenderer.presentFrameSceneToMain?.(frameCtx.frameId,mainCtx,true);SomataLayerSceneService.markPresented(frameCtx);}
        if(WebGPUStrokeRenderer.compositeLayerScene(batch,mainCtx)){
            if(batch.roles?.has?.('base'))noteSuccessfulBaseGpuFrame(frameCtx);
            SomataFillPassService.markSceneCommitted(frameCtx,batch,fillPlan,'layer-scene-composite');
            renderLayerGeometryCirclesPass(frameCtx);return;
        }
        layerSceneCompositeFailed=true;
        if(batch.roles?.has?.('glow'))WebGPUStrokeRenderer.compositeLayerBatch(batch,'glow',mainCtx,'source-over');
    }else if(!forceCanvasBase&&!forceCanvasFill&&batch?.sceneCombined&&needsOutOfSceneFill){

        if(strictSpiralGpu){
            if(canDeferLayerSceneForFrame(frameCtx,batch)&&WebGPUStrokeRenderer.deferLayerScene(batch,frameCtx.frameId)){
                SomataLayerSceneService.markDeferred(frameCtx,{mainSceneEmpty:frameCtx.frame.gpuMainCanvasHasContent!==true});frameCtx._strictSpiralFillDeferred=true;
                if(batch.roles?.has?.('base'))frameCtx._baseStrokeCommitted=true;
                renderBackendTelemetry.mark('geometry','gpu','strict Spiral retained-Bezier Base preserved while Fill unavailable');
                SomataFillPassService.noteStrictDeferred(frameCtx);
                renderLayerGeometryCirclesPass(frameCtx);try{requestMainCanvasRender?.();}catch(_){}return;
            }
            renderBackendTelemetry.mark('fill','gpu','strict Spiral Fill unavailable; no fallback');somataGpuContractError('SPIRAL_FILL_GPU_UNAVAILABLE',frameCtx,{contract});try{WebGPUStrokeRenderer.warmup?.();requestMainCanvasRender?.();}catch(_){}return;
        }
        if(WebGPUStrokeRenderer.getFrameSceneTexture?.(frameCtx.frameId)){WebGPUStrokeRenderer.presentFrameSceneToMain?.(frameCtx.frameId,mainCtx,true);SomataLayerSceneService.markPresented(frameCtx);}

        layerSceneCompositeFailed=true;SomataFillPassService.noteSceneSplit();
        if(batch.roles?.has?.('glow'))WebGPUStrokeRenderer.compositeLayerBatch(batch,'glow',mainCtx,'source-over');
    }

    const fillHandled=SomataFillPassService.resolve(frameCtx,batch,fillPlan,layerSceneCompositeFailed);

    const graffitiReplacesBase=frameCtx.lineProfileStrokeOnly===true&&frameCtx.lineProfileApplication==='graffiti';
    if(graffitiReplacesBase){
        frameCtx._baseStrokeCommitted=true;frameCtx._baseStrokeSuppressedByGraffiti=true;
        if(strictSpiralGpu)somataSpiralSceneDiag.base.stage='base-intentionally-suppressed-by-graffiti';
        renderBackendTelemetry.mark('geometry','gpu','Base intentionally replaced by GPU Graffiti');
        renderLayerGeometryCirclesPass(frameCtx);
        return;
    }

    // During Corridor transitions a layer can legitimately have zero visible copies.
    // This is a successful empty Base, not a GPU submission failure. Do not infer
    // emptiness from an absent visibleInstances record (which may signal a bug).
    if(state.tunnel?.active===true&&Array.isArray(frameCtx.visibleInstances?.copies)&&
       frameCtx.visibleInstances.copies.length===0&&!isPathFxBaseReplacementActive(frameCtx)){
        frameCtx._baseStrokeCommitted=true;
        clearTransientBaseBatchMiss(frameCtx);
        renderBackendTelemetry.mark('geometry','gpu','Corridor has no visible copies; Base is correctly empty');
        renderLayerGeometryCirclesPass(frameCtx);
        return;
    }

    const residentBeforeCorridorBase=getResidentGpuLayerScene(frameCtx);
    if(!strictSpiralGpu&&(!fillHandled||Boolean(residentBeforeCorridorBase?.texture))&&frameCtx.lineProfileStrokeOnly!==true&&canUseGpuOnlyCorridorLayerScene(frameCtx,false)){
        const sceneAlreadyActive=Boolean(residentBeforeCorridorBase?.texture);
        const rec=encodeGpuOnlyCorridorLayerRole(frameCtx,'base',{effectMode:'base',alphaScale:Math.max(0,Math.min(1,Number(frameCtx.lineOpacityFactor??1))),composite:'source-over'},!sceneAlreadyActive);
        if(rec?.handled&&rec.commandBuffer){
            let accepted=false;
            if(sceneAlreadyActive)accepted=SomataLayerSceneService.queue(frameCtx,somataEffectPhase('geometry',20),rec.commandBuffer,'corridor-base');
            else accepted=SomataLayerSceneService.queueAsRoot(frameCtx,somataEffectPhase('geometry',20),rec.commandBuffer,'corridor-base');
            if(accepted){SomataLayerSceneService.markDeferred(frameCtx,{mainSceneEmpty:false});frameCtx._corridorLayerSceneActive=true;frameCtx._baseStrokeCommitted=true;noteSuccessfulBaseGpuFrame(frameCtx);renderBackendTelemetry.mark('geometry','gpu','GPU Corridor Layer Scene');renderLayerGeometryCirclesPass(frameCtx);return;}
        }
        if(sceneAlreadyActive){if(strictSpiralGpu){somataGpuContractError('CORRIDOR_BASE_GPU_ENCODE_FAILED',frameCtx,{role:'base'});try{WebGPUStrokeRenderer.clearDeferredLayerScene?.();}catch(_){}SomataLayerSceneService.resetDeferred(frameCtx,{clearQueues:true});frameCtx._corridorLayerSceneActive=false;return;}materializeDeferredLayerScene(frameCtx);frameCtx._corridorLayerSceneActive=false;}
    }


    if(canKeepGpuSceneOverCanvasFill&&batch?.roles?.has?.('base')&&WebGPUStrokeRenderer.deferLayerScene(batch,frameCtx.frameId)){
        SomataLayerSceneService.markDeferred(frameCtx,{mainSceneEmpty:false});
        frameCtx._baseStrokeCommitted=true;noteSuccessfulBaseGpuFrame(frameCtx);
        renderBackendTelemetry.mark('geometry','gpu','deferred WebGPU base to finalGpuCanvas');
        renderLayerGeometryCirclesPass(frameCtx);
        return;
    }

    const prevSuppressFill=mainCtx.__suppressFill;
    if(fillHandled)mainCtx.__suppressFill=true;
    const pathFxReplacesStroke=isPathFxBaseReplacementActive(frameCtx);
    if(pathFxReplacesStroke){renderBackendTelemetry.mark('geometry','gpu','base replaced by Path FX');}
    else if(frameCtx._baseStrokeCommitted===true&&frameCtx._fusedMorphBackend){renderBackendTelemetry.mark('geometry','gpu',`fused ${frameCtx._fusedMorphBackend} Glow+Base`);}
    else if(frameCtx._baseStrokeCommitted!==true){
        const baseResult=SomataGeometryRoleService.renderBase(frameCtx,mainCtx,{force:forceCanvasBase});
        if(!baseResult?.handled){
            if(strictSpiralGpu){
                somataSpiralSceneDiag.base.stage='no-base-renderer-committed';
                SomataGeometryRoleService.warmup(frameCtx);
                renderBackendTelemetry.mark('geometry','gpu','strict geometry base unavailable');
                somataGpuContractError('SPIRAL_BASE_GPU_UNAVAILABLE',frameCtx,{reason:describeBaseGpuFallback(frameCtx,batch,false),geometry:SomataGeometryRoleService.strictDiagnostics(frameCtx,'base')});
                try{requestMainCanvasRender?.();}catch(_){}
            }else{
                const why=describeBaseGpuFallback(frameCtx,batch,forceCanvasBase);
                if(!deferTransientBaseBatchMiss(frameCtx,why)){
                    renderBackendTelemetry.mark('geometry','gpu',`GPU base unavailable: ${why}`);
                    const serviceStatus=SomataGeometryRoleService.status();
                    let strokeStatus=null,gpuStatus=null;
                    try{strokeStatus=WebGPUStrokeRenderer?.status?.()||null;}catch(_){}
                    try{gpuStatus=GeometryGPURenderer?.status?.()||null;}catch(_){}
                    somataGpuDiagnosticError('geometry','base',why,frameCtx,{
                        fallback:'gpu-current-frame-repaint',recovered:false,recoveryPending:true,
                        transientBatchMisses:somataBaseBatchMisses.get(String(frameCtx?.layer?.id||frameCtx?.layerIndex||'layer'))?.count||0,
                        strokeBatch:state.tunnel?.active===true?null:(()=>{const rec=SomataStrokeBatchService.status?.().lastFailure;return rec?.frameId===Number(frameCtx?.frameId)&&rec?.layerId===String(frameCtx?.layer?.id||'')?rec:null;})(),
                        layerScene:SomataLayerSceneService.status?.().lastReason||null,
                        corridor:state.tunnel?.active===true?{
                            layerScene:frameCtx._corridorBaseGpuTrace||null,
                            perCopy:frameCtx._corridorPerCopyGpuTrace||null,
                            roleFailure:serviceStatus?.lastFailure?.frameId===Number(frameCtx?.frameId)&&serviceStatus?.lastFailure?.layerId===frameCtx?.layer?.id?serviceStatus.lastFailure:null,
                            stroke:{available:strokeStatus?.available,initializing:strokeStatus?.initializing,lost:strokeStatus?.lost,lastError:strokeStatus?.lastError},
                            geometry:{active:gpuStatus?.active,lastError:gpuStatus?.webgpu?.lastError}
                        }:null
                    });
                    try{requestMainCanvasRender?.();}catch(_){}
                }
            }
        }else{
            noteSuccessfulBaseGpuFrame(frameCtx);
            renderBackendTelemetry.mark('geometry','gpu',`geometry role: ${baseResult.backend}`);
            frameCtx._baseStrokeCommitted=true;
        }
    }
    if(prevSuppressFill===undefined)delete mainCtx.__suppressFill;else mainCtx.__suppressFill=prevSuppressFill;
    renderLayerGeometryCirclesPass(frameCtx);
}


window.SomataRenderPassRegistry?.register?.('base',{stage:window.SomataRenderPassRegistry.STAGES.BASE,order:10,run:renderLayerBaseGeometryPass,fallback:renderLayerBaseGeometryPass});
