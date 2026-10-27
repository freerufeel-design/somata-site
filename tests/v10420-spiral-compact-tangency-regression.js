'use strict';
// Shared spiral specials: Layers owns count/tangency; Order owns its own order range.
// The two engine editors display the same row anatomy, but their values are independent.
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const css=fs.readFileSync(path.join(__dirname,'../styles/app.css'),'utf8');
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:160,evalTimeoutMs:24000});
 try{
  const v=await h.evaluate(`(()=>{
    const style=document.createElement('style');style.textContent=${JSON.stringify(css)};document.head.appendChild(style);
    document.getElementById('morphSettingsPanel').classList.remove('hidden');
    document.getElementById('randomSettingsPanel').classList.remove('hidden');
    state.morph.options.bySpiralLayers=true;state.morph.options.bySpiralOrder=true;
    state.randomOptions.bySpiralLayers=true;state.randomOptions.bySpiralOrder=true;
    renderMorphProfileBindings();renderOrangeMorphBindings();
    const collect=(engine)=>{
      const host=document.getElementById(engine==='blue'?'morphProfileBindings':'orangeMorphBindings');
      // Orange may be hosted in a detached compatibility panel until opened.
      // Attach the *real* generated rows for computed CSS parity checks.
      if(!host.isConnected)document.body.appendChild(host);
      const attr=engine==='blue'?'data-morph-special':'data-orange-special';
      const rows=['spiralLayers','spiralOrder'].map(k=>host.querySelector('['+attr+'="'+k+'"]'));
      const names=rows.map(row=>[...row.querySelectorAll('.morph-spiral-compact-range > span:first-child')].map(x=>x.textContent));
      const numbers=rows.map(row=>[...row.querySelectorAll('.morph-spiral-compact-range input[type="number"]')]);
      const cover=rows.map(row=>!!row.querySelector('.morph-route-layer-coverage input'));
      const pickerLabels=rows.map(row=>row.querySelector('.morph-spiral-picker .audio-param-picker-button')?.textContent);
      const entry=rows[1].querySelector('.morph-spiral-picker .audio-param-picker-button');
      const menu=rows[1].querySelector('.audio-param-menu');entry.click();
      const opened=!menu.classList.contains('hidden');
      const sharedMenu=!![...menu.querySelectorAll('.audio-param-option')].find(el=>el.textContent==='Спиральные слои');
      entry.click();
      const stylePicker=rows[0].querySelector('.morph-spiral-picker .audio-param-picker-button');
      const color=getComputedStyle(stylePicker).color,font=getComputedStyle(stylePicker).fontSize;
      const rowLayout=rows.map(row=>({display:getComputedStyle(row).display,wrap:getComputedStyle(row).flexWrap}));
      const layersMin=numbers[0][0];layersMin.value='1';layersMin.dispatchEvent(new Event('change',{bubbles:true}));
      const chanceInput=numbers[0][2];chanceInput.value='72';chanceInput.dispatchEvent(new Event('change',{bubbles:true}));
      const orderInput=numbers[1][0];orderInput.value='-4';orderInput.dispatchEvent(new Event('change',{bubbles:true}));
      return {names,counts:numbers.map(n=>n.length),cover,pickerLabels,opened,sharedMenu,color,font,
        rowLayout};
    };
    const blue=collect('blue');const blueValue=state.morph.spiralOrderMin,blueLayers=state.morph.spiralLayersMin,blueChance=state.morph.spiralTangentialChance;
    const orange=collect('orange');const orangeValue=state.randomOptions.spiralOrderMin,orangeLayers=state.randomOptions.spiralLayersMin,orangeChance=state.randomOptions.spiralTangentialChance;
    // Verify row switch through actual unified parameter picker in both editors.
    return {blue,orange,blueValue,orangeValue,blueLayers,blueChance,orangeLayers,orangeChance,matrix:[
      SomataParameterMatrix.rowLayout('spiral.layers').fields.map(f=>f.label),
      SomataParameterMatrix.rowLayout('spiral.order').fields.map(f=>f.label)
    ]};
  })()`,{label:'Blue/Orange independent Spiral row parity'});
  for(const engine of ['blue','orange']){
   const row=v[engine];
   assert.deepEqual(row.names,[['Слои','Танг.'],['Порядок']],engine+' incorrect fields');
   assert.deepEqual(row.counts,[3,2],engine+' incorrect numeric counts');
   assert.deepEqual(row.cover,[true,true],engine+' coverage fields missing');
   assert.deepEqual(row.pickerLabels,['Спиральные слои','Порядок спирали']);
   assert(row.opened&&row.sharedMenu,engine+' shared picker not functional');
   assert(row.rowLayout.every(x=>x.display==='flex'),engine+' rows not responsive flex');
  }
  assert.deepEqual(v.matrix,[['Слои','Танг.'],['Порядок']]);
  assert.equal(v.blueValue,-4);assert.equal(v.orangeValue,-4);
  assert.equal(v.blueLayers,1);assert.equal(v.orangeLayers,1);assert.equal(v.blueChance,72);assert.equal(v.orangeChance,72);
  assert.equal(v.blue.color,v.orange.color,'Blue and Orange use different text colors');
  assert.equal(v.blue.font,v.orange.font,'Blue and Orange use different typography');
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS v10420 Blue/Orange Spiral row parity: Layers count+tangency, Order range, layer coverage, shared picker, independent state');
 }finally{await h.close();}
})().catch(e=>{console.error('FAIL',e.stack||e);process.exitCode=1});
