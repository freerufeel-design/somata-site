'use strict';
// 10.4.19.16: continuous Morph always uses the prepared Bézier rail.
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:120,evalTimeoutMs:50000});
 try{
  const cases=await h.evaluate(`(()=>{
   const save={layers:state.layers,src:runtimeState.morph.renderSourceLayers,dst:runtimeState.morph.renderTargetLayers,
    transport:state.morph.spiralMorphType,mode:state.morph.profileModeTransition,fourier:state.fourierMode};
   const out=[];
   const flat=a=>(a||[]).flatMap(q=>[q.p0.x,q.p0.y,q.c1.x,q.c1.y,q.c2.x,q.c2.y,q.p3.x,q.p3.y]);
   const curve=paths=>Math.max(0,...(paths||[]).flatMap(path=>path.map(q=>{
    const dx=q.p3.x-q.p0.x,dy=q.p3.y-q.p0.y;
    return Math.max(Math.hypot(q.c1.x-q.p0.x-dx/3,q.c1.y-q.p0.y-dy/3),
     Math.hypot(q.c2.x-q.p0.x-dx*2/3,q.c2.y-q.p0.y-dy*2/3));
   })));
   try{
    state.fourierMode=false;state.morph.spiralMorphType='continuous';
    for(const closed of [true,false])for(const pm of ['segments','spline']){
     let baseline=null;
     for(const legacyValue of [undefined,false,true]){
      const a=createLayer('bezier-morph-source'),b=createLayer('bezier-morph-target');
      Object.assign(a,{N:7,K:2,radius:230,rotation:0,spiralEnabled:true,spiralOrder:2.3,
       spiralClosed:closed,spiralRoundSeams:true,spiralTangential:false,
       profileMode:pm,rounding:48,
       profileNodes:[{x:0,y:0},{x:.26,y:.38},{x:.5,y:-.18},{x:.76,y:.24},{x:1,y:0}]});
      Object.assign(b,a,{spiralOrder:2.8,radius:245,rounding:62,
       profileNodes:[{x:0,y:0},{x:.18,y:-.2},{x:.51,y:.44},{x:.83,y:-.18},{x:1,y:0}]});
      if(legacyValue!==undefined){a.spiralFullBezierInterpolation=legacyValue;b.spiralFullBezierInterpolation=legacyValue;}
      state.layers=[a];runtimeState.morph.renderSourceLayers=[a];runtimeState.morph.renderTargetLayers=[b];
      const start=WebGPUSpiralBezierMorphRenderer.debugCarrierMappedPlan(0,0);
      const near=WebGPUSpiralBezierMorphRenderer.debugCarrierMappedPlan(0,.99999);
      const mid=WebGPUSpiralBezierMorphRenderer.debugCarrierMappedPlan(0,.5);
      const end=WebGPUSpiralBezierMorphRenderer.debugCarrierMappedPlan(0,1);
      const snapshot={counts:[start?.paths?.[0]?.length,mid?.paths?.[0]?.length,near?.paths?.[0]?.length,end?.paths?.[0]?.length],
       mapped:mid?.carrierMapped,prepared:mid?.preparedContinuousSplineRail,overflow:!!mid?.carrierOverflow,
       midCurvature:curve(mid?.paths),endCurvature:curve(end?.paths),
       middle:flat(mid?.paths?.[0]),endpoint:flat(end?.paths?.[0])};
      out.push({closed,pm,legacyValue:legacyValue===undefined?'missing':legacyValue,
       ...snapshot,equivalent:baseline===null||JSON.stringify(snapshot)===JSON.stringify(baseline)});
      if(baseline===null)baseline=snapshot;
     }
    }
   }finally{state.layers=save.layers;runtimeState.morph.renderSourceLayers=save.src;runtimeState.morph.renderTargetLayers=save.dst;
    state.morph.spiralMorphType=save.transport;state.morph.profileModeTransition=save.mode;state.fourierMode=save.fourier;}
   return out;
  })()`,{label:'Spiral Bézier-only continuous Morph, open/closed and legacy flags'});
  for(const c of cases){
   assert(c.mapped&&c.prepared&&!c.overflow&&c.counts.every(n=>n>0&&n===c.counts[0]),'lost prepared Bézier rail: '+JSON.stringify(c));
   assert(c.midCurvature>1e-4&&c.endCurvature>1e-4,'curved handles lost: '+JSON.stringify(c));
   assert(c.equivalent,'legacy mode changes the visible path: '+JSON.stringify(c));
  }
  assert.equal(cases.length,12);
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS v10439: 12 continuous Morph plans; open/closed, spline/segments; saved legacy false cannot disable Bézier');
 }finally{await h.close();}
})().catch(e=>{console.error('FAIL v10439',e.stack||e);process.exitCode=1;});
