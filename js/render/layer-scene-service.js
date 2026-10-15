window.__spiroRegisterModule?.('js/render/layer-scene-service');

// Shared compositor boundary. Effects never open/own WebGPU layer scenes directly;
// they ask this service for a target and queue ordered work through one API.
const SomataLayerSceneService=(()=>{
    const stats={ensureCalls:0,ensureHits:0,ensureOpens:0,ensureMisses:0,queued:0,rootQueued:0,stateWrites:0,failed:0,lastLabel:'',lastReason:''};
    function renderer(){return typeof WebGPUStrokeRenderer!=='undefined'?WebGPUStrokeRenderer:null;}
    function resident(frameCtx){
        const r=renderer();if(!r||!frameCtx)return null;
        try{return r.getDeferredLayerSceneTexture?.(frameCtx.frameId)||null;}catch(_){return null;}
    }
    function ensure(frameCtx,label='effect'){
        stats.ensureCalls++;stats.lastLabel=String(label||'effect');
        let scene=resident(frameCtx);if(scene?.texture){stats.ensureHits++;return scene;}
        const r=renderer();if(!r||!frameCtx?.frame){stats.ensureMisses++;stats.lastReason='renderer-or-frame-unavailable';return null;}
        // Layer Scene is shared infrastructure, so it owns its renderer lifecycle.
        // Fill/Web may be the first passes in the frame and must not depend on a
        // later Base/Line batch to warm WebGPUStrokeRenderer.
        try{r.warmup?.();}catch(_){}
        let opened=false;
        try{opened=r.canUseExternalLayerScene?.(frameCtx.frameId)===true&&r.beginExternalLayerScene?.(frameCtx.frameId,String(label||'effect'))===true;}catch(_){opened=false;}
        if(!opened){stats.ensureMisses++;stats.lastReason='external-layer-scene-unavailable';return null;}
        markDeferred(frameCtx,{mainSceneEmpty:frameCtx.frame.gpuMainCanvasHasContent!==true});
        scene=resident(frameCtx);if(scene?.texture){stats.ensureOpens++;stats.lastReason='';return scene;}
        stats.ensureMisses++;stats.lastReason='scene-opened-without-texture';return null;
    }
    function canOpen(frameCtx){
        const r=renderer();if(!r||!frameCtx)return false;
        try{return r.canUseExternalLayerScene?.(frameCtx.frameId)===true&&Boolean(r.getExternalLayerSceneTarget?.(frameCtx.frameId)?.texture);}catch(_){return false;}
    }
    function target(frameCtx,label='effect'){
        const live=resident(frameCtx);if(live?.texture)return{...live,resident:true};
        const r=renderer();if(!r||!frameCtx)return null;
        try{const t=r.getExternalLayerSceneTarget?.(frameCtx.frameId)||null;return t?.texture?{...t,resident:false,label:String(label||'effect')}:null;}catch(_){return null;}
    }
    function queue(frameCtx,phase,commandBuffer,label='effect',onSubmitted=null){
        if(!commandBuffer){try{onSubmitted?.();}catch(_){}return true;}
        stats.lastLabel=String(label||'effect');
        let ok=false;
        try{
            if(typeof queueLayerSceneEffectCommand==='function')ok=queueLayerSceneEffectCommand(frameCtx,phase,commandBuffer,label,onSubmitted)===true;
            else if(typeof spiroGpuScheduleLayerSceneCommand==='function')ok=spiroGpuScheduleLayerSceneCommand(frameCtx,phase,commandBuffer,label,onSubmitted)===true;
        }catch(_){ok=false;}
        if(ok)stats.queued++;else{stats.failed++;stats.lastReason='queue-failed';}
        return ok;
    }
    function queueAsRoot(frameCtx,phase,commandBuffer,label='effect',onSubmitted=null){
        if(!commandBuffer){try{onSubmitted?.();}catch(_){}return true;}
        const existing=resident(frameCtx);
        if(existing?.texture)return queue(frameCtx,phase,commandBuffer,label,onSubmitted);
        const r=renderer();let ok=false;
        try{ok=r?.deferExternalLayerScene?.(commandBuffer,frameCtx?.frameId,String(label||'effect'))===true;}catch(_){ok=false;}
        if(ok){
            if(frameCtx?.frame)markDeferred(frameCtx,{mainSceneEmpty:false});
            stats.rootQueued++;stats.lastReason='';
            // deferExternalLayerScene owns submit callback only when supported by its caller;
            // callers that need a callback should prefer ensure()+queue().
            return true;
        }
        stats.failed++;stats.lastReason='root-queue-failed';return false;
    }
    function texture(frameCtx,label='effect',open=true){const s=open?ensure(frameCtx,label):resident(frameCtx);return s?.texture||null;}
    function markDeferred(frameCtx,opt={}){
        const frame=frameCtx?.frame;if(!frame)return false;frame.gpuLayerSceneDeferred=true;
        if(Object.prototype.hasOwnProperty.call(opt,'mainSceneEmpty'))frame.gpuMainSceneEmpty=Boolean(opt.mainSceneEmpty);
        stats.stateWrites++;return true;
    }
    function markPresented(frameCtx){const frame=frameCtx?.frame;if(!frame)return false;frame.gpuMainSceneEmpty=false;stats.stateWrites++;return true;}
    function markStrictPresentation(frameCtx,required=true){const frame=frameCtx?.frame;if(!frame)return false;frame.strictSpiralGpuPresentRequired=required===true;stats.stateWrites++;return true;}
    function markMainCanvasContent(frameCtx,hasContent=true){const frame=frameCtx?.frame;if(!frame)return false;frame.gpuMainCanvasHasContent=hasContent===true;if(hasContent)frame.gpuMainSceneEmpty=false;stats.stateWrites++;return true;}
    function resetDeferred(frameCtx,opt={}){
        const frame=frameCtx?.frame;if(!frame)return false;frame.gpuLayerSceneDeferred=false;
        if(Object.prototype.hasOwnProperty.call(opt,'mainSceneEmpty'))frame.gpuMainSceneEmpty=Boolean(opt.mainSceneEmpty);
        if(opt.clearQueues===true)try{clearLayerSceneEffectCommands(frame);}catch(_){}
        stats.stateWrites++;return true;
    }
    function status(){return{...stats,contract:'Effects consume a Layer Scene capability. Only this service opens external Layer Scenes or queues ordered scene commands.'};}
    return{resident,canOpen,target,ensure,texture,queue,queueAsRoot,markDeferred,markPresented,markStrictPresentation,markMainCanvasContent,resetDeferred,status};
})();
window.SomataLayerSceneService=SomataLayerSceneService;
window.__somataLayerSceneServiceStatus=()=>SomataLayerSceneService.status();


