// Real frame scheduler test: Spiral interwinding Fill + Corridor + Glow, software Chromium.
// Compare to the unchanged 8.3.0 bundle on the same environment; no GPU certification.
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:180,evalTimeoutMs:28000});
 try{
  const res=await h.evaluate(`(async()=>{
   for(const k of ['morph','morph-owner','morph-arm','morph-cycle-boundary','minimalMorph','project-morph','sweep','particles','gpu-path-fx','motion','tunnel','v840-fps'])try{animationScheduler.remove(k)}catch(_){}
   const l=createLayer('v840-real');
   Object.assign(l,{N:12,K:5,radius:185,rounding:25,visible:true,lineVisible:true,strokeWidth:2,glow:20,fill:true,spiralEnabled:true,spiralClosed:true,spiralFillEnabled:true,spiralFillType:'interwinding',spiralOrder:3,spiralStepLinked:false,spiralStep:2.4});
   ensureLayerEffectState(l);state.layers.splice(0,state.layers.length,l);state.activeLayerId=l.id;state.showLines=true;state.showWeb=false;state.showLamps=false;
   state.tunnel.active=true;state.tunnel.copies=24;state.tunnel.minScale=.08;state.tunnel.maxScale=2.2;
   runtimeState.morph.active=false;runtimeState.minimalMorph.active=false;runtimeState.projectMorph.active=false;
   invalidateLayerGeometry(l,'v840-fps');refreshLayerLookup(true);
   const prior=FillMeshPreparer.prepareInterwindingCorridor;
   let calls=0,prepMs=0;
   FillMeshPreparer.prepareInterwindingCorridor=function(...args){const a=performance.now(),v=prior(...args);prepMs+=performance.now()-a;calls++;return v;};
   try{
    animationScheduler.add('v840-fps',()=>{state.tunnel.travelPhase=(Number(state.tunnel.travelPhase)||0)+.009;requestMainCanvasRender();return true;});
    requestMainCanvasRender();await new Promise(r=>setTimeout(r,600));
    const rounds=[];for(let t=0;t<2;t++){const before=__spiroAnimationStats(),start=performance.now();await new Promise(r=>setTimeout(r,2000));const end=performance.now(),after=__spiroAnimationStats();rounds.push({fps:(after.paintCount-before.paintCount)/((end-start)/1000),frames:after.paintCount-before.paintCount});}
    return{rounds,calls,prepMs,avgPrepMs:calls?prepMs/calls:0,inFrame:animationScheduler.stats().inFrame,errors:__spiroAnimationStats().paintErrors||0};
   }finally{animationScheduler.remove('v840-fps');FillMeshPreparer.prepareInterwindingCorridor=prior;state.tunnel.active=false;}
  })()`,{label:'8.4 real Spiral Corridor FPS',timeoutMs:26000});
  if(!res.calls||res.inFrame||uncaughtExceptions(h.events).length)throw Error('bench invalid '+JSON.stringify(res)+' '+uncaughtExceptions(h.events).join(' | '));
  console.log('SPIRAL_CORRIDOR_FPS_JSON '+JSON.stringify(res));
 }finally{await h.close()}
})().catch(err=>{console.error('FPS BENCH ERROR',err.stack||err);process.exitCode=1});
