'use strict';
// Tangential-only Morph/Static Edit: do not redivide independently-baked
// Spiral cubics on every animation frame. Interpolate the fixed endpoint
// controls so that all intermediate shapes approach the exact static target.
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:110,evalTimeoutMs:24000});
 try{
  const result=await h.evaluate(`(()=>{
   const cases=[];
   for(const closed of [true,false])for(const mode of ['segments','spline'])for(const rounding of [0,55])for(const reverse of [false,true]){
     const src=createLayer('smooth-src'),dst=createLayer('smooth-dst');
     Object.assign(src,{N:7,K:2,spiralEnabled:true,spiralOrder:2,spiralClosed:closed,
       spiralTangential:reverse,spiralRoundSeams:true,radius:220,rounding,profileMode:mode,
       profileNodes:[{x:0,y:0},{x:.23,y:.24},{x:.57,y:-.13},{x:1,y:0}]});
     Object.assign(dst,src,{id:'smooth-dst',spiralTangential:!reverse});
     state.layers=[src];runtimeState.morph.renderSourceLayers=[src];runtimeState.morph.renderTargetLayers=[dst];
     const ts=[0,.25,.5,.75,.98,.99,.991,.993,.997,.998,.999,1];
     const plans=ts.map(t=>WebGPUSpiralBezierMorphRenderer.debugCarrierMappedPlan(0,t));
     const p0=plans[0]?.sourcePaths?.[0]||[],p1=plans.at(-1)?.targetPaths?.[0]||[];
     const flatten=q=>[q?.p0?.x,q?.p0?.y,q?.c1?.x,q?.c1?.y,q?.c2?.x,q?.c2?.y,q?.p3?.x,q?.p3?.y];
     const source=p0.flatMap(flatten),target=p1.flatMap(flatten);
     const deviations=plans.map((plan,idx)=>{
       const t=ts[idx],w=t*t*(3-2*t),actual=(plan?.paths?.[0]||[]).flatMap(flatten);
       if(actual.length!==target.length)return {endpointError:Infinity,interpolationError:Infinity};
       let endpointError=0,interpolationError=0;
       for(let k=0;k<actual.length;k++){
         endpointError=Math.max(endpointError,Math.abs(actual[k]-target[k]));
         interpolationError=Math.max(interpolationError,Math.abs(actual[k]-(source[k]*(1-w)+target[k]*w)));
       }
       return {endpointError,interpolationError};
     });
     cases.push({closed,mode,rounding,reverse,
       mapped:plans.every(p=>p?.carrierMapped===true&&p?.tangentialOnlyCarrierChange===true),
       overflow:plans.some(p=>p?.carrierOverflow===true),
       count:source.length,
       t:ts,deviations,originalStart:p0.length,originalEnd:p1.length});
   }
   // Changing unrelated geometry must keep its original special Spiral transport.
   const a=createLayer('unrelated-a'),b=createLayer('unrelated-b');
   Object.assign(a,{spiralEnabled:true,spiralOrder:2,spiralTangential:false});
   Object.assign(b,a,{id:'unrelated-b',spiralOrder:3,spiralTangential:true});
   state.layers=[a];runtimeState.morph.renderSourceLayers=[a];runtimeState.morph.renderTargetLayers=[b];
   const unrelated=WebGPUSpiralBezierMorphRenderer.debugCarrierMappedPlan(0,.7);
   runtimeState.morph.renderSourceLayers=[];runtimeState.morph.renderTargetLayers=[];state.layers=[];
   return {cases,unrelated};
  })()`,{label:'continuous tangential-only cubic transition'});
  assert.equal(result.cases.length,16);
  for(const c of result.cases){
    assert(c.mapped&&!c.overflow&&c.count>8,'missing tangential GPU route: '+JSON.stringify(c));
    for(const x of c.deviations){
      assert(x.interpolationError<1e-6,'Bezier controls do not interpolate continuously: '+JSON.stringify(c));
    }
    for(let i=5;i<c.deviations.length;i++){
      const prev=c.deviations[i-1].endpointError,cur=c.deviations[i].endpointError;
      assert(cur<=prev+1e-7,'late shape jumped away from target: '+JSON.stringify(c));
    }
    assert(c.deviations.at(-1).endpointError<1e-7,'end figure changed: '+JSON.stringify(c));
    assert(c.deviations.at(-2).endpointError<.02,'terminal geometry not smoothly settled: '+JSON.stringify(c));
  }
  assert.equal(result.unrelated?.tangentialOnlyCarrierChange,false,'unrelated Spiral changes must keep their original transport');
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS v10424 tangential-only Spiral: 16 eased forward/reverse, open/closed, spline/segments, rounding off/on cases; baked final cubics exact');
 }finally{await h.close();}
})().catch(err=>{console.error('FAIL',err.stack||err);process.exitCode=1});
