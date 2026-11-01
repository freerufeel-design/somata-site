'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:100,evalTimeoutMs:35000});
 try{
  const data=await h.evaluate(`(()=>{
    const out=[];state.tunnel.active=true;state.tunnel.centerHiddenCopies=2;
    state.morph.mode='circleSlide';state.morph.spiralMorphType='phaseCircle';
    const layer=createLayer('v1310-physical-bezier-anchor');
    Object.assign(layer,{spiralEnabled:true,spiralOrder:2,spiralClosed:true,
      spiralRotationFocus:4,spiralManualFocus:true,spiralRotationFocusFigure:8,N:12,K:1,spiralStep:1,rounding:150,
      profileMode:'spline',rotation:0});
    const target={...layer,N:16,K:6,spiralStep:6};
    state.layers=[layer];state.activeLayerId=layer.id;
    runtimeState.morph.active=true;
    runtimeState.morph.renderSourceLayers=[layer];
    runtimeState.morph.renderTargetLayers=[target];
    for(const t of [0,.25,.5,.75,1]){
      runtimeState.morph.geometryT=t;runtimeState.morph.progress=t;
      const rail=WebGPUSpiralBezierMorphRenderer.debugCarrierMappedPlan(0,t);
      const p=rail?.paths?.[0]?.[0]?.p0;
      SomataCorridorFocus.resolveFrame(layer,getTunnelCopies(),120,1,350,state.tunnel);
      const fp=SomataCorridorFocus.focusPosition(layer);
      const rot=getMotionTunnelLagRadians({copyId:110,position:fp},layer);
      out.push({t,carrierMapped:rail?.carrierMapped,segments:rail?.cubicCount,
        focusPosition:fp,rot,visibleAnchorAngle:Math.atan2(p?.y||0,p?.x||0)+rot,
        carrierAnchorAngle:Math.atan2(rail?.carrierFrames?.[0]?.anchor?.y||0,rail?.carrierFrames?.[0]?.anchor?.x||0)});
    }
    return out;
  })()`,{timeoutMs:35000,label:'actual spline Bezier GPU carrier focus'});
  assert.equal(data.length,5);
  for(const r of data){
    assert.ok(r.carrierMapped,`GPU carrier path at ${r.t}`);
    assert.ok(r.segments>0,`Bezier segments at ${r.t}`);
    assert.equal(r.focusPosition,data[0].focusPosition,'focus must remain physically stable across the phase');
    assert.ok(Math.abs(r.rot)<1e-10,`rotation at ${r.t}`);
    assert.ok(Math.abs(r.visibleAnchorAngle-data[0].visibleAnchorAngle)<1e-10,`actual Bezier anchor rotation at ${r.t}`);
    assert.ok(Math.abs(r.visibleAnchorAngle-r.carrierAnchorAngle)<1e-10,`carrier mismatch at ${r.t}`);
  }
  assert.equal(data[0].focusPosition,5,'figure #8 is a stable physical pivot');
  assert.equal(uncaughtExceptions(h.events).length,0);
  console.log('PASS 5 real spline Bezier GPU-carrier rails, N=12→16, K=1→6, manual focus=figure #8, stable visible anchor on each phase sample');
 }finally{await h.close()}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
