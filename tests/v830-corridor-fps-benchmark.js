// Run unchanged against 8.2.0 and 8.3.0 in software Chromium.
// Tests a Corridor + Blue Morph + Glow/Fill scene, not GPU driver performance.
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:250,evalTimeoutMs:20000});
 try{
  const res=await h.evaluate(`(async()=>{
   const keys=['morph','morph-owner','morph-arm','morph-cycle-boundary','minimalMorph','project-morph','sweep','particles','gpu-path-fx','motion','tunnel','fps-bench','v830-bench'];for(const k of keys)try{animationScheduler.remove(k)}catch(_){}
   const layers=[0,1].map(i=>{const l=createLayer('corridor-fps-'+i);l.N=15+i*3;l.K=4+i;l.radius=180+i*20;l.rounding=30;l.strokeWidth=2.5;l.glow=55;l.lineVisible=true;l.visible=true;l.fill=true;l.fillColor=i===0?'#0ebddc88':'#de84bc88';l.strokeColor=i===0?'#aadbee':'#f4b4e1';ensureLayerEffectState(l);return l;});
   state.layers.splice(0,state.layers.length,...layers);state.activeLayerId=layers[0].id;state.showLines=true;state.showLamps=false;state.showWeb=false;state.tunnel.active=true;state.tunnel.paletteLagEnabled=true;state.tunnel.colorShiftEnabled=true;state.tunnel.colorShiftCumulative=false;state.tunnel.minScale=.04;state.tunnel.maxScale=2.1;
   for(const l of layers)invalidateLayerGeometry(l,'v830-corridor-fps');refreshLayerLookup(true);
   runtimeState.morph.active=true;runtimeState.morph.paused=false;runtimeState.morph.exactStartPending=false;runtimeState.morph.mode='circleSlide';runtimeState.morph.progress=.4;runtimeState.morph.geometryT=.4;runtimeState.morph.frameLayers=layers.map(l=>({...l,rotation:l.rotation+23,radius:l.radius*1.07,N:l.N+1}));
   animationScheduler.add('v830-bench',()=>{runtimeState.morph.progress=(runtimeState.morph.progress+.01)%1;runtimeState.morph.geometryT=runtimeState.morph.progress;requestMainCanvasRender();return true;});
   requestMainCanvasRender();await new Promise(r=>setTimeout(r,550));const runs=[];
   for(let k=0;k<3;k++){const a=__spiroAnimationStats(),t=performance.now();await new Promise(r=>setTimeout(r,2300));const b=__spiroAnimationStats();runs.push({fps:(b.paintCount-a.paintCount)/((performance.now()-t)/1000),paints:b.paintCount-a.paintCount,errors:b.paintErrors||0});}
   animationScheduler.remove('v830-bench');runtimeState.morph.active=false;const sorted=runs.map(x=>x.fps).sort((a,b)=>a-b);return{runs,medianFps:sorted[1],inFrame:animationScheduler.stats().inFrame};
  })()`,{timeoutMs:15000,label:'v8.3 Corridor FPS'});
  console.log('CORRIDOR_FPS_JSON '+JSON.stringify(res));
  if(res.inFrame||uncaughtExceptions(h.events).length)throw Error('unhandled frame/exception');
 }finally{await h.close()}
})().then(()=>process.exit(0)).catch(e=>{console.error(e.stack||e);process.exit(1)});
