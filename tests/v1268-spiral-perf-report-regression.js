'use strict';
// Diagnostic collection must not render a frame, start a GPU pipeline, or fail
// when the browser has no WebGPU support.
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{const h=await createBrowserHarness({disableGpu:true,loadDelayMs:100});try{
 const r=await h.evaluate(`(()=>{
    const layers=Array.from({length:3},(_,i)=>{const l=createLayer('diag-'+i);l.spiralEnabled=true;l.visible=true;return l});
    state.layers.splice(0,state.layers.length,...layers);
    const before=__spiroAnimationStats().paintCount;
    const a=__somataSpiralPerformanceReport();
    const b=__somataSpiralPerformanceReport();
    return{a,b,paintDelta:__spiroAnimationStats().paintCount-before};
 })()`);
 assert.equal(r.a.version,'12.7.0');assert.equal(r.a.spiralLayers,3);
 assert.equal(r.a.visibleLayers,3);assert.equal(r.a.webGpuExposed,false);
 assert.equal(typeof r.a.spiralGpuReady,'boolean');assert.ok(Array.isArray(r.a.topPasses));
 assert.deepEqual(r.a,r.b);assert.equal(r.paintDelta,0);
 assert.deepEqual(uncaughtExceptions(h.events),[]);
 console.log('PASS 12.7.0 diagnostic read-only / 3 Spiral layers / no WebGPU / zero renders');
}finally{await h.close()}})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
