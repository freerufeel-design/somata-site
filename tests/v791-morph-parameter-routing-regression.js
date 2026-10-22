const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(cond,msg)=>{if(!cond)throw new Error(msg);};

async function main(){
  const h=await createBrowserHarness({disableGpu:true,evalTimeoutMs:15000});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const r=await h.evaluate(`(async()=>{
      const stop=()=>{for(const n of ['morph','morph-owner','morph-arm','morph-cycle-boundary','minimalMorph','minimal-morph-arm','project-morph'])try{animationScheduler.remove(n)}catch(_){}};stop();
      try{if(runtimeState.morph.active)activeStopMorphing(false)}catch(_){};try{if(runtimeState.minimalMorph.active)activeStopMinimalMorphing(false)}catch(_){};
      const routing=window.SomataMorphParameterRouting,R=window.SomataParameterRegistry;
      routing.ensureProfiles(state.morph,state.minimalMorph);syncMorphSettingsUI();syncMorphProfileUI();
      const standard=routing.activeProfile(state.morph,state.minimalMorph);
      const initial={id:standard?.id,name:standard?.name,type:standard?.type,system:standard?.system,ui:document.getElementById('morphProfileSelect')?.value,target:document.getElementById('btnMorphMasterMode')?.textContent?.trim(),status:window.__somataParameterRoutingStatus?.()};
      document.getElementById('btnMorphSettings')?.click();

      // Real picker action: add Web width to Standard.
      document.getElementById('btnAddMorphParameter')?.click();
      const search=document.getElementById('morphParameterSearch');search.value='Толщина нитей';search.dispatchEvent(new Event('input',{bubbles:true}));
      const webOption=[...document.querySelectorAll('#morphParameterOptions .morph-param-option')].find(b=>b.textContent.includes('Толщина нитей'));webOption?.click();
      const p1=routing.activeProfile(state.morph,state.minimalMorph),webBinding=routing.workingBindings(state.morph,state.minimalMorph,p1).find(b=>b.parameter==='web.width');
      const webEl=document.getElementById('webWidth'),webMarker=Boolean(webEl?.closest?.('.morph-route-enabled'))&&webEl?.classList.contains('morph-route-control-enabled');
      const missingMorphControls=R.morphable().filter(d=>d.ui?.mainId&&!document.getElementById(d.ui.mainId)).map(d=>d.id);
      const particlesToggle=document.getElementById('showParticles');particlesToggle?.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2}));
      const discreteState=window.SomataMorphParameterRoutingUI.state('particles.enabled');
      document.querySelector('#parameterRoutingContextMenu .routing-morph')?.click();
      const discreteAdded=routing.workingBindings(state.morph,state.minimalMorph).some(b=>b.parameter==='particles.enabled');const discreteRow=document.querySelector('#morphProfileBindings [data-morph-parameter="particles.enabled"]');const discreteUi=discreteRow?.textContent||'';

      // Deterministic generic overlay: profile range 0.2..0.2 must affect the frame snapshot only.
      webBinding.min=.2;webBinding.max=.2;runtimeState.morph.active=true;runtimeState.morph.paused=false;runtimeState.morph.pausedByOrangeProject=false;runtimeState.morph.pausedByGreenProject=false;runtimeState.morph.geometryT=.5;runtimeState.morph.phaseSerial=901;runtimeState.morph.parameterRouting=null;
      const source={id:'routing-test'},frameLayer={id:'routing-test',web:{width:1}},effectLayer={id:'routing-test',web:{width:1}};
      routing.applyFrame({sourceLayer:source,layer:frameLayer,effectLayer,layerIndex:0});
      const overlay={frame:effectLayer.web.width,authored:source.web?.width};runtimeState.morph.active=false;routing.resetRuntime(runtimeState.morph);

      // Create a transient Standard profile with no naming prompt; name it only on first Save.
      const oldPrompt=window.prompt;let promptCalls=0;window.prompt=()=>{promptCalls++;return 'Performance';};document.getElementById('btnNewMorphProfile')?.click();await new Promise(r=>setTimeout(r,10));
      const transientBlue=routing.activeProfile(state.morph,state.minimalMorph),blueTransientAtCreate=transientBlue?.transient===true;const bluePromptCallsAfterCreate=promptCalls;document.getElementById('btnSaveMorphProfile')?.click();await new Promise(r=>setTimeout(r,10));
      const performance=routing.activeProfile(state.morph,state.minimalMorph);const standardCreated={name:performance.name,type:performance.type,count:routing.workingBindings(state.morph,state.minimalMorph,performance).length,transientAtCreate:blueTransientAtCreate,promptCallsAfterCreate:bluePromptCallsAfterCreate,promptCallsAfterSave:promptCalls};

      // Orange profiles are independent and use the same transient -> Save -> name lifecycle.
      const orangeStore=window.SomataOrangeMorphProfiles;orangeStore.ensureProfiles(state.minimalMorph,state.randomOptions,state.randomLayerCount);
      document.getElementById('btnRandomSettings')?.click();await new Promise(r=>setTimeout(r,20));syncOrangeMorphProfileUI();
      window.prompt=()=>{promptCalls++;return 'Orange Stage';};const beforeOrangePrompt=promptCalls;document.getElementById('btnNewOrangeMorphProfile')?.click();await new Promise(r=>setTimeout(r,10));const transientOrange=orangeStore.activeProfile(state.minimalMorph,state.randomOptions,state.randomLayerCount),orangeTransientAtCreate=transientOrange?.transient===true;const orangePromptCallsAfterCreate=promptCalls-beforeOrangePrompt;document.getElementById('btnSaveOrangeMorphProfile')?.click();await new Promise(r=>setTimeout(r,10));window.prompt=oldPrompt;
      const orange=orangeStore.activeProfile(state.minimalMorph,state.randomOptions,state.randomLayerCount);state.minimalMorph.defaultActive=true;syncOrangeMorphProfileUI();
      const beforeOrange={blue:runtimeState.morph.active===true,orange:runtimeState.minimalMorph.active===true};document.getElementById('btnMinimalMorph')?.click();await new Promise(r=>setTimeout(r,80));
      const afterOrange={blue:runtimeState.morph.active===true,orange:runtimeState.minimalMorph.active===true,button:document.getElementById('btnMinimalMorph')?.classList.contains('active')};
      if(runtimeState.minimalMorph.active)document.getElementById('btnMinimalMorph')?.click();

      // Project persistence and Green target commit: target project carries the independent active Orange profile.
      const orangeId=orange.id;orangeStore.save(state.minimalMorph,state.randomOptions,state.randomLayerCount);const blueId=state.morph.activeProfileId;const projectB=buildProjectData();
      state.minimalMorph.activeProfileId='orange-standard';state.minimalMorph.defaultActive=false;state.morph.defaultActive=false;const projectA=buildProjectData();
      applyLoadedProject(projectA,{applyProjectDefaultModes:false,suppressMinimalAutoStart:true});
      state.playlistProjects=[{id:'routing-A',name:'A',project:projectA},{id:'routing-B',name:'B',project:projectB}];
      runtimeState.projectMorph.targetIndex=1;runtimeState.projectMorph.active=true;runtimeState.projectMorph.transitionActive=true;
      const greenCommitted=finalizeProjectMorphTarget();await new Promise(r=>setTimeout(r,40));
      const green={committed:greenCommitted,blueActiveProfileId:state.morph.activeProfileId,orangeActiveProfileId:state.minimalMorph.activeProfileId,orangeActive:runtimeState.minimalMorph.active===true,blueProfileCount:state.morph.profiles?.length||0,orangeProfileCount:state.minimalMorph.profiles?.length||0};
      try{if(runtimeState.minimalMorph.active)activeStopMinimalMorphing(false)}catch(_){};runtimeState.projectMorph.active=false;runtimeState.projectMorph.transitionActive=false;stop();

      // Legacy load after a modern project must not inherit the previous project's profile collection.
      const legacy=structuredClone(projectA);delete legacy.settings.morph.profiles;delete legacy.settings.morph.activeProfileId;applyLoadedProject(legacy,{applyProjectDefaultModes:false,suppressMinimalAutoStart:true});
      const legacyProfiles=(state.morph.profiles||[]).map(p=>({id:p.id,name:p.name,type:p.type,system:p.system}));
      const audioOrder=R.audioDefinitions().slice(0,6).map(x=>x.key);
      return {initial,webAdded:Boolean(webBinding),webMarker,missingMorphControls,discreteState,discreteAdded,discreteUi,overlay,standardCreated,orange:{id:orangeId,name:orange.name,transientAtCreate:orangeTransientAtCreate,promptCallsAfterCreate:orangePromptCallsAfterCreate,beforeOrange,afterOrange},expectedBlueId:blueId,green,legacyProfiles,sharedCount:R.sharedRoutingDefinitions().length,audioCount:R.audioDefinitions().length,audioOrder,rotation:R.get('layer.rotation'),size:R.get('layer.scale')};
    })()`,{timeoutMs:15000,label:'7.9.1 Morph parameter routing'});

    assert(r.initial.id==='standard'&&r.initial.name==='Standard'&&r.initial.type==='standard'&&r.initial.system===true,'legacy Blue was not migrated to system Standard');
    assert(r.initial.ui==='standard'&&r.initial.target==='Master','Standard profile header/target is not initialized');
    assert(r.initial.status?.morphable>=100&&r.sharedCount>0&&r.audioCount===r.sharedCount&&r.sharedCount<=r.initial.status?.morphable,'Parameter Registry does not expose the shared visible Morph/Audio catalog');
    assert(r.webAdded&&r.webMarker,'real parameter picker did not bind/highlight exact Web width control');
    assert(r.missingMorphControls.length===0,'Morph Registry points at missing UI controls: '+r.missingMorphControls.join(','));
    assert(r.discreteState?.supported===false&&!r.discreteAdded&&!r.discreteUi,'pure boolean parameter is still bindable in Blue Morph');
    assert(Math.abs(r.overlay.frame-.6)<1e-6&&r.overlay.authored===undefined,'generic Morph overlay did not interpolate frame-only state');
    assert(r.standardCreated.name==='Performance'&&r.standardCreated.type==='standard'&&r.standardCreated.count===0&&r.standardCreated.transientAtCreate&&r.standardCreated.promptCallsAfterCreate===0&&r.standardCreated.promptCallsAfterSave===1,'new Standard must be unnamed/transient until first Save');
    assert(r.orange.transientAtCreate&&r.orange.promptCallsAfterCreate===0&&r.orange.name==='Orange Stage','new Orange must be unnamed/transient until first Save');
    assert(r.orange.id&&r.orange.afterOrange.orange===true&&r.orange.afterOrange.blue===false&&r.orange.afterOrange.button===true,'Orange panel/profile did not start Orange engine');
    assert(r.green.committed&&r.green.orangeActiveProfileId===r.orange.id&&r.green.blueActiveProfileId===r.expectedBlueId&&r.green.orangeProfileCount>=2,'Green target commit did not restore independent Blue/Orange profiles');
    assert(r.green.orangeActive===true,'Green did not restore target Orange default morph state');
    const builtinIds=['standard','builtin-breathing','builtin-crystal','builtin-orbital','builtin-liquid-neon','builtin-singularity'];
    assert(JSON.stringify(r.legacyProfiles.map(p=>p.id))===JSON.stringify(builtinIds)&&r.legacyProfiles.every(p=>p.system===true),'legacy project inherited user Morph Profiles instead of rebuilding only the system catalog: '+JSON.stringify(r.legacyProfiles));
    assert(r.audioOrder.join('|')==='geometry.N|geometry.K|layer.rounding|layer.radius|layer.rotation|layer.opacity','shared registry canonical Audio order does not mirror Standard Morph');
    assert(r.rotation?.morph?.legacy===true&&r.rotation?.audio?.label==='Вращение','shared registry overwrote legacy Blue semantics while adding Audio alias');
    assert(r.size?.morph?.supported===false&&r.size?.audio?.supported===true,'audio runtime scale was incorrectly conflated with Blue radius');
    const exc=uncaughtExceptions(h.events).slice(baseline);assert(exc.length===0,'uncaught browser exceptions: '+exc.join(' | '));
    console.log('7.9.1 MORPH PARAMETER ROUTING REGRESSION: PASS',r);
  }finally{await h.close();}
}
main().catch(e=>{console.error('FAIL 7.9.1 Morph parameter routing regression:',e.stack||e.message);process.exit(1);});
