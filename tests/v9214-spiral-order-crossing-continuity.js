const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=require('node:assert/strict');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:120});
 try{
  const result=await h.evaluate(`(()=>{
   const make=(id,order)=>{const layer=createLayer(id);layer.N=10;layer.K=1;layer.spiralEnabled=true;layer.spiralOrder=order;return layer;};
   const src=make('crossing',-3),dst=make('crossing-dst',5);
   state.layers=[src];state.activeLayerId=src.id;state.tunnel.active=true;state.morph.spiralMorphType='phaseCircle';
   runtimeState.morph.renderSourceLayers=[src];runtimeState.morph.renderTargetLayers=[dst];runtimeState.morph.active=true;
   const samples=[];for(let i=0;i<=100;i++){
    const t=i/100;runtimeState.morph.geometryT=t;runtimeState.morph.progress=t;
    const fromCorridor=getMotionTunnelLagRadians({copyId:1},src);
    const e=t*t*(3-2*t),signedDirection=-1+2*e,expected=2*Math.PI/10*signedDirection;
    samples.push({t,fromCorridor,expected});
   }
   runtimeState.morph.active=false;
   const maxError=Math.max(...samples.map(s=>Math.abs(s.fromCorridor-s.expected)));
   const jump=Math.max(...samples.slice(1).map((s,i)=>Math.abs(s.fromCorridor-samples[i].fromCorridor)));
   return{maxError,jump,start:samples[0],middle:samples[50],end:samples[100]};
  })()`);
  assert(result.maxError<1e-9,`Corridor interpolation diverged ${result.maxError}`);
  assert(result.jump<.09,`one-frame angular jump ${result.jump}`);
  assert(result.start.fromCorridor<0&&result.end.fromCorridor>0,'direction did not reverse');
  assert.equal(uncaughtExceptions(h.events).length,0);
  console.log('PASS canonical carrier negative-to-positive direction smoothly crosses zero',result);
 } finally{await h.close()}
})().catch(e=>{console.error('FAIL spiral order crossing',e.stack||e);process.exitCode=1});
