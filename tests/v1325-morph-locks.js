'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
const h=await createBrowserHarness({disableGpu:true,loadDelayMs:80,evalTimeoutMs:12000});
try{
 const reports=await h.evaluate(`(()=>{
 const results=[];
 for(const type of ['continuous','phase','minimalTurn','phaseCircle','torn']){
   const l=createLayer('Spiral');Object.assign(l,{N:20,K:10,spiralOrder:1,spiralEnabled:true,spiralStepLimiterEnabled:true,spiralStepLimiter:2,profileMode:'segments',profileNodes:[{x:0,y:0},{x:1,y:0}],customSuborbits:null});
   state.layers=[l];state.activeLayerId=l.id;state.morph.spiralMorphType=type;state.morph.options.byVertices=true;state.morph.options.bySteps=true;state.morph.options.byShape=false;
   const ctrl=(id,val)=>{const e=document.getElementById(id);if(e)e.value=val;};
   ctrl('morphVertexMin',8);ctrl('morphVertexMax',8);ctrl('morphStepMin',100);ctrl('morphStepMax',100);
   document.getElementById('btnMorph').click();
   const s=runtimeState.morph.sourceVisuals?.[0],d=runtimeState.morph.targetVisuals?.[0];
   results.push({type,source:{N:s?.N,K:s?.K},target:{N:d?.N,K:d?.K},active:runtimeState.morph.active});
   document.getElementById('btnMorph').click();
 }
 return results;
})()`,{timeoutMs:12000});
 console.log('MORPH',JSON.stringify(reports));
 for(const q of reports){assert(q.active,'morph not started');assert(q.source.N===20&&q.source.K===10);
  if(q.type==='continuous')assert.deepEqual(q.target,q.source,`fixed NK ${JSON.stringify(q)}`);
  if(q.type==='phase')assert.equal(q.target.N,20,`fixed N ${JSON.stringify(q)}`);
  if(q.type==='minimalTurn')assert.equal(q.target.K,10,`fixed K ${JSON.stringify(q)}`);
  if(q.type==='minimalTurn')assert(q.target.N>=20,`target N must not force reduction of fixed maximum K`);
 }
 assert.deepEqual(uncaughtExceptions(h.events),[]);console.log('PASS 13.0.25 automatic Morph axis locks');
}finally{await h.close()}
})().catch(e=>{console.error('FAIL',e.stack||e);process.exitCode=1});
