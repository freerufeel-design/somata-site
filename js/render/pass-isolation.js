window.__spiroRegisterModule?.('js/render/pass-isolation');

const SPIRO_TRANSIENT_CTX_KEYS=['__suppressStroke','__suppressFill','__forceStrokeStyle','__forcedLineWidth'];
const spiroPassIsolationRuntime={frameId:0,failures:0,skippedPasses:0,lastError:'',lastPass:'',lastLayer:-1,lastAt:0,failureCounts:new Map(),recent:[]};
function spiroCaptureTransientCanvasOverrides(ctx){const out={};for(const key of SPIRO_TRANSIENT_CTX_KEYS)out[key]={had:Object.prototype.hasOwnProperty.call(ctx||{},key),value:ctx?.[key]};return out;}
function spiroRestoreTransientCanvasOverrides(ctx,snap){if(!ctx||!snap)return;for(const key of SPIRO_TRANSIENT_CTX_KEYS){const rec=snap[key];if(rec?.had)ctx[key]=rec.value;else try{delete ctx[key];}catch(_){ctx[key]=undefined;}}}
function beginSpiroPassIsolationFrame(frameId){spiroPassIsolationRuntime.frameId=Math.max(0,Number(frameId)||0);}
function spiroPassIsolationNoteFailure(pass,err,frameCtx=null){
    const key=String(pass||'unknown'),now=performance.now(),msg=String(err?.stack||err?.message||err||'unknown error'),layer=Number(frameCtx?.layerIndex??-1),prev=spiroPassIsolationRuntime.failureCounts.get(key)||{count:0,lastAt:0,loggedAt:0};
    prev.count=(now-prev.lastAt<5000)?prev.count+1:1;prev.lastAt=now;spiroPassIsolationRuntime.failureCounts.set(key,prev);
    spiroPassIsolationRuntime.failures++;spiroPassIsolationRuntime.lastError=msg;spiroPassIsolationRuntime.lastPass=key;spiroPassIsolationRuntime.lastLayer=layer;spiroPassIsolationRuntime.lastAt=now;
    spiroPassIsolationRuntime.recent.push({frameId:spiroPassIsolationRuntime.frameId,pass:key,layer,message:msg.slice(0,600),at:now});if(spiroPassIsolationRuntime.recent.length>16)spiroPassIsolationRuntime.recent.shift();
    try{renderBackendTelemetry?.mark?.(key,'gpu',`isolated GPU ${key} failure`,true);}catch(_){}
    try{window.__somataReportGpuBackendFailure?.(key,msg,{frameId:spiroPassIsolationRuntime.frameId,layer,repeat:prev.count});}catch(_){}
    let structured=false;
    try{if(typeof somataGpuDiagnosticError==='function'){somataGpuDiagnosticError(key,'pass-exception',msg,frameCtx,{fallback:'skip-pass',recovered:true,repeat:prev.count});structured=true;}}catch(_){}
    if(!structured&&(!prev.loggedAt||now-prev.loggedAt>1200)){console.error(`[Somata 7.4.9 GPU pass] ${key} failed; pass skipped, frame loop remains alive`,{frameId:spiroPassIsolationRuntime.frameId,layer,repeat:prev.count,error:err});prev.loggedAt=now;}
}
function runSpiroIsolatedRenderPass(frameCtx,pass,fn){
    const snap=spiroCaptureTransientCanvasOverrides(mainCtx);let saved=false;try{mainCtx?.save?.();saved=true;}catch(_){}
    try{return{ok:true,value:fn?.()};}
    catch(err){spiroPassIsolationNoteFailure(pass,err,frameCtx);spiroPassIsolationRuntime.skippedPasses++;try{requestMainCanvasRender?.();}catch(_){}return{ok:false,error:err,gpuOnly:true};}
    finally{if(saved)try{mainCtx.restore();}catch(_){}spiroRestoreTransientCanvasOverrides(mainCtx,snap);}
}
function runSpiroIsolatedLayerPreparation(renderFrame,layerIndex,prepareFn){try{return prepareFn();}catch(err){spiroPassIsolationNoteFailure('layerPrepare',err,{frameId:renderFrame?.id,layerIndex});try{requestMainCanvasRender?.();}catch(_){}return null;}}
window.__spiroPassIsolationStatus=()=>({frameId:spiroPassIsolationRuntime.frameId,failures:spiroPassIsolationRuntime.failures,skippedPasses:spiroPassIsolationRuntime.skippedPasses,lastError:spiroPassIsolationRuntime.lastError,lastPass:spiroPassIsolationRuntime.lastPass,lastLayer:spiroPassIsolationRuntime.lastLayer,failureCounts:[...spiroPassIsolationRuntime.failureCounts].map(([pass,v])=>({pass,count:v.count,lastAt:v.lastAt})),recent:[...spiroPassIsolationRuntime.recent],gpuOnly:true,contract:'A failed pass is isolated, logged, skipped for the current frame and retried by the shared scheduler. No CPU/Canvas compatibility retry.'});
