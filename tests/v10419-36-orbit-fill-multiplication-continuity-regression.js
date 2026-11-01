'use strict';
// Blue Topology/Calm: 1 <-> 2/3 orbit copies keep composed Fill at both
// morph/static boundaries, while target ON / OFF still obeys the phase clock.
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:160,evalTimeoutMs:30000});
 try{
  const cases=await h.evaluate(`(async()=>{
    const saved=state.layers,selected=state.activeLayerId;
    const oldMode=state.morph.mode,oldMono=state.morph.monoOrbitTransforms,
      oldInterval=state.morph.intervalSec,oldLo=state.morph.orbitPercentMin,oldHi=state.morph.orbitPercentMax,
      oldOptions={...state.morph.options},oldFillMin=state.morph.fillLayersMin,oldFillMax=state.morph.fillLayersMax,
      oldOpacityMin=state.morph.fillOpacityMin,oldOpacityMax=state.morph.fillOpacityMax;
    const originalAdd=animationScheduler.add;let callback;
    animationScheduler.add=function(name,fn){if(name==='morph')callback=fn;return originalAdd.call(this,name,fn);};
    const tests=[];
    try{
      for(const mode of ['topology','calm'])for(const [from,to,fillMorph,targetOn] of [[1,3,false,true],[3,1,false,true],[1,2,false,true],[2,1,false,true],[1,3,true,false],[1,3,true,true]]){
        const layer=createLayer('orbit-fill');Object.assign(layer,{N:9,K:3,customSuborbits:from===3?null:from,spiralEnabled:false,
          closedLoop:true,fill:true,fillColor:'#ed802899',profileMode:'segments',profileNodes:[{x:0,y:0},{x:1,y:0}],rounding:0});
        state.layers=[layer];state.activeLayerId=layer.id;
        const sel=document.getElementById('morphMode');if(sel){sel.value=mode;sel.dispatchEvent(new Event('change',{bubbles:true}));}
        state.morph.mode=mode;state.morph.intervalSec=6;state.morph.monoOrbitTransforms=true;
        state.morph.orbitPercentMin=to===3?100:to===2?50:0;state.morph.orbitPercentMax=to===3?100:to===2?50:0;
        Object.assign(state.morph.options,{byShape:false,byVertices:false,bySteps:false,bySpiralLayers:false,
          bySpiralOrder:false,byColor:false,byRotation:false,byRounding:false,byFillColor:fillMorph});
        state.morph.fillLayersMin=targetOn?1:0;state.morph.fillLayersMax=targetOn?1:0;
        state.morph.fillOpacityMin=80;state.morph.fillOpacityMax=80;
        callback=null;document.getElementById('btnMorph').click();
        await new Promise(resolve=>setTimeout(resolve,90));animationScheduler.remove('morph');
        const rt=runtimeState.morph;
        if(!callback||!rt.active)throw Error('Morph not active');
        const src=rt.sourceVisuals[0],dst=rt.targetVisuals[0];
        const countFrom=src.morphOrbitCopies,countTo=dst.morphOrbitCopies;
        const authored=layer.fillColor;
        const sourceAlpha=src.fill?getFillOpacityUnit(src.fillColor):0;
        const targetAlpha=dst.fill?getFillOpacityUnit(dst.fillColor):0;
        const expected0=1-Math.pow(1-sourceAlpha,countFrom/Math.max(countFrom,countTo));
        const expected1=1-Math.pow(1-targetAlpha,countTo/Math.max(countFrom,countTo));
        const duration=getTapMorphIntervalSec(state.morph.intervalSec,'full')*1000;
        const samples=[];
        for(const t of [0,.002,.1,.35,.65,.9,.999999]){
          rt.gpuPhasePreparing=false;rt.gpuPhaseWarming=false;
          const now=performance.now();rt.cycleStart=now-t*duration;callback(now);
          const frame=rt.frameLayers[0];
          const frameCtx={layer:frame,layerIndex:0,geometryPlan:{kind:'blue-topology',dynamic:true},frameId:100+Math.round(t*1000)};
          const contract=getLayerGeometryContract(frameCtx);
          samples.push({t,clock:rt.geometryT,alpha:getFillOpacityUnit(frame.fillColor),visible:frame.fill,
            color:colorBaseHex6(frame.fillColor),author:colorBaseHex6(authored),
            unionColor:frame.__morphOrbitFillCompositeColor,
            gpuAlpha:getFillOpacityUnit(contract.fillStyle),gpuRequested:contract.fillRequested,
            ephemeral:!Object.keys(frame).includes('__morphOrbitFillCompositeColor')});
        }
        tests.push({mode,from,to,fillMorph,targetOn,src:src.fill,dst:dst.fill,countFrom,countTo,
          expected0,expected1,samples,authoredUnchanged:layer.fillColor===authored});
        document.getElementById('btnMorph').click();
      }
    }finally{
      if(runtimeState.morph.active)document.getElementById('btnMorph').click();
      animationScheduler.add=originalAdd;state.layers=saved;state.activeLayerId=selected;
      state.morph.mode=oldMode;state.morph.monoOrbitTransforms=oldMono;state.morph.intervalSec=oldInterval;
      state.morph.orbitPercentMin=oldLo;state.morph.orbitPercentMax=oldHi;
      state.morph.options={...oldOptions};state.morph.fillLayersMin=oldFillMin;state.morph.fillLayersMax=oldFillMax;
      state.morph.fillOpacityMin=oldOpacityMin;state.morph.fillOpacityMax=oldOpacityMax;
    }
    return tests;
  })()`,{timeoutMs:30000,label:'Orbit Fill 1-to-3 / 3-to-1 continuity'});
  assert.equal(cases.length,12);
  for(const x of cases){
    assert.equal(x.countFrom,x.from,JSON.stringify(x));assert.equal(x.countTo,x.to,JSON.stringify(x));
    assert.equal(x.dst,x.targetOn,JSON.stringify(x));assert(x.authoredUnchanged,`Morph overwrote authored Fill: ${JSON.stringify(x)}`);
    const a=x.samples[0],b=x.samples.at(-1);
    assert(Math.abs(a.alpha-x.expected0)<2e-5,`Initial Fill count compensation invalid ${JSON.stringify(x)}`);
    assert(Math.abs(b.alpha-x.expected1)<2e-4,`Target Fill count compensation invalid ${JSON.stringify(x)}`);
    assert.equal(a.visible,true,`Source Fill switched OFF: ${JSON.stringify(x)}`);
    assert(x.samples.every(s=>s.ephemeral),'transient union Fill metadata leaked to layer serialization');
    assert(x.samples.every(s=>s.gpuRequested===s.visible),'GPU Fill eligibility diverged from the frame Fill state');
    const compositeStart=x.src? (x.fillMorph ? .6 : .6) : 0;
    const compositeEnd=x.targetOn? (x.fillMorph ? .8 : .6) : 0;
    assert(Math.abs(a.gpuAlpha-compositeStart)<.005,`GPU union Fill lost source alpha: ${JSON.stringify(x)}`);
    assert(Math.abs(b.gpuAlpha-compositeEnd)<.005,`GPU union Fill lost target alpha: ${JSON.stringify(x)}`);
    if(!x.fillMorph)assert(x.samples.every(s=>s.color===s.author),`Fill RGB changed without color morph: ${JSON.stringify(x)}`);
    for(let i=1;i<x.samples.length;i++){
      const p=x.samples[i-1],q=x.samples[i];
      assert(Math.abs(q.alpha-p.alpha)<.75,`Fill jumps in phase: ${JSON.stringify(x)}`);
      assert(q.clock>=p.clock,`Clock reversed: ${JSON.stringify(x)}`);
    }
  }
  // Source-over differs from simple alpha / 3. Exact three-fold overlap
  // must reconstruct the single source's opacity.
  const c=cases.find(x=>x.from===1&&x.to===3&&!x.fillMorph);
  assert(Math.abs(1-Math.pow(1-c.expected0,3)-.6)<1e-6,'source-over three-fold composite did not reproduce source alpha');
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  const fs=require('node:fs');const path=require('node:path');
  const gpu=fs.readFileSync(path.resolve(__dirname,'../js/app/geometry-gpu-core.js'),'utf8');
  assert(gpu.includes('const mathematical=!frameCtx.layer?.__morphOrbitFillCompositeColor&&getLayerFillRule(frameCtx.layer)'), 'GPU stencil parity still cancels duplicated orbit Fill');
  assert(gpu.includes('frameCtx.layer?.__morphOrbitFillCompositeColor||frameCtx.layer?.fillColor'), 'GPU native Fill does not take the composed alpha');
  console.log('PASS: 12 Topology/Calm scenarios — 1<->2/3, target ON/OFF, GPU even-overlap protection, source-over compositing and phase endpoints');
 }finally{await h.close();}
})().catch(err=>{console.error(err.stack||err);process.exitCode=1});
