'use strict';
// Release contract: independent Spiral order routing, compact editor, fixed
// Lightning shape and animated Corridor switching during Blue Morph.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
  const css=fs.readFileSync(path.join(__dirname,'../styles/app.css'),'utf8');
  assert.match(css,/morph-spiral-compact-controls/);
  assert.match(css,/flex-wrap:wrap!important/);
  const h=await createBrowserHarness({disableGpu:true,loadDelayMs:260,evalTimeoutMs:18000});
  try{
    // The generic browser harness excludes CSS. Include the actual stylesheet
    // here so the compact editor is tested as a rendered two-row grid.
    await h.evaluate(`(()=>{const s=document.createElement('style');s.textContent=${JSON.stringify(css)};document.head.append(s)})()`,{returnByValue:false,timeoutMs:18000});
    const r=await h.evaluate(`(async()=>{
      const info={};
      const row=document.getElementById('spiralOrderControl');
      info.spiralOrderTarget=!!row;
      info.activeProfile=getActiveMorphProfile()?.type;
      const panel=document.getElementById('morphSettingsPanel');panel.classList.remove('hidden');
      state.morph.options.bySpiralLayers=false;
      state.morph.options.bySpiralOrder=false;
      renderMorphProfileBindings();
      row.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:175,clientY:215,button:2}));
      const menu=document.getElementById('parameterRoutingContextMenu');
      info.popupOpened=!!menu&&!menu.classList.contains('hidden');
      info.popupLabel=menu?.querySelector('.parameter-routing-popup-title strong')?.textContent;
      const toggle=menu?.querySelector('button.routing-morph');
      info.popupEnabled=!!toggle&&!toggle.disabled;
      toggle?.click();
      await Promise.resolve();await Promise.resolve();
      panel.classList.remove('hidden');renderMorphProfileBindings();info.byOrder=state.morph.options.bySpiralOrder===true;
      info.byLayers=state.morph.options.bySpiralLayers===true;
      const o=document.querySelector('#morphProfileBindings [data-morph-special="spiralOrder"]');
      info.orderRow=!!o;
      info.rangeFields=o?.querySelectorAll('.morph-spiral-compact-controls input[type=number]').length;
      info.hasCompactControls=!!o?.querySelector('.morph-spiral-compact-controls')&&!!o?.querySelector('.morph-spiral-picker .audio-param-picker-button');
      info.actualDisplay=o?getComputedStyle(o).display:'';info.actualWrap=o?getComputedStyle(o).flexWrap:'';
      const orderRange=[...(o?.querySelectorAll('.morph-spiral-compact-range')||[])].find(group=>group.firstElementChild?.textContent==='Порядок')?.querySelector('input[type=number]');
      info.rangeEditable=!!orderRange;
      if(orderRange){orderRange.value='-3';orderRange.dispatchEvent(new Event('change',{bubbles:true}));}
      info.rangeCommitted=state.morph.spiralOrderMin===-3;
      info.shapeRemoved=!document.getElementById('sweepLightningProfileShape');
      info.defaultLight=sweepProfileMode({effectType:'lightning',lightningProfileShape:'line'});
      const l=state.layers[0];ensureLayerEffectState(l);l.sweep.lightningProfileShape='line';normalizeSweepConfig(l.sweep);info.storedLegacy=getLayerSweepConfig(l).lightningProfileShape;
      const oldName=l.name,oldColor=l.strokeColor;
      l.name='<img src=x onerror="window.__somataSecurityProbe=1">';l.strokeColor='red" onmouseover="window.__somataSecurityProbe=1';
      updateLayerListUI();syncAudioRoutingLayerTabs();
      info.safeLayerName=document.querySelector('.layer-list-name')?.textContent===l.name&&!document.getElementById('layerList')?.querySelector('img');
      info.safeAudioName=[...document.querySelectorAll('.audio-routing-layer')].some(b=>b.lastElementChild?.textContent===l.name)&&!document.getElementById('audioRoutingLayers')?.querySelector('img');
      info.noUnsafeDOM=window.__somataSecurityProbe!==1;
      l.name=oldName;l.strokeColor=oldColor;updateLayerListUI();syncAudioRoutingLayerTabs();
      info.entranceDurationBefore=window.__somataCorridorEntranceStatus?.()?.durationMs;
      const originalActive=runtimeState.morph.active;
      runtimeState.morph.active=true;
      setTunnelMode(false,{silent:true});setTunnelMode(true);
      const entrance=window.__somataCorridorEntranceStatus?.();
      info.entranceDurationDuringMorph=entrance?.durationMs;
      info.entranceMode=entrance?.direction;
      setTunnelMode(false,{silent:true});runtimeState.morph.active=originalActive;
      return info;
    })()`);
    assert(r.spiralOrderTarget&&r.popupOpened&&r.popupEnabled,`Spiral order right-click routing failed ${JSON.stringify(r)}`);
    assert.equal(r.popupLabel,'Порядок спирали');
    assert(r.byOrder&&!r.byLayers,'Spiral order cannot activate without Spiral layers');
    assert(r.orderRow&&r.rangeFields>=2&&r.hasCompactControls&&r.rangeEditable&&r.rangeCommitted,'order editor is not independent/compact');
    assert.equal(r.actualDisplay,'flex','Spiral settings must use a compact responsive flex row');
    assert.equal(r.actualWrap,'wrap','Spiral settings must wrap instead of clipping at narrow widths');
    assert(r.shapeRemoved&&r.defaultLight==='current'&&r.storedLegacy===undefined,'Lightning still supports obsolete alternative profile shape');
    assert(r.safeLayerName&&r.safeAudioName&&r.noUnsafeDOM,'Project names injected HTML into layer list or audio tabs');
    assert(r.entranceDurationDuringMorph>0,`Corridor no longer animates during Morph: ${JSON.stringify(r)}`);
    assert.deepEqual(uncaughtExceptions(h.events),[]);
    console.log('PASS Somata 10.4.1 Spiral order right-click, independent Morph editor, fixed Lightning, animated Corridor',r);
  }finally{await h.close()}
})().catch(e=>{console.error('FAIL',e.stack||e);process.exitCode=1;});
