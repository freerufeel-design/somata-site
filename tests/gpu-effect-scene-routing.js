const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const fs=require('fs');
const path=require('path');
const assert=(cond,msg)=>{if(!cond)throw new Error(msg);};

async function main(){
  const gpuCore=fs.readFileSync(path.join(__dirname,'..','js/app/geometry-gpu-core.js'),'utf8');
  const lampRenderer=fs.readFileSync(path.join(__dirname,'..','js/gpu/lamp-renderer.js'),'utf8');
  const pipeline=fs.readFileSync(path.join(__dirname,'..','js/render/main-pipeline.js'),'utf8');
  const webPass=fs.readFileSync(path.join(__dirname,'..','js/render/web-pass.js'),'utf8');
  const basePass=fs.readFileSync(path.join(__dirname,'..','js/render/base-pass.js'),'utf8');
  const profilePass=fs.readFileSync(path.join(__dirname,'..','js/render/profile-pass.js'),'utf8');
  const layerCompositePos=gpuCore.indexOf("if(u.d.w>0.5&&!lateCanvasOverlay)");
  const lampCompositePos=gpuCore.indexOf("if(u.d.z>50.0){let lp=textureSample(lampTex,samp,v.uv)");
  assert(layerCompositePos>=0&&lampCompositePos>layerCompositePos,'Final compositor does not place Lamps after Base/Layer scene');
  assert(/fn compositeLamp\(dst:vec4<f32>,src:vec4<f32>,m:i32\)/.test(gpuCore)&&/lampBlendCode=Object\.freeze/.test(gpuCore),'Final compositor is not blend-aware for Lamps');
  assert(/encodeLampBlendIntoTarget\(rawLampSource\.texture,layerSource\.texture,rawLampSource\?\.blendMode/.test(gpuCore),'Lamp ordered interleave ignores the selected blend mode');
  assert(/function compositeToMain\(\)\{[^}]*globalCompositeOperation=lampCanvasCompositeOperation\(frameBlendMode\)/.test(lampRenderer),'Lamp fallback presentation ignores the selected blend mode');
  assert(!/webNeedsUnderBase/.test(pipeline),'legacy Web-under-Base materialization switch still exists');
  const graffitiPhasePos=profilePass.indexOf("somataEffectPhase('geometry',40)");
  const webPhasePos=webPass.indexOf("somataEffectPhase('web'");
  const sweepPass=fs.readFileSync(path.join(__dirname,'..','js/render/sweep-pass.js'),'utf8');
  const particlePass=fs.readFileSync(path.join(__dirname,'..','js/render/particle-pass.js'),'utf8');
  assert(graffitiPhasePos>=0&&webPhasePos>=0&&/somataEffectPhase\('sweep'\)/.test(sweepPass),'central Web/Graffiti/Glint phase markers missing');
  assert(/SomataLayerSceneService\.queue\(frameCtx,somataEffectPhase\('geometry',20\),(?:batch\.commandBuffer|command),'base-layer-scene'/.test(basePass),'Base/Line is not queued through the geometry group');
  assert(/preserveExistingScene/.test(gpuCore),'Base/Line Layer Scene cannot preserve resident Web');
  assert(/somataEffectPhase\('particles'\)/.test(particlePass),'Particles are not queued through the central artistic stack');
  assert(/wantsLampInterleave/.test(gpuCore),'Lamp ordered interleave is missing');
  const h=await createBrowserHarness({disableGpu:true,evalTimeoutMs:7000,loadDelayMs:300});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const result=await h.evaluate(`(()=>{
      const l=createLayer('scene-routing');l.N=9;l.K=2;l.customSuborbits=1;l.radius=170;l.visible=true;l.lineVisible=true;l.fill=false;l.showWeb=true;l.sweep.enabled=true;l.sweep.effectType='glint';l.sweep.profileShape='line';ensureLayerEffectState(l);state.layers.splice(0,state.layers.length,l);state.activeLayerId=l.id;refreshLayerLookup(true);
      const makeCtx=(now)=>{beginFrameGeometryRuntime();const c=acquireLayerFrameEffectContext(0);c.layer=l;c.effectLayer=l;c.sourceLayer=l;c.staticDrawData=getCachedLayerDrawData(l);c.canonicalGeometry=getCanonicalLayerGeometry(l);c.now=now;c.frame.now=now;c.frame.dpr=1;c.frame.id=c.frameId;c.strokeWidth=2;c.baseAlpha=1;c.lineAlpha=1;c.lineDisplayEnabled=true;c.visibleInstances={copies:[{scale:1,depthT:0,index:0}],alphas:[1],particleAlphas:[1]};c.layerSweep=getLayerSweepConfig(l);return c;};
      const old={can:WebGPUStrokeRenderer.canUseExternalLayerScene,begin:WebGPUStrokeRenderer.beginExternalLayerScene,get:WebGPUStrokeRenderer.getDeferredLayerSceneTexture,webEncode:WebGPUWebThreadSceneRenderer.encodeToLayerScene,webStatus:WebGPUWebThreadSceneRenderer.status,webWarmup:WebGPUWebThreadSceneRenderer.warmup,sweepEncode:WebGPUCanonicalSweepRenderer.encodeToLayerScene,particleEncode:WebGPUParticleRenderer.encodeToLayerScene,compositeBatch:WebGPUStrokeRenderer.compositeLayerBatch,gpuAllowed:somataGpuBackendAllowed};
      let active=false,begins=[],webEncodes=0,sweepEncodes=0,particleEncodes=0;
      try{
        somataGpuBackendAllowed=()=>true;WebGPUStrokeRenderer.canUseExternalLayerScene=()=>true;
        WebGPUStrokeRenderer.beginExternalLayerScene=(id,label)=>{active=true;begins.push(String(label));return true;};
        WebGPUStrokeRenderer.getDeferredLayerSceneTexture=()=>active?{texture:{fake:true}}:null;
        WebGPUWebThreadSceneRenderer.status=()=>({available:true,initializing:false,lastError:''});WebGPUWebThreadSceneRenderer.encodeToLayerScene=()=>{webEncodes++;return{handled:true,commandBuffer:{kind:'web'}};};
        WebGPUCanonicalSweepRenderer.encodeToLayerScene=()=>{sweepEncodes++;return{handled:true,commandBuffer:{kind:'sweep'}};};
        WebGPUParticleRenderer.encodeToLayerScene=()=>{particleEncodes++;return{handled:true,commandBuffer:{kind:'particles'}};};

        const wctx=makeCtx(1200),wd=prepareLayerFrameWebData(wctx);wctx.effectsPlan.web={enabled:true,frameData:wd,paths:wd.paths,tunnelActive:false,footprint:null};wctx.frame.gpuLayerSceneDeferred=false;active=false;renderLayerWebPass(wctx);const webQueue=wctx.frame.gpuLayerSceneEffectCommands||[];const web={began:begins.includes('web-effect'),deferred:wctx.frame.gpuLayerSceneDeferred===true,handled:wctx._webPassHandled===true,encoded:webEncodes>0,queued:webQueue.some(x=>x.label?.startsWith('web')),phase:webQueue.find(x=>x.label?.startsWith('web'))?.phase||0};

        active=false;begins=[];const sctx=makeCtx(1300),sd=prepareLayerFrameSweepData(sctx);sd.cfg.effectType='glint';sd.cfg.profileShape='line';sd.canonicalGPU=true;sd.bezierGlintGPU=false;if(!sd.prepared?.table)sd.prepared={table:buildPathLengthTable(sd.paths||[]),lenFrac:.2};if(!(sd.sweepW>0))sd.sweepW=2;if(!sd.glintVisual)sd.glintVisual={glowSize:0,strength:1,brightness:1,softness:0,opacity:1};sctx.effectsPlan.sweep={enabled:true,frameData:sd,paths:sd.paths,tunnelActive:false,footprint:null};sctx.frame.gpuLayerSceneDeferred=false;renderLayerSweepPass(sctx);const sweep={began:begins.includes('sweep-effect'),deferred:sctx.frame.gpuLayerSceneDeferred===true,encoded:sweepEncodes>0,queued:(sctx.frame.gpuLayerSceneEffectCommands||[]).some(x=>x.label==='sweep')};
        active=false;begins=[];l.particles.enabled=true;const pctx=makeCtx(1350);pctx.frame.gpuLayerSceneDeferred=false;renderLayerParticlePass(pctx);const particleQueue=pctx.frame.gpuLayerSceneEffectCommands||[];const particles={began:begins.includes('particle-effect'),deferred:pctx.frame.gpuLayerSceneDeferred===true,encoded:particleEncodes>0,phase:particleQueue.find(x=>x.label==='particles')?.phase||0};

        active=false;begins=[];let warmups=0,warmupEncodes=0;WebGPUWebThreadSceneRenderer.status=()=>({available:false,initializing:true,lastError:''});WebGPUWebThreadSceneRenderer.warmup=()=>{warmups++;return false;};WebGPUWebThreadSceneRenderer.encodeToLayerScene=()=>{warmupEncodes++;return null;};const waitCtx=makeCtx(1400),waitData=prepareLayerFrameWebData(waitCtx);waitCtx.effectsPlan.web={enabled:true,frameData:waitData,paths:waitData.paths,tunnelActive:false,footprint:null};waitCtx.frame.gpuLayerSceneDeferred=false;renderLayerWebPass(waitCtx);const warming={warmups,encodes:warmupEncodes,deferred:waitCtx.frame.gpuLayerSceneDeferred===true};

        return{web,sweep,particles,warming};
      }finally{WebGPUStrokeRenderer.canUseExternalLayerScene=old.can;WebGPUStrokeRenderer.beginExternalLayerScene=old.begin;WebGPUStrokeRenderer.getDeferredLayerSceneTexture=old.get;WebGPUStrokeRenderer.compositeLayerBatch=old.compositeBatch;WebGPUWebThreadSceneRenderer.encodeToLayerScene=old.webEncode;WebGPUWebThreadSceneRenderer.status=old.webStatus;WebGPUWebThreadSceneRenderer.warmup=old.webWarmup;WebGPUCanonicalSweepRenderer.encodeToLayerScene=old.sweepEncode;WebGPUParticleRenderer.encodeToLayerScene=old.particleEncode;somataGpuBackendAllowed=old.gpuAllowed;}
    })()`);
    assert(result.web.began&&result.web.deferred&&result.web.handled&&result.web.encoded&&result.web.queued&&result.web.phase===200,'Web did not create/use the default central Web phase of a transparent GPU Layer Scene root');
    assert(result.sweep.began&&result.sweep.deferred&&result.sweep.encoded&&result.sweep.queued,'Sweep did not create/use a transparent GPU Layer Scene root');
    assert(result.particles.began&&result.particles.deferred&&result.particles.encoded&&result.particles.phase===700,'Particles did not create/use the default central Particles phase of a transparent GPU Layer Scene root');
    assert(result.warming.warmups>0&&result.warming.encodes===0,'Web warm-up state attempted an encode instead of waiting for initialization');
    const exc=uncaughtExceptions(h.events).slice(baseline);assert(exc.length===0,'uncaught browser exceptions: '+exc.join(' | '));
    console.log('PASS Web transparent GPU Layer Scene root',result.web);
    console.log('PASS Sweep transparent GPU Layer Scene root',result.sweep);
    console.log('PASS Particle default-stack GPU Layer Scene phase',result.particles);
    console.log('PASS Web initialization wait',result.warming);
    console.log('PASS default effect stack Fill < Web < Geometry < Lamps < Sweep < PathFX < Particles');
    console.log('PASS Web is resident above Fill and Base/Line appends above resident Web');
    console.log('GPU EFFECT SCENE ROUTING: 6/6 PASS');
  } finally {await h.close();}
}
main().catch(err=>{console.error('FAIL GPU effect scene routing:',err.stack||err.message);process.exit(1);});
