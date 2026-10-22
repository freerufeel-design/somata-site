const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(cond,msg)=>{if(!cond)throw new Error(msg);};

async function main(){
  const h=await createBrowserHarness({disableGpu:true,evalTimeoutMs:15000});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const r=await h.evaluate(`(async()=>{
      const routing=window.SomataMorphParameterRouting;
      routing.ensureProfiles(state.morph,state.minimalMorph);syncMorphSettingsUI();syncMorphProfileUI();
      document.getElementById('btnMorphSettings')?.click();await new Promise(r=>setTimeout(r,20));syncMorphProfileUI();
      const standard=routing.activeProfile(state.morph,state.minimalMorph),working=()=>routing.workingBindings(state.morph,state.minimalMorph,standard);
      const initial={saved:standard.bindings.map(b=>[b.parameter,b.enabled]),working:working().map(b=>[b.parameter,b.enabled]),opacityRow:!!document.querySelector('#morphProfileBindings [data-morph-parameter="layer.opacity"]'),inactiveRows:working().filter(b=>b.enabled===false).map(b=>b.parameter),masterHeader:document.getElementById('btnMorphMasterMode')?.textContent?.trim(),oldBadges:!!document.getElementById('morphProfileEngineBadge')||!!document.getElementById('morphProfileTargetBadge'),saveLabel:document.getElementById('btnSaveMorphProfile')?.getAttribute('aria-label')||document.getElementById('btnSaveMorphProfile')?.title,saveIcon:!!document.querySelector('#btnSaveMorphProfile svg'),reset:document.getElementById('btnResetMorphProfile')?.textContent?.trim()};

      const removeId=working().find(b=>b.parameter==='layer.strokeWidth')?'layer.strokeWidth':working()[0]?.parameter;
      const rm=document.querySelector('#morphProfileBindings [data-morph-parameter="'+removeId+'"] .morph-binding-remove');rm?.click();await new Promise(r=>setTimeout(r,10));
      const afterRemove={id:removeId,dirty:routing.isActiveProfileDirty(state.morph,state.minimalMorph),workingHas:working().some(b=>b.parameter===removeId),savedHas:standard.bindings.some(b=>b.parameter===removeId),button:document.getElementById('btnSaveMorphProfile')?.textContent?.trim(),select:document.getElementById('morphProfileSelect')?.selectedOptions?.[0]?.textContent||''};
      const snapshotBefore=buildProjectData();const snapBeforeHas=snapshotBefore.settings.morph.profiles.find(p=>p.id==='standard')?.bindings?.some(b=>b.parameter===removeId)===true;

      document.getElementById('btnResetMorphProfile')?.click();await new Promise(r=>setTimeout(r,10));
      const afterReset={dirty:routing.isActiveProfileDirty(state.morph,state.minimalMorph),workingHas:working().some(b=>b.parameter===removeId),savedHas:standard.bindings.some(b=>b.parameter===removeId)};

      document.querySelector('#morphProfileBindings [data-morph-parameter="'+removeId+'"] .morph-binding-remove')?.click();await new Promise(r=>setTimeout(r,10));document.getElementById('btnSaveMorphProfile')?.click();await new Promise(r=>setTimeout(r,10));
      const afterSave={dirty:routing.isActiveProfileDirty(state.morph,state.minimalMorph),workingHas:working().some(b=>b.parameter===removeId),savedHas:standard.bindings.some(b=>b.parameter===removeId),saveDisabled:document.getElementById('btnSaveMorphProfile')?.disabled===true};
      const snapshotAfter=buildProjectData();const snapAfterHas=snapshotAfter.settings.morph.profiles.find(p=>p.id==='standard')?.bindings?.some(b=>b.parameter===removeId)===true;

      const oldPrompt=window.prompt;let promptCalls=0;window.prompt=()=>{promptCalls++;return 'Empty Standard';};document.getElementById('btnNewMorphProfile')?.click();await new Promise(r=>setTimeout(r,10));
      const fresh=routing.activeProfile(state.morph,state.minimalMorph),freshWork=routing.workingBindings(state.morph,state.minimalMorph,fresh);const beforeSaveSnapshot=buildProjectData();const transientPersisted=beforeSaveSnapshot.settings.morph.profiles.some(p=>p.id===fresh.id);const created={type:fresh.type,savedCount:fresh.bindings.length,workingCount:freshWork.length,rowCount:document.querySelectorAll('#morphProfileBindings .morph-binding-row').length,dirty:routing.isActiveProfileDirty(state.morph,state.minimalMorph),transient:fresh.transient===true,promptCallsAfterCreate:promptCalls,transientPersisted,saveDisabled:document.getElementById('btnSaveMorphProfile')?.disabled===true};
      document.getElementById('btnSaveMorphProfile')?.click();await new Promise(r=>setTimeout(r,10));window.prompt=oldPrompt;const named=routing.activeProfile(state.morph,state.minimalMorph);created.nameAfterSave=named.name;created.transientAfterSave=named.transient===true;created.promptCallsAfterSave=promptCalls;
      return{initial,afterRemove,snapBeforeHas,afterReset,afterSave,snapAfterHas,created};
    })()`,{timeoutMs:15000,label:'7.9.10 explicit Morph Profile save'});

    assert(r.initial.opacityRow===false,'inactive default Line / Opacity row is still materialized in Standard');
    assert(r.initial.inactiveRows.length===0,'system Standard starts with inactive rows: '+r.initial.inactiveRows.join(','));
    assert(r.initial.masterHeader==='Master'&&!r.initial.oldBadges,'Master was not moved to header / old Standard-Master badges remain');
    assert(/Сохранить/.test(r.initial.saveLabel||'')&&r.initial.saveIcon&&r.initial.reset==='Сбросить всё','explicit diskette Save / Reset controls missing');
    assert(r.afterRemove.id&&r.afterRemove.dirty&&r.afterRemove.workingHas===false&&r.afterRemove.savedHas===true,'removing a Standard row did not create an unsaved draft');
    assert(r.snapBeforeHas===true,'project snapshot implicitly committed an unsaved Morph draft');
    assert(r.afterReset.dirty===false&&r.afterReset.workingHas===true&&r.afterReset.savedHas===true,'Reset All did not restore the last saved profile');
    assert(r.afterSave.dirty===false&&r.afterSave.workingHas===false&&r.afterSave.savedHas===false&&r.afterSave.saveDisabled,'Save Profile did not commit the working draft');
    assert(r.snapAfterHas===false,'saved Morph Profile was not persisted into project snapshot');
    assert(r.created.type==='standard'&&r.created.savedCount===0&&r.created.workingCount===0&&r.created.rowCount===0&&!r.created.dirty&&r.created.transient&&r.created.promptCallsAfterCreate===0&&!r.created.transientPersisted&&!r.created.saveDisabled,'new Standard profile must be empty transient and excluded from project snapshot');
    assert(r.created.nameAfterSave==='Empty Standard'&&!r.created.transientAfterSave&&r.created.promptCallsAfterSave===1,'first Save did not request/name the transient Standard profile');
    const exc=uncaughtExceptions(h.events).slice(baseline);assert(exc.length===0,'uncaught browser exceptions: '+exc.join(' | '));
    console.log('7.9.10 MORPH PROFILE EXPLICIT SAVE REGRESSION: PASS',r);
  }finally{await h.close();}
}
main().catch(e=>{console.error('FAIL 7.9.10 Morph Profile explicit save regression:',e.stack||e.message);process.exit(1);});
