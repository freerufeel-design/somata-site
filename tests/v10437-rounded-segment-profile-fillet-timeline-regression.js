'use strict';
// A rounded segments Spiral contains local fillet pieces inserted around authored
// corners. Non-torn Morph must interpolate those FINAL baked Bézier handles on
// the existing Whole/Start/End Profile Mode clock. No intermediate fillet rebuild.
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:120,evalTimeoutMs:45000});
 try{
  const results=await h.evaluate(`(()=>{
   const save={layers:state.layers,src:runtimeState.morph.renderSourceLayers,dst:runtimeState.morph.renderTargetLayers,
     transport:state.morph.spiralMorphType,mode:state.morph.profileModeTransition,
     percent:state.morph.profileModeTransitionPercent,fourier:state.fourierMode};
   const original=window.__spiroBuildSpiralCarrierPath;
   let rebuilds=0;
   const flatten=p=>(p||[]).flatMap(q=>[q.p0.x,q.p0.y,q.c1.x,q.c1.y,q.c2.x,q.c2.y,q.p3.x,q.p3.y]);
   const difference=(a,b)=>a.length===b.length?a.reduce((m,x,i)=>Math.max(m,Math.abs(x-b[i])),0):Infinity;
   const out=[];
   try{
    window.__spiroBuildSpiralCarrierPath=function(...a){rebuilds++;return original.apply(this,a);};
    state.fourierMode=false;state.morph.profileModeTransitionPercent=30;
    for(const transport of ['continuous','phaseCircle','torn']){
     for(const pairRound of [[0,0],[0,58],[58,0],[58,58]]){
      const rounded=pairRound[0]>0||pairRound[1]>0;
      const a=createLayer('fillet-a'),b=createLayer('fillet-b');
      Object.assign(a,{N:7,K:2,radius:245,rotation:0,spiralEnabled:true,spiralOrder:2,
       spiralClosed:true,spiralRoundSeams:true,spiralJoinInterpolation:true,spiralTangential:false,profileMode:'segments',
       rounding:pairRound[0],profileNodes:[{x:0,y:0},{x:.16,y:.42},{x:.48,y:-.32},{x:.77,y:.23},{x:1,y:0}]});
      Object.assign(b,a,{radius:245,spiralOrder:2.4,rounding:pairRound[1],
       profileNodes:[{x:0,y:0},{x:.12,y:-.32},{x:.4,y:.5},{x:.62,y:-.25},{x:1,y:0}]});
      state.layers=[a];runtimeState.morph.renderSourceLayers=[a];runtimeState.morph.renderTargetLayers=[b];
      state.morph.spiralMorphType=transport;
      const paths={};let generated=0;
      for(const mode of ['phase','start','end']){
       state.morph.profileModeTransition=mode;
       const start=WebGPUSpiralBezierMorphRenderer.debugCarrierMappedPlan(0,0);
       const finish=WebGPUSpiralBezierMorphRenderer.debugCarrierMappedPlan(0,1);
       const base=rebuilds;
       const frames=[.25,.48,.75,.98,.9999].map(t=>WebGPUSpiralBezierMorphRenderer.debugCarrierMappedPlan(0,t));
       generated+=rebuilds-base;
       const seamError=frames.reduce((max,plan)=>{
        const q=plan?.paths?.[0],f=plan?.carrierFrames?.[0];
        if(!q?.length||!f)return Infinity;
        const p=q[0].p0,e=q[q.length-1].p3,a=f.delta,k=f.targetScale;
        return Math.max(max,Math.hypot(e.x-(p.x*Math.cos(a)-p.y*Math.sin(a))*k,
          e.y-(p.x*Math.sin(a)+p.y*Math.cos(a))*k));
       },0);
       paths[mode]={seamError,start:flatten(start?.paths?.[0]),finish:flatten(finish?.paths?.[0]),
        middle:flatten(frames[1]?.paths?.[0]),near:flatten(frames.at(-1)?.paths?.[0]),
        counts:frames.map(f=>f?.paths?.[0]?.length||0),
        prepared:frames.every(f=>f?.preparedContinuousSplineRail===true),
        roundedRail:frames.every(f=>f?.preparedRoundedProfileRail===true),
        mapped:frames.every(f=>f?.carrierMapped===true),
        overflow:frames.some(f=>f?.carrierOverflow===true)};
      }
      const x=paths;
      out.push({transport,rounded,sourceRound:pairRound[0],targetRound:pairRound[1],rebuilds:generated,
       prepared:x.phase.prepared,roundedRail:x.phase.roundedRail,mapped:x.phase.mapped,
       overflow:x.phase.overflow,counts:x.phase.counts,seamError:x.phase.seamError,
       modeDifference:difference(x.start.middle,x.end.middle),
       sourceParity:difference(x.start.start,x.end.start),targetParity:difference(x.start.finish,x.end.finish),
       terminalDistance:difference(x.phase.near,x.phase.finish),
       fullPhaseNear:difference(x.start.near,x.end.near),
       endpointCount:x.phase.finish.length});
     }
    }
   }finally{
    window.__spiroBuildSpiralCarrierPath=original;
    state.layers=save.layers;runtimeState.morph.renderSourceLayers=save.src;
    runtimeState.morph.renderTargetLayers=save.dst;state.morph.spiralMorphType=save.transport;
    state.morph.profileModeTransition=save.mode;state.morph.profileModeTransitionPercent=save.percent;state.fourierMode=save.fourier;
   }
   return out;
  })()`,{label:'baked local fillet Bézier controls obey real profile timeline'});
  for(const r of results){
   if(r.transport==='torn'){
    assert(!r.mapped&&!r.prepared,'torn must retain existing discontinuous transport: '+JSON.stringify(r));continue;
   }
   assert(r.mapped&&!r.overflow&&r.endpointCount>16,'missing Spiral retained control rail: '+JSON.stringify(r));
   assert(r.sourceParity<1e-7&&r.targetParity<1e-7,'author timing changed endpoint shape: '+JSON.stringify(r));
   if(r.rounded){
    assert(r.prepared&&r.roundedRail,'fillets not part of phase-owned Bézier pair: '+JSON.stringify(r));
    assert.equal(r.rebuilds,0,'intermediate profile regenerated local fillets: '+JSON.stringify(r));
    assert(r.counts.every(n=>n>2&&n===r.counts[0]),'cubic topology changed inside a phase: '+JSON.stringify(r));
    assert(r.modeDifference>0.25,'Whole/Start/End did not affect rounded corner handles: '+JSON.stringify(r));
    assert(r.seamError<1e-4,'prepared fillet rail breaks Spiral/Corridor periodic seam: '+JSON.stringify(r));
    assert(r.terminalDistance<1,'rounded rail jumps near the final frame: '+JSON.stringify(r));
   }else{
    assert(r.prepared&&!r.roundedRail,'full Bézier mode must prepare even unrounded segments, without inventing fillets: '+JSON.stringify(r));
    assert.equal(r.rebuilds,0,'full Bézier mode rebuilt unrounded profiles in intermediate frames');
   }
  }
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS v10437: authored Spiral corner fillets are phase-owned; rounding follows Whole/Start/End without terminal rebuild (torn and unrounded unchanged)');
 }finally{await h.close();}
})().catch(e=>{console.error('FAIL v10437',e.stack||e);process.exitCode=1;});
