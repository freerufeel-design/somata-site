'use strict';const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');const assert=require('node:assert/strict');
(async()=>{const h=await createBrowserHarness({disableGpu:true,loadDelayMs:120,evalTimeoutMs:24000});try{
const got=await h.evaluate(`(()=>{
 const mk=(name,N,K)=>{const l=createLayer(name);Object.assign(l,{N,K,spiralStep:K,spiralOrder:1,spiralEnabled:true,spiralClosed:true,spiralStepLimiterEnabled:true,spiralStepLimiter:2,profileMode:'segments',profileNodes:[{x:0,y:0},{x:1,y:0}],customSuborbits:null,opacity:100});return l;};
 const animations=[];for(const type of ['torn','continuous','phase','minimalTurn','phaseCircle']){
  for(const axis of ['N','K']){
   const a=mk('animate-'+type+'-'+axis,16,1);a.testMorph={enabled:true,spiralType:type,mode:'circleSlide',duration:1};state.layers=[a];state.activeLayerId=a.id;
   SomataTestMorph.updateTask();const v={...a},frame={layer:v,sourceLayer:a,layerIndex:0};const now=performance.now();
   a[axis]+=axis==='N'?2:1;
   SomataTestMorph.applyFrame(frame,now);SomataTestMorph.applyFrame(frame,now+250);
   const st=SomataTestMorph.status();animations.push({type,axis,opacity:v.opacity,layerN:v.N,layerK:v.K,fade:st.last?.axisNeedsFade,angular:st.last?.angularSpiralEdit,status:st.last?.topologyEndpointFade});
   SomataTestMorph.applyFrame(frame,now+1200);
  }
 }
 const carrier=[];for(const type of ['phase','minimalTurn','phaseCircle']){
  for(const [sn,sk,dn,dk] of [[20,3,20,4],[18,3,20,4],[20,1,20,2]]){
   const src=mk('src',sn,sk),dst=mk('dst',dn,dk);
   const pair={sourceLayer:src,targetLayer:dst,spiralType:type,mode:'circleSlide'};
   const probes=[];for(const t of [0,.25,.5,.75,1]){
    const x=WebGPUSpiralBezierMorphRenderer.debugCarrierMappedPlan(0,t,pair);
    probes.push({t,paths:x?.pathCount,overflow:x?.carrierOverflow,alpha: x?.branchPresence?.reduce((a,b)=>a+b,0),stepHead:x?.carrierFrames?.[0]?.step,stepTail:x?.carrierFrames?.at(-1)?.step,geometryFinite:x?.packed?.every(Number.isFinite)});
   }carrier.push({type,sn,sk,dn,dk,probes});
  }
 }
 return {animations,carrier};
})()`,{timeoutMs:22000,label:'13.0.23 Geometry Animation fixed axes and hybrid carrier fade'});
const shouldFade=(type,axis)=>type==='continuous'||type==='phase'&&axis==='N'||type==='minimalTurn'&&axis==='K';
for(const x of got.animations){assert.equal(x.fade,shouldFade(x.type,x.axis),`fade requirement ${x.type} ${x.axis}`);assert.equal(x.angular,!shouldFade(x.type,x.axis),`angular animation ${x.type} ${x.axis}`);if(shouldFade(x.type,x.axis))assert(x.opacity<95,`no visible fading in ${x.type} ${x.axis}: ${x.opacity}`);}
for(const x of got.carrier)for(const q of x.probes){assert.equal(q.overflow,false,`${x.type} K ${x.sk}->${x.dk} overflow ${q.t}`);assert(q.geometryFinite!==false,`${x.type} invalid coordinates`);assert(q.paths>=Math.max(x.sn,x.dn),`${x.type} missing rays`);}
assert.deepEqual(uncaughtExceptions(h.events),[]);console.log('PASS 13.0.23 animation fixed-axis modes and phase carrier',JSON.stringify({animations:got.animations,carrier:got.carrier.map(x=>({...x,probes:x.probes.map(p=>({t:p.t,paths:p.paths,overflow:p.overflow,alpha:p.alpha,stepHead:p.stepHead,stepTail:p.stepTail}))}))}));
}finally{await h.close()}})().catch(e=>{console.error('FAIL 13.0.23 animation',e.stack||e);process.exitCode=1;});
