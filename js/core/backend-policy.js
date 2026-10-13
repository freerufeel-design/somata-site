window.__spiroRegisterModule?.('js/core/backend-policy');

let somataGpuCapabilityCache=null;
const somataGpuFeatureWaits=new Map();
const somataGpuBackendRuntime={failures:0,last:null,lastAt:0,byFeature:Object.create(null),lastLogAt:new Map()};

function somataDetectGpuCapability(force=false){
  if(!force&&somataGpuCapabilityCache)return somataGpuCapabilityCache;
  somataGpuCapabilityCache=Object.freeze({webgpu:Boolean(globalThis.navigator?.gpu)});
  return somataGpuCapabilityCache;
}
function somataRenderBackendEffective(){return somataDetectGpuCapability().webgpu?'gpu':'unavailable';}
function somataGpuBackendAllowed(){return somataRenderBackendEffective()==='gpu';}
function somataGpuFeatureWaitKey(feature,frameCtx){const layer=frameCtx?.effectLayer||frameCtx?.layer;return `${String(feature||'feature')}:${String(layer?.id||layer?.name||frameCtx?.layerIndex||'layer')}`;}
function somataGpuFeatureReady(feature,frameCtx=null){const key=frameCtx?somataGpuFeatureWaitKey(feature,frameCtx):String(feature||'');if(key)somataGpuFeatureWaits.delete(key);return true;}
function somataReportGpuBackendFailure(feature,reason,detail=null){
  const f=String(feature||'gpu'),message=String(reason||'GPU failure'),now=performance?.now?.()??Date.now(),key=`${f}:${message}`;
  somataGpuBackendRuntime.failures++;somataGpuBackendRuntime.last={feature:f,reason:message,detail:detail??null,at:Date.now()};somataGpuBackendRuntime.lastAt=now;somataGpuBackendRuntime.byFeature[f]=(somataGpuBackendRuntime.byFeature[f]||0)+1;
  const prev=somataGpuBackendRuntime.lastLogAt.get(key)||-1e9;if(now-prev>1000){somataGpuBackendRuntime.lastLogAt.set(key,now);console.error('[Somata 7.5 GPU]',somataGpuBackendRuntime.last);}
  return false;
}
function somataGpuFeatureWaitOrFallback(feature,reason='GPU feature unavailable',detail=null,timeoutMs=650,frameCtx=null,immediate=false){
  const key=frameCtx?somataGpuFeatureWaitKey(feature,frameCtx):String(feature||'gpu-feature'),now=performance?.now?.()??Date.now();let rec=somataGpuFeatureWaits.get(key);
  if(!rec){rec={startedAt:now,lastAt:now,frames:0,reason:String(reason||''),detail:detail??null};somataGpuFeatureWaits.set(key,rec);}rec.lastAt=now;rec.frames++;rec.reason=String(reason||rec.reason||'');rec.detail=detail??rec.detail??null;
  const elapsed=Math.max(0,now-rec.startedAt),limit=Math.max(0,Number(timeoutMs)||0);if(immediate||elapsed>=limit){somataReportGpuBackendFailure(key,rec.reason,{...rec.detail,elapsedMs:elapsed,frames:rec.frames});somataGpuFeatureWaits.delete(key);}
  try{requestMainCanvasRender?.();}catch(_){}return false;
}
function somataClearGpuFeatureWaits(){somataGpuFeatureWaits.clear();}

window.__somataRenderBackend=()=>({effective:somataRenderBackendEffective(),gpuOnly:true,gpuAllowed:somataGpuBackendAllowed(),webgpuSupported:somataDetectGpuCapability().webgpu,gpuFeatureWaits:Array.from(somataGpuFeatureWaits.entries()).map(([key,v])=>({key,reason:v.reason,frames:v.frames,ageMs:Math.max(0,(performance?.now?.()??Date.now())-v.startedAt)})),failures:somataGpuBackendRuntime.failures,lastFailure:somataGpuBackendRuntime.last,byFeature:{...somataGpuBackendRuntime.byFeature}});
window.__somataRefreshRenderBackendCapability=()=>{somataGpuCapabilityCache=null;return window.__somataRenderBackend();};
window.__somataGpuFeatureReady=(feature,frameCtx)=>somataGpuFeatureReady(feature,frameCtx);
window.__somataGpuFeatureWaitOrFallback=(feature,reason,detail,timeoutMs,frameCtx,immediate)=>somataGpuFeatureWaitOrFallback(feature,reason,detail,timeoutMs,frameCtx,immediate);
window.__somataResetGpuFeatureWaits=()=>{somataClearGpuFeatureWaits();return true;};
window.__somataReportGpuBackendFailure=(feature,reason,detail)=>somataReportGpuBackendFailure(feature,reason,detail);
