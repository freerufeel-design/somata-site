'use strict';
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{const h=await createBrowserHarness({disableGpu:true,loadDelayMs:150,evalTimeoutMs:60000});try{
 const output=await h.evaluate(`(()=>{
  const mk=(id,N,K,rad,rot,profile,round)=>{const l=createLayer(id);Object.assign(l,{visible:true,N,K,radius:rad,rotation:rot,rounding:round,profileMode:profile,spiralEnabled:true,spiralOrder:3,spiralStepLinked:false,spiralStep:2.75,spiralTangential:true,spiralClosed:true,spiralRoundSeams:true,profileNodes:[{x:0,y:0},{x:.14,y:.42},{x:.37,y:-.31},{x:.68,y:.36},{x:1,y:0}]});return l;};
  state.morph.mode='circleSlide';state.morph.spiralMorphType='phaseCircle';const data=[];
  const scenarios=[['spline','spline',18,18,80,160],['segments','segments',21,23,100,180],['spline','segments',18,23,60,140]];
  for(const [a,b,n,m,round0,round1] of scenarios){const s=mk('s',n,5,210,12,a,round0),d=mk('d',m,7,275,59,b,round1);runtimeState.morph.renderSourceLayers=[s];runtimeState.morph.renderTargetLayers=[d];const r=__somataSpiralMorphCpuPlan(0);const results=[];
    const ts=[0,.05,.1,.2,.4,.5,.67,.8,.91,.99,1];
    for(const t of ts){const plan=__somataSpiralCarrierMorphPlan(0,t);const p=plan?.packed||[];let sum=0,sumsq=0;for(let i=0;i<p.length;i++){sum+=p[i]*((i%7)+1);sumsq+=p[i]*p[i]*((i%3)+1);}results.push({t,count:p.length,sum,sumsq,sample:p.slice(0,32)});}data.push({scenario:a+'-'+b,results});
  }
  return data;
 })()`,{timeoutMs:60000});
 console.log('COMPARE_JSON '+JSON.stringify(output));
 if(uncaughtExceptions(h.events).length)throw Error(uncaughtExceptions(h.events).join(' | '));
}finally{await h.close()}})().catch(e=>{console.error('ERR',e.stack||e);process.exitCode=1});