// Core queue/materialization implementation lives with the scene service.
function getLayerSceneEffectQueue(frameCtxOrFrame){
    const frame=frameCtxOrFrame?.frame||frameCtxOrFrame;if(!frame)return null;
    if(!Array.isArray(frame.gpuLayerSceneEffectCommands))frame.gpuLayerSceneEffectCommands=[];
    return frame.gpuLayerSceneEffectCommands;
}
function beginLayerSceneEffectCommandFrame(frameCtxOrFrame){
    const frame=frameCtxOrFrame?.frame||frameCtxOrFrame;if(!frame)return false;
    const fid=Number(frame.id)||Number(frame.frameId)||0;
    const q=getLayerSceneEffectQueue(frame);if(q)q.length=0;
    const b=frame.gpuLayerSceneCommandBuffers;if(Array.isArray(b))b.length=0;
    frame._gpuLayerSceneEffectQueueFrameId=fid;
    return true;
}
function queueLayerSceneEffectCommand(frameCtx,phase,commandBuffer,label='effect',onSubmitted=null){
    if(typeof spiroGpuScheduleLayerSceneCommand==='function')return spiroGpuScheduleLayerSceneCommand(frameCtx,phase,commandBuffer,label,onSubmitted);
    if(!commandBuffer)return true;const q=getLayerSceneEffectQueue(frameCtx);if(!q)return false;
    const fid=Number(frameCtx?.frame?.id)||Number(frameCtx?.frameId)||Number(frameCtx?.id)||0;
    const item={frameId:fid,phase:Number(phase)||0,commandBuffer,label:String(label||'effect'),onSubmitted:typeof onSubmitted==='function'?onSubmitted:null};let i=q.length;
    while(i>0&&Number(q[i-1]?.phase)>item.phase)i--;q.splice(i,0,item);return true;
}
function notifyLayerSceneEffectCommandsSubmitted(frame){const q=peekLayerSceneEffectCommands(frame);for(const item of q){try{item?.onSubmitted?.();}catch(_){}}}
function peekLayerSceneEffectCommands(frame){
    const q=Array.isArray(frame?.gpuLayerSceneEffectCommands)?frame.gpuLayerSceneEffectCommands:null;if(!q?.length)return[];
    const fid=Number(frame?.id)||Number(frame?.frameId)||0;
    if(!fid)return q;
    // Never submit deferred commands recorded for an older frame.  The frame object is
    // intentionally reused, so queue lifetime must be generation-bound rather than object-bound.
    return q.filter(item=>!Number(item?.frameId)||Number(item.frameId)===fid);
}
function clearLayerSceneEffectCommands(frame){const q=frame?.gpuLayerSceneEffectCommands;if(Array.isArray(q))q.length=0;const b=frame?.gpuLayerSceneCommandBuffers;if(Array.isArray(b))b.length=0;}
function collectLayerSceneCommandBuffers(frame){const q=peekLayerSceneEffectCommands(frame);let out=frame?.gpuLayerSceneCommandBuffers;if(!Array.isArray(out)){if(!frame)return[];out=frame.gpuLayerSceneCommandBuffers=[];}out.length=0;for(let i=0;i<q.length;i++){const b=q[i]?.commandBuffer;if(b)out.push(b);}return out;}
function materializeDeferredLayerScene(frameCtx){
    const frame=frameCtx?.frame;if(!frame?.gpuLayerSceneDeferred)return true;

    const strictFrameIntent=frame.strictSpiralEntryIntent===true||frame.strictSpiralGpuPresentRequired===true||SomataGeometryPolicy.isStrict(frameCtx);
    if(strictFrameIntent){
        renderBackendTelemetry.mark('final','gpu','strict Spiral frame materialization firewall');
        somataGpuContractError('STRICT_SPIRAL_MATERIALIZATION_ATTEMPT',frameCtx,{stage:'materializeDeferredLayerScene',frameIntent:true});
        try{requestMainCanvasRender?.();}catch(_){}
        return false;
    }
    const extra=collectLayerSceneCommandBuffers(frame);
    let ok=false;try{ok=WebGPUStrokeRenderer.presentDeferredLayerSceneToMain(frame.id,mainCtx,extra);}catch(_){ok=false;}
    if(ok){notifyLayerSceneEffectCommandsSubmitted(frame);noteFrameGraphMaterialization(frameCtx?.frameId||frame?.id);frame.gpuLayerSceneDeferred=false;frame.gpuMainSceneEmpty=false;clearLayerSceneEffectCommands(frame);}return ok;
}


// Admission/composition policy lives in compositor-policy.js. This module owns scene mechanics only.

const SOMATA_STRICT_SPIRAL_GPU_PRESENTATION=false; // 7.5: stability first; specialized Spiral rails may be used, but failure falls back to the general GPU path.
