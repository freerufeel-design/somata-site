'use strict';
// A joined continuous Spiral animates the extra join handles as part of the
// prepared Bézier pair; the target must already be the real final curve.
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:100,evalTimeoutMs:45000});
 try{
  const values=await h.evaluate(`(()=>{
    const save={layers:state.layers,src:runtimeState.morph.renderSourceLayers,dst:runtimeState.morph.renderTargetLayers,mode:state.morph.spiralMorphType,transition:state.morph.profileModeTransition,span:state.morph.profileModeTransitionPercent};
    const flat=paths=>(paths||[]).flatMap(p=>p.flatMap(c=>[c.p0.x,c.p0.y,c.c1.x,c.c1.y,c.c2.x,c.c2.y,c.p3.x,c.p3.y]));
    const diff=(a,b)=>a.length===b.length?a.reduce((m,x,i)=>Math.max(m,Math.abs(x-b[i])),0):Infinity;
    const results=[];
    try{
      state.morph.spiralMorphType='continuous';state.morph.profileModeTransitionPercent=35;
      for(const profileMode of ['segments','spline'])for(const rounding of [0,55]){
        const a=createLayer('joined-source'),b=createLayer('joined-target');
        Object.assign(a,{N:8,K:3,spiralOrder:2.1,spiralEnabled:true,spiralClosed:true,spiralJoinInterpolation:true,spiralRoundSeams:true,radius:220,profileMode,rounding,
          profileNodes:[{x:0,y:0},{x:.32,y:-.45},{x:.62,y:.25},{x:1,y:0}]});
        Object.assign(b,a,{spiralOrder:3.2,rotation:17,radius:260,
          profileNodes:[{x:0,y:0},{x:.20,y:.39},{x:.76,y:-.33},{x:1,y:0}]});
        state.layers=[a];runtimeState.morph.renderSourceLayers=[a];runtimeState.morph.renderTargetLayers=[b];
        state.morph.profileModeTransition='phase';
        const start=WebGPUSpiralBezierMorphRenderer.debugCarrierMappedPlan(0,0),end=WebGPUSpiralBezierMorphRenderer.debugCarrierMappedPlan(0,1),near=WebGPUSpiralBezierMorphRenderer.debugCarrierMappedPlan(0,.99999);
        const resource=WebGPUSpiralBezierMorphRenderer.debugBuildCpuResource(0),rec=resource.carrierRecords[0];
        const plainDifferent=rec.plainSc&&rec.plainDc ? Math.max(diff(flat([rec.plainSc]),flat([rec.sc])),diff(flat([rec.plainDc]),flat([rec.dc]))):0;
        const modes={};for(const mode of ['phase','start','end']){
          state.morph.profileModeTransition=mode;
          modes[mode]=WebGPUSpiralBezierMorphRenderer.debugCarrierMappedPlan(0,.25);
        }
        results.push({profileMode,rounding,mapped:start.carrierMapped,joined:start.joinedProfileMorph,
          startDiff:diff(flat(start.paths),flat(start.sourcePaths)),endDiff:diff(flat(end.paths),flat(end.targetPaths)),
          nearEnd:diff(flat(near.paths),flat(end.paths)),plainDifferent,modeDifference:diff(flat(modes.start.paths),flat(modes.end.paths)),
          finite:Object.values(modes).every(m=>flat(m.paths).every(Number.isFinite))});
      }
      return results;
    }finally{state.layers=save.layers;runtimeState.morph.renderSourceLayers=save.src;runtimeState.morph.renderTargetLayers=save.dst;state.morph.spiralMorphType=save.mode;state.morph.profileModeTransition=save.transition;state.morph.profileModeTransitionPercent=save.span;}
  })()`,{label:'continuous joined spiral targets and curvature timeline'});
  assert.equal(values.length,4);
  for(const v of values){
    assert(v.mapped,'joined Spiral must prepare ordinary and joined rail endpoints: '+JSON.stringify(v));

    assert(v.startDiff<1e-7&&v.endDiff<1e-7,'a joined endpoint was recomputed instead of preserved: '+JSON.stringify(v));
    assert(v.nearEnd<.25,'joined Morph does not converge to its exact target: '+JSON.stringify(v));
    assert(v.modeDifference>1e-3&&v.finite,'profile transition schedule did not change real join controls: '+JSON.stringify(v));
  }
  assert(values.some(v=>v.joined&&v.plainDifferent>1e-3),'no actual joined geometry difference exercised');
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS v10443: 4 continuous Spiral pairs verify optional joined Bézier handles, exact first/final curves, smooth terminal approach, and authored curvature timeline');
 }finally{await h.close();}
})().catch(e=>{console.error('FAIL v10443',e.stack||e);process.exitCode=1;});
