'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');

(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:130,evalTimeoutMs:26000});
 try{
  const result=await h.evaluate(`(async()=>{
   const original=state.layers,oldActive=state.activeLayerId;
   const savedMorph={mode:state.morph.mode,intervalSec:state.morph.intervalSec,
     fillLayersMin:state.morph.fillLayersMin,fillLayersMax:state.morph.fillLayersMax,
     options:{...state.morph.options}};
   const tick=animationScheduler.add;
   let frame=null;
   animationScheduler.add=function(name,cb){if(name==='morph')frame=cb;return tick.call(this,name,cb);};
   const cases=[];
   async function runCase(label,sourceFills,minFill,maxFill){
     state.layers=sourceFills.map((f,i)=>({...original[0],id:label+'-'+i,visible:true,
       closedLoop:true,spiralEnabled:false,spiralOrder:0,chaosStar:false,
       fill:f,fillColor:'#ac5080cc',fillOpacity:80,
       profileNodes:(original[0].profileNodes||[]).map(p=>({...p})),
       sprite:{...(original[0].sprite||{}),enabled:false}}));
     state.activeLayerId=state.layers[0].id;
     state.morph.mode='circleSlide';state.morph.intervalSec=8;
     Object.assign(state.morph.options,{byShape:false,byVertices:false,bySteps:false,
       byFillColor:true,bySpiralLayers:false});
     state.morph.fillLayersMin=minFill;state.morph.fillLayersMax=maxFill;
     document.getElementById('btnMorph').click();
     await new Promise(res=>setTimeout(res,90));
     animationScheduler.remove('morph');
     if(runtimeState.morph.active!==true||typeof frame!=='function')throw Error('Blue failed in '+label);
     const rt=runtimeState.morph;
     const endpoints=rt.sourceVisuals.map((src,i)=>({source:src.fill,target:rt.targetVisuals[i]?.fill,
       sourceColor:src.fillColor,targetColor:rt.targetVisuals[i]?.fillColor}));
     const samples=[];
     const duration=Math.max(100,getTapMorphIntervalSec(state.morph.intervalSec,'full')*1000);
     for(const t of [0,.125,.25,.5,.75,.875,1]){
       rt.gpuPhasePreparing=false;rt.gpuPhaseWarming=false;rt.lastEditorPaint=performance.now();
       const now=performance.now();rt.cycleStart=now-t*duration;frame(now);
       samples.push({t,actual:rt.frameLayers.map(l=>({alpha:getFillOpacityUnit(l.fillColor),fill:l.fill})),phase:rt.geometryT});
     }
     document.getElementById('btnMorph').click();
     cases.push({label,endpoints,samples});
   }
   await runCase('two-filled-to-zero',[true,true],0,0);
   await runCase('two-filled-to-one',[true,true],1,1);
   await runCase('unfilled-to-filled',[false],1,1);
   animationScheduler.add=tick;state.layers=original;state.activeLayerId=oldActive;
   Object.assign(state.morph,savedMorph);state.morph.options={...savedMorph.options};
   return cases;
  })()`,{timeoutMs:26000});
  const eps=.008;
  for(const test of result){
   for(let i=0;i<test.endpoints.length;i++){
    const e=test.endpoints[i];
    if(test.label.startsWith('two-filled-to-'))assert.equal(e.source,true,`Initial source Fill disappeared from layer ${i} when target limit=0`);
    if(test.label==='unfilled-to-filled')assert.equal(e.target,true,'Target Fill missing');
    const a0=Number(e.sourceColor?.slice(-2) ? parseInt(e.sourceColor.slice(-2),16)/255:0),
          a1=Number(e.targetColor?.slice(-2) ? parseInt(e.targetColor.slice(-2),16)/255:0);
    const alpha0=e.source?a0:0,alpha1=e.target?a1:0;
    for(const row of test.samples){
     const expected=alpha0+(alpha1-alpha0)*row.phase;
     const actual=row.actual[i].alpha;
     assert(Math.abs(expected-actual)<eps,`${test.label} layer ${i} at t=${row.t}: expected ${expected}, got ${actual}`);
     assert.equal(row.actual[i].fill,actual>1e-6,`Fill visibility not aligned with alpha in ${test.label}, t=${row.t}`);
    }
   }
  }
  const one=result.find(x=>x.label==='two-filled-to-one');
  assert.equal(one?.endpoints.filter(x=>x.target).length,1,'target maximum must still limit target Fill population');
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS v10452 Fill ON → OFF / OFF → ON follows continuous Morph phase on all layers, independent of target count limit');
 }finally{await h.close();}
})().catch(err=>{console.error('FAIL',err.stack||err);process.exitCode=1;});
