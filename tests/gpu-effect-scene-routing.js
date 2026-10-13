const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(cond,msg)=>{if(!cond)throw new Error(msg);};

async function main(){
  const h=await createBrowserHarness({disableGpu:true,evalTimeoutMs:7000,loadDelayMs:300});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const result=await h.evaluate(`(()=>{
      const l=createLayer('scene-routing');l.N=9;l.K=2;l.customSuborbits=1;l.radius=170;l.visible=true;l.lineVisible=true;l.showWeb=true;l.sweep.enabled=true;l.sweep.effectType='glint';l.sweep.profileShape='line';ensureLayerEffectState(l);state.layers.splice(0,state.layers.length,l);state.activeLayerId=l.id;refreshLayerLookup(true);
      const makeCtx=(now)=>{beginFrameGeometryRuntime();const c=acquireLayerFrameEffectContext(0);c.layer=l;c.effectLayer=l;c.sourceLayer=l;c.staticDrawData=getCachedLayerDrawData(l);c.canonicalGeometry=getCanonicalLayerGeometry(l);c.now=now;c.frame.now=now;c.frame.dpr=1;c.frame.id=c.frameId;c.strokeWidth=2;c.baseAlpha=1;c.lineAlpha=1;c.lineDisplayEnabled=true;c.visibleInstances={copies:[{scale:1,depthT:0,index:0}],alphas:[1],particleAlphas:[1]};c.layerSweep=getLayerSweepConfig(l);return c;};
      const old={can:WebGPUStrokeRenderer.canUseExternalLayerScene,begin:WebGPUStrokeRenderer.beginExternalLayerScene,get:WebGPUStrokeRenderer.getDeferredLayerSceneTexture,webEncode:WebGPUWebThreadSceneRenderer.encodeToLayerScene,webStatus:WebGPUWebThreadSceneRenderer.status,webWarmup:WebGPUWebThreadSceneRenderer.warmup,sweepEncode:WebGPUCanonicalSweepRenderer.encodeToLayerScene,gpuAllowed:somataGpuBackendAllowed};
      let active=false,begins=[],webEncodes=0,sweepEncodes=0;
      try{
        somataGpuBackendAllowed=()=>true;WebGPUStrokeRenderer.canUseExternalLayerScene=()=>true;
        WebGPUStrokeRenderer.beginExternalLayerScene=(id,label)=>{active=true;begins.push(String(label));return true;};
        WebGPUStrokeRenderer.getDeferredLayerSceneTexture=()=>active?{texture:{fake:true}}:null;
        WebGPUWebThreadSceneRenderer.status=()=>({available:true,initializing:false,lastError:''});WebGPUWebThreadSceneRenderer.encodeToLayerScene=()=>{webEncodes++;return{handled:true,commandBuffer:{kind:'web'}};};
        WebGPUCanonicalSweepRenderer.encodeToLayerScene=()=>{sweepEncodes++;return{handled:true,commandBuffer:{kind:'sweep'}};};

        const wctx=makeCtx(1200),wd=prepareLayerFrameWebData(wctx);wctx.effectsPlan.web={enabled:true,frameData:wd,paths:wd.paths,tunnelActive:false,footprint:null};wctx.frame.gpuLayerSceneDeferred=false;active=false;renderLayerWebPass(wctx);const web={began:begins.includes('web-effect'),deferred:wctx.frame.gpuLayerSceneDeferred===true,handled:wctx._webPassHandled===true,encoded:webEncodes>0,queued:(wctx.frame.gpuLayerSceneEffectCommands||[]).some(x=>x.label?.startsWith('web'))};

        active=false;begins=[];const sctx=makeCtx(1300),sd=prepareLayerFrameSweepData(sctx);sd.cfg.effectType='glint';sd.cfg.profileShape='line';sd.canonicalGPU=true;sd.bezierGlintGPU=false;if(!sd.prepared?.table)sd.prepared={table:buildPathLengthTable(sd.paths||[]),lenFrac:.2};if(!(sd.sweepW>0))sd.sweepW=2;if(!sd.glintVisual)sd.glintVisual={glowSize:0,strength:1,brightness:1,softness:0,opacity:1};sctx.effectsPlan.sweep={enabled:true,frameData:sd,paths:sd.paths,tunnelActive:false,footprint:null};sctx.frame.gpuLayerSceneDeferred=false;renderLayerSweepPass(sctx);const sweep={began:begins.includes('sweep-effect'),deferred:sctx.frame.gpuLayerSceneDeferred===true,encoded:sweepEncodes>0,queued:(sctx.frame.gpuLayerSceneEffectCommands||[]).some(x=>x.label==='sweep')};
        active=false;begins=[];let warmups=0,warmupEncodes=0;WebGPUWebThreadSceneRenderer.status=()=>({available:false,initializing:true,lastError:''});WebGPUWebThreadSceneRenderer.warmup=()=>{warmups++;return false;};WebGPUWebThreadSceneRenderer.encodeToLayerScene=()=>{warmupEncodes++;return null;};const waitCtx=makeCtx(1400),waitData=prepareLayerFrameWebData(waitCtx);waitCtx.effectsPlan.web={enabled:true,frameData:waitData,paths:waitData.paths,tunnelActive:false,footprint:null};waitCtx.frame.gpuLayerSceneDeferred=false;renderLayerWebPass(waitCtx);const warming={warmups,encodes:warmupEncodes,deferred:waitCtx.frame.gpuLayerSceneDeferred===true};
        return{web,sweep,warming};
      }finally{WebGPUStrokeRenderer.canUseExternalLayerScene=old.can;WebGPUStrokeRenderer.beginExternalLayerScene=old.begin;WebGPUStrokeRenderer.getDeferredLayerSceneTexture=old.get;WebGPUWebThreadSceneRenderer.encodeToLayerScene=old.webEncode;WebGPUWebThreadSceneRenderer.status=old.webStatus;WebGPUWebThreadSceneRenderer.warmup=old.webWarmup;WebGPUCanonicalSweepRenderer.encodeToLayerScene=old.sweepEncode;somataGpuBackendAllowed=old.gpuAllowed;}
    })()`);
    assert(result.web.began&&result.web.deferred&&result.web.handled&&result.web.encoded&&result.web.queued,'Web did not create/use a transparent GPU Layer Scene root');
    assert(result.sweep.began&&result.sweep.deferred&&result.sweep.encoded&&result.sweep.queued,'Sweep did not create/use a transparent GPU Layer Scene root');
    assert(result.warming.warmups>0&&result.warming.encodes===0,'Web warm-up state attempted an encode instead of waiting for initialization');
    const exc=uncaughtExceptions(h.events).slice(baseline);assert(exc.length===0,'uncaught browser exceptions: '+exc.join(' | '));
    console.log('PASS Web transparent GPU Layer Scene root',result.web);
    console.log('PASS Sweep transparent GPU Layer Scene root',result.sweep);
    console.log('PASS Web initialization wait',result.warming);
    console.log('GPU EFFECT SCENE ROUTING: 3/3 PASS');
  } finally {await h.close();}
}
main().catch(err=>{console.error('FAIL GPU effect scene routing:',err.stack||err.message);process.exit(1);});
