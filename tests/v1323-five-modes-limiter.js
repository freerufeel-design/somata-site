'use strict';
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=require('node:assert/strict');
(async()=>{
const h=await createBrowserHarness({disableGpu:true,loadDelayMs:150,evalTimeoutMs:20000});
try{
const got=await h.evaluate(`(()=>{
    const mk=(name,N,K)=>{const l=createLayer(name);Object.assign(l,{spiralEnabled:true,spiralOrder:1,spiralClosed:true,N,K,
      spiralStep:K,spiralStepLinked:true,spiralStepLimiterEnabled:true,spiralStepLimiter:2,customSuborbits:null,radius:220,rotation:0,
      profileMode:'segments',profileNodes:[{x:0,y:0},{x:1,y:0}]});return l;};
    const paths={};for(const k of [1,2,3,4,5,6,7,8]){const x=mk('K'+k,20,k);const ps=buildOrbitPolylines(x);paths[k]={count:ps.length, effective:getEffectiveSpiralStep(x),ids:ps.map(p=>p.spiralBranchIndex).sort((a,b)=>a-b),geom:ps.map(p=>p.points.map(q=>[Math.round(q.x*100),Math.round(q.y*100)]))};}
    const plans=[];for(const type of ['torn','continuous','phase','minimalTurn','phaseCircle']){
      for(const [sn,sk,dn,dk] of [[20,3,20,4],[20,1,20,2],[20,4,20,5],[18,3,20,4]]){
        const a=mk('s',sn,sk),b=mk('d',dn,dk);state.layers=[a];state.activeLayerId=a.id;state.morph.mode='circleSlide';state.morph.spiralMorphType=type;
        runtimeState.morph.renderSourceLayers=[a];runtimeState.morph.renderTargetLayers=[b];runtimeState.morph.active=true;
        const r=__somataSpiralMorphCpuPlan(0);if(!r){plans.push({type,sn,sk,dn,dk,error:'null'});continue;}
        const pairs=r.auxPairs.map(p=>({from:p.sourcePresent,to:p.targetPresent,si:p.sourceBranchIndex,di:p.targetBranchIndex}));
        plans.push({type,sn,sk,dn,dk,paths:r.pathCount,split:r.topologyMergeSplitCount,carrier:r.carrierMapped,pairs,
          maxSeg:r.cubicCount,originN:r.sourceLayer.N,targetN:r.targetLayer.N});
      }
    }
    const opts=[...document.getElementById('testMorphSpiralSlide').options].map(o=>o.value);
    return {paths,plans,opts};
})()`,{timeoutMs:20000,label:'13.0.23 cyclic K topology, fade N/K axes and torn pairing'});
for(const k of [1,2,3,4,5,6,7,8])assert.equal(got.paths[k].count,20,`K=${k} must have exactly 20 contours`);
for(const [a,b] of [[1,3],[2,4],[1,5],[2,6]]){
 assert.deepEqual(got.paths[a].ids,got.paths[b].ids,`K ${a}/${b} branch IDs`);
 assert.deepEqual(got.paths[a].geom,got.paths[b].geom,`K ${a}/${b} visible geometry`);
}
for(const x of got.plans){assert(!x.error,`${x.type} failed ${x.sn}/${x.sk}=>${x.dn}/${x.dk}`);if(x.type==='torn'){
 assert.equal(new Set(x.pairs.filter(p=>p.from).map(p=>p.si)).size,x.pairs.filter(p=>p.from).length,'torn source clone');
 assert.equal(new Set(x.pairs.filter(p=>p.to).map(p=>p.di)).size,x.pairs.filter(p=>p.to).length,'torn destination clone');
}}
for(const type of ['continuous','phase','minimalTurn']){
 const x=got.plans.find(p=>p.type===type&&p.sn===18&&p.sk===3);
 assert(x.split>0,`${type} mixed N/K should crossfade its fixed axis`);
}
assert.deepEqual(got.opts,['torn','continuous','phase','minimalTurn','phaseCircle']);
assert.deepEqual(uncaughtExceptions(h.events),[]);
console.log('PASS 13.0.23 five modes and cyclic geometry',JSON.stringify({cyclicCounts:Object.fromEntries(Object.entries(got.paths).map(([k,x])=>[k,x.count])),plans:got.plans.map(({pairs,...rest})=>({...rest,fadeOut:pairs.filter(p=>p.from&&!p.to).length,fadeIn:pairs.filter(p=>!p.from&&p.to).length}))}));
}finally{await h.close()}
})().catch(err=>{console.error('FAIL 13.0.23',err.stack||err);process.exitCode=1;});
