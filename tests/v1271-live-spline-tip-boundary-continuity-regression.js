'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{const h=await createBrowserHarness({disableGpu:true,loadDelayMs:130,evalTimeoutMs:95000});try{
const result=await h.evaluate(`(async()=>{
const l=createLayer('tip-jump');Object.assign(l,{visible:true,spiralEnabled:true,spiralOrder:2,spiralClosed:true,spiralStep:2,spiralStepLinked:false,spiralTangential:true,N:9,K:2,radius:180,rotation:17,rounding:140,profileMode:'spline',profileNodes:[{x:0,y:0},{x:.2,y:.2},{x:.7,y:-.22},{x:1,y:0}]});state.layers=[l];state.activeLayerId=l.id;
state.morph.mode='topology';state.morph.spiralMorphType='phaseCircle';state.morph.intervalSec=.6;
Object.assign(state.morph.options,{byShape:true,byVertices:true,bySteps:true,byRotation:false,bySize:false,byColor:false,byStrokeWidth:false,bySpiralOrder:false,bySpiralLayers:false});state.morph.vertexMin=5;state.morph.vertexMax=13;state.morph.stepMin=0;state.morph.stepMax=100;
let rng=123456789;const random=Math.random;Math.random=()=>{rng=(Math.imul(rng,1664525)+1013904223)>>>0;return rng/4294967296;};
function metrics(p,q){if(!p?.paths||!q?.paths)return null;let max=0,avg=0,num=0;for(let j=0;j<Math.min(p.paths.length,q.paths.length);j++){const a=p.paths[j],b=q.paths[j];for(let i=0;i<Math.min(a.length,b.length);i++)for(const name of ['p0','c1','c2','p3']){const d=Math.hypot(a[i][name].x-b[i][name].x,a[i][name].y-b[i][name].y);max=Math.max(max,d);avg+=d;num++;}}return{max,avg:avg/Math.max(1,num),pCount:p.pathCount,qCount:q.pathCount,pCubics:p.cubicCount,qCubics:q.cubicCount};}
const seen=new Set(),result=[];try{document.getElementById('btnMorph').click();const start=performance.now();while(performance.now()-start<12000&&result.length<5){await new Promise(r=>setTimeout(r,35));const rt=runtimeState.morph,s=rt.lampCycleSerial;if(seen.has(s)||!rt.renderSourceLayers?.length)continue;seen.add(s);const a=__somataSpiralCarrierMorphPlan(0,0),b=__somataSpiralCarrierMorphPlan(0,.000001),c=__somataSpiralCarrierMorphPlan(0,.0001),d=__somataSpiralCarrierMorphPlan(0,.001),e=__somataSpiralCarrierMorphPlan(0,.01),f=__somataSpiralCarrierMorphPlan(0,.99),g=__somataSpiralCarrierMorphPlan(0,.9999),h=__somataSpiralCarrierMorphPlan(0,1);result.push({serial:s,hasHandoff:!!rt.renderSourceLayers[0].__morphBoundaryRails,fromTiny:metrics(a,b),fromSmall:metrics(a,c),from001:metrics(a,d),from01:metrics(a,e),toTiny:metrics(g,h),to01:metrics(f,h),liveRound:b.liveRoundedSpline,overflow:b.carrierOverflow});rt.cycleStart=performance.now()-rt.transitionMs-25;}}finally{Math.random=random;if(runtimeState.morph.active)document.getElementById('btnMorph').click();}return result;
})()`,{timeoutMs:90000});assert.equal(result.length,5,'All five phase boundaries must be tested');
for(const seam of result){
  assert(seam.fromTiny.max<.05,`Instant sharp/round tip switch at start: ${JSON.stringify(seam)}`);
  assert(seam.toTiny.max<.05,`Instant sharp/round tip switch at end: ${JSON.stringify(seam)}`);
  assert(seam.fromSmall.max<.5,`Visible jump just after phase start: ${JSON.stringify(seam)}`);
  assert(seam.from01.max<3,`Near-start tip movement too large: ${JSON.stringify(seam)}`);
  assert.equal(seam.overflow,false,'Spiral carrier overflow');
}
assert.deepEqual(uncaughtExceptions(h.events),[]);console.log('PASS 12.7.1 real UI live Spline+ tip C0 near-seam continuity, five phases:',result.map(s=>({serial:s.serial,start:s.fromTiny.max,end:s.toTiny.max}))); }finally{await h.close();}})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
