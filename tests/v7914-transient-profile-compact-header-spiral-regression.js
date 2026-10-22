const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(cond,msg)=>{if(!cond)throw new Error(msg);};

async function main(){
  const h=await createBrowserHarness({disableGpu:true,evalTimeoutMs:18000});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const r=await h.evaluate(`(async()=>{
      const blue=window.SomataMorphParameterRouting,orange=window.SomataOrangeMorphProfiles,R=window.SomataParameterRegistry;
      blue.ensureProfiles(state.morph,state.minimalMorph);orange.ensureProfiles(state.minimalMorph,state.randomOptions,state.randomLayerCount);
      document.getElementById('btnMorphSettings')?.click();await new Promise(r=>setTimeout(r,25));syncMorphProfileUI();
      const compactIds=[...document.querySelectorAll('#morphCompactProfileControls select,#morphCompactProfileControls input')].map(x=>x.id);const toolbarFlagIds=[...document.querySelectorAll('#morphSettingsPanel .morph-profile-toolbar-flags input')].map(x=>x.id);
      const meta=document.querySelector('#morphSettingsPanel .morph-routing-tools-meta');
      const targets=[...document.querySelectorAll('#morphRoutingTargets .morph-routing-target')].map(x=>({tag:x.tagName,text:x.textContent.trim(),disabled:x.getAttribute('aria-disabled'),master:x.classList.contains('morph-routing-target-master')}));
      const shellText=document.getElementById('morphSettingsPanel')?.textContent||'';
      const initialUi={compactIds,toolbarFlagIds,speedTop:document.getElementById('morphSpeedType')?.closest?.('#morphSpeedToolbar')===document.getElementById('morphSpeedToolbar'),hint:meta?.querySelector('.audio-routing-tools-hint')?.textContent||'',orderInsideMeta:meta?.contains(document.getElementById('morphOrderMode'))===true,targets,hasLater:/Слои\s*·\s*позже/i.test(shellText),hasLinkCount:/\b\d+\s+связ(?:ей|и|ь)/i.test(shellText),headerMaster:document.getElementById('btnMorphMasterMode')?.textContent?.trim()};

      let promptCalls=0;const promptNames=['Draft Two','Final Blue','Orange Final'];const oldPrompt=window.prompt;window.prompt=()=>promptNames[promptCalls++]||('Name '+promptCalls);
      document.getElementById('btnNewMorphProfile')?.click();await new Promise(r=>setTimeout(r,10));
      const t1=blue.activeProfile(state.morph,state.minimalMorph),t1Id=t1.id;const snap1=buildProjectData();
      const first={transient:t1.transient===true,name:t1.name,promptCalls,bindings:blue.workingBindings(state.morph,state.minimalMorph,t1).length,persisted:snap1.settings.morph.profiles.some(p=>p.id===t1Id),saveEnabled:document.getElementById('btnSaveMorphProfile')?.disabled===false};

      // A second New while the first draft is unsaved must explicitly offer save / discard / cancel.
      document.getElementById('btnNewMorphProfile')?.click();await new Promise(r=>setTimeout(r,10));
      const dialog1=document.querySelector('.morph-transient-decision-overlay');
      const dialogButtons1=[...dialog1?.querySelectorAll('button')||[]].map(b=>b.textContent.trim());
      [...dialog1?.querySelectorAll('button')||[]].find(b=>b.textContent.includes('Удалить предыдущий'))?.click();await new Promise(r=>setTimeout(r,15));
      const t2=blue.activeProfile(state.morph,state.minimalMorph),t2Id=t2.id;
      const discardFlow={buttons:dialogButtons1,promptCalls,oldGone:!(state.morph.profiles||[]).some(p=>p.id===t1Id),newTransient:t2.transient===true&&t2Id!==t1Id};

      // Saving from that guard asks for a name, commits the prior draft, then creates another unnamed draft.
      document.getElementById('btnNewMorphProfile')?.click();await new Promise(r=>setTimeout(r,10));
      const dialog2=document.querySelector('.morph-transient-decision-overlay');
      [...dialog2?.querySelectorAll('button')||[]].find(b=>b.textContent.includes('Сохранить предыдущий'))?.click();await new Promise(r=>setTimeout(r,20));
      const t3=blue.activeProfile(state.morph,state.minimalMorph);const savedDraft=(state.morph.profiles||[]).find(p=>p.id===t2Id);
      const saveGuard={promptCalls,savedName:savedDraft?.name,savedTransient:savedDraft?.transient===true,newTransient:t3?.transient===true,newId:t3?.id};
      document.getElementById('btnSaveMorphProfile')?.click();await new Promise(r=>setTimeout(r,15));
      const finalBlue=blue.activeProfile(state.morph,state.minimalMorph);const firstSave={promptCalls,name:finalBlue?.name,transient:finalBlue?.transient===true};

      // Orange has the same no-name-on-create / name-on-save contract.
      document.getElementById('btnRandomSettings')?.click();await new Promise(r=>setTimeout(r,25));syncOrangeMorphProfileUI();
      const beforeOrangePrompt=promptCalls;document.getElementById('btnNewOrangeMorphProfile')?.click();await new Promise(r=>setTimeout(r,10));
      const orangeDraft=orange.activeProfile(state.minimalMorph,state.randomOptions,state.randomLayerCount);const orangeCreate={transient:orangeDraft?.transient===true,promptDelta:promptCalls-beforeOrangePrompt};
      document.getElementById('btnSaveOrangeMorphProfile')?.click();await new Promise(r=>setTimeout(r,15));const orangeSaved=orange.activeProfile(state.minimalMorph,state.randomOptions,state.randomLayerCount);const orangeSave={name:orangeSaved?.name,transient:orangeSaved?.transient===true,promptDelta:promptCalls-beforeOrangePrompt};
      window.prompt=oldPrompt;

      // Spiral must be the final shared group in both Blue and Audio and must own the spiral UI/settings.
      document.getElementById('btnMorphSettings')?.click();await new Promise(r=>setTimeout(r,15));syncMorphProfileUI();
      const morphDefs=R.morphable(),audioDefs=R.audioDefinitions();
      const morphGroups=[...new Set(morphDefs.map(d=>d.group))],audioGroups=[...new Set(audioDefs.map(d=>d.group))];
      const spiralDefs=morphDefs.filter(d=>d.group==='Спирали').map(d=>({id:d.id,label:d.label,ui:d.ui?.mainId,exists:!!document.getElementById(d.ui?.mainId)}));
      const spiralBtn=[...document.querySelectorAll('#morphRoutingGroups .audio-route-group-btn')].find(b=>b.textContent.includes('Спирали'));spiralBtn?.click();await new Promise(r=>setTimeout(r,10));const spiralMenu=[...document.querySelectorAll('.audio-route-group-menu:not(.hidden)')].find(x=>[...x.querySelectorAll('.audio-param-option')].some(b=>b.textContent.includes('Спиральные слои')));const spiralLayersOption=[...spiralMenu?.querySelectorAll('.audio-param-option')||[]].find(b=>b.textContent.includes('Спиральные слои'));spiralLayersOption?.click();await new Promise(r=>setTimeout(r,10));const inlineSpiral=document.querySelector('#morphProfileBindings [data-morph-special="spiralLayers"]');
      document.getElementById('btnRandomSettings')?.click();await new Promise(r=>setTimeout(r,15));syncOrangeMorphProfileUI();
      const orangeSpiralRow=document.getElementById('randomBySpiralLayers')?.closest('.morph-setting-row');
      const spiral={morphCount:morphDefs.length,audioCount:audioDefs.length,morphLast:morphGroups.at(-1),audioLast:audioGroups.at(-1),defs:spiralDefs,inlineSpiral:!!inlineSpiral,inlineInputs:inlineSpiral?[...inlineSpiral.querySelectorAll('input')].length:0,noFixedBox:!document.querySelector('.morph-spiral-fixed-settings:not([style*="display: none"])'),orangeGroup:orangeSpiralRow?.dataset.orangeGroup,icon:!!spiralBtn?.querySelector('.spiral-routing-icon')};
      return{initialUi,first,discardFlow,saveGuard,firstSave,orangeCreate,orangeSave,spiral};
    })()`,{timeoutMs:18000,label:'7.9.14 transient profile / compact header / Spiral group'});

    const need=['morphSlideType','morphMode','morphSpiralMorphType','morphCircleProfileOverflow'];
    for(const id of need)assert(r.initialUi.compactIds.includes(id),'compact profile header missing '+id);assert(r.initialUi.speedTop&&!r.initialUi.compactIds.includes('morphSpeedType'),'stable-7.9 speed selector is not restored as a dedicated top control');assert(r.initialUi.toolbarFlagIds.includes('morphDefaultActive')&&r.initialUi.toolbarFlagIds.includes('morphDiversity'),'default/diversity flags are not in the profile toolbar');
    assert(r.initialUi.hint==='Левой кнопкой выбрать параметр · правой кнопкой вкл/выкл'&&r.initialUi.orderInsideMeta,'row-order toggle is not beside the routing hint');
    assert(r.initialUi.headerMaster==='Master'&&r.initialUi.targets[0]?.master&&r.initialUi.targets[0]?.text==='Master','Master target/header not aligned to the new contract');
    assert(r.initialUi.targets.slice(1).every(x=>x.tag==='DIV'&&x.disabled==='true'),'layer targets are clickable before per-layer Morph is implemented');
    assert(!r.initialUi.hasLater&&!r.initialUi.hasLinkCount,'obsolete layers-later / link-count status is still visible');

    assert(r.first.transient&&r.first.promptCalls===0&&r.first.bindings===0&&!r.first.persisted&&r.first.saveEnabled,'New Blue must create an empty transient draft without prompting/persisting');
    assert(r.discardFlow.buttons.includes('Сохранить предыдущий')&&r.discardFlow.buttons.includes('Удалить предыдущий')&&r.discardFlow.buttons.includes('Отмена'),'second New does not offer Save / Delete / Cancel');
    assert(r.discardFlow.promptCalls===0&&r.discardFlow.oldGone&&r.discardFlow.newTransient,'discard-previous flow failed or unexpectedly prompted for a name');
    assert(r.saveGuard.promptCalls===1&&r.saveGuard.savedName==='Draft Two'&&!r.saveGuard.savedTransient&&r.saveGuard.newTransient,'save-previous guard did not name/commit the previous transient profile');
    assert(r.firstSave.promptCalls===2&&r.firstSave.name==='Final Blue'&&!r.firstSave.transient,'first explicit Blue Save did not ask for/commit the profile name');
    assert(r.orangeCreate.transient&&r.orangeCreate.promptDelta===0&&r.orangeSave.name==='Orange Final'&&!r.orangeSave.transient&&r.orangeSave.promptDelta===1,'Orange transient create/save naming contract differs from Blue');

    assert(r.spiral.morphCount>=120&&r.spiral.audioCount>=120,'Blue/Audio routing catalogs unexpectedly lost broad parameter coverage');
    assert(r.spiral.morphLast==='Спирали'&&r.spiral.audioLast==='Спирали','Spiral is not the final shared group');
    assert(r.spiral.defs.length===7&&r.spiral.defs.every(x=>x.exists),'Spiral routing definitions/UI controls are incomplete');
    assert(r.spiral.inlineSpiral&&r.spiral.inlineInputs>=6&&r.spiral.noFixedBox,'Blue Spiral settings are not inline in the Spiral Layers row');
    assert(r.spiral.orangeGroup==='Спирали','Orange spiral generator settings are still filed under Geometry');
    assert(r.spiral.icon,'Spiral group has no dedicated icon');

    const exc=uncaughtExceptions(h.events).slice(baseline);assert(exc.length===0,'uncaught browser exceptions: '+exc.join(' | '));
    console.log('7.9.14 TRANSIENT PROFILE / COMPACT HEADER / SPIRAL GROUP REGRESSION: PASS',r);
  }finally{await h.close();}
}
main().catch(e=>{console.error('FAIL 7.9.14 transient profile / compact header / Spiral group:',e.stack||e.message);process.exit(1);});
