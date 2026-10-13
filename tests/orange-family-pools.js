const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(cond,msg)=>{if(!cond)throw new Error(msg);};
async function main(){
  const h=await createBrowserHarness({disableGpu:true,loadDelayMs:160,evalTimeoutMs:20000});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const r=await h.evaluate(`(async()=>{
      const firstRow=document.querySelector('#randomSettingsPanel .morph-settings-grid > .morph-setting-row');
      const defaultFirst=Boolean(firstRow?.querySelector('#minimalMorphDefaultActive'));
      const blueBefore={family:state.morph.shapeOptions.family,groups:[...(state.morph.shapeOptions.profileGroups||[])]};
      state.morph.shapeOptions.family='triangle';state.morph.shapeOptions.profileGroups=['loops'];syncMorphShapeToggleButtons?.();
      const bluePinned={family:state.morph.shapeOptions.family,groups:[...(state.morph.shapeOptions.profileGroups||[])]};
      const family=document.getElementById('minimalMorphFamily');family.value='square';family.dispatchEvent(new Event('change',{bubbles:true}));
      for(const el of document.querySelectorAll('[data-orange-profile-group]')){el.checked=['standard','closed'].includes(el.dataset.orangeProfileGroup);el.dispatchEvent(new Event('change',{bubbles:true}));}
      // The per-checkbox handler protects against an empty set while changes are applied sequentially;
      // force the requested final multi-pool state once, then sync through a real checkbox event.
      for(const el of document.querySelectorAll('[data-orange-profile-group]'))el.checked=['standard','closed'].includes(el.dataset.orangeProfileGroup);
      document.querySelector('[data-orange-profile-group="closed"]').dispatchEvent(new Event('change',{bubbles:true}));
      const orangeState={family:state.minimalMorph.family,groups:[...(state.minimalMorph.profileGroups||[])],summary:document.getElementById('minimalMorphProfileGroupSummary')?.textContent||''};
      const blueAfterOrange={family:state.morph.shapeOptions.family,groups:[...(state.morph.shapeOptions.profileGroups||[])]};
      const count=document.getElementById('randomLayerCount');count.value='4';count.dispatchEvent(new Event('change',{bubbles:true}));
      document.getElementById('btnRandomPreset').click();await new Promise(r=>setTimeout(r,20));
      const diceKeys=state.layers.map(l=>getExactProfilePresetKey(l));
      const diceMeta=diceKeys.map(k=>PROFILE_PRESET_META[k]||null);
      const allowed=new Set([...(PROFILE_PRESET_GROUPS.standard||[]),...(PROFILE_PRESET_GROUPS.closed||[])]);
      const diceOk=diceKeys.length===4&&diceKeys.every(k=>allowed.has(k)&&PROFILE_PRESET_META[k]?.family==='square');
      const instant=document.getElementById('minimalMorphInstant');instant.checked=true;instant.dispatchEvent(new Event('change',{bubbles:true}));
      const orange=document.getElementById('btnMinimalMorph');orange.click();await new Promise(r=>setTimeout(r,60));
      const morphKeys=state.layers.map(l=>getExactProfilePresetKey(l));
      const morphOk=morphKeys.length===4&&morphKeys.every(k=>allowed.has(k)&&PROFILE_PRESET_META[k]?.family==='square');
      if(runtimeState.minimalMorph.active)orange.click();
      return{defaultFirst,blueBefore,bluePinned,blueAfterOrange,orangeState,diceKeys,diceMeta,diceOk,morphKeys,morphOk};
    })()`);
    assert(r.defaultFirst,'Orange “Морфить по умолчанию” row is not first');
    assert(r.orangeState.family==='square','Orange family did not persist independently');
    assert(JSON.stringify(r.orangeState.groups)===JSON.stringify(['standard','closed']),`Orange multi-pool state wrong: ${JSON.stringify(r.orangeState)}`);
    assert(r.blueAfterOrange.family===r.bluePinned.family&&JSON.stringify(r.blueAfterOrange.groups)===JSON.stringify(r.bluePinned.groups),'Orange controls modified Blue Morph family/pools');
    assert(r.diceOk,`Random composition ignored Orange square + multi-pool filter: ${JSON.stringify(r.diceKeys)}`);
    assert(r.morphOk,`Orange Morph ignored Orange square + multi-pool filter: ${JSON.stringify(r.morphKeys)}`);
    const errors=uncaughtExceptions(h.events).slice(baseline);assert(!errors.length,`uncaught browser exceptions: ${errors.join(' | ')}`);
    console.log('ORANGE FAMILY/POOLS: PASS',r);
  }finally{await h.close();}
}
main().catch(err=>{console.error('ORANGE FAMILY/POOLS: FAIL',err);process.exit(1);});
