

window.__spiroRegisterModule?.('js/render/path-fx-pass');

function preflightLayerPathFxReplacement(frameCtx){
    frameCtx._pathFxReplacementCommitted=false;frameCtx._pathFxReplacementKind='';frameCtx._pathFxPrequeuedSprite=false;frameCtx._pathFxPrequeuedMotion=false;
    const e=frameCtx?.effectsPlan||{},sprite=e.sprite,motion=e.motion;
    // Replacement readiness is renderer readiness, not overlay readiness: the preferred
    // path now encodes into the shared Layer Scene so user-defined effect order applies.
    const gpuReady=typeof WebGPUPathFxRenderer!=='undefined'&&WebGPUPathFxRenderer.isReady?.();
    if(sprite?.enabled===true&&!lineSpritePlacementIsSparse(sprite?.cfg?.mode)){
        if(gpuReady){const motionCfg=motion?.enabled===true?motion.cfg:null,ok=typeof queueLayerPathFxPass==='function'&&queueLayerPathFxPass(frameCtx,sprite,'sprite',motionCfg)===true;if(ok){frameCtx._pathFxReplacementCommitted=true;frameCtx._pathFxReplacementKind='sprite-gpu';frameCtx._pathFxPrequeuedSprite=true;if(motion?.enabled===true)frameCtx._pathFxPrequeuedMotion=true;return true;}}
        somataGpuDiagnosticError?.('sprite','preflight','GPU sprite replacement not ready; base retained for this frame',frameCtx);try{requestMainCanvasRender?.();}catch(_){}return false;
    }
    if(motion?.enabled===true&&motion?.cfg?.replaceBase===true){
        if(gpuReady){const ok=typeof queueLayerPathFxPass==='function'&&queueLayerPathFxPass(frameCtx,motion,'motion',motion.cfg)===true;if(ok){frameCtx._pathFxReplacementCommitted=true;frameCtx._pathFxReplacementKind='motion-gpu';frameCtx._pathFxPrequeuedMotion=true;return true;}}
        somataGpuDiagnosticError?.('motion','preflight','GPU moving-line replacement not ready; base retained for this frame',frameCtx);try{requestMainCanvasRender?.();}catch(_){}
    }
    return false;
}



const pathFxFrameQueueStats={queued:0,directFallbacks:0,failed:0,framesFlushed:0};

