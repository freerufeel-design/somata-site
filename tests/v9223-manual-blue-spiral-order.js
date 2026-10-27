'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:160,evalTimeoutMs:30000});
 try{
  const r=await h.evaluate(`(async()=>{
   const layer=state.layers.find(l=>l.id===state.activeLayerId);
   layer.spiralEnabled=true;layer.spiralOrder=1;
   if(runtimeState.morph.active)document.getElementById('btnMorph').click();
   const orderInput=document.getElementById('paramSpiralOrder');
   if(document.getElementById('btnSidebarShape'))document.getElementById('btnSidebarShape').click();
   state.morph.options.bySpiralOrder=true;
   document.getElementById('btnMorph').click();
   await new Promise(res=>setTimeout(res,220));
   const started=runtimeState.morph.active;
   orderInput.value='3';
   orderInput.dispatchEvent(new Event('input',{bubbles:true}));
   orderInput.dispatchEvent(new Event('change',{bubbles:true}));
   await new Promise(res=>setTimeout(res,260));
   const idx=state.layers.findIndex(l=>l.id===state.activeLayerId);
   const output={started,active:runtimeState.morph.active,order:state.layers[idx]?.spiralOrder,
      src:runtimeState.morph.sourceVisuals?.[idx]?.spiralOrder,draw:runtimeState.morph.frameLayers?.[idx]?.spiralOrder,
      ui:orderInput.value};
   if(runtimeState.morph.active)document.getElementById('btnMorph').click();
   return output;
  })()`,{timeoutMs:29000});
  assert(r.started&&r.active,'Blue Morph was stopped by manual input: '+JSON.stringify(r));
  assert(Math.abs(Number(r.order)-3)<1e-8,'manual order overwritten: '+JSON.stringify(r));
  assert(Math.abs(Number(r.src)-3)<1e-8,'rebase did not preserve manual order in source: '+JSON.stringify(r));
  assert.equal(uncaughtExceptions(h.events).length,0,'browser exception');
  console.log('PASS: Blue Morph stays active and accepts manual spiral order',JSON.stringify(r));
 }finally{await h.close();}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
