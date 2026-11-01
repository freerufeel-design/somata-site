'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
const h=await createBrowserHarness({disableGpu:true,loadDelayMs:170,evalTimeoutMs:23000});
try{
const out=await h.evaluate(`(async()=>{
 const orig=state.layers,oldActive=state.activeLayerId,oldCorridor=state.tunnel.active;
 const options={...state.morph.options};const oldMode=state.morph.mode,oldSec=state.morph.intervalSec;
 let restoreAdd=null;
 try{
  state.layers=[{...orig[0],id:'blue-zero-post-test',spiralEnabled:true,spiralOrder:1,
    spiralZeroTransitionMode:'honest',visible:true}];state.activeLayerId=state.layers[0].id;
  state.tunnel.active=true;state.morph.mode='circleSlide';state.morph.intervalSec=5;
  state.morph.options.bySpiralOrder=true;state.morph.options.bySpiralLayers=true;
  let cb=null;const add=animationScheduler.add;restoreAdd=add;
  animationScheduler.add=function(n,fn){if(n==='morph')cb=fn;return add.call(this,n,fn);};
  document.getElementById('btnMorph').click();
  await new Promise(resolve=>setTimeout(resolve,100));
  animationScheduler.add=add;restoreAdd=null;animationScheduler.remove('morph');
  if(!cb||!runtimeState.morph.active)throw Error('Blue not active');
  const rt=runtimeState.morph;
  Object.assign(rt.sourceVisuals[0],{spiralEnabled:true,spiralOrder:1});
  Object.assign(rt.targetVisuals[0],{spiralEnabled:true,spiralOrder:0});
  rt.gpuPhasePreparing=false;rt.gpuPhaseWarming=false;
  const cycleMs=getTapMorphIntervalSec(state.morph.intervalSec,'full')*1000;
  // The 5-second Blue interval includes the last 1 second of Corridor expansion.
  const start=performance.now();rt.cycleStart=start;
  rt.honestZeroCorridorOutro=null;
  __somataCorridorStopHonestZeroOutro();
  const copies=[{scale:.5,alpha:1},{scale:1,alpha:1},{scale:2,alpha:1}];
  const sample=(at)=>{
    cb(at);
    const frame=rt.frameLayers[0];
    const multiplied=__somataCorridorCopiesForLayer(
      spiralCorridorCopiesForLayer(copies,frame,at),frame,at);
    return {order:frame?.spiralOrder,geometryT:rt.geometryT,
      alpha:multiplied.map(c=>c.alpha),scale:multiplied.map(c=>c.scale),
      outro:__somataCorridorHonestZeroOutro(state.layers[0].id,at),
      boundary:rt.boundaryPaintPending};
  };
  const during=sample(start+cycleMs*.5);
  const first=sample(start+cycleMs*.8);
  const half=sample(start+cycleMs*.9);
  const complete=sample(start+cycleMs+1);
  animationScheduler.remove('morph');document.getElementById('btnMorph').click();
  return {during,first,half,complete};
 }finally{
  if(restoreAdd)animationScheduler.add=restoreAdd;
  state.layers=orig;state.activeLayerId=oldActive;state.tunnel.active=oldCorridor;
  state.morph.mode=oldMode;state.morph.intervalSec=oldSec;state.morph.options=options;
  __somataCorridorStopHonestZeroOutro();
 }
})()`,{timeoutMs:22000});
assert(Math.abs(out.during.order-.375)<1e-5,'Blue must transport Spiral order for the first 80%');
assert.equal(out.during.outro,null,'Corridor cannot expand before order 0');
assert.equal(out.first.order,0);
assert(Math.abs(out.first.scale[2]-1)<.02,'Blue Corridor must still be folded at order zero');
assert(out.first.alpha[2]<.05,'Blue Corridor additional copies must initially be hidden');
assert(out.first.outro&&out.first.outro.population<.02);
assert.equal(out.first.boundary,false);
assert.equal(out.half.order,0);
assert(out.half.scale[2]>1.01&&out.half.scale[2]<1.99,'Blue Corridor copies must spread gradually');
assert(out.half.outro.population>.25&&out.half.outro.population<.75);
assert.equal(out.half.boundary,false);
assert(out.complete.outro.population>.99);
assert(Math.abs(out.complete.scale[2]-2)<.01,'Blue Corridor must reach its original spacing');
assert.equal(out.complete.boundary,true);
assert.deepEqual(uncaughtExceptions(h.events),[]);
console.log('PASS Blue Morph holds fully collapsed zero Spiral while Corridor animates out, then advances');
}finally{await h.close();}
})().catch(e=>{console.error('FAIL',e.stack||e);process.exitCode=1;});
