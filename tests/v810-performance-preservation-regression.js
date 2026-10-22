// Version 8.1: cache identity must be authored, never render-snapshot identity.
// The test uses the real browser boot but does not depend on physical WebGPU.
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(value,message)=>{if(!value)throw Error(message)};
(async()=>{
  const h=await createBrowserHarness({disableGpu:true,loadDelayMs:200,evalTimeoutMs:13000});
  try{
    const data=await h.evaluate(`(()=>{
      const originalOrder=Array.isArray(state.effectOrder)?state.effectOrder.slice():null;
      const standard=['fill','web','geometry','lamps','sweep','pathfx','particles'];
      SomataEffectStackOrder.set(standard);
      const initialRef=state.effectOrder;
      const a=SomataEffectStackOrder.phase('web');
      for(let i=0;i<1500;i++)SomataEffectStackOrder.phase('web');
      const noOrderAllocation=initialRef===state.effectOrder;
      state.effectOrder[0]='web';state.effectOrder[1]='fill';
      const b=SomataEffectStackOrder.phase('web');
      const inPlaceObserved=b<a;
      SomataEffectStackOrder.set(originalOrder||standard);
      const registry=SomataRenderPassRegistry;
      registry.register('v810-temporary-early',{stage:20,order:-200,run:()=>true});
      registry.register('v810-temporary-late',{stage:20,order:200,run:()=>true});
      const before=registry.stage(20).map(r=>r.name);
      registry.register('v810-temporary-early',{stage:20,order:250,run:()=>true});
      const after=registry.stage(20).map(r=>r.name);
      const registryInvalidated=before.indexOf('v810-temporary-early')<before.indexOf('v810-temporary-late')&&after.indexOf('v810-temporary-early')>after.indexOf('v810-temporary-late');
      const l=createLayer('v810-pool-check');
      const make=()=>({layer:SomataRenderLayerSnapshot.create(l),sourceLayer:l,effectLayerSource:l,geometryPlan:{kind:'blue-circle-slide',dynamic:true}});
      const f1=make(),f2=make();
      const rec1=getPhaseResidentMorphGLRecorder(f1),rec2=getPhaseResidentMorphGLRecorder(f2);
      const tunnel1=getDynamicTunnelMorphMasterRecorder(f1),tunnel2=getDynamicTunnelMorphMasterRecorder(f2);
      const poolStable=rec1===rec2&&tunnel1===tunnel2;
      const poolDifferentLayers=rec1!==getPhaseResidentMorphGLRecorder({ ...make(),sourceLayer:createLayer('other'),effectLayerSource:createLayer('other-two') });
      const savedTunnel=state.tunnel.active;state.tunnel.active=true;
      const corridorReason=describeBaseGpuFallback({layer:l,layerIndex:0},null,false);
      const hasWebGpu=!!navigator.gpu;
      state.tunnel.active=savedTunnel;
      const freeze=animationScheduler.freezeStats();
      return {noOrderAllocation,inPlaceObserved,registryInvalidated,poolStable,poolDifferentLayers,corridorReason,hasWebGpu,freezeFields:['performanceConsoleNotes','performanceConsoleSuppressed'].every(k=>typeof freeze[k]==='number'),boot:window.__spiroAppBootComplete===true};
    })()`,{timeoutMs:10000,label:'v810 performance safety'});
    for(const [k,v] of Object.entries(data)){if(k==='corridorReason')assert(v.startsWith(data.hasWebGpu?'GPU Corridor Base unavailable:':'WebGPU unavailable:'),`bad corridor diagnosis: ${v}`);else if(k!=='hasWebGpu')assert(v===true,`${k}: ${v}`)}
    assert(uncaughtExceptions(h.events).length===0,'uncaught browser exceptions '+uncaughtExceptions(h.events).join('; '));
    console.log('PASS v8.1 cached stages, live effect order, recorder owner, Corridor diagnostics and freeze history',data);
  }finally{await h.close()}
})().catch(err=>{console.error('FAIL v8.1',err.stack||err);process.exitCode=1});
