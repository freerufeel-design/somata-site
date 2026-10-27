'use strict';
const assert=require('node:assert/strict');
const{createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{const h=await createBrowserHarness({disableGpu:true,loadDelayMs:100,evalTimeoutMs:25000});try{
 const result=await h.evaluate(`(()=>{
   const layer=createLayer('angular-n');Object.assign(layer,{spiralEnabled:true,spiralOrder:1,spiralClosed:true,K:1,N:4,profileMode:'segments',profileNodes:[{x:0,y:0},{x:1,y:0}]});
   const readings=[];
   for(const x of [4,4.1,4.25,4.49,4.5,4.51,4.75,4.9,5]){
      layer.N=Math.round(x);layer.__spiralAnimatedN=x;
      const spec=__spiroGetSpiralCarrierSpec(layer,0);
      const polylines=buildOrbitPolylines(layer);
      const first=polylines?.[0]?.points?.[0];
      readings.push({x,angularN:spec.N,carrierDelta:spec.delta,drawDelta:first?.__spiralDelta,drawCount:polylines?.length,signature:layerGeometrySignature(layer),spiralSignature:__spiroSpiralProfileGeometrySignature(layer)});
   }
   delete layer.__spiralAnimatedN;layer.N=5;
   const staticSpec=__spiroGetSpiralCarrierSpec(layer,0);
   const staticDraw=buildOrbitPolylines(layer)?.[0]?.points?.[0]?.__spiralDelta;
   const s={...layer,N:4},d={...layer,N:5};state.layers=[s];state.morph.mode='circleSlide';state.morph.spiralMorphType='phaseCircle';
   runtimeState.morph.renderSourceLayers=[s];runtimeState.morph.renderTargetLayers=[d];runtimeState.morph.active=true;
   const sampled=[];
   for(const t of [0,.1,.25,.49,.5,.51,.75,.9,1]){runtimeState.morph.geometryT=t;const plan=__somataSpiralCarrierMorphPlan(0,t);sampled.push({t,phase:plan?.carrierFrames?.[0]?.delta,ready:!!plan?.paths?.length,overflow:plan?.carrierOverflow});}
   runtimeState.morph.active=false;
   return{readings,staticDelta:staticSpec.delta,staticDraw,sampled};
 })()`,{timeoutMs:24000,label:'fractional N spiral frame agreement'});
 for(const r of result.readings){const expected=2*Math.PI/r.x;assert(Math.abs(r.angularN-r.x)<1e-12,JSON.stringify(r));assert(Math.abs(r.carrierDelta-expected)<1e-8,JSON.stringify(r));assert(Math.abs(r.drawDelta-expected)<1e-8,'static fallback angular mismatch '+JSON.stringify(r));}
 for(let i=1;i<result.readings.length;i++){assert(result.readings[i].carrierDelta<result.readings[i-1].carrierDelta,'angle jumps at rounded N');assert.notEqual(result.readings[i].signature,result.readings[i-1].signature,'geometry cache reused old angular N');assert.notEqual(result.readings[i].spiralSignature,result.readings[i-1].spiralSignature,'spiral cache reused old angular N');}
 assert(Math.abs(result.readings.at(-1).carrierDelta-result.staticDelta)<1e-10);
 assert(Math.abs(result.readings.at(-1).drawDelta-result.staticDraw)<1e-10);
 for(const r of result.sampled){assert(r.ready&&!r.overflow,'carrier not ready '+JSON.stringify(r));const expected=2*Math.PI/(4+r.t);assert(Math.abs(r.phase-expected)<1e-8,JSON.stringify(r));}
 assert.equal(uncaughtExceptions(h.events).length,0);
 console.log('PASS: fractional N shapes, CPU/GPU agreement, final phase', JSON.stringify({readings:result.readings.map(r=>({n:r.x,angleDegrees:180* r.carrierDelta/Math.PI})),gpuSamples:result.sampled.length}));
}finally{await h.close();}})().catch(err=>{console.error(err.stack||err);process.exitCode=1});
