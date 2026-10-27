'use strict';
// A closed continuous Spiral must progressively introduce its periodic
// carrier correction under the authored profile transition schedule.
// An open spiral and a closed spiral with joins OFF must remain identical.
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:100,evalTimeoutMs:45000});
 try{
  const data=await h.evaluate(`(()=>{
    const saved={layers:state.layers,source:runtimeState.morph.renderSourceLayers,
      target:runtimeState.morph.renderTargetLayers,transport:state.morph.spiralMorphType,
      transition:state.morph.profileModeTransition,percent:state.morph.profileModeTransitionPercent};
    const results=[];
    const coords=paths=>(paths||[]).flatMap(p=>p.flatMap(q=>[q.p0.x,q.p0.y,q.c1.x,q.c1.y,q.c2.x,q.c2.y,q.p3.x,q.p3.y]));
    const maxDiff=(a,b)=>a.length!==b.length?Infinity:a.reduce((m,v,i)=>Math.max(m,Math.abs(v-b[i])),0);
    const seamError=plan=>{
      const c=plan.paths?.[0],f=plan.carrierFrames?.[0];if(!c?.length||!f)return Infinity;
      const p=c[0].p0,last=c[c.length-1].p3,co=Math.cos(f.delta),si=Math.sin(f.delta);
      return Math.hypot(last.x-(p.x*co-p.y*si)*f.targetScale,last.y-(p.y*co+p.x*si)*f.targetScale);
    };
    try{
      const source=createLayer('smooth-seam-source'),target=createLayer('smooth-seam-target');
      Object.assign(source,{N:7,K:3,spiralEnabled:true,spiralOrder:2.3,spiralClosed:true,
        spiralJoinInterpolation:true,spiralRoundSeams:true,rounding:48,profileMode:'segments',
        profileNodes:[{x:0,y:0},{x:.24,y:-.43},{x:.57,y:.34},{x:1,y:0}]});
      Object.assign(target,source,{N:9,K:4,spiralOrder:3.1,radius:255,rounding:68,
        profileNodes:[{x:0,y:0},{x:.30,y:.30},{x:.70,y:-.40},{x:1,y:0}]});
      state.layers=[source];runtimeState.morph.renderSourceLayers=[source];
      runtimeState.morph.renderTargetLayers=[target];state.morph.spiralMorphType='continuous';
      state.morph.profileModeTransitionPercent=20;
      const sample=(mode,t,closed=true,join=true)=>{
        state.morph.profileModeTransition=mode;
        source.spiralClosed=closed;target.spiralClosed=closed;
        source.spiralJoinInterpolation=join;target.spiralJoinInterpolation=join;
        return WebGPUSpiralBezierMorphRenderer.debugCarrierMappedPlan(0,t);
      };
      for(const t of [0,.1,.5,.9,.99,.9999,1]){
        const modes={};for(const mode of ['phase','start','end']){
          const plan=sample(mode,t);
          // Measure ONLY the periodic closure correction, after subtracting
          // ordinary handle morphing.  Otherwise the test can pass even if
          // closure strength ignores the selected profile timeline.
          const rec=WebGPUSpiralBezierMorphRenderer.debugBuildCpuResource(0).carrierRecords[0];
          const cub=plan.paths[0],j=Math.max(1,Math.floor(rec.sc.length/2)),a=rec.sc[j],b=rec.dc[j],
            u=t,h=profileModeTransitionProgress(t),rawP0={x:a.p0.x+(b.p0.x-a.p0.x)*u,y:a.p0.y+(b.p0.y-a.p0.y)*u};
          const aa=rec.sc[0],bb=rec.dc[0],al=rec.sc[rec.sc.length-1],bl=rec.dc[rec.dc.length-1],
            start={x:aa.p0.x+(bb.p0.x-aa.p0.x)*u,y:aa.p0.y+(bb.p0.y-aa.p0.y)*u},
            end={x:al.p3.x+(bl.p3.x-al.p3.x)*u,y:al.p3.y+(bl.p3.y-al.p3.y)*u},
            f=plan.carrierFrames[0],ex={x:(Math.cos(f.delta)*start.x-Math.sin(f.delta)*start.y)*f.targetScale,
              y:(Math.sin(f.delta)*start.x+Math.cos(f.delta)*start.y)*f.targetScale},
            dx=ex.x-end.x,dy=ex.y-end.y,err2=dx*dx+dy*dy,
            observed=err2>1e-8?((cub[j].p0.x-rawP0.x)*dx+(cub[j].p0.y-rawP0.y)*dy)/err2:null,
            fraction=rec.knotFractions[j],smooth=fraction*fraction*(3-2*fraction);
          modes[mode]={c:coords(plan.paths),e:seamError(plan),segments:plan.cubicCount,
            prepared:plan.preparedContinuousSplineRail,closureWeight:observed,
            rawClosureDistance:Math.sqrt(err2),fraction,smooth,h};
        }
        const off=sample('phase',t,true,false),open=sample('phase',t,false,false);
        results.push({t,modes,off:coords(off.paths),open:coords(open.paths)});
      }
      return results;
    }finally{state.layers=saved.layers;runtimeState.morph.renderSourceLayers=saved.source;
      runtimeState.morph.renderTargetLayers=saved.target;state.morph.spiralMorphType=saved.transport;
      state.morph.profileModeTransition=saved.transition;state.morph.profileModeTransitionPercent=saved.percent;}
  })()`,{label:'real continuous Spiral seam interpolation'});
  assert.equal(data.length,7);
  const diff=(a,b)=>a.length!==b.length?Infinity:a.reduce((m,x,i)=>Math.max(m,Math.abs(x-b[i])),0);
  for(const row of data){
    assert(row.modes.phase.prepared,'not in the real prepared Bézier render path');
    assert.equal(row.modes.phase.segments,row.modes.start.segments);
    assert.equal(row.modes.phase.segments,row.modes.end.segments);
    assert(diff(row.off,row.open)<1e-6,'unchecked closed differs from open at '+row.t);
    for(const mode of ['phase','start','end'])assert(row.modes[mode].c.every(Number.isFinite),'nonfinite curve at '+row.t);
  }
  for(const i of [0,data.length-1]){
    const r=data[i];assert(diff(r.modes.phase.c,r.modes.start.c)<1e-7,'source/target curve changed in start schedule');
    assert(diff(r.modes.phase.c,r.modes.end.c)<1e-7,'source/target curve changed in end schedule');
    assert(r.modes.phase.e<1e-5,'authored endpoint join was lost');
  }
  // Seam positions remain exact for ALL phase settings and intermediate t.
  // What changes gradually is the Bézier handle correction along the rail.
  for(const row of data)for(const mode of ['phase','start','end'])
    assert(row.modes[mode].e<1e-5,'periodic Spiral/Corridor seam opened: '+JSON.stringify({t:row.t,mode,error:row.modes[mode].e}));
  const mid=data[2];
  assert(diff(mid.modes.start.c,mid.modes.end.c)>1e-3,'timeline does not change visible Bézier controls');
  assert(mid.modes.start.rawClosureDistance>1e-3,'scenario does not exercise a phase-correction delta');
  assert(Math.abs(mid.modes.start.closureWeight-mid.modes.start.fraction)<1e-5,
    'Start phase must use the legacy completed join correction');
  assert(Math.abs(mid.modes.end.closureWeight-mid.modes.end.smooth)<1e-5,
    'End phase must leave the tangent distribution in its unrepaired shape at mid-phase');
  assert(Math.abs(mid.modes.phase.closureWeight-(mid.modes.start.fraction+mid.modes.end.smooth)/2)<1e-5,
    'Whole phase must mix both closure distributions continuously');
  const halfway=mid.modes.start.c.map((v,i)=>(v+mid.modes.end.c[i])/2);
  assert(diff(mid.modes.phase.c,halfway)<1e-5,
    'full phase should smoothly blend start- and end-shaped Bézier correction at t=0.5');
  const near=data[data.length-2],last=data[data.length-1];
  assert(diff(near.modes.phase.c,last.modes.phase.c)<5,'seam correction still snaps on last frame');
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS v10442: continuous Spiral join curvature changes on full/start/end timeline, with exact periodic seams and unchanged endpoints; OFF = open');
 }finally{await h.close();}
})().catch(e=>{console.error('FAIL v10442',e.stack||e);process.exitCode=1;});
