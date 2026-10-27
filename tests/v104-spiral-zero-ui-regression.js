'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness}=require('./lib/browser-harness');
(async()=>{
  const h=await createBrowserHarness({disableGpu:true,loadDelayMs:100});
  try{
    const result=await h.evaluate(`(()=>{
      const planner=window.SomataSpiralZeroTransition;
      const cases={};
      for(const mode of ['honest','beautiful']){
        cases[mode]=[0,.15,.3,.5,.7,.85,1].map(t=>planner.plan(mode,3,0,t,true));
      }
      const cross=planner.plan('beautiful',-2,3,.5,true);
      const modeField=document.getElementById('paramSpiralZeroTransition');
      const layer=state.layers.find(l=>l.id===state.activeLayerId)||state.layers[0];
      layer.spiralZeroTransitionMode='honest';
      syncSidebarInputs();
      const loaded=modeField.value;
      modeField.value='beautiful';modeField.dispatchEvent(new Event('change',{bubbles:true}));
      const set=layer.spiralZeroTransitionMode;
      const panel=document.getElementById('morphSettingsPanel');panel.classList.remove('hidden');
      state.morph.options.bySpiralLayers=true;
      renderMorphProfileBindings();
      const row=document.querySelector('#morphProfileBindings [data-morph-special="spiralLayers"]');
      const chance=row?.querySelector('.morph-spiral-chance input');
      chance.value='37';chance.dispatchEvent(new Event('change',{bubbles:true}));
      const chanceSet=state.morph.spiralTangentialChance;
      document.getElementById('btnAddMorphParameter').click();
      const picker=document.getElementById('morphParameterPicker');const opening=!picker.classList.contains('hidden');
      const target=panel.querySelector('.morph-settings-title')||panel;
      target.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
      const closed=picker.classList.contains('hidden');
      return {cases,cross,loaded,set,chanceSet,opening,closed,probabilityInputs:row?.querySelectorAll('.morph-spiral-chance input').length};
    })()`,{timeoutMs:12000});
    assert.equal(result.loaded,'honest');assert.equal(result.set,'beautiful');
    assert.equal(result.probabilityInputs,1);assert.equal(result.chanceSet,37);
    assert.equal(result.opening,true);assert.equal(result.closed,true);
    assert.equal(result.cases.honest[6].order,0);
    assert.equal(result.cases.beautiful[6].order,0);
    assert.equal(result.cases.beautiful[2].population,0);
    assert.equal(result.cases.beautiful[4].population,0);
    assert.equal(result.cases.beautiful[3].order,1.5);
    assert.equal(result.cross.choreographed,false);
    assert.equal(result.cases.honest[3].choreographed,false);
    console.log('PASS v104 zero modes, endpoint exactness, morphology chooser, tangency input, outside click');
  }finally{await h.close();}
})().catch(err=>{console.error(err.stack||err);process.exitCode=1;});
