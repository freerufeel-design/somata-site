'use strict';
const assert=require('node:assert/strict'),{createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{const h=await createBrowserHarness({disableGpu:true,loadDelayMs:70,evalTimeoutMs:30000});try{
 const out=await h.evaluate(`(()=>{
   const toggle=document.getElementById('paramFastFilletSweep');if(!toggle)throw Error('Missing fast sweep experiment control');
   const initial={checked:toggle.checked,global:window.__somataFastFilletSweep===true};
   toggle.checked=true;toggle.dispatchEvent(new Event('change',{bubbles:true}));
   const activated=window.__somataFastFilletSweep===true;
   let blocked=false;const was=runtimeState.morph.active;
   try{runtimeState.morph.active=true;toggle.checked=false;toggle.dispatchEvent(new Event('change',{bubbles:true}));blocked=window.__somataFastFilletSweep===true && toggle.checked;}finally{runtimeState.morph.active=was;}
   toggle.checked=false;toggle.dispatchEvent(new Event('change',{bubbles:true}));
   return {initial,activated,blocked,restored:window.__somataFastFilletSweep===false};
 })()`,{timeoutMs:25000,label:'experimental polynomial sweep sidebar'});
 assert.deepEqual(out,{initial:{checked:false,global:false},activated:true,blocked:true,restored:true});
 assert.deepEqual(uncaughtExceptions(h.events),[]);
 console.log('PASS 12.2 browser UI: approved reference default; experimental sweep opt-in; toggle blocked while Morph runs');
}finally{await h.close();}})().catch(e=>{console.error('FAIL 12.2 browser UI:',e.stack||e);process.exitCode=1});
