'use strict';
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:120,evalTimeoutMs:60000});
 try{
  const out=await h.evaluate(`(()=>{
   const make=(id,N,K,rotation,nodes)=>{const l=createLayer(id);Object.assign(l,{visible:true,lineVisible:true,N,K,rotation,radius:245,rounding:145,roundingShape:'spline',lineJoinType:'rounded',profileMode:'spline',profileNodes:nodes,spiralEnabled:true,spiralOrder:3,spiralStep:2.75,spiralStepLinked:false,spiralTangential:true,spiralClosed:true,spiralRoundSeams:true,wholeCurveSpline:true});return l;};
   const sa=[{x:0,y:0},{x:.15,y:.5},{x:.32,y:-.25},{x:.73,y:.37},{x:1,y:0}],da=[{x:0,y:0},{x:.12,y:.26},{x:.42,y:-.4},{x:.65,y:.2},{x:1,y:0}];
   state.morph.spiralMorphType='phaseCircle';state.morph.mode='circleSlide';
   runtimeState.morph.renderSourceLayers=[make('s',18,5,0,sa)];runtimeState.morph.renderTargetLayers=[make('d',19,6,48,da)];
   const hash=(a)=>{let n=2166136261;for(let i=0;i<a.length;i++){const b=Math.round(a[i]*1e5);n=Math.imul(n^(b|0),16777619)>>>0;}return n>>>0;};
   const p=__spiroSpiralCarrierProfilePrepStatus();
   const vals=[];
   const a=performance.now();
   for(const t of [.03,.17,.37,.59,.81,.98]){
     const b=__somataSpiralCarrierMorphPlan(0,t);
     vals.push({t,cubics:b.cubicCount,paths:b.pathCount,hash:hash(b.packed),live:b.liveRoundedSpline,prepared:b.preparedContinuousSplineRail,overflow:b.carrierOverflow});
   }
   const initMs=performance.now()-a;
   const prepDelta=__spiroSpiralCarrierProfilePrepStatus().prepares-p.prepares;
   const bench=__somataSpiralCarrierAdvanceBench(0,36);
   return{vals,initMs,prepDelta,bench:{ms:bench?.ms,msPerSample:bench?.msPerSample,cubicCount:bench?.cubicCount,checksum:bench?.checksum},status:__somataSpiralBezierMorphStatus().stats};
  })()`,{timeoutMs:55000,label:'v12.6.6 live phase preparation'});
  if(uncaughtExceptions(h.events).length)throw Error(uncaughtExceptions(h.events).join(' | '));
  console.log('SPIRAL_LIVE_PREP_BENCH_JSON '+JSON.stringify(out));
 }finally{await h.close();}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
