'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:190,evalTimeoutMs:35000});
 try{
   const r=await h.evaluate(`(async()=>{
     const initialLayers=state.layers.slice(),originalOutline={...state.lineOutline},originalLamps={...state.lamps};
     const ar=state.audioReactive;ensureAudioRoutingState();
     const originalAudio={active:ar.active,levels:ar.levels,derivatives:ar.derivatives,effectsAmplitudeStrength:ar.effectsAmplitudeStrength,effectsAmplitudeMultiplier:ar.effectsAmplitudeMultiplier,routesMaster:ar.routes.master.slice()};
     try{
       while(state.layers.length<3){const next=JSON.parse(JSON.stringify(state.layers[0]));next.id='outline-coverage-test-'+state.layers.length;state.layers.push(next);}
       state.lineOutline.enabled=true;
       const layerIndices=state.layers.slice(0,3).map((_,i)=>i);
       const scan=n=>{state.lineOutline.layerCount=n;return layerIndices.map(i=>window.somataOutlineLayerEnabled(i));};
       ar.active=false;const counts=[scan(0),scan(1),scan(2),scan(3)];
       state.lineOutline.layerCount=0;state.lamps.freezeTailSec=1.5;state.lamps.freezeIntensity=20;
       const inactive=window.__spiroLampGPUStatus().webgpu.freezeLight;
       ar.active=true;ar.levels=[1,1,1,1,1];ar.derivatives=[0,0,0,0,0];
       ar.effectsAmplitudeStrength=200;ar.effectsAmplitudeMultiplier=1;
       ar.routes.master=[createAudioRoute('low','outline.layerCount',100,1,true,false,'add'),createAudioRoute('low','lamps.freezeTailSec',100,1,true,false,'add'),createAudioRoute('low','lamps.freezeIntensity',100,1,true,false,'add')];
       const active=window.__spiroLampGPUStatus().webgpu.freezeLight;
       const coverage=layerIndices.map(i=>window.somataOutlineLayerEnabled(i));
       return {counts,inactive:{tail:inactive.tailSec,intensity:inactive.intensity},active:{tail:active.tailSec,intensity:active.intensity},coverage};
     }finally{
       state.layers.splice(0,state.layers.length,...initialLayers);state.lineOutline={...originalOutline};state.lamps={...originalLamps};
       ar.active=originalAudio.active;ar.levels=originalAudio.levels;ar.derivatives=originalAudio.derivatives;
       ar.effectsAmplitudeStrength=originalAudio.effectsAmplitudeStrength;ar.effectsAmplitudeMultiplier=originalAudio.effectsAmplitudeMultiplier;
       ar.routes.master=originalAudio.routesMaster;
     }
   })()`,{timeoutMs:35000,label:'Three-layer outline coverage and GPU FreezeLight numeric audio adapters'});
   assert.deepEqual(r.counts.map(x=>x.filter(Boolean).length),[0,1,2,3],'random outline should affect N layers, not the first N');
   assert.equal(r.inactive.tail,1.5);assert.equal(r.inactive.intensity,20);
   assert(r.active.tail>r.inactive.tail,'FreezeLight tail not responding to audio at renderer');
   assert(r.active.intensity>r.inactive.intensity,'FreezeLight intensity not responding to audio at renderer');
   assert(r.coverage.filter(Boolean).length>0,'numerical outline coverage not responding to audio');
   assert.deepEqual(uncaughtExceptions(h.events),[]);
   console.log('PASS 3-layer outline 0/1/2/3 + live AudioLink to FreezeLight renderer tail/intensity and outline count');
 }finally{await h.close();}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
