'use strict';
const assert=require('node:assert/strict');const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{const h=await createBrowserHarness({disableGpu:true,loadDelayMs:80,evalTimeoutMs:11000});try{
 const d=await h.evaluate(`(()=>{const results=[];for(const mode of ['phase','minimalTurn','continuous']){
 const l=createLayer('Spiral');Object.assign(l,{N:20,K:1,spiralOrder:1,spiralEnabled:true,spiralStepLimiterEnabled:true,spiralStepLimiter:2,profileMode:'segments',profileNodes:[{x:0,y:0},{x:1,y:0}],customSuborbits:null});
 state.layers=[l];state.activeLayerId=l.id;state.morph.spiralMorphType=mode;state.morph.options.byVertices=true;state.morph.options.bySteps=true;state.morph.options.byShape=false;
 const set=(id,val)=>document.getElementById(id).value=String(val);
 set('morphVertexMin',8);set('morphVertexMax',8);set('morphStepMin',100);set('morphStepMax',100);
 document.getElementById('btnMorph').click();const a=runtimeState.morph.sourceVisuals[0],b=runtimeState.morph.targetVisuals[0];results.push({mode,from:{N:a.N,K:a.K},to:{N:b.N,K:b.K}});document.getElementById('btnMorph').click();
 }return results;})()`,{timeoutMs:11000});
 for(const q of d){
 if(q.mode==='continuous')assert.deepEqual(q.to,q.from);
 if(q.mode==='phase'){assert.equal(q.to.N,q.from.N);assert(q.to.K>q.from.K,JSON.stringify(q));}
 if(q.mode==='minimalTurn'){assert(q.to.N<q.from.N,JSON.stringify(q));assert.equal(q.to.K,q.from.K);}
 }
 assert.deepEqual(uncaughtExceptions(h.events),[]);console.log('PASS free axis in Morph, locks untouched',JSON.stringify(d));
}finally{await h.close()}})().catch(e=>{console.error('FAIL',e.stack||e);process.exitCode=1});
