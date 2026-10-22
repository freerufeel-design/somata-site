// 7.11.14: lightning strike clock 1/4, true Orange Orbit removal and text row, PC-audio default.
const fs=require('fs');
const path=require('path');
const {ROOT}=require('./lib/test-utils');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(v,msg)=>{if(!v)throw Error(msg)};
(async()=>{
  const lightning=fs.readFileSync(path.join(ROOT,'js/app/lamp-audio-core.js'),'utf8');
  const matched=lightning.match(/const LIGHTNING_STRIKE_CLOCK_FACTOR=([\d.]+);\s*function getLightningCycleRateHz\([^]*?\n\s*}\n/);
  assert(matched,'Lightning strike clock formula not found');
  assert(Number(matched[1])===0.25,'Strike frequency must be quartered, without modifying UI percentage or multiplier');
  const f=new Function('getSweepTargetVelocity','getLightningRateFactor','currentSweepConfig',matched[0]+'return getLightningCycleRateHz;')(()=>8,()=>1,()=>({}));
  assert(f({},0)===2,'Lightning rate 8 Hz should become 2 Hz');
  const f2=new Function('getSweepTargetVelocity','getLightningRateFactor','currentSweepConfig',matched[0]+'return getLightningCycleRateHz;')(()=>4,()=>0.75,()=>({}));
  assert(f2({},1)===0.75,'Lightning 4 Hz x 75% must become 0.75 Hz');
  assert(/lightningRatePercent:100, lightningRateMultiplier:1/.test(fs.readFileSync(path.join(ROOT,'js/core/state.js'),'utf8')),'Visible strike parameters must stay 100% x1');
  const h=await createBrowserHarness({disableGpu:true,loadDelayMs:160,evalTimeoutMs:20000});
  try{
    const result=await h.evaluate(`(async()=>{
      const wait=ms=>new Promise(r=>setTimeout(r,ms));
      const random=document.getElementById('randomSettingsPanel');
      if(random.classList.contains('hidden'))document.getElementById('btnRandomSettings').click();
      await wait(30);syncOrangeMorphProfileUI();
      const host=document.getElementById('orangeMorphBindings');
      const read=()=>host.querySelector('[data-orange-special="orbits"]');
      const first=read();
      const initial={visible:!!first,label:first?.querySelector('.morph-orbit-plain-label')?.textContent,tag:first?.querySelector('.morph-orbit-plain-label')?.tagName,select:!!first?.querySelector('.morph-orbit-plain-label button'),value:state.randomOptions.orbitCount,enabled:state.randomOptions.orbitBindingEnabled};
      first?.querySelector('.morph-binding-remove')?.click();await wait(10);
      const afterRemove={rows:host.querySelectorAll('[data-orange-special="orbits"]').length,enabled:state.randomOptions.orbitBindingEnabled,groupCount:document.querySelector('#orangeMorphRoutingGroups [data-orange-group="Геометрия"]')?.textContent};
      syncOrangeMorphProfileUI();await wait(10);
      const afterRefresh={rows:host.querySelectorAll('[data-orange-special="orbits"]').length,enabled:state.randomOptions.orbitBindingEnabled};
      const geo=[...document.querySelectorAll('#orangeMorphRoutingGroups .audio-route-group-btn')].find(b=>b.dataset.orangeGroup==='Геометрия');
      geo.click();await wait(10);
      const menu=document.querySelector('.audio-route-group-menu[data-orange-routing-group-menu="1"]:not(.hidden)');
      const add=menu?.querySelector('.audio-param-option[data-parameter-id="geometry.orbits"]');
      add?.click();await wait(10);
      const readded=read();
      const afterAdd={rows:host.querySelectorAll('[data-orange-special="orbits"]').length,enabled:state.randomOptions.orbitBindingEnabled,range:[...readded.querySelectorAll('.morph-route-inline-range input')].map(el=>el.value),label:readded.querySelector('.morph-orbit-plain-label')?.textContent};
      const source=document.getElementById('audioSourceSelect');
      const audioInitial={source:state.audioReactive.source,selected:source.value};
      await wait(5);document.getElementById('btnAudioReactive').click();
      const afterPanel={source:state.audioReactive.source,selected:source.value};
      source.value='microphone';source.dispatchEvent(new Event('change',{bubbles:true}));
      document.getElementById('btnCloseAudioPanel').click();document.getElementById('btnAudioReactive').click();
      const afterManual={source:state.audioReactive.source,selected:source.value};
      return {initial,afterRemove,afterRefresh,afterAdd,audioInitial,afterPanel,afterManual};
    })()`,{timeoutMs:20000,label:'Orange orbit remove/add and audio source'});
    assert(result.initial.visible&&result.initial.label==='Орбиты'&&result.initial.tag==='SPAN'&&!result.initial.select,'Orbit must be a plain text label: '+JSON.stringify(result.initial));
    assert(result.afterRemove.rows===0&&result.afterRemove.enabled===false,'× did not remove Orange Orbit: '+JSON.stringify(result.afterRemove));
    assert(result.afterRefresh.rows===0&&result.afterRefresh.enabled===false,'Orange Orbit reappeared after rerender: '+JSON.stringify(result.afterRefresh));
    assert(result.afterAdd.rows===1&&result.afterAdd.enabled===true&&result.afterAdd.label==='Орбиты','Orange Orbit could not be added back: '+JSON.stringify(result.afterAdd));
    assert(result.audioInitial.source==='system'&&result.audioInitial.selected==='system','PC system audio not initial default: '+JSON.stringify(result.audioInitial));
    assert(result.afterPanel.selected==='system'&&result.afterManual.selected==='microphone','Opening audio panel changed source unexpectedly: '+JSON.stringify(result));
    await h.call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
    const mobile=await h.evaluate(`(async()=>{
      const src=document.getElementById('audioSourceSelect');
      // Reset to the factory PC choice, then open the audio panel on a phone.
      state.audioReactive.source='system';src.value='system';
      document.getElementById('btnCloseAudioPanel').click();
      document.getElementById('btnAudioReactive').click();
      await new Promise(r=>setTimeout(r,15));
      const pc={source:state.audioReactive.source,selected:src.value,disabled:src.querySelector('option[value="system"]').disabled};
      src.value='microphone';src.dispatchEvent(new Event('change',{bubbles:true}));
      document.getElementById('btnCloseAudioPanel').click();document.getElementById('btnAudioReactive').click();
      return {pc,manual:{source:state.audioReactive.source,selected:src.value}};
    })()`,{timeoutMs:5000,label:'mobile PC audio default'});
    assert(mobile.pc.source==='system'&&mobile.pc.selected==='system'&&!mobile.pc.disabled,'Mobile opening forced microphone: '+JSON.stringify(mobile));
    assert(mobile.manual.source==='microphone'&&mobile.manual.selected==='microphone','Manual microphone lost on mobile: '+JSON.stringify(mobile));
    assert(!uncaughtExceptions(h.events).length,'Uncaught browser errors: '+uncaughtExceptions(h.events).join('|'));
    console.log('7.11.14 LIGHTNING / ORBIT / AUDIO DEFAULTS: PASS '+JSON.stringify(result));
  }finally{await h.close();}
})().catch(e=>{console.error('7.11.14 LIGHTNING / ORBIT / AUDIO DEFAULTS: FAIL '+(e.stack||e));process.exit(1)});
