'use strict';
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{const h=await createBrowserHarness({loadDelayMs:140,evalTimeoutMs:20000});try{
 const out=await h.evaluate(`(async()=>{
  const assert=(v,m)=>{if(!v)throw Error(m)};
  const blue=document.getElementById('morphSettingsPanel'),orange=document.getElementById('minimalMorphSettingsPanel');
  const rows=[];
  for(const kind of ['shape','chaos','orbits','spiralLayers','spiralOrder']){
    blue.classList.remove('hidden');
    setMorphSpecialEnabled(kind,true);renderMorphProfileBindings();
    const selector='#morphProfileBindings [data-morph-special="'+kind+'"]';
    const row=document.querySelector(selector);assert(row,'Blue missing '+kind);
    row.querySelector('input[type=checkbox]').click();
    blue.classList.remove('hidden');renderMorphProfileBindings();
    const paused=document.querySelector(selector);assert(paused,'Blue disappeared '+kind);
    assert(paused.classList.contains('disabled'),'Blue not gray '+kind);
    assert(paused.querySelector('input[type=checkbox]').checked===false,'Blue checkbox not cleared '+kind);
    paused.querySelector('input[type=checkbox]').click();
    blue.classList.remove('hidden');renderMorphProfileBindings();
    const reenabled=document.querySelector(selector);assert(reenabled?.querySelector('input[type=checkbox]')?.checked,'Blue not reenabled '+kind);
    reenabled.querySelector('button.morph-binding-remove')?.click();
    blue.classList.remove('hidden');renderMorphProfileBindings();
    assert(!document.querySelector(selector),'Blue × should remove '+kind);
    rows.push({mode:'blue',kind,paused:true,reenabled:true,removed:true});
  }
  for(const [kind,id] of [['orbits','geometry.orbits'],['shape','geometry.shape'],['chaos','geometry.chaos'],['spiralLayers','spiral.layers'],['spiralOrder','spiral.order']]){
    setOrangeSpecialParameterEnabled(id,true);renderOrangeMorphBindings();
    const selector='#orangeMorphBindings [data-orange-special="'+kind+'"]';
    const row=document.querySelector(selector);assert(row,'Orange missing '+kind);
    row.querySelector('input[type=checkbox]').click();
    renderOrangeMorphBindings();
    const paused=document.querySelector(selector);assert(paused,'Orange disappeared '+kind);
    assert(paused.classList.contains('disabled'),'Orange not gray '+kind);
    assert(paused.querySelector('input[type=checkbox]').checked===false,'Orange checkbox not cleared '+kind);
    paused.querySelector('input[type=checkbox]').click();renderOrangeMorphBindings();
    const reenabled=document.querySelector(selector);assert(reenabled?.querySelector('input[type=checkbox]')?.checked,'Orange not reenabled '+kind);
    reenabled.querySelector('button.morph-binding-remove')?.click();renderOrangeMorphBindings();
    assert(!document.querySelector(selector),'Orange × should remove '+kind);
    rows.push({mode:'orange',kind,paused:true,reenabled:true,removed:true});
  }
  // All state lives in project/profile data and survives in snapshots.
  setMorphSpecialEnabled('orbits',true);
  setMorphSpecialRowActive('orbits',false);
  const draft=window.SomataMorphParameterRouting.captureActiveDraft(state.morph,state.minimalMorph);
  assert(draft.config.options.orbitsAdded===true,'Blue orbit row presence not persisted');
  assert(draft.config.monoOrbitTransforms===false,'Blue orbit disabled state not persisted');
  setOrangeSpecialParameterEnabled('geometry.orbits',true);
  setOrangeSpecialRowActive('geometry.orbits',false);
  assert(state.randomOptions.orbitsAdded===true&&state.randomOptions.orbitBindingEnabled===false,'Orange persistence failed');
  return {rows,savedBlue:{added:draft.config.options.orbitsAdded,active:draft.config.monoOrbitTransforms},savedOrange:{added:state.randomOptions.orbitsAdded,active:state.randomOptions.orbitBindingEnabled}};
 })()`,{timeoutMs:20000});
 console.log(JSON.stringify(out,null,2));const errors=uncaughtExceptions(h.events);if(errors.length)console.log('Browser exceptions',errors.slice(0,5));
 }finally{await h.close()}})().catch(e=>{console.error(e.stack);process.exit(1)});
