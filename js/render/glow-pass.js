window.__spiroRegisterModule?.('js/render/glow-pass');

const graffitiGlowRetryState=new WeakMap();
function noteGraffitiContourGlowOutcome(frameCtx,handled){
    const owner=frameCtx?.effectLayer||frameCtx?.layer;
    if(handled===true){frameCtx._graffitiContourGlowPending=false;frameCtx._graffitiContourGlowCommitted=true;if(owner&&typeof owner==='object')graffitiGlowRetryState.delete(owner);return true;}
    frameCtx._graffitiContourGlowPending=true;frameCtx._graffitiContourGlowCommitted=false;
    if(owner&&typeof owner==='object'){
        const now=performance.now();let rec=graffitiGlowRetryState.get(owner);
        if(!rec||now-rec.windowStart>1500)rec={windowStart:now,attempts:0};
        if(rec.attempts<3){rec.attempts++;graffitiGlowRetryState.set(owner,rec);try{requestMainCanvasRender?.();}catch(_){}}
    }
    return false;
}

function renderLayerGlowPass(frameCtx) {
    const effect=frameCtx.effectsPlan?.glow;if(!effect?.enabled)return;
    const strictGeometry=SomataGeometryRoleService.isStrict(frameCtx);
    const graffitiCarrierGlow=frameCtx.lineProfileStrokeOnly===true&&frameCtx.lineProfileApplication==='graffiti';

    if(frameCtx.lineProfileApplication==='graffiti'){
        frameCtx._graffitiContourGlowPending=true;frameCtx._graffitiContourGlowCommitted=false;
        renderBackendTelemetry.mark('glow','gpu','Graffiti contour Glow deferred to exact GPU ribbon');return;
    }

    if(!strictGeometry&&!(graffitiCarrierGlow&&frameCtx.morphFrameActive===true)&&canUseGpuOnlyCorridorLayerScene(frameCtx,graffitiCarrierGlow)){
        const residentBeforeGlow=SomataLayerSceneService.resident(frameCtx),sceneAlreadyActive=Boolean(residentBeforeGlow?.texture);
        const rec=encodeGpuOnlyCorridorLayerRole(frameCtx,'glow',{effectMode:'glow',radiusPx:Math.max(.5,effect.amount*.55*frameCtx.frame.dpr),alphaScale:effect.compositeAlpha,composite:'source-over'},!sceneAlreadyActive,graffitiCarrierGlow);
        if(rec?.handled&&rec.commandBuffer){
            const accepted=sceneAlreadyActive
                ? SomataLayerSceneService.queue(frameCtx,somataEffectPhase('geometry',10),rec.commandBuffer,'corridor-glow')
                : SomataLayerSceneService.queueAsRoot(frameCtx,somataEffectPhase('geometry',10),rec.commandBuffer,'corridor-glow');
            if(accepted){frameCtx._corridorLayerSceneActive=true;renderBackendTelemetry.mark('glow','gpu',sceneAlreadyActive?'GPU Corridor joined resident Layer Scene':'GPU Corridor Layer Scene');return;}
        }
    }

    const fuseContract=getLayerGeometryContract(frameCtx);
    const webActive=Boolean(frameCtx.renderGraph?.roles?.web);
    const canFuseMorphGlowBase=frameCtx.lineDisplayEnabled===true&&frameCtx.lineProfileStrokeOnly!==true&&fuseContract?.fillRequested!==true&&!webActive&&!(typeof isPathFxBaseReplacementActive==='function'&&isPathFxBaseReplacementActive(frameCtx))&&!shouldForceCanvasBaseStroke(frameCtx);

    if(!frameCtx.morphFrameActive&&strictGeometry&&SomataGeometryRoleService.batchSceneHas(frameCtx,'glow')){renderBackendTelemetry.mark('glow','gpu','static retained geometry Layer Scene');return;}

    // 7.8 shared contour invariant: Glow must not re-enter a native topology/green
    // geometry renderer after Fill/Web have claimed FrameContour.  Use the same stroke
    // batch (or the same recorded commands) as the visible Line.
    if(!strictGeometry&&frameCtx._sharedFrameContourRequired===true){
        if(SomataGeometryRoleService.batchSceneHas(frameCtx,'glow')){renderBackendTelemetry.mark('glow','gpu','shared FrameContour Layer Scene');return;}
        if(SomataGeometryRoleService.compositeBatchRole(frameCtx,'glow',mainCtx,'source-over')){renderBackendTelemetry.mark('glow','gpu','shared FrameContour stroke batch');return;}
        const commands=SomataFrameContourService?.current?.(frameCtx)?.commands||null;
        if(commands?.length&&LineEffectsGPURenderer.isAvailable()){
            const ok=LineEffectsGPURenderer.render(commands,mainCtx,{mode:'glow',radiusPx:Math.max(.5,effect.amount*.55*frameCtx.frame.dpr),alphaScale:effect.compositeAlpha,composite:'source-over'});
            if(ok){renderBackendTelemetry.mark('glow','gpu','shared FrameContour analytic glow');return;}
        }
        somataGpuDiagnosticError('glow','shared-frame-contour','Shared FrameContour Glow unavailable; pass skipped',frameCtx,{fallback:'skip-glow-pass',recovered:true});try{requestMainCanvasRender?.();}catch(_){}return;
    }

    if(canFuseMorphGlowBase){
        const fused=SomataGeometryRoleService.renderGlowBase(frameCtx,mainCtx,{mode:'glow-base',radiusPx:Math.max(.5,effect.amount*.55*frameCtx.frame.dpr),glowAlphaScale:effect.compositeAlpha,baseAlphaScale:Math.max(0,Math.min(1,Number(frameCtx.lineOpacityFactor??1))),layerScenePhase:somataEffectPhase('geometry',10),layerSceneLabel:'geometry-glow-base',allowHiddenGraffitiCarrier:graffitiCarrierGlow});
        if(fused?.handled){frameCtx._baseStrokeCommitted=true;frameCtx._fusedMorphBackend=fused.backend;renderBackendTelemetry.mark('glow','gpu',`fused ${fused.backend} Glow+Base`);return;}
    }

    const native=SomataGeometryRoleService.renderGlow(frameCtx,mainCtx,{mode:'glow',radiusPx:Math.max(.5,effect.amount*.55*frameCtx.frame.dpr),alphaScale:effect.compositeAlpha,layerScenePhase:somataEffectPhase('geometry',10),layerSceneLabel:'geometry-glow',allowHiddenGraffitiCarrier:graffitiCarrierGlow});
    if(native?.handled){renderBackendTelemetry.mark('glow','gpu',`${native.backend} geometry Glow`);return;}

    if(strictGeometry){
        if(SomataGeometryRoleService.batchSceneHas(frameCtx,'glow')){renderBackendTelemetry.mark('glow','gpu','strict geometry resident Layer Scene');return;}
        renderBackendTelemetry.mark('glow','gpu','strict geometry GPU-only warmup; Canvas presentation forbidden');
        const diag=SomataGeometryRoleService.strictDiagnostics(frameCtx,'glow',graffitiCarrierGlow);
        somataGpuContractError('SPIRAL_GLOW_GPU_UNAVAILABLE',frameCtx,{morphFrameActive:frameCtx.morphFrameActive===true,hiddenGraffitiCarrier:graffitiCarrierGlow,batchRoles:frameCtx._webgpuStrokeBatch?.roles?[...frameCtx._webgpuStrokeBatch.roles]:[],...diag});
        SomataGeometryRoleService.warmup(frameCtx);try{requestMainCanvasRender?.();}catch(_){}return;
    }

    if(frameCtx.lineProfileStrokeOnly&&frameCtx.lineProfileApplication==='stroke'){
        const ok=tryRenderStrokeMarkerEffectGPU(frameCtx,{mode:'glow',extraPx:Math.max(.5,effect.amount*.55*frameCtx.frame.dpr),alpha:effect.compositeAlpha,composite:'source-over'});
        if(ok){renderBackendTelemetry.mark('glow','gpu','GPU marker glow');return;}
    }
    if(SomataGeometryRoleService.batchSceneHas(frameCtx,'glow')){
        renderBackendTelemetry.mark('glow','gpu',frameCtx._webgpuStrokeBatch?.preserveExistingScene===true?'Layer Scene above resident Web':'Layer Scene');return;
    }
    if(SomataGeometryRoleService.compositeBatchRole(frameCtx,'glow',mainCtx,'source-over')){renderBackendTelemetry.mark('glow','gpu','WebGPU stroke batch');return;}
    const {dpr}=frameCtx.frame;

    if((typeof somataGpuBackendAllowed!=='function'||somataGpuBackendAllowed())&&!frameCtx.lineProfileStrokeOnly&&!state.showRoundingGuides&&LineEffectsGPURenderer.isAvailable()){
        const gpuOpt={effectMode:'glow',radiusPx:Math.max(.5,effect.amount*.55*dpr),alphaScale:effect.compositeAlpha,composite:'source-over'};
        if(tryRenderCorridorLineEffectGPU(frameCtx,gpuOpt)){renderBackendTelemetry.mark('glow','gpu','GPU Corridor glow');return;}
        const commands=getFrameGLStrokeCommands(frameCtx);
        if(commands&&LineEffectsGPURenderer.render(commands,mainCtx,{mode:'glow',radiusPx:gpuOpt.radiusPx,alphaScale:gpuOpt.alphaScale,composite:'source-over'})){renderBackendTelemetry.mark('glow','gpu','analytic GPU glow');return;}
    }
    somataGpuDiagnosticError('glow','render','GPU glow unavailable; pass skipped',frameCtx,{fallback:'skip-glow-pass',recovered:true});
    try{requestMainCanvasRender?.();}catch(_){}
}

window.SomataRenderPassRegistry?.register?.('glow',{stage:window.SomataRenderPassRegistry.STAGES.GLOW,order:10,run:renderLayerGlowPass});
