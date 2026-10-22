// Somata 7.11.15: Blue/Orange header parity, real Orange period timing,
// no duplicate legacy rows, FFT-safe shared orbit percentages.
const fs=require('fs'),path=require('path');
const {ROOT}=require('./lib/test-utils');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(x,m)=>{if(!x)throw Error(m)};
(async()=>{
 const source=fs.readFileSync(path.join(ROOT,'js/app/ui-project-runtime.js'),'utf8');
 const matrixSrc=fs.readFileSync(path.join(ROOT,'js/core/parameter-matrix.js'),'utf8');
 const gpuSrc=fs.readFileSync(path.join(ROOT,'js/app/geometry-gpu-core.js'),'utf8');
 const css=fs.readFileSync(path.join(ROOT,'styles/app.css'),'utf8');
 assert(/Math\.ceil\(maxOrbits\*pct\/100\)/.test(source),'Orange must ceil proportional per-polygon orbits');
 assert(/Math\.ceil\(\(Math\.max\(1,minPct\) \/ 100\) \* total\)/.test(source),'Blue must ceil proportional per-polygon orbits');
 assert(/Math\.ceil\(maxOrbits\*pct\/100\)/.test(gpuSrc),'Audio must use the same proportional orbit rounding');
 assert(/body:has\(#randomSettingsPanel:not\(\.hidden\)\) #fpsCounter/.test(css),'FPS overlay should be hidden over Morph panel');
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:200,evalTimeoutMs:30000});
 try{
  // Harness deliberately strips stylesheets. Restore CSS to test the real
  // user-visible absence of the legacy bottom settings and FPS overlap.
  await h.evaluate(`(()=>{const el=document.createElement('style');el.textContent=${JSON.stringify(css)};document.head.appendChild(el)})()`,{returnByValue:false,timeoutMs:30000,label:'restore app CSS'});
  const data=await h.evaluate(`(async()=>{
    const sleep=ms=>new Promise(r=>setTimeout(r,ms));
    document.getElementById('btnRandomSettings').click();await sleep(25);
    const panel=document.getElementById('randomSettingsPanel');
    const timing=document.getElementById('orangeMorphHeaderTiming'),legacy=panel.querySelector('.orange-fixed-settings');
    const style=e=>e?getComputedStyle(e).display:'missing';
    const before={open:!panel.classList.contains('hidden'),timing:!!timing,legacyDisplay:style(legacy),noteDisplay:style(panel.querySelector('.morph-settings-note')),
      toolbarDefault:!!panel.querySelector('.orange-profile-toolbar #minimalMorphDefaultActive'),
      cycleLabel:timing?.querySelector('.orange-top-cycle-row>span')?.textContent,
      layerInHeader:!!timing?.querySelector('#randomLayerCount'),instantInHeader:!!timing?.querySelector('#minimalMorphInstant'),fadeInHeader:!!timing?.querySelector('#minimalMorphFade'),
      familyVisible:!!panel.querySelector('.minimal-morph-family-row')?.getClientRects().length,
      poolsVisible:!!panel.querySelector('.minimal-morph-pools-row')?.getClientRects().length,
      paletteVisible:!!panel.querySelector('.minimal-morph-palette-row')?.getClientRects().length,
      addButton:document.getElementById('btnAddOrangeMorphParameter')?.textContent,
      fpsDisplay:style(document.getElementById('fpsCounter')),
      quick:[...timing.querySelectorAll('[data-orange-interval]')].map(b=>b.textContent),
      multiplier:document.getElementById('minimalMorphIntervalMultiplier')?.value};
    timing.querySelector('[data-orange-interval="8"]').click();
    const mult=document.getElementById('minimalMorphIntervalMultiplier');mult.value='2';mult.dispatchEvent(new Event('input',{bubbles:true}));mult.dispatchEvent(new Event('change',{bubbles:true}));
    const changed={interval:state.minimalMorph.intervalSec,multiplier:state.minimalMorph.intervalMultiplier,profileDirty:window.SomataOrangeMorphProfiles.isDirty(state.minimalMorph,state.randomOptions,state.randomLayerCount)};
    // New footer picker must work repeatedly while remaining within the same panel.
    const add=document.getElementById('btnAddOrangeMorphParameter');add.click();await sleep(15);
    const picker=document.getElementById('orangeMorphParameterPicker');const options=[...picker.querySelectorAll('.audio-param-option')];
    const chosen=options.find(el=>el.textContent==='Расстояние')||options.find(el=>el.textContent==='Толщина линии')||options.find(el=>el.textContent==='Свечение')||options.find(el=>el.textContent==='Границы');
    const pickerBefore={visible:!picker.classList.contains('hidden'),options:options.length};chosen?.click();await sleep(15);
    const pickerAfter={open:!panel.classList.contains('hidden'),pickerClosed:picker.classList.contains('hidden'),chosen:chosen?.textContent};
    const orange=document.querySelector('#orangeMorphBindings [data-orange-special="orbits"]');
    const inputs=[...orange.querySelectorAll('.morph-route-inline-range input[type="number"]')];
    const orbitBefore={schema:window.SomataParameterMatrix.get('geometry.orbits'),limits:inputs.map(i=>[i.min,i.max,i.value]),units:orange.querySelector('.morph-sec')?.textContent};
    inputs[0].value='25';inputs[1].value='25';inputs[1].dispatchEvent(new Event('change',{bubbles:true}));
    const orbitAfter={lo:state.randomOptions.orbitPercentMin,hi:state.randomOptions.orbitPercentMax};
    const gcd=(a,b)=>b?gcd(b,a%b):a,examples=[];
    for(let k=0;k<8;k++){
      document.getElementById('btnRandomPreset').click();
      const snapshot=(state.layers||[]).filter(l=>l&&!l.chaosStar).map(l=>{const total=Math.max(1,gcd(Math.max(2,Number(l.N)||2),Math.max(0,Number(l.K)||0)));return {total,expected:Math.max(1,Math.ceil(total*.25)),actual:l.customSuborbits};});
      examples.push(...snapshot);
    }
    // A type-change and a manual profile update must not recreate the lower rows.
    syncRandomSettingsUI();syncOrangeMorphProfileUI();await sleep(5);
    return {before,changed,pickerBefore,pickerAfter,orbitBefore,orbitAfter,examples,afterRefresh:{legacy:style(legacy),header:!!document.querySelector('#orangeMorphHeaderTiming #minimalMorphInterval'),rows:document.querySelectorAll('#orangeMorphHeaderTiming #randomLayerCount').length}};
  })()`,{timeoutMs:30000,label:'Orange header and orbit % in real browser'});
  const b=data.before;
  assert(b.open&&b.timing&&b.toolbarDefault&&b.cycleLabel==='Период цикла', 'Orange header not installed: '+JSON.stringify(b));
  assert(b.layerInHeader&&b.instantInHeader&&b.fadeInHeader,'Core Orange controls must be in header: '+JSON.stringify(b));
  assert(b.legacyDisplay==='none'&&b.noteDisplay==='none'&&!b.familyVisible&&!b.poolsVisible&&!b.paletteVisible,'Legacy duplicated footer visible: '+JSON.stringify(b));
  assert(b.fpsDisplay==='none','FPS overlays Orange Morph: '+JSON.stringify(b));
  assert(b.quick.join('|')==='1s|2s|3s|5s|8s|15s'&&b.addButton.includes('Добавить связь'),'Period/links should mirror Blue: '+JSON.stringify(b));
  assert(data.changed.interval===8&&data.changed.multiplier===2&&data.changed.profileDirty,'Orange header period inputs not stored: '+JSON.stringify(data.changed));
  assert(data.pickerBefore.visible&&data.pickerBefore.options>=80&&data.pickerAfter.open&&data.pickerAfter.pickerClosed&&data.pickerAfter.chosen,'Add link footer not functional: '+JSON.stringify(data.pickerAfter));
  assert(data.orbitBefore.limits.every(x=>x[0]==='1'&&x[1]==='100')&&data.orbitBefore.units==='%', 'Orbit range not 1..100%: '+JSON.stringify(data.orbitBefore));
  assert(data.orbitAfter.lo===25&&data.orbitAfter.hi===25,'Orange range did not persist percentage: '+JSON.stringify(data.orbitAfter));
  assert(data.examples.length>0&&data.examples.every(x=>(x.actual??x.total)===x.expected), 'Per-polygon ceil not applied to live compositions: '+JSON.stringify(data.examples));
  assert(data.examples.some(x=>x.total>1),'Geometry test did not generate multi-orbit polygons');
  assert(data.afterRefresh.legacy==='none'&&data.afterRefresh.header&&data.afterRefresh.rows===1,'Rerender lost/duplicated header: '+JSON.stringify(data.afterRefresh));
  assert(!uncaughtExceptions(h.events).length,'Browser uncaught: '+uncaughtExceptions(h.events).slice(0,3).join(' | '));
  console.log('7.11.15 ORANGE HEADER + ORBIT PERCENT: PASS',JSON.stringify({header:{period:b.cycleLabel,defaults:b.toolbarDefault},cycle:data.changed,orbits:data.orbitAfter,examples:data.examples.slice(0,5)}));
 }finally{await h.close()}
})().catch(e=>{console.error('7.11.15 HEADER+ORBIT: FAIL',e.stack||e);process.exitCode=1});
