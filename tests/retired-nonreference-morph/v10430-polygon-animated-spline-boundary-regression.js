'use strict';
// Reproduce the visible Polygon spline discontinuity at the real Blue Morph
// cycle boundary. Prepared Morph spline points must not become a different
// authored-node spline on the very next repaint.
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:140,evalTimeoutMs:27000});
 try{
  const result=await h.evaluate(`(async()=>{
   const layer=createLayer('v10430-polygon-spline');
   Object.assign(layer,{N:7,K:2,visible:true,lineVisible:true,radius:220,rounding:55,
     spiralEnabled:false,closedLoop:true,profileMode:'spline',splineRenderMode:'smooth',
     profileNodes:[{x:0,y:0},{x:.18,y:.48},{x:.5,y:-.2},{x:.75,y:.3},{x:1,y:0}]});
   state.layers=[layer];state.activeLayerId=layer.id;state.morph.mode='circleSlide';
   state.morph.intervalSec=2;
   Object.assign(state.morph.options,{byShape:false,byVertices:false,bySteps:false,bySpiralOrder:false,bySpiralLayers:false});
   if(runtimeState.morph.active)document.getElementById('btnMorph').click();
   const oldAdd=animationScheduler.add,oldAfter=animationScheduler.afterNextPaint;
   let tick=null,boundary=null;
   animationScheduler.add=function(name,cb){if(name==='morph')tick=cb;return oldAdd.call(this,name,cb);};
   animationScheduler.afterNextPaint=function(name,cb){if(name==='morph-cycle-boundary'){boundary=cb;return;}return oldAfter.call(this,name,cb);};
   try{
    document.getElementById('btnMorph').click();
    await new Promise(r=>setTimeout(r,130));
    animationScheduler.remove('morph');
    const rt=runtimeState.morph;
    if(!rt.active||!tick)throw Error('Blue Morph did not start');
    const sampled=rt.renderTargetLayers[0];
    const target=(buildOrbitPolylines(sampled)||[])[0]?.points||[];
    const trueTarget={...sampled,profileMode:rt.targetProfiles?.[0]?.mode,
      profileNodes:(rt.targetProfiles?.[0]?.rawNodes||[]).map(p=>({...p}))};
    const exactTarget=(buildOrbitPolylines(trueTarget)||[])[0]?.points||[];
    const before=(buildOrbitPolylines(layer)||[])[0]?.points||[];
    const rawCount=layer.profileNodes.length,renderCount=sampled.profileNodes.length;
    const now=performance.now(),duration=Math.max(100,getTapMorphIntervalSec(state.morph.intervalSec,'full')*1000);
    rt.gpuPhasePreparing=false;rt.gpuPhaseWarming=false;rt.cycleStart=now-duration-10;
    tick(now);
    if(!boundary)throw Error('No Morph boundary repaint');
    boundary();
    const after=(buildOrbitPolylines(layer)||[])[0]?.points||[];
    const difference=(a,b)=>{
      if(a.length!==b.length)return Infinity;
      let delta=0;for(let i=0;i<a.length;i++)delta=Math.max(delta,Math.hypot(a[i].x-b[i].x,a[i].y-b[i].y));return delta;
    };
    const r={rawCount,renderCount,beforeLength:before.length,targetLength:target.length,
      exactTargetLength:exactTarget.length,afterLength:after.length,
      delta:difference(exactTarget,after),authoredCount:layer.profileNodes.length,
      handoffCount:rt.sourceProfiles?.[0]?.rawNodes?.length||0,
      handoffSampled:rt.sourceProfiles?.[0]?.alreadySampled===true,
      bridgeCount:rt.splineCommitBridge?.get(layer)?.sampled?.length||0};
    document.getElementById('btnMorph').click();
    r.bridgeCleared=!rt.splineCommitBridge?.get(layer);
    return r;
   }finally{animationScheduler.add=oldAdd;animationScheduler.afterNextPaint=oldAfter;}
  })()`,{label:'real Polygon spline Morph boundary'});
  assert(result.renderCount>result.rawCount,'scenario needs resampled nonlinear profile: '+JSON.stringify(result));
  assert(result.beforeLength!==result.targetLength,'scenario must expose differing spline representations: '+JSON.stringify(result));
  assert(result.exactTargetLength>0&&result.afterLength===result.exactTargetLength&&result.delta<1e-6,
   'Polygon did not commit the exact authored spline after the Morph cycle: '+JSON.stringify(result));
  assert(result.bridgeCount===0&&result.handoffCount===result.rawCount&&
      !result.handoffSampled&&result.rawCount===result.authoredCount&&result.bridgeCleared,
   'Exact Polygon must hand off raw spline knots without a sampled-geometry overlay: '+JSON.stringify(result));
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS v10430: Polygon spline commits canonical authored endpoint with no resampled bridge and raw next-cycle handoff');
 }finally{await h.close();}
})().catch(err=>{console.error('FAIL v10430',err.stack||err);process.exitCode=1;});
