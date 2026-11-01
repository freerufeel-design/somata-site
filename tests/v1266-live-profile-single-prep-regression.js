'use strict';
// Two deliberately distinct geometry contracts: legacy 12.6.6 live rebuild
// (six exact preparations and historical hashes) and 12.7.2 phase-locked
// prepared-target Morph (zero live prepares and its own deterministic hashes).
// Endpoints are separately certified against Static by v1272.
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=require('node:assert/strict');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:120,evalTimeoutMs:60000});
 try{
  const r=await h.evaluate(`(()=>{
   const make=(id,N,K,rotation,nodes)=>{const l=createLayer(id);Object.assign(l,{visible:true,lineVisible:true,N,K,rotation,radius:245,rounding:145,roundingShape:'spline',lineJoinType:'rounded',profileMode:'spline',profileNodes:nodes,spiralEnabled:true,spiralOrder:3,spiralStep:2.75,spiralStepLinked:false,spiralTangential:true,spiralClosed:true,spiralRoundSeams:true,wholeCurveSpline:true});return l;};
   const sa=[{x:0,y:0},{x:.15,y:.5},{x:.32,y:-.25},{x:.73,y:.37},{x:1,y:0}],da=[{x:0,y:0},{x:.12,y:.26},{x:.42,y:-.4},{x:.65,y:.2},{x:1,y:0}];
   state.morph.spiralMorphType='phaseCircle';state.morph.mode='circleSlide';
   runtimeState.morph.renderSourceLayers=[make('s',18,5,0,sa)];runtimeState.morph.renderTargetLayers=[make('d',19,6,48,da)];
   const hash=(a)=>{let n=2166136261;for(let i=0;i<a.length;i++){const b=Math.round(a[i]*1e5);n=Math.imul(n^(b|0),16777619)>>>0;}return n>>>0;};
   const prep=__spiroSpiralCarrierProfilePrepStatus().prepares,vals=[];
   for(const t of [.03,.17,.37,.59,.81,.98]){
     const p=__somataSpiralCarrierMorphPlan(0,t);
     vals.push({cubicCount:p?.cubicCount,paths:p?.pathCount,hash:hash(p?.packed||[]),live:p?.liveRoundedSpline,locked:p?.phaseLockedEndpoints,overflow:p?.carrierOverflow});
   }
   return{vals,prepares:__spiroSpiralCarrierProfilePrepStatus().prepares-prep};
  })()`,{timeoutMs:50000,label:'12.6.6 live Morph exact-and-single-preparation'});
  const locked=r.vals.every(x=>x.locked===true);
  if(locked){
    assert.equal(r.prepares,0,'phase-locked Spiral should not rebuild Spline+ per frame');
    assert.deepEqual(r.vals.map(x=>x.hash),
      [2060844155,229007079,605404860,3081948216,1330112302,106235817],
      'phase-locked prepared cubic hashes changed unexpectedly');
    for(const row of r.vals){assert.equal(row.cubicCount,1045);assert.equal(row.paths,19);assert.equal(row.live,false);assert.equal(row.overflow,false);}
  }else{
    assert.equal(r.prepares,6,'historical live Spline+ re-preparation count changed');
    assert.deepEqual(r.vals.map(x=>x.hash),[890937283,1464006539,1625907668,3504364678,2582584881,2898095732],
      'historical live spline cubic hashes changed relative to 12.6.5');
    for(const row of r.vals){assert.equal(row.cubicCount,1254);assert.equal(row.paths,19);assert.equal(row.live,true);assert.equal(row.overflow,false);}
  }
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log(locked?'PASS 12.7.2: phase-locked target rail; no per-frame spline preparation':'PASS 12.6.6: 6/6 exact old live Spline+ preparations',r);
 }finally{await h.close();}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
