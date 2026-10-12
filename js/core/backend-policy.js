// Somata 7.3.9 — explicit Auto/CPU/GPU render preference.
window.__spiroRegisterModule?.('js/core/backend-policy');
const SOMATA_RENDER_BACKEND_STORAGE_KEY='somata.renderBackendPreference';
const somataRenderBackendSelect=document.getElementById('renderBackendPreference');
function normalizeSomataRenderBackendPreference(v){const x=String(v||'auto').toLowerCase();return x==='cpu'||x==='gpu'?x:'auto';}
let somataGpuCapabilityCache=null;
function somataDetectGpuCapability(force=false){
  if(!force&&somataGpuCapabilityCache)return somataGpuCapabilityCache;
  let webgl2=false;
  try{const c=document.createElement('canvas');webgl2=Boolean(c.getContext?.('webgl2',{failIfMajorPerformanceCaveat:true}));}catch(_){}
  somataGpuCapabilityCache=Object.freeze({webgpu:Boolean(globalThis.navigator?.gpu),webgl2});
  return somataGpuCapabilityCache;
}
let somataRenderBackendPreference='auto';
// Runtime GPU failover is intentionally separate from the user's preference. A project may
// request GPU, hit a device/pipeline/scene failure during first-use preparation, and continue
// immediately on the CPU reference renderer without silently rewriting the user's choice.
let somataGpuRuntimeFallback=null;
// Optional native effects (Web/Lamps/Lightning) are allowed a short asynchronous warm-up,
// but they must never leave a strict-Spiral project visually dead forever.  Track first-use
// waits per layer/feature and degrade the whole strict scene to the proven CPU reference
// renderer when a native resource does not become resident within the bounded grace period.
const somataGpuFeatureWaits=new Map();
function somataGpuFeatureWaitKey(feature,frameCtx){
  const layer=frameCtx?.layer,layerId=layer?.id||layer?.name||frameCtx?.layerIndex||'layer';
  return `${String(feature||'feature')}:${String(layerId)}`;
}
function somataGpuFeatureReady(keyOrFeature,frameCtx=null){
  const key=frameCtx?somataGpuFeatureWaitKey(keyOrFeature,frameCtx):String(keyOrFeature||'');
  if(key)somataGpuFeatureWaits.delete(key);
  return true;
}
function somataGpuFeatureWaitOrFallback(keyOrFeature,reason='GPU feature unavailable',detail=null,timeoutMs=650,frameCtx=null,immediate=false){
  if(!somataGpuBackendAllowed())return true;
  const key=frameCtx?somataGpuFeatureWaitKey(keyOrFeature,frameCtx):String(keyOrFeature||'gpu-feature');
  const now=typeof performance!=='undefined'&&performance.now?performance.now():Date.now();
  let rec=somataGpuFeatureWaits.get(key);
  if(!rec){rec={startedAt:now,lastAt:now,frames:0,reason:String(reason||''),detail:detail??null};somataGpuFeatureWaits.set(key,rec);}
  rec.lastAt=now;rec.frames++;rec.reason=String(reason||rec.reason||'');rec.detail=detail??rec.detail??null;
  const elapsed=Math.max(0,now-rec.startedAt),limit=Math.max(0,Number(timeoutMs)||0);
  if(immediate||elapsed>=limit){
    somataGpuFeatureWaits.delete(key);
    somataDegradeGpuBackend(`optional GPU ${key} unavailable: ${rec.reason}`,{...rec.detail,feature:key,elapsedMs:elapsed,frames:rec.frames});
    return true;
  }
  try{requestMainCanvasRender?.();}catch(_){}
  return false;
}
function somataClearGpuFeatureWaits(){somataGpuFeatureWaits.clear();}

