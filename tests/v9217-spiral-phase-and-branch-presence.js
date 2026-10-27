'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:150,evalTimeoutMs:20000});
 try{
  const out=await h.evaluate(`(()=>{
    const mk=(name,n,k,order)=>{const l=createLayer(name);Object.assign(l,{spiralEnabled:true,spiralClosed:true,spiralTangential:true,spiralOrder:order,N:n,K:k,spiralStep:k,spiralStepLinked:true,rotation:22,radius:220,profileMode:'segments',profileNodes:[{x:0,y:0},{x:.3,y:.15},{x:.75,y:-.1},{x:1,y:0}]});return l;};
    const cases=[
      {name:'fractional same sign',a:[8,1,.2],b:[8,2,.8]},
      {name:'step K from 1 to 3',a:[8,1,2],b:[8,3,3]},
      {name:'reverse order',a:[8,2,-2],b:[8,3,2]},
      {name:'N and K',a:[7,1,1],b:[10,2,1]},
      {name:'suborbits K 2',a:[8,2,2],b:[8,3,2]}
    ];
    state.tunnel.active=true;state.morph.mode='circleSlide';const results=[];
    for(const c of cases){
      const s=mk('verify-'+c.name,...c.a),d=mk('target-'+c.name,...c.b);state.layers=[s];state.activeLayerId=s.id;state.morph.spiralMorphType='phaseCircle';
      runtimeState.morph.renderSourceLayers=[s];runtimeState.morph.renderTargetLayers=[d];runtimeState.morph.active=true;
      const phases=[];for(const t of Array.from({length:101},(_,i)=>i/100)){
        runtimeState.morph.geometryT=t;runtimeState.morph.progress=t;
        const plan=__somataSpiralCarrierMorphPlan(0,t);const carrier=plan?.carrierFrames?.[0];
        const delta=getMotionTunnelLagRadians({copyId:1},s)-getMotionTunnelLagRadians({copyId:0},s);
        phases.push({t,delta,carrier:carrier?.delta,hasCarrier:!!carrier,overflow:plan?.carrierOverflow});
      }
      runtimeState.morph.active=false;
      const staticEnd=getMotionTunnelLagRadians({copyId:1},d)-getMotionTunnelLagRadians({copyId:0},d);
      results.push({name:c.name,phases,staticEnd});
    }
    // A transition with more destinations than sources must not draw its
    // duplicate source rails fully opaque from t=0.
    const s=mk('clone-s',7,1,1),d=mk('clone-d',12,2,1);state.layers=[s];state.activeLayerId=s.id;runtimeState.morph.renderSourceLayers=[s];runtimeState.morph.renderTargetLayers=[d];runtimeState.morph.active=true;
    const plan=__somataSpiralMorphCpuPlan(0);const F=24;const presences=[];
    for(let pi=0;pi<plan.pathCount;pi++){const i=plan.cpuPathSegmentRanges[pi*4];presences.push([plan.data[i*F+20],plan.data[i*F+21]]);}
    runtimeState.morph.active=false;
    return {results,clone:{paths:plan.pathCount,split:plan.topologyMergeSplitCount,presences}};
  })()`,{timeoutMs:19000,label:'9.2.17 real carrier phase and presence'});
  for(const row of out.results){
   for(const x of row.phases){assert(x.hasCarrier&& !x.overflow,`${row.name}: no carrier ${x.t}`);assert(Math.abs(x.delta-x.carrier)<1e-8,`${row.name}: Corridor ${x.delta} vs carrier ${x.carrier} at ${x.t}`);}
   const last=row.phases.at(-1);assert(Math.abs(last.delta-row.staticEnd)<1e-8,`${row.name}: phase snap ${last.delta-row.staticEnd}`);
   for(let i=1;i<row.phases.length;i++)assert(Math.abs(row.phases[i].delta-row.phases[i-1].delta)<.2,`${row.name}: unexpected phase jump`);
  }
  assert(out.clone.split>0,'No branch split');
  assert(out.clone.presences.some(([a,b])=>a===0&&b===1),'New branch is incorrectly opaque at start');
  assert(out.clone.presences.some(([a,b])=>a===1&&b===1),'Matched branch disappeared');
  assert.equal(uncaughtExceptions(h.events).length,0,'Browser exceptions');
  console.log('PASS 9.2.17 carrier/Corridor phase and split presence',JSON.stringify({cases:out.results.map(x=>({name:x.name,endPhase:x.staticEnd})),clone:out.clone}));
 }finally{await h.close();}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
