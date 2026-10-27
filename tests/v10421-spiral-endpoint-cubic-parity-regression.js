'use strict';
// The static path and the final GPU Morph rail must use the *same* baked
// Bézier controls. Regression: endpointCubics used to re-run a tangent repair
// on already-finalized static spline cubics, bending the control points by
// ~2-4 px for a rounded closed Spiral (visible as an end-of-tangency jerk).
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:120,evalTimeoutMs:20000});
 try{
  const result=await h.evaluate(`(()=>{
   const result=[];
   for(const closed of [false,true])for(const rounding of [0,25,65])for(const profileMode of ['segments','spline']){
    const a=createLayer('spiral-src'),b=createLayer('spiral-dst');
    Object.assign(a,{N:7,K:2,spiralEnabled:true,spiralOrder:2,spiralClosed:closed,spiralTangential:false,spiralRoundSeams:true,radius:230,profileMode,rounding,profileNodes:[{x:0,y:0},{x:.25,y:.15},{x:.55,y:-.12},{x:1,y:0}]});
    Object.assign(b,a,{id:'spiral-dst',spiralTangential:true});
    const actual=(buildOrbitPolylines(b)||[])[0]?._bezierSegments||[];
    state.layers=[a];runtimeState.morph.renderSourceLayers=[a];runtimeState.morph.renderTargetLayers=[b];
    const plan=WebGPUSpiralBezierMorphRenderer.debugCarrierMappedPlan(0,1);
    const target=plan?.targetPaths?.[0]||[],rendered=plan?.paths?.[0]||[];
    const diff=(x,y)=>{if(x.length!==y.length)return Infinity;let err=0;for(let i=0;i<x.length;i++)for(const field of ['p0','c1','c2','p3'])err=Math.max(err,Math.hypot(x[i][field].x-y[i][field].x,x[i][field].y-y[i][field].y));return err;};
    result.push({closed,rounding,profileMode,carrier:plan?.carrierMapped,overflow:plan?.carrierOverflow,count:actual.length,
      endpointError:diff(target,actual),renderError:diff(rendered,actual)});
   }
   runtimeState.morph.renderSourceLayers=[];runtimeState.morph.renderTargetLayers=[];state.layers=[];
   return result;
  })()`,{label:'exact Spiral Morph/static Bézier endpoint comparison'});
  assert.equal(result.length,12);
  for(const v of result){assert(v.carrier&&!v.overflow&&v.count>2,'GPU plan invalid: '+JSON.stringify(v));
   assert(v.endpointError<1e-6&&v.renderError<1e-6,'Tangential endpoint applies an extra rounding pass: '+JSON.stringify(v));}
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS v10421 Spiral tangential Morph endpoint === static baked Bézier (12 combinations, incl. closed rounded spline)');
 }finally{await h.close();}
})().catch(err=>{console.error(err.stack||err);process.exitCode=1});
