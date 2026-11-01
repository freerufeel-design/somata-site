'use strict';
// Regression: C0 pixel-continuity over consecutive Polygon Morph phases, with
// segment-only angular mode (previously NOT equal to Static at t=0), plus
// unchanged 10.4.19.29 timing in all five legacy modes, including topoCircle.
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:140,evalTimeoutMs:80000});
 try {
  const result=await h.evaluate(`(()=>{
   const saved={mode:state.morph.mode,speed:state.morph.speedType,fourier:state.fourierMode,
    transition:state.morph.profileModeTransition,pct:state.morph.profileModeTransitionPercent};
   const P=[{x:0,y:0},{x:.25,y:.3},{x:.5,y:-.1},{x:.75,y:.2},{x:1,y:0}],
    Q=[{x:0,y:0},{x:.25,y:-.25},{x:.5,y:.4},{x:.75,y:-.3},{x:1,y:0}],
    R=[{x:0,y:0},{x:.18,y:.22},{x:.45,y:-.3},{x:.71,y:.18},{x:1,y:0}];
   const c=document.createElement('canvas');c.width=510;c.height=510;
   const x=c.getContext('2d',{willReadFrequently:true});
   const paint=fn=>{x.setTransform(1,0,0,1,0,0);x.clearRect(0,0,510,510);
    x.translate(255,255);x.lineWidth=2;x.strokeStyle='white';fn();
    const a=x.getImageData(0,0,510,510).data,out=new Uint8Array(510*510);
    for(let i=0;i<out.length;i++)out[i]=a[i*4+3];return out;};
   const dist=(a,b)=>{let d=0;for(let i=0;i<a.length;i++)d+=Math.abs(a[i]-b[i]);return d/a.length;};
   const staticDraw=layer=>paint(()=>{const round=getRoundingStrength(layer.rounding);
    for(const p of buildOrbitPolylines(layer)){x.beginPath();
      if(useSmoothSplinePath(layer,round,p))splinePathForDraw(x,p.points,p.closed,round,p.cornerFlags||[],p.bridgeRoundFlags||[],layer.wholeCurveSpline===true);
      else roundPolylineForDraw(x,p.points,p.closed,round,p.cornerFlags||[]);x.stroke();}});
   const morph=(a,b,t,m)=>paint(()=>drawAngularAnchorMorph(x,b,a,b,t,1,'phase',m));
   const outcomes=[], clocks={}, ui={};
   try {
    state.fourierMode=false;state.morph.speedType='linear';
    state.morph.profileModeTransition='phase';state.morph.profileModeTransitionPercent=100;
    // A → B → C: enhanced exact-boundary implementation belongs ONLY to topoCircle.
    state.morph.mode='topoCircle';
    for(const movement of ['angular','linear'])for(const round of [0,55,120])
     for(const modes of [['segments','segments','segments'],['segments','spline','segments'],['spline','segments','spline']]){
      const [ma,mb,mc]=modes;
      const mk=(id,mode,n,k,nodes)=>{const layer=createLayer(id);Object.assign(layer,{
       N:n,K:k,radius:185,rounding:round,rotation:0,fill:false,closedLoop:true,
       profileMode:mode,wholeCurveSpline:false,profileNodes:nodes.map(p=>({...p})),spiralEnabled:false});return layer;};
      const a=mk('a',ma,7,2,P),b=mk('b',mb,9,3,Q),d=mk('c',mc,8,2,R);
      const source=staticDraw(a),bridge=staticDraw(b),target=staticDraw(d);
      const begin=morph(a,b,0,movement),end=morph(a,b,1,movement);
      const nextBegin=morph(b,d,0,movement),nextEnd=morph(b,d,1,movement);
      outcomes.push({movement,round,modes,source:dist(source,begin),
       bridge:dist(bridge,end),nextSource:dist(bridge,nextBegin),
       seam:dist(end,nextBegin),target:dist(target,nextEnd)});
     }
    for(const mode of ['topology','calm','circleSlide','fade','light','topoCircle']){
     state.morph.mode=mode;
     clocks[mode]=mixedProfileGeometryClock(.25,'segments','spline');
    }
    state.morph.mode='topoCircle';
    state.morph.speedType='smooth';clocks.topoCircleNonlinearSpeed=mixedProfileGeometryClock(.25,'segments','spline');
    state.morph.speedType='linear';clocks.topoCircleSameMode=mixedProfileGeometryClock(.25,'segments','segments');
    const ids=['morphMode','morphModeTop','testMorphMode'];
    ui.options=Object.fromEntries(ids.map(id=>[id,[...document.getElementById(id).options].map(o=>o.value)]));
    const sel=document.getElementById('morphModeTop');sel.value='topoCircle';sel.dispatchEvent(new Event('change',{bubbles:true}));
    ui.selected=state.morph.mode;ui.settings=document.getElementById('morphMode').value;
   } finally {
    state.morph.mode=saved.mode;state.morph.speedType=saved.speed;state.fourierMode=saved.fourier;
    state.morph.profileModeTransition=saved.transition;state.morph.profileModeTransitionPercent=saved.pct;
    const base=document.getElementById('morphMode'),top=document.getElementById('morphModeTop');
    if(base)base.value=saved.mode;if(top)top.value=saved.mode;
   }
   return{outcomes,clocks,ui};
  })()`,{label:'24-hour phase seam and opt-in time interpolation',timeoutMs:80000});
  assert.equal(result.outcomes.length,18);
  for(const c of result.outcomes){
   for(const field of ['source','bridge','nextSource','seam','target'])assert(c[field]<.001,`phase seam ${field}: ${JSON.stringify(c)}`);
  }
  for(const mode of ['topology','calm','fade','light'])
   assert.equal(result.clocks[mode],.15625,'10.4.19.29 reference clock altered: '+mode);
  assert.equal(result.clocks.circleSlide,.25,'Original 10.4.19.27 angular circle geometry clock');
  assert.equal(result.clocks.topoCircle,.15625);
  assert.equal(result.clocks.topoCircleNonlinearSpeed,.25);
  assert.equal(result.clocks.topoCircleSameMode,.25);
  for(const options of Object.values(result.ui.options))assert(options.includes('topoCircle'),'new mode missing from UI');
  assert.equal(result.ui.selected,'topoCircle');assert.equal(result.ui.settings,'topoCircle');
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS v10457: 18 exact phase handoffs (two consecutive cycles, segments/spline, N/K, 0/55/120%, angular/chords), 5 reference timing clocks, isolated exact topoCircle + 3 selectors');
 } finally {await h.close();}
})().catch(err=>{console.error('FAIL v10457',err.stack||err);process.exitCode=1;});
