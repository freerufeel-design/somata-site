const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(ok,msg)=>{if(!ok)throw new Error(msg)};
(async()=>{
  const h=await createBrowserHarness({disableGpu:true,evalTimeoutMs:35000});
  const base=uncaughtExceptions(h.events).length;
  try{
    const r=await h.evaluate(`(async()=>{
      const sleep=ms=>new Promise(r=>setTimeout(r,ms));
      const show=()=>state.layers.map(l=>({id:l.id,line:l.lineVisible!==false,visible:l.visible!==false}));
      const setLine=on=>{const cb=document.getElementById('showLines');cb.checked=on;cb.dispatchEvent(new Event('change',{bubbles:true}));};
      const next=async()=>{document.getElementById('btnRandomPreset').click();await sleep(130);};
      const stop=async()=>{document.getElementById('btnMinimalMorph').click();await sleep(70);};
      if(runtimeState.minimalMorph.active)activeStopMinimalMorphing(false);
      if(runtimeState.morph.active)activeStopMorphing?.(false);
      state.randomLayerCount=3;document.getElementById('randomLayerCount').value='3';
      state.minimalMorph.instantSwitch=true;document.getElementById('minimalMorphInstant').checked=true;
      state.minimalMorph.generatorStyle='standard';
      state.layers.forEach(l=>{l.lineVisible=true;l.visible=true;});
      state.layers[0].lineVisible=false;
      state.layers[0].visible=false;
      const before=show();
      document.getElementById('btnMinimalMorph').click();await sleep(250);
      const initial=show();
      // User's live Line checkbox toggles affect currently edited layer.
      setLine(false);await sleep(30);
      const hidden=show();
      await next();const afterNext=show();
      setLine(true);await sleep(30);
      const enabled=show();
      await next();const afterSecond=show();
      await stop();const restored=show();
      // Repeat with Fade: change Line while target is already in flight.
      state.layers.forEach(l=>{l.lineVisible=true;l.visible=true;});
      if(!runtimeState.morph.active)activeStartMorphing();
      const blueActive=runtimeState.morph.active===true;
      state.minimalMorph.instantSwitch=false;document.getElementById('minimalMorphInstant').checked=false;
      state.minimalMorph.fadeSec=2;document.getElementById('minimalMorphFade').value='2';
      document.getElementById('btnMinimalMorph').click();await sleep(200);
      const fadingBefore=runtimeState.minimalMorph.transitioning===true;
      setLine(false);await sleep(130);
      const during={authored:show(),source:(runtimeState.minimalMorph.sourceLayers||[]).map(l=>l.lineVisible!==false),target:(runtimeState.minimalMorph.targetLayers||[]).map(l=>l.lineVisible!==false)};
      await next();const forced=show();
      await stop();const fadeRestored=show();
      return{before,initial,hidden,afterNext,enabled,afterSecond,restored,blueActive,fadingBefore,during,forced,fadeRestored};
    })()`,{timeoutMs:35000,label:'7.11.6 Orange live Line visibility lifecycle'});
    assert(r.initial[0].line===false && r.initial[0].visible===false,'Orange start reset existing hidden Line/layer '+JSON.stringify(r.initial));
    assert(r.hidden[0].line===false,'Line checkbox failed to hide current layer');
    assert(r.afterNext[0].line===false && r.afterNext[0].visible===false,'Orange regenerated enabled Line / hidden layer after user disabled it');
    assert(r.enabled[0].line===true,'Line checkbox failed to reenable Line');
    assert(r.afterSecond[0].line===true,'Orange regenerated disabled Line after user enabled it');
    assert(r.restored[0].line===true && r.restored[0].visible===false,'Stopping Orange reset user visibility '+JSON.stringify(r.restored));
    assert(r.blueActive,'Blue Morph was not active alongside Orange');
    assert(r.fadingBefore,'Fade did not start');
    assert(r.during.authored[0].line===false && r.during.source[0]===false && r.during.target[0]===false,'Line visibility not applied to both Fade carriers '+JSON.stringify(r.during));
    assert(r.forced[0].line===false && r.fadeRestored[0].line===false,'Fade commit/stop reset Line again');
    const failures=uncaughtExceptions(h.events).slice(base);assert(!failures.length,'Uncaught browser exceptions: '+failures.join(' | '));
    console.log('7.11.6 ORANGE LIVE LINE VISIBILITY: PASS',JSON.stringify(r));
  } finally {await h.close();}
})().catch(err=>{console.error('7.11.6 ORANGE LIVE LINE VISIBILITY: FAIL',err.stack||err);process.exit(1)});
