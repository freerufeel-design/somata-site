const assert = require('node:assert/strict');
const vm = require('node:vm');
const {read,declarations} = require('./helpers/source.cjs');
const ctx=vm.createContext({assert,state:{morph:{profileModeTransition:'start',profileModeTransitionPercent:20}}});
vm.runInContext(declarations('clamp01','smooth','fillBoundaryWindow','spiralFillBoundaryAlpha','spiralFillPhaseAlpha'),ctx);
vm.runInContext(`
const f=t=>({morphFrameActive:true,geometryPlan:{dynamic:true},blueMorphProvider:{linearProgress:t,geometryT:0.5}});
const mesh={spiralInterwindingFill:true};
const a=t=>spiralFillPhaseAlpha(f(t),mesh);
for(const mode of ['start','end','second']) {
 state.morph.profileModeTransition=mode;
 for(const pct of [10,20,40,50]) {
  state.morph.profileModeTransitionPercent=pct;
  const w=pct/100;
  assert.equal(a(0),0);assert.equal(a(1),0);assert.equal(a(w/2),.5);
  assert.ok(Math.abs(a(1-w/2)-.5)<1e-12);assert.equal(a(w),1);assert.equal(a(.5),1);
 }
}
state.morph.profileModeTransition='phase';
assert.equal(a(0),0);assert.equal(a(.25),.5);assert.equal(a(.5),1);assert.equal(a(.75),.5);assert.equal(a(1),0);
for(const key of ['spiralInterwindingFill','spiralChoppedFill','spiralMathematicalFill','spiralBandFill']) {
 assert.equal(spiralFillPhaseAlpha(f(.25),{[key]:true}),.5);
 assert.equal(spiralFillPhaseAlpha({...f(0),morphFrameActive:false},{[key]:true}),1);
 assert.equal(spiralFillPhaseAlpha({...f(0),geometryPlan:{dynamic:false}},{[key]:true}),1);
}
assert.equal(spiralFillPhaseAlpha(f(0),{}),1);
state.morph.profileModeTransition='end';state.morph.profileModeTransitionPercent=0;
assert.equal(a(0),1);assert.equal(a(.5),1);assert.equal(a(1),1);
state.morph.profileModeTransitionPercent=100;
assert.equal(a(.5),1);assert.equal(a(0),0);assert.equal(a(1),0);
`,ctx);
const source=read('js/gpu/fill-mesh-renderer.js');
assert.match(source,/copyAlpha \* weight \* spiralFillPhaseAlpha\(frameCtx, mesh\)/);
assert.match(source,/if \(rec.empty\) return true;\s*device.queue.submit/);
