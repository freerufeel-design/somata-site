'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:70,evalTimeoutMs:40000});
 try{
  const result=await h.evaluate(`(()=>{
   const el=document.getElementById('paramRoundingSplineSubdivisions');
   if(!el)throw Error('No per-layer spline quality control');
   if(el.value!=='16'||window.__somataSplineFilletSteps===8)throw Error('12.0 default quality changed');
   const original=16;
   el.value='8';el.dispatchEvent(new Event('change',{bubbles:true}));
   const optin={value:el.value,setting:window.__somataSplineFilletSteps};
   el.value='16';el.dispatchEvent(new Event('change',{bubbles:true}));
   const restored={value:el.value,setting:window.__somataSplineFilletSteps};
   const wasActive=runtimeState.morph.active;
   let blocked;
   try{
    runtimeState.morph.active=true;
    el.value='8';el.dispatchEvent(new Event('change',{bubbles:true}));
    blocked={value:el.value,setting:window.__somataSplineFilletSteps};
   }finally{runtimeState.morph.active=wasActive;}
   return {original,optin,restored,blocked};
  })()`,{label:'Spline samples quality in actual sidebar',timeoutMs:30000});
  assert.deepEqual(result,{original:16,optin:{value:'8',setting:8},restored:{value:'16',setting:16},blocked:{value:'16',setting:16}});
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS 12.1 browser UI: 16 default, manual 8 opt-in, restore 16 without changing Morph controls');
 }finally{await h.close()}
})().catch(e=>{console.error('FAIL quality sidebar:',e.stack||e);process.exitCode=1});
