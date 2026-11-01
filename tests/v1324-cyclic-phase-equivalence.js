'use strict';
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');const assert=require('node:assert/strict');
(async()=>{const h=await createBrowserHarness({disableGpu:true,loadDelayMs:120,evalTimeoutMs:20000});try{
const got=await h.evaluate(`(()=>{
 const mk=(N,K)=>{const x=createLayer('spiral');Object.assign(x,{N,K,spiralStep:K,spiralOrder:1,spiralEnabled:true,spiralClosed:true,spiralStepLimiter:2,spiralStepLimiterEnabled:true,profileMode:'segments',profileNodes:[{x:0,y:0},{x:1,y:0}],customSuborbits:null});return x};
 const test=(sn,sk,dn,dk,type)=>{const a=mk(sn,sk),b=mk(dn,dk);state.layers=[a];state.morph.mode='circleSlide';state.morph.spiralMorphType=type;runtimeState.morph.renderSourceLayers=[a];runtimeState.morph.renderTargetLayers=[b];runtimeState.morph.active=true;
 return [0,.1,.25,.5,.75,.9,1].map(t=>{const x=WebGPUSpiralBezierMorphRenderer.debugCarrierMappedPlan(0,t);return {t,overflow:x?.carrierOverflow,paths:x?.pathCount,steps:x?.carrierFrames?.map(q=>q.step),angles:x?.carrierFrames?.map(q=>q.delta),packed:x?.packed};});};
 const ref=test(20,1,20,2,'phaseCircle'),cycle=test(20,3,20,4,'phaseCircle');
 const shrink=test(20,7,4,2,'phaseCircle'),shrinkN=test(9,8,3,2,'phaseCircle');
 return {ref,cycle,shrink,shrinkN};
})()`,{timeoutMs:20000});
 for(let i=0;i<got.ref.length;i++){
 const a=got.ref[i],b=got.cycle[i];assert.equal(a.paths,b.paths);assert.deepEqual(a.steps,b.steps);assert.deepEqual(a.angles,b.angles);assert.equal(a.packed.length,b.packed.length);
 for(let j=0;j<a.packed.length;j++)assert(Math.abs(a.packed[j]-b.packed[j])<1e-4,`3->4 differs from 1->2 at ${a.t} index ${j}: ${a.packed[j]} ${b.packed[j]}`);
 }
 for(const row of [...got.shrink,...got.shrinkN]){assert(!row.overflow);assert(row.packed?.every(Number.isFinite));for(const step of row.steps||[])assert(step<=Math.max(1,Math.floor((20+(4-20)*row.t)/2))+1e-6,'unclamped K step while shrinking N');}
 assert.deepEqual(uncaughtExceptions(h.events),[]);
 console.log('PASS cyclic 1->2 equivalent 3->4, shrinking N check',JSON.stringify({frames:got.ref.length,shrink:got.shrink.map(x=>({t:x.t,paths:x.paths,step:x.steps?.[0]})),shrinkN:got.shrinkN.map(x=>({t:x.t,paths:x.paths,step:x.steps?.[0]}))}));
}finally{await h.close()}})().catch(e=>{console.error('FAIL phase equivalence',e.stack||e);process.exitCode=1});
