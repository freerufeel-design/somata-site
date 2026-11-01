'use strict';
// Real scheduler/frame paint benchmark with three Spiral layers and fast-changing
// Morph frame state, Chromium software backend. This does not certify NVIDIA FPS.
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{const h=await createBrowserHarness({disableGpu:true,loadDelayMs:125,evalTimeoutMs:20000});try{
 const r=await h.evaluate(`(async()=>{
  for(const k of ['morph','morph-owner','morph-arm','morph-cycle-boundary','minimalMorph','project-morph','sweep','particles','gpu-path-fx','motion','tunnel','v1268-real'])try{animationScheduler.remove(k)}catch(_){}
  // The test harness removes CSS, so fix the viewport explicitly.
  const host=document.getElementById('mainContainer');host.style.cssText='position:relative;display:block;width:900px;height:600px;overflow:hidden;flex:none';
  document.body.style.cssText='margin:0;height:800px;overflow:hidden';
  mainCanvas.style.cssText='width:900px;height:600px;display:block';
  canvasViewport.w=900;canvasViewport.h=600;mainCanvas.width=900;mainCanvas.height=600;
  const nodes=[{x:0,y:0},{x:.17,y:.3},{x:.4,y:-.23},{x:.67,y:.32},{x:1,y:0}];
  const layers=[0,1,2].map(i=>{const l=createLayer('spiral-real-'+i);Object.assign(l,{N:17+i,K:5+i,radius:165+i*22,rotation:0,rounding:160,profileMode:'spline',profileNodes:nodes,spiralEnabled:true,spiralOrder:3,spiralStepLinked:false,spiralStep:2.75,spiralClosed:true,spiralRoundSeams:true,spiralTangential:true,visible:true,lineVisible:true,strokeWidth:2.5,glow:12,fill:false});ensureLayerEffectState(l);return l;});
  state.layers.splice(0,state.layers.length,...layers);state.activeLayerId=layers[0].id;state.showLines=true;state.showLamps=false;state.showWeb=false;state.tunnel.active=false;
  runtimeState.morph.active=true;runtimeState.morph.paused=false;runtimeState.morph.exactStartPending=false;runtimeState.morph.mode='circleSlide';runtimeState.morph.progress=.1;runtimeState.morph.geometryT=.1;
  runtimeState.morph.renderSourceLayers=layers.map(l=>({...l}));runtimeState.morph.renderTargetLayers=layers.map((l,i)=>({...l,N:l.N+1,K:l.K+1,rotation:32+i*7,profileNodes:nodes.map((p,j)=>({...p,y:p.y+Math.sin(j+i)*.1}))}));
  runtimeState.morph.frameLayers=layers.map(l=>({...l}));
  for(const l of layers)invalidateLayerGeometry(l,'v1268-real');refreshLayerLookup(true);
  animationScheduler.add('v1268-real',()=>{const t=(Number(runtimeState.morph.progress)||0)+.008;runtimeState.morph.progress=t%1;runtimeState.morph.geometryT=runtimeState.morph.progress;runtimeState.morph.frameLayers=layers.map((l,i)=>({...l,rotation:l.rotation+runtimeState.morph.progress*(32+i*7),N:Math.round(l.N+runtimeState.morph.progress),radius:l.radius*(1+.05*runtimeState.morph.progress)}));requestMainCanvasRender();return true;});
  requestMainCanvasRender();await new Promise(r=>setTimeout(r,450));const passes=[];
  for(let i=0;i<2;i++){const a=__spiroAnimationStats(),t=performance.now();await new Promise(r=>setTimeout(r,1600));const b=__spiroAnimationStats();passes.push({fps:(b.paintCount-a.paintCount)/((performance.now()-t)/1000),frames:b.paintCount-a.paintCount,paintErrors:b.paintErrors||0});}
  animationScheduler.remove('v1268-real');runtimeState.morph.active=false;
  return {passes,skippedGpu:!(navigator&&navigator.gpu),canvasSize:{w:mainCanvas.width,h:mainCanvas.height},inFrame:animationScheduler.stats().inFrame};
 })()`,{timeoutMs:16000,label:'three Spiral software real scheduler benchmark'});
 console.log('3 SPIRAL REAL SOFTWARE FRAME BENCH',JSON.stringify(r));
 if(r.inFrame||uncaughtExceptions(h.events).length)throw new Error('frame or uncaught exception '+JSON.stringify(uncaughtExceptions(h.events)));
}finally{await h.close()}})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
