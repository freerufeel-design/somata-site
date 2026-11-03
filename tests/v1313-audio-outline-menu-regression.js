'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:180,evalTimeoutMs:40000});
 try{
  const x=await h.evaluate(`(async()=>{
   const ar=state.audioReactive;ensureAudioRoutingState();
   const panel=document.getElementById('audioRoutingPanel');
   if(panel.classList.contains('hidden'))document.getElementById('btnAudioRouting').click();
   const line=document.getElementById('audioGroupLine');line.click();
   const menu=document.getElementById('audioGroupLineMenu');
   const all=[...menu.querySelectorAll('button[data-parameter-id]')].map(b=>({id:b.dataset.parameterId,text:b.textContent}));
   const visibleOnOpen=!menu.classList.contains('hidden');
   const multiplier=all.filter(x=>x.id.endsWith('Multiplier'));
   const allCatalog=flatAudioParameterOptions();
   const redundant=allCatalog.filter(d=>d.key.endsWith('Multiplier')&&window.SomataParameterRegistry.get(window.SomataParameterMatrix.parentId(d.key)||d.key.slice(0,-10)));
   const lineHeaders=[...new Set(allCatalog.map(d=>d.group))].filter(g=>g==='Линия').length;
   const outline=all.filter(x=>x.id.startsWith('outline.'));
   const glow=all.filter(x=>x.id.startsWith('layer.glow'));
   document.getElementById('audioRoutingPreset').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
   const closedInsidePanel=menu.classList.contains('hidden');
   line.click();
   document.getElementById('btnAudioRouting').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
   const closedOutsidePanel=menu.classList.contains('hidden');
   line.click();
   const colorBtn=menu.querySelector('button[data-parameter-id="outline.color"]');
   colorBtn.click();
   const selected=ar.routes.master.some(r=>r.param==='outline.color');
   const stillOpen=!menu.classList.contains('hidden');
   document.getElementById('audioRoutingPreset').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
   const closedAfterSelect=menu.classList.contains('hidden');
   // The audio route picker uses exactly the same catalog.
   const routePicker=document.querySelector('#audioRoutingPanel .audio-route-row .audio-param-picker-button');
   if(!routePicker)throw new Error('Missing routing picker');
   routePicker.click();
   const picker=[...document.querySelectorAll('#audioViewportPopupPortal .audio-param-menu:not(.hidden)')].at(-1);
   const pickerOptions=[...picker.querySelectorAll('[data-parameter-id]')].map(b=>b.dataset.parameterId);
   document.getElementById('audioRoutingPreset').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
   const pickerClosed=picker.classList.contains('hidden');
   // Test real audio math with fixed band, not mocked render math.
   ar.active=true;ar.levels=[1,1,1,1,1];ar.derivatives=[0,0,0,0,0];
   ar.effectsAmplitudeStrength=200;ar.effectsAmplitudeMultiplier=1;
   ar.routes.master=[];
   const clear=()=>{ar.routes.master.length=0;for(const id of Object.keys(ar.routes.layers||{}))ar.routes.layers[id]=[];};
   const add=(id,mode='add')=>ar.routes.master.push(createAudioRoute('low',id,100,1,true,false,mode));
   const layer=state.layers[0];const config=state.lineOutline;
   config.enabled=true;config.layerCount=0;config.color='#ff0000';config.mode='outer';config.width=1.5;
   const context=()=>({layer, effectLayer:layer,layerIndex:0,strokeWidth:3,geometryPlan:{kind:'polygon'},lineProfileApplication:'stroke'});
   const get=()=>resolveLayerOutlineEffectProvider(context(),resetOutlineEffectPlan({}));
   clear();const baseline=get();
   add('outline.layerCount');const activated=get();
   add('outline.width');const wider=get();
   add('outline.color');const shifted=get();
   add('outline.mode');const repositioned=get();
   const authored={...state.lineOutline};
   clear();ar.active=false;const restored=get();
   return {visibleOnOpen,all,multiplier,redundant,lineHeaders,outline,glow,closedInsidePanel,closedOutsidePanel,selected,stillOpen,closedAfterSelect,pickerOptions,pickerClosed,
     baseline:{enabled:baseline.enabled}, activated:{enabled:activated.enabled,extra:activated.extra,color:activated.color,mode:activated.mode},
     wider:{extra:wider.extra},shifted:{color:shifted.color},repositioned:{mode:repositioned.mode},authored,restored:{enabled:restored.enabled}};
  })()`,{timeoutMs:40000,label:'Audio outline and menu regression'});
  assert(x.visibleOnOpen,'line group popup did not open');
  assert.deepEqual(x.multiplier,[],'redundant multiplier still in Audio line category');
  assert.deepEqual(x.redundant,[],'redundant multiplier still exists somewhere in Audio catalog');
  assert.equal(x.lineHeaders,1,'Line group missing');
  assert(x.glow.some(o=>o.id==='layer.glow'),'actual line glow disappeared');
  assert.deepEqual(x.outline.map(o=>o.id),['outline.layerCount','outline.width','outline.color','outline.mode']);
  assert(x.closedInsidePanel,'outside pointerdown INSIDE audio panel failed to close portaled menu');
  assert(x.closedOutsidePanel,'outside pointerdown OUTSIDE audio panel failed to close menu');
  assert(x.selected&&x.stillOpen,'multi-select/audio binding popup changed unexpectedly');
  assert(x.closedAfterSelect,'outside pointerdown after selection failed to close menu');
  assert(x.pickerClosed,'audio row picker not closing on outside pointerdown');
  assert(!x.pickerOptions.includes('layer.glowMultiplier'),'picker still exposes glow multiplier');
  for(const key of ['outline.layerCount','outline.width','outline.color','outline.mode'])assert(x.pickerOptions.includes(key),'picker missing '+key);
  assert.equal(x.baseline.enabled,false,'global outline baseline');
  assert.equal(x.activated.enabled,true,'numeric audio outline layer-count has no render effect');
  assert(x.wider.extra>x.activated.extra,'audio outline width not modulated');
  assert.notEqual(x.shifted.color,x.activated.color,'audio outline color did not change');
  assert.notEqual(x.repositioned.mode,x.activated.mode,'audio outline placement did not change');
  assert.deepEqual(x.authored,{enabled:true,layerCount:0,color:'#ff0000',width:1.5,mode:'outer'},'audio incorrectly changed authored outline');
  assert.equal(x.restored.enabled,false,'outline did not return to authored layer count');
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS Audio: outside popup dismissal, complete outline properties, no multiplier duplicates, real per-frame modulation');
 }finally{await h.close();}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
