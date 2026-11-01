'use strict';
// Spiral special rows: checkbox means pause, X means remove. Values survive
// pause/re-enable, profile switches and serialization, including legacy data.
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
  const h=await createBrowserHarness({disableGpu:true,evalTimeoutMs:18000,loadDelayMs:190});
  try{
    const result=await h.evaluate(`(async()=>{
      const rt=window.SomataMorphParameterRouting;
      rt.ensureProfiles(state.morph,state.minimalMorph);
      document.getElementById('btnMorphSettings')?.click();
      await new Promise(resolve=>setTimeout(resolve,20));
      syncMorphProfileUI();
      // This test intentionally uses the public Blue controls and the real
      // checked input in the rendered routing row.
      const checks=[];
      const ids=[['spiralLayers','morphBySpiralLayers','bySpiralLayers','spiralLayersAdded','morphSpiralLayersMin','morphSpiralLayersMax',3,7],['spiralOrder','morphBySpiralOrder','bySpiralOrder','spiralOrderAdded','morphSpiralOrderMin','morphSpiralOrderMax',-4,5]];
      for(const [kind,control,opt,added,minId,maxId,min,max] of ids){
        // A new special row is added from the original Blue control.
        const source=document.getElementById(control);source.checked=true;source.dispatchEvent(new Event('change',{bubbles:true}));
        renderMorphProfileBindings();
        const row=()=>document.querySelector('#morphProfileBindings [data-morph-special="'+kind+'"]');
        if(!row())throw Error('missing '+kind+' initially: '+JSON.stringify({state:state.morph.options[opt],added:state.morph.options[added],profile:rt.activeProfile(state.morph,state.minimalMorph)?.type,rows:document.getElementById('morphProfileBindings')?.children.length}));
        const low=document.getElementById(minId),high=document.getElementById(maxId);
        low.value=String(min);low.dispatchEvent(new Event('change',{bubbles:true}));
        high.value=String(max);high.dispatchEvent(new Event('change',{bubbles:true}));
        renderMorphProfileBindings();
        const before=[Number(state.morph[minId.slice(5,6).toLowerCase()+minId.slice(6)]), Number(state.morph[maxId.slice(5,6).toLowerCase()+maxId.slice(6)])];
        // The row's checkbox must NOT be a delete button.
        const cb=row().querySelector(':scope > input[type=checkbox]');cb.click();
        await new Promise(resolve=>setTimeout(resolve,0));
        const off={present:!!row(),checked:row()?.querySelector(':scope > input[type=checkbox]')?.checked,active:state.morph.options[opt],added:state.morph.options[added],values:[low.value,high.value],rowPaused:row()?.classList.contains('morph-spiral-paused')};
        if(!off.present)throw Error('row was deleted by checkbox: '+kind);
        row().querySelector(':scope > input[type=checkbox]').click();
        await new Promise(resolve=>setTimeout(resolve,0));
        const on={present:!!row(),checked:row()?.querySelector(':scope > input[type=checkbox]')?.checked,active:state.morph.options[opt],added:state.morph.options[added],values:[document.getElementById(minId).value,document.getElementById(maxId).value],sameRange:Number(state.morph[minId.slice(5,6).toLowerCase()+minId.slice(6)])===before[0]&&Number(state.morph[maxId.slice(5,6).toLowerCase()+maxId.slice(6)])===before[1]};
        // Pause again and ensure saving the profile persists the paused line.
        row().querySelector(':scope > input[type=checkbox]').click();
        await new Promise(resolve=>setTimeout(resolve,0));
        const snapshot=buildProjectData().settings.morph;
        const snapshotOptions=snapshot.options;
        // Removing with the X is intentionally a different operation.
        row().querySelector('.morph-binding-remove').click();
        await new Promise(resolve=>setTimeout(resolve,0));
        const removed={present:!!row(),active:state.morph.options[opt],added:state.morph.options[added]};
        checks.push({kind,before,off,on,snapshot:{active:snapshotOptions[opt],added:snapshotOptions[added]},removed});
      }
      // The paused row is a profile-editable configuration, independent of
      // active morph playback. Verify save/switch/restore on genuine profiles.
      const originalProfile=rt.activeProfile(state.morph,state.minimalMorph);
      const sourceOrder=document.getElementById('morphBySpiralOrder');
      sourceOrder.checked=true;sourceOrder.dispatchEvent(new Event('change',{bubbles:true}));
      renderMorphProfileBindings();
      document.querySelector('#morphProfileBindings [data-morph-special="spiralOrder"] > input[type=checkbox]').click();
      await new Promise(resolve=>setTimeout(resolve,0));
      rt.saveActiveProfile(state.morph,state.minimalMorph);
      const persisted=rt.persistentMorphSnapshot(state.morph,state.minimalMorph);
      const stored=persisted.profiles.find(x=>x.id===originalProfile.id)?.config?.options;
      const fresh=rt.createProfile(state.morph,state.minimalMorph,'standard','Temp check');
      renderMorphProfileBindings();
      const freshAbsent=!document.querySelector('#morphProfileBindings [data-morph-special="spiralOrder"]');
      rt.selectProfile(state.morph,state.minimalMorph,originalProfile.id);
      syncMorphProfileUI();renderMorphProfileBindings();
      const restoredRow=document.querySelector('#morphProfileBindings [data-morph-special="spiralOrder"]');
      const profiles={saved:{added:stored?.spiralOrderAdded,active:stored?.bySpiralOrder},freshAbsent,restored:{present:!!restoredRow,checked:restoredRow?.querySelector(':scope > input[type=checkbox]')?.checked,range:[state.morph.spiralOrderMin,state.morph.spiralOrderMax]}};
      // Old saved projects with active Spiral modes but no 'Added' flags
      // must still show the existing rows.
      delete state.morph.options.spiralLayersAdded;
      delete state.morph.options.spiralOrderAdded;
      state.morph.options.bySpiralLayers=true;
      state.morph.options.bySpiralOrder=true;
      renderMorphProfileBindings();
      const legacy={layers:!!document.querySelector('[data-morph-special="spiralLayers"]'),order:!!document.querySelector('[data-morph-special="spiralOrder"]')};
      return{checks,legacy,profiles};
    })()`,{timeoutMs:18000});
    for(const c of result.checks){
      assert(c.off.present&&!c.off.checked&&c.off.active===false&&c.off.added===true&&c.off.rowPaused,`${c.kind} checkbox did not pause`);
      assert(c.on.present&&c.on.checked&&c.on.active===true&&c.on.added===true&&c.on.sameRange,`${c.kind} checkbox did not resume preserved range`);
      assert(c.snapshot.active===false&&c.snapshot.added===true,`${c.kind} pause not serialized`);
      assert(!c.removed.present&&c.removed.active===false&&c.removed.added===false,`${c.kind} remove button did not remove`);
    }
    assert(result.profiles.saved.added===true&&result.profiles.saved.active===false&&result.profiles.freshAbsent&&result.profiles.restored.present&&!result.profiles.restored.checked,'profile save/switch/restore lost paused Spiral row');
    assert(result.legacy.layers&&result.legacy.order,'old projects missing added flags must retain active rows');
    const failures=uncaughtExceptions(h.events);assert.equal(failures.length,0,failures.join('\n'));
    console.log('BLUE SPIRAL CHECKBOX PAUSE REGRESSION: PASS',JSON.stringify(result));
  }finally{await h.close();}
})().catch(e=>{console.error('BLUE SPIRAL CHECKBOX PAUSE REGRESSION: FAIL',e.stack||e);process.exit(1);});
