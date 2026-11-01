'use strict';
// Screen-space analysis of the same already-finalized cubic rails that the fast
// GPU renderer subdivides into eight lines. No GPU timings are inferred.
const {createBrowserHarness}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:100,evalTimeoutMs:65000});
 try{
 const report=await h.evaluate(`(()=>{
 const nodes=[{x:0,y:0},{x:.17,y:.3},{x:.4,y:-.23},{x:.67,y:.32},{x:1,y:0}];
 const ls=Array.from({length:3},(_,i)=>{const l=createLayer('glow-budget-'+i);Object.assign(l,{N:17+i,K:5+i,radius:165+i*22,rotation:13*i,rounding:160,profileMode:'spline',profileNodes:nodes,spiralEnabled:true,spiralOrder:3,spiralStepLinked:false,spiralStep:2.75+i*.05,spiralClosed:true,spiralRoundSeams:true,spiralTangential:true,visible:true,lineVisible:true,glow:12});ensureLayerEffectState(l);return l;});
 state.layers.splice(0,state.layers.length,...ls);state.activeLayerId=ls[0].id;
 runtimeState.morph.active=true;runtimeState.morph.mode='circleSlide';runtimeState.morph.progress=.45;runtimeState.morph.geometryT=.45;
 runtimeState.morph.renderSourceLayers=ls.map(l=>({...l}));runtimeState.morph.renderTargetLayers=ls.map((l,i)=>({...l,N:l.N+1,K:l.K+1,rotation:l.rotation+32+i*7,profileNodes:nodes.map((p,j)=>({...p,y:p.y+Math.sin(j+i)*.1}))}));
 const plans=ls.map((l,i)=>__somataSpiralCarrierMorphPlan(i,.45));const curves=plans.flatMap(p=>(p?.paths||[]).flat());
 function point(q,t){const z=1-t;return{x:z*z*z*q.p0.x+3*z*z*t*q.c1.x+3*z*t*t*q.c2.x+t*t*t*q.p3.x,y:z*z*z*q.p0.y+3*z*z*t*q.c1.y+3*z*t*t*q.c2.y+t*t*t*q.p3.y};}
 const hypot=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
 const result=[];
 for(const radius of [5,6.6,12,24,40])for(const scale of [0.5,1,2]){
 let merges=0,pairs=0,areaBefore=0,areaAfter=0,maxError=0,maxWidthError=0;
 for(const q of curves){const log0=Math.log(Math.max(.02,Number(q.widthScale0)||1)),log1=Math.log(Math.max(.02,Number(q.widthScale1)||1));
  const xy=Array.from({length:9},(_,k)=>{const p=point(q,k/8);return{x:p.x*scale,y:p.y*scale};});
  for(let j=0;j<8;j+=2){const p0=xy[j],pm=xy[j+1],pe=xy[j+2],ch={x:pe.x-p0.x,y:pe.y-p0.y},den=Math.max(.000001,ch.x*ch.x+ch.y*ch.y),fraction=Math.max(0,Math.min(1,((pm.x-p0.x)*ch.x+(pm.y-p0.y)*ch.y)/den));const err=Math.hypot(pm.x-p0.x-fraction*ch.x,pm.y-p0.y-fraction*ch.y);const w0=Math.max(.18,1.25*scale*Math.exp(log0+(log1-log0)*(j/8))),wm=Math.max(.18,1.25*scale*Math.exp(log0+(log1-log0)*((j+1)/8))),we=Math.max(.18,1.25*scale*Math.exp(log0+(log1-log0)*((j+2)/8)));const pred=Math.exp(Math.log(w0)*(1-fraction)+Math.log(we)*fraction),wErr=Math.abs(wm-pred);const dot=(pm.x-p0.x)*(pe.x-pm.x)+(pm.y-p0.y)*(pe.y-pm.y);const ok=dot>0&&err<=Math.min(.60,Math.max(.22,radius*.045))&&wErr<=Math.min(.25,Math.max(.12,radius*.020));
   const pad=Math.max(w0,wm,we)+radius*scale+2,oldA=(hypot(p0,pm)+pad*2)*(pad*2)+(hypot(pm,pe)+pad*2)*(pad*2),newA=(hypot(p0,pe)+pad*2)*(pad*2);
   areaBefore+=oldA;areaAfter+=ok?newA:oldA;pairs++;if(ok){merges++;maxError=Math.max(maxError,err);maxWidthError=Math.max(maxWidthError,wErr);}
  }
 }
 result.push({radius,scale,curves:curves.length,pairs,mergedPairs:merges,mergedPercent:Number((merges/pairs*100).toFixed(2)),estimatedGlowQuadAreaReductionPercent:Number(((1-areaAfter/areaBefore)*100).toFixed(2)),maxJoinedScreenErrorPx:Number(maxError.toFixed(5)),maxJoinedWidthErrorPx:Number(maxWidthError.toFixed(5))});
 }
 return {layers:ls.length,phase:.45,pathCounts:plans.map(p=>p?.paths?.length||0),curves:curves.length,subdivisions:8,result};
})()`,{timeoutMs:65000});
 if(report.curves<100||!report.result.some(r=>r.mergedPairs>100))throw new Error('No meaningful compaction measured: '+JSON.stringify(report));
 for(const v of report.result){if(v.maxJoinedScreenErrorPx>.600001||v.maxJoinedWidthErrorPx>.250001)throw Error('Compaction threshold violated '+JSON.stringify(v));}
 console.log(JSON.stringify(report,null,2));
 }finally{await h.close();}
})().catch(err=>{console.error(err.stack||err);process.exitCode=1});
