const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(c,m)=>{if(!c)throw new Error(m)};
(async()=>{
  const h=await createBrowserHarness({disableGpu:true,evalTimeoutMs:20000});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const out=await h.evaluate(`(async()=>{
      const sleep=ms=>new Promise(r=>setTimeout(r,ms));
      // Build six layers so RMB must expose only 1..5 + М.
      const base=state.layers[0];
      while(state.layers.length<6){const n=structuredClone(base);n.id='v7108_'+state.layers.length+'_'+Math.random().toString(36).slice(2);n.name='Layer '+(state.layers.length+1);state.layers.push(n);}refreshLayerLookup?.(true);ensureAudioRoutingState();
      const def=SomataParameterRegistry.get('web.width'),el=document.getElementById(def.ui.mainId),host=el.closest('.blue-morph-range-host')||el;
      const routes=ensureAudioRoutingState();routes.master=routes.master.filter(r=>r.param!==def.id);for(const l of state.layers)routes.layers[l.id]=(routes.layers[l.id]||[]).filter(r=>r.param!==def.id);
      window.__syncParameterRoutingDecorations();
      const r=host.getBoundingClientRect();host.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2,clientX:r.left+3,clientY:r.top+3}));await sleep(5);
      let menu=document.getElementById('parameterRoutingContextMenu');
      const labels=()=>[...menu.querySelectorAll('.parameter-routing-target-bubble')].map(b=>b.textContent.trim());
      const clickLabel=async label=>{menu=document.getElementById('parameterRoutingContextMenu');const b=[...menu.querySelectorAll('.parameter-routing-target-bubble')].find(x=>x.textContent.trim()===label);b?.click();await sleep(4);menu=document.getElementById('parameterRoutingContextMenu');};
      const initialLabels=labels();await clickLabel('1');await clickLabel('3');await clickLabel('5');await clickLabel('М');
      const targets=SomataAudioParameterRoutingUI.targets(def.id),openAfterMulti=!menu.classList.contains('hidden');
      window.__syncParameterRoutingDecorations();await sleep(4);
      const row=host.closest('.control-row')||host.parentElement;const badgeLabels=[...row.querySelectorAll('.parameter-routing-audio-bubble')].map(x=>x.textContent.trim());

      // Regression: canonical Audio Размер must visibly compose after the Blue carrier is resolved.
      const rid='layer.radius',lid=state.layers[0].id;for(const l of state.layers)routes.layers[l.id]=(routes.layers[l.id]||[]).filter(r=>r.param!==rid);routes.master=routes.master.filter(r=>r.param!==rid);
      SomataAudioParameterRoutingUI.setTargetActive(rid,lid,true);const rr=routes.layers[lid].find(x=>x.param===rid);rr.band='low';rr.strength=100;rr.multiplier=1;rr.enabled=true;
      state.audioReactive.active=true;state.audioReactive.effectsAmplitudeStrength=100;state.audioReactive.effectsAmplitudeMultiplier=1;state.audioReactive.derivatives=[0,0,0,0,0];
      if(runtimeState.morph.active)activeStopMorphing(false);activeStartMorphing();await sleep(120);runtimeState.morph.paused=true;
      const frameAt=level=>{state.audioReactive.levels=[level,0,0,0,0];beginFrameGeometryRuntime();const f=renderRuntime.frame||{};f.now=performance.now();f.id=(Number(f.id)||0)+1;f.dpr=1;const c=prepareMainLayerFrame(f,0);return{radius:Number(c?.layer?.radius)||0,audioScale:Number(c?.audioScale)||0,combinedScale:Number(c?.combinedScale)||0,blue:c?.blueMorphProvider?.active===true};};
      const zero=frameAt(0),full=frameAt(1);activeStopMorphing(false);
      return{initialLabels,targets,openAfterMulti,badgeLabels,zero,full};
    })()`,{timeoutMs:20000,label:'7.10.8 Audio/Blue + RMB multi-target'});
    assert(JSON.stringify(out.initialLabels)===JSON.stringify(['1','2','3','4','5','М']),'RMB target bubbles are not capped to 1..5 + М: '+JSON.stringify(out.initialLabels));
    assert(out.targets.master===true&&out.targets.layers[0].active&&out.targets.layers[2].active&&out.targets.layers[4].active&&!out.targets.layers[1].active,'independent Audio target selection failed: '+JSON.stringify(out.targets));
    assert(out.openAfterMulti,'RMB routing menu closed during multi-target selection');
    assert(JSON.stringify(out.badgeLabels)===JSON.stringify(['1','3','5','М']),'left-panel burgundy target badges mismatch: '+JSON.stringify(out.badgeLabels));
    assert(out.zero.blue&&out.full.blue,'Blue Morph was not active during Audio composition probe');
    assert(Math.abs(out.full.radius-out.zero.radius)<1e-6,'Audio radius mutated the already-resolved Blue snapshot instead of composing after it: '+JSON.stringify({zero:out.zero,full:out.full}));
    assert(out.full.audioScale>out.zero.audioScale*1.1&&out.full.combinedScale>out.zero.combinedScale*1.1,'Audio size did not visibly scale the Blue carrier: '+JSON.stringify({zero:out.zero,full:out.full}));
    const errors=uncaughtExceptions(h.events).slice(baseline);assert(!errors.length,'uncaught browser exceptions: '+errors.join(' | '));
    console.log('7.10.8 AUDIO BLUE COMPOSITION + RMB MULTI-TARGET BADGES: PASS',out);
  }finally{await h.close();}
})().catch(e=>{console.error('7.10.8 AUDIO BLUE COMPOSITION + RMB MULTI-TARGET BADGES: FAIL',e.stack||e);process.exit(1)});
