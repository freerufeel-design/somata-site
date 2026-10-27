'use strict';
// Polygon and Spiral must interpolate their spline controls using the same
// frame's geometry progress, not a possibly newer animation clock sample.
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:115,evalTimeoutMs:29000});
 try{
  const reports=await h.evaluate(`(()=>{
   const prev={layers:state.layers,source:runtimeState.morph.renderSourceLayers,
     target:runtimeState.morph.renderTargetLayers,active:runtimeState.morph.active,
     progress:runtimeState.morph.progress,mode:state.morph.profileModeTransition,
     pct:state.morph.profileModeTransitionPercent,transport:state.morph.spiralMorphType};
   const smooth=x=>x*x*(3-2*x),data=[];
   try{
    runtimeState.morph.active=true;runtimeState.morph.progress=.94;
    state.morph.profileModeTransition='phase';state.morph.profileModeTransitionPercent=20;
    const t=.23;
    data.push({kind:'shared-progress',actual:profileModeTransitionProgress(t),expected:smooth(t)});
    for(const spiral of [false,true]){
     const a=createLayer('source-clock'),b=createLayer('target-clock');
     Object.assign(a,{N:6,K:1,radius:200,spiralEnabled:spiral,spiralOrder:2,
       spiralClosed:false,rounding:20,profileMode:'segments',
       profileNodes:[{x:0,y:0},{x:.19,y:.3},{x:.57,y:-.2},{x:1,y:0}]});
     Object.assign(b,a,{id:'target-clock',profileMode:'spline',
       profileNodes:[{x:0,y:0},{x:.16,y:-.2},{x:.4,y:.36},{x:.75,y:-.3},{x:1,y:0}]});
     state.layers=[a];runtimeState.morph.renderSourceLayers=[a];runtimeState.morph.renderTargetLayers=[b];
     if(spiral){
      state.morph.spiralMorphType='phaseCircle';
      const plan=WebGPUSpiralBezierMorphRenderer.debugCarrierMappedPlan(0,t);
      const q=plan?.paths?.[0]?.[0],s=plan?.sourcePaths?.[0]?.[0],d=plan?.targetPaths?.[0]?.[0];
      if(!q||!s||!d){data.push({kind:'spiral',error:'missing current cubics'});continue;}
      let worst=0;for(const axis of ['x','y'])for(const [handle,knot] of [['c1','p0'],['c2','p3']]){
       const expected=(s[handle][axis]-s[knot][axis])+
         ((d[handle][axis]-d[knot][axis])-(s[handle][axis]-s[knot][axis]))*smooth(t);
       const actual=q[handle][axis]-q[knot][axis];worst=Math.max(worst,Math.abs(actual-expected));
      }
      data.push({kind:'spiral',worst,prepared:plan?.preparedContinuousSplineRail});
     }else{
      // The polygon path uses profileModeTransitionProgress via morphSplineBlend.
      data.push({kind:'polygon',actual:morphSplineBlend('segments','spline',t),expected:smooth(t)});
     }
    }
   }finally{
    state.layers=prev.layers;runtimeState.morph.renderSourceLayers=prev.source;
    runtimeState.morph.renderTargetLayers=prev.target;runtimeState.morph.active=prev.active;
    runtimeState.morph.progress=prev.progress;state.morph.profileModeTransition=prev.mode;
    state.morph.profileModeTransitionPercent=prev.pct;state.morph.spiralMorphType=prev.transport;
   }
   return data;
  })()`,{label:'shared phase time for Polygon and Spiral spline controls'});
  assert.equal(reports.length,3);
  for(const r of reports){
   assert(!r.error,'no prepared geometry: '+JSON.stringify(reports));
   if(r.kind==='spiral')assert(r.prepared&&r.worst<1e-4,'Spiral GPU handles use a different clock: '+JSON.stringify(r));
   else assert(Math.abs(r.actual-r.expected)<1e-8,'Polygon controls use a different clock: '+JSON.stringify(r));
  }
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS v10431: Polygon/Spiral spline control points follow frame geometry progress despite stale animation clock');
 }finally{await h.close();}
})().catch(err=>{console.error('FAIL v10431',err.stack||err);process.exitCode=1;});
