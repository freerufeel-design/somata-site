'use strict';
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=require('node:assert/strict');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:120,evalTimeoutMs:24000});
 try{
 const data=await h.evaluate(`(()=>{
 const mk=(name,N,K)=>{const l=createLayer(name);Object.assign(l,{N,K,spiralStep:K,spiralOrder:1,spiralEnabled:true,spiralClosed:true,spiralStepLimiterEnabled:true,spiralStepLimiter:2,profileMode:'segments',profileNodes:[{x:0,y:0},{x:1,y:0}],customSuborbits:null});return l;};
 const capped=[];for(let n of [3,4,5,6,8,16,20])for(let k of [1,2,3,4,5,6,7,8,9,10]){
  const l=mk('cap',n,k),eff=getEffectiveSpiralStep(l),paths=buildOrbitPolylines(l);
  capped.push({n,k,eff,branches:paths.length,finite:paths.every(p=>p.points.every(q=>Number.isFinite(q.x)&&Number.isFinite(q.y)))});
 }
 const reports=[];
 for(const type of ['continuous','phase','minimalTurn','phaseCircle','torn'])for(const axes of ['N','K','NK']){
  const from=mk('source',18,3),to=mk('target',axes==='K'?18:20,axes==='N'?3:4);
  state.layers=[from];state.morph.mode='circleSlide';state.morph.spiralMorphType=type;
  runtimeState.morph.renderSourceLayers=[from];runtimeState.morph.renderTargetLayers=[to];runtimeState.morph.active=true;
  const p=__somataSpiralMorphCpuPlan(0),progress=[0,.25,.5,.75,1].map(t=>WebGPUSpiralBezierMorphRenderer.debugCarrierMappedPlan(0,t));
  const eq=(a,b)=>a.length===b.length&&a.every((v,i)=>Math.abs(v-b[i])<.0001);
  const src=p.auxPairs.map(v=>v.sourcePresent),dst=p.auxPairs.map(v=>v.targetPresent);
  const debug=progress[2];const pure=debug.sourcePaths?.every((path,i)=>path.every((q,j)=>{
   const dest=debug.targetPaths[i][j];return Math.hypot(q.p0.x-dest.p0.x,q.p0.y-dest.p0.y,q.p3.x-dest.p3.x,q.p3.y-dest.p3.y)<.0001; }));
  reports.push({type,axes,paths:p.pathCount,src,dst,pure,closed:p.allClosed,periodic:p.cpuPathClosure?Array.from({length:p.pathCount},(_,i)=>p.cpuPathClosure[i*8+4]>.5||p.cpuPathClosure[i*8+5]>.5).some(Boolean):null,carrier:p.carrierMapped,overflow:progress.some(x=>x.carrierOverflow===true),finite:progress.every(x=>x.packed?.every(Number.isFinite)!==false),visualMid:progress[2].branchPresence.reduce((x,y)=>x+y,0),uniqueS:new Set(p.auxPairs.filter(q=>q.sourcePresent).map(q=>q.sourceBranchIndex)).size,uniqueD:new Set(p.auxPairs.filter(q=>q.targetPresent).map(q=>q.targetBranchIndex)).size,sourceCount:src.filter(Boolean).length,targetCount:dst.filter(Boolean).length});
 }
 const animate=[];for(const type of ['continuous','phase','minimalTurn'])for(const axis of ['N','K']){
  const source=mk('animation',16,1);source.testMorph={enabled:true,spiralType:type,spiralTypeExplicit:true,mode:'circleSlide',duration:1};state.layers=[source];state.activeLayerId=source.id;
  SomataTestMorph.updateTask();const visual={...source},ctx={layer:visual,sourceLayer:source,layerIndex:0},now=performance.now();
  source[axis]+=2;SomataTestMorph.applyFrame(ctx,now);SomataTestMorph.applyFrame(ctx,now+250);const st=SomataTestMorph.status();
  animate.push({type,axis,alpha:visual.opacity,fade:st.last?.axisNeedsFade,intermediary:st.last?.angularSpiralEdit});
  SomataTestMorph.applyFrame(ctx,now+1100);
 }
 return {capped,reports,animate};
 })()`,{timeoutMs:22000,label:'13.0.24 true fade and forced-step contracts'});
 console.log("DEBUG",JSON.stringify(data.reports.map(q=>({type:q.type,axes:q.axes,paths:q.paths,pure:q.pure,closed:q.closed,carrier:q.carrier,src:q.src.slice(0,3),dst:q.dst.slice(0,3)}))));
 for(const q of data.capped){assert(q.finite);assert(q.eff<=Math.max(1,Math.floor(q.n/2)),`invalid effective K for N ${q.n} K ${q.k}: ${q.eff}`);}
 for(const q of data.reports){assert(!q.overflow&&q.finite,`${q.type} ${q.axes} overflow`);
  if(q.type==='continuous'){
   assert(q.pure,`fixed N/K moves geometry when ${q.axes} edited`);
   assert(!q.carrier,`fixed N/K should not rebuild GPU carrier`);
   assert(q.src.every((yes,i)=>yes!==q.dst[i]),`fixed N/K rail present at both endpoints`);
  }
  if(q.type==='phase'&&q.axes!=='K'){assert(q.src.some(x=>!x)&&q.dst.some(x=>!x),`fixed N fade missing ${q.axes}`);assert(!q.carrier);}
  if(q.type==='minimalTurn'&&q.axes!=='N'){assert(q.src.some(x=>!x)&&q.dst.some(x=>!x),`fixed K fade missing ${q.axes}`);assert(!q.carrier);}
  if(q.type==='torn'){
   assert.equal(q.uniqueS,q.sourceCount,`torn source clone ${q.axes}`);assert.equal(q.uniqueD,q.targetCount,`torn target clone ${q.axes}`);
   assert(!q.closed,`torn forcibly closed ${q.axes}`);assert(!q.periodic,`torn periodic bridge ${q.axes}`);
  }
 }
 for(const q of data.animate){const should=q.type==='continuous'||(q.type==='phase'&&q.axis==='N')||(q.type==='minimalTurn'&&q.axis==='K');assert.equal(q.fade,should);if(should){assert(q.alpha<100,`no local fade ${q.type}/${q.axis}`);assert.equal(q.intermediary,false);}}
 assert.deepEqual(uncaughtExceptions(h.events),[]);
 console.log('PASS Somata 13.0.24',JSON.stringify({stepCases:data.capped.length,modeCases:data.reports.map(q=>({type:q.type,axis:q.axes,paths:q.paths,pure:q.pure,carrier:q.carrier,closed:q.closed,mid:q.visualMid})),localAnimations:data.animate}));
 }finally{await h.close()}
})().catch(err=>{console.error('FAIL 13.0.24 contract',err.stack||err);process.exitCode=1});