function queueLayerPathFxPass(frameCtx,effect,effectMode,motionCfg=null){
    const {visibleInstances,baseAlpha}=frameCtx;
    // Preferred path: encode into the same transparent Layer Scene as Fill/Web/Base.
    // Commands are queued with the shared artistic phase, so Motion/Sprite can be moved
    // below or above any other user-visible effect group without changing execution order.
    const scene=SomataLayerSceneService.ensure(frameCtx,`${effectMode}-pathfx`);
    if(scene?.texture&&typeof WebGPUPathFxRenderer.encodeToLayerScene==='function'){
        let healthy=true;const encoded=[];
        for(let i=0;i<visibleInstances.copies.length;i++){
            const copy=visibleInstances.copies[i],a=visibleInstances.alphas[i];if(a<=.0001)continue;
            mainCtx.save();
            try{
                if(state.tunnel.active){applyMotionTunnelLag(mainCtx,copy,frameCtx.layer);mainCtx.scale(copy.scale,copy.scale);}
                applyLayerFrameEffectTransform(mainCtx,frameCtx);
                const rec=WebGPUPathFxRenderer.encodeToLayerScene(scene.texture,effect.table,frameCtx.layer,effect.cfg,baseAlpha*a,mainCtx,effectMode,effect.now,motionCfg);
                if(!rec?.handled){healthy=false;pathFxFrameQueueStats.failed++;break;}
                if(rec.commandBuffer)encoded.push({rec,index:i});
            }finally{mainCtx.restore();}
        }
        // Encode every copy first. If one encode fails, nothing has entered the shared
        // command queue yet, so the compatibility overlay can retry without duplicates.
        if(healthy){
            for(const item of encoded){const {rec,index}=item;if(!SomataLayerSceneService.queue(frameCtx,somataEffectPhase('pathfx',effectMode==='motion'?0:1+index*.001),rec.commandBuffer,`pathfx-${effectMode}-${index}`,rec.onSubmitted)){pathFxFrameQueueStats.failed++;return false;}pathFxFrameQueueStats.queued++;}
            if(encoded.length)SomataLayerSceneService.markDeferred(frameCtx,{mainSceneEmpty:false});
            return true;
        }
    }

    // Compatibility fallback for frames where a shared scene cannot be opened.
    const queueMark=typeof WebGPUPathFxRenderer.overlayQueueMark==='function'?WebGPUPathFxRenderer.overlayQueueMark():null;
    let healthy=true;
    for(let i=0;i<visibleInstances.copies.length;i++){
        const copy=visibleInstances.copies[i],a=visibleInstances.alphas[i];if(a<=.0001)continue;
        mainCtx.save();
        try{
            if(state.tunnel.active){applyMotionTunnelLag(mainCtx,copy,frameCtx.layer);mainCtx.scale(copy.scale,copy.scale);}
            applyLayerFrameEffectTransform(mainCtx,frameCtx);
            let rec=null;
            if(typeof WebGPUPathFxRenderer.queueOverlayDraw==='function'){
                rec=WebGPUPathFxRenderer.queueOverlayDraw(effect.table,frameCtx.layer,effect.cfg,baseAlpha*a,mainCtx,effectMode,effect.now,motionCfg);
                if(rec?.handled)pathFxFrameQueueStats.queued++;
            }else{
                rec=WebGPUPathFxRenderer.drawToOverlay(effect.table,frameCtx.layer,effect.cfg,baseAlpha*a,mainCtx,effectMode,effect.now,motionCfg);
                pathFxFrameQueueStats.directFallbacks++;
            }
            if(!rec?.handled){healthy=false;pathFxFrameQueueStats.failed++;break;}
        }finally{mainCtx.restore();}
    }
    if(!healthy&&queueMark!==null)try{WebGPUPathFxRenderer.rollbackOverlayQueue?.(queueMark);}catch(_){}
    return healthy;
}
function renderLayerMotionFxPass(frameCtx){
    const effect=frameCtx.effectsPlan?.motion;if(!effect?.enabled)return;
    if(frameCtx?._pathFxPrequeuedMotion===true){renderBackendTelemetry.mark('motion','gpu','prequeued Moving Line replacement');return;}
    WebGPUPathFxRenderer.warmup();
    const sprite=frameCtx.effectsPlan?.sprite;if(sprite?.enabled&&!lineSpritePlacementIsSparse(sprite?.cfg?.mode)&&WebGPUPathFxRenderer.isReady()){renderBackendTelemetry.mark('motion','gpu','deformation folded into textured Sprite');return;}
    if(!WebGPUPathFxRenderer.isReady()){const st=WebGPUPathFxRenderer.status?.()||{};renderBackendTelemetry.mark('motion','gpu',st.lastError?`GPU Path FX unavailable: ${st.lastError}`:'GPU Path FX warming');somataGpuDiagnosticError?.('motion','renderer',st.lastError||'GPU Path FX warming',frameCtx,{status:st});try{requestMainCanvasRender?.();}catch(_){}return;}
    const healthy=queueLayerPathFxPass(frameCtx,effect,'motion',effect.cfg);
    renderBackendTelemetry.mark('motion','gpu',healthy?`queued WebGPU ${effect.cfg?.type||'seaRaft'} deformation`:'GPU Path FX queue unavailable',!healthy);
    if(!healthy){somataGpuDiagnosticError?.('motion','queue','GPU Path FX queue failed',frameCtx,{type:effect.cfg?.type||null});try{requestMainCanvasRender?.();}catch(_){}}
}

