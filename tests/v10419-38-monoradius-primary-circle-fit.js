'use strict';
// Mono Radius must fit the finished visible contour to the base circle at
// every rounding value (including 0) and throughout original Morph motion.
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:120,evalTimeoutMs:60000});
 try{
  const results=await h.evaluate(`(()=>{
   state.fourierMode=false;state.showRoundingGuides=false;
   const max=ps=>Math.max(0,...ps.flatMap(p=>(p.points||[]).map(pt=>Math.hypot(pt.x,pt.y))));
   const staticRows=[],anchorRows=[],preparedRows=[],unmodified=[];
   const baseNodes=[{x:0,y:0},{x:.22,y:.4},{x:.55,y:-.3},{x:1,y:0}];
   for(const n of [3,7,12])for(const k of [1,2])for(const mode of ['segments','spline'])for(const round of [0,1,35,75,120,200])for(const profile of [false,true]){
    const l=createLayer('mono-radius-fit'); Object.assign(l,{N:n,K:k,radius:190,radiusMultiplier:1,rounding:round,roundingMode:'monoradius',profileMode:mode,closedLoop:true,spiralEnabled:false,profileNodes:profile?baseNodes:[{x:0,y:0},{x:1,y:0}]});
    const d=getCachedLayerDrawData(l);const visual=buildLampRenderedAttachmentPathsUncached(d.paths,l,null,getRoundingStrength(round));
    staticRows.push({n,k,mode,round,profile,actual:max(visual),target:190});
   }
   for(const mode of ['topology','calm','circleSlide','topoCircle'])for(const rounding of [0,60,125])for(const shape of ['flat','profile'])for(const movement of ['linear','angular']){
    state.morph.mode=mode;
    const src=createLayer('mono-anchor-start'),dst=createLayer('mono-anchor-end');
    Object.assign(src,{N:7,K:2,radius:184,rotation:5,rounding,roundingMode:'monoradius',profileMode:'segments',spiralEnabled:false,closedLoop:true,profileNodes:shape==='flat'?[{x:0,y:0},{x:1,y:0}]:baseNodes});
    Object.assign(dst,src,{N:9,K:2,rotation:30,rounding,profileNodes:src.profileNodes});
    for(const t of [0,.001,.1,.25,.5,.75,.9,.999,1]){
     const lay={...src,N:7+Math.round(2*t),rotation:5+25*t};
     const raw=createMonoradiusMorphExtentProbe();drawAngularAnchorMorph(raw,lay,src,dst,t,1,'phase',movement);
     const fitted=createMonoradiusMorphExtentProbe();
     if(movement==='linear')MorphRendering.drawLinearAnchorMorph(fitted,lay,src,dst,t,1,'phase');
     else MorphRendering.drawCircleSlideMorph(fitted,lay,src,dst,t,1,'phase');
     anchorRows.push({mode,rounding,shape,movement,t,raw:raw.radius,actual:fitted.radius,target:184});
    }
   }
   for(const rounding of [0,50,120])for(const profileMode of ['segments','spline']){
     const l=createLayer('prepared-fit');Object.assign(l,{roundingMode:'monoradius',rounding,profileMode,spiralEnabled:false,radius:184});
     const ps=[{points:[{x:20,y:0},{x:120,y:30},{x:150,y:-20},{x:100,y:-70},{x:20,y:0}],closed:true,cornerFlags:[true,true,true,true,true]}];
     const fitted=createMonoradiusMorphExtentProbe();
     MorphRendering.drawPreparedMorphGeometry(fitted,l,ps,.5,1,profileMode,profileMode);
     preparedRows.push({rounding,profileMode,actual:fitted.radius,target:184});
   }
   return {staticRows,anchorRows,preparedRows};
  })()`,{timeoutMs:60000,label:'Mono Radius static and moving contour outer radius'});
  const staticBad=results.staticRows.filter(r=>Math.abs(r.actual-r.target)>.75);
  const anchorBad=results.anchorRows.filter(r=>Math.abs(r.actual-r.target)>1.5);
  const preparedBad=results.preparedRows.filter(r=>Math.abs(r.actual-r.target)>1.5);
  console.log('MonoRadius primary circle: static',results.staticRows.length,'bad',staticBad.length,'anchor',results.anchorRows.length,'bad',anchorBad.length,'prepared',results.preparedRows.length,'bad',preparedBad.length);
  if(staticBad.length) console.log('static failures',staticBad.slice(0,8));
  if(anchorBad.length) console.log('anchor failures',anchorBad.slice(0,15));
  if(preparedBad.length) console.log('prepared failures',preparedBad.slice(0,8));
  const notActuallyNeeded=results.anchorRows.filter(r=>r.t>0&&r.t<1 && Math.abs(r.raw-r.target)>15).length;
  console.log('Discrepant raw Morph frames before scale',notActuallyNeeded,'/ ',results.anchorRows.length);
  assert.equal(staticBad.length,0,'static MonoRadius must fit base circle');
  assert.equal(anchorBad.length,0,'anchor MonoRadius must fit base circle');
  assert.equal(preparedBad.length,0,'prepared MonoRadius must fit base circle');
  assert.equal(uncaughtExceptions(h.events).length,0,'browser JS exceptions');
  console.log('MONORADIUS PRIMARY CIRCLE (STATIC/MORPH): PASS');
 }finally{await h.close()}
})().catch(e=>{console.error('FAIL monoradius primary circle fit',e.stack||e);process.exitCode=1});
