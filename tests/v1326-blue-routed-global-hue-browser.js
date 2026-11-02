'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
  const h=await createBrowserHarness({disableGpu:true,loadDelayMs:100,evalTimeoutMs:15000});
  try{
    const results=await h.evaluate(`(async()=>{
      const R=window.SomataMorphParameterRouting;
      const sleep=ms=>new Promise(r=>setTimeout(r,ms));
      const cases=[];
      for(const mode of ['circleSlide','light']){
        if(runtimeState.morph.active)document.getElementById('btnMorph').click();
        const layer=createLayer('Hue '+mode);
        Object.assign(layer,{strokeColor:'#ff0000',fill:true,fillColor:'#00ff0080',closedLoop:true});
        state.layers=[layer];state.activeLayerId=layer.id;
        state.playlistPaletteHueOffset=0;
        state.morph.mode=mode;state.morph.monoOrbitTransforms=mode!=='light';
        state.morph.intervalSec=2;state.morph.morphGlobalHueOffset=false;
        for(const key of Object.keys(state.morph.options))
          if(typeof state.morph.options[key]==='boolean')state.morph.options[key]=false;
        if(mode==='circleSlide'){
          document.getElementById('btnMorphSettings')?.click();
          document.getElementById('btnAddMorphParameter')?.click();
          const search=document.getElementById('morphParameterSearch');
          search.value='Общее смещение цвета';search.dispatchEvent(new Event('input',{bubbles:true}));
          const option=[...document.querySelectorAll('#morphParameterOptions .morph-param-option')]
            .find(el=>el.textContent.includes('Общее смещение цвета'));
          if(!option)throw new Error('Palette Hue is missing from the real Blue parameter picker');
          option.click();
        }
        const binding=R.workingBindings(state.morph,state.minimalMorph).find(b=>b.parameter==='palette.hueOffset')
          ||R.addBinding(state.morph,state.minimalMorph,'palette.hueOffset',{min:180,max:180});
        if(!binding)throw new Error('Cannot add Palette Hue to Blue');
        Object.assign(binding,{enabled:true,min:180,max:180});
        R.resetRuntime(runtimeState.morph);
        document.getElementById('btnMorph').click();
        const sample=()=>{
          const rt=runtimeState.morph;
          const frame=rt.lightLayers?.[0]||rt.frameLayers?.[0];
          return {active:rt.active,t:rt.geometryT,stroke:frame?.strokeColor,
            fill:frame?.fillColor,alpha:getFillOpacityUnit(frame?.fillColor),
            delta:frame?.__bluePaletteHueShift,
            effective:getEffectivePlaylistHueOffset(),authored:state.playlistPaletteHueOffset,
            ui:document.getElementById('playlistPaletteHueOffsetText')?.textContent};
        };
        await sleep(340);const first=sample();
        await sleep(270);const second=sample();
        binding.enabled=false;
        await sleep(150);const disabled=sample();
        document.getElementById('btnMorph').click();
        cases.push({mode,first,second,disabled,after:{stroke:layer.strokeColor,active:runtimeState.morph.active}});
      }
      return cases;
    })()`,{timeoutMs:15000,label:'Blue routed hue visible frame and reset'});
    for(const c of results){
      const {first:a,second:b,disabled:d}=c;
      assert(a.active&&b.active,`${c.mode}: Morph did not start`);
      assert(b.t>a.t,`${c.mode}: Morph timeline stalled`);
      assert(Math.abs(Number(b.delta))>1,`${c.mode}: Hue routing did not affect the displayed frame`);
      assert(a.stroke!==b.stroke&&b.stroke!=='#ff0000',`${c.mode}: line did not change color`);
      assert(a.fill!==b.fill&&b.fill.startsWith('rgba('),`${c.mode}: fill did not rotate with preserved alpha`);
      assert(Math.abs(b.alpha-.5019608)<.001,`${c.mode}: Fill alpha was changed by hue rotation`);
      assert.equal(b.authored,0,`${c.mode}: Hue routing changed the authored slider value`);
      assert(b.effective>180&&b.effective<360,`${c.mode}: negative hue was clamped rather than wrapped`);
      assert.notEqual(b.ui,'0°',`${c.mode}: Hue UI did not reflect the routed color`);
      assert.equal(d.ui,'0°',`${c.mode}: Hue UI did not reset after disabling the route`);
      assert.equal(d.stroke,'#ff0000',`${c.mode}: disabling route did not restore original color`);
      assert(Math.abs(Number(d.delta))<1e-9,`${c.mode}: disabled route still applies shift`);
      assert.equal(c.after.stroke,'#ff0000',`${c.mode}: routed shift baked into the authored layer`);
      assert(!c.after.active,`${c.mode}: Morph did not stop`);
    }
    assert.deepEqual(uncaughtExceptions(h.events),[],'Browser exceptions');
    console.log('PASS Blue Palette Hue routing: live line/fill changes, alpha, negative wrap, UI, disable/reset, Full + Light:',JSON.stringify(results));
  } finally {await h.close();}
})().catch(err=>{console.error('FAIL Blue Palette Hue regression:',err.stack||err);process.exitCode=1;});
