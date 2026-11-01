'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
const h=await createBrowserHarness({disableGpu:true,loadDelayMs:110,evalTimeoutMs:16000});
try{
 const d=await h.evaluate(`(()=>{
 const results=[];
 const make=(N,K)=>{const l=createLayer('spiral');Object.assign(l,{N,K,spiralStep:K,spiralOrder:1,spiralEnabled:true,spiralClosed:true,opacity:100,spiralStepLimiter:2,spiralStepLimiterEnabled:true,profileMode:'segments',profileNodes:[{x:0,y:0},{x:1,y:0}],customSuborbits:null,testMorph:{enabled:true,mode:'circleSlide',duration:1}});return l;};
 for(const type of ['continuous','phase','minimalTurn','phaseCircle','torn'])for(const axis of ['N','K']){
   const l=make(20,5);state.layers=[l];state.activeLayerId=l.id;state.morph.spiralMorphType=type;SomataTestMorph.updateTask();
   const visible={...l},ctx={layer:visible,sourceLayer:l,layerIndex:0},now=performance.now();
   l[axis]+=axis==='N'?2:1;
   SomataTestMorph.applyFrame(ctx,now);SomataTestMorph.applyFrame(ctx,now+250);
   const st=SomataTestMorph.status();
   results.push({type,axis,localMode:SomataTestMorph.config(l).spiralType,alpha:visible.opacity,fade:st.last?.axisNeedsFade,interpolates:st.last?.angularSpiralEdit,K:visible.K,N:visible.N});
   SomataTestMorph.applyFrame(ctx,now+1100);
 }
 const phase=[];
 for(let mode of ['phaseCircle','torn']){
   const s=make(20,10),e=make(8,4);state.layers=[s];state.morph.spiralMorphType=mode;state.morph.mode='circleSlide';
   runtimeState.morph.renderSourceLayers=[s];runtimeState.morph.renderTargetLayers=[e];runtimeState.morph.active=true;
   for(let t of [0,.1,.25,.5,.75,.9,1]){
     const p=WebGPUSpiralBezierMorphRenderer.debugCarrierMappedPlan(0,t);
     phase.push({mode,t,paths:p.pathCount,overflow:p.carrierOverflow,steps:p.carrierFrames?.map(x=>x.step).slice(0,3),clone:p.branchPresence?.length,present:p.branchPresence?.reduce((a,b)=>a+b,0),finite:p.packed?.every(Number.isFinite)??true});
   }
 }
 return{results,phase};
 })()`,{timeoutMs:16000});
 for(const q of d.results){const faded=q.type==='continuous'||q.type==='phase'&&q.axis==='N'||q.type==='minimalTurn'&&q.axis==='K';
  assert.equal(q.localMode,q.type,`local/global selection mismatch: ${JSON.stringify(q)}`);
  assert.equal(q.fade,faded,`wrong fade flag ${JSON.stringify(q)}`);
  if(faded){assert(q.alpha<100&&q.alpha>0,`invisible fade alpha: ${JSON.stringify(q)}`);assert.equal(q.interpolates,false);}
 }
 for(const q of d.phase){assert(!q.overflow&&q.finite,`capped N decrease overflow: ${JSON.stringify(q)}`);assert(q.paths<=20,`duplicated too many branches ${JSON.stringify(q)}`);for(const step of q.steps||[])assert(Math.abs(step-2)<.00001,`K=10->4 with limit2 must remain effective K2: ${JSON.stringify(q)}`);}
 assert.deepEqual(uncaughtExceptions(h.events),[]);
 console.log('PASS 13.0.25 Animation fade/capped max K with decreasing N',JSON.stringify(d));
}finally{await h.close()}
})().catch(e=>{console.error('FAIL',e.stack||e);process.exitCode=1});
