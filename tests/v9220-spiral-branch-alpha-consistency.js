'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{const h=await createBrowserHarness({disableGpu:true,loadDelayMs:70,evalTimeoutMs:30000});try{
 const result=await h.evaluate(`(()=>{
   const cases=[];
   for(const [n1,n2] of [[2,3],[3,4],[4,5],[5,3]]){
      const a=createLayer('from');Object.assign(a,{N:n1,K:1,spiralEnabled:true,spiralOrder:1,spiralClosed:false,profileMode:'segments',profileNodes:[{x:0,y:0},{x:.3,y:.07},{x:1,y:0}]});
      const b={...a,id:'to',N:n2};state.layers=[a];state.morph.mode='circleSlide';state.morph.spiralMorphType='phaseCircle';runtimeState.morph.active=true;runtimeState.morph.renderSourceLayers=[a];runtimeState.morph.renderTargetLayers=[b];
      const rows=[];
      for(const t of [0,.01,.25,.49,.5,.51,.75,.99,1]){
          runtimeState.morph.geometryT=t;const p=__somataSpiralCarrierMorphPlan(0,t);
          rows.push({t,pathCount:p?.pathCount,overflow:p?.carrierOverflow,branchPresence:p?.branchPresence,phase:p?.carrierFrames?.map(f=>f.delta),visible:p?.paths?.length});
      }
      cases.push({n1,n2,rows});
   }runtimeState.morph.active=false;return cases;
 })()`,{timeoutMs:29000,label:'N 2–5 exact carrier and branch visibility'});
 for(const test of result){
   let faded=0;
   for(const row of test.rows){
     assert(row.visible>0&&!row.overflow,JSON.stringify({test,row}));
     assert.equal(row.branchPresence.length,row.visible);
     for(const p of row.branchPresence){assert(Number.isFinite(p)&&p>=0&&p<=1,JSON.stringify({test,row}));if(p>0&&p<1)faded++;}
     for(const phase of row.phase)assert(Math.abs(phase-2*Math.PI/(test.n1+(test.n2-test.n1)*row.t))<1e-8,'phase must continuously change');
   }
   if(test.n1!==test.n2)assert(faded>0,'split/merge needs intermediate alpha '+JSON.stringify(test));
 }
 assert.equal(uncaughtExceptions(h.events).length,0);
 console.log('PASS: N2→3, N3→4, N4→5 and N5→3 carrier phases and GPU/auxiliary presence',result.map(r=>r.n1+'→'+r.n2).join(', '));
}finally{await h.close();}})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
