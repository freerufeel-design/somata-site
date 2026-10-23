const fs=require('fs');
const path=require('path');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(cond,msg)=>{if(!cond)throw new Error(msg);};

async function main(){
  const h=await createBrowserHarness({disableGpu:true,evalTimeoutMs:10000});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const css=fs.readFileSync(path.join(h.ROOT,'styles/app.css'),'utf8');
    await h.evaluate(`(()=>{const s=document.createElement('style');s.textContent=${JSON.stringify(css)};document.head.appendChild(s);return true})()`);
    const r=await h.evaluate(`(async()=>{
      const stop=()=>{for(const n of ['morph','morph-owner','morph-arm','morph-cycle-boundary','minimalMorph','project-morph','sweep','particles','gpu-path-fx','motion','tunnel'])try{animationScheduler.remove(n)}catch(_){}};stop();
      if(runtimeState.morph.active)document.getElementById('btnMorph')?.click();
      const l=createLayer('ui-regression');l.N=10;l.K=3;l.radius=190;l.visible=true;l.lineVisible=true;l.profileMode='segments';l.profileNodes=[{x:0,y:0},{x:.23,y:.55},{x:.48,y:-.35},{x:.78,y:.42},{x:1,y:0}];l.lineProfileApplication='graffiti';l.lineProfileGraffiti='slash';l.fill=true;l.fillColor='#00ffc855';l.showWeb=true;ensureLayerEffectState(l);state.layers.splice(0,state.layers.length,l);state.activeLayerId=l.id;refreshLayerLookup(true);syncSidebarInputs();syncMorphSettingsUI();

      // 1. Mandala profile library + browsing/checkbox split semantics.
      const mandalaKeys=PROFILE_PRESET_GROUPS.mandala||[];
      const mandalaTab=document.querySelector('.profile-library-tab[data-profile-group="mandala"]');mandalaTab?.click();
      const browsed=activeProfilePresetGroup,optionCount=document.querySelectorAll('#profilePresetSelect option:not(.profile-library-placeholder)').length;
      const leftStd=document.querySelector('.profile-library-tab[data-profile-group="standard"] input[data-morph-profile-group="standard"]');
      const leftMandala=document.querySelector('.profile-library-tab[data-profile-group="mandala"] input[data-morph-profile-group="mandala"]');
      // The app intentionally keeps at least one morph profile group enabled. Enable Mandala first,
      // then turn Standard off so this verifies the duplicated left checkbox rather than the guard.
      leftMandala.checked=true;leftMandala.dispatchEvent(new Event('change',{bubbles:true}));
      const beforeBrowse=activeProfilePresetGroup;leftStd.checked=false;leftStd.dispatchEvent(new Event('change',{bubbles:true}));const afterCheckboxBrowse=activeProfilePresetGroup;const groupsAfterUncheck=[...(state.morph.shapeOptions.profileGroups||[])];
      leftStd.checked=true;leftStd.dispatchEvent(new Event('change',{bubbles:true}));
      const dropdownCount=document.querySelectorAll('#morphProfileGroupDropdown [data-morph-profile-group]').length;

      // 2. The sidebar slider has two mutually exclusive modes in the exact same slot:
      //    normal layer value while Morph is off, and a dual Morph range only while live+participating.
      state.morph.options.byRounding=false;syncMorphSettingsUI();syncSidebarInputs();
      const round=document.getElementById('paramRounding'),roundRow=round.closest('.control-row'),roundName=roundRow.querySelector('.row-label>span:first-child');
      const host=round.closest('.blue-morph-range-host');const duals=[...host.querySelectorAll('.blue-morph-dual')];
      round.value='37';round.dispatchEvent(new Event('input',{bubbles:true}));
      const normalBefore={layer:l.rounding,mode:host.dataset.sliderMode,visibility:getComputedStyle(round).visibility,pointer:getComputedStyle(round).pointerEvents,width:round.getBoundingClientRect().width,hostWidth:host.getBoundingClientRect().width,dualDisabled:duals.every(x=>x.disabled)};
      const rr=round.getBoundingClientRect();roundName.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2,clientX:rr.left+rr.width/2,clientY:rr.top+rr.height/2}));
      const popup=document.getElementById('parameterRoutingContextMenu');
      const viaMenu=popup&&!popup.classList.contains('hidden')&&popup.querySelector('.routing-morph:not(:disabled)');
      viaMenu?.click();
      const rightClickEnabled=!!viaMenu&&state.morph.options.byRounding===true&&roundRow.classList.contains('morph-route-enabled');
      document.getElementById('btnMorph')?.click();
      const liveDual=runtimeState.morph.active===true&&host.classList.contains('morph-live')&&host.dataset.sliderMode==='morph-range'&&duals.length===2&&duals.every(x=>!x.disabled)&&getComputedStyle(round).pointerEvents==='none';
      const layerBeforeRange=l.rounding;
      duals[0].value='18';duals[0].dispatchEvent(new Event('input',{bubbles:true}));duals[1].value='86';duals[1].dispatchEvent(new Event('input',{bubbles:true}));const dualState=[state.morph.roundingMin,state.morph.roundingMax],rangeDidNotEditLayer=l.rounding===layerBeforeRange;
      document.getElementById('btnMorph')?.click();
      round.value='42';round.dispatchEvent(new Event('input',{bubbles:true}));
      const normalAfter={layer:l.rounding,mode:host.dataset.sliderMode,visibility:getComputedStyle(round).visibility,pointer:getComputedStyle(round).pointerEvents,dualDisabled:duals.every(x=>x.disabled)};

      // 3. Default-reset button.
      state.morph.vertexMin=17;state.morph.options.bySteps=false;document.getElementById('btnResetMorphDefaults')?.click();
      const resetOk=state.morph.vertexMin===4&&state.morph.options.bySteps===true&&state.morph.profileModeTransition==='phase'&&state.morph.profileModeTransitionPercent===20;

      // 4. Graffiti must consume actual spline geometry, not the sharp auxiliary polyline.
      const ctx=()=>{beginFrameGeometryRuntime();const c=acquireLayerFrameEffectContext(0);c.layer=l;c.effectLayer=l;c.sourceLayer=l;c.staticDrawData=getCachedLayerDrawData(l);c.canonicalGeometry=getCanonicalLayerGeometry(l);c.now=1234;c.frame.now=1234;c.frame.dpr=1;c.frame.id=c.frameId;c.strokeWidth=2;c.baseAlpha=1;c.lineAlpha=1;c.lineDisplayEnabled=true;c.visibleInstances={copies:[{scale:1,depthT:0,index:0}],alphas:[1],particleAlphas:[1]};return c;};
      l.profileMode='segments';invalidateLayerGeometry(l,'graffiti-segments');const seg=prepareLayerFrameProfileData(ctx());const segPts=(seg.graffitiPlan||[]).reduce((n,x)=>n+(x.path?.points?.length||0),0);
      l.profileMode='spline';invalidateLayerGeometry(l,'graffiti-spline');const spl=prepareLayerFrameProfileData(ctx());const splPts=(spl.graffitiPlan||[]).reduce((n,x)=>n+(x.path?.points?.length||0),0);const splineDifferent=splPts>segPts;

      // 5. Fill + Web coexist in one live layer; neither preparation path is allowed to disappear.
      const draw=getCachedLayerDrawData(l),fillMesh=FillMeshPreparer.prepareStatic(draw,l),wc=ctx(),web=prepareLayerFrameWebData(wc);const fillWebOk=Boolean(fillMesh&&fillMesh.nativeComplete===true&&web?.enabled&&web.paths?.length);

      // 6. Orange Mandala should draw from the new Mandala profile set.
      const mode=document.getElementById('minimalMorphMode');mode.value='mandala';mode.dispatchEvent(new Event('change',{bubbles:true}));const selectedLibrary=activeProfilePresetGroup;
      const count=document.getElementById('randomLayerCount');count.value='4';count.dispatchEvent(new Event('change',{bubbles:true}));document.getElementById('minimalMorphInstant').checked=true;document.getElementById('btnMinimalMorph')?.click();
      await new Promise(r=>setTimeout(r,180));
      const profileKeys=state.layers.map(x=>getExactProfilePresetKey(x));document.getElementById('btnMinimalMorph')?.click();
      await new Promise(r=>setTimeout(r,40));

      // 7. Orange mode list is sourced from the profile-library groups, and the real Random button
      //    must use the currently selected Orange group even when Orange Morph itself is stopped.
      const orangeModeValues=[...mode.options].map(o=>o.value),orangeGroupChecks={};
      for(const group of PROFILE_PRESET_GROUP_ORDER){
        mode.value=group;mode.dispatchEvent(new Event('change',{bubbles:true}));
        count.value='3';count.dispatchEvent(new Event('change',{bubbles:true}));
        document.getElementById('btnRandomPreset')?.click();
        const keys=state.layers.map(x=>getExactProfilePresetKey(x));
        orangeGroupChecks[group]={keys,ok:keys.length===3&&keys.every(k=>(PROFILE_PRESET_GROUPS[group]||[]).includes(k))};
      }
      const tunnelDefault={state:state.tunnel.fadeOffsetSteps,ui:Number(document.getElementById('tunnelFadeOffsetSteps')?.value)};
      return {mandalaCount:mandalaKeys.length,browsed,optionCount,beforeBrowse,afterCheckboxBrowse,groupsAfterUncheck,dropdownCount,rightClickEnabled,liveDual,dualState,normalBefore,normalAfter,rangeDidNotEditLayer,resetOk,segPts,splPts,splineDifferent,fillWebOk,selectedLibrary,profileKeys,mandalaKeys,orangeModeValues,orangeGroupChecks,tunnelDefault};
    })()`,{timeoutMs:10000,label:'profile morph UI regression'});
    assert(r.mandalaCount>=8&&r.browsed==='mandala'&&r.optionCount===r.mandalaCount,'Mandala profile library did not browse as its own set');
    assert(r.afterCheckboxBrowse===r.beforeBrowse,'clicking a profile-group checkbox changed the browsed library');
    assert(!r.groupsAfterUncheck.includes('standard'),'left profile checkbox did not control Blue Morph group participation');
    assert(r.dropdownCount===5,'Blue Morph profile group selector is not the five-group dropdown');
    assert(r.normalBefore.layer===37&&r.normalBefore.mode==='value'&&r.normalBefore.visibility==='visible'&&r.normalBefore.pointer==='auto'&&r.normalBefore.width>0&&r.normalBefore.width>=r.normalBefore.hostWidth*.9&&r.normalBefore.dualDisabled,'Morph-off sidebar slider is not a fully interactive current-value control');
    assert(r.rightClickEnabled,'right-click popup did not enable/highlight a morphable parameter');
    assert(r.liveDual&&r.dualState[0]===18&&r.dualState[1]===86&&r.rangeDidNotEditLayer,'active Blue Morph did not exclusively expose/update the dual-thumb range');
    assert(r.normalAfter.layer===42&&r.normalAfter.mode==='value'&&r.normalAfter.visibility==='visible'&&r.normalAfter.pointer==='auto'&&r.normalAfter.dualDisabled,'stopping Blue Morph did not restore the original current-value slider');
    assert(r.resetOk,'reset-to-default Morph button did not restore factory settings');
    assert(r.splineDifferent,`Graffiti spline carrier stayed sharp/unchanged (segments ${r.segPts}, spline ${r.splPts})`);
    assert(r.fillWebOk,'Fill and Web do not coexist in the same prepared layer');
    assert(r.selectedLibrary==='mandala','selecting Orange Mandala did not switch the profile browser to Mandala');
    assert(r.profileKeys.every(k=>r.mandalaKeys.includes(k)),'Orange Mandala generated a profile outside the Mandala set: '+JSON.stringify(r.profileKeys));
    assert(JSON.stringify(r.orangeModeValues)===JSON.stringify(['standard','closed','loops','open','mandala']),'Orange Morph modes are not the shared five profile groups: '+JSON.stringify(r.orangeModeValues));
    assert(Object.values(r.orangeGroupChecks).every(x=>x.ok),'Random composition ignored the selected Orange profile group: '+JSON.stringify(r.orangeGroupChecks));
    assert(r.tunnelDefault.state===3&&r.tunnelDefault.ui===3,'Corridor offset after viewport is not 3 figures by default: '+JSON.stringify(r.tunnelDefault));
    const exc=uncaughtExceptions(h.events).slice(baseline);assert(exc.length===0,'uncaught browser exceptions: '+exc.join(' | '));
    console.log('PROFILE/MORPH UI REGRESSION: PASS',r);
  }finally{await h.close();}
}
main().catch(e=>{console.error('FAIL profile/morph UI regression:',e.stack||e.message);process.exit(1);});
