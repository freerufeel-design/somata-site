'use strict';
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{const h=await createBrowserHarness({disableGpu:true,loadDelayMs:170,evalTimeoutMs:30000});try{
 const out=await h.evaluate(`(()=>{
  const mk=(id,spiral,N,rot)=>{const l=createLayer(id);Object.assign(l,{N,K:5,visible:true,lineVisible:true,radius:190,rotation:rot,rounding:80,profileMode:'spline',profileNodes:[{x:0,y:0},{x:.15,y:.3},{x:.5,y:-.4},{x:.85,y:.21},{x:1,y:0}],spiralEnabled:spiral,spiralStep:2.75,spiralStepLinked:false,spiralOrder:3,spiralClosed:true});return l;};
  state.morph.spiralMorphType='phaseCircle';state.morph.mode='circleSlide';
  const rounds=[];
  for(let i=0;i<7;i++){
   const s=mk('bench-a'+i,true,35,0),d=mk('bench-b'+i,false,39,44);
   runtimeState.morph.renderSourceLayers=[s];runtimeState.morph.renderTargetLayers=[d];
   const ts=performance.now(),r=WebGPUSpiralBezierMorphRenderer.debugBuildCpuResource(0),ms=performance.now()-ts;
   rounds.push({ms,arc:r?.arcEqualizedRecords||0,cubics:r?.cubicCount||0});
  }
  const sorted=rounds.slice(1).map(r=>r.ms).sort((a,b)=>a-b);
  return{rounds,medianMs:sorted[Math.floor(sorted.length/2)]};
 })()`,{timeoutMs:30000,label:'8.8 cross family Morph equalization'});
 if(uncaughtExceptions(h.events).length)throw Error('Uncaught '+uncaughtExceptions(h.events).join(' | '));
 console.log('ARC_EQUALIZED_MORPH_BENCH '+JSON.stringify(out));
 if(!out.rounds.every(r=>r.arc>0&&r.cubics>0))throw Error('Not exercising arc-equalized Morph');
}finally{await h.close()}})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
