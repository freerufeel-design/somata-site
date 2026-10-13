

window.__spiroRegisterModule?.('js/render/path-fx-pass');

const pathFxFrameQueueStats={queued:0,directFallbacks:0,failed:0,framesFlushed:0};

function queueLayerPathFxPass(frameCtx,effect,effectMode,motionCfg=null){
    const {visibleInstances,baseAlpha}=frameCtx;let healthy=true;
    const queueMark=typeof WebGPUPathFxRenderer.overlayQueueMark==='function'?WebGPUPathFxRenderer.overlayQueueMark():null;
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
