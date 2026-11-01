'use strict';
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({loadDelayMs:150,evalTimeoutMs:12000});
 try{
  const result=await h.evaluate(`(async()=>{
   const assert=(c,msg)=>{if(!c)throw Error(msg)};
   const clickPanel=(id)=>{const b=document.getElementById(id);if(b&&!b.classList.contains('hidden'))b.click();};
   const bluePanel=document.getElementById('morphSettingsPanel');
   bluePanel?.classList.remove('hidden');
   syncMorphProfileUI();
   const snapshot=()=>({blue:state.morph.monoOrbitTransforms,orange:state.randomOptions.orbitBindingEnabled,
    blueRow:!!document.querySelector('#morphProfileBindings [data-morph-special="orbits"]'),
    orangeRow:!!document.querySelector('#orangeMorphBindings [data-orange-special="orbits"]'),
    blueStyle:document.querySelector('#suborbitsContainer .suborbits-routing-range-host')?.className||'',
    bluePaused:document.querySelector('#morphProfileBindings [data-morph-special="orbits"]')?.classList.contains('disabled')});
   renderOrangeMorphBindings();syncMorphRouteDecorations();
   let initial=snapshot();
   assert(initial.blue===true,'blue orbits default should be enabled');
   assert(initial.orange===false,'orange orbits default should be off');
   assert(initial.blueRow,'blue orbit row missing');
   assert(initial.blueStyle.includes('parameter-routing-morph'),'blue border missing');
   const orbit=document.querySelector('#morphProfileBindings [data-morph-special="orbits"]');
   orbit.querySelector('input[type=checkbox]').click();
   const paused=snapshot();
   assert(paused.blue===false,'blue uncheck failed');
   assert(paused.blueRow,'blue row disappeared on uncheck');
   assert(paused.bluePaused,'blue row not gray');
   assert(!paused.blueStyle.includes('parameter-routing-morph'),'left blue border should turn off');
   document.querySelector('#morphProfileBindings [data-morph-special="orbits"] input[type=checkbox]').click();
   assert(state.morph.monoOrbitTransforms===true,'blue recheck failed');
   document.querySelector('#morphProfileBindings [data-morph-special="orbits"] button.morph-binding-remove').click();
   assert(!document.querySelector('#morphProfileBindings [data-morph-special="orbits"]'),'blue orbit remove failed');
   setMorphSpecialEnabled('orbits',true);renderMorphProfileBindings();
   assert(document.querySelector('#morphProfileBindings [data-morph-special="orbits"]'),'blue orbit add failed');
   // Orange is added independently; its checkbox must also merely pause it.
   setOrangeSpecialParameterEnabled('geometry.orbits',true);renderOrangeMorphBindings();syncMorphRouteDecorations();
   assert(document.querySelector('#orangeMorphBindings [data-orange-special="orbits"]'),'orange orbit add failed');
   assert(document.querySelector('#suborbitsContainer .suborbits-routing-range-host').classList.contains('parameter-routing-blue-orange'),'combined blue/orange tint missing');
   document.querySelector('#orangeMorphBindings [data-orange-special="orbits"] input[type=checkbox]').click();
   assert(document.querySelector('#orangeMorphBindings [data-orange-special="orbits"]'),'orange row disappeared on uncheck');
   assert(document.querySelector('#orangeMorphBindings [data-orange-special="orbits"]').classList.contains('disabled'),'orange row not dimmed');
   assert(state.randomOptions.orbitBindingEnabled===false,'orange orbit unchecked state not saved');
   document.querySelector('#orangeMorphBindings [data-orange-special="orbits"] button.morph-binding-remove').click();
   assert(!document.querySelector('#orangeMorphBindings [data-orange-special="orbits"]'),'orange remove failed');
   // Orange editor may hide Blue editor; explicitly reopen Blue for the next UI test.
   bluePanel.classList.remove('hidden');syncMorphProfileUI();
   // Ordinary (non-special) rows must already use the same disabled-row contract.
   const bind=(getActiveMorphBindings(getActiveMorphProfile())||[]).find(b=>b.enabled!==false);
   let ordinary=null;
   if(bind){const elem=document.querySelector('#morphProfileBindings [data-morph-parameter="'+bind.parameter+'"]');
    if(elem){elem.querySelector('input[type=checkbox]').click();ordinary={present:!!document.querySelector('#morphProfileBindings [data-morph-parameter="'+bind.parameter+'"]'),paused:document.querySelector('#morphProfileBindings [data-morph-parameter="'+bind.parameter+'"]')?.classList.contains('disabled')};assert(ordinary.present&&ordinary.paused,'ordinary row failed: '+bind.parameter);}}
   return {initial,paused,ordinary,final:snapshot(),suborbitsDisabled:document.getElementById('paramSuborbits')?.disabled};
  })()`,{timeoutMs:12000});
  console.log(JSON.stringify(result,null,2));
  const exceptions=uncaughtExceptions(h.events);if(exceptions.length)console.log('EXCEPTIONS',exceptions.slice(0,5));
 }finally{await h.close();}
})().catch(e=>{console.error(e.stack);process.exit(1)});
