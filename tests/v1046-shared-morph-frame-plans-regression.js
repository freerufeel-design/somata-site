'use strict';
// The frame-wide closure/Spiral decisions must remain equivalent across layers,
// even when layers are opening and closing in opposite directions.
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');

(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:180,evalTimeoutMs:18000});
 try{
  const result=await h.evaluate(`(async()=>{
   const original=state.layers[0];
   const cases=[{from:true,to:false},{from:false,to:true},{from:true,to:true},{from:false,to:false},{from:true,to:false,spiral:true}];
   state.layers=cases.map((c,i)=>({
     ...original,id:'qa-1046-'+i,name:'Morph '+i,
     profileNodes:[{x:0,y:0},{x:.5,y:.15+i*.02},{x:1,y:0}],
     closedLoop:c.from,spiralEnabled:c.spiral===true,spiralOrder:c.spiral?2:0,
     spiralZeroTransitionMode:i%2?'honest':'beautiful'
   }));
   state.activeLayerId=state.layers[0].id;
   state.morph.options.byShape=true;
   state.morph.options.bySpiralOrder=true;
   state.morph.options.bySpiralLayers=true;
   state.morph.spiralMorphType='phaseCircle';
   state.morph.mode='light';state.morph.monoOrbitTransforms=false;
   document.getElementById('morphMode').value='light';
   let morphFrame=null;
   const addTask=animationScheduler.add;
   animationScheduler.add=function(name,fn){if(name==='morph')morphFrame=fn;return addTask.call(this,name,fn);};
   document.getElementById('btnMorph').click();
   await new Promise(r=>setTimeout(r,100));
   animationScheduler.add=addTask;
   animationScheduler.remove('morph');
   const rt=runtimeState.morph;
   const active=rt.active===true && typeof morphFrame==='function';
   // Preserve the real preparation path but make the end points predictable.
   for(let i=0;i<cases.length;i++){
     rt.sourceVisuals[i].closedLoop=cases[i].from;
     rt.targetVisuals[i].closedLoop=cases[i].to;
     rt.sourceVisuals[i].spiralEnabled=cases[i].spiral===true;
     rt.targetVisuals[i].spiralEnabled=cases[i].spiral===true;
     rt.sourceVisuals[i].spiralOrder=cases[i].spiral?2:0;
     rt.targetVisuals[i].spiralOrder=cases[i].spiral?0:0;
   }
   const points=[.15,.39,.7,.9,1];
   const light=[];
   for(const t of points){
     rt.gpuPhasePreparing=false;rt.gpuPhaseWarming=false;
     rt.lightGeometryBucket=-1;
     rt.cycleStart=performance.now()-t*rt.transitionMs;
     morphFrame(performance.now());
     light.push(rt.lightLayers.map(l=>({closed:l.closedLoop,mode:l.profileMode,
        nodeCount:l.profileNodes?.length,firstX:l.profileNodes?.[0]?.x,
        midY:l.profileNodes?.[Math.floor(l.profileNodes.length/2)]?.y,
        spiralOrder:l.spiralOrder,spiralEnabled:l.spiralEnabled,
        zeroPopulation:l.__spiralZeroCorridorPopulation??null})));
   }
   document.getElementById('btnMorph').click();
   const stopped=rt.active===false;
   state.morph.mode='circleSlide';state.morph.speedType='linear';
   document.getElementById('morphMode').value='circleSlide';
   morphFrame=null;
   animationScheduler.add=function(name,fn){if(name==='morph')morphFrame=fn;return addTask.call(this,name,fn);};
   document.getElementById('btnMorph').click();
   await new Promise(r=>setTimeout(r,100));
   animationScheduler.add=addTask;animationScheduler.remove('morph');
   const fullRt=runtimeState.morph;
   const fullActive=fullRt.active===true&&typeof morphFrame==='function';
   for(let i=0;i<cases.length;i++){
     fullRt.sourceVisuals[i].closedLoop=cases[i].from;
     fullRt.targetVisuals[i].closedLoop=cases[i].to;
     fullRt.sourceVisuals[i].spiralEnabled=cases[i].spiral===true;
     fullRt.targetVisuals[i].spiralEnabled=cases[i].spiral===true;
     fullRt.sourceVisuals[i].spiralOrder=cases[i].spiral?2:0;
     fullRt.targetVisuals[i].spiralOrder=0;
   }
   const full=[];
   for(const t of [.39,.9]){
     fullRt.gpuPhasePreparing=false;fullRt.gpuPhaseWarming=false;
     fullRt.lastEditorPaint=performance.now()-1000;
     fullRt.cycleStart=performance.now()-t*fullRt.transitionMs;
     morphFrame(performance.now());
     full.push(fullRt.frameLayers.map(l=>({closed:l?.closedLoop,mode:l?.profileMode,
        nodeCount:l?.profileNodes?.length,spiralOrder:l?.spiralOrder,
        spiralEnabled:l?.spiralEnabled})));
   }
   document.getElementById('btnMorph').click();
   return {active,stopped,light,fullActive,full,fullStopped:fullRt.active===false};
  })()`,{timeoutMs:17000});
  assert(result.active&&result.stopped,'Light Morph failed to start or stop');
  assert.equal(result.light.length,5);
  for(const snapshot of result.light){
   assert.equal(snapshot.length,5);
   snapshot.forEach(row=>{
    assert(Number.isFinite(row.spiralOrder),'Spiral order became non-finite');
    assert(row.nodeCount>=2&&Number.isFinite(row.midY),'Profile nodes became invalid');
   });
  }
  // Opening starts only after geometry is prepared (78% of the transition).
  assert.equal(result.light[1][0].closed,true);
  assert.equal(result.light[3][0].closed,false);
  assert.equal(result.light[1][1].closed,false);
  assert.equal(result.light[3][1].closed,true);
  assert.equal(result.light[3][2].closed,true);
  assert.equal(result.light[3][3].closed,false);
  assert.equal(result.light[1][4].spiralEnabled,true);
  assert(result.fullActive&&result.fullStopped,'Full Morph failed to start or stop');
  for(const snapshot of result.full){
   assert.equal(snapshot.length,5);
   snapshot.forEach(row=>assert(row.nodeCount>=2&&Number.isFinite(row.spiralOrder),'Invalid Full Morph frame'));
  }
  assert.equal(result.full[0][0].closed,true);
  assert.equal(result.full[1][0].closed,false);
  assert.equal(result.full[0][1].closed,false);
  assert.equal(result.full[1][1].closed,true);
  assert.deepEqual(uncaughtExceptions(h.events),[],'Unexpected browser exceptions');
  console.log('PASS Somata 10.4.6 per-frame shared closure and Spiral decisions');
 }finally{await h.close();}
})().catch(err=>{console.error('FAIL',err.stack||err);process.exitCode=1;});
