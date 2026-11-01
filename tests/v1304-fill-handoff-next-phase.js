'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
const h=await createBrowserHarness({disableGpu:true,loadDelayMs:150,evalTimeoutMs:28000});
try{
const res=await h.evaluate(`(async()=>{
 const originals=state.layers,active=state.activeLayerId,old={mode:state.morph.mode,interval:state.morph.intervalSec,opts:{...state.morph.options},min:state.morph.fillLayersMin,max:state.morph.fillLayersMax};
 const add=animationScheduler.add,after=animationScheduler.afterNextPaint;
 let cb;animationScheduler.add=function(n,f){if(n==='morph')cb=f;return add.call(this,n,f);};
 const cases=[];
 async function run(label,sourceEnabled,targetEnabled){
  const l=createLayer(label);Object.assign(l,{closedLoop:true,spiralEnabled:false,spiralOrder:0,chaosStar:false,fill:sourceEnabled,fillColor:sourceEnabled?'#4477bbcb':'#4477bb00'});
  state.layers=[l];state.activeLayerId=l.id;state.morph.mode='circleSlide';state.morph.intervalSec=3;
  Object.assign(state.morph.options,{byShape:false,byVertices:false,bySteps:false,byColor:false,byFillColor:true,bySpiralLayers:false});
  state.morph.fillLayersMin=targetEnabled?1:0;state.morph.fillLayersMax=targetEnabled?1:0;
  document.getElementById('btnMorph').click();await new Promise(r=>setTimeout(r,90));animationScheduler.remove('morph');
  const first=runtimeState.morph.fillPhaseEndpoints[0],duration=Math.max(100,getTapMorphIntervalSec(state.morph.intervalSec,'full')*1000);
  const t=performance.now();runtimeState.morph.cycleStart=t-.5*duration;runtimeState.morph.gpuPhasePreparing=false;runtimeState.morph.gpuPhaseWarming=false;cb(t);
  const mid=runtimeState.morph.frameLayers?.[0],midAlpha=getFillOpacityUnit(mid?.fillColor);
  animationScheduler.afterNextPaint=function(_,fn){fn();};
  const t2=performance.now();runtimeState.morph.cycleStart=t2-1.05*duration;cb(t2);
  const next=runtimeState.morph.fillPhaseEndpoints[0],nextStart=runtimeState.morph.sourceVisuals[0];
  animationScheduler.afterNextPaint=after;
  document.getElementById('btnMorph').click();
  cases.push({label,first,next,midAlpha,nextStart:{fill:nextStart.fill,color:nextStart.fillColor}});
 }
 try{await run('on-off',true,false);await run('off-on',false,true);}
 finally{animationScheduler.add=add;animationScheduler.afterNextPaint=after;state.layers=originals;state.activeLayerId=active;state.morph.mode=old.mode;state.morph.intervalSec=old.interval;state.morph.options=old.opts;state.morph.fillLayersMin=old.min;state.morph.fillLayersMax=old.max;}
 return cases;
})()`,{timeoutMs:27000});
for(const c of res){
 assert.equal(c.next.from.enabled,c.first.to.enabled,c.label+' next phase fill enabled mismatch');
 assert.equal(c.next.from.color,c.first.to.color,c.label+' next phase fill color mismatch');
 assert(Math.abs(c.next.from.alpha-c.first.to.alpha)<1e-8,c.label+' next phase alpha mismatch');
 assert.equal(c.nextStart.fill,c.first.to.enabled,c.label+' next source flag mismatch');
 assert.equal(c.nextStart.color,c.first.to.color,c.label+' next source color mismatch');
 assert(Math.abs(c.midAlpha-(c.first.from.alpha+c.first.to.alpha)/2)<.01,c.label+' midpoint is not transitioning');
}
assert.deepEqual(uncaughtExceptions(h.events),[]);
console.log('PASS 2 real next-phase transitions: Fill ON/OFF and OFF/ON; endpoint RGBA exact; midphase alpha changes');
}finally{await h.close();}
})().catch(e=>{console.error('FAIL',e.stack||e);process.exitCode=1});
