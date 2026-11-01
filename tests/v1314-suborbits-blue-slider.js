'use strict';
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({loadDelayMs:140,evalTimeoutMs:15000});
 try{
  const result=await h.evaluate(`(()=>{
   const assert=(v,s)=>{if(!v)throw Error(s)};
   document.getElementById('morphSettingsPanel')?.classList.remove('hidden');
   syncMorphProfileUI();
   const host=document.querySelector('#suborbitsContainer .suborbits-routing-range-host');
   const base=document.getElementById('paramSuborbits');
   const min=host.querySelector('.blue-morph-dual-min');
   const max=host.querySelector('.blue-morph-dual-max');
   assert(host&&min&&max,'missing blue dual thumbs');
   assert(state.morph.monoOrbitTransforms===true,'default blue orbits not enabled');
   assert(base.disabled===true,'S=1 should keep numeric edit disabled');
   assert(host.classList.contains('morph-live'),'blue dual slider not displayed with S=1');
   assert(min.disabled===false&&max.disabled===false,'blue thumb disabled');
   const start=[+min.value,+max.value];
   max.value='65';max.dispatchEvent(new Event('input',{bubbles:true}));
   assert(state.morph.orbitPercentMax===65,'max change not saved');
   max.dispatchEvent(new Event('change',{bubbles:true}));
   assert(document.querySelector('#morphProfileBindings [data-morph-special="orbits"] input[aria-label*="максимум"]')?.value==='65','Morph panel not synced');
   assert(base.value==='1'&&base.disabled,'native S must remain 1');
   document.querySelector('#morphProfileBindings [data-morph-special="orbits"] input[type=checkbox]').click();
   assert(!host.classList.contains('morph-live'),'blue slider not hidden after disable');
   assert(host.querySelector('.blue-morph-dual-min').disabled,'disabled Morph thumb still editable');
   assert(document.querySelector('#morphProfileBindings [data-morph-special="orbits"]'),'disabled row removed');
   document.querySelector('#morphProfileBindings [data-morph-special="orbits"] input[type=checkbox]').click();
   assert(host.classList.contains('morph-live'),'blue slider not restored after resume');
   const layer=state.layers.find(l=>l.id===state.activeLayerId)||state.layers[0];
   layer.N=8;layer.K=2;layer.chaosStar=false;syncSidebarInputs();syncMorphRouteDecorations();
   assert(base.disabled===false&&base.max==='2','S=2 original edit should be available');
   assert(!host.classList.contains('morph-live'),'with editable S and no active Morph, original S control should show');
   assert(host.querySelector('.blue-morph-dual-max').disabled===true,'hidden Morph thumb should not receive input');
   runtimeState.morph.active=true;syncMorphRouteDecorations();
   assert(host.classList.contains('morph-live'),'when Morph runs, S dual range must show');
   assert(host.querySelector('.blue-morph-dual-max').disabled===false,'active Morph max thumb should be editable');
   runtimeState.morph.active=false;syncMorphRouteDecorations();
   assert(!host.classList.contains('morph-live'),'stopped Morph should restore normal S input');
   return {start,enabled:true,update:state.morph.orbitPercentMax,baseS:base.value,editableS:base.max,afterRestore:host.className,blueThumbs:host.querySelectorAll('.blue-morph-dual').length};
  })()`,{timeoutMs:15000});
  console.log(JSON.stringify(result,null,2));
  const exc=uncaughtExceptions(h.events);if(exc.length)throw Error('Browser exception: '+exc.slice(0,3));
 }finally{await h.close();}
})().catch(e=>{console.error(e.stack);process.exit(1)});
