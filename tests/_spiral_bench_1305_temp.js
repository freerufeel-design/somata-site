'use strict';
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{const h=await createBrowserHarness({disableGpu:true,loadDelayMs:140,evalTimeoutMs:90000});try{
const r=await h.evaluate(`(()=>{
const mk=(id,i,dst=false)=>{const l=createLayer(id);Object.assign(l,{visible:true,N:16+i,K:5+i,radius:210+i*11+(dst?10:0),rotation:(dst?43:9)+i*4,rounding:110,profileMode:i%2?'segments':'spline',profileNodes:[{x:0,y:0},{x:.14,y:.42},{x:.37,y:-.31},{x:.68,y:.36},{x:1,y:0}],spiralEnabled:true,spiralOrder:3,spiralStep:2.75,spiralStepLinked:false,spiralTangential:true,spiralClosed:true,spiralRoundSeams:true});return l;};
state.morph.mode='circleSlide';state.morph.spiralMorphType='phaseCircle';runtimeState.morph.renderSourceLayers=Array.from({length:4},(_,i)=>mk('s'+i,i));runtimeState.morph.renderTargetLayers=Array.from({length:4},(_,i)=>mk('d'+i,i,true));
const samples=[];
for(let warm=0;warm<2;warm++)for(let i=0;i<4;i++)__somataSpiralCarrierAdvanceBench(i,4);
for(let trial=0;trial<4;trial++){const times=[];let total=0;for(let i=0;i<4;i++){const a=__somataSpiralCarrierAdvanceBench(i,24);times.push({ms:a?.ms||NaN,cubics:a?.cubicCount,checksum:a?.checksum});total+=a?.ms||0;}samples.push({total,times});}
return samples;
})()`,{timeoutMs:90000});console.log('BENCH_JSON '+JSON.stringify(r));if(uncaughtExceptions(h.events).length)throw Error(uncaughtExceptions(h.events).join(' | '));
}finally{await h.close()}})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
