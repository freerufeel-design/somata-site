const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(c,m)=>{if(!c)throw new Error(m)};
(async()=>{
  const h=await createBrowserHarness({disableGpu:true,evalTimeoutMs:30000});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const out=await h.evaluate(`(async()=>{
      const sleep=ms=>new Promise(r=>setTimeout(r,ms));
      const original=state.layers[0].id;
      const routes=ensureAudioRoutingState();
      routes.layers[original]=[{id:'v7115-user-audio',enabled:true,band:'low',param:'layer.radius',strength:137,multiplier:1.5,derivative:false,signalMode:'add'}];
      state.audioReactive.routingTarget=original;
      state.audioReactive.layerSignalEnabled[original]=false;
      const sw=document.getElementById('minimalMorphInstant');if(sw){sw.checked=true;sw.dispatchEvent(new Event('change',{bubbles:true}));}
      state.minimalMorph.instantSwitch=true;
      if(!runtimeState.morph.active)activeStartMorphing();
      document.getElementById('btnMinimalMorph').click();
      await sleep(260);
      const capture=()=>{const id=state.layers[0]?.id;const r=ensureAudioRoutingState().layers[id]||[];return{id,rows:r.filter(x=>x.id==='v7115-user-audio').map(x=>({strength:x.strength,multiplier:x.multiplier})),signal:state.audioReactive.layerSignalEnabled[id],target:state.audioReactive.routingTarget,blue:runtimeState.morph.active,orange:runtimeState.minimalMorph.active};};
      const first=capture();
      document.getElementById('btnRandomPreset').click();await sleep(220);const second=capture();
      document.getElementById('btnRandomPreset').click();await sleep(220);const third=capture();
      state.audioReactive.layerSignalEnabled[third.id]=true;
      state.audioReactive.active=true;state.audioReactive.effectsAmplitudeStrength=100;state.audioReactive.effectsAmplitudeMultiplier=1;
      state.audioReactive.derivatives=[0,0,0,0,0];
      const sample=level=>{state.audioReactive.levels=[level,0,0,0,0];beginFrameGeometryRuntime();const frame=renderRuntime.frame||{};frame.now=performance.now();frame.id=(Number(frame.id)||0)+1;frame.dpr=1;frame.audioActive=true;const c=prepareMainLayerFrame(frame,0);return {scale:c?.audioScale,blue:c?.blueMorphProvider?.active,frameAudio:frame.audioActive,active:state.audioReactive.active,routeActive:hasActiveAudioRoute('layer.radius'),routed:audioApplyNumeric('layer.radius',Number(c?.layer?.radius)||100,0),radius:c?.layer?.radius,signal:state.audioReactive.layerSignalEnabled[third.id]};};
      const modulated={silent:sample(0),loud:sample(1)};
      state.audioReactive.layerSignalEnabled[third.id]=false;
      activeStopMinimalMorphing(true);await sleep(70);
      const restored=capture();
      return{original,first,second,third,restored,modulated};
    })()`,{timeoutMs:30000,label:'7.11.5 Blue+Orange Audio route lifecycle'});
    for(const [name,frame] of [['first',out.first],['second',out.second],['third',out.third]]){
      assert(frame.blue&&frame.orange,`${name}: both Morph owners not active: ${JSON.stringify(frame)}`);
      assert(frame.rows.length===1&&frame.rows[0].strength===137&&frame.rows[0].multiplier===1.5,`${name}: Audio link detached: ${JSON.stringify(frame)}`);
      assert(frame.signal===false,`${name}: Audio layer enable toggle lost: ${JSON.stringify(frame)}`);
      assert(frame.target===frame.id,`${name}: routing selection did not follow new layer ID: ${JSON.stringify(frame)}`);
    }
    assert(out.first.id!==out.original||out.second.id!==out.first.id,'Orange did not regenerate any layer IDs');
    assert(out.restored.rows.length===1&&out.restored.rows[0].strength===137&&out.restored.signal===false&&out.restored.target===out.restored.id,'Audio route was not preserved on Orange origin restore: '+JSON.stringify(out.restored));
    assert(out.modulated?.loud?.scale>out.modulated?.silent?.scale*1.05,'Surviving Audio route had no render impact under Blue+Orange: '+JSON.stringify(out.modulated));
    const errors=uncaughtExceptions(h.events).slice(baseline);assert(!errors.length,`uncaught browser exceptions: ${errors.join(' | ')}`);
    console.log('7.11.5 BLUE + ORANGE AUDIO LINK CONTINUITY: PASS',out);
  }finally{await h.close();}
})().catch(e=>{console.error('7.11.5 BLUE + ORANGE AUDIO LINK CONTINUITY: FAIL',e.stack||e);process.exit(1)});
