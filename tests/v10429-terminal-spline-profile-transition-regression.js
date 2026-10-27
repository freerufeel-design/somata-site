'use strict';
// Profile-mode timing must follow the actual UI (no implicit terminal 18%).
// Check both directions and exact Bézier handles at the last animated frame.
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:120,evalTimeoutMs:30000});
 try{
  const r=await h.evaluate(`(()=>{
   const save={layers:state.layers,src:runtimeState.morph.renderSourceLayers,dst:runtimeState.morph.renderTargetLayers,
     morphMode:state.morph.mode,transport:state.morph.spiralMorphType,mode:state.morph.profileModeTransition,
     percent:state.morph.profileModeTransitionPercent,active:runtimeState.morph.active,progress:runtimeState.morph.progress};
   const output=[];
   const smooth=u=>u*u*(3-2*u),clamp=u=>Math.max(0,Math.min(1,u));
   const expected=(mode,percent,t)=>{
     let u=t,span=percent/100;
     if(mode==='start')u=span===0?1:clamp(t/span);
     if(mode==='end')u=span===0?(t===1?1:0):clamp((t-(1-span))/span);
     return smooth(u);
   };
   const dif=(a,b)=>Math.abs(a-b);
   try{
    runtimeState.morph.active=true;state.morph.mode='circleSlide';state.morph.spiralMorphType='phaseCircle';
    for(const reverse of [false,true]){
     const a=createLayer('spline-time-source'),b=createLayer('spline-time-target');
     Object.assign(a,{N:4,K:1,spiralEnabled:true,spiralOrder:2,spiralClosed:false,
       spiralTangential:false,radius:200,rounding:25,profileMode:reverse?'spline':'segments',
       profileNodes:[{x:0,y:0},{x:.18,y:.3},{x:.56,y:-.27},{x:1,y:0}]});
     Object.assign(b,a,{id:'spline-time-target',profileMode:reverse?'segments':'spline',
       profileNodes:[{x:0,y:0},{x:.12,y:-.2},{x:.35,y:.3},{x:.8,y:-.25},{x:1,y:0}]});
     state.layers=[a];runtimeState.morph.renderSourceLayers=[a];runtimeState.morph.renderTargetLayers=[b];
     const configs=[
       {mode:'phase',percent:20,times:[0,.1,.5,.9,.99,.999,1]},
       {mode:'start',percent:20,times:[0,.05,.1,.2,.5,1]},
       {mode:'end',percent:20,times:[0,.5,.8,.85,.9,.95,.99,1]},
       {mode:'end',percent:5,times:[0,.8,.94,.95,.975,.99,.999,1]},
       {mode:'end',percent:0,times:[0,.8,.95,.999,1]}
     ];
     for(const cfg of configs){
      state.morph.profileModeTransition=cfg.mode;
      state.morph.profileModeTransitionPercent=cfg.percent;
      // Verify geometry as well as reported progress: a control point must
      // retain the source handle until the configured window begins.
      const frames=[];
      for(const t of cfg.times){
       runtimeState.morph.progress=t;
       const plan=WebGPUSpiralBezierMorphRenderer.debugCarrierMappedPlan(0,t);
       const q=plan?.paths?.[0]?.[0],s=plan?.sourcePaths?.[0]?.[0],d=plan?.targetPaths?.[0]?.[0];
       if(!q||!s||!d){frames.push({t,error:'missing prepared rail'});continue;}
       const e=expected(cfg.mode,cfg.percent,t);
       const calc=(p,axis,k)=>p[k][axis];
       let knotError=0,handleError=0;
       for(const axis of ['x','y']){
        for(const k of ['p0','p3']){
         const val=calc(s,axis,k)+(calc(d,axis,k)-calc(s,axis,k))*t;
         knotError=Math.max(knotError,dif(val,calc(q,axis,k)));
        }
        for(const [handle,anchor] of [['c1','p0'],['c2','p3']]){
         const sv=calc(s,axis,handle)-calc(s,axis,anchor),dv=calc(d,axis,handle)-calc(d,axis,anchor);
         const val=sv+(dv-sv)*e;
         handleError=Math.max(handleError,dif(val,calc(q,axis,handle)-calc(q,axis,anchor)));
        }
       }
       frames.push({t,expected:e,actual:profileModeTransitionProgress(t),
         knotError,handleError,prepared:plan.preparedContinuousSplineRail,overflow:plan.carrierOverflow});
      }
      output.push({reverse,...cfg,frames});
     }
    }
    // An explicit endpoint must win over a slightly stale animation-clock
    // value; otherwise the final Morph rail differs from its next static frame.
    runtimeState.morph.progress=.87;state.morph.profileModeTransition='phase';
    output.push({endpointCheck:{start:profileModeTransitionProgress(0),end:profileModeTransitionProgress(1)}});
   }finally{
    state.layers=save.layers;runtimeState.morph.renderSourceLayers=save.src;
    runtimeState.morph.renderTargetLayers=save.dst;state.morph.mode=save.morphMode;
    state.morph.spiralMorphType=save.transport;state.morph.profileModeTransition=save.mode;
    state.morph.profileModeTransitionPercent=save.percent;runtimeState.morph.active=save.active;
    runtimeState.morph.progress=save.progress;
   }
   return output;
  })()`,{label:'UI phase timing exact Bezier interpolation'});
  assert.deepEqual(r.at(-1).endpointCheck,{start:0,end:1});
  for(const caseResult of r.slice(0,-1))for(const f of caseResult.frames){
   assert(!f.error&&f.prepared&&!f.overflow,'rail unavailable: '+JSON.stringify(caseResult));
   assert(Math.abs(f.actual-f.expected)<1e-8,'UI schedule was overridden: '+JSON.stringify(caseResult));
   assert(f.knotError<1e-5&&f.handleError<1e-4,'Bézier handles diverge from UI schedule: '+JSON.stringify(caseResult));
  }
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS v10429: phase/start/end respect selected time (0% instant); controls remain continuous and endpoints exact');
 }finally{await h.close();}
})().catch(err=>{console.error('FAIL v10429',err.stack||err);process.exitCode=1;});
