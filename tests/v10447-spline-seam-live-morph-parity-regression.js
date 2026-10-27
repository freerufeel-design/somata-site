'use strict';
// Regression for profile edits on first-order closed Spiral with two-end
// tangentiality. Every intermediate rounded-spline frame must use the same
// mathematical final-space corner builder as Static, not a control-handle mix
// which straightens the seam until the static frame appears.
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:120,evalTimeoutMs:55000});
 try{
  const result=await h.evaluate(`(()=>{
   const save={layers:state.layers,src:runtimeState.morph.renderSourceLayers,
    dst:runtimeState.morph.renderTargetLayers,type:state.morph.spiralMorphType,schedule:state.morph.profileModeTransition};
   const result=[];
   const sample=cubics=>{const points=[];for(const c of cubics||[])for(let k=0;k<=12;k++){
     const t=k/12,z=1-t;
     points.push({x:z*z*z*c.p0.x+3*z*z*t*c.c1.x+3*z*t*t*c.c2.x+t*t*t*c.p3.x,
       y:z*z*z*c.p0.y+3*z*z*t*c.c1.y+3*z*t*t*c.c2.y+t*t*t*c.p3.y});
   }return points;};
   const directed=(a,b)=>Math.max(...a.map(p=>Math.min(...b.map(q=>Math.hypot(p.x-q.x,p.y-q.y)))));
   const compare=(a,b)=>Math.max(directed(sample(a),sample(b)),directed(sample(b),sample(a)));
   const flat=path=>(path||[]).flatMap(q=>[q.p0.x,q.p0.y,q.c1.x,q.c1.y,q.c2.x,q.c2.y,q.p3.x,q.p3.y]);
   try{
     state.morph.spiralMorphType='continuous';state.morph.profileModeTransition='phase';
     const nodesA=[{x:0,y:0},{x:.13,y:-.27},{x:1,y:0}],
       nodesB=[{x:0,y:0},{x:.15,y:.32},{x:1,y:0}];
     const a=createLayer('source'),b=createLayer('target');
     Object.assign(a,{N:4,K:1,spiralEnabled:true,spiralOrder:1,spiralClosed:true,
       spiralTangential:true,spiralRoundSeams:true,radius:230,rounding:55,
       profileMode:'spline',profileNodes:nodesA});
     Object.assign(b,a,{profileNodes:nodesB});
     state.layers=[a];runtimeState.morph.renderSourceLayers=[a];runtimeState.morph.renderTargetLayers=[b];
     for(const kind of ['blue','animation']){
       const pair=kind==='animation'?{sourceLayer:a,targetLayer:b,spiralType:'continuous',mode:'circleSlide'}:null;
       for(const t of [.25,.5,.75]){
         const plan=WebGPUSpiralBezierMorphRenderer.debugCarrierMappedPlan(0,t,pair);
         const spec=plan?.carrierFrames?.[0];
         const h=profileModeTransitionProgress(t);
         const middle={...a,profileNodes:nodesA.map((p,i)=>({
           x:p.x+(nodesB[i].x-p.x)*h,y:p.y+(nodesB[i].y-p.y)*h
         }))};
         const staticPath=__spiroBuildSpiralCarrierPath(middle,spec.anchor,{
           radius:230,delta:spec.delta,targetScale:spec.targetScale,tangential:spec.tangential,
           closed:true,roundSeams:true,roundingFrac:.55,profileNodes:middle.profileNodes
         });
         result.push({kind,t,live:plan?.liveRoundedSpline,prepared:plan?.preparedContinuousSplineRail,
           fallback:plan?.liveRoundedSplineFallbacks,rebuilt:plan?.liveRoundedSplineFrames,
           cubicCount:plan?.paths?.[0]?.length,referenceCount:staticPath?._bezierSegments?.length,
           distance:compare(plan.paths[0],staticPath._bezierSegments)});
       }
       const near=WebGPUSpiralBezierMorphRenderer.debugCarrierMappedPlan(0,.999999,pair),
             end=WebGPUSpiralBezierMorphRenderer.debugCarrierMappedPlan(0,1,pair);
       const x=flat(near.paths[0]),y=flat(end.paths[0]);
       result.push({kind,boundary:true,nearCount:near.paths[0].length,endCount:end.paths[0].length,
         difference:x.length===y.length?Math.max(...x.map((v,i)=>Math.abs(v-y[i]))):Infinity});
     }
   }finally{
     state.layers=save.layers;runtimeState.morph.renderSourceLayers=save.src;
     runtimeState.morph.renderTargetLayers=save.dst;state.morph.spiralMorphType=save.type;state.morph.profileModeTransition=save.schedule;
   }
   return result;
  })()`,{label:'closed Spiral spline edits retain baked static seam rounding at every frame'});
  assert.equal(result.length,8);
  for(const r of result){
   if(r.boundary){assert.equal(r.nearCount,r.endCount);assert(r.difference<.002,'final endpoint jump: '+JSON.stringify(r));}
   else {
    assert(r.live&&r.prepared&&r.rebuilt>0&&r.fallback===0,'live round builder not used: '+JSON.stringify(r));
    assert(r.distance<3.8,'rounded static vs Morph curve mismatch: '+JSON.stringify(r));
   }
  }
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS v10447: first-order tangential closed Spiral, Blue/Animation, live spline seam rounding and final continuity');
 }finally{await h.close();}
})().catch(e=>{console.error('FAIL v10447',e.stack||e);process.exitCode=1});
