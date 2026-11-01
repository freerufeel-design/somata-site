'use strict';
// Deterministic real Blue Morph two-cycle boundary check, including rounded authored contours.
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:100,evalTimeoutMs:70000});
 try{
  const out=await h.evaluate(`(async()=>{
   const results=[], originalRandom=Math.random, originalLayers=state.layers,
    originalId=state.activeLayerId,originalMorph=JSON.parse(JSON.stringify(state.morph));
   const cv=document.createElement('canvas');cv.width=460;cv.height=460;
   const ctx=cv.getContext('2d',{willReadFrequently:true});
   const paint=draw=>{ctx.resetTransform();ctx.clearRect(0,0,460,460);ctx.translate(230,230);
    ctx.lineWidth=2;ctx.strokeStyle='#fff';ctx.globalAlpha=1;ctx.__suppressFill=true;
    draw();const data=ctx.getImageData(0,0,460,460).data,arr=new Uint8Array(460*460);
    for(let i=0;i<arr.length;i++)arr[i]=data[i*4+3];return arr;};
   const diff=(a,b)=>{let d=0;for(let i=0;i<a.length;i++)d+=Math.abs(a[i]-b[i]);return d/a.length;};
   for(const mode of ['topology','calm','circleSlide'])for(const profile of ['segments','spline']){
    if(runtimeState.morph.active)document.getElementById('btnMorph').click();
    const nodes=[{x:0,y:0},{x:.18,y:.42},{x:.34,y:-.22},{x:.52,y:.36},{x:.73,y:-.14},{x:1,y:0}];
    const layer=createLayer('v11-phase-'+mode+'-'+profile);
    Object.assign(layer,{N:7,K:2,radius:180,profileMode:profile,profileNodes:nodes,
     rounding:72,roundingMode:'standard',closedLoop:true,spiralEnabled:false,wholeCurveSpline:false,
     fill:false,lineVisible:true});
    state.layers=[layer];state.activeLayerId=layer.id;
    state.morph.mode=mode;state.morph.intervalSec=2;
    state.morph.options={...state.morph.options,byShape:true,byVertices:false,bySteps:false,byRounding:true,
      bySpiralLayers:false,bySpiralOrder:false,byColor:false,bySize:false,byRotation:false};
    state.morph.roundingMin=50;state.morph.roundingMax=90;
    const add=animationScheduler.add,after=animationScheduler.afterNextPaint;
    let tick,boundary;
    animationScheduler.add=function(k,fn){if(k==='morph')tick=fn;return add.call(this,k,fn);};
    animationScheduler.afterNextPaint=function(k,fn){if(k==='morph-cycle-boundary'){boundary=fn;return;}return after.call(this,k,fn);};
    let seed=39847;Math.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
    try{
      document.getElementById('btnMorph').click();await new Promise(r=>setTimeout(r,160));
      animationScheduler.remove('morph');
      const rt=runtimeState.morph;rt.gpuPhasePreparing=false;rt.gpuPhaseWarming=false;
      rt.cycleStart=performance.now()-100000;if(typeof tick!=='function')throw Error('Missing tick '+mode+'/'+profile+' active='+runtimeState.morph.active+' scheduler='+animationScheduler.has('morph'));tick(performance.now());
      if(typeof boundary!=='function')throw Error('Missing boundary '+mode);
      const target=rt.renderTargetLayers[0];
      const before=paint(()=>mode==='circleSlide'
        ?drawCircleSlideMorph(ctx,target,rt.renderSourceLayers[0],target,1,1,'phase')
        :drawLinearAnchorMorph(ctx,target,rt.renderSourceLayers[0],target,1,1,'phase'));
      boundary();await new Promise(r=>setTimeout(r,10));
      const src=rt.renderSourceLayers[0],dst=rt.renderTargetLayers[0];
      const first=paint(()=>mode==='circleSlide'?drawCircleSlideMorph(ctx,src,src,dst,0,1,'phase')
        :drawLinearAnchorMorph(ctx,src,src,dst,0,1,'phase'));
      const staticFrame=paint(()=>renderLayerOrbitPaths(ctx,state.layers[0]));
      results.push({mode,profile,endToStart:diff(before,first),startToStatic:diff(first,staticFrame),
        targetRaw:target.__morphExactProfileNodes?.length,
        authoredCount:state.layers[0].profileNodes?.length,
        srcRaw:src.__morphExactProfileNodes?.length,
        authoredMatch:JSON.stringify(src.__morphExactProfileNodes)===JSON.stringify(state.layers[0].profileNodes),
        srcSampled:src.__morphExactProfileSampled,
        endMode:target.profileMode,startMode:src.profileMode,
        rounding:state.layers[0].rounding});
      document.getElementById('btnMorph').click();
    }finally{Math.random=originalRandom;animationScheduler.add=add;animationScheduler.afterNextPaint=after;}
   }
   state.layers=originalLayers;state.activeLayerId=originalId;
   Object.assign(state.morph,originalMorph);
   return results;
  })()`,{label:'real two phase geometry and rounding',timeoutMs:70000});
  for(const c of out)console.log(JSON.stringify(c));
  for(const c of out){
    assert(c.authoredMatch,'First frame replaced authored knots with old paired samples: '+JSON.stringify(c));
    assert(c.startToStatic<.1,'First frame did not match authored Static geometry: '+JSON.stringify(c));
    assert(c.endToStart<.1,'Last frame not equal to first of next phase: '+JSON.stringify(c));
  }
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS v11 real Blue phase boundary matches authored rounded geometry for topology/calm/circleSlide, segments/spline');
 }finally{await h.close();}
})().catch(e=>{console.error('FAIL v11 Blue phase handoff',e.stack||e);process.exitCode=1;});
