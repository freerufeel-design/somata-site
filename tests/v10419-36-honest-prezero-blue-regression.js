'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
const h=await createBrowserHarness({disableGpu:true,loadDelayMs:180,evalTimeoutMs:27000});
try{
const out=await h.evaluate(`(async()=>{
 const old={layers:state.layers,activeId:state.activeLayerId,corridor:state.tunnel.active,
   mode:state.morph.mode,interval:state.morph.intervalSec,options:{...state.morph.options}};
 let restoreAdd=null;
 try{
  state.layers=[{...old.layers[0],id:'blue-honest-reverse-test',spiralEnabled:true,spiralOrder:0,
    spiralZeroTransitionMode:'honest',visible:true}];state.activeLayerId=state.layers[0].id;
  state.tunnel.active=true;state.morph.mode='circleSlide';state.morph.intervalSec=5;
  state.morph.options.bySpiralOrder=true;state.morph.options.bySpiralLayers=true;
  let cb=null;const add=animationScheduler.add;restoreAdd=add;
  animationScheduler.add=function(name,fn){if(name==='morph')cb=fn;return add.call(this,name,fn);};
  document.getElementById('btnMorph').click();
  await new Promise(r=>setTimeout(r,100));
  animationScheduler.add=add;restoreAdd=null;animationScheduler.remove('morph');
  if(!cb||!runtimeState.morph.active)throw Error('Blue morph not active');
  const rt=runtimeState.morph;
  Object.assign(rt.sourceVisuals[0],{spiralEnabled:true,spiralOrder:0});
  Object.assign(rt.targetVisuals[0],{spiralEnabled:true,spiralOrder:1});
  rt.gpuPhasePreparing=false;rt.gpuPhaseWarming=false;
  // The real browser scheduler may already have emitted a frame while the
  // harness was arming. Reset only the test's synthetic phase clock.
  rt.honestZeroCorridorIntro=null;__somataCorridorStopHonestZeroIntro();
  const start=performance.now();rt.cycleStart=start;
  const cycleMs=getTapMorphIntervalSec(state.morph.intervalSec,'full')*1000;
  const copies=[{scale:.5,alpha:1},{scale:1,alpha:1},{scale:2,alpha:1}];
  const sample=(now)=>{
    cb(now);
    const frame=rt.frameLayers[0];
    const instances=__somataCorridorCopiesForLayer(spiralCorridorCopiesForLayer(copies,frame),frame,now);
    return {order:frame?.spiralOrder,progress:rt.geometryT,boundary:rt.boundaryPaintPending,
      cycleStart:rt.cycleStart,intro:__somataCorridorHonestZeroIntro(state.layers[0].id,now,frame),
      scale:instances.map(c=>c.scale),alpha:instances.map(c=>c.alpha)};
  };
  const begin=sample(start);
  const intro=rt.honestZeroCorridorIntro;
  if(!intro||intro.ids.length!==1)throw Error('No Blue intro');
  const middle=sample(intro.start+intro.duration*.5);
  const folded=sample(intro.start+intro.duration);
  const geometryMs=cycleMs-intro.duration;
  const opening=sample(intro.start+intro.duration+geometryMs*.075);
  const half=sample(intro.start+intro.duration+geometryMs*.5);
  const finish=sample(start+cycleMs+1);
  animationScheduler.remove('morph');document.getElementById('btnMorph').click();
  return {begin,middle,folded,opening,half,finish,wait:intro.duration};
 }finally{
  if(restoreAdd)animationScheduler.add=restoreAdd;
  state.layers=old.layers;state.activeLayerId=old.activeId;state.tunnel.active=old.corridor;
  state.morph.mode=old.mode;state.morph.intervalSec=old.interval;state.morph.options=old.options;
  __somataCorridorStopHonestZeroIntro();
 }
})()`,{timeoutMs:25000});
assert(out.wait>0);
assert(Math.abs(out.wait-1000)<2,'Blue Corridor intro must fit in 20% of the 5s cycle');
for(const sample of [out.begin,out.middle,out.folded]){
  assert(Math.abs(sample.order)<1e-7,'Blue order must be held at 0 while Corridor gathers');
  assert.equal(sample.boundary,false,'Cycle must not advance during gathering');
}
assert(out.begin.scale[2]>1.98&&out.begin.alpha[2]>.99);
assert(out.middle.scale[2]>1.02&&out.middle.scale[2]<1.99);
assert(out.middle.alpha[2]>.02&&out.middle.alpha[2]<.99);
assert(Math.abs(out.folded.scale[2]-1)<.01&&out.folded.alpha[2]<.01,
  'Corridor must collapse before Blue geometry');
assert(Math.abs(out.opening.order-.075)<1e-5,'Spiral order change must begin only after intro');
assert(out.opening.alpha[2]>0&&out.opening.alpha[2]<1,
  'Blue must not flash duplicate Corridor copies at start of Spiral');
assert(Math.abs(out.half.order-.5)<1e-5&&out.half.alpha[2]>.99,
  'Original Blue Spiral interpolation and multiplication must be preserved');
assert(Math.abs(out.finish.order-1)<1e-6&&out.finish.boundary===true,
  'Blue should advance at the configured cycle endpoint');
assert.deepEqual(uncaughtExceptions(h.events),[]);
console.log('PASS Blue Honest 0 -> 1 waits for animated Corridor gathering, then unfolds Spiral at original speed');
}finally{await h.close();}
})().catch(e=>{console.error('FAIL',e.stack||e);process.exitCode=1;});
