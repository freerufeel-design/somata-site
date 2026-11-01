'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:140,evalTimeoutMs:30000});
 try{
  const results=await h.evaluate(`(async()=>{
   const original=state.layers,active=state.activeLayerId, oldMorph={...state.morph,options:{...state.morph.options}};
   const add=animationScheduler.add,after=animationScheduler.afterNextPaint;
   let callback,boundary;
   animationScheduler.add=function(name,fn){if(name==='morph')callback=fn;return add.call(this,name,fn);};
   animationScheduler.afterNextPaint=function(name,fn){if(name==='morph-cycle-boundary'){boundary=fn;return;}return after.call(this,name,fn);};
   const results=[];
   try{
    for(const scenario of [
      {name:'polygon-to-spiral',sourceSpiral:false,sourceClosed:true,targetSpiral:true,targetClosed:false},
      {name:'closed-to-open',sourceSpiral:false,sourceClosed:true,targetSpiral:false,targetClosed:false},
      {name:'open-to-closed',sourceSpiral:false,sourceClosed:false,targetSpiral:false,targetClosed:true},
      {name:'spiral-to-polygon',sourceSpiral:true,sourceClosed:false,targetSpiral:false,targetClosed:true}
     ])for(const fillRoute of [false,true]){
     const layer=createLayer('boundary-fill');Object.assign(layer,{N:8,K:3,fill:true,fillColor:'#a0306099',closedLoop:scenario.sourceClosed,spiralEnabled:scenario.sourceSpiral,spiralOrder:scenario.sourceSpiral?1:0,spiralFillEnabled:true,spiralClosed:true,profileMode:'segments',profileNodes:[{x:0,y:0},{x:1,y:0}]});
     state.layers=[layer];state.activeLayerId=layer.id;
     state.morph.mode='topology';state.morph.intervalSec=4;state.morph.monoOrbitTransforms=true;
     Object.assign(state.morph.options,{byShape:!scenario.sourceSpiral&&!scenario.targetSpiral,byVertices:false,bySteps:false,byFillColor:fillRoute,byColor:false,bySpiralLayers:scenario.sourceSpiral||scenario.targetSpiral,bySpiralOrder:false});
     state.morph.fillLayersMin=1;state.morph.fillLayersMax=1;
     callback=null;boundary=null;
     document.getElementById('btnMorph').click();await new Promise(res=>setTimeout(res,70));animationScheduler.remove('morph');
     if(!callback||!runtimeState.morph.active)throw Error('Morph start failed');
     const rt=runtimeState.morph;
     // Deterministic topology target: spiral cannot be filled by ordinary polygon rules,
     // but the canonical authored Fill remains true as a preference.
     Object.assign(rt.targetVisuals[0],{fill:scenario.targetClosed,closedLoop:scenario.targetClosed,spiralEnabled:scenario.targetSpiral,spiralOrder:scenario.targetSpiral?1:0,fillColor:scenario.targetClosed?'#a0306099':'#a0306000'});
     const interval=Math.max(100,getTapMorphIntervalSec(state.morph.intervalSec,'full')*1000);
     const frameAt=t=>{rt.gpuPhasePreparing=false;rt.gpuPhaseWarming=false;rt.lastEditorPaint=performance.now();const now=performance.now();rt.cycleStart=now-t*interval;callback(now);const x=rt.frameLayers[0];return{fill:x?.fill,alpha:getFillOpacityUnit(x?.fillColor),spiral:x?.spiralEnabled,source:rt.sourceVisuals[0]?.fill,target:rt.targetVisuals[0]?.fill};};
     const before=frameAt(0.999999);const boundaryEnd=frameAt(1.005);
     if(typeof boundary!=='function')throw Error('boundary callback absent; cycleMs='+interval+' pending='+rt.boundaryPaintPending+' t='+rt.geometryT);boundary();
     const afterBoundary={fill:state.layers[0].fill,closedLoop:state.layers[0].closedLoop,spiral:state.layers[0].spiralEnabled,source:rt.sourceVisuals[0]?.fill,target:rt.targetVisuals[0]?.fill};
     const start=frameAt(0.00001);
     results.push({scenario:scenario.name,fillRoute,before,boundaryEnd,afterBoundary,start});
     document.getElementById('btnMorph').click();
    }
   }finally{if(runtimeState.morph.active)document.getElementById('btnMorph').click();animationScheduler.add=add;animationScheduler.afterNextPaint=after;state.layers=original;state.activeLayerId=active;Object.assign(state.morph,oldMorph);state.morph.options={...oldMorph.options};}
   return results;
  })()`,{timeoutMs:30000});
  console.log(`Checked ${results.length} phase boundaries: ${results.map(r=>r.scenario + (r.fillRoute ? '(route)' : '(no-route)')).join(', ')}`);
  for(const row of results){
    const a=row.before,b=row.start;
    assert(Math.abs(a.alpha-b.alpha)<.015,`Fill jumps at phase boundary: ${JSON.stringify(row)}`);
    if(a.alpha>.005||b.alpha>.005)assert.equal(a.fill,b.fill,`Visible Fill flag jumps: ${JSON.stringify(row)}`);
  }
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS Blue phase Fill handoff stays continuous');
 }finally{await h.close();}
})().catch(err=>{console.error('FAIL',err.stack||err);process.exitCode=1});
