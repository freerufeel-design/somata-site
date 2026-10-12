// SpiroStar v522.1 — render-pass fault isolation with clean-state compatibility retry.
// A failure in one optional effect must never blank an already rendered frame.
window.__spiroRegisterModule?.('js/render/pass-isolation');


const SPIRO_TRANSIENT_CTX_KEYS=['__suppressStroke','__suppressFill','__forceStrokeStyle','__forcedLineWidth'];
function spiroCaptureTransientCanvasOverrides(ctx){
    const out={};for(const key of SPIRO_TRANSIENT_CTX_KEYS)out[key]={had:Object.prototype.hasOwnProperty.call(ctx||{},key),value:ctx?.[key]};return out;
}
function spiroRestoreTransientCanvasOverrides(ctx,snap){
    if(!ctx||!snap)return;for(const key of SPIRO_TRANSIENT_CTX_KEYS){const rec=snap[key];if(rec?.had)ctx[key]=rec.value;else try{delete ctx[key];}catch(_){ctx[key]=undefined;}}
}

const spiroPassIsolationRuntime={
    frameId:0,failures:0,retries:0,retrySuccesses:0,retryFailures:0,skippedPasses:0,strictFallbackBlocks:0,strictSessionDisableBlocks:0,
    lastError:'',lastPass:'',lastLayer:-1,lastAt:0,
    forced:new Set(),sessionDisabled:new Set(),failureCounts:new Map(),recent:[]
};
function beginSpiroPassIsolationFrame(frameId){spiroPassIsolationRuntime.frameId=Math.max(0,Number(frameId)||0);spiroPassIsolationRuntime.forced.clear();}
function spiroIsCompatibilityForced(pass){const key=String(pass||'');if(typeof somataCpuBackendForced==='function'&&somataCpuBackendForced())return true;return spiroPassIsolationRuntime.forced.has(key)||spiroPassIsolationRuntime.sessionDisabled.has(key);}
function spiroForceCompatibility(pass,on=true){const key=String(pass||'');if(!key)return false;if(on)spiroPassIsolationRuntime.forced.add(key);else spiroPassIsolationRuntime.forced.delete(key);return true;}
function spiroPassIsolationNoteFailure(pass,err,frameCtx=null){
    const key=String(pass||'unknown'),now=performance.now(),msg=String(err?.stack||err?.message||err||'unknown error');
    const strictSpiral=Boolean(frameCtx&&typeof isStrictSpiralWebGPUFrame==='function'&&isStrictSpiralWebGPUFrame(frameCtx));
    spiroPassIsolationRuntime.failures++;spiroPassIsolationRuntime.lastError=msg;spiroPassIsolationRuntime.lastPass=key;spiroPassIsolationRuntime.lastLayer=Number(frameCtx?.layerIndex??-1);spiroPassIsolationRuntime.lastAt=now;
    const prev=spiroPassIsolationRuntime.failureCounts.get(key)||{count:0,lastAt:0};prev.count=(now-prev.lastAt<5000)?prev.count+1:1;prev.lastAt=now;spiroPassIsolationRuntime.failureCounts.set(key,prev);
    // Repeated native failures are a performance bug too: do not throw every animation frame.
    // Disable only the failing optional backend for this browser session; compatibility rendering remains available.
    const tripAt=(key==='lamps'||key==='geometry')?1:2;
    // Somata 6.8 iter15: compatibility-disable flags are themselves a compatibility request.
    // A strict Spiral frame must never poison a GPU backend into a later Canvas/mixed route.
    // Keep the native backend eligible and simply retry the GPU frame after warmup/recovery.
    if(prev.count>=tripAt&&['geometry','lamps','web','sweep','profile','motion','sprite','outline','glow'].includes(key)){
        if(strictSpiral)spiroPassIsolationRuntime.strictSessionDisableBlocks++;
        else spiroPassIsolationRuntime.sessionDisabled.add(key);
    }
    spiroPassIsolationRuntime.recent.push({frameId:spiroPassIsolationRuntime.frameId,pass:key,layer:spiroPassIsolationRuntime.lastLayer,message:msg.slice(0,600),at:now});if(spiroPassIsolationRuntime.recent.length>16)spiroPassIsolationRuntime.recent.shift();
    try{renderBackendTelemetry?.mark?.(key,'compat',`isolated ${key} failure`,true);}catch(_){}
    if(!prev.loggedAt||now-prev.loggedAt>1200){console.error(`SpiroStar isolated ${key} pass failure:`,err);prev.loggedAt=now;}
}
function runSpiroIsolatedRenderPass(frameCtx,pass,fn,fallback=null){
    const key=String(pass||'unknown'),ctxSnap=spiroCaptureTransientCanvasOverrides(mainCtx);let saved=false;
    const strictSpiral=Boolean(frameCtx&&typeof isStrictSpiralWebGPUFrame==='function'&&isStrictSpiralWebGPUFrame(frameCtx));
    const restoreFailedAttempt=()=>{
        if(saved){try{mainCtx.restore();}catch(_){}saved=false;}
        spiroRestoreTransientCanvasOverrides(mainCtx,ctxSnap);
    };
    try{mainCtx?.save?.();saved=true;}catch(_){}
    try{return{ok:true,value:fn?.()};}
    catch(err){
        spiroPassIsolationNoteFailure(key,err,frameCtx);
        // Strict non-Fourier Spiral is one WebGPU scene. Even an exception in Base/Glow/effect
        // code may not invoke the historical compatibility callback, because that would mix a
        // Canvas carrier with already-resident GPU effects. Fail closed for this frame and ask
        // for another GPU frame; completed GPU work remains resident/ordered.
        if(strictSpiral){
            restoreFailedAttempt();
            spiroPassIsolationRuntime.strictFallbackBlocks++;
            spiroPassIsolationRuntime.skippedPasses++;
            try{requestMainCanvasRender?.();}catch(_){}
            return{ok:false,error:err,strictGpuOnly:true};
        }
        if(typeof fallback==='function'){
            // Critical v522.1 rule: compatibility retry must start from the exact canvas/custom
            // state that existed before the failed native pass. CanvasRenderingContext2D.save()
            // does not cover SpiroStar's custom __suppress* overrides, so restore both layers
            // BEFORE invoking the retry; otherwise a failed GPU/Base pass can poison its own
            // Canvas fallback and leave only Glow visible.
            restoreFailedAttempt();
            try{mainCtx?.save?.();saved=true;}catch(_){}
            spiroPassIsolationRuntime.retries++;spiroForceCompatibility(key,true);
            try{const value=fallback(err);spiroPassIsolationRuntime.retrySuccesses++;return{ok:true,retried:true,value};}
            catch(retryErr){spiroPassIsolationRuntime.retryFailures++;spiroPassIsolationNoteFailure(`${key}:compat`,retryErr,frameCtx);return{ok:false,error:retryErr};}
            finally{spiroForceCompatibility(key,false);}
        }
        spiroPassIsolationRuntime.skippedPasses++;return{ok:false,error:err};
    }finally{
        if(saved)try{mainCtx.restore();}catch(_){}
        spiroRestoreTransientCanvasOverrides(mainCtx,ctxSnap);
    }
}
function runSpiroIsolatedLayerPreparation(renderFrame,layerIndex,prepareFn){
    try{return prepareFn();}
    catch(err){spiroPassIsolationNoteFailure('layerPrepare',err,{frameId:renderFrame?.id,layerIndex});return null;}
}
window.__spiroPassIsolationStatus=()=>({
    frameId:spiroPassIsolationRuntime.frameId,failures:spiroPassIsolationRuntime.failures,retries:spiroPassIsolationRuntime.retries,
    retrySuccesses:spiroPassIsolationRuntime.retrySuccesses,retryFailures:spiroPassIsolationRuntime.retryFailures,skippedPasses:spiroPassIsolationRuntime.skippedPasses,strictFallbackBlocks:spiroPassIsolationRuntime.strictFallbackBlocks,strictSessionDisableBlocks:spiroPassIsolationRuntime.strictSessionDisableBlocks,
    lastError:spiroPassIsolationRuntime.lastError,lastPass:spiroPassIsolationRuntime.lastPass,lastLayer:spiroPassIsolationRuntime.lastLayer,
    sessionDisabled:[...spiroPassIsolationRuntime.sessionDisabled],failureCounts:[...spiroPassIsolationRuntime.failureCounts].map(([pass,v])=>({pass,count:v.count,lastAt:v.lastAt})),recent:[...spiroPassIsolationRuntime.recent],
    contract:'ordinary effects remain fail-open with isolated compatibility retry; strict non-Fourier Spiral is fail-closed GPU-only, blocks compatibility callbacks/session-disable poisoning, preserves resident GPU work and retries a later GPU frame.'
});
