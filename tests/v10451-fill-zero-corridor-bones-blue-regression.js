'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:130,evalTimeoutMs:22000});
 try{
  const r=await h.evaluate(`(async()=>{
   const original=state.layers,originalActive=state.activeLayerId,oldMode=state.morph.mode;
   const base=original[0];
   state.layers=[{...base,id:'phase-10451',visible:true,spiralEnabled:false,spiralOrder:0,closedLoop:true,fill:true,fillColor:'#c0502080',sprite:{...(base.sprite||{}),enabled:false}}];
   state.activeLayerId=state.layers[0].id;
   state.morph.mode='circleSlide';state.morph.intervalSec=8;state.morph.monoOrbitTransforms=false;
   state.morph.options.byShape=false;state.morph.options.byFillColor=false;
   let frame=null;
   const add=animationScheduler.add;
   animationScheduler.add=function(name,fn){if(name==='morph')frame=fn;return add.call(this,name,fn)};
   document.getElementById('btnMorph').click();
   await new Promise(resolve=>setTimeout(resolve,90));
   animationScheduler.add=add;
   animationScheduler.remove('morph');
   if(runtimeState.morph.active!==true||typeof frame!=='function')throw Error('Blue did not start');
   const rt=runtimeState.morph;
   Object.assign(rt.sourceVisuals[0],{fill:true,fillOpacity:50,fillColor:'#c0502080'});
   Object.assign(rt.targetVisuals[0],{fill:false,fillOpacity:50,fillColor:'#c0502000'});
   const sample=[];
   for(const t of [0,.1,.25,.5,.75,.9,1]){
     rt.gpuPhasePreparing=false;rt.gpuPhaseWarming=false;
     rt.lastEditorPaint=performance.now();
     const now=performance.now(),cycleMs=Math.max(100,getTapMorphIntervalSec(state.morph.intervalSec,'full')*1000);
     rt.cycleStart=now-t*cycleMs;
     frame(now);
     const view=rt.frameLayers[0];
     sample.push({t,alpha:getFillOpacityUnit(view.fillColor),fill:view.fill,blue:rt.active,geometryT:rt.geometryT});
   }
   // A user selecting the Bones preset must not take ownership of Blue's clock.
   const bones=document.querySelector('.line-sprite-preset[data-line-sprite-type="bones"]');
   if(!bones)throw Error('Bones preset absent');
   const before=rt.geometryT;
   bones.click();
   const during={active:rt.active,paused:rt.paused===true,sprite:state.layers[0].sprite?.type,enabled:state.layers[0].sprite?.enabled===true};
   const tick=performance.now(),cycleMs=Math.max(100,getTapMorphIntervalSec(state.morph.intervalSec,'full')*1000);
   rt.cycleStart=tick-cycleMs*.6;frame(tick);
   const after={active:rt.active,paused:rt.paused===true,geometryT:rt.geometryT};
   document.getElementById('btnMorph').click();
   state.tunnel.active=true;
   const zero=window.SomataSpiralZeroTransition;
   const modes={};
   for(const mode of ['honest','beautiful']){
     const src={spiralEnabled:true,spiralOrder:3,spiralZeroTransitionMode:mode},dst={spiralEnabled:true,spiralOrder:0};
     modes[mode]=[0,.15,.3,.5,.7,.85,1].map(t=>{
       const phase=zero.plan(mode,3,0,t,true);
       const gpu=WebGPUSpiralBezierMorphRenderer.debugResolveEffectT({sourceLayer:src,targetLayer:dst,staticEdit:false},t);
       const copies=window.__somataCorridorCopiesForLayer([
         {scale:.5,alpha:1},{scale:1,alpha:1},{scale:2,alpha:1}
       ],{id:'phase-10451',__spiralZeroCorridorPopulation:phase.population},performance.now());
       return {t,order:phase.order,population:phase.population,choreographed:phase.choreographed,gpu,
         copyAlpha:copies.map(c=>Number(c.alpha)),copyScale:copies.map(c=>Number(c.scale))};
     });
   }
   state.tunnel.active=false;
   state.layers=original;state.activeLayerId=originalActive;state.morph.mode=oldMode;
   return {sample,during,after,modes,before};
  })()`,{timeoutMs:22000});
  const alphas=r.sample.map(x=>x.alpha);
  for(const [i,v] of alphas.entries()){
   assert(Number.isFinite(v),`fill nonfinite frame ${i}`);
   if(i>0)assert(v<=alphas[i-1]+.005,`fill phase jump ${i}: ${alphas[i-1]} → ${v}`);
  }
  assert(alphas[0]>.45,`unexpected initial fill ${alphas[0]}`);
  assert(alphas[3]>.15&&alphas[3]<.36,`mid fill not smoothly changing: ${alphas[3]}`);
  assert(alphas[6]<.003,`end fill must be 0: ${alphas[6]}`);
  assert(r.sample.every(row=>row.blue),'Blue stopped during phase sequence');
  assert.equal(r.during.active,true,'Bones killed Blue Morph');
  assert.equal(r.during.paused,false,'Bones paused Blue Morph');
  assert.equal(r.during.sprite,'bones');assert.equal(r.during.enabled,true);
  assert.equal(r.after.active,true);assert.equal(r.after.paused,false);
  assert(r.after.geometryT>.5&&r.after.geometryT<.8,'Blue did not continue updating after Bones');
  for(const mode of ['honest','beautiful']){
   const rows=r.modes[mode];
   assert.equal(rows[0].population,1);assert.equal(rows[6].population,1);
   assert.equal(rows[3].population,0);
   assert(rows.every(row=>row.choreographed),'missing Corridor population '+mode);
   assert.equal(rows[0].gpu,0);assert.equal(rows[6].gpu,1);
   for(const row of rows){assert(Math.abs(row.gpu-(3-row.order)/3)<1e-7,`${mode} GPU mismatch at ${row.t}`);assert(row.copyAlpha.every(Number.isFinite));assert(row.copyScale.every(Number.isFinite));}
  }
  assert(Math.abs(r.modes.honest[1].gpu-.15)<1e-7,'Honest must keep the 10.4.19.29 direct Spiral order transport');
  assert.equal(r.modes.beautiful[1].gpu,0,'Beautiful must retain the gather-first phase');
  assert.notDeepEqual(r.modes.honest.map(x=>x.gpu),r.modes.beautiful.map(x=>x.gpu),
    'Honest and Beautiful must not share forced geometric choreography');
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS v10451 Fill phase, honest/beautiful GPU-Corridor population, Bones + active Blue Morph');
 }finally{await h.close();}
})().catch(err=>{console.error('FAIL',err.stack||err);process.exitCode=1;});
