'use strict';
// Prepared splines must stay periodic during continuous N/K/phase changes.
// A linear mix of two valid endpoint carriers is not itself a valid carrier:
// the midpoint can have a different phase/scale and leave a Corridor seam.
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:115,evalTimeoutMs:26000});
 try{
  const cases=await h.evaluate(`(()=>{
   const old={layers:state.layers,active:state.activeLayerId,source:runtimeState.morph.renderSourceLayers,
     target:runtimeState.morph.renderTargetLayers,type:state.morph.spiralMorphType,mode:state.morph.mode,tunnel:state.tunnel.active};
   const output=[];
   try{
    const a=createLayer('spline-seam-source'),b=createLayer('spline-seam-target');
    Object.assign(a,{N:7,K:1,spiralEnabled:true,spiralOrder:2,spiralClosed:true,
      spiralTangential:true,spiralRoundSeams:true,spiralJoinInterpolation:true,radius:220,rounding:25,profileMode:'spline',
      profileNodes:[{x:0,y:0},{x:.33,y:.2},{x:1,y:0}]});
    Object.assign(b,a,{id:'spline-seam-target',N:10,K:2,
      profileNodes:[{x:0,y:0},{x:.16,y:-.1},{x:.4,y:.35},{x:.7,y:-.15},{x:1,y:0}]});
    state.layers=[a];state.activeLayerId=a.id;state.tunnel.active=true;
    runtimeState.morph.renderSourceLayers=[a];runtimeState.morph.renderTargetLayers=[b];state.morph.mode='circleSlide';
    for(const mode of ['continuous','phase','phaseCircle','minimalTurn']){
      state.morph.spiralMorphType=mode;
      for(const t of [.001,.1,.25,.5,.75,.9,.999]){
        const x=WebGPUSpiralBezierMorphRenderer.debugCorridorSeams(0,t);
        output.push({mode,t,seam:x?.seam,deltaError:x?.analyticVsActualDelta,
          scaleError:x?.analyticVsActualScale,segments:x?.pathSegments,overflow:x?.carrierOverflow});
      }
    }
   }finally{
    state.layers=old.layers;state.activeLayerId=old.active;state.morph.spiralMorphType=old.type;
    state.morph.mode=old.mode;state.tunnel.active=old.tunnel;
    runtimeState.morph.renderSourceLayers=old.source;runtimeState.morph.renderTargetLayers=old.target;
   }
   return output;
  })()`,{label:'continuous spline Corridor periodic seam'});
  assert.equal(cases.length,28);
  for(const x of cases){
    assert(x.segments>0&&!x.overflow,'missing spline GPU carrier '+JSON.stringify(x));
    assert(Number.isFinite(x.seam)&&x.seam<1e-4,'Spline Corridor seam breaks during Morph '+JSON.stringify(x));
    assert(Math.abs(x.deltaError)<1e-6&&Math.abs(x.scaleError)<1e-6,
      'instantaneous spline phase disagrees with shared Corridor carrier '+JSON.stringify(x));
  }
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS v10428 prepared spline retains exact periodic Corridor phase in 28 N/K Morph frames, four continuous transports');
 }finally{await h.close();}
})().catch(e=>{console.error('FAIL v10428',e.stack||e);process.exitCode=1});
