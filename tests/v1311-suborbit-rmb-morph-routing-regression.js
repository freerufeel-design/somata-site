'use strict';
// Exercise the actual sidebar RMB menu and both existing special Morph bindings.
const assert = require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:120,evalTimeoutMs:16000});
 try{
   const r=await h.evaluate(`(async()=>{
     const layer=state.layers.find(l=>l.id===state.activeLayerId)||state.layers[0];
     layer.N=7;layer.K=1;layer.chaosStar=false;layer.customSuborbits=null;
     state.morph.activeProfileId='standard';toggleMorphSettingsPanel(true);syncMorphProfileUI();syncSidebarInputs();
     // Fresh factory state: deliberately disable via the public Morph UI, then
     // verify the idle single-orbit case is still a working RMB target.
     const factory=state.morph.monoOrbitTransforms===false;
     const row=document.getElementById('suborbitsContainer');
     const control=document.getElementById('paramSuborbits');
     const open=()=>{
       row.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:210,clientY:310,button:2}));
       const popup=document.getElementById('parameterRoutingContextMenu');
       const blue=popup?.querySelector('.routing-morph'),orange=popup?.querySelector('.routing-orange');
       return {visible:!!popup&&!popup.classList.contains('hidden'),blue,orange};
     };
     const first=open();
     const initial={factory,disabled:control.disabled,rowBound:row.dataset.suborbitsRoutingBound,visible:first.visible,blueOn:first.blue?.getAttribute('aria-checked'),blueDisabled:first.blue?.disabled,orangeOn:first.orange?.getAttribute('aria-checked')};
     first.blue?.click();await new Promise(r=>setTimeout(r,30));toggleMorphSettingsPanel(true);renderMorphProfileBindings();
     const blueEnabled=state.morph.monoOrbitTransforms===true;
     const rowVisible=!!document.querySelector('#morphProfileBindings [data-morph-special="orbits"]'); const debug={panelHidden:document.getElementById('morphSettingsPanel')?.classList.contains('hidden'),panelExists:!!document.getElementById('morphSettingsPanel'),profileId:state.morph.activeProfileId,profileType:getActiveMorphProfile()?.type,rowCount:document.getElementById('morphProfileBindings')?.childElementCount,checkbox:document.getElementById('morphMonoOrbitTransforms')?.checked};
     const stillDisabled=control.disabled;
     const next=open();next.blue?.click();await new Promise(r=>setTimeout(r,30));
     const blueDisabled=state.morph.monoOrbitTransforms===false;
     const rowRemoved=!document.querySelector('#morphProfileBindings [data-morph-special="orbits"]');
     // Orange must use its existing special route, not a new generic binding.
     const orangeWas=state.randomOptions.orbitBindingEnabled;
     const second=open();const prevOrange=second.orange?.getAttribute('aria-checked')==='true';second.orange?.click();
     const orangeToggled=(state.randomOptions.orbitBindingEnabled===!prevOrange);
     // Restore Orange special state so other tests do not inherit the probe.
     const third=open();third.orange?.click();
     const orangeRestored=state.randomOptions.orbitBindingEnabled===prevOrange;
     // With gcd >1, number editing is available as before; keep all numeric clamps.
     layer.N=8;layer.K=2;syncSidebarInputs();
     const editable=control.disabled===false&&control.max==='2';
     // The right-click remains independent of both the orbit count and chaos mode.
     layer.chaosStar=true;syncSidebarInputs();
     const chaosOpen=open();const chaosAvailable=control.disabled&&chaosOpen.visible&&!chaosOpen.blue?.disabled;
     // A legacy explicitly enabled project must still display the active special row.
     layer.chaosStar=false;state.morph.monoOrbitTransforms=true;syncMorphSettingsUI();toggleMorphSettingsPanel(true);renderMorphProfileBindings();await new Promise(r=>setTimeout(r,30));
     const explicitSaved=!!document.querySelector('#morphProfileBindings [data-morph-special="orbits"]');
     const routing=window.SomataMorphParameterRouting;
     routing.saveActiveProfile(state.morph,state.minimalMorph);
     state.morph.monoOrbitTransforms=false;
     routing.resetActiveProfile(state.morph,state.minimalMorph);
     const preservedThroughProfile=state.morph.monoOrbitTransforms===true;

     return {initial,blueEnabled,rowVisible,stillDisabled,blueDisabled,rowRemoved,orangeToggled,orangeRestored,editable,chaosAvailable,explicitSaved,orangeWas,debug,preservedThroughProfile};
   })()`,{timeoutMs:16000,label:'13.0.11 Suborbit routing real UI'});
   assert(r.initial.factory,'new default unexpectedly includes orbit Morph '+JSON.stringify(r));
   assert(r.initial.disabled&&r.initial.visible&&r.initial.rowBound==='1'&&!r.initial.blueDisabled,'one-suborbit RMB unavailable '+JSON.stringify(r));
   assert(r.initial.blueOn==='false','Orbit blue route initially on '+JSON.stringify(r));
   assert(r.blueEnabled&&r.rowVisible&&r.stillDisabled,'blue toggle did not reach existing Orbit special '+JSON.stringify(r));
   assert(r.blueDisabled&&r.rowRemoved,'blue route did not turn off '+JSON.stringify(r));
   assert(r.orangeToggled&&r.orangeRestored,'orange special route toggle failed '+JSON.stringify(r));
   assert(r.editable&&r.chaosAvailable&&r.explicitSaved&&r.preservedThroughProfile,'gcd/chaos/save behavior regressed '+JSON.stringify(r));
   const uncaught=uncaughtExceptions(h.events);
   assert(!uncaught.length,'uncaught browser exceptions: '+uncaught.join(' | '));
   console.log('Somata 13.0.11 suborbit routing: PASS',JSON.stringify(r));
 }finally{await h.close();}
})().catch(e=>{console.error('Somata 13.0.11 suborbit routing: FAIL',e.stack||e);process.exitCode=1;});