try{somataRenderBackendPreference=normalizeSomataRenderBackendPreference(localStorage.getItem(SOMATA_RENDER_BACKEND_STORAGE_KEY)||'auto');}catch(_){}
function somataRenderBackendEffective(){
  if(somataRenderBackendPreference==='cpu')return'cpu';
  if(somataGpuRuntimeFallback)return'cpu';
  const c=somataDetectGpuCapability();
  // GPU is a priority, not a fail-closed command. Devices/browsers without an accelerated
  // API must stay visually correct on the CPU reference renderer instead of entering a
  // strict-Spiral GPU path that can never acquire a device/scene target.
  // The complete production backend (strict Spiral/Corridor resident scenes included)
  // requires WebGPU. WebGL2-only acceleration is not allowed to advertise the global GPU
  // backend because that would make some playlist effects fail closed instead of rendering.
  return c.webgpu?'gpu':'cpu';
}
function somataCpuBackendForced(){return somataRenderBackendEffective()==='cpu';}
function somataGpuBackendAllowed(){return somataRenderBackendEffective()==='gpu';}
function somataDegradeGpuBackend(reason='runtime GPU failure',detail=null){
  if(somataRenderBackendPreference==='cpu')return false;
  somataGpuRuntimeFallback={reason:String(reason||'runtime GPU failure'),detail:detail??null,at:Date.now()};
  somataClearGpuFeatureWaits();
  try{if(typeof WebGPUStrokeRenderer!=='undefined'){WebGPUStrokeRenderer.clearDeferredLayerScene?.();WebGPUStrokeRenderer.discardFrameScene?.();}}catch(_){}
  try{requestMainCanvasRender?.();}catch(_){}
  return true;
}
function somataClearGpuRuntimeFallback(reason='retry'){
  const had=Boolean(somataGpuRuntimeFallback);somataGpuRuntimeFallback=null;somataClearGpuFeatureWaits();
  if(had){try{requestMainCanvasRender?.();}catch(_){}}
  return had;
}
function setSomataRenderBackendPreference(v,persist=true){
  somataRenderBackendPreference=normalizeSomataRenderBackendPreference(v);
  // Explicit user/backend-test selection is a retry boundary. A previous transient GPU
  // failure must not permanently pin a later project to CPU.
  somataGpuRuntimeFallback=null;somataClearGpuFeatureWaits();
  if(somataRenderBackendSelect)somataRenderBackendSelect.value=somataRenderBackendPreference;
  if(persist)try{localStorage.setItem(SOMATA_RENDER_BACKEND_STORAGE_KEY,somataRenderBackendPreference);}catch(_){}
  try{if(typeof WebGPUStrokeRenderer!=='undefined'){WebGPUStrokeRenderer.clearDeferredLayerScene?.();WebGPUStrokeRenderer.discardFrameScene?.();}}catch(_){}
  try{requestMainCanvasRender?.();}catch(_){}
  return somataRenderBackendPreference;
}
if(somataRenderBackendSelect){somataRenderBackendSelect.value=somataRenderBackendPreference;somataRenderBackendSelect.addEventListener('change',e=>setSomataRenderBackendPreference(e.target.value,true));}
window.__somataRenderBackend=()=>{const capability=somataDetectGpuCapability();const effective=somataRenderBackendEffective();const runtimeFallback=somataGpuRuntimeFallback?{...somataGpuRuntimeFallback}:null;return{preference:somataRenderBackendPreference,effective,cpuForced:effective==='cpu',gpuAllowed:effective==='gpu',webgpuSupported:capability.webgpu,webgl2Supported:capability.webgl2,runtimeFallback,runtimeFallbackActive:Boolean(runtimeFallback),gpuFeatureWaits:Array.from(somataGpuFeatureWaits.entries()).map(([key,v])=>({key,reason:v.reason,frames:v.frames,ageMs:Math.max(0,(typeof performance!=='undefined'&&performance.now?performance.now():Date.now())-v.startedAt)})),fallbackReason:runtimeFallback?`GPU runtime fallback: ${runtimeFallback.reason}`:(somataRenderBackendPreference==='gpu'&&effective==='cpu'?'WebGPU unavailable; CPU reference backend active':'')};};
window.__somataSetRenderBackend=(v)=>setSomataRenderBackendPreference(v,true);
window.__somataRefreshRenderBackendCapability=()=>{somataGpuCapabilityCache=null;return window.__somataRenderBackend();};

window.__somataDegradeGpuBackend=(reason,detail)=>somataDegradeGpuBackend(reason,detail);
window.__somataRetryGpuBackend=()=>{somataClearGpuRuntimeFallback('manual-retry');somataGpuCapabilityCache=null;return window.__somataRenderBackend();};
window.__somataGpuFeatureReady=(feature,frameCtx)=>somataGpuFeatureReady(feature,frameCtx);
window.__somataGpuFeatureWaitOrFallback=(feature,reason,detail,timeoutMs,frameCtx,immediate)=>somataGpuFeatureWaitOrFallback(feature,reason,detail,timeoutMs,frameCtx,immediate);
window.__somataResetGpuFeatureWaits=()=>{somataClearGpuFeatureWaits();return true;};
