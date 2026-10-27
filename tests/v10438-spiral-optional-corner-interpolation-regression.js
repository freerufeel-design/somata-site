'use strict';
// 10.4.19.16: there is no 'segmented without Bézier' UI mode anymore.
// Verify the old persisted false value is inert and curved corner fillets still work.
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:120,evalTimeoutMs:35000});
 try{
  const r=await h.evaluate(`(()=>{
   const prior={layers:state.layers,active:state.activeLayerId};
   const layer=createLayer('bezier-unconditional-qa');
   Object.assign(layer,{N:7,K:2,spiralEnabled:true,spiralOrder:2,spiralClosed:true,
    spiralRoundSeams:true,spiralTangential:false,profileMode:'segments',rounding:58,
    radius:215,profileNodes:[{x:0,y:0},{x:.2,y:.35},{x:.5,y:-.22},{x:.82,y:.2},{x:1,y:0}]});
   const flatten=(q)=>(q||[]).flatMap(c=>[c.p0.x,c.p0.y,c.c1.x,c.c1.y,c.c2.x,c.c2.y,c.p3.x,c.p3.y]);
   const sample=()=>{
     const path=(buildOrbitPolylines(layer)||[])[0];const points=path?.points||[],cubics=path?._bezierSegments||[];
     return {fillets:points.filter(p=>p.__spiralProfileFillet===true).length,
       cubicCount:cubics.length,
       controls:flatten(cubics)};
   };
   try{
    state.layers=[layer];state.activeLayerId=layer.id;syncSidebarInputs();
    const removed=!document.getElementById('paramSpiralFullBezierInterpolation')&&!document.getElementById('spiralFullBezierInterpolationRow');
    const modes=[];
    for(const closed of [true,false]){
      layer.spiralClosed=closed;
      delete layer.spiralFullBezierInterpolation;
      const normal=sample();
      layer.spiralFullBezierInterpolation=false; // historical project state
      const legacyOff=sample();
      layer.spiralFullBezierInterpolation=true;
      const legacyOn=sample();
      modes.push({closed,normal,legacyOff,legacyOn});
    }
    return {removed,modes,seamStillSeparate:!!document.getElementById('paramSpiralRoundSeams')};
   }finally{state.layers=prior.layers;state.activeLayerId=prior.active;syncSidebarInputs();}
  })()`,{label:'Bézier-only Spiral UI + legacy serialized false compatibility'});
  assert(r.removed&&r.seamStillSeparate,'legacy interpolation switch still exposed: '+JSON.stringify(r));
  for(const mode of r.modes){
    assert(mode.normal.cubicCount>3&&mode.normal.fillets>0,'rounded Bézier geometry missing: '+JSON.stringify(mode));
    assert.deepEqual(mode.legacyOff,mode.normal,'legacy false must not change geometry');
    assert.deepEqual(mode.legacyOn,mode.normal,'legacy true must not change geometry');
  }
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS v10438: removed redundant UI; legacy false/true ignored, rounded Bézier retained in both Spiral topologies');
 }finally{await h.close();}
})().catch(err=>{console.error('FAIL v10438',err.stack||err);process.exitCode=1;});
