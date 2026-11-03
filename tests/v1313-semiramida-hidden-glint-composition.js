'use strict';
const assert=require('node:assert/strict');
const fs=require('fs');
const path=require('path');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const data=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/semiramida-hidden-glint.json'),'utf8'));
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:120,evalTimeoutMs:50000});
 try{
  const result=await h.evaluate(`(async()=>{
   const p=${JSON.stringify(data)};
   state.layers.splice(0,state.layers.length,...p.layers);state.activeLayerId=p.settings.activeLayerId;
   state.audioReactive.active=false;state.tunnel.active=false;
   const layerData=[];
   state.showLines=false;
   state.layers.forEach(ensureLayerEffectState);
   for(const layer of state.layers){layer.lineVisible=false;const sweep=getLayerSweepConfig(layer);if(!sweep.glintEnabled)throw Error('Fixture glint disabled');}
   const f=renderRuntime.frame;f.now=performance.now();f.renderLayerCount=state.layers.length;f.id=12345;
   const originals={stage:SomataRenderPassRegistry.runStage,present:materializeDeferredLayerScene,policy:SomataLayerSceneService.markMainCanvasContent};
   const calls=[];
   try{
    SomataRenderPassRegistry.runStage=(stage,ctx)=>{if(stage===SomataRenderPassRegistry.STAGES.POST_BASE){ctx.frame.gpuLayerSceneDeferred=true;}return true;};
    materializeDeferredLayerScene=(ctx)=>{calls.push(ctx.layer?.id);ctx.frame.gpuLayerSceneDeferred=false;return true;};
    SomataLayerSceneService.markMainCanvasContent=(ctx)=>{ctx.frame.gpuMainCanvasHasContent=true;return true;};
    for(let i=0;i<state.layers.length;i++){
      const ctx=prepareMainLayerFrame(f,i);
      const swept=ctx.effectsPlan.sweep;
      layerData.push({id:ctx.layer.id,line:ctx.lineDisplayEnabled,glint:swept.enabled&&swept.instances.some(e=>e.enabled&&e.cfg.effectType==='glint'),paths:swept.instances[0]?.paths?.length,needsIsolated:somataNeedsIsolatedHiddenGlintPresentation(ctx)});
      renderPreparedMainLayer(ctx);
    }
    const hiddenCalls=[...calls];
    // A single layer, or a mixed frame containing a strict GPU-only Spiral,
    // must not enter the Canvas2D isolation path.
    const probe=prepareMainLayerFrame(f,0);
    f.renderLayerCount=1;
    const singlePolicy=somataNeedsIsolatedHiddenGlintPresentation(probe);
    f.renderLayerCount=3;f.strictSpiralEntryIntent=true;
    const strictFramePolicy=somataNeedsIsolatedHiddenGlintPresentation(probe);
    f.strictSpiralEntryIntent=false;
    state.layers.forEach(l=>l.lineVisible=true);state.showLines=true;calls.length=0;
    for(let i=0;i<state.layers.length;i++){
       const ctx=prepareMainLayerFrame(f,i);renderPreparedMainLayer(ctx);
    }
    return {layerData,hiddenCalls,visibleCalls:[...calls],singlePolicy,strictFramePolicy,status:window.__somataHiddenGlintComposeStatus()};
   }finally{SomataRenderPassRegistry.runStage=originals.stage;materializeDeferredLayerScene=originals.present;SomataLayerSceneService.markMainCanvasContent=originals.policy;}
  })()`,{timeoutMs:50000});
  assert.equal(result.layerData.length,3);
  for(const l of result.layerData){assert.equal(l.line,false);assert.equal(l.glint,true);assert(l.paths>0,'No Glint contour on '+l.id);assert.equal(l.needsIsolated,true);}
  assert.deepEqual(result.hiddenCalls,result.layerData.map(l=>l.id),'Must composite all three effect-only layers in order');
  // The ordinary renderer may independently materialize an effect scene in the
  // mocked-GPU harness. It must not use the new hidden-glint-only path.
  assert.equal(result.singlePolicy,false,'A single Glint layer needs no special route');
  assert.equal(result.strictFramePolicy,false,'Strict Spiral GPU-only frame must not enter Canvas2D');
  assert.equal(result.status.presented,3);
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS Semiramida: three authored Glints preserved with hidden Base; isolated compositing for each; normal visible-line path unchanged');
 }finally{await h.close();}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
