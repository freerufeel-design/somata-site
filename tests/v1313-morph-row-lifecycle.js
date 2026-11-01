'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:150,evalTimeoutMs:25000});
 try{
 const result=await h.evaluate(`(async()=>{
  const delay=()=>new Promise(r=>setTimeout(r,20));
  const blue=kind=>document.querySelector('#morphProfileBindings [data-morph-special="'+kind+'"]');
  const orange=kind=>document.querySelector('#orangeMorphBindings [data-orange-special="'+kind+'"]');
  const status=row=>!row?'absent':row.querySelector('input[type=checkbox]')?.checked?'active':row.classList.contains('disabled')?'paused':'not-muted';
  state.morph.activeProfileId='standard';toggleMorphSettingsPanel(true);syncMorphProfileUI();renderMorphProfileBindings();
  syncSidebarInputs();syncMorphRouteDecorations();
  const initial={blueOrbit:state.morph.monoOrbitTransforms,orangeOrbit:state.randomOptions.orbitBindingEnabled,blueRow:status(blue('orbits')),orangeRow:status(orange('orbits')),left:[...document.querySelector('#suborbitsContainer .row-label')?.classList||[]],disabled:document.getElementById('paramSuborbits').disabled};
  const b=blue('orbits')?.querySelector('input[type=checkbox]');b.checked=false;b.dispatchEvent(new Event('change',{bubbles:true}));await delay();
  const bluePaused={state:state.morph.monoOrbitTransforms,shown:status(blue('orbits'))};
  const bb=blue('orbits')?.querySelector('input[type=checkbox]');bb.checked=true;bb.dispatchEvent(new Event('change',{bubbles:true}));await delay();
  const blueRestored={state:state.morph.monoOrbitTransforms,shown:status(blue('orbits'))};
  // Orange independently on/off and preserves presence when unchecked.
  const orangeStart=state.randomOptions.orbitBindingEnabled;
  const oc=orange('orbits')?.querySelector('input[type=checkbox]');
  if(!oc){window.__probeOrangeMissing=true;}
  else{oc.checked=!orangeStart;oc.dispatchEvent(new Event('change',{bubbles:true}));await delay();}
  const orangeToggled={state:state.randomOptions.orbitBindingEnabled,shown:status(orange('orbits'))};
  const oc2=orange('orbits')?.querySelector('input[type=checkbox]');if(oc2){oc2.checked=orangeStart;oc2.dispatchEvent(new Event('change',{bubbles:true}));await delay();}
  const orangeBack={state:state.randomOptions.orbitBindingEnabled,shown:status(orange('orbits'))};
  const specials=['shape','orbits','chaos','spiralLayers','spiralOrder'];
  const specialStates=[];
  for(const kind of specials){
   // Add through the shared catalog, then pause and reactivate using the row checkbox.
   setMorphSpecialEnabled(kind,true);await delay();
   const r=blue(kind),cb=r?.querySelector('input[type=checkbox]');
   if(cb){cb.checked=false;cb.dispatchEvent(new Event('change',{bubbles:true}));await delay();}
   const paused=status(blue(kind));
   const cb2=blue(kind)?.querySelector('input[type=checkbox]');if(cb2){cb2.checked=true;cb2.dispatchEvent(new Event('change',{bubbles:true}));await delay();}
   const active=status(blue(kind));
   const x=blue(kind)?.querySelector('.morph-binding-remove');if(x){x.click();await delay();}
   specialStates.push({kind,paused,active,removed:status(blue(kind))});
  }
  const os=[];for(const [kind,id] of [['shape','geometry.shape'],['orbits','geometry.orbits'],['chaos','geometry.chaos'],['spiralLayers','spiral.layers'],['spiralOrder','spiral.order']]){
   setOrangeSpecialParameterEnabled(id,true);await delay();
   const c=orange(kind)?.querySelector('input[type=checkbox]');if(c){c.checked=false;c.dispatchEvent(new Event('change',{bubbles:true}));await delay();}
   const paused=status(orange(kind));
   const c2=orange(kind)?.querySelector('input[type=checkbox]');if(c2){c2.checked=true;c2.dispatchEvent(new Event('change',{bubbles:true}));await delay();}
   const active=status(orange(kind));
   const x=orange(kind)?.querySelector('.morph-binding-remove');if(x){x.click();await delay();}
   os.push({kind,paused,active,removed:status(orange(kind))});
  }
  // An authored-but-paused route must survive saving and reloading a profile.
  setOrangeSpecialParameterEnabled('geometry.orbits',true);await delay();
  const persC=orange('orbits')?.querySelector('input[type=checkbox]');if(persC){persC.checked=false;persC.dispatchEvent(new Event('change',{bubbles:true}));}else{window.__persistMissing='orange';}await delay();
  const orangeStore=window.SomataOrangeMorphProfiles;orangeStore.save(state.minimalMorph,state.randomOptions,state.randomLayerCount);
  const persistedFlag=orangeStore.activeProfile(state.minimalMorph,state.randomOptions,state.randomLayerCount)?.config?.randomOptions?.orbitsAdded;
  state.randomOptions.orbitsAdded=false;state.randomOptions.orbitBindingEnabled=true;
  orangeStore.reset(state.minimalMorph,state.randomOptions,{value:state.randomLayerCount});
  renderOrangeMorphRoutingGroups();
  const afterReload={flag:state.randomOptions.orbitsAdded,active:state.randomOptions.orbitBindingEnabled,row:status(orange('orbits')),persistedFlag};
  toggleMorphSettingsPanel(true);syncMorphProfileUI();setMorphSpecialEnabled('orbits',true);await delay();
  const blueCb=blue('orbits')?.querySelector('input[type=checkbox]');if(blueCb){blueCb.checked=false;blueCb.dispatchEvent(new Event('change',{bubbles:true}));}else{window.__persistMissing='blue';}await delay();
  const routing=window.SomataMorphParameterRouting;routing.saveActiveProfile(state.morph,state.minimalMorph);
  const blueFlag=getActiveMorphProfile()?.config?.options?.orbitsAdded;
  state.morph.options.orbitsAdded=false;state.morph.monoOrbitTransforms=true;
  routing.resetActiveProfile(state.morph,state.minimalMorph);syncMorphSettingsUI();renderMorphProfileBindings();
  const blueReload={flag:state.morph.options.orbitsAdded,active:state.morph.monoOrbitTransforms,row:status(blue('orbits')),persistedFlag:blueFlag};
  return {initial,bluePaused,blueRestored,orangeToggled,orangeBack,specialStates,orangeSpecialStates:os,orangeProbeMissing:window.__probeOrangeMissing===true,persistMissing:window.__persistMissing||null,afterReload,blueReload};
 })()`,{timeoutMs:25000,label:'v13.0.13 shared special lifecycle'});
 console.log(JSON.stringify(result,null,2));
 assert.equal(result.initial.blueOrbit,true,'blue factory orbit');
 assert.equal(result.initial.orangeOrbit,false,'orange factory orbit');
 assert.equal(result.initial.blueRow,'active','blue factory row');
 assert.equal(result.bluePaused.shown,'paused');assert.equal(result.blueRestored.shown,'active');
 for(const row of [...result.specialStates,...result.orangeSpecialStates])assert.deepEqual([row.paused,row.active,row.removed],['paused','active','absent'],JSON.stringify(row));
 assert.deepEqual(result.afterReload,{flag:true,active:false,row:'paused',persistedFlag:true},'orange profile persistence');
 assert.deepEqual(result.blueReload,{flag:true,active:false,row:'paused',persistedFlag:true},'blue profile persistence');
 assert(!uncaughtExceptions(h.events).length,uncaughtExceptions(h.events).join('\n'));
 console.log('PASS v13.0.13 common Morph special row lifecycle');
 }finally{await h.close();}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
