window.__spiroRegisterModule?.('js/render/particle-pass');

// Self-owned feature contract: changing this feature does not require editing the host.
SomataFeatureHost.register('particles',{domain:'effect',plans:['particles'],reads:['_geometryContract'],outputs:[]});
function queueParticleGpuFallback(frameCtx,cfg){
    // 7.7.7: Particles no longer borrow the Lamp renderer as an emergency rasterizer.
    // Cross-feature renderer reuse made a Lamp refactor capable of breaking Particles.
    // The particle module owns its GPU path; a warmup miss requests the next frame instead.
    try{WebGPUParticleRenderer?.warmup?.();requestMainCanvasRender?.();renderBackendTelemetry?.mark?.('particles','gpu','particle renderer warming; no cross-feature fallback');}catch(_){}
    return false;
}
function renderLayerParticlePass(frameCtx){
    const effectLayer=frameCtx?.effectLayer||(typeof getLayerEffectOwner==='function'?getLayerEffectOwner(frameCtx?.layer):(typeof ensureLayerEffectState==='function'?ensureLayerEffectState(frameCtx?.layer):null))||frameCtx?.layer;
    const cfg=typeof normalizeParticleConfig==='function'?normalizeParticleConfig(effectLayer?.particles):null;
    if(!cfg?.enabled||frameCtx?.layer?.visible===false)return false;
    try{

        // Keep particles in the resident Layer Scene whenever possible so the shared
        // artistic stack (File → Settings → Effect order) can place them deterministically.
        if(frameCtx?.frame?.gpuLayerSceneDeferred!==true)SomataLayerSceneService.ensure(frameCtx,'particle-effect');
        if(frameCtx?.frame?.gpuLayerSceneDeferred===true){
            const scene=SomataLayerSceneService.resident(frameCtx),rec=scene?.texture?WebGPUParticleRenderer?.encodeToLayerScene?.(scene.texture,frameCtx,mainCtx):null;
            if(rec?.handled){if(rec.commandBuffer)SomataLayerSceneService.queue(frameCtx,somataEffectPhase('particles'),rec.commandBuffer,'particles',rec.onSubmitted);renderBackendTelemetry?.mark?.('particles','gpu','ordered Layer Scene particles');return true;}
        }
        const strictSpiral=SomataGeometryRoleService.isStrict(frameCtx);
        if(strictSpiral){renderBackendTelemetry?.mark?.('particles','gpu','Spiral particle Layer Scene warmup');try{requestMainCanvasRender?.();}catch(_){}return false;}
        const ok=WebGPUParticleRenderer?.queueLayer?.(frameCtx,mainCtx)===true;
        if(ok){renderBackendTelemetry?.mark?.('particles','gpu','particle overlay compatibility path');return true;}
        return queueParticleGpuFallback(frameCtx,cfg);
    }catch(_){if(SomataGeometryRoleService.isStrict(frameCtx))return false;return queueParticleGpuFallback(frameCtx,cfg);}
}
function flushParticleFrameQueue(){try{return WebGPUParticleRenderer?.flush?.()===true;}catch(_){return false;}}

SomataFeatureHost.provide('particles','frameBegin',({renderFrame,displayLayers,gpuBackendAllowed,width,height})=>{
    if(!gpuBackendAllowed)return{framePatch:{particleOverlayReady:false}};
    const needed=(displayLayers||[]).some(l=>{const e=liveEffectOwnerForFrameLayer(l);return l?.visible!==false&&normalizeParticleConfig(e?.particles).enabled===true;});
    const ready=WebGPUParticleRenderer?.beginOverlayFrame?.(renderFrame?.id,width,height,needed)===true;
    return{framePatch:{particleOverlayReady:ready}};
});
SomataFeatureHost.provide('particles','frameEnd',({gpuBackendAllowed})=>{if(gpuBackendAllowed)flushParticleFrameQueue();return null;});

window.SomataRenderPassRegistry?.register?.('particles',{stage:window.SomataRenderPassRegistry.STAGES.POST_BASE,order:70,run:renderLayerParticlePass});
