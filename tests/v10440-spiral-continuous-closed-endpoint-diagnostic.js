'use strict';
// Geometry-only boundary guard. Does not certify actual WebGPU pixels.
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:120,evalTimeoutMs:45000});
 try{
  const cases=await h.evaluate(`(()=>{
   const save={layers:state.layers,src:runtimeState.morph.renderSourceLayers,dst:runtimeState.morph.renderTargetLayers,type:state.morph.spiralMorphType};
   const out=[];
   const flat=p=>(p||[]).flatMap(q=>[q.p0.x,q.p0.y,q.c1.x,q.c1.y,q.c2.x,q.c2.y,q.p3.x,q.p3.y]);
   const diff=(a,b)=>{if(a.length!==b.length)return Infinity;let m=0;for(let i=0;i<a.length;i++)m=Math.max(m,Math.abs(a[i]-b[i]));return m;};
   try{
    state.morph.spiralMorphType='continuous';
    for(const closed of [true,false])for(const varyNK of [false,true])for(const tangential of [false,true]){
     const a=createLayer('source'),b=createLayer('target');
     Object.assign(a,{N:8,K:3,spiralEnabled:true,spiralOrder:2.5,spiralClosed:closed,
      spiralRoundSeams:true,spiralTangential:tangential,radius:250,rounding:52,profileMode:'segments',
      profileNodes:[{x:0,y:0},{x:.3,y:-.35},{x:.55,y:.2},{x:.85,y:-.15},{x:1,y:0}]});
     Object.assign(b,a,{N:varyNK?9:8,K:varyNK?4:3,radius:270,spiralOrder:2.8,rotation:12,
      profileNodes:[{x:0,y:0},{x:.3,y:-.1},{x:.6,y:.32},{x:.85,y:-.12},{x:1,y:0}]});
     state.layers=[a];runtimeState.morph.renderSourceLayers=[a];runtimeState.morph.renderTargetLayers=[b];
     const near=WebGPUSpiralBezierMorphRenderer.debugCarrierMappedPlan(0,.999999),end=WebGPUSpiralBezierMorphRenderer.debugCarrierMappedPlan(0,1);
     out.push({closed,varyNK,tangential,nearDiff:diff(flat(near?.paths?.[0]),flat(end?.paths?.[0])),
      countNear:near?.paths?.[0]?.length,countEnd:end?.paths?.[0]?.length,mapped:near?.carrierMapped,overflow:near?.carrierOverflow});
    }
   }finally{state.layers=save.layers;runtimeState.morph.renderSourceLayers=save.src;runtimeState.morph.renderTargetLayers=save.dst;state.morph.spiralMorphType=save.type;}
   return out;
  })()`,{label:'continuous Spiral closure boundary: .999999 to 1'});
  assert.equal(cases.length,8);
  for(const c of cases)assert(c.mapped&&!c.overflow&&c.countNear>0&&c.countNear===c.countEnd&&c.nearDiff<.05,
   'prepared continuous endpoint discontinuity: '+JSON.stringify(c));
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS v10440: eight CPU-prepared continuous Spiral boundary cases, closed/open, tangential and N/K changes');
 }finally{await h.close();}
})().catch(e=>{console.error('FAIL v10440',e.stack||e);process.exitCode=1;});
