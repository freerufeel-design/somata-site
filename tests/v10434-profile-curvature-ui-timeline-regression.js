'use strict';
// The existing "Whole phase / Beginning / End" control must time the actual
// final Bézier curvature, even when BOTH endpoints are nonlinear spline profiles.
// Unlike the former regression this checks the visible Polygon cubic commands
// and the Spiral prepared render rail, not just the numeric progress function.
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:125,evalTimeoutMs:35000});
 try{
  const r=await h.evaluate(`(()=>{
   const save={layers:state.layers,source:runtimeState.morph.renderSourceLayers,
    target:runtimeState.morph.renderTargetLayers,transition:state.morph.profileModeTransition,
    percent:state.morph.profileModeTransitionPercent,spiralType:state.morph.spiralMorphType,
    fourier:state.fourierMode,active:runtimeState.morph.active,sourceGeometry:runtimeState.morph.sourceGeometry,targetGeometry:runtimeState.morph.targetGeometry,sourceProfiles:runtimeState.morph.sourceProfiles,targetProfiles:runtimeState.morph.targetProfiles,sourceVisuals:runtimeState.morph.sourceVisuals,targetVisuals:runtimeState.morph.targetVisuals,serial:runtimeState.morph.lampCycleSerial,mono:state.morph.monoOrbitTransforms};
   const out={polygon:{},spiral:{},progress:{}};
   const flat=q=>q.flatMap(c=>[c.p0.x,c.p0.y,c.c1.x,c.c1.y,c.c2.x,c.c2.y,c.p3.x,c.p3.y]);
   const diff=(a,b)=>a?.length===b?.length?a.reduce((m,x,i)=>Math.max(m,Math.abs(x-b[i])),0):Infinity;
   const polygon=(a,b,t)=>{
    const paths=buildCurrentMorphPaths(0,t);
    return paths.flatMap(p=>(p.points||[]).flatMap(q=>[q.x,q.y]));
   };
   const spiral=t=>{
    const data=WebGPUSpiralBezierMorphRenderer.debugCarrierMappedPlan(0,t);
    if(!data?.carrierMapped||!data?.preparedContinuousSplineRail)return null;
    return flat(data.paths[0]);
   };
   try{
    state.fourierMode=false;
    state.morph.spiralMorphType='phaseCircle';
    const a=createLayer('curve-schedule-src'),b=createLayer('curve-schedule-dst');
    Object.assign(a,{N:7,K:2,radius:220,rotation:0,spiralEnabled:false,
     spiralOrder:0,spiralClosed:true,closedLoop:true,chaosStar:false,rounding:55,profileMode:'spline',
     profileNodes:[{x:0,y:0},{x:.17,y:.4},{x:.5,y:-.2},{x:.7,y:.13},{x:1,y:0}]});
    Object.assign(b,a,{profileNodes:Array.from({length:8},(_,i)=>({x:i/7,y:i===0||i===7?0:Math.sin(i*2.4)*.3}))});
    state.morph.monoOrbitTransforms=false; runtimeState.morph.active=true;
    runtimeState.morph.sourceGeometry=[buildOrbitPolylines(a)];
    runtimeState.morph.targetGeometry=[buildOrbitPolylines(b)];
    runtimeState.morph.sourceProfiles=[{mode:'spline'}];
    runtimeState.morph.targetProfiles=[{mode:'spline'}];
    runtimeState.morph.sourceVisuals=[{spiralEnabled:false,rounding:55}];
    runtimeState.morph.targetVisuals=[{spiralEnabled:false,rounding:55}];
    runtimeState.morph.lampCycleSerial=12345678;
    state.morph.profileModeTransitionPercent=25;
    for(const mode of ['phase','start','end']){
     state.morph.profileModeTransition=mode;
     out.progress[mode]=[0,.35,.8,1].map(t=>profileModeTransitionProgress(t));
     state.layers=[a];runtimeState.morph.renderSourceLayers=[a];runtimeState.morph.renderTargetLayers=[b];
     out.polygon[mode]=[0,.35,.8,.99999,1].map(t=>polygon(a,b,t));
     a.spiralEnabled=true;b.spiralEnabled=true;a.spiralOrder=2;b.spiralOrder=2;
     out.spiral[mode]=[0,.35,.8,.99999,1].map(t=>spiral(t));
     a.spiralEnabled=false;b.spiralEnabled=false;a.spiralOrder=0;b.spiralOrder=0;
    }
    out.measure={
     polygonMid:diff(out.polygon.start[1],out.polygon.end[1]),
     spiralMid:diff(out.spiral.start[1],out.spiral.end[1]),
     polygonStart:diff(out.polygon.start[0],out.polygon.end[0]),
     polygonEnd:diff(out.polygon.start[4],out.polygon.end[4]),
     spiralStart:diff(out.spiral.start[0],out.spiral.end[0]),
     spiralEnd:diff(out.spiral.start[4],out.spiral.end[4]),
     polygonNear:diff(out.polygon.phase[3],out.polygon.phase[4]),
     spiralNear:diff(out.spiral.phase[3],out.spiral.phase[4]),
     countPolygon:out.polygon.phase.map(p=>p.length),
     countSpiral:out.spiral.phase.map(p=>p?.length||0)
    };
   }finally{
    state.layers=save.layers;runtimeState.morph.renderSourceLayers=save.source;
    runtimeState.morph.renderTargetLayers=save.target;
    state.morph.profileModeTransition=save.transition;
    state.morph.profileModeTransitionPercent=save.percent;
    state.morph.spiralMorphType=save.spiralType;state.fourierMode=save.fourier;
    runtimeState.morph.active=save.active;
    runtimeState.morph.sourceGeometry=save.sourceGeometry;
    runtimeState.morph.targetGeometry=save.targetGeometry;
    runtimeState.morph.sourceProfiles=save.sourceProfiles;
    runtimeState.morph.targetProfiles=save.targetProfiles;
    runtimeState.morph.sourceVisuals=save.sourceVisuals;
    runtimeState.morph.targetVisuals=save.targetVisuals;
    runtimeState.morph.lampCycleSerial=save.serial;state.morph.monoOrbitTransforms=save.mono;
   }
   return out.measure?{measure:out.measure,progress:out.progress}:out;
  })()`,{label:'real Polygon Canvas + Spiral prepared cubics under UI curvature schedule'});
  const m=r.measure;
  assert(m.countPolygon.every(n=>n>16&&n===m.countPolygon[0]),'Polygon cubic topology changed during interpolation: '+JSON.stringify(m));
  assert(m.countSpiral.every(n=>n>16&&n===m.countSpiral[0]),'Spiral cubic topology changed during interpolation: '+JSON.stringify(m));
  assert(m.polygonMid>1,'Polygon final curvature not controlled by UI schedule: '+JSON.stringify(m));
  assert(m.spiralMid>1,'Spiral final curvature not controlled by UI schedule: '+JSON.stringify(m));
  for(const k of ['polygonStart','polygonEnd','spiralStart','spiralEnd'])
   assert(m[k]<1e-5,'phase schedule must preserve both endpoint shapes: '+k+' '+JSON.stringify(m));
  assert(m.polygonNear<.4&&m.spiralNear<.4,'terminal visual contour is discontinuous: '+JSON.stringify(m));
  assert(r.progress.phase[1]>0&&r.progress.phase[1]<1);
  assert.equal(r.progress.start[1],1);
  assert.equal(r.progress.end[1],0);
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS v10434: user phase/start/end timings animate real Polygon & Spiral spline curvature; exact endpoints and continuous final rail');
 }finally{await h.close();}
})().catch(e=>{console.error('FAIL v10434',e.stack||e);process.exitCode=1;});
