const fs=require('fs');
const path=require('path');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const ROOT=path.resolve(__dirname,'..');
const assert=(c,m)=>{if(!c)throw new Error(m)};
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');

(async()=>{
  const registry=read('js/core/parameter-routing.js'),css=read('styles/app.css'),html=read('index.html'),pipeline=read('js/render/main-pipeline.js');
  assert(registry.includes('sharedRoutingDefinitions')&&registry.includes('audioCompatibilityDefinitions'),'shared canonical routing catalog missing');
  assert(pipeline.includes('applySharedAudioParameterFrameRouting'),'generic shared Audio frame overlay missing');
  assert(html.includes('audioGroupFill')&&html.includes('audioGroupLineMotion')&&html.includes('audioGroupSprite')&&html.includes('audioGroupParticles')&&html.includes('audioGroupSpiral'),'Audio Link is missing shared Morph groups');
  assert(css.includes('width:68vw!important')&&css.includes('audio-route-row-icon'),'Audio Link was not widened / row icons missing');

  const h=await createBrowserHarness({disableGpu:true,evalTimeoutMs:15000});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const out=await h.evaluate(`(()=>{
      const R=window.SomataParameterRegistry;
      const morph=R.sharedRoutingDefinitions(),audio=R.audioDefinitions();
      const morphIds=morph.map(d=>d.id),audioIds=audio.map(d=>d.parameterId);
      const same=JSON.stringify(morphIds)===JSON.stringify(audioIds);
      const morphGroups=[...new Set(morph.map(d=>d.morph?.group||d.group))];
      document.getElementById('btnAudioRouting')?.click();
      renderAudioRoutingPanel();
      const audioGroupButtons=[...document.querySelectorAll('#audioRoutingTools .audio-route-group-btn')].filter(b=>!b.closest('.audio-route-group')?.classList.contains('hidden'));
      const audioGroups=audioGroupButtons.map(b=>b.textContent.replace('▾','').trim());
      const groupIcons=audioGroupButtons.map(b=>({name:b.textContent.trim(),icon:!!b.querySelector('.audio-routing-group-icon,.morph-routing-group-icon')}));

      // Add a formerly Morph-only parameter through the real Audio group menu.
      state.audioReactive.routingTarget='master';state.audioReactive.active=true;state.audioReactive.effectsAmplitudeStrength=100;state.audioReactive.effectsAmplitudeMultiplier=1;
      state.audioReactive.levels=[1,1,1,1,1];state.audioReactive.derivatives=[0,0,0,0,0];
      const routes=ensureAudioRoutingState();routes.master=routes.master.filter(r=>r.param!=='web.oscillationStrength');renderAudioRoutingPanel();
      const webBtn=document.getElementById('audioGroupWeb');webBtn?.click();
      const webMenu=document.getElementById('audioGroupWebMenu');
      const opt=[...webMenu.querySelectorAll('button')].find(b=>b.textContent.trim()==='Сила колебаний');opt?.click();
      const added=ensureAudioRoutingState().master.find(r=>r.param==='web.oscillationStrength');
      if(added){added.band='combined';added.strength=100;added.multiplier=1;added.enabled=true;added.derivative=false;added.signalMode='add';}
      renderAudioRoutingPanel();
      const row=[...document.querySelectorAll('#audioMasterGlobalRows .audio-route-row')].find(r=>r.querySelector('.audio-param-picker-button')?.textContent.includes('Сила колебаний'));
      const rowIcon=!!row?.querySelector('.audio-route-row-icon');

      // The new shared target must affect frame-only effect state, never authored state.
      const live=state.layers[0];live.web=live.web||{};const authoredBefore=Number(live.web.oscillationStrength)||0;
      const layer=structuredClone(live),effectLayer=structuredClone(live);effectLayer.web=effectLayer.web||{};effectLayer.web.oscillationStrength=10;
      applySharedAudioParameterFrameRouting({layerIndex:0,layer,effectLayer});
      const frameValue=effectLayer.web.oscillationStrength,authoredAfter=Number(live.web.oscillationStrength)||0;

      const panel=document.getElementById('audioRoutingPanel').getBoundingClientRect();
      const compat=R.audioCompatibilityDefinitions().map(d=>d.key);
      return{morphCount:morphIds.length,audioCount:audioIds.length,same,morphGroups,audioGroups,groupIcons,added:!!added,rowIcon,frameValue,authoredBefore,authoredAfter,panelWidth:panel.width,viewport:innerWidth,compat};
    })()`,{timeoutMs:15000,label:'7.9.6 shared Audio/Morph catalog'});

    assert(out.same&&out.morphCount===out.audioCount&&out.morphCount>=70,'Audio/Morph canonical parameter sets diverged: '+JSON.stringify({m:out.morphCount,a:out.audioCount}));
    assert(JSON.stringify(out.morphGroups)===JSON.stringify(out.audioGroups),'Audio/Morph group sets/order diverged: '+JSON.stringify({m:out.morphGroups,a:out.audioGroups}));
    assert(out.groupIcons.every(x=>x.icon),'Audio group pictograms missing: '+JSON.stringify(out.groupIcons.filter(x=>!x.icon)));
    assert(out.added&&out.rowIcon,'real Audio group action did not add/render a formerly Morph-only target with row icon');
    assert(Number.isFinite(out.frameValue)&&Math.abs(out.frameValue-10)>1e-6,'generic Audio frame overlay did not affect new shared parameter');
    assert(out.authoredAfter===out.authoredBefore,'generic Audio frame overlay mutated authored layer state');
    if(out.viewport>1200)assert(out.panelWidth>Math.min(700,out.viewport*.55),'desktop Audio Link panel was not widened enough: '+out.panelWidth);
    assert(out.compat.includes('layer.scale'),'legacy audio-only compatibility alias layer.scale was lost');
    assert(!out.compat.includes('tunnel.speed'),'Corridor speed must now be canonical shared Morph/Audio, not compatibility-only');
    const errors=uncaughtExceptions(h.events).slice(baseline);assert(!errors.length,'uncaught browser exceptions: '+errors.join(' | '));
    console.log('7.9.6 AUDIO/MORPH SHARED CATALOG + ICONS: PASS',out);
  }finally{await h.close();}
})().catch(e=>{console.error('7.9.6 AUDIO/MORPH SHARED CATALOG + ICONS: FAIL',e.stack||e);process.exit(1)});
