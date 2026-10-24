'use strict';
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(condition,label)=>{if(!condition)throw Error(label)};
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:320,evalTimeoutMs:15000});
 try{
  const result=await h.evaluate(`(()=>{
    const a=state.layers[0];Object.assign(a,{spiralEnabled:true,spiralClosed:true,spiralOrder:3,N:8,K:3,spiralStep:3});
    const b={...a,N:13,K:5,spiralOrder:2.2,rotation:31};
    const modes=['torn','continuous','phase','phaseCircle','minimalTurn','topology'];
    return modes.map(spiralType=>{
      const pair=WebGPUSpiralBezierMorphRenderer.debugBuildCpuStaticEditResource?.(0,{sourceLayer:a,targetLayer:b,spiralType,mode:'circleSlide'});
      return{spiralType,ready:!!pair?.cubicCount,cubics:pair?.cubicCount,paths:pair?.pathCount,
      sourceN:pair?.sourceLayer?.N,targetN:pair?.targetLayer?.N,type:pair?.spiralTransport,
      finite:pair?.data?Array.from(pair.data).every(Number.isFinite):false,
      ranges:pair?.cpuPathSegmentRanges?.length,closed:pair?.maxEndpointClosureError};
    });
  })()`,{timeoutMs:15000});
  for(const r of result){
   assert(r.ready&&r.cubics>0&&r.paths>0&&r.finite,'GPU pair builder invalid: '+JSON.stringify(r));
   assert(r.sourceN===8&&r.targetN===13&&r.type===r.spiralType,'transport mismatch: '+JSON.stringify(r));
   assert(r.ranges===r.paths*4,'invalid spiral path ranges: '+JSON.stringify(r));
  }
  assert(!uncaughtExceptions(h.events).length,'browser exception');
  console.log('PASS v9011 six static-edit Spiral Blue pair transports',result.map(r=>`${r.spiralType}:${r.cubics}/${r.paths}`).join(' '));
 }finally{await h.close()}
})().catch(e=>{console.error('FAIL v9011 static edit GPU pair',e.stack||e);process.exitCode=1});
