'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:100,evalTimeoutMs:30000});
 try{
  const result=await h.evaluate(`(async()=>{
   const oldLayers=state.layers,oldActive=state.activeLayerId,oldMorph={...state.morph,options:{...state.morph.options}};
   const originalAdd=animationScheduler.add,originalAfter=animationScheduler.afterNextPaint;
   let morphFn=null,boundaryFn=null;
   animationScheduler.add=function(name,fn){if(name==='morph')morphFn=fn;return originalAdd.call(this,name,fn);};
   animationScheduler.afterNextPaint=function(name,fn){if(name==='morph-cycle-boundary'){boundaryFn=fn;return;}return originalAfter.call(this,name,fn);};
   try{
    const layer=createLayer('1317-real-crash-repro');Object.assign(layer,{N:15,K:4,spiralEnabled:true,spiralOrder:3,spiralStepLinked:false,spiralStep:2.4,rounding:140,profileMode:'spline',profileNodes:[{x:0,y:0},{x:.2,y:.35},{x:.5,y:-.27},{x:.76,y:.38},{x:1,y:0}]});
    state.layers=[layer];state.activeLayerId=layer.id;state.morph.mode='circleSlide';state.morph.intervalSec=4;
    Object.assign(state.morph.options,{byShape:true,byVertices:true,bySteps:true,bySpiralLayers:true});
    document.getElementById('btnMorph').click();await new Promise(r=>setTimeout(r,80));animationScheduler.remove('morph');
    if(typeof morphFn!=='function')throw Error('morph scheduler was not registered');
    const rt=runtimeState.morph;const duration=Math.max(100,getTapMorphIntervalSec(state.morph.intervalSec,'full')*1000);
    // Recreate the exact missing-profile branch in the user's stack trace:
    // animateMorph -> sampleProfileForMorph(nodes, count=null).
    rt.sourceProfiles[0].nodes=null;
    rt.gpuPhasePreparing=false;rt.gpuPhaseWarming=false;
    let tickError='';try{const now=performance.now();rt.cycleStart=now-duration*.4;morphFn(now);}catch(e){tickError=String(e?.stack||e);}
    const frameCount=rt.frameLayers?.length||0;
    // Once a phase is interrupted, one target pair can be incomplete. Its
    // boundary handoff must preserve the existing layer and keep scheduler alive.
    rt.gpuPhasePreparing=false;rt.gpuPhaseWarming=false;
    let boundaryError='';
    try{const now=performance.now();rt.cycleStart=now-duration*1.002;morphFn(now);if(typeof boundaryFn==='function'){
      rt.targetProfiles[0]=undefined;rt.targetVisuals[0]=undefined;boundaryFn();
    }}catch(e){boundaryError=String(e?.stack||e);}
    return{tickError,boundaryError,frameCount,validLayer:!!state.layers[0],boundaryScheduled:typeof boundaryFn==='function'};
   }finally{
    if(runtimeState.morph.active)document.getElementById('btnMorph').click();
    animationScheduler.add=originalAdd;animationScheduler.afterNextPaint=originalAfter;
    state.layers=oldLayers;state.activeLayerId=oldActive;Object.assign(state.morph,oldMorph);state.morph.options={...oldMorph.options};
   }
  })()`,{timeoutMs:29000,label:'regression for user Morph exception stack'});
  assert.equal(result.tickError,'',JSON.stringify(result));
  assert.equal(result.boundaryError,'',JSON.stringify(result));
  assert(result.frameCount>=1,JSON.stringify(result));
  assert(result.validLayer,JSON.stringify(result));
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS 13.0.17 no missing detail-scale ReferenceError and safe phase boundary',result);
 }finally{await h.close()}
})().catch(e=>{console.error('FAIL',e.stack||e);process.exitCode=1});