function renderLayerSpritePass(frameCtx){
    const effect=frameCtx.effectsPlan?.sprite;if(!effect?.enabled)return;
    const motionCfg=frameCtx.effectsPlan?.motion?.enabled===true?frameCtx.effectsPlan.motion.cfg:null;
    if(frameCtx?._pathFxPrequeuedSprite===true){renderBackendTelemetry.mark('sprite','gpu','prequeued continuous WebGPU sprite-stroke');return;}
    WebGPUPathFxRenderer.warmup();
    if(WebGPUPathFxRenderer.isReady()&&queueLayerPathFxPass(frameCtx,effect,'sprite',motionCfg)){renderBackendTelemetry.mark('sprite','gpu','queued continuous WebGPU sprite-stroke');return;}
    const st=WebGPUPathFxRenderer.status?.()||{};renderBackendTelemetry.mark('sprite','gpu',st.lastError?`GPU Sprite unavailable: ${st.lastError}`:'GPU Sprite warming',true);
    somataGpuDiagnosticError?.('sprite','queue',st.lastError||'GPU Sprite queue unavailable',frameCtx,{status:st});try{requestMainCanvasRender?.();}catch(_){}
}

function flushPathFxFrameQueue(){
    if(typeof WebGPUPathFxRenderer?.flushOverlayFrame!=='function')return true;
    const ok=WebGPUPathFxRenderer.flushOverlayFrame();if(ok)pathFxFrameQueueStats.framesFlushed++;return ok;
}

window.__spiroPathFxFrameQueueStatus=()=>({...pathFxFrameQueueStats,renderer:WebGPUPathFxRenderer.status?.()?.overlayQueue||null,contract:'Sprite + Moving Line queue all visible copies across all layers and flush once per main frame.'});

function pathFxSceneAdmission(frameCtx,name){
    const effect=frameCtx?.effectsPlan?.[name];if(!effect?.enabled)return true;
    return{admit:WebGPUPathFxRenderer.isReady(),requiresFinalComposite:true,reason:`${name} Path FX renderer unavailable`};
}
SomataFeatureHost.provide('motion','sceneAdmission',frameCtx=>pathFxSceneAdmission(frameCtx,'motion'));
SomataFeatureHost.provide('sprite','sceneAdmission',frameCtx=>pathFxSceneAdmission(frameCtx,'sprite'));

SomataFeatureHost.provide('pathfx','frameBegin',({renderFrame,displayLayers,gpuBackendAllowed,width,height})=>{
    if(!gpuBackendAllowed)return{framePatch:{pathFxOverlayReady:false}};
    const needed=(displayLayers||[]).some(l=>{const e=liveEffectOwnerForFrameLayer(l);return l?.visible!==false&&(e?.sprite?.enabled===true||e?.lineMotionFx?.enabled===true);});
    const ready=WebGPUPathFxRenderer.beginOverlayFrame?.(renderFrame?.id,width,height,needed)===true;
    return{framePatch:{pathFxOverlayReady:ready}};
});
SomataFeatureHost.provide('pathfx','frameEnd',({gpuBackendAllowed})=>{if(gpuBackendAllowed)flushPathFxFrameQueue();return null;});

window.SomataRenderPassRegistry?.registerHook?.('beforeLayer','path-fx-preflight',frameCtx=>{try{return preflightLayerPathFxReplacement(frameCtx);}catch(err){frameCtx._pathFxReplacementCommitted=false;frameCtx._pathFxPrequeuedSprite=false;frameCtx._pathFxPrequeuedMotion=false;try{spiroPassIsolationNoteFailure?.('pathFxPreflight',err,frameCtx);}catch(_){}return null;}});
window.SomataRenderPassRegistry?.register?.('motion',{stage:window.SomataRenderPassRegistry.STAGES.POST_BASE,order:40,run:renderLayerMotionFxPass});
window.SomataRenderPassRegistry?.register?.('sprite',{stage:window.SomataRenderPassRegistry.STAGES.POST_BASE,order:60,run:renderLayerSpritePass});
