'use strict';
// The rendered endpoint of an animated spline Spiral Morph must survive the
// phase-boundary repaint, without overwriting the editable authored nodes.
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:140,evalTimeoutMs:24000});
 try{
  const report=await h.evaluate(`(async()=>{
   const layer=createLayer('v10425');
   Object.assign(layer,{N:7,K:2,visible:true,lineVisible:true,radius:220,rounding:55,
     spiralEnabled:true,spiralOrder:3,spiralClosed:true,spiralTangential:true,
     spiralRoundSeams:true,profileMode:'spline',
     profileNodes:[{x:0,y:0},{x:.18,y:.48},{x:.5,y:-.2},{x:.75,y:.3},{x:1,y:0}]});
   state.layers=[layer];state.activeLayerId=layer.id;state.morph.mode='circleSlide';
   state.morph.spiralMorphType='phaseCircle';state.morph.intervalSec=2;
   Object.assign(state.morph.options,{byShape:false,byVertices:false,bySteps:false,
     bySpiralOrder:true,bySpiralLayers:true});
   state.morph.spiralLayersMin=1;state.morph.spiralLayersMax=1;
   state.morph.spiralOrderMin=3;state.morph.spiralOrderMax=3;
   if(runtimeState.morph.active)document.getElementById('btnMorph').click();
   const oldAdd=animationScheduler.add,oldAfter=animationScheduler.afterNextPaint;
   let morphTick=null,boundary=null;
   animationScheduler.add=function(name,cb){if(name==='morph')morphTick=cb;return oldAdd.call(this,name,cb);};
   animationScheduler.afterNextPaint=function(name,cb){if(name==='morph-cycle-boundary'){boundary=cb;return;}return oldAfter.call(this,name,cb);};
   try{
     document.getElementById('btnMorph').click();
     await new Promise(r=>setTimeout(r,130));
     animationScheduler.remove('morph');
     const rt=runtimeState.morph;
     if(!rt.active||typeof morphTick!=='function')throw Error('Blue animation did not start: '+JSON.stringify({active:rt.active,tick:typeof morphTick,paused:rt.paused,mode:state.morph.mode,button:document.getElementById('btnMorph').title,last:rt.gpuPhasePreparing,hasSource:rt.renderSourceLayers?.length,hasTarget:rt.renderTargetLayers?.length}));
     const sampled=rt.renderTargetLayers[0];
     if(!sampled||sampled.profileMode!=='spline')throw Error('missing nonlinear render target');
     const targetPath=(buildOrbitPolylines(sampled)||[])[0]?._bezierSegments||[];
     const rawCount=layer.profileNodes.length,renderCount=sampled.profileNodes.length;
     const oldStaticPath=(buildOrbitPolylines(layer)||[])[0]?._bezierSegments||[];
     const now=performance.now(),duration=Math.max(100,getTapMorphIntervalSec(state.morph.intervalSec,'full')*1000);
     rt.gpuPhasePreparing=false;rt.gpuPhaseWarming=false;rt.cycleStart=now-duration-10;
     morphTick(now);
     if(typeof boundary!=='function')throw Error('boundary repaint was not scheduled');
     boundary();
     const authoringCount=layer.profileNodes.length;
     const painted=(buildOrbitPolylines(layer)||[])[0]?._bezierSegments||[];
     const cmp=(a,b)=>{if(a.length!==b.length)return Infinity;let d=0;for(let i=0;i<a.length;i++)for(const k of ['p0','c1','c2','p3'])d=Math.max(d,Math.hypot(a[i][k].x-b[i][k].x,a[i][k].y-b[i][k].y));return d;};
     const diff=cmp(targetPath,painted);
     const bridgeActive=rt.splineCommitBridge?.get(layer)?.sampled?.length||0;
     document.getElementById('btnMorph').click();
     const stopped=!rt.active;
     const bridgeGone=!rt.splineCommitBridge?.get(layer)&&!rt.splineCommitBridge?.get(state.layers[0]);
     return {bridgeGone,rawCount,renderCount,authoringCount,targetCubicCount:targetPath.length,
       oldStaticCount:oldStaticPath.length,paintedCount:painted.length,diff,bridgeActive,stopped};
   }finally{animationScheduler.add=oldAdd;animationScheduler.afterNextPaint=oldAfter;}
  })()`,{label:'Blue Morph animated spline endpoint handoff'});
  assert.equal(report.rawCount,report.authoringCount,'Morph handoff changed authored profile nodes: '+JSON.stringify(report));
  assert(report.renderCount>report.rawCount,'test must exercise pre-sampled nonlinear profile: '+JSON.stringify(report));
  assert(report.bridgeActive>0&&report.targetCubicCount>0,'target spline boundary was not prepared: '+JSON.stringify(report));
  assert(report.diff<1e-6,'boundary changed displayed Bézier profile: '+JSON.stringify(report));
  assert(report.stopped,'Morph did not stop');
  assert(report.bridgeGone,'render-only bridge remained registered after Morph stop');
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS v10425 Blue animated spline final rail survives phase boundary; authored spline nodes unchanged');
 }finally{await h.close();}
})().catch(e=>{console.error('FAIL v10425',e.stack||e);process.exitCode=1});
