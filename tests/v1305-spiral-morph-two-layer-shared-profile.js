'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
const h=await createBrowserHarness({disableGpu:true,loadDelayMs:150,evalTimeoutMs:36000});
try{
 const r=await h.evaluate(`(()=>{
  const mk=(id,r,rot,nodes)=>{const l=createLayer(id);Object.assign(l,{visible:true,spiralEnabled:true,profileMode:'spline',N:18,K:5,radius:r,rotation:rot,rounding:145,spiralOrder:3,spiralStep:2.75,spiralStepLinked:false,spiralTangential:true,spiralClosed:true,spiralRoundSeams:true,profileNodes:nodes.map(p=>({...p}))});return l;};
  const nodes=[{x:0,y:0},{x:.14,y:.42},{x:.37,y:-.31},{x:.68,y:.36},{x:1,y:0}];
  runtimeState.morph.renderSourceLayers=[mk('s0',205,4,nodes),mk('s1',240,39,nodes)];
  runtimeState.morph.renderTargetLayers=[mk('d0',215,54,nodes),mk('d1',255,77,nodes)];
  state.morph.mode='circleSlide';state.morph.spiralMorphType='phaseCircle';
  const start=__spiroSpiralCarrierProfilePrepStatus();
  const a=__somataSpiralMorphCpuPlan(0),b=__somataSpiralMorphCpuPlan(1),mid=__spiroSpiralCarrierProfilePrepStatus();
  const p=__somataSpiralCarrierMorphPlan(0,.36),q=__somataSpiralCarrierMorphPlan(1,.36);
  const end=__spiroSpiralCarrierProfilePrepStatus();
  return{pairA:a?.sharedProfilePair,pairB:b?.sharedProfilePair,pathA:p?.pathCount,pathB:q?.pathCount,
    sharedDelta:end.sharedHits-start.sharedHits,preparesDelta:end.prepares-start.prepares,
    initialShared:mid.sharedHits-start.sharedHits,initialPrepares:mid.prepares-start.prepares,
    finite:p?.packed?.every(Number.isFinite)&&q?.packed?.every(Number.isFinite)};
 })()`,{timeoutMs:36000});
 assert(r.pairA&&r.pairB&&r.pathA>0&&r.pathB>0&&r.finite,JSON.stringify(r));
 // The regular phase-locked Spiral uses immutable endpoint rails and does
 // not run the live profile preparer at all. Cache reuse is covered by
 // v1305-spiral-cross-layer-profile-reuse.js (live/preview profile path).
 assert.equal(r.preparesDelta,0,JSON.stringify(r));
 assert.deepEqual(uncaughtExceptions(h.events),[]);
 console.log('PASS 2 different-radius Spiral Morph layers preserve phase-locked geometry, shared-profile eligibility',r);
}finally{await h.close();}
})().catch(e=>{console.error('FAIL',e.stack||e);process.exitCode=1});
