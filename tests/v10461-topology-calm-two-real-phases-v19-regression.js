'use strict';const assert=require('node:assert/strict');const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{const h=await createBrowserHarness({disableGpu:true,loadDelayMs:120,evalTimeoutMs:50000});
try{const v=await h.evaluate(`(async()=>{
 const ret=[], rand=Math.random;
 for(const mode of ['topology','calm']){
  if(runtimeState.morph.active)document.getElementById('btnMorph').click();
  const layer=createLayer('phase-probe');Object.assign(layer,{N:7,K:2,profileMode:'spline',spiralEnabled:false,
    profileNodes:[{x:0,y:0},{x:.18,y:.32},{x:.46,y:-.14},{x:.68,y:.25},{x:1,y:0}],radius:218,rounding:55});
  state.layers=[layer];state.activeLayerId=layer.id;state.morph.mode=mode;state.morph.intervalSec=2;state.morph.intervalMultiplier=1;
  for(const id of ['morphMode','morphModeTop']){const el=document.getElementById(id);if(el)el.value=mode;}
  state.morph.monoOrbitTransforms=false;state.morph.options={...state.morph.options,byShape:true,byVertices:true,bySteps:true};
  const add=animationScheduler.add, after=animationScheduler.afterNextPaint;
  let tick,callback;animationScheduler.add=function(k,fn){if(k==='morph')tick=fn;return add.call(this,k,fn);};
  animationScheduler.afterNextPaint=function(k,fn){if(k==='morph-cycle-boundary'){callback=fn;return;}return after.call(this,k,fn);};
  let seed=4167;Math.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const snapshot=(phase)=>{
   const rt=runtimeState.morph,s=rt.sourceProfiles?.[0],t=rt.targetProfiles?.[0],a=rt.renderSourceLayers?.[0],b=rt.renderTargetLayers?.[0];
   const diff=(aa,bb)=>!Array.isArray(aa)||!Array.isArray(bb)||aa.length!==bb.length?Infinity:
     aa.reduce((m,p,i)=>Math.max(m,Math.abs((p?.x||0)-(bb[i]?.x||0)),Math.abs((p?.y||0)-(bb[i]?.y||0))),0);
   return{phase,mode:state.morph.mode,sourceMode:s?.mode,targetMode:t?.mode,source:s?.nodes?.length,target:t?.nodes?.length,
    sourceRender:a?.profileNodes?.length,targetRender:b?.profileNodes?.length,
    sourceDifference:diff(s?.nodes,a?.profileNodes),targetDifference:diff(t?.nodes,b?.profileNodes)};
  };
  try{
   document.getElementById('btnMorph').click();await new Promise(r=>setTimeout(r,110));
   animationScheduler.remove('morph');ret.push(snapshot('first'));
   if(typeof tick!=='function')throw Error('No morph tick');
   const rt=runtimeState.morph,now=performance.now();rt.gpuPhasePreparing=false;rt.gpuPhaseWarming=false;
   rt.cycleStart=now-1e7;tick(now);if(typeof callback!=='function')throw Error('Boundary callback missing');
   callback();await new Promise(r=>setTimeout(r,30));ret.push(snapshot('second'));
   document.getElementById('btnMorph').click();
  }finally{animationScheduler.add=add;animationScheduler.afterNextPaint=after;Math.random=rand;}
 }
 return ret;
})()`,{timeoutMs:45000,label:'legacy two-phase real morph handoff'});assert.equal(v.length,4);
 for (const phase of v) {
   assert(['topology','calm'].includes(phase.mode));
   assert.equal(phase.source,phase.sourceRender,'legacy source grid not paired: '+JSON.stringify(phase));
   assert.equal(phase.target,phase.targetRender,'legacy target grid not paired: '+JSON.stringify(phase));
   assert.equal(phase.sourceDifference,0,'legacy source endpoint changed');
   assert.equal(phase.targetDifference,0,'legacy target endpoint changed');
 }
 assert.deepEqual(uncaughtExceptions(h.events),[]);
 console.log('PASS v10461: Topology/Calm both real Blue Morph phases keep paired v19 carrier grid');}finally{await h.close();}})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
