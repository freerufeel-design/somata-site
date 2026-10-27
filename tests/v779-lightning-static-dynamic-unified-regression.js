const fs=require('fs');
const path=require('path');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const ROOT=path.resolve(__dirname,'..');
const assert=(c,m)=>{if(!c)throw new Error(m)};
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');

(async()=>{
  const planSrc=read('js/render/sweep-plan.js');
  const pathSrc=read('js/geometry/frame-paths.js');
  const projectSrc=read('js/app/ui-project-runtime.js');
  assert(planSrc.includes("prepared-path-unified-static-dynamic"),'Lightning unified carrier policy missing');
  assert(/strictLightning=cfg\?\.effectType==='lightning'&&SomataGeometryPolicy\.isStrict\(frameCtx\)/.test(planSrc),'retained GPU Arc is not restricted to strict Lightning');
  assert(/cfg\?\.effectType!=='lightning'&&typeof prepareGpuMorphArcSweepFrame/.test(planSrc),'ordinary Lightning can still fall into the Morph Arc sweep branch');
  assert(!pathSrc.includes("!strictSpiral&&typeof spiralMorphUsesCircleRebuild==='function'&&spiralMorphUsesCircleRebuild()"),'Lightning patch must not coerce later 7.7.9 topology carrier through 7.5 circle rebuild');
  assert((projectSrc.match(/ensureSweepAnimation\(\);\s*requestMainCanvasRender\(\);/g)||[]).length>=1,'project load does not re-arm static Sweep/Lightning animation');

  // Reference project is now kept only in the single shipped default playlist.
  const plist=JSON.parse(fs.readFileSync(path.join(ROOT,'default.plist'),'utf8'));
  const entry=plist.projects.find(p=>p&&p.name==='Fucking freak 3');
  assert(entry?.project,'reference project not found in default.plist');
  const reference=structuredClone(entry.project);
  for(const layer of reference.layers){layer.sweep.effectType='lightning';layer.sweep.lightningEnabled=true;}
  const projectJson=JSON.stringify(reference);

  const h=await createBrowserHarness({disableGpu:true,loadDelayMs:220,evalTimeoutMs:15000});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const out=await h.evaluate(`(()=>{
      const project=${projectJson};
      applyLoadedProject(project,{preserveFullMorph:false,preserveMinimalMorph:false,suppressMinimalAutoStart:true,applyProjectDefaultModes:false});
      const schedulerArmed=animationScheduler.has('sweep');
      animationScheduler.remove('sweep');

      const staticPrepared=[];
      for(let i=0;i<state.layers.length;i++){
        const L=state.layers[i];ensureLayerEffectState(L);const cfg=getLayerSweepConfig(L);
        beginFrameGeometryRuntime();const c=acquireLayerFrameEffectContext(i);c.layer=L;c.effectLayer=L;c.sourceLayer=L;c.staticDrawData=getCachedLayerDrawData(L);c.canonicalGeometry=getCanonicalLayerGeometry(L);c.now=1000+i*17;c.frame.now=c.now;c.frame.dpr=1;c.frame.id=c.frameId;c.strokeWidth=Math.max(.5,Number(L.strokeWidth)||1.5);c.layerSweep=cfg;c.sweepPreparedReady=false;
        const d=prepareLayerFrameSweepData(c);staticPrepared.push({enabled:cfg.enabled===true,effectType:cfg.effectType,paths:d?.paths?.length||0,pieces:d?.prepared?.pieces?.length||0,stage:d?.lightningVector?.stage||''});
      }

      const L=state.layers[0],cfg=getLayerSweepConfig(L);
      const oldGpu=prepareGpuMorphArcLightningFrame,oldPrep=prepareLayerFrameSweepData,oldPaths=getLayerFrameAuxiliaryPaths,oldReady=SweepGPURenderer.canEncodeToLayerScene;
      let gpuCalls=0,preparedCalls=0;
      try{
        prepareGpuMorphArcLightningFrame=()=>{gpuCalls++;return{gpuMorphArcLightning:true,lightningVector:{boltW:1},cfg,prepared:{},paths:null};};
        prepareLayerFrameSweepData=(ctx)=>{preparedCalls++;return{cfg,paths:[{points:[{x:0,y:0},{x:1,y:1}],closed:false}],prepared:{pieces:[[{x:0,y:0},{x:1,y:1}]],visible:[]},lightningVector:{stage:'strike',boltW:2}};};
        getLayerFrameAuxiliaryPaths=()=>[{points:[{x:0,y:0},{x:1,y:1}],closed:false}];
        SweepGPURenderer.canEncodeToLayerScene=()=>true;
        const mk=(dynamic)=>({layer:L,effectLayer:L,layerIndex:0,now:1200,strokeWidth:2,geometryPlan:{dynamic},frame:{},sweepData:{}});
        const a=resolveLayerSweepEffectProvider(mk(false),resetSweepEffectPlan({}));
        const b=resolveLayerSweepEffectProvider(mk(true),resetSweepEffectPlan({}));
        var unified={gpuCalls,preparedCalls,staticGpu:a.gpuMorphArcLightning===true,dynamicGpu:b.gpuMorphArcLightning===true,staticPaths:a.paths?.length||0,dynamicPaths:b.paths?.length||0};
      }finally{prepareGpuMorphArcLightningFrame=oldGpu;prepareLayerFrameSweepData=oldPrep;getLayerFrameAuxiliaryPaths=oldPaths;SweepGPURenderer.canEncodeToLayerScene=oldReady;}

      const oldMode=state.morph.mode,oldActive=runtimeState.morph.active,oldSrc=runtimeState.morph.renderSourceLayers,oldDst=runtimeState.morph.renderTargetLayers;
      const oldCircle=buildCurrentCircleMorphPaths,oldTopo=buildCurrentMorphPaths,oldType=state.morph.spiralType;
      let circleCalls=0,topologyCalls=0;
      try{
        state.morph.mode='topology';state.morph.spiralType='phaseCircle';runtimeState.morph.active=true;
        const a={...L,spiralEnabled:false,spiralOrder:0},b={...L,spiralEnabled:false,spiralOrder:0,N:(Number(L.N)||4)+2};runtimeState.morph.renderSourceLayers=[a];runtimeState.morph.renderTargetLayers=[b];
        buildCurrentCircleMorphPaths=()=>{circleCalls++;return[{points:[{x:0,y:0},{x:2,y:2}],closed:false}]};
        buildCurrentMorphPaths=()=>{topologyCalls++;return[{points:[{x:0,y:0},{x:3,y:3}],closed:false}]};
        const paths=getCurrentMorphCpuPaths(0,.5,'lightning-unified-test');
        var carrier={circleCalls,topologyCalls,pathCount:paths?.length||0,spiralType:getSpiralMorphType?.()||''};
      }finally{state.morph.mode=oldMode;state.morph.spiralType=oldType;runtimeState.morph.active=oldActive;runtimeState.morph.renderSourceLayers=oldSrc;runtimeState.morph.renderTargetLayers=oldDst;buildCurrentCircleMorphPaths=oldCircle;buildCurrentMorphPaths=oldTopo;}
      ensureSweepAnimation();
      return{schedulerArmed,staticPrepared,unified,carrier,policy:window.__somataLightningCarrierPolicy?.()||null};
    })()`,{timeoutMs:12000,label:'Lightning unified static/dynamic regression'});

    assert(out.schedulerArmed===true,'loading a static Lightning project did not arm the sweep scheduler');
    assert(out.staticPrepared.length===3&&out.staticPrepared.every(x=>x.enabled&&x.effectType==='lightning'&&x.paths>0&&(x.stage==='idle'||x.pieces>0)),'reference project static Lightning did not prepare non-empty paths/pieces: '+JSON.stringify(out.staticPrepared));
    assert(out.unified.gpuCalls===0&&out.unified.preparedCalls>=2,'static and dynamic ordinary Lightning do not share the prepared handler: '+JSON.stringify(out.unified));
    assert(!out.unified.staticGpu&&!out.unified.dynamicGpu&&out.unified.staticPaths>0&&out.unified.dynamicPaths>0,'ordinary Lightning still changes carrier/backend between static and dynamic');
    assert(out.carrier.circleCalls===0&&out.carrier.topologyCalls===1,'topology Morph was incorrectly coerced through legacy circle rebuild: '+JSON.stringify(out.carrier));
    assert(out.policy?.ordinary==='prepared-path-unified-static-dynamic','runtime Lightning carrier policy is wrong');
    const errors=uncaughtExceptions(h.events).slice(baseline);assert(!errors.length,'uncaught browser exceptions: '+errors.join(' | '));
    console.log('SOMATA 7.7.9 LIGHTNING STATIC/DYNAMIC UNIFIED: PASS',out);
  }finally{await h.close();}
})().catch(err=>{console.error('SOMATA 7.7.9 LIGHTNING STATIC/DYNAMIC UNIFIED: FAIL',err.stack||err);process.exit(1)});
