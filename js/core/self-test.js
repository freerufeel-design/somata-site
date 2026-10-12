// Somata 7.3.20 — non-destructive playlist validation + opt-in browser smoke runners.
window.__spiroRegisterModule?.('js/core/self-test');

(function(){
  'use strict';
  const majorEffects=['base','fill','glow','lamps','sweep','web','geometryCircles','spiral','motionRotation','corridor'];
  // Effects below own an observable render pass. Spiral/Motion Rotation transform the shared
  // geometry, while Corridor is scheduler/instance state, so those three are validated by the
  // layer-plan + ownership checks instead of pretending they have a separate compositor pass.
  const observablePassFeatures={base:'geometry',fill:'fill',glow:'glow',lamps:'lamps',sweep:'sweep',web:'web',geometryCircles:'geometryCircles'};
  const uniq=a=>[...new Set(a)];
  const isVisibleAuthoredFill=l=>Boolean(l&&l.fill===true&&l.lineVisible!==false&&((typeof getFillOpacityUnit==='function'?getFillOpacityUnit(l.fillColor,DEFAULT_FILL_OPACITY_PERCENT):(/#[0-9a-fA-F]{8}$/.test(String(l.fillColor||''))?parseInt(String(l.fillColor).slice(-2),16)/255:1))>.00001));
  function effectCoverage(entries){
    const coverage=Object.fromEntries(majorEffects.map(k=>[k,[]]));
    coverage.corridorFillGlow=[];
    for(const entry of entries||[]){
      const p=entry?.project||{},layers=Array.isArray(p.layers)?p.layers:[],t=p.settings?.tunnel||{};
      const corridor=t.defaultActive===true;
      if(corridor)coverage.corridor.push(entry.name||'');
      for(const l of layers){
        if(!l||l.visible===false)continue;
        const carrier=l.lineVisible!==false;
        if(carrier)coverage.base.push(entry.name||'');
        if(carrier&&isVisibleAuthoredFill(l))coverage.fill.push(entry.name||'');
        if(carrier&&Number(l.glow)>0)coverage.glow.push(entry.name||'');
        if(l.showLamps===true)coverage.lamps.push(entry.name||'');
        if(l.sweep?.enabled===true)coverage.sweep.push(entry.name||'');
        if(l.showWeb===true)coverage.web.push(entry.name||'');
        if(l.geometryCircles?.enabled===true)coverage.geometryCircles.push(entry.name||'');
        if(l.spiralEnabled===true)coverage.spiral.push(entry.name||'');
        if(l.motionRotation?.enabled===true)coverage.motionRotation.push(entry.name||'');
        if(corridor&&carrier&&l.fill===true&&Number(l.glow)>0)coverage.corridorFillGlow.push(entry.name||'');
      }
    }
    for(const k of Object.keys(coverage))coverage[k]=uniq(coverage[k].filter(Boolean));
    return coverage;
  }
  function validateFinite(value,path='root',issues=[]){
    if(typeof value==='number'&&!Number.isFinite(value))issues.push(`${path}: non-finite number`);
    else if(Array.isArray(value))value.forEach((v,i)=>validateFinite(v,`${path}[${i}]`,issues));
    else if(value&&typeof value==='object')for(const [k,v] of Object.entries(value))validateFinite(v,`${path}.${k}`,issues);
    return issues;
  }
  function runtimeEntries(){
    return Array.isArray(state?.playlistProjects)?state.playlistProjects:[];
  }
  function projectModeIntent(entry){
    const settings=entry?.project?.settings||{};
    return {
      blue:settings.morph?.defaultActive===true,
      orange:settings.minimalMorph?.defaultActive===true,
      tunnel:settings.tunnel?.defaultActive===true
    };
  }
  function validateModeStatus(entry,status){
    const expected=projectModeIntent(entry),issues=[];
    if(!status||status.error){issues.push(`mode status unavailable${status?.error?`: ${status.error}`:''}`);return{expected,status,issues};}
    if(status.savedBlueDefault!==expected.blue)issues.push(`blue saved default mismatch: expected ${expected.blue}`);
    if(status.savedOrangeDefault!==expected.orange)issues.push(`orange saved default mismatch: expected ${expected.orange}`);
    if(status.blueActive!==expected.blue)issues.push(`blue active mismatch: expected ${expected.blue}`);
    if(status.orangeActive!==expected.orange)issues.push(`orange active mismatch: expected ${expected.orange}`);
    if(status.tunnelActive!==expected.tunnel)issues.push(`corridor active mismatch: expected ${expected.tunnel}`);
    if(status.tunnelTask!==expected.tunnel)issues.push(`corridor scheduler ownership mismatch: expected ${expected.tunnel}`);
    const blueOwned=status.blueTask===true||status.blueArmPending===true||status.bluePausedByOrange===true;
    if(expected.blue&&!blueOwned)issues.push('blue Morph active without scheduler/arm ownership');
    if(!expected.blue&&(status.blueTask===true||status.blueArmPending===true))issues.push('blue Morph scheduler ownership leaked while disabled');
    const orangeOwned=status.orangeTask===true||status.orangeArmPending===true;
    if(expected.orange&&!orangeOwned)issues.push('Minimal Morph active without scheduler/arm ownership');
    if(!expected.orange&&orangeOwned)issues.push('Minimal Morph scheduler ownership leaked while disabled');
    return{expected,status,issues};
  }
  function safeCall(fn){try{return typeof fn==='function'?fn():null;}catch(err){return{error:String(err?.message||err)};}}

  window.__somataSelfTestPlaylist=(options={})=>{
    const entries=runtimeEntries(),issues=[];
    if(!entries.length)issues.push('playlist has no loaded projects');
    for(const [i,e] of entries.entries()){
      if(!e?.project||!Array.isArray(e.project.layers)||!e.project.layers.length)issues.push(`project ${i}: no layers`);
      validateFinite(e?.project,`project[${i}]`,issues);
    }
    const coverage=effectCoverage(entries);
    for(const key of majorEffects)if(!coverage[key]?.length)issues.push(`no live playlist fixture for ${key}`);
    if(!coverage.corridorFillGlow.length)issues.push('no visible Corridor + Fill + Glow fixture');
    const probes={
      lineVisibility:safeCall(window.__spiroV389RegressionProbe),
      fillDefaults:safeCall(window.__spiroFillDefaultsProbe),
      backend:safeCall(window.__somataRenderBackend),
      passIsolation:safeCall(window.__spiroPassIsolationStatus),
      renderGraph:safeCall(window.__spiroRenderGraphStatus)
    };
    const lineProbe=probes.lineVisibility;if(lineProbe&&lineProbe.pass!==true)issues.push('lineVisibility probe failed');
    const fillProbe=probes.fillDefaults;if(fillProbe&&fillProbe.pass!==true)issues.push('fillDefaults probe failed');
    const result={version:'7.3.20',pass:issues.length===0,projectCount:entries.length,coverage,issues,probes};
    if(options.log!==false){console.group?.(`[Somata 7.3.20 self-test] ${result.pass?'PASS':'FAIL'}`);console.log(result);console.groupEnd?.();}
    return result;
  };

  const twoFrames=async()=>{for(let i=0;i<2;i++){if(typeof renderMainCanvas==='function')renderMainCanvas();else requestMainCanvasRender?.();await Promise.resolve();}};
  window.__somataPlaylistSmokeTest=async(options={})=>{
    const backend=String(options.backend||'cpu').toLowerCase()==='gpu'?'gpu':'cpu';
    const entries=runtimeEntries();
    const rows=[],runtimeErrors=[];
    if(!entries.length)return{version:'7.3.20',backend,pass:false,rows,errors:['playlist has no loaded projects']};
    if(typeof loadPlaylistProjectByIndex!=='function')return{version:'7.3.20',backend,pass:false,rows,errors:['playlist loader unavailable']};
    const previousIndex=typeof getCurrentPlaylistProjectIndex==='function'?getCurrentPlaylistProjectIndex():-1;
    const previousBackend=window.__somataRenderBackend?.().preference||'gpu';
    const onError=e=>runtimeErrors.push(String(e?.error?.stack||e?.message||'window error'));
    const onReject=e=>runtimeErrors.push(String(e?.reason?.stack||e?.reason||'unhandled rejection'));
    window.addEventListener('error',onError);window.addEventListener('unhandledrejection',onReject);
    try{
      window.__somataSetRenderBackend?.(backend);
      for(let i=0;i<entries.length;i++){
        const beforeErrors=runtimeErrors.length;
        const beforeDiag=window.__somataFullGpuDiagnostics?.()||{};
        await loadPlaylistProjectByIndex(i);
        requestMainCanvasRender?.();
        await twoFrames();
        const afterDiag=window.__somataFullGpuDiagnostics?.()||{};
        const layerPlans=[];
        for(let li=0;li<(state?.layers?.length||0);li++)layerPlans.push(safeCall(()=>window.__spiroEffectsPlanSnapshot?.(li)));
        const modeCheck=validateModeStatus(entries[i],safeCall(()=>window.__spiroReportProjectDefaultMorphStatus?.()));
        const renderTelemetry=safeCall(()=>window.__spiroRenderBackendStatus?.())||{};
        const backendStatus=window.__somataRenderBackend?.()||null;
        const passIssues=[];
        for(const [planKey,telemetryKey] of Object.entries(observablePassFeatures)){
          if(!layerPlans.some(plan=>plan?.[planKey]===true))continue;
          const rec=renderTelemetry?.features?.[telemetryKey]||null;
          if(!rec){passIssues.push(`${planKey}: enabled but ${telemetryKey} render pass was not observed`);continue;}
          if(backendStatus?.effective==='cpu'&&rec.backend==='gpu')passIssues.push(`${planKey}: CPU backend requested but pass reported GPU`);
        }
        if(layerPlans.some(plan=>plan?.corridor===true&&plan?.fill===true&&plan?.glow===true)){
          for(const key of ['geometry','fill','glow'])if(!renderTelemetry?.features?.[key])passIssues.push(`Corridor + Fill + Glow: missing ${key} pass`);
        }
        const newGpuErrors=Math.max(0,Number(afterDiag.errors||0)-Number(beforeDiag.errors||0));
        const newRuntimeErrors=runtimeErrors.slice(beforeErrors);
        const canvasOk=Boolean(typeof mainCanvas!=='undefined'&&mainCanvas?.width>0&&mainCanvas?.height>0);
        const pass=canvasOk&&!newRuntimeErrors.length&&!modeCheck.issues.length&&!passIssues.length&&(backend==='cpu'||newGpuErrors===0);
        rows.push({index:i,name:entries[i]?.name||`Project ${i+1}`,pass,canvasOk,newGpuErrors,runtimeErrors:newRuntimeErrors,modeCheck,passIssues,renderTelemetry,layerPlans,backend:backendStatus});
      }
    }finally{
      try{if(previousIndex>=0&&previousIndex<entries.length)await loadPlaylistProjectByIndex(previousIndex);}catch(_){}
      try{window.__somataSetRenderBackend?.(previousBackend);}catch(_){}
      window.removeEventListener('error',onError);window.removeEventListener('unhandledrejection',onReject);
      try{requestMainCanvasRender?.();}catch(_){}
    }
    const renderCoverage=Object.fromEntries(majorEffects.map(k=>[k,[]]));renderCoverage.corridorFillGlow=[];
    for(const row of rows){for(const plan of row.layerPlans||[]){if(!plan)continue;for(const key of majorEffects)if(plan[key]===true)renderCoverage[key].push(row.name);if(plan.corridor===true&&plan.fill===true&&plan.glow===true)renderCoverage.corridorFillGlow.push(row.name);}}
    for(const key of Object.keys(renderCoverage))renderCoverage[key]=uniq(renderCoverage[key]);
    const expectedCoverage=effectCoverage(entries),coverageIssues=[];
    for(const key of majorEffects)if(expectedCoverage[key]?.length&&!renderCoverage[key]?.length)coverageIssues.push(`render smoke did not activate ${key}`);
    if(expectedCoverage.corridorFillGlow?.length&&!renderCoverage.corridorFillGlow?.length)coverageIssues.push('render smoke did not activate Corridor + Fill + Glow');
    const modeIssues=rows.flatMap(r=>(r.modeCheck?.issues||[]).map(issue=>`${r.name}: ${issue}`));
    const passIssues=rows.flatMap(r=>(r.passIssues||[]).map(issue=>`${r.name}: ${issue}`));
    const result={version:'7.3.20',backend,pass:rows.every(r=>r.pass)&&runtimeErrors.length===0&&coverageIssues.length===0&&modeIssues.length===0&&passIssues.length===0,rows,errors:runtimeErrors,renderCoverage,coverageIssues,modeIssues,passIssues};
    if(options.log!==false){console.group?.(`[Somata 7.3.20 playlist smoke ${backend.toUpperCase()}] ${result.pass?'PASS':'FAIL'}`);console.table?.(rows.map(r=>({project:r.name,pass:r.pass,gpuErrors:r.newGpuErrors,runtimeErrors:r.runtimeErrors.length,modeIssues:r.modeCheck?.issues?.length||0,passIssues:r.passIssues?.length||0})));console.log('render coverage',renderCoverage);if(runtimeErrors.length)console.error(runtimeErrors);if(coverageIssues.length)console.error(coverageIssues);if(modeIssues.length)console.error(modeIssues);if(passIssues.length)console.error(passIssues);console.groupEnd?.();}
    return result;
  };

  // Dormant engine effects are not allowed to become a blind spot just because default.plist
  // currently stores them disabled. This smoke mutates one live layer transactionally, renders
  // real frames through the selected backend and then restores the exact layer object in-place.
  // It intentionally checks renderer telemetry emitted only after pixels were actually produced.
  window.__somataSyntheticEffectSmokeTest=async(options={})=>{
    const backend=String(options.backend||'cpu').toLowerCase()==='gpu'?'gpu':'cpu',rows=[],errors=[];
    const layer=state?.layers?.[0];if(!layer)return{version:'7.3.20',backend,pass:false,rows,errors:['no live layer available']};
    const clone=v=>{try{return structuredClone(v);}catch(_){return JSON.parse(JSON.stringify(v));}};
    const savedLayer=clone(layer),savedTunnel=clone(state?.tunnel||{}),savedBackend=window.__somataRenderBackend?.().preference||'gpu';
    const onError=e=>errors.push(String(e?.error?.stack||e?.message||'window error')),onReject=e=>errors.push(String(e?.reason?.stack||e?.reason||'unhandled rejection'));
    const restoreObject=(target,saved)=>{for(const k of Object.keys(target||{}))if(!Object.prototype.hasOwnProperty.call(saved,k))delete target[k];Object.assign(target,saved);};
    const quietBase=()=>{
      layer.visible=true;layer.lineVisible=true;layer.opacity=100;layer.fill=false;layer.glow=0;layer.showLamps=false;layer.showWeb=false;layer.spiralEnabled=false;
      layer.geometryCircles={...(layer.geometryCircles||{}),enabled:false};
      layer.motionRotation={...(layer.motionRotation||{}),enabled:false};
      layer.sweep={...(layer.sweep||{}),enabled:false};layer.sprite={...(layer.sprite||{}),enabled:false};layer.lineMotionFx={...(layer.lineMotionFx||{}),enabled:false};layer.particles={...(layer.particles||{}),enabled:false};
      layer.lineProfileApplication='stroke';layer.lineProfile='round';layer.lineProfileStroke='round';layer.lineProfileGraffiti='slash';
      if(state?.tunnel){state.tunnel.active=false;state.tunnel.defaultActive=false;}
    };
    const cases=[
      ...['seaRaft','jumpRope','sinusoid'].map(type=>({name:`motion:${type}`,plan:'motion',telemetry:'motion',apply(){quietBase();layer.lineMotionFx={...normalizeLineMotionFxConfig(layer.lineMotionFx),enabled:true,replaceBase:true,type};}})),
      {name:'sprite:perPath',plan:'sprite',telemetry:'sprite',apply(){quietBase();layer.sprite={...normalizeLineSpriteConfig(layer.sprite),enabled:true,type:'snake',mode:'perPath'};}},
      {name:'sprite+motion',plan:'sprite',telemetry:'sprite',also:['motion'],apply(){quietBase();layer.sprite={...normalizeLineSpriteConfig(layer.sprite),enabled:true,type:'dragon',mode:'perPath'};layer.lineMotionFx={...normalizeLineMotionFxConfig(layer.lineMotionFx),enabled:true,replaceBase:true,type:'seaRaft'};}},
      ...['flow','cornerFade','spiralZ'].map(mode=>({name:`particles:${mode}`,plan:'particles',telemetry:'particles',apply(){quietBase();layer.particles={...normalizeParticleConfig(layer.particles),enabled:true,style:mode==='spiralZ'?'plasma':'stardust',mode,density:32};}})),
      {name:'profile:slash',plan:'profile',telemetry:'profile',apply(){quietBase();layer.lineProfileApplication='stroke';layer.lineProfile='slash';layer.lineProfileStroke='slash';layer.lineMarkerType='slash';}},
      {name:'profile:graffiti',plan:'profile',telemetry:'profile',apply(){quietBase();layer.lineProfileApplication='graffiti';layer.lineProfile='round';layer.lineProfileStroke='round';layer.lineProfileGraffiti='slash';}}
    ];
    window.addEventListener('error',onError);window.addEventListener('unhandledrejection',onReject);
    try{
      window.__somataSetRenderBackend?.(backend);
      for(const test of cases){
        const before=errors.length;test.apply();try{invalidateLayerEffect?.(layer,'synthetic-smoke');}catch(_){}try{requestMainCanvasRender?.();}catch(_){}await twoFrames();
        const plan=safeCall(()=>window.__spiroEffectsPlanSnapshot?.(0))||{},telemetry=safeCall(()=>window.__spiroRenderBackendStatus?.())||{},backendStatus=window.__somataRenderBackend?.()||{},issues=[];
        if(plan?.[test.plan]!==true)issues.push(`${test.plan} plan not active`);
        for(const extra of test.also||[])if(plan?.[extra]!==true)issues.push(`${extra} plan not active`);
        const rec=telemetry?.features?.[test.telemetry]||null;if(!rec)issues.push(`${test.telemetry} render pass not observed`);
        if(backendStatus.effective==='cpu'&&rec?.backend==='gpu')issues.push(`${test.telemetry} escaped CPU backend`);
        if(rec?.reason&&/unavailable; effect skipped/i.test(rec.reason))issues.push(`${test.telemetry} was skipped`);
        const newErrors=errors.slice(before);if(newErrors.length)issues.push(...newErrors.map(x=>`runtime: ${x}`));
        rows.push({name:test.name,pass:issues.length===0,issues,plan,telemetry:rec,backend:backendStatus});
      }
    }finally{
      restoreObject(layer,savedLayer);if(state?.tunnel)restoreObject(state.tunnel,savedTunnel);try{window.__somataSetRenderBackend?.(savedBackend);}catch(_){}window.removeEventListener('error',onError);window.removeEventListener('unhandledrejection',onReject);try{requestMainCanvasRender?.();}catch(_){}
    }
    const result={version:'7.3.20',backend,pass:rows.every(r=>r.pass)&&errors.length===0,rows,errors};
    if(options.log!==false){console.group?.(`[Somata 7.3.20 synthetic effect smoke ${backend.toUpperCase()}] ${result.pass?'PASS':'FAIL'}`);console.table?.(rows.map(r=>({effect:r.name,pass:r.pass,issues:r.issues.join('; '),renderBackend:r.telemetry?.backend||''})));if(errors.length)console.error(errors);console.groupEnd?.();}
    return result;
  };


  const visualFrames=async(count=1)=>{
    const n=Math.max(0,Math.floor(Number(count)||0));
    for(let i=0;i<n;i++)await new Promise(resolve=>requestAnimationFrame(()=>resolve()));
  };
  function stopVisualMorphOwnership(){
    try{if(typeof activeStopMinimalMorphing==='function')activeStopMinimalMorphing(false);}catch(_){}
    try{if(typeof activeStopMorphing==='function')activeStopMorphing(false);}catch(_){}
    try{if(typeof stopProjectMorphing==='function')stopProjectMorphing(false,false);}catch(_){}
  }
  function captureMainPixels(){
    if(typeof mainCanvas==='undefined'||!mainCanvas?.width||!mainCanvas?.height)return null;
    const ctx=mainCanvas.getContext?.('2d',{alpha:true})||mainCanvas.getContext?.('2d');
    if(!ctx?.getImageData)return null;
    const image=ctx.getImageData(0,0,mainCanvas.width,mainCanvas.height);
    return {width:mainCanvas.width,height:mainCanvas.height,data:image.data};
  }
  function pixelDiff(a,b){
    if(!a||!b||a.width!==b.width||a.height!==b.height||a.data?.length!==b.data?.length)return{changedPixels:0,channelDelta:0,ratio:0,comparable:false};
    let changedPixels=0,channelDelta=0;
    for(let i=0;i<a.data.length;i+=4){
      let d=0;
      d+=Math.abs(a.data[i]-b.data[i]);d+=Math.abs(a.data[i+1]-b.data[i+1]);d+=Math.abs(a.data[i+2]-b.data[i+2]);d+=Math.abs(a.data[i+3]-b.data[i+3]);
      if(d>0){changedPixels++;channelDelta+=d;}
    }
    const total=Math.max(1,a.width*a.height);
    return{changedPixels,channelDelta,ratio:changedPixels/total,comparable:true};
  }
  function layerForVisualFeature(feature){
    const layers=Array.isArray(state?.layers)?state.layers:[];
    const visible=l=>l&&l.visible!==false;
    const predicates={
      base:l=>visible(l)&&l.lineVisible!==false,
      fill:l=>visible(l)&&l.lineVisible!==false&&l.fill===true,
      glow:l=>visible(l)&&l.lineVisible!==false&&Number(l.glow)>0,
      lamps:l=>visible(l)&&l.showLamps===true,
      sweep:l=>visible(l)&&l.sweep?.enabled===true,
      web:l=>visible(l)&&l.showWeb===true,
      geometryCircles:l=>visible(l)&&l.geometryCircles?.enabled===true,
      spiral:l=>visible(l)&&(l.spiralEnabled===true||Math.abs(Number(l.spiralOrder)||0)>1e-8),
      motionRotation:l=>visible(l)&&l.motionRotation?.enabled===true
    };
    return layers.find(predicates[feature]||(()=>false))||null;
  }
  function disableVisualFeature(feature,layer){
    if(feature==='corridor'){
      if(typeof setTunnelMode==='function')setTunnelMode(false,{silent:true});
      else if(state?.tunnel)state.tunnel.active=false;
      return;
    }
    if(!layer)return;
    if(feature==='base'){
      layer.lineVisible=false;
      if(typeof invalidateLayerProperties==='function')invalidateLayerProperties(layer,['lineVisible'],'visual-smoke-base');
    }else if(feature==='fill'){
      layer.fill=false;
      if(typeof invalidateLayerProperties==='function')invalidateLayerProperties(layer,['fill'],'visual-smoke-fill');
    }else if(feature==='glow'){
      layer.glow=0;
      if(typeof invalidateLayerProperties==='function')invalidateLayerProperties(layer,['glow'],'visual-smoke-glow');
    }else if(feature==='lamps'){
      if(typeof setLayerLampsEnabled==='function')setLayerLampsEnabled(layer,false);else{layer.showLamps=false;invalidateLayerEffect?.(layer,'visual-smoke-lamps');}
    }else if(feature==='sweep'){
      layer.sweep={...(layer.sweep||{}),enabled:false};invalidateLayerEffect?.(layer,'visual-smoke-sweep');
    }else if(feature==='web'){
      layer.showWeb=false;invalidateLayerEffect?.(layer,'visual-smoke-web');
    }else if(feature==='geometryCircles'){
      layer.geometryCircles={...(layer.geometryCircles||{}),enabled:false};invalidateLayerEffect?.(layer,'visual-smoke-geometry-circles');
    }else if(feature==='spiral'){
      if(typeof setContourMode==='function')setContourMode(layer,'closed');
      else{layer.spiralEnabled=false;layer.spiralOrder=0;layer.closedLoop=true;}
      invalidateLayerGeometry?.(layer,'visual-smoke-spiral');
    }else if(feature==='motionRotation'){
      layer.motionRotation={...(layer.motionRotation||{}),enabled:false};
      if(typeof invalidateLayerProperties==='function')invalidateLayerProperties(layer,['motionRotation'],'visual-smoke-motion-rotation');else invalidateLayerTransform?.(layer,'visual-smoke-motion-rotation');
    }
  }

  // Strong reference-renderer validation: a feature only passes when disabling it changes the
  // final Canvas pixels. This catches the class of regressions where telemetry says that a pass
  // ran but the compositor produced no visible result. Web is allowed to grow before Morph is
  // stopped; all A/B captures happen after Morph ownership is quiesced so canonical layer state
  // is the single source of truth for both frames.
  window.__somataVisualEffectSmokeTest=async(options={})=>{
    const backend=String(options.backend||'cpu').toLowerCase()==='gpu'?'gpu':'cpu';
    const entries=runtimeEntries(),rows=[],errors=[];
    if(!entries.length)return{version:'7.3.20',backend,pass:false,rows,errors:['playlist has no loaded projects']};
    if(typeof loadPlaylistProjectByIndex!=='function')return{version:'7.3.20',backend,pass:false,rows,errors:['playlist loader unavailable']};
    const byName=name=>entries.findIndex(e=>e?.name===name);
    const cases=[
      {feature:'base',project:'Радуга'},
      {feature:'fill',project:'Радуга'},
      {feature:'glow',project:'Радуга'},
      {feature:'lamps',project:'Радуга'},
      {feature:'sweep',project:'Радуга'},
      {feature:'motionRotation',project:'Радуга'},
      {feature:'web',project:'Мозголом',warmFrames:40},
      {feature:'geometryCircles',project:'Мозголом'},
      {feature:'spiral',project:'Мозголом'},
      {feature:'corridor',project:'цветок'}
    ];
    const previousIndex=typeof getCurrentPlaylistProjectIndex==='function'?getCurrentPlaylistProjectIndex():-1;
    const previousBackend=window.__somataRenderBackend?.().preference||'gpu';
    const onError=e=>errors.push(String(e?.error?.stack||e?.message||'window error'));
    const onReject=e=>errors.push(String(e?.reason?.stack||e?.reason||'unhandled rejection'));
    window.addEventListener('error',onError);window.addEventListener('unhandledrejection',onReject);
    try{
      window.__somataSetRenderBackend?.(backend);
      for(const test of cases){
        const index=byName(test.project),issues=[],beforeErrorCount=errors.length;
        if(index<0){rows.push({...test,pass:false,issues:[`fixture project not found: ${test.project}`]});continue;}
        await loadPlaylistProjectByIndex(index);
        requestMainCanvasRender?.();
        await twoFrames();
        // Web is validated on the actual Blue-Morph resolved frame because its self-intersection
        // threads are a dynamic Morph effect in the playlist fixture. Other effects use a
        // quiesced canonical CPU frame for deterministic A/B comparison.
        if(test.feature==='web'){if(test.warmFrames)await visualFrames(test.warmFrames);}
        else{stopVisualMorphOwnership();if(test.warmFrames)await visualFrames(test.warmFrames);}
        // No rAF is awaited between the two captures. Corridor/Sweep clocks therefore cannot
        // manufacture a false positive by advancing animation time between A and B.
        if(typeof renderMainCanvas==='function')renderMainCanvas();
        const before=captureMainPixels();
        const canonicalLayer=test.feature==='corridor'?null:layerForVisualFeature(test.feature);
        const layer=test.feature==='web'
          ? ((Array.isArray(runtimeState?.morph?.frameLayers)?runtimeState.morph.frameLayers:[]).find(l=>l?.visible!==false&&l.showWeb===true)||canonicalLayer)
          : canonicalLayer;
        if(test.feature!=='corridor'&&!layer)issues.push(`${test.feature}: no active layer fixture after project load`);
        if(test.feature==='web'&&runtimeState?.morph?.active!==true)issues.push('web: Blue Morph fixture was not active');
        if(test.feature==='corridor'&&state?.tunnel?.active!==true)issues.push('corridor: runtime was not active before A/B capture');
        const versionBefore=canonicalLayer&&window.__spiroLayerVersions?.(canonicalLayer)?.versions||null;
        if(test.feature==='web'){if(layer)layer.showWeb=false;}else disableVisualFeature(test.feature,layer);
        if(typeof renderMainCanvas==='function')renderMainCanvas();
        const after=captureMainPixels();
        const diff=pixelDiff(before,after);
        const minChanged=Math.max(16,Math.floor((before?.width||0)*(before?.height||0)*0.00001));
        if(!diff.comparable)issues.push('Canvas readback unavailable or size changed');
        else if(diff.changedPixels<minChanged)issues.push(`${test.feature}: visual delta too small (${diff.changedPixels} px < ${minChanged})`);
        const versionAfter=canonicalLayer&&window.__spiroLayerVersions?.(canonicalLayer)?.versions||null;
        if(test.feature!=='web'&&canonicalLayer&&versionBefore&&versionAfter&&Number(versionAfter.serial)<=Number(versionBefore.serial))issues.push(`${test.feature}: layer version was not invalidated`);
        const newErrors=errors.slice(beforeErrorCount);if(newErrors.length)issues.push(...newErrors.map(x=>`runtime: ${x}`));
        rows.push({...test,index,pass:issues.length===0,issues,diff,versionBefore,versionAfter,backend:window.__somataRenderBackend?.()||null});
      }
    }finally{
      try{if(previousIndex>=0&&previousIndex<entries.length)await loadPlaylistProjectByIndex(previousIndex);}catch(_){}
      try{window.__somataSetRenderBackend?.(previousBackend);}catch(_){}
      window.removeEventListener('error',onError);window.removeEventListener('unhandledrejection',onReject);
      try{requestMainCanvasRender?.();}catch(_){}
    }
    const result={version:'7.3.20',backend,pass:rows.length===cases.length&&rows.every(r=>r.pass)&&errors.length===0,rows,errors};
    if(options.log!==false){console.group?.(`[Somata 7.3.20 visual effect smoke ${backend.toUpperCase()}] ${result.pass?'PASS':'FAIL'}`);console.table?.(rows.map(r=>({effect:r.feature,project:r.project,pass:r.pass,changedPixels:r.diff?.changedPixels||0,ratio:Number(r.diff?.ratio||0).toFixed(5),issues:(r.issues||[]).join('; ')})));if(errors.length)console.error(errors);console.groupEnd?.();}
    return result;
  };


  // Playlist-variant visual validation. The generic visual smoke proves that each major effect can
  // affect pixels; this suite proves the distinct runtime branches that are actually authored in
  // default.plist: Sweep mode/type variants, Lamps placement/raster/HD/morph variants, the original
  // Corridor+Fill+Glow failure combination, and Web under topology Morph.
  window.__somataPlaylistVariantVisualSmokeTest=async(options={})=>{
    const backend=String(options.backend||'cpu').toLowerCase()==='gpu'?'gpu':'cpu';
    const entries=runtimeEntries(),rows=[],errors=[];
    if(!entries.length)return{version:'7.3.20',backend,pass:false,rows,errors:['playlist has no loaded projects']};
    const previousIndex=typeof getCurrentPlaylistProjectIndex==='function'?getCurrentPlaylistProjectIndex():-1;
    const previousBackend=window.__somataRenderBackend?.().preference||'auto';
    const onError=e=>errors.push(String(e?.error?.stack||e?.message||'window error'));
    const onReject=e=>errors.push(String(e?.reason?.stack||e?.reason||'unhandled rejection'));
    const byName=name=>entries.findIndex(e=>e?.name===name);
    const cases=[
      {name:'sweep:lightning:perPath',project:'5 Electro',kind:'sweep',expect:{effectType:'lightning',mode:'perPath'}},
      {name:'sweep:lightning:everyNth',project:'Радуга',kind:'sweep',expect:{effectType:'lightning',mode:'everyNth'}},
      {name:'sweep:lightning:whole',project:'Multi',kind:'sweep',expect:{effectType:'lightning',mode:'whole'}},
      {name:'sweep:glint:whole',project:'цветок',kind:'sweep',expect:{effectType:'glint',mode:'whole'}},
      {name:'lamps:key',project:'2 Светомерцание best',kind:'lamps',expect:{positionMode:'key',rasterized:false}},
      {name:'lamps:arbitrary:raster',project:'4 Galaxy',kind:'lamps',expect:{positionMode:'arbitrary',rasterized:true}},
      {name:'lamps:key:raster',project:'Секс',kind:'lamps',expect:{positionMode:'key',rasterized:true}},
      {name:'lamps:hd:rainbow',project:'Радуга',kind:'lamps',expect:{hd:true,colorMode:'rainbow'}},
      {name:'lamps:morph',project:'цветок',kind:'lamps',expect:{morphEnabled:true}},
      {name:'lamps:arbitrary',project:'Святая Спираль',kind:'lamps',expect:{positionMode:'arbitrary',rasterized:false}},
      {name:'corridor:fill',project:'Секс',kind:'fill',requireCorridor:true},
      {name:'corridor:glow',project:'Секс',kind:'glow',requireCorridor:true},
      {name:'web:topology-morph',project:'Fucking freak 3',kind:'webTopology',warmFrames:8}
    ];
    window.addEventListener('error',onError);window.addEventListener('unhandledrejection',onReject);
    try{
      window.__somataSetRenderBackend?.(backend);
      for(const test of cases){
        const issues=[],beforeErrors=errors.length,index=byName(test.project);
        if(index<0){rows.push({...test,pass:false,issues:[`fixture project not found: ${test.project}`]});continue;}
        await loadPlaylistProjectByIndex(index);requestMainCanvasRender?.();await twoFrames();
        if(test.kind==='webTopology'){
          if(test.warmFrames)await visualFrames(test.warmFrames);
          const frameLayers=Array.isArray(runtimeState?.morph?.frameLayers)?runtimeState.morph.frameLayers:[];
          const webLayers=frameLayers.filter(l=>l?.visible!==false&&l?.showWeb===true);
          if(runtimeState?.morph?.active!==true)issues.push('topology Web fixture did not keep Blue Morph active');
          if(String(state?.morph?.mode||'')!=='topology')issues.push(`expected topology Morph, got ${String(state?.morph?.mode||'')}`);
          if(!webLayers.length)issues.push('topology Web fixture has no resolved Web layers');
          if(typeof renderMainCanvas==='function')renderMainCanvas();const before=captureMainPixels();
          for(const layer of webLayers)layer.showWeb=false;
          if(typeof renderMainCanvas==='function')renderMainCanvas();const after=captureMainPixels();
          const diff=pixelDiff(before,after),minChanged=Math.max(16,Math.floor((before?.width||0)*(before?.height||0)*0.00001));
          if(!diff.comparable)issues.push('Canvas readback unavailable or size changed');else if(diff.changedPixels<minChanged)issues.push(`topology Web visual delta too small (${diff.changedPixels} px < ${minChanged})`);
          const newErrors=errors.slice(beforeErrors);if(newErrors.length)issues.push(...newErrors.map(x=>`runtime: ${x}`));
          rows.push({...test,index,pass:issues.length===0,issues,diff,matched:webLayers.length,backend:window.__somataRenderBackend?.()||null});continue;
        }
        stopVisualMorphOwnership();if(typeof renderMainCanvas==='function')renderMainCanvas();
        const before=captureMainPixels();let matched=[];
        if(test.kind==='sweep')matched=(state?.layers||[]).filter(l=>l?.visible!==false&&l?.sweep?.enabled===true);
        else if(test.kind==='lamps')matched=(state?.layers||[]).filter(l=>l?.visible!==false&&l?.showLamps===true);
        else if(test.kind==='fill')matched=(state?.layers||[]).filter(l=>l?.visible!==false&&l?.lineVisible!==false&&l?.fill===true);
        else if(test.kind==='glow')matched=(state?.layers||[]).filter(l=>l?.visible!==false&&l?.lineVisible!==false&&Number(l?.glow)>0);
        if(!matched.length)issues.push(`${test.kind}: no active layer fixture`);
        if(test.requireCorridor&&state?.tunnel?.active!==true)issues.push('Corridor runtime was not active');
        if(test.expect){
          const cfg=test.kind==='sweep'?matched[0]?.sweep:matched[0]?.lamps;
          for(const [key,value] of Object.entries(test.expect))if(cfg?.[key]!==value)issues.push(`${test.kind}.${key}: expected ${String(value)}, got ${String(cfg?.[key])}`);
        }
        for(const layer of matched){
          if(test.kind==='sweep'){layer.sweep={...(layer.sweep||{}),enabled:false};invalidateLayerEffect?.(layer,'variant-visual-sweep');}
          else if(test.kind==='lamps'){if(typeof setLayerLampsEnabled==='function')setLayerLampsEnabled(layer,false);else{layer.showLamps=false;invalidateLayerEffect?.(layer,'variant-visual-lamps');}}
          else if(test.kind==='fill'){layer.fill=false;if(typeof invalidateLayerProperties==='function')invalidateLayerProperties(layer,['fill'],'variant-visual-fill');}
          else if(test.kind==='glow'){layer.glow=0;if(typeof invalidateLayerProperties==='function')invalidateLayerProperties(layer,['glow'],'variant-visual-glow');}
        }
        if(typeof renderMainCanvas==='function')renderMainCanvas();const after=captureMainPixels();
        const diff=pixelDiff(before,after),minChanged=Math.max(16,Math.floor((before?.width||0)*(before?.height||0)*0.00001));
        if(!diff.comparable)issues.push('Canvas readback unavailable or size changed');else if(diff.changedPixels<minChanged)issues.push(`${test.name}: visual delta too small (${diff.changedPixels} px < ${minChanged})`);
        const newErrors=errors.slice(beforeErrors);if(newErrors.length)issues.push(...newErrors.map(x=>`runtime: ${x}`));
        rows.push({...test,index,pass:issues.length===0,issues,diff,matched:matched.length,backend:window.__somataRenderBackend?.()||null});
      }
    }finally{
      try{if(previousIndex>=0&&previousIndex<entries.length)await loadPlaylistProjectByIndex(previousIndex);}catch(_){}
      try{window.__somataSetRenderBackend?.(previousBackend);}catch(_){}
      window.removeEventListener('error',onError);window.removeEventListener('unhandledrejection',onReject);
      try{requestMainCanvasRender?.();}catch(_){}
    }
    const result={version:'7.3.20',backend,pass:rows.length===cases.length&&rows.every(r=>r.pass)&&errors.length===0,rows,errors};
    if(options.log!==false){console.group?.(`[Somata 7.3.20 playlist variant visual ${backend.toUpperCase()}] ${result.pass?'PASS':'FAIL'}`);console.table?.(rows.map(r=>({variant:r.name,project:r.project,pass:r.pass,changedPixels:r.diff?.changedPixels||0,issues:(r.issues||[]).join('; ')})));if(errors.length)console.error(errors);console.groupEnd?.();}
    return result;
  };

  // Short temporal soak for the heaviest dynamic playlist ownership combinations. It is deliberately
  // bounded so the in-client release test remains practical, while still proving that dynamic scenes
  // continue changing after their initial frame and that scheduler/mode ownership remains coherent.
  window.__somataTemporalSoakSmokeTest=async(options={})=>{
    const backend=String(options.backend||'cpu').toLowerCase()==='gpu'?'gpu':'cpu';
    const frames=Math.max(2,Math.min(12,Math.floor(Number(options.frames)||5)));
    const cycles=Math.max(1,Math.min(3,Math.floor(Number(options.cycles)||1)));
    const entries=runtimeEntries(),rows=[],errors=[];
    if(!entries.length)return{version:'7.3.20',backend,frames,cycles,pass:false,rows,errors:['playlist has no loaded projects']};
    const previousIndex=typeof getCurrentPlaylistProjectIndex==='function'?getCurrentPlaylistProjectIndex():-1;
    const previousBackend=window.__somataRenderBackend?.().preference||'auto';
    const names=['Радуга','Мозголом','Святой','ярко1','Секс','Fucking freak 3'];
    const onError=e=>errors.push(String(e?.error?.stack||e?.message||'window error'));
    const onReject=e=>errors.push(String(e?.reason?.stack||e?.reason||'unhandled rejection'));
    window.addEventListener('error',onError);window.addEventListener('unhandledrejection',onReject);
    try{
      window.__somataSetRenderBackend?.(backend);
      for(let cycle=0;cycle<cycles;cycle++)for(const name of names){
        const index=entries.findIndex(e=>e?.name===name),issues=[],beforeErrors=errors.length,beforeDiag=window.__somataFullGpuDiagnostics?.()||{};
        if(index<0){rows.push({cycle,name,pass:false,issues:[`fixture project not found: ${name}`]});continue;}
        await loadPlaylistProjectByIndex(index);requestMainCanvasRender?.();await twoFrames();
        const schedulerBefore=safeCall(()=>window.__somataSchedulerDiag?.()?.scheduler)||null;
        const modeBefore=safeCall(()=>window.__spiroReportProjectDefaultMorphStatus?.())||null;
        if(typeof renderMainCanvas==='function')renderMainCanvas();const before=captureMainPixels();
        await visualFrames(frames);
        if(typeof renderMainCanvas==='function')renderMainCanvas();const after=captureMainPixels();
        const diff=pixelDiff(before,after),minChanged=Math.max(16,Math.floor((before?.width||0)*(before?.height||0)*0.00001));
        if(!diff.comparable)issues.push('Canvas readback unavailable or size changed');else if(diff.changedPixels<minChanged)issues.push(`dynamic frame did not advance (${diff.changedPixels} px < ${minChanged})`);
        const modeCheck=validateModeStatus(entries[index],safeCall(()=>window.__spiroReportProjectDefaultMorphStatus?.()));if(modeCheck.issues.length)issues.push(...modeCheck.issues);
        const schedulerAfter=safeCall(()=>window.__somataSchedulerDiag?.()?.scheduler)||null;
        if(Number(schedulerAfter?.paintErrors||0)>Number(schedulerBefore?.paintErrors||0))issues.push('scheduler paint error count increased');
        const afterDiag=window.__somataFullGpuDiagnostics?.()||{},newGpuErrors=Math.max(0,Number(afterDiag.errors||0)-Number(beforeDiag.errors||0));
        if(backend==='gpu'&&newGpuErrors>0)issues.push(`GPU diagnostic errors increased by ${newGpuErrors}`);
        const newErrors=errors.slice(beforeErrors);if(newErrors.length)issues.push(...newErrors.map(x=>`runtime: ${x}`));
        rows.push({cycle,name,index,pass:issues.length===0,issues,diff,modeBefore,modeCheck,schedulerBefore,schedulerAfter,newGpuErrors,backend:window.__somataRenderBackend?.()||null});
      }
    }finally{
      try{if(previousIndex>=0&&previousIndex<entries.length)await loadPlaylistProjectByIndex(previousIndex);}catch(_){}
      try{window.__somataSetRenderBackend?.(previousBackend);}catch(_){}
      window.removeEventListener('error',onError);window.removeEventListener('unhandledrejection',onReject);
      try{requestMainCanvasRender?.();}catch(_){}
    }
    const result={version:'7.3.20',backend,frames,cycles,pass:rows.length===names.length*cycles&&rows.every(r=>r.pass)&&errors.length===0,rows,errors};
    if(options.log!==false){console.group?.(`[Somata 7.3.20 temporal soak ${backend.toUpperCase()}] ${result.pass?'PASS':'FAIL'}`);console.table?.(rows.map(r=>({cycle:r.cycle,project:r.name,pass:r.pass,changedPixels:r.diff?.changedPixels||0,tasksBefore:r.schedulerBefore?.activeTasks||0,tasksAfter:r.schedulerAfter?.activeTasks||0,issues:(r.issues||[]).join('; ')})));if(errors.length)console.error(errors);console.groupEnd?.();}
    return result;
  };


  // Real DOM-control validation for the versioned Blue-Morph contract. The visual frame cache
  // only resynchronizes authored properties after the canonical layer serial changes, so these
  // controls must both mutate state and bump the dependency version while Morph is running.
  window.__somataUiInvalidationSmokeTest=async(options={})=>{
    const entries=runtimeEntries(),rows=[],errors=[];
    if(!entries.length)return{version:'7.3.20',pass:false,rows,errors:['playlist has no loaded projects']};
    const previousIndex=typeof getCurrentPlaylistProjectIndex==='function'?getCurrentPlaylistProjectIndex():-1;
    const previousBackend=window.__somataRenderBackend?.().preference||'gpu';
    const cases=[
      {name:'fill',project:'Радуга',control:'paramEnableFill',event:'change',set(el){el.checked=false;},plan:'fill'},
      {name:'glow',project:'Радуга',control:'paramGlow',event:'input',set(el){el.value='0';},plan:'glow'},
      {name:'web',project:'Мозголом',control:'showWeb',event:'change',set(el){el.checked=false;},plan:'web'}
    ];
    const onError=e=>errors.push(String(e?.error?.stack||e?.message||'window error'));
    const onReject=e=>errors.push(String(e?.reason?.stack||e?.reason||'unhandled rejection'));
    window.addEventListener('error',onError);window.addEventListener('unhandledrejection',onReject);
    try{
      window.__somataSetRenderBackend?.('cpu');
      for(const test of cases){
        const issues=[],idx=entries.findIndex(e=>e?.name===test.project),beforeErrors=errors.length;
        if(idx<0){rows.push({...test,pass:false,issues:[`fixture project not found: ${test.project}`]});continue;}
        await loadPlaylistProjectByIndex(idx);await twoFrames();
        const layer=layerForVisualFeature(test.name),control=document.getElementById(test.control);
        if(!layer)issues.push(`${test.name}: active layer unavailable`);
        if(!control)issues.push(`${test.name}: control #${test.control} unavailable`);
        const before=layer&&window.__spiroLayerVersions?.(layer)?.versions||null;
        if(control){test.set(control);control.dispatchEvent(new Event(test.event,{bubbles:true}));}
        const afterEvent=layer&&window.__spiroLayerVersions?.(layer)?.versions||null;
        if(before&&afterEvent&&Number(afterEvent.serial)<=Number(before.serial))issues.push(`${test.name}: DOM event did not bump layer serial`);
        // Sidebar edits rebase Blue Morph in a double-microtask transaction. Fill presence is a
        // morphable property, so after rebasing the new source must be OFF even though the newly
        // generated target is allowed to fade Fill back in. Glow/Web are manual effect switches
        // and must remain disabled in the resolved frame after the next display ticks.
        await Promise.resolve();await Promise.resolve();
        let plan=safeCall(()=>window.__spiroEffectsPlanSnapshot?.(0))||{};
        let sourceFill=null;
        if(test.name==='fill'){
          const li=Math.max(0,state.layers.indexOf(layer));
          sourceFill=runtimeState?.morph?.sourceVisuals?.[li]?.fill;
          if(layer?.fill!==false)issues.push('fill: canonical authored state was not disabled');
          if(sourceFill!==false)issues.push('fill: Blue Morph rebase did not capture disabled Fill as the new source');
        }else{
          await visualFrames(2);plan=safeCall(()=>window.__spiroEffectsPlanSnapshot?.(0))||{};
          if(plan?.[test.plan]!==false)issues.push(`${test.name}: Blue Morph frame did not resync disabled state`);
        }
        const newErrors=errors.slice(beforeErrors);if(newErrors.length)issues.push(...newErrors.map(x=>`runtime: ${x}`));
        rows.push({...test,pass:issues.length===0,issues,before,afterEvent,plan,sourceFill});
      }
    }finally{
      try{if(previousIndex>=0&&previousIndex<entries.length)await loadPlaylistProjectByIndex(previousIndex);}catch(_){}
      try{window.__somataSetRenderBackend?.(previousBackend);}catch(_){}
      window.removeEventListener('error',onError);window.removeEventListener('unhandledrejection',onReject);
      try{requestMainCanvasRender?.();}catch(_){}
    }
    const result={version:'7.3.20',pass:rows.length===cases.length&&rows.every(r=>r.pass)&&errors.length===0,rows,errors};
    if(options.log!==false){console.group?.(`[Somata 7.3.20 UI invalidation smoke] ${result.pass?'PASS':'FAIL'}`);console.table?.(rows.map(r=>({control:r.name,pass:r.pass,before:r.before?.serial||0,after:r.afterEvent?.serial||0,issues:(r.issues||[]).join('; ')})));if(errors.length)console.error(errors);console.groupEnd?.();}
    return result;
  };


  function canonicalTransitionFlags(layers){
    const list=Array.isArray(layers)?layers:[];
    return {
      web:list.some(l=>l?.visible!==false&&l?.showWeb===true),
      spiral:list.some(l=>l?.visible!==false&&l?.spiralEnabled===true),
      geometryCircles:list.some(l=>l?.visible!==false&&l?.geometryCircles?.enabled===true),
      fill:list.some(l=>l?.visible!==false&&l?.lineVisible!==false&&l?.fill===true),
      glow:list.some(l=>l?.visible!==false&&Number(l?.glow)>0),
      lamps:list.some(l=>l?.visible!==false&&l?.showLamps===true),
      sweep:list.some(l=>l?.visible!==false&&l?.sweep?.enabled===true)
    };
  }

  // Project-transition stress deliberately crosses ownership boundaries instead of validating
  // projects in isolation. Orange Morph is allowed to commit a new random composition into the
  // canonical layers, so exact canonical flag equality is asserted only for non-Orange projects.
  window.__somataTransitionStressTest=async(options={})=>{
    const backend=String(options.backend||'cpu').toLowerCase()==='gpu'?'gpu':'cpu';
    const cycles=Math.max(1,Math.min(8,Math.floor(Number(options.cycles)||1)));
    const framesPerStep=Math.max(2,Math.min(8,Math.floor(Number(options.framesPerStep)||4)));
    const entries=runtimeEntries(),rows=[],errors=[];
    if(!entries.length)return{version:'7.3.20',backend,pass:false,rows,errors:['playlist has no loaded projects']};
    const byName=name=>entries.findIndex(e=>e?.name===name);
    const sequences=[
      ['Мозголом','Секс','Мозголом'],
      ['ярко1','Радуга','ярко1'],
      ['7 Бесконечная спираль','2 Светомерцание best','7 Бесконечная спираль'],
      ['Fucking freak 3','Blood Ice','Fucking freak 3'],
      ['цветок','Святой','цветок'],
      ['Святая Спираль','DnB','Святая Спираль']
    ];
    const previousIndex=typeof getCurrentPlaylistProjectIndex==='function'?getCurrentPlaylistProjectIndex():-1;
    const previousBackend=window.__somataRenderBackend?.().preference||'gpu';
    const onError=e=>errors.push(String(e?.error?.stack||e?.message||'window error'));
    const onReject=e=>errors.push(String(e?.reason?.stack||e?.reason||'unhandled rejection'));
    window.addEventListener('error',onError);window.addEventListener('unhandledrejection',onReject);
    const gpuBefore=Number(window.__somataFullGpuDiagnostics?.()?.errors)||0;
    let step=0;
    try{
      window.__somataSetRenderBackend?.(backend);
      for(let cycle=0;cycle<cycles;cycle++){
        for(const seq of sequences){
          for(const name of seq){
            const index=byName(name),issues=[],beforeErrors=errors.length;
            if(index<0){rows.push({cycle,step:step++,name,pass:false,issues:[`fixture project not found: ${name}`]});continue;}
            await loadPlaylistProjectByIndex(index);
            requestMainCanvasRender?.();
            await visualFrames(framesPerStep);
            const modeCheck=validateModeStatus(entries[index],safeCall(()=>window.__spiroReportProjectDefaultMorphStatus?.()));
            issues.push(...modeCheck.issues);
            const expectedFlags=canonicalTransitionFlags(entries[index]?.project?.layers||[]);
            const actualFlags=canonicalTransitionFlags(state?.layers||[]);
            // Orange slideshow owns explicit composition commits and may legitimately alter
            // Fill/Spiral/etc immediately after its arm callback. Other projects must remain
            // exact to their stored canonical fixture after every cross-project transition.
            if(modeCheck.expected.orange!==true){
              for(const key of Object.keys(expectedFlags))if(actualFlags[key]!==expectedFlags[key])issues.push(`canonical ${key} ${actualFlags[key]} != ${expectedFlags[key]}`);
            }
            const plans=[];for(let li=0;li<(state?.layers?.length||0);li++)plans.push(safeCall(()=>window.__spiroEffectsPlanSnapshot?.(li)));
            if(!plans.some(Boolean))issues.push('no render plan after project transition');
            const telemetry=safeCall(()=>window.__spiroRenderBackendStatus?.())||{};
            for(const [planKey,telemetryKey] of Object.entries(observablePassFeatures)){
              if(!plans.some(plan=>plan?.[planKey]===true))continue;
              if(!telemetry?.features?.[telemetryKey])issues.push(`${planKey}: ${telemetryKey} pass not observed after transition`);
            }
            const newErrors=errors.slice(beforeErrors);if(newErrors.length)issues.push(...newErrors.map(x=>`runtime: ${x}`));
            rows.push({cycle,step:step++,name,index,pass:issues.length===0,issues,modeCheck,expectedFlags,actualFlags,backend:window.__somataRenderBackend?.()||null});
          }
        }
      }
    }finally{
      try{if(previousIndex>=0&&previousIndex<entries.length)await loadPlaylistProjectByIndex(previousIndex);}catch(_){}
      try{window.__somataSetRenderBackend?.(previousBackend);}catch(_){}
      window.removeEventListener('error',onError);window.removeEventListener('unhandledrejection',onReject);
      try{requestMainCanvasRender?.();}catch(_){}
    }
    const gpuAfter=Number(window.__somataFullGpuDiagnostics?.()?.errors)||0;
    const gpuErrorDelta=Math.max(0,gpuAfter-gpuBefore);
    const result={version:'7.3.20',backend,cycles,framesPerStep,pass:rows.every(r=>r.pass)&&errors.length===0&&(backend==='cpu'||gpuErrorDelta===0),rows,errors,gpuErrorDelta};
    if(options.log!==false){console.group?.(`[Somata 7.3.20 transition stress ${backend.toUpperCase()}] ${result.pass?'PASS':'FAIL'}`);console.table?.(rows.map(r=>({cycle:r.cycle,step:r.step,project:r.name,pass:r.pass,issues:r.issues.join('; ')})));if(errors.length)console.error(errors);console.groupEnd?.();}
    return result;
  };

  // User-facing interaction contracts that previously regressed independently from renderer
  // correctness: RMB Shape must hide Base+Fill+Glow without destroying authored values, arrows
  // must navigate projects, and File -> Rendering priority must actually drive backend policy.
  window.__somataControlContractSmokeTest=async(options={})=>{
    const entries=runtimeEntries(),rows=[],errors=[];
    if(!entries.length)return{version:'7.3.20',pass:false,rows,errors:['playlist has no loaded projects']};
    const previousIndex=typeof getCurrentPlaylistProjectIndex==='function'?getCurrentPlaylistProjectIndex():-1;
    const previousBackend=window.__somataRenderBackend?.().preference||'auto';
    const byName=name=>entries.findIndex(e=>e?.name===name);
    const onError=e=>errors.push(String(e?.error?.stack||e?.message||'window error'));
    const onReject=e=>errors.push(String(e?.reason?.stack||e?.reason||'unhandled rejection'));
    window.addEventListener('error',onError);window.addEventListener('unhandledrejection',onReject);
    try{
      const rainbow=byName('Радуга');
      if(rainbow<0)rows.push({name:'shape-rmb',pass:false,issues:['Радуга fixture missing']});
      else{
        await loadPlaylistProjectByIndex(rainbow);await twoFrames();stopVisualMorphOwnership();if(typeof renderMainCanvas==='function')renderMainCanvas();
        const layer=state?.layers?.[0],btn=document.querySelector('[data-sidebar-mode="shape"]'),issues=[];
        if(!layer)issues.push('active layer missing');if(!btn)issues.push('Shape button missing');
        const authored=layer?{line:layer.lineVisible!==false,fill:layer.fill===true,glow:Number(layer.glow)||0}:null;
        if(btn){btn.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2}));await visualFrames(1);}
        const off=safeCall(()=>window.__spiroEffectsPlanSnapshot?.(0))||{};
        if(off.base!==false||off.fill!==false||off.glow!==false)issues.push('RMB Shape did not suppress Base + Fill + Glow');
        if(btn){btn.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2}));await visualFrames(1);}
        const restored=safeCall(()=>window.__spiroEffectsPlanSnapshot?.(0))||{};
        if(authored&&layer){if((layer.lineVisible!==false)!==authored.line||layer.fill!==authored.fill||Number(layer.glow)!==authored.glow)issues.push('RMB Shape destroyed authored line/fill/glow values');}
        if(authored&&restored.base!==authored.line)issues.push('RMB Shape did not restore Base');
        if(authored&&restored.fill!==(authored.line&&authored.fill))issues.push('RMB Shape did not restore Fill');
        if(authored&&restored.glow!==(authored.line&&authored.glow>0))issues.push('RMB Shape did not restore Glow');
        rows.push({name:'shape-rmb',pass:issues.length===0,issues,authored,off,restored});
      }

      const navStart=byName('Радуга')>=0?byName('Радуга'):Math.max(0,getCurrentPlaylistProjectIndex?.()||0),navIssues=[];
      await loadPlaylistProjectByIndex(navStart);await visualFrames(1);
      document.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',code:'ArrowRight',bubbles:true,cancelable:true}));await new Promise(r=>setTimeout(r,0));await visualFrames(2);
      const right=typeof getCurrentPlaylistProjectIndex==='function'?getCurrentPlaylistProjectIndex():-1;
      document.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',code:'ArrowLeft',bubbles:true,cancelable:true}));await new Promise(r=>setTimeout(r,0));await visualFrames(2);
      const left=typeof getCurrentPlaylistProjectIndex==='function'?getCurrentPlaylistProjectIndex():-1;
      if(right!==(navStart+1)%entries.length)navIssues.push(`ArrowRight selected ${right}, expected ${(navStart+1)%entries.length}`);
      if(left!==navStart)navIssues.push(`ArrowLeft returned ${left}, expected ${navStart}`);
      rows.push({name:'arrow-project-navigation',pass:navIssues.length===0,issues:navIssues,start:navStart,right,left});

      const backendIssues=[],select=document.getElementById('renderBackendPreference');
      if(!select)backendIssues.push('render backend select missing');
      else{
        select.value='cpu';select.dispatchEvent(new Event('change',{bubbles:true}));await Promise.resolve();
        const cpu=window.__somataRenderBackend?.()||{};
        if(cpu.preference!=='cpu'||cpu.effective!=='cpu')backendIssues.push(`CPU preference was not applied (${cpu.preference}/${cpu.effective})`);
        select.value=previousBackend;select.dispatchEvent(new Event('change',{bubbles:true}));await Promise.resolve();
      }
      rows.push({name:'backend-preference-control',pass:backendIssues.length===0,issues:backendIssues,backend:window.__somataRenderBackend?.()||null});
    }finally{
      try{if(previousIndex>=0&&previousIndex<entries.length)await loadPlaylistProjectByIndex(previousIndex);}catch(_){}
      try{window.__somataSetRenderBackend?.(previousBackend);}catch(_){}
      const sel=document.getElementById('renderBackendPreference');if(sel)sel.value=previousBackend;
      window.removeEventListener('error',onError);window.removeEventListener('unhandledrejection',onReject);
      try{requestMainCanvasRender?.();}catch(_){}
    }
    const result={version:'7.3.20',pass:rows.every(r=>r.pass)&&errors.length===0,rows,errors};
    if(options.log!==false){console.group?.(`[Somata 7.3.20 control contract smoke] ${result.pass?'PASS':'FAIL'}`);console.table?.(rows.map(r=>({contract:r.name,pass:r.pass,issues:(r.issues||[]).join('; ')})));if(errors.length)console.error(errors);console.groupEnd?.();}
    return result;
  };


  // Exhaustive authored-branch validation for effect variants that share a high-level feature but
  // execute different runtime paths in default.plist. Each visual branch must change final pixels;
  // Morph branches must also keep the expected runtime owner alive and advance over time.
  window.__somataPlaylistBranchCoverageSmokeTest=async(options={})=>{
    const backend=String(options.backend||'cpu').toLowerCase()==='gpu'?'gpu':'cpu';
    const entries=runtimeEntries(),rows=[],errors=[];
    if(!entries.length)return{version:'7.3.20',backend,pass:false,rows,errors:['playlist has no loaded projects']};
    const previousIndex=typeof getCurrentPlaylistProjectIndex==='function'?getCurrentPlaylistProjectIndex():-1;
    const previousBackend=window.__somataRenderBackend?.().preference||'auto';
    const byName=name=>entries.findIndex(e=>e?.name===name),minChanged=()=>Math.max(16,Math.floor((mainCanvas?.width||0)*(mainCanvas?.height||0)*0.00001));
    const onError=e=>errors.push(String(e?.error?.stack||e?.message||'window error'));
    const onReject=e=>errors.push(String(e?.reason?.stack||e?.reason||'unhandled rejection'));
    window.addEventListener('error',onError);window.addEventListener('unhandledrejection',onReject);
    try{
      window.__somataSetRenderBackend?.(backend);
      const visualCases=[
        {name:'sweep:whole:exact',project:'Искры',kind:'sweep',pred:l=>l?.sweep?.enabled===true&&l.sweep.effectType==='lightning'&&l.sweep.mode==='whole'&&l.sweep.lightningPrecision==='exact'},
        {name:'sweep:whole:simple',project:'Multi',kind:'sweep',pred:l=>l?.sweep?.enabled===true&&l.sweep.effectType==='lightning'&&l.sweep.mode==='whole'&&l.sweep.lightningPrecision==='simple'},
        {name:'spiral:tangential:false:step~4',project:'7 Бесконечная спираль',kind:'spiral',pred:l=>l?.spiralEnabled===true&&l?.spiralTangential===false&&Number(l?.spiralStep)>3},
        {name:'spiral:tangential:false:step2',project:'Мозголом',kind:'spiral',pred:l=>l?.spiralEnabled===true&&l?.spiralTangential===false&&Math.abs(Number(l?.spiralStep)-2)<1e-6},
        {name:'spiral:tangential:true:step1',project:'Святой',kind:'spiral',pred:l=>l?.spiralEnabled===true&&l?.spiralTangential===true&&Math.abs(Number(l?.spiralStep)-1)<1e-6}
      ];
      for(const test of visualCases){
        const issues=[],idx=byName(test.project),beforeErrors=errors.length;
        if(idx<0){rows.push({...test,pass:false,issues:[`fixture project not found: ${test.project}`]});continue;}
        await loadPlaylistProjectByIndex(idx);requestMainCanvasRender?.();await twoFrames();stopVisualMorphOwnership();if(typeof renderMainCanvas==='function')renderMainCanvas();
        const before=captureMainPixels(),matched=(state?.layers||[]).filter(l=>l?.visible!==false&&test.pred(l));
        if(!matched.length)issues.push(`${test.name}: no authored layer matched`);
        for(const layer of matched){
          if(test.kind==='sweep'){layer.sweep={...(layer.sweep||{}),enabled:false};invalidateLayerEffect?.(layer,'branch-coverage-sweep');}
          else{if(typeof setContourMode==='function')setContourMode(layer,'closed');else{layer.spiralEnabled=false;layer.spiralOrder=0;layer.closedLoop=true;}invalidateLayerGeometry?.(layer,'branch-coverage-spiral');}
        }
        if(typeof renderMainCanvas==='function')renderMainCanvas();const after=captureMainPixels(),diff=pixelDiff(before,after),min=minChanged();
        if(!diff.comparable)issues.push('Canvas readback unavailable or size changed');else if(diff.changedPixels<min)issues.push(`${test.name}: visual delta too small (${diff.changedPixels} px < ${min})`);
        const newErrors=errors.slice(beforeErrors);if(newErrors.length)issues.push(...newErrors.map(x=>`runtime: ${x}`));
        rows.push({...test,index:idx,pass:issues.length===0,issues,diff,matched:matched.length,backend:window.__somataRenderBackend?.()||null});
      }

      const rotationCases=[
        {name:'motionRotation:cw',pred:l=>l?.motionRotation?.enabled===true&&l.motionRotation.direction==='cw'&&!(Number(l.motionRotation.tunnelLag)||0)},
        {name:'motionRotation:ccw',pred:l=>l?.motionRotation?.enabled===true&&l.motionRotation.direction==='ccw'},
        {name:'motionRotation:tunnelLag',pred:l=>l?.motionRotation?.enabled===true&&(Number(l.motionRotation.tunnelLag)||0)>0}
      ];
      for(const test of rotationCases){
        const issues=[],idx=byName('4 Galaxy'),beforeErrors=errors.length;await loadPlaylistProjectByIndex(idx);requestMainCanvasRender?.();await twoFrames();stopVisualMorphOwnership();await visualFrames(2);if(typeof renderMainCanvas==='function')renderMainCanvas();
        const before=captureMainPixels(),matched=(state?.layers||[]).filter(l=>l?.visible!==false&&test.pred(l));
        if(!matched.length)issues.push(`${test.name}: no authored layer matched`);
        for(const layer of matched){layer.motionRotation={...(layer.motionRotation||{}),enabled:false};if(typeof invalidateLayerProperties==='function')invalidateLayerProperties(layer,['motionRotation'],'branch-coverage-motion');else invalidateLayerTransform?.(layer,'branch-coverage-motion');}
        if(typeof renderMainCanvas==='function')renderMainCanvas();const after=captureMainPixels(),diff=pixelDiff(before,after),min=minChanged();
        if(!diff.comparable)issues.push('Canvas readback unavailable or size changed');else if(diff.changedPixels<min)issues.push(`${test.name}: visual delta too small (${diff.changedPixels} px < ${min})`);
        const newErrors=errors.slice(beforeErrors);if(newErrors.length)issues.push(...newErrors.map(x=>`runtime: ${x}`));
        rows.push({...test,project:'4 Galaxy',index:idx,pass:issues.length===0,issues,diff,matched:matched.length,backend:window.__somataRenderBackend?.()||null});
      }

      const morphCases=[
        {name:'morph:circleSlide:linear',project:'Радуга',mode:'circleSlide',speed:'linear'},
        {name:'morph:circleSlide:smooth',project:'Плеть',mode:'circleSlide',speed:'smooth'},
        {name:'morph:topology:smooth',project:'Fucking freak 3',mode:'topology',speed:'smooth'}
      ];
      for(const test of morphCases){
        const issues=[],idx=byName(test.project),beforeErrors=errors.length;await loadPlaylistProjectByIndex(idx);requestMainCanvasRender?.();await twoFrames();
        const active=runtimeState?.morph?.active===true,mode=state?.morph?.mode,speed=state?.morph?.speedType;if(!active)issues.push('Blue Morph not active');if(mode!==test.mode)issues.push(`mode ${String(mode)} != ${test.mode}`);if(speed!==test.speed)issues.push(`speed ${String(speed)} != ${test.speed}`);
        if(typeof renderMainCanvas==='function')renderMainCanvas();const before=captureMainPixels();await visualFrames(5);if(typeof renderMainCanvas==='function')renderMainCanvas();const after=captureMainPixels(),diff=pixelDiff(before,after),min=minChanged();
        if(!diff.comparable)issues.push('Canvas readback unavailable or size changed');else if(diff.changedPixels<min)issues.push(`Morph did not advance (${diff.changedPixels} px < ${min})`);
        const newErrors=errors.slice(beforeErrors);if(newErrors.length)issues.push(...newErrors.map(x=>`runtime: ${x}`));rows.push({...test,index:idx,pass:issues.length===0,issues,diff,active,mode,speed,backend:window.__somataRenderBackend?.()||null});
      }

      {
        const test={name:'minimalMorph:defaultActive',project:'ярко1'},issues=[],idx=byName(test.project),beforeErrors=errors.length;await loadPlaylistProjectByIndex(idx);requestMainCanvasRender?.();await twoFrames();
        const active=runtimeState?.minimalMorph?.active===true;if(!active)issues.push('Minimal Morph not active');if(typeof renderMainCanvas==='function')renderMainCanvas();const before=captureMainPixels();await visualFrames(5);if(typeof renderMainCanvas==='function')renderMainCanvas();const after=captureMainPixels(),diff=pixelDiff(before,after),min=minChanged();if(!diff.comparable)issues.push('Canvas readback unavailable or size changed');else if(diff.changedPixels<min)issues.push(`Minimal Morph did not advance (${diff.changedPixels} px < ${min})`);const newErrors=errors.slice(beforeErrors);if(newErrors.length)issues.push(...newErrors.map(x=>`runtime: ${x}`));rows.push({...test,index:idx,pass:issues.length===0,issues,diff,active,backend:window.__somataRenderBackend?.()||null});
      }
      {
        const test={name:'corridor:colorShift',project:'Мозголом'},issues=[],idx=byName(test.project),beforeErrors=errors.length;await loadPlaylistProjectByIndex(idx);requestMainCanvasRender?.();await twoFrames();stopVisualMorphOwnership();if(typeof renderMainCanvas==='function')renderMainCanvas();const before=captureMainPixels(),enabled=state?.tunnel?.colorShiftEnabled===true;if(!enabled)issues.push('Corridor color shift fixture not active');if(state?.tunnel)state.tunnel.colorShiftEnabled=false;requestMainCanvasRender?.();if(typeof renderMainCanvas==='function')renderMainCanvas();const after=captureMainPixels(),diff=pixelDiff(before,after),min=minChanged();if(!diff.comparable)issues.push('Canvas readback unavailable or size changed');else if(diff.changedPixels<min)issues.push(`Corridor color shift visual delta too small (${diff.changedPixels} px < ${min})`);const newErrors=errors.slice(beforeErrors);if(newErrors.length)issues.push(...newErrors.map(x=>`runtime: ${x}`));rows.push({...test,index:idx,pass:issues.length===0,issues,diff,enabled,backend:window.__somataRenderBackend?.()||null});
      }
    }finally{
      try{if(previousIndex>=0&&previousIndex<entries.length)await loadPlaylistProjectByIndex(previousIndex);}catch(_){}
      try{window.__somataSetRenderBackend?.(previousBackend);}catch(_){}
      window.removeEventListener('error',onError);window.removeEventListener('unhandledrejection',onReject);try{requestMainCanvasRender?.();}catch(_){}
    }
    const result={version:'7.3.20',backend,pass:rows.length===13&&rows.every(r=>r.pass)&&errors.length===0,rows,errors};
    if(options.log!==false){console.group?.(`[Somata 7.3.20 playlist branch coverage ${backend.toUpperCase()}] ${result.pass?'PASS':'FAIL'}`);console.table?.(rows.map(r=>({branch:r.name,project:r.project||'',pass:r.pass,changedPixels:r.diff?.changedPixels||0,issues:(r.issues||[]).join('; ')})));if(errors.length)console.error(errors);console.groupEnd?.();}
    return result;
  };

  // Repeated real-control stress. A control that works once but leaves a stale Morph/cache owner on
  // the next toggle is still a broken user contract, so exercise the historically fragile switches
  // repeatedly without reloading the application between each event.
  window.__somataRepeatToggleSmokeTest=async(options={})=>{
    const entries=runtimeEntries(),rows=[],errors=[];
    if(!entries.length)return{version:'7.3.20',pass:false,rows,errors:['playlist has no loaded projects']};
    const previousIndex=typeof getCurrentPlaylistProjectIndex==='function'?getCurrentPlaylistProjectIndex():-1;
    const previousBackend=window.__somataRenderBackend?.().preference||'auto',byName=name=>entries.findIndex(e=>e?.name===name);
    const onError=e=>errors.push(String(e?.error?.stack||e?.message||'window error')),onReject=e=>errors.push(String(e?.reason?.stack||e?.reason||'unhandled rejection'));
    window.addEventListener('error',onError);window.addEventListener('unhandledrejection',onReject);
    try{
      const backendStates=[];let backendOk=true,storageVerified=true;for(const value of ['cpu','gpu','auto','cpu','gpu','cpu','auto','cpu']){window.__somataSetRenderBackend?.(value);await Promise.resolve();const b=window.__somataRenderBackend?.()||{},stored=safeCall(()=>localStorage.getItem('somata.renderBackendPreference')),storageReadable=!(stored&&typeof stored==='object'&&stored.error);if(!storageReadable)storageVerified=false;backendStates.push({value,preference:b.preference,effective:b.effective,stored,storageReadable});if(b.preference!==value||(storageReadable&&stored!==value))backendOk=false;if(value==='gpu'&&b.webgpuSupported!==true&&b.effective!=='cpu')backendOk=false;}rows.push({name:'backend-repeat-persistence',pass:backendOk,storageVerified,issues:backendOk?[]:['backend preference/persistence diverged'],states:backendStates});

      const rainbow=byName('Радуга');
      await loadPlaylistProjectByIndex(rainbow);await twoFrames();stopVisualMorphOwnership();
      let layer=(state?.layers||[]).find(l=>l?.visible!==false&&l?.fill===true),fill=document.getElementById('paramEnableFill'),original={fill:layer?.fill,glow:Number(layer?.glow)||0};
      let fillOk=!!layer&&!!fill,lastSerial=layer?Number(window.__spiroLayerVersions?.(layer)?.versions?.serial)||0:0;
      for(let i=0;i<8&&fillOk;i++){fill.checked=false;fill.dispatchEvent(new Event('change',{bubbles:true}));await Promise.resolve();let serial=Number(window.__spiroLayerVersions?.(layer)?.versions?.serial)||0;if(layer.fill!==false||serial<=lastSerial)fillOk=false;lastSerial=serial;fill.checked=true;fill.dispatchEvent(new Event('change',{bubbles:true}));await Promise.resolve();serial=Number(window.__spiroLayerVersions?.(layer)?.versions?.serial)||0;if(layer.fill!==true||serial<=lastSerial)fillOk=false;lastSerial=serial;}rows.push({name:'fill-ui-repeat-8x',pass:fillOk&&layer?.fill===original.fill,issues:fillOk?[]:['Fill toggle/version contract failed'],serial:lastSerial,original,current:layer?{fill:layer.fill,glow:layer.glow}:null});

      // Reload before each independent contract so one failed edit cannot poison the next case.
      await loadPlaylistProjectByIndex(rainbow);await twoFrames();stopVisualMorphOwnership();layer=(state?.layers||[]).find(l=>l?.visible!==false&&l?.fill===true);const glow=document.getElementById('paramGlow'),glowControlValue=Number(glow?.value),glowAuthored=Number(layer?.glow)||0;
      let glowOk=!!layer&&!!glow&&Number.isFinite(glowControlValue);lastSerial=layer?Number(window.__spiroLayerVersions?.(layer)?.versions?.serial)||0:0;for(let i=0;i<8&&glowOk;i++){glow.value='0';glow.dispatchEvent(new Event('input',{bubbles:true}));await Promise.resolve();let serial=Number(window.__spiroLayerVersions?.(layer)?.versions?.serial)||0;if(Number(layer.glow)!==0||serial<=lastSerial)glowOk=false;lastSerial=serial;glow.value=String(glowControlValue);glow.dispatchEvent(new Event('input',{bubbles:true}));await Promise.resolve();serial=Number(window.__spiroLayerVersions?.(layer)?.versions?.serial)||0;if(Math.abs(Number(layer.glow)-glowControlValue)>1e-9||serial<=lastSerial)glowOk=false;lastSerial=serial;}rows.push({name:'glow-ui-repeat-8x',pass:glowOk&&Math.abs(Number(layer?.glow)-glowControlValue)<=1e-9,issues:glowOk?[]:['Glow toggle/version contract failed'],serial:lastSerial,authored:glowAuthored,controlValue:glowControlValue,current:layer?Number(layer.glow):null});

      const sex=byName('Секс');await loadPlaylistProjectByIndex(sex);await twoFrames();stopVisualMorphOwnership();layer=(state?.layers||[]).find(l=>l?.visible!==false&&l?.lineVisible!==false&&l?.fill===true&&Number(l?.glow)>0);const button=document.querySelector('[data-sidebar-mode="shape"]'),authored=layer?{line:layer.lineVisible,fill:layer.fill,glow:Number(layer.glow)}:null;let rmbOk=!!button&&!!layer&&state?.tunnel?.active===true;for(let i=0;i<8&&rmbOk;i++){button.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2}));await visualFrames(1);let plan=safeCall(()=>window.__spiroEffectsPlanSnapshot?.(state.layers.indexOf(layer)))||{};if(plan.base!==false||plan.fill!==false||plan.glow!==false)rmbOk=false;button.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2}));await visualFrames(1);plan=safeCall(()=>window.__spiroEffectsPlanSnapshot?.(state.layers.indexOf(layer)))||{};if(layer.lineVisible!==authored.line||layer.fill!==authored.fill||Number(layer.glow)!==authored.glow||plan.base!==true||plan.fill!==true||plan.glow!==true)rmbOk=false;}rows.push({name:'shape-rmb-repeat-8x',project:'Секс',pass:rmbOk,issues:rmbOk?[]:['RMB geometry visibility failed to restore authored state inside Corridor'],authored,corridorActive:state?.tunnel?.active===true,current:layer?{line:layer.lineVisible,fill:layer.fill,glow:Number(layer.glow)}:null});

      const brain=byName('Мозголом');await loadPlaylistProjectByIndex(brain);await visualFrames(4);const webLayer=(state?.layers||[]).find(l=>l?.visible!==false&&l?.showWeb===true),web=document.getElementById('showWeb');let webOk=!!webLayer&&!!web&&runtimeState?.morph?.active===true,webSerial=webLayer?Number(window.__spiroLayerVersions?.(webLayer)?.versions?.serial)||0:0;for(let i=0;i<6&&webOk;i++){web.checked=false;web.dispatchEvent(new Event('change',{bubbles:true}));await Promise.resolve();await Promise.resolve();await visualFrames(2);let serial=Number(window.__spiroLayerVersions?.(webLayer)?.versions?.serial)||0;if(webLayer.showWeb!==false||serial<=webSerial)webOk=false;webSerial=serial;web.checked=true;web.dispatchEvent(new Event('change',{bubbles:true}));await Promise.resolve();await Promise.resolve();await visualFrames(2);serial=Number(window.__spiroLayerVersions?.(webLayer)?.versions?.serial)||0;if(webLayer.showWeb!==true||serial<=webSerial)webOk=false;webSerial=serial;}rows.push({name:'web-ui-morph-repeat-6x',pass:webOk,issues:webOk?[]:['Web Morph toggle/version contract failed'],serial:webSerial,active:runtimeState?.morph?.active===true,canonical:webLayer?.showWeb===true});
    }finally{
      try{if(previousIndex>=0&&previousIndex<entries.length)await loadPlaylistProjectByIndex(previousIndex);}catch(_){}try{window.__somataSetRenderBackend?.(previousBackend);}catch(_){}const select=document.getElementById('renderBackendPreference');if(select)select.value=previousBackend;window.removeEventListener('error',onError);window.removeEventListener('unhandledrejection',onReject);try{requestMainCanvasRender?.();}catch(_){}
    }
    const result={version:'7.3.20',pass:rows.length===5&&rows.every(r=>r.pass)&&errors.length===0,rows,errors};if(options.log!==false){console.group?.(`[Somata 7.3.20 repeated toggle smoke] ${result.pass?'PASS':'FAIL'}`);console.table?.(rows.map(r=>({contract:r.name,pass:r.pass,issues:(r.issues||[]).join('; ')})));if(errors.length)console.error(errors);console.groupEnd?.();}return result;
  };


  // Full authored-project residency matrix. Representative pixel A/B tests prove compositor output,
  // while this gate proves that every major effect authored in every default.plist project survives
  // project loading and resolves to the expected layer plan / renderer ownership. Morph ownership is
  // quiesced without committing a transient frame so the comparison is against the authored project,
  // then every project is loaded again in reverse order to catch stale state leaking across re-entry.
  window.__somataProjectEffectResidencySmokeTest=async(options={})=>{
    const backend=String(options.backend||'cpu').toLowerCase()==='gpu'?'gpu':'cpu';
    const entries=runtimeEntries(),rows=[],projects=[],errors=[];
    if(!entries.length)return{version:'7.3.20',backend,pass:false,pairCount:0,rows,projects,errors:['playlist has no loaded projects']};
    if(typeof loadPlaylistProjectByIndex!=='function')return{version:'7.3.20',backend,pass:false,pairCount:0,rows,projects,errors:['playlist loader unavailable']};
    const previousIndex=typeof getCurrentPlaylistProjectIndex==='function'?getCurrentPlaylistProjectIndex():-1;
    const previousBackend=window.__somataRenderBackend?.().preference||'auto';
    const onError=e=>errors.push(String(e?.error?.stack||e?.message||'window error'));
    const onReject=e=>errors.push(String(e?.reason?.stack||e?.reason||'unhandled rejection'));
    const authoredFeatures=(entry)=>{
      const out=new Map(),layers=Array.isArray(entry?.project?.layers)?entry.project.layers:[];
      const add=(feature,index)=>{if(!out.has(feature))out.set(feature,[]);if(Number.isInteger(index))out.get(feature).push(index);};
      if(entry?.project?.settings?.tunnel?.defaultActive===true)add('corridor',-1);
      layers.forEach((l,index)=>{
        if(!l||l.visible===false)return;
        const carrier=l.lineVisible!==false;
        if(carrier)add('base',index);
        if(carrier&&isVisibleAuthoredFill(l))add('fill',index);
        if(carrier&&Number(l.glow)>0)add('glow',index);
        if(l.showLamps===true)add('lamps',index);
        if(l.sweep?.enabled===true)add('sweep',index);
        if(l.showWeb===true)add('web',index);
        if(l.geometryCircles?.enabled===true)add('geometryCircles',index);
        if(l.spiralEnabled===true)add('spiral',index);
        if(l.motionRotation?.enabled===true)add('motionRotation',index);
      });
      return out;
    };
    const canvasSignal=()=>{
      const shot=captureMainPixels();if(!shot)return{readable:false,litPixels:0,ratio:0};
      let litPixels=0;for(let i=0;i<shot.data.length;i+=4){if((shot.data[i]+shot.data[i+1]+shot.data[i+2])>6&&shot.data[i+3]>0)litPixels++;}
      return{readable:true,litPixels,ratio:litPixels/Math.max(1,shot.width*shot.height),width:shot.width,height:shot.height};
    };
    const runProject=async(index,cycle)=>{
      const entry=entries[index],beforeErrors=errors.length,issues=[];
      await loadPlaylistProjectByIndex(index);
      // Do not let Blue/Orange Morph rewrite the authored source before plan validation. Dynamic
      // Morph behavior is covered by branch/temporal suites; this gate validates project residency.
      stopVisualMorphOwnership();
      if(typeof renderMainCanvas==='function')renderMainCanvas();else requestMainCanvasRender?.();
      const authored=authoredFeatures(entry),layerPlans=[];
      for(let li=0;li<(state?.layers?.length||0);li++)layerPlans.push(safeCall(()=>window.__spiroEffectsPlanSnapshot?.(li))||{});
      const telemetry=safeCall(()=>window.__spiroRenderBackendStatus?.())||{},backendStatus=window.__somataRenderBackend?.()||{};
      const mode=safeCall(()=>window.__spiroReportProjectDefaultMorphStatus?.())||{};
      const signal=canvasSignal();
      if(!signal.readable)issues.push('Canvas readback unavailable');
      else if(signal.litPixels<8)issues.push(`final Canvas appears blank (${signal.litPixels} lit pixels)`);
      for(const [feature,indices] of authored){
        const pairIssues=[];
        if(feature==='corridor'){
          if(state?.tunnel?.active!==true)pairIssues.push('Corridor authored default is active but runtime tunnel is inactive');
          if(mode?.tunnelTask!==true)pairIssues.push('Corridor authored default is active but scheduler ownership is missing');
        }else{
          for(const li of indices)if(layerPlans[li]?.[feature]!==true)pairIssues.push(`layer ${li}: authored ${feature} did not resolve active in effects plan`);
          const telemetryKey=observablePassFeatures[feature];
          if(telemetryKey){
            const rec=telemetry?.features?.[telemetryKey]||null;
            if(!rec)pairIssues.push(`${telemetryKey} render pass not observed for this project`);
            else if(backendStatus.effective==='cpu'&&rec.backend==='gpu')pairIssues.push(`${telemetryKey} escaped CPU backend`);
            if(rec?.reason&&/effect skipped/i.test(String(rec.reason)))pairIssues.push(`${telemetryKey} reported effect skipped`);
          }
        }
        rows.push({cycle,index,name:entry?.name||`Project ${index+1}`,feature,authoredLayers:indices.filter(Number.isInteger),pass:pairIssues.length===0,issues:pairIssues});
      }
      const newErrors=errors.slice(beforeErrors);if(newErrors.length)issues.push(...newErrors.map(x=>`runtime: ${x}`));
      projects.push({cycle,index,name:entry?.name||`Project ${index+1}`,pass:issues.length===0,issues,signal,effectCount:authored.size,backend:backendStatus});
    };
    window.addEventListener('error',onError);window.addEventListener('unhandledrejection',onReject);
    try{
      window.__somataSetRenderBackend?.(backend);
      for(let i=0;i<entries.length;i++)await runProject(i,0);
      for(let i=entries.length-1;i>=0;i--)await runProject(i,1);
    }finally{
      try{if(previousIndex>=0&&previousIndex<entries.length)await loadPlaylistProjectByIndex(previousIndex);}catch(_){}
      try{window.__somataSetRenderBackend?.(previousBackend);}catch(_){}
      window.removeEventListener('error',onError);window.removeEventListener('unhandledrejection',onReject);
      try{requestMainCanvasRender?.();}catch(_){}
    }
    const expectedPairs=[...entries].reduce((sum,e)=>sum+authoredFeatures(e).size,0)*2;
    const pass=rows.length===expectedPairs&&rows.every(r=>r.pass)&&projects.length===entries.length*2&&projects.every(p=>p.pass)&&errors.length===0;
    const result={version:'7.3.20',backend,pass,pairCount:rows.length,expectedPairs,projectLoads:projects.length,rows,projects,errors};
    if(options.log!==false){console.group?.(`[Somata 7.3.20 project/effect residency ${backend.toUpperCase()}] ${pass?'PASS':'FAIL'}`);console.table?.(projects.map(p=>({cycle:p.cycle,project:p.name,pass:p.pass,effects:p.effectCount,litPixels:p.signal?.litPixels||0,issues:(p.issues||[]).join('; ')})));const failed=rows.filter(r=>!r.pass);if(failed.length)console.table?.(failed.map(r=>({cycle:r.cycle,project:r.name,effect:r.feature,issues:r.issues.join('; ')})));if(errors.length)console.error(errors);console.groupEnd?.();}
    return result;
  };

  // Cross-effect compositor interference gate. Representative single-effect A/B tests prove
  // each renderer pass independently; this gate proves that the same effect still contributes to
  // the final Canvas while the conflict-heavy combinations authored by default.plist are active.
  // Every subcase reloads its project, so one disable cannot poison the next comparison. Web is
  // compared on the resolved Blue-Morph frame because that is its actual owner in both Web fixtures.
  window.__somataCompositionInterferenceSmokeTest=async(options={})=>{
    const backend=String(options.backend||'cpu').toLowerCase()==='gpu'?'gpu':'cpu';
    const entries=runtimeEntries(),rows=[],errors=[];
    if(!entries.length)return{version:'7.3.20',backend,pass:false,rows,errors:['playlist has no loaded projects']};
    const fixtures=[
      {project:'Секс',layer:0,effects:['fill','glow','lamps','corridor']},
      {project:'Радуга',layer:0,effects:['fill','glow','lamps','sweep','motionRotation']},
      {project:'цветок',layer:0,effects:['fill','glow','lamps','sweep','corridor']},
      {project:'Мозголом',layer:0,effects:['glow','web','geometryCircles','spiral','corridor']},
      {project:'Fucking freak 3',layer:0,effects:['glow','lamps','sweep','web','corridor']},
      {project:'Святая Спираль',layer:0,effects:['glow','lamps','spiral','motionRotation','corridor']},
      {project:'Искры',layer:3,effects:['lamps','sweep','spiral','motionRotation','corridor']},
      {project:'4 Galaxy',layer:0,effects:['lamps','motionRotation','corridor']},
      {project:'5 Electro',layer:0,effects:['sweep','corridor']}
    ];
    const clone=v=>{try{return structuredClone(v);}catch(_){return JSON.parse(JSON.stringify(v));}};
    const restoreObject=(target,saved)=>{for(const k of Object.keys(target||{}))if(!Object.prototype.hasOwnProperty.call(saved,k))delete target[k];Object.assign(target,clone(saved));};
    const previousIndex=typeof getCurrentPlaylistProjectIndex==='function'?getCurrentPlaylistProjectIndex():-1;
    const previousBackend=window.__somataRenderBackend?.().preference||'auto';
    const onError=e=>errors.push(String(e?.error?.stack||e?.message||'window error'));
    const onReject=e=>errors.push(String(e?.reason?.stack||e?.reason||'unhandled rejection'));
    const disable=(feature,layer)=>{
      if(feature==='corridor'){if(typeof setTunnelMode==='function')setTunnelMode(false,{silent:true});else if(state?.tunnel)state.tunnel.active=false;return;}
      if(!layer)return;
      if(feature==='fill'){layer.fill=false;invalidateLayerProperties?.(layer,['fill'],'composition-interference');}
      else if(feature==='glow'){layer.glow=0;invalidateLayerProperties?.(layer,['glow'],'composition-interference');}
      else if(feature==='lamps'){if(typeof setLayerLampsEnabled==='function')setLayerLampsEnabled(layer,false);else{layer.showLamps=false;invalidateLayerEffect?.(layer,'composition-interference');}}
      else if(feature==='sweep'){layer.sweep={...(layer.sweep||{}),enabled:false};invalidateLayerEffect?.(layer,'composition-interference');}
      else if(feature==='geometryCircles'){layer.geometryCircles={...(layer.geometryCircles||{}),enabled:false};invalidateLayerEffect?.(layer,'composition-interference');}
      else if(feature==='spiral'){if(typeof setContourMode==='function')setContourMode(layer,'closed');else{layer.spiralEnabled=false;layer.spiralOrder=0;layer.closedLoop=true;}invalidateLayerGeometry?.(layer,'composition-interference');}
      else if(feature==='motionRotation'){layer.motionRotation={...(layer.motionRotation||{}),enabled:false};if(typeof invalidateLayerProperties==='function')invalidateLayerProperties(layer,['motionRotation'],'composition-interference');else invalidateLayerTransform?.(layer,'composition-interference');}
    };
    const compare=(before,after,feature,issues)=>{
      const diff=pixelDiff(before,after),minChanged=Math.max(16,Math.floor((before?.width||0)*(before?.height||0)*0.00001));
      if(!diff.comparable)issues.push('Canvas readback unavailable or size changed');
      else if(diff.changedPixels<minChanged)issues.push(`${feature}: composition delta too small (${diff.changedPixels} px < ${minChanged})`);
      return diff;
    };
    window.addEventListener('error',onError);window.addEventListener('unhandledrejection',onReject);
    try{
      window.__somataSetRenderBackend?.(backend);
      for(const fixture of fixtures){
        const index=entries.findIndex(e=>e?.name===fixture.project),fixtureErrors=errors.length;
        if(index<0){for(const feature of fixture.effects)rows.push({...fixture,feature,pass:false,issues:[`fixture project not found: ${fixture.project}`]});continue;}
        await loadPlaylistProjectByIndex(index);requestMainCanvasRender?.();await visualFrames(2);

        // Web is owned by the live Blue-Morph frame. Prove its contribution there before
        // quiescing Morph for the remaining deterministic compositor comparisons.
        if(fixture.effects.includes('web')){
          const issues=[];await visualFrames(30);if(typeof renderMainCanvas==='function')renderMainCanvas();
          const frameLayer=Array.isArray(runtimeState?.morph?.frameLayers)?runtimeState.morph.frameLayers[fixture.layer]:null;
          if(runtimeState?.morph?.active!==true)issues.push('Web fixture lost Blue Morph ownership');
          if(!frameLayer)issues.push(`resolved Morph layer ${fixture.layer} unavailable`);
          const before=captureMainPixels();if(frameLayer)frameLayer.showWeb=false;if(typeof renderMainCanvas==='function')renderMainCanvas();const after=captureMainPixels();
          const diff=compare(before,after,'web',issues);if(frameLayer)frameLayer.showWeb=true;if(typeof renderMainCanvas==='function')renderMainCanvas();
          const newErrors=errors.slice(fixtureErrors);if(newErrors.length)issues.push(...newErrors.map(x=>`runtime: ${x}`));
          rows.push({project:fixture.project,index,layer:fixture.layer,feature:'web',pass:issues.length===0,issues,diff,backend:window.__somataRenderBackend?.()||null});
        }

        stopVisualMorphOwnership();if(typeof renderMainCanvas==='function')renderMainCanvas();
        const layer=state?.layers?.[fixture.layer]||null,savedLayer=layer?clone(layer):null,savedTunnelActive=state?.tunnel?.active===true;
        for(const feature of fixture.effects){
          if(feature==='web')continue;
          const issues=[],beforeErrors=errors.length;
          if(feature!=='corridor'&&!layer)issues.push(`layer ${fixture.layer} unavailable`);
          if(feature==='corridor'&&!savedTunnelActive)issues.push('Corridor runtime inactive before A/B');
          if(typeof renderMainCanvas==='function')renderMainCanvas();const before=captureMainPixels();
          disable(feature,layer);if(typeof renderMainCanvas==='function')renderMainCanvas();const after=captureMainPixels(),diff=compare(before,after,feature,issues);
          const newErrors=errors.slice(beforeErrors);if(newErrors.length)issues.push(...newErrors.map(x=>`runtime: ${x}`));
          rows.push({project:fixture.project,index,layer:fixture.layer,feature,pass:issues.length===0,issues,diff,backend:window.__somataRenderBackend?.()||null});
          // Restore the exact authored combination in-place, invalidate every dependency domain,
          // and restore Corridor ownership before the next A/B comparison.
          if(layer&&savedLayer){restoreObject(layer,savedLayer);window.__spiroMarkLayerDirty?.(layer,['geometry','style','transform','effect','resource'],'composition-restore');}
          if(savedTunnelActive&&state?.tunnel?.active!==true){if(typeof setTunnelMode==='function')setTunnelMode(true,{silent:true});else state.tunnel.active=true;}
          if(typeof renderMainCanvas==='function')renderMainCanvas();
        }
      }
    }finally{
      try{if(previousIndex>=0&&previousIndex<entries.length)await loadPlaylistProjectByIndex(previousIndex);}catch(_){}
      try{window.__somataSetRenderBackend?.(previousBackend);}catch(_){}
      window.removeEventListener('error',onError);window.removeEventListener('unhandledrejection',onReject);
      try{requestMainCanvasRender?.();}catch(_){}
    }
    const expected=fixtures.reduce((sum,f)=>sum+f.effects.length,0),pass=rows.length===expected&&rows.every(r=>r.pass)&&errors.length===0;
    const result={version:'7.3.20',backend,pass,expected,rows,errors};
    if(options.log!==false){console.group?.(`[Somata 7.3.20 composition interference ${backend.toUpperCase()}] ${pass?'PASS':'FAIL'}`);console.table?.(rows.map(r=>({project:r.project,layer:r.layer,effect:r.feature,pass:r.pass,changedPixels:r.diff?.changedPixels||0,issues:(r.issues||[]).join('; ')})));if(errors.length)console.error(errors);console.groupEnd?.();}
    return result;
  };

  // Session-recovery gate. The ordinary visual suites validate steady-state rendering;
  // this one validates the boundaries that historically lose ownership: backend hand-off while
  // Morph/Corridor are live, a real layout resize/reflow, and foreground recovery. Every stage
  // must keep the authored default modes owned and the final Canvas visibly populated.
  window.__somataRecoverySoakSmokeTest=async(options={})=>{
    const backend=String(options.backend||'cpu').toLowerCase()==='gpu'?'gpu':'cpu';
    const cycles=Math.max(1,Math.min(2,Math.floor(Number(options.cycles)||1)));
    const frames=Math.max(2,Math.min(6,Math.floor(Number(options.frames)||3)));
    const entries=runtimeEntries(),rows=[],errors=[];
    const names=['Радуга','Мозголом','Секс','Fucking freak 3','Святой','Искры','4 Galaxy'];
    if(!entries.length)return{version:'7.3.20',backend,cycles,frames,pass:false,rows,errors:['playlist has no loaded projects']};
    const previousIndex=typeof getCurrentPlaylistProjectIndex==='function'?getCurrentPlaylistProjectIndex():-1;
    const previousBackend=window.__somataRenderBackend?.().preference||'auto';
    const onError=e=>errors.push(String(e?.error?.stack||e?.message||'window error'));
    const onReject=e=>errors.push(String(e?.reason?.stack||e?.reason||'unhandled rejection'));
    const signal=()=>{
      const shot=captureMainPixels();if(!shot)return{readable:false,litPixels:0,ratio:0,width:0,height:0};
      let litPixels=0;for(let i=0;i<shot.data.length;i+=4)if((shot.data[i]+shot.data[i+1]+shot.data[i+2])>6&&shot.data[i+3]>0)litPixels++;
      return{readable:true,litPixels,ratio:litPixels/Math.max(1,shot.width*shot.height),width:shot.width,height:shot.height};
    };
    const stageStatus=(entry)=>({
      mode:validateModeStatus(entry,safeCall(()=>window.__spiroReportProjectDefaultMorphStatus?.())),
      scheduler:safeCall(()=>window.__somataSchedulerDiag?.()?.scheduler)||null,
      backend:window.__somataRenderBackend?.()||{},
      gpu:window.__somataFullGpuDiagnostics?.()||{},
      signal:signal()
    });
    const validateStage=(label,rec,issues)=>{
      if(rec.mode?.issues?.length)issues.push(...rec.mode.issues.map(x=>`${label}: ${x}`));
      if(!rec.signal?.readable)issues.push(`${label}: Canvas readback unavailable`);
      else if(Number(rec.signal.litPixels)<8)issues.push(`${label}: final Canvas appears blank (${Number(rec.signal.litPixels)||0} lit pixels)`);
    };
    const layoutPulse=async()=>{
      if(typeof mainContainerEl==='undefined'||!mainContainerEl)return{attempted:false,changed:false,before:0,during:0,after:0};
      const before=Math.round(mainContainerEl.getBoundingClientRect?.().width||mainContainerEl.clientWidth||0);
      if(before<360)return{attempted:false,changed:false,before,during:before,after:before};
      const css=mainContainerEl.style.cssText,target=Math.max(280,Math.round(before*.82));
      try{
        mainContainerEl.style.flex=`0 0 ${target}px`;mainContainerEl.style.width=`${target}px`;mainContainerEl.style.maxWidth=`${target}px`;
        window.dispatchEvent(new Event('resize'));requestMainCanvasRender?.();await visualFrames(frames);
        const during=Math.round(mainContainerEl.getBoundingClientRect?.().width||mainContainerEl.clientWidth||0);
        mainContainerEl.style.cssText=css;window.dispatchEvent(new Event('resize'));requestMainCanvasRender?.();await visualFrames(frames);
        const after=Math.round(mainContainerEl.getBoundingClientRect?.().width||mainContainerEl.clientWidth||0);
        return{attempted:true,changed:Math.abs(during-before)>=8,before,during,after};
      }finally{
        mainContainerEl.style.cssText=css;window.dispatchEvent(new Event('resize'));requestMainCanvasRender?.();
      }
    };
    window.addEventListener('error',onError);window.addEventListener('unhandledrejection',onReject);
    try{
      window.__somataSetRenderBackend?.(backend);await visualFrames(2);
      const requestedEffective=window.__somataRenderBackend?.().effective||null;
      for(let cycle=0;cycle<cycles;cycle++)for(const name of names){
        const index=entries.findIndex(e=>e?.name===name),issues=[],beforeErrors=errors.length,beforeDiag=window.__somataFullGpuDiagnostics?.()||{};
        if(index<0){rows.push({cycle,name,pass:false,issues:[`fixture project not found: ${name}`]});continue;}
        await loadPlaylistProjectByIndex(index);requestMainCanvasRender?.();await visualFrames(frames);
        const initial=stageStatus(entries[index]);validateStage('initial',initial,issues);
        const initialTasks=Number(initial.scheduler?.activeTasks||0),initialPaintErrors=Number(initial.scheduler?.paintErrors||0);

        const alternate=backend==='gpu'?'cpu':'gpu';window.__somataSetRenderBackend?.(alternate);requestMainCanvasRender?.();await visualFrames(frames);
        const alternateStage=stageStatus(entries[index]);validateStage('backend hand-off',alternateStage,issues);
        window.__somataSetRenderBackend?.(backend);requestMainCanvasRender?.();await visualFrames(frames);
        const returned=stageStatus(entries[index]);validateStage('backend return',returned,issues);
        if(requestedEffective&&returned.backend?.effective!==requestedEffective)issues.push(`backend return: effective backend ${returned.backend?.effective||'none'} != ${requestedEffective}`);

        const resize=await layoutPulse(),resized=stageStatus(entries[index]);validateStage('resize recovery',resized,issues);
        if(resize.attempted&&!resize.changed)issues.push(`resize recovery: layout pulse did not resize main container (${resize.before} -> ${resize.during})`);
        if(resize.attempted&&Math.abs(resize.after-resize.before)>4)issues.push(`resize recovery: main container did not restore (${resize.before} -> ${resize.after})`);

        // The production visibility handler invalidates a fresh frame whenever the document
        // becomes visible. Dispatching it here exercises that recovery without spoofing browser
        // read-only visibility state or pausing the test runner itself.
        document.dispatchEvent(new Event('visibilitychange'));requestMainCanvasRender?.();await visualFrames(frames);
        const visible=stageStatus(entries[index]);validateStage('visibility recovery',visible,issues);
        for(const [stageName,stageRec] of [['backend hand-off',alternateStage],['backend return',returned],['resize recovery',resized],['visibility recovery',visible]])if(Number(stageRec.scheduler?.paintErrors||0)>initialPaintErrors)issues.push(`${stageName}: scheduler paint errors increased ${initialPaintErrors} -> ${Number(stageRec.scheduler?.paintErrors||0)}`);
        const finalTasks=Number(visible.scheduler?.activeTasks||0);
        if(finalTasks>initialTasks+1)issues.push(`scheduler ownership grew ${initialTasks} -> ${finalTasks}`);
        const afterDiag=window.__somataFullGpuDiagnostics?.()||{},gpuErrorDelta=Math.max(0,Number(afterDiag.errors||0)-Number(beforeDiag.errors||0));
        if(gpuErrorDelta>0)issues.push(`GPU diagnostic errors increased by ${gpuErrorDelta}`);
        const newErrors=errors.slice(beforeErrors);if(newErrors.length)issues.push(...newErrors.map(x=>`runtime: ${x}`));
        rows.push({cycle,name,index,pass:issues.length===0,issues,initial,alternate:alternateStage,returned,resized,visible,resize,gpuErrorDelta});
      }
    }finally{
      try{if(previousIndex>=0&&previousIndex<entries.length)await loadPlaylistProjectByIndex(previousIndex);}catch(_){}
      try{window.__somataSetRenderBackend?.(previousBackend);}catch(_){}
      window.removeEventListener('error',onError);window.removeEventListener('unhandledrejection',onReject);try{requestMainCanvasRender?.();}catch(_){}
    }
    const pass=rows.length===names.length*cycles&&rows.every(r=>r.pass)&&errors.length===0;
    const result={version:'7.3.20',backend,cycles,frames,pass,rows,errors};
    if(options.log!==false){console.group?.(`[Somata 7.3.20 recovery soak ${backend.toUpperCase()}] ${pass?'PASS':'FAIL'}`);console.table?.(rows.map(r=>({cycle:r.cycle,project:r.name,pass:r.pass,resize:r.resize?.changed===true,tasks:`${r.initial?.scheduler?.activeTasks||0}→${r.visible?.scheduler?.activeTasks||0}`,issues:(r.issues||[]).join('; ')})));if(errors.length)console.error(errors);console.groupEnd?.();}
    return result;
  };

  // Playlist marathon: repeated full-playlist traversal without reloading the page. This gate
  // catches cross-project cache/scheduler ownership leaks that a one-shot smoke cannot see.
  // Each project must return to the same scheduler-owner count on every cycle while runtime,
  // GPU-diagnostic and paint-error counters remain stable. Recovery/resize are tested separately.
  window.__somataPlaylistMarathonSmokeTest=async(options={})=>{
    const backend=String(options.backend||'cpu').toLowerCase()==='gpu'?'gpu':'cpu';
    const cycles=Math.max(2,Math.min(6,Math.floor(Number(options.cycles)||2)));
    const frames=Math.max(2,Math.min(4,Math.floor(Number(options.frames)||2)));
    const entries=runtimeEntries(),rows=[],errors=[],taskBaseline=new Map();
    if(!entries.length)return{version:'7.3.20',backend,cycles,frames,pass:false,rows,errors:['playlist has no loaded projects']};
    if(typeof loadPlaylistProjectByIndex!=='function')return{version:'7.3.20',backend,cycles,frames,pass:false,rows,errors:['playlist loader unavailable']};
    const previousIndex=typeof getCurrentPlaylistProjectIndex==='function'?getCurrentPlaylistProjectIndex():-1;
    const previousBackend=window.__somataRenderBackend?.().preference||'auto';
    const onError=e=>errors.push(String(e?.error?.stack||e?.message||'window error'));
    const onReject=e=>errors.push(String(e?.reason?.stack||e?.reason||'unhandled rejection'));
    const status=()=>({
      scheduler:safeCall(()=>window.__somataSchedulerDiag?.()?.scheduler)||{},
      gpu:window.__somataFullGpuDiagnostics?.()||{},
      backend:window.__somataRenderBackend?.()||{}
    });
    window.addEventListener('error',onError);window.addEventListener('unhandledrejection',onReject);
    const start=status(),startPaintErrors=Number(start.scheduler?.paintErrors||0),startGpuErrors=Number(start.gpu?.errors||0);
    try{
      for(let cycle=0;cycle<cycles;cycle++){
        // Alternate preference between requested and the opposite backend on later cycles.
        // On hosts without WebGPU, GPU preference is expected to resolve to CPU safely.
        const cycleBackend=cycle%2===0?backend:(backend==='gpu'?'cpu':'gpu');
        window.__somataSetRenderBackend?.(cycleBackend);await visualFrames(1);
        for(let i=0;i<entries.length;i++){
          const issues=[],beforeErrors=errors.length,before=status();
          await loadPlaylistProjectByIndex(i);requestMainCanvasRender?.();await visualFrames(frames);
          const after=status(),modeCheck=validateModeStatus(entries[i],safeCall(()=>window.__spiroReportProjectDefaultMorphStatus?.()));
          if(modeCheck.issues.length)issues.push(...modeCheck.issues);
          if(!(typeof mainCanvas!=='undefined'&&mainCanvas?.width>0&&mainCanvas?.height>0))issues.push('main Canvas unavailable or zero-sized');
          const taskCount=Number(after.scheduler?.activeTasks||0),base=taskBaseline.get(i);
          if(base==null)taskBaseline.set(i,taskCount);else if(taskCount!==base)issues.push(`scheduler owner drift ${base} -> ${taskCount}`);
          if(Number(after.scheduler?.paintErrors||0)>Number(before.scheduler?.paintErrors||0))issues.push(`scheduler paint errors increased ${Number(before.scheduler?.paintErrors||0)} -> ${Number(after.scheduler?.paintErrors||0)}`);
          const gpuDelta=Math.max(0,Number(after.gpu?.errors||0)-Number(before.gpu?.errors||0));if(gpuDelta>0)issues.push(`GPU diagnostic errors increased by ${gpuDelta}`);
          if(cycleBackend==='cpu'&&after.backend?.effective!=='cpu')issues.push(`CPU preference resolved to ${after.backend?.effective||'none'}`);
          if(cycleBackend==='gpu'&&after.backend?.webgpuSupported===true&&after.backend?.effective!=='gpu')issues.push(`WebGPU available but GPU preference resolved to ${after.backend?.effective||'none'}`);
          const newErrors=errors.slice(beforeErrors);if(newErrors.length)issues.push(...newErrors.map(x=>`runtime: ${x}`));
          rows.push({cycle,index:i,name:entries[i]?.name||`Project ${i+1}`,preference:cycleBackend,effective:after.backend?.effective||null,activeTasks:taskCount,paintErrors:Number(after.scheduler?.paintErrors||0),gpuErrors:Number(after.gpu?.errors||0),modeCheck,pass:issues.length===0,issues});
        }
      }
    }finally{
      try{if(previousIndex>=0&&previousIndex<entries.length)await loadPlaylistProjectByIndex(previousIndex);}catch(_){}
      try{window.__somataSetRenderBackend?.(previousBackend);}catch(_){}
      window.removeEventListener('error',onError);window.removeEventListener('unhandledrejection',onReject);try{requestMainCanvasRender?.();}catch(_){}
    }
    const end=status(),expected=entries.length*cycles;
    const pass=rows.length===expected&&rows.every(r=>r.pass)&&errors.length===0&&Number(end.scheduler?.paintErrors||0)<=startPaintErrors&&Number(end.gpu?.errors||0)<=startGpuErrors;
    const result={version:'7.3.20',backend,cycles,frames,pass,projectLoads:rows.length,expectedProjectLoads:expected,taskBaseline:Object.fromEntries([...taskBaseline.entries()].map(([i,v])=>[entries[i]?.name||String(i),v])),start,end,rows,errors};
    if(options.log!==false){console.group?.(`[Somata 7.3.20 playlist marathon ${backend.toUpperCase()}] ${pass?'PASS':'FAIL'}`);console.table?.(rows.map(r=>({cycle:r.cycle,project:r.name,pref:r.preference,effective:r.effective,tasks:r.activeTasks,pass:r.pass,issues:r.issues.join('; ')})));if(errors.length)console.error(errors);console.groupEnd?.();}
    return result;
  };


  // Save/load persistence is a functional renderer contract: project files must preserve the
  // authored effect configuration even when runtime-only animation phases are discarded or reset.
  // The signature deliberately compares Fill opacity at the integer-percent precision exposed by
  // the UI; legacy rgba() values may canonicalize to #RRGGBBAA without changing the authored value.
  const persistenceSweepRuntimeKeys=new Set(['raf','currentVelocity','lastUpdate','lightningLastUpdate','phase','lightningPhase','cycleCount','lightningCycleCount']);
  function persistenceClean(value,path=''){
    if(Array.isArray(value))return value.map((v,i)=>persistenceClean(v,`${path}[${i}]`));
    if(value&&typeof value==='object'){
      const out={};
      for(const key of Object.keys(value).sort()){
        if(key==='savedAt')continue;
        if((path.endsWith('.sweep')||path==='sweep')&&persistenceSweepRuntimeKeys.has(key))continue;
        if(key==='fillColor'&&typeof value[key]==='string'){
          out[key]=`${colorBaseHex6(value[key])}@${getFillOpacityPercent(value[key])}`;
          continue;
        }
        out[key]=persistenceClean(value[key],path?`${path}.${key}`:key);
      }
      return out;
    }
    if(typeof value==='number'&&Object.is(value,-0))return 0;
    return value;
  }
  function persistenceProjectSignature(project){
    const settings=project?.settings||{};
    return persistenceClean({
      settings:{
        activeProjectPaletteKey:settings.activeProjectPaletteKey,
        bgColor:settings.bgColor,backgroundImageDataUrl:settings.backgroundImageDataUrl||'',transparentDesktop:settings.transparentDesktop===true,
        sceneBlend:settings.sceneBlend,showLines:settings.showLines,showLamps:settings.showLamps,showWeb:settings.showWeb,
        graffitiDefaultActive:settings.graffitiDefaultActive,graffitiRasterized:settings.graffitiRasterized,
        fourierMode:settings.fourierMode,fourierStrength:settings.fourierStrength,motion:settings.motion,lineOutline:settings.lineOutline,
        tunnel:settings.tunnel,morph:settings.morph,minimalMorph:settings.minimalMorph,
        lightningRateSync:settings.lightningRateSync,sweep:settings.sweep,web:settings.web,lamps:settings.lamps,
        randomLayerCount:settings.randomLayerCount,randomOptions:settings.randomOptions,profileView:settings.profileView,
        zoom:settings.zoom,panX:settings.panX,panY:settings.panY,camera:settings.camera
      },
      layers:Array.isArray(project?.layers)?project.layers:[],
      library:project?.library||{shapes:[]}
    });
  }
  function persistenceDiff(a,b,path='',out=[]){
    if(out.length>=16)return out;
    if(typeof a!==typeof b){out.push(`${path}: type ${typeof a} != ${typeof b}`);return out;}
    if(a===null||b===null||typeof a!=='object'){
      if(Number.isNaN(a)&&Number.isNaN(b))return out;
      if(typeof a==='number'&&typeof b==='number'&&Number.isFinite(a)&&Number.isFinite(b)){
        const tol=1e-9*Math.max(1,Math.abs(a),Math.abs(b));if(Math.abs(a-b)<=tol)return out;
      }
      if(a!==b)out.push(`${path}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
      return out;
    }
    const aa=Array.isArray(a),bb=Array.isArray(b);if(aa!==bb){out.push(`${path}: array mismatch`);return out;}
    if(aa){if(a.length!==b.length)out.push(`${path}.length: ${a.length} != ${b.length}`);for(let i=0;i<Math.min(a.length,b.length)&&out.length<16;i++)persistenceDiff(a[i],b[i],`${path}[${i}]`,out);return out;}
    const keys=[...new Set([...Object.keys(a),...Object.keys(b)])].sort();
    for(const key of keys){if(out.length>=16)break;const next=path?`${path}.${key}`:key;if(!(key in a)||!(key in b)){out.push(`${next}: missing`);continue;}persistenceDiff(a[key],b[key],next,out);}
    return out;
  }
  window.__somataProjectPersistenceSmokeTest=async(options={})=>{
    const entries=runtimeEntries(),rows=[],errors=[];
    if(!entries.length)return{version:'7.3.20',pass:false,rows,errors:['playlist has no loaded projects']};
    if(typeof buildProjectData!=='function'||typeof applyLoadedProject!=='function')return{version:'7.3.20',pass:false,rows,errors:['project serializer/loader unavailable']};
    const previousIndex=typeof getCurrentPlaylistProjectIndex==='function'?getCurrentPlaylistProjectIndex():-1;
    const onError=e=>errors.push(String(e?.error?.stack||e?.message||'window error')),onReject=e=>errors.push(String(e?.reason?.stack||e?.reason||'unhandled rejection'));
    window.addEventListener('error',onError);window.addEventListener('unhandledrejection',onReject);
    try{
      for(let i=0;i<entries.length;i++){
        const issues=[],beforeErrors=errors.length;
        await loadPlaylistProjectByIndex(i);await twoFrames();stopVisualMorphOwnership();
        const first=buildProjectData(),firstSig=persistenceProjectSignature(first);
        let parsed=null;try{parsed=JSON.parse(JSON.stringify(first));}catch(err){issues.push(`JSON round-trip failed: ${String(err?.message||err)}`);}
        if(parsed){
          try{
            applyLoadedProject(parsed,{applyProjectDefaultModes:false,preserveFullMorph:false,preserveMinimalMorph:false,suppressMinimalAutoStart:true});
            if(typeof syncAfterProjectLoad==='function')syncAfterProjectLoad();
            const second=buildProjectData(),secondSig=persistenceProjectSignature(second),diff=persistenceDiff(firstSig,secondSig);
            if(diff.length)issues.push(...diff);
          }catch(err){issues.push(`reload failed: ${String(err?.stack||err?.message||err)}`);}
        }
        const newErrors=errors.slice(beforeErrors);if(newErrors.length)issues.push(...newErrors.map(x=>`runtime: ${x}`));
        rows.push({index:i,name:entries[i]?.name||`Project ${i+1}`,pass:issues.length===0,issues});
      }
    }finally{
      try{if(previousIndex>=0&&previousIndex<entries.length)await loadPlaylistProjectByIndex(previousIndex);}catch(_){}
      window.removeEventListener('error',onError);window.removeEventListener('unhandledrejection',onReject);try{requestMainCanvasRender?.();}catch(_){}
    }
    const result={version:'7.3.20',pass:rows.length===entries.length&&rows.every(r=>r.pass)&&errors.length===0,projectCount:entries.length,rows,errors};
    if(options.log!==false){console.group?.(`[Somata 7.3.20 project persistence] ${result.pass?'PASS':'FAIL'}`);console.table?.(rows.map(r=>({project:r.name,pass:r.pass,issues:r.issues.join('; ')})));if(errors.length)console.error(errors);console.groupEnd?.();}
    return result;
  };

  // CSS compositing happens after Canvas readback and therefore cannot be certified by pixel-diff
  // tests alone. Validate the final Scene Blend state for every playlist project and, critically,
  // that switching away from a blend project removes the previous CSS ownership.
  window.__somataFinalCompositorSmokeTest=async(options={})=>{
    const entries=runtimeEntries(),rows=[],errors=[];
    if(!entries.length)return{version:'7.3.20',pass:false,rows,errors:['playlist has no loaded projects']};
    const previousIndex=typeof getCurrentPlaylistProjectIndex==='function'?getCurrentPlaylistProjectIndex():-1;
    const onError=e=>errors.push(String(e?.error?.stack||e?.message||'window error')),onReject=e=>errors.push(String(e?.reason?.stack||e?.reason||'unhandled rejection'));
    const styleState=()=>({
      mode:String(state?.sceneBlend?.mode||'normal'),strength:Number(state?.sceneBlend?.strength??100),opacity:Number(state?.sceneBlend?.opacity??100),
      mainMix:String(mainCanvas?.style?.mixBlendMode||''),mainOpacity:String(mainCanvas?.style?.opacity||''),
      blendDisplay:String(sceneBlendCanvas?.style?.display||''),blendMix:String(sceneBlendCanvas?.style?.mixBlendMode||''),blendOpacity:String(sceneBlendCanvas?.style?.opacity||'')
    });
    window.addEventListener('error',onError);window.addEventListener('unhandledrejection',onReject);
    try{
      for(let i=0;i<entries.length;i++){
        const issues=[],beforeErrors=errors.length;await loadPlaylistProjectByIndex(i);requestMainCanvasRender?.();await visualFrames(1);if(typeof renderMainCanvas==='function')renderMainCanvas();
        const st=styleState(),mode=st.mode,strength=Math.max(0,Math.min(100,st.strength))/100,opacity=Math.max(0,Math.min(100,st.opacity))/100;
        const direct=mode!=='normal'&&strength>=.9999&&opacity>.0001;
        const partial=mode!=='normal'&&strength>.0001&&strength<.9999&&opacity>.0001;
        if(direct){if(st.mainMix!==mode)issues.push(`direct blend main mix ${st.mainMix||'(empty)'} != ${mode}`);if(st.blendDisplay!=='none')issues.push(`direct blend scratch canvas visible (${st.blendDisplay||'(empty)'})`);}
        else if(partial){if(st.mainMix!=='normal')issues.push(`partial blend main mix ${st.mainMix||'(empty)'} != normal`);if(st.blendDisplay==='none')issues.push('partial blend scratch canvas hidden');if(st.blendMix!==mode)issues.push(`partial blend scratch mix ${st.blendMix||'(empty)'} != ${mode}`);}
        else{if(st.mainMix!=='normal')issues.push(`normal compositor leaked mix ${st.mainMix}`);if(st.blendDisplay!=='none')issues.push(`normal compositor scratch canvas visible (${st.blendDisplay||'(empty)'})`);}
        const newErrors=errors.slice(beforeErrors);if(newErrors.length)issues.push(...newErrors.map(x=>`runtime: ${x}`));
        rows.push({index:i,name:entries[i]?.name||`Project ${i+1}`,pass:issues.length===0,issues,state:st,direct,partial});
      }
    }finally{
      try{if(previousIndex>=0&&previousIndex<entries.length)await loadPlaylistProjectByIndex(previousIndex);}catch(_){}
      window.removeEventListener('error',onError);window.removeEventListener('unhandledrejection',onReject);try{requestMainCanvasRender?.();}catch(_){}
    }
    const blendRows=rows.filter(r=>r.state?.mode!=='normal'&&Number(r.state?.strength)>0&&Number(r.state?.opacity)>0);
    const result={version:'7.3.20',pass:rows.length===entries.length&&rows.every(r=>r.pass)&&blendRows.length>0&&errors.length===0,projectCount:entries.length,activeBlendFixtures:blendRows.map(r=>r.name),rows,errors};
    if(options.log!==false){console.group?.(`[Somata 7.3.20 final compositor] ${result.pass?'PASS':'FAIL'}`);console.table?.(rows.map(r=>({project:r.name,mode:r.state?.mode,pass:r.pass,issues:r.issues.join('; ')})));if(errors.length)console.error(errors);console.groupEnd?.();}
    return result;
  };


  // Resource Stability Soak: repeated heavy-project traversal must not accumulate retained
  // scheduler/cache/GPU resources after warm-up. Known bounded caches are checked against their
  // published limits; all observed resident-count series are also checked for strict monotonic
  // growth across complete cycles, which is the signature of an ownership/resource leak.
  function resourceStabilitySnapshot(){
    const safe=fn=>{try{return typeof fn==='function'?(fn()||{}):{};}catch(_){return{};}};
    const scheduler=safe(window.__somataSchedulerDiag)?.scheduler||{};
    const shared=safe(window.__spiroSharedGeometryCacheStatus);
    const copy=safe(window.__spiroCorridorCopyStoreStatus);
    const stroke=safe(window.__spiroWebGPUStatus);
    const fill=safe(window.__spiroFillGPUStatus);
    const arc=safe(window.__spiroGpuMorphArcStatus);
    const webCorner=safe(window.__spiroGpuWebCornerStatus);
    const lampTopo=safe(window.__spiroGpuLampTopologyStatus);
    const lampGhost=safe(window.__spiroGpuLampGhostStatus);
    const lampCorner=safe(window.__spiroGpuLampCornerStatus);
    const canonical=safe(window.__spiroCanonicalPathStoreStatus);
    const pathFx=safe(window.__spiroPathFxGPUStatus);
    const particles=safe(window.__spiroParticleGPUStatus);
    const counts={},limits={};
    const put=(k,v)=>{v=Number(v);if(Number.isFinite(v)&&v>=0)counts[k]=v;};
    const lim=(k,v)=>{v=Number(v);if(Number.isFinite(v)&&v>=0)limits[k]=v;};
    put('scheduler.activeTasks',scheduler.activeTasks);put('sharedGeometry.size',shared.size);lim('sharedGeometry.size',shared.max);
    put('corridorCopy.residentRecords',copy.residentRecords);lim('corridorCopy.residentRecords',copy.residentLimit);
    put('stroke.staticBuffers',stroke.staticBuffers);lim('stroke.staticBuffers',stroke.staticBufferLimit);
    put('stroke.indexedMorph.topologyRecords',stroke.indexedMorph?.topologyRecords);
    put('stroke.indexedMorph.retiredTopologies',stroke.indexedMorph?.retiredTopologies);
    put('stroke.indexedMorph.residentRecords',stroke.indexedMorph?.residentRecords);
    put('stroke.indexedMorph.residentPins',stroke.indexedMorph?.residentPins);
    put('stroke.corridor.segmentBuffers',stroke.corridor?.segmentBuffers);lim('stroke.corridor.segmentBuffers',stroke.corridorSegmentLimit);
    put('stroke.layerBatch.residentFillMasks',stroke.layerBatch?.residentFillMasks?.records);lim('stroke.layerBatch.residentFillMasks',stroke.layerBatch?.residentFillMasks?.limit);
    put('stroke.layerBatch.residentSceneUniforms',stroke.layerBatch?.residentSceneUniforms?.records);
    put('stroke.layerBatch.sceneBindGroupCacheSize',stroke.layerBatch?.sceneBindGroupCacheSize);
    put('stroke.smoothSpiralBezier.bufferRecords',stroke.smoothSpiralBezier?.bufferRecords);
    put('fill.nativeMesh.residentMeshRecords',fill.nativeMesh?.residentMeshRecords);
    put('morphArc.resourceCount',arc.resourceCount);put('morphArc.staticSpiralResources',arc.staticSpiralResources);
    put('webCorner.resources',Array.isArray(webCorner.resources)?webCorner.resources.length:undefined);
    put('lampTopology.resources',Array.isArray(lampTopo.resources)?lampTopo.resources.length:undefined);
    put('lampGhost.resources',Array.isArray(lampGhost.resources)?lampGhost.resources.length:undefined);
    put('lampCorner.resources',Array.isArray(lampCorner.resources)?lampCorner.resources.length:undefined);
    put('canonical.records',canonical.records??canonical.size??canonical.resourceCount);
    put('pathFx.records',pathFx.records??pathFx.resourceCount??pathFx.staticBuffers);
    put('particles.records',particles.records??particles.resourceCount??particles.staticBuffers);
    return{counts,limits,scheduler:{activeTasks:Number(scheduler.activeTasks||0),paintErrors:Number(scheduler.paintErrors||0)},gpu:window.__somataFullGpuDiagnostics?.()||{},backend:window.__somataRenderBackend?.()||{}};
  }
  window.__somataResourceStabilitySoakTest=async(options={})=>{
    const backend=String(options.backend||'cpu').toLowerCase()==='gpu'?'gpu':'cpu';
    const cycles=Math.max(3,Math.min(6,Math.floor(Number(options.cycles)||3)));
    const frames=Math.max(2,Math.min(5,Math.floor(Number(options.frames)||2)));
    const fixtureNames=['Радуга','Мозголом','Секс','Fucking freak 3','Святой','Искры','4 Galaxy'];
    const entries=runtimeEntries(),indices=fixtureNames.map(name=>entries.findIndex(e=>e?.name===name)).filter(i=>i>=0),rows=[],errors=[],cycleSnapshots=[];
    if(indices.length!==fixtureNames.length)return{version:'7.3.20',backend,cycles,frames,pass:false,rows,errors:[`resource fixtures missing ${indices.length}/${fixtureNames.length}`]};
    const previousIndex=typeof getCurrentPlaylistProjectIndex==='function'?getCurrentPlaylistProjectIndex():-1,previousBackend=window.__somataRenderBackend?.().preference||'auto';
    const onError=e=>errors.push(String(e?.error?.stack||e?.message||'window error')),onReject=e=>errors.push(String(e?.reason?.stack||e?.reason||'unhandled rejection'));
    window.addEventListener('error',onError);window.addEventListener('unhandledrejection',onReject);
    const start=resourceStabilitySnapshot(),startPaint=start.scheduler.paintErrors,startGpu=Number(start.gpu?.errors||0);
    try{
      window.__somataSetRenderBackend?.(backend);await visualFrames(1);
      for(let cycle=0;cycle<cycles;cycle++){
        for(const index of indices){
          const beforeErrors=errors.length,issues=[];await loadPlaylistProjectByIndex(index);requestMainCanvasRender?.();await visualFrames(frames);
          const snap=resourceStabilitySnapshot();
          if(snap.scheduler.paintErrors>startPaint)issues.push(`scheduler paintErrors ${startPaint} -> ${snap.scheduler.paintErrors}`);
          if(Number(snap.gpu?.errors||0)>startGpu)issues.push(`GPU diagnostic errors ${startGpu} -> ${Number(snap.gpu?.errors||0)}`);
          const newErrors=errors.slice(beforeErrors);if(newErrors.length)issues.push(...newErrors.map(x=>`runtime: ${x}`));
          rows.push({cycle,index,name:entries[index]?.name||String(index),pass:issues.length===0,issues,counts:snap.counts});
        }
        const endCycle=resourceStabilitySnapshot(),limitIssues=[];
        for(const [key,limit] of Object.entries(endCycle.limits)){const value=endCycle.counts[key];if(Number.isFinite(value)&&value>limit)limitIssues.push(`${key} ${value} > limit ${limit}`);}
        cycleSnapshots.push({cycle,counts:endCycle.counts,limits:endCycle.limits,activeTasks:endCycle.scheduler.activeTasks,limitIssues});
      }
    }finally{
      try{if(previousIndex>=0&&previousIndex<entries.length)await loadPlaylistProjectByIndex(previousIndex);}catch(_){}
      try{window.__somataSetRenderBackend?.(previousBackend);}catch(_){}
      window.removeEventListener('error',onError);window.removeEventListener('unhandledrejection',onReject);try{requestMainCanvasRender?.();}catch(_){}
    }
    const resourceKeys=[...new Set(cycleSnapshots.flatMap(x=>Object.keys(x.counts||{})))],growthIssues=[];
    for(const key of resourceKeys){
      const series=cycleSnapshots.map(x=>Number(x.counts?.[key])).filter(Number.isFinite);if(series.length<3)continue;
      // A published-cap cache is allowed to warm monotonically: its hard limit is the
      // ownership contract and limitIssues above already makes overflow a release failure.
      // Treating normal LRU warm-up as a leak made random Morph target geometry fail the soak
      // even though sharedGeometry is strictly capped/evicted. Only unbounded resident sets
      // must reach a steady count across complete repeated cycles.
      const bounded=cycleSnapshots.some(x=>Number.isFinite(Number(x.limits?.[key])));
      if(bounded)continue;
      let monotonic=true;for(let i=1;i<series.length;i++){if(!(series[i]>series[i-1])){monotonic=false;break;}}
      if(monotonic&&series[series.length-1]-series[0]>1)growthIssues.push(`${key} monotonic growth ${series.join(' -> ')}`);
    }
    const limitIssues=cycleSnapshots.flatMap(x=>x.limitIssues.map(msg=>`cycle ${x.cycle}: ${msg}`));
    const pass=rows.length===indices.length*cycles&&rows.every(r=>r.pass)&&errors.length===0&&growthIssues.length===0&&limitIssues.length===0;
    const result={version:'7.3.20',backend,cycles,frames,pass,fixtures:fixtureNames,projectLoads:rows.length,rows,cycleSnapshots,growthIssues,limitIssues,errors};
    if(options.log!==false){console.group?.(`[Somata 7.3.20 resource stability ${backend.toUpperCase()}] ${pass?'PASS':'FAIL'}`);console.table?.(cycleSnapshots.map(x=>({cycle:x.cycle,tasks:x.activeTasks,resources:Object.keys(x.counts).length,limitIssues:x.limitIssues.join('; ')})));if(growthIssues.length)console.error(growthIssues);if(limitIssues.length)console.error(limitIssues);if(errors.length)console.error(errors);console.groupEnd?.();}
    return result;
  };


  // 7.3.20 — targeted regression gate for the user-reported Spiral / Мозголом / Искры bugs.
  // This intentionally tests the real saved projects rather than a synthetic geometry fixture.
  window.__somataReportedSpiralSparksSmokeTest=async(options={})=>{
    const backend=String(options.backend||'cpu').toLowerCase()==='gpu'?'gpu':'cpu';
    const entries=runtimeEntries(),rows=[],errors=[];
    const byName=name=>entries.findIndex(e=>e?.name===name);
    const previousIndex=typeof getCurrentPlaylistProjectIndex==='function'?getCurrentPlaylistProjectIndex():-1;
    const previousBackend=window.__somataRenderBackend?.().preference||'auto';
    const onError=e=>errors.push(String(e?.error?.stack||e?.message||'window error'));
    const onReject=e=>errors.push(String(e?.reason?.stack||e?.reason||'unhandled rejection'));
    const waitTick=async()=>{await Promise.race([visualFrames(1),new Promise(resolve=>setTimeout(resolve,34))]);};
    const waitFor=async(pred,timeoutMs=650)=>{const end=performance.now()+Math.max(50,timeoutMs);while(performance.now()<end){if(pred())return true;await waitTick();}return Boolean(pred());};
    const cloneProfiles=list=>(list||[]).map(x=>({mode:x?.mode||'segments',nodes:(x?.nodes||[]).map(p=>({x:Number(p?.x)||0,y:Number(p?.y)||0}))}));
    const profileGap=(a,b)=>{let max=0,countMismatch=false;const counts=[];for(let i=0;i<Math.max(a.length,b.length);i++){const aa=a[i]?.nodes||[],bb=b[i]?.nodes||[];counts.push([aa.length,bb.length]);if(aa.length!==bb.length){countMismatch=true;continue;}for(let j=0;j<aa.length;j++)max=Math.max(max,Math.hypot(aa[j].x-bb[j].x,aa[j].y-bb[j].y));}return{max,countMismatch,counts};};
    const spiralVisualKeys=['N','K','radius','radiusMultiplier','rotation','spiralEnabled','spiralOrder','spiralStep','spiralStepLinked','spiralClosed','spiralTangential','spiralRoundSeams','closedLoop','profileMode'];
    const cloneSpiralVisuals=list=>(list||[]).map(v=>{const out={};for(const key of spiralVisualKeys)out[key]=v?.[key];return out;});
    const spiralVisualGap=(a,b)=>{const diffs=[];for(let i=0;i<Math.max(a.length,b.length);i++){const row={};for(const key of spiralVisualKeys){const x=a[i]?.[key],y=b[i]?.[key];if(typeof x==='number'||typeof y==='number'){const nx=Number(x),ny=Number(y);if(Number.isFinite(nx)&&Number.isFinite(ny)&&Math.abs(nx-ny)>1e-8)row[key]=[x,y];else if(Number.isFinite(nx)!==Number.isFinite(ny))row[key]=[x,y];}else if(x!==y)row[key]=[x,y];}if(Object.keys(row).length)diffs.push({layer:i,diff:row});}return diffs;};
    window.addEventListener('error',onError);window.addEventListener('unhandledrejection',onReject);
    try{
      window.__somataSetRenderBackend?.(backend);
      for(const name of ['Мозголом','Искры']){
        const index=byName(name),issues=[],beforeErrors=errors.length;
        if(index<0){rows.push({name,pass:false,issues:['project missing']});continue;}
        await loadPlaylistProjectByIndex(index);requestMainCanvasRender?.();
        const started=await waitFor(()=>runtimeState?.morph?.active===true&&animationScheduler?.has?.('morph')===true,800);
        if(!runtimeState?.morph?.active)issues.push('Blue Morph default did not activate');
        if(!started)issues.push('Blue Morph did not acquire scheduler task within 800 ms');
        const p0=Number(runtimeState?.morph?.progress)||0;await visualFrames(4);const p1=Number(runtimeState?.morph?.progress)||0;
        if(started&&runtimeState?.morph?.gpuPhasePreparing!==true&&Math.abs(p1-p0)<1e-5)issues.push(`Blue Morph did not advance (${p0} -> ${p1})`);
        // Observe two REAL cycle wraps. Forcing cycleStart across the scheduler's t=1
        // after-paint transaction can compare the wrong display frame when FPS limiting skips
        // a browser rAF. A short authored interval gives us the same production boundary path
        // while keeping the regression gate under one second per project.
        const savedTiming={intervalSec:state.morph.intervalSec,intervalMultiplier:state.morph.intervalMultiplier,tapSync:state.tapTempo?.syncFullMorph};
        if(state.tapTempo)state.tapTempo.syncFullMorph=false;
        state.morph.intervalSec=.28;state.morph.intervalMultiplier=1;
        runtimeState.morph.cycleStart=performance.now();runtimeState.morph.progress=0;runtimeState.morph.geometryT=0;
        const boundaryGaps=[];let prevP=0,lateTarget=cloneProfiles(runtimeState.morph.targetProfiles),lateVisuals=cloneSpiralVisuals(runtimeState.morph.targetVisuals),deadline=performance.now()+2200;
        while(boundaryGaps.length<2&&performance.now()<deadline&&runtimeState?.morph?.active===true){
          await visualFrames(1);const q=Number(runtimeState.morph.progress)||0;
          if(q>.80){lateTarget=cloneProfiles(runtimeState.morph.targetProfiles);lateVisuals=cloneSpiralVisuals(runtimeState.morph.targetVisuals);}
          if(q<prevP-.45){
            const nextSource=cloneProfiles(runtimeState.morph.sourceProfiles),gap=profileGap(lateTarget,nextSource),visualGap=spiralVisualGap(lateVisuals,cloneSpiralVisuals(runtimeState.morph.sourceVisuals));gap.visualGap=visualGap;boundaryGaps.push(gap);
            if(gap.countMismatch||gap.max>1e-8)issues.push(`Spiral phase ${boundaryGaps.length} source-grid jump: max=${gap.max}, countMismatch=${gap.countMismatch}`);
            if(visualGap.length)issues.push(`Spiral phase ${boundaryGaps.length} visual/topology handoff changed: ${JSON.stringify(visualGap)}`);
            lateTarget=cloneProfiles(runtimeState.morph.targetProfiles);lateVisuals=cloneSpiralVisuals(runtimeState.morph.targetVisuals);
          }
          prevP=q;
        }
        if(boundaryGaps.length<2)issues.push(`Spiral boundary observation timed out (${boundaryGaps.length}/2 wraps)`);
        state.morph.intervalSec=savedTiming.intervalSec;state.morph.intervalMultiplier=savedTiming.intervalMultiplier;if(state.tapTempo)state.tapTempo.syncFullMorph=savedTiming.tapSync===true;
        const newErrors=errors.slice(beforeErrors);if(newErrors.length)issues.push(...newErrors.map(x=>`runtime: ${x}`));
        rows.push({name,index,pass:issues.length===0,issues,started,p0,p1,boundaryGaps,backend:window.__somataRenderBackend?.()||null});
      }

      // Искры deliberately hides Base on every layer. Exact Lightning is therefore required
      // to be an independent visible consumer of the Spiral carrier, not a side-effect of Base.
      const sparksIndex=byName('Искры'),issues=[],beforeErrors=errors.length;
      if(sparksIndex<0)issues.push('Искры project missing');
      else{
        await loadPlaylistProjectByIndex(sparksIndex);await waitFor(()=>runtimeState?.morph?.active===true,500);
        stopVisualMorphOwnership();
        const li=(state?.layers||[]).findIndex(l=>l?.visible!==false&&l?.sweep?.enabled===true&&l.sweep.effectType==='lightning'&&l.sweep.lightningPrecision==='exact');
        if(li<0)issues.push('Искры exact Lightning layer missing');
        else{
          const layer=state.layers[li],cfg=layer.sweep,rate=typeof getLightningCycleRateHz==='function'?getLightningCycleRateHz(cfg,li):0;
          if(!(rate>=0.2))issues.push(`Искры Lightning cadence too slow (${rate} Hz)`);
          const plan=safeCall(()=>window.__spiroEffectsPlanSnapshot?.(li))||{};
          if(plan.sweep!==true||plan.sweepType!=='lightning')issues.push('Искры exact Lightning is absent from the render plan while Base is hidden');
          // Freeze the shared lightning clock inside a visibly active precharge/strike window.
          const saved={ratePercent:cfg.lightningRatePercent,rateMultiplier:cfg.lightningRateMultiplier,phase:cfg.lightningPhase,cycle:cfg.lightningCycleCount,enabled:cfg.enabled};
          cfg.lightningPhase=.90;cfg.lightningCycleCount=0;cfg.lightningRatePercent=1;cfg.lightningRateMultiplier=.01;
          try{resetLightningRateRuntimeForProject?.(cfg);}catch(_){}
          requestMainCanvasRender?.();if(typeof renderMainCanvas==='function')renderMainCanvas();const on=captureMainPixels();
          // CPU exact path must be built from actual L/Q/C rails, never from the simple chord carrier.
          let exactRail=false;
          try{
            if(typeof prepareMainLayerFrame==='function'&&typeof buildExactLightningPaths==='function'){
              const ctx=prepareMainLayerFrame(renderRuntime.frame,li),paths=ctx?buildExactLightningPaths(ctx):null;
              exactRail=Boolean(paths?._exactLightningSplineRail===true||(Array.isArray(paths)&&paths.some(p=>Array.isArray(p?._exactLightningRail?.segments)&&p._exactLightningRail.segments.some(seg=>seg?.type==='C'||seg?.type==='Q'))));
            }
          }catch(_){}
          if(window.__somataRenderBackend?.().effective==='cpu'&&!exactRail)issues.push('CPU exact Lightning did not expose a retained Bézier rail');
          cfg.enabled=false;requestMainCanvasRender?.();if(typeof renderMainCanvas==='function')renderMainCanvas();const off=captureMainPixels(),diff=pixelDiff(on,off),min=Math.max(16,Math.floor((on?.width||0)*(on?.height||0)*0.00001));
          if(!diff.comparable)issues.push('Искры Canvas readback unavailable');else if(diff.changedPixels<min)issues.push(`Искры exact Lightning made no visible contribution (${diff.changedPixels} px < ${min})`);
          Object.assign(cfg,{lightningRatePercent:saved.ratePercent,lightningRateMultiplier:saved.rateMultiplier,lightningPhase:saved.phase,lightningCycleCount:saved.cycle,enabled:saved.enabled});try{resetLightningRateRuntimeForProject?.(cfg);}catch(_){}
          const gpuStatus=safeCall(window.__spiroGpuLightningArcStatus)||{};
          if(window.__somataRenderBackend?.().effective==='gpu'&&Number(gpuStatus.exactBezierRasterSubdiv||0)<6)issues.push('GPU exact Lightning is not using retained Bézier subdivision');
          rows.push({name:'Искры exact Lightning',index:sparksIndex,layer:li,pass:issues.length===0,issues,rateHz:rate,exactRail,diff,gpuStatus,backend:window.__somataRenderBackend?.()||null});
        }
      }
      const newErrors=errors.slice(beforeErrors);if(newErrors.length&&!rows.some(r=>r.name==='Искры exact Lightning'))rows.push({name:'Искры exact Lightning',pass:false,issues:newErrors.map(x=>`runtime: ${x}`)});
    }finally{
      try{if(previousIndex>=0&&previousIndex<entries.length)await loadPlaylistProjectByIndex(previousIndex);}catch(_){}
      try{window.__somataSetRenderBackend?.(previousBackend);}catch(_){}
      window.removeEventListener('error',onError);window.removeEventListener('unhandledrejection',onReject);try{requestMainCanvasRender?.();}catch(_){}
    }
    const result={version:'7.3.20',backend,pass:rows.length>=3&&rows.every(r=>r.pass)&&errors.length===0,rows,errors};
    if(options.log!==false){console.group?.(`[Somata 7.3.20 reported Spiral/Sparks ${backend.toUpperCase()}] ${result.pass?'PASS':'FAIL'}`);console.table?.(rows.map(r=>({test:r.name,pass:r.pass,issues:(r.issues||[]).join('; ')})));if(errors.length)console.error(errors);console.groupEnd?.();}
    return result;
  };

  window.__somataReleaseCertification=async(options={})=>{
    const backend=String(options.backend||'cpu').toLowerCase()==='gpu'?'gpu':'cpu';
    const transitionCycles=Math.max(1,Math.min(4,Math.floor(Number(options.transitionCycles)||1)));
    const previousBackend=window.__somataRenderBackend?.().preference||'auto';
    const startedAt=performance.now(),suite={};
    let backendStatus={};
    try{
      // Hold the requested backend preference for the entire certification. Individual suites
      // restore to this same preference, so effectiveBackend below describes the renderer that
      // was actually exercised rather than the user's preference restored after the run.
      window.__somataSetRenderBackend?.(backend);
      suite.playlistStatic=window.__somataSelfTestPlaylist?.({log:false})||{pass:false,issues:['self-test unavailable']};
      suite.playlist=await window.__somataPlaylistSmokeTest?.({backend,log:false})||{pass:false,errors:['playlist smoke unavailable']};
      suite.synthetic=await window.__somataSyntheticEffectSmokeTest?.({backend,log:false})||{pass:false,errors:['synthetic smoke unavailable']};
      suite.visual=await window.__somataVisualEffectSmokeTest?.({backend,log:false})||{pass:false,errors:['visual smoke unavailable']};
      suite.variantVisual=await window.__somataPlaylistVariantVisualSmokeTest?.({backend,log:false})||{pass:false,errors:['playlist variant visual smoke unavailable']};
      suite.temporal=await window.__somataTemporalSoakSmokeTest?.({backend,frames:Math.max(2,Math.min(12,Math.floor(Number(options.soakFrames)||5))),cycles:Math.max(1,Math.min(3,Math.floor(Number(options.soakCycles)||1))),log:false})||{pass:false,errors:['temporal soak unavailable']};
      suite.branchCoverage=await window.__somataPlaylistBranchCoverageSmokeTest?.({backend,log:false})||{pass:false,errors:['playlist branch coverage unavailable']};
      suite.projectEffectResidency=await window.__somataProjectEffectResidencySmokeTest?.({backend,log:false})||{pass:false,errors:['project/effect residency unavailable']};
      suite.compositionInterference=await window.__somataCompositionInterferenceSmokeTest?.({backend,log:false})||{pass:false,errors:['composition interference unavailable']};
      suite.recovery=await window.__somataRecoverySoakSmokeTest?.({backend,cycles:Math.max(1,Math.min(2,Math.floor(Number(options.recoveryCycles)||1))),frames:Math.max(2,Math.min(6,Math.floor(Number(options.recoveryFrames)||3))),log:false})||{pass:false,errors:['recovery soak unavailable']};
      suite.marathon=await window.__somataPlaylistMarathonSmokeTest?.({backend,cycles:Math.max(2,Math.min(4,Math.floor(Number(options.marathonCycles)||2))),frames:Math.max(2,Math.min(3,Math.floor(Number(options.marathonFrames)||2))),log:false})||{pass:false,errors:['playlist marathon unavailable']};
      suite.resourceStability=await window.__somataResourceStabilitySoakTest?.({backend,cycles:Math.max(3,Math.min(5,Math.floor(Number(options.resourceCycles)||3))),frames:Math.max(2,Math.min(4,Math.floor(Number(options.resourceFrames)||2))),log:false})||{pass:false,errors:['resource stability soak unavailable']};
      suite.reportedSpiralSparks=await window.__somataReportedSpiralSparksSmokeTest?.({backend,log:false})||{pass:false,errors:['reported Spiral/Sparks regression smoke unavailable']};
      suite.persistence=await window.__somataProjectPersistenceSmokeTest?.({log:false})||{pass:false,errors:['project persistence unavailable']};
      suite.finalCompositor=await window.__somataFinalCompositorSmokeTest?.({log:false})||{pass:false,errors:['final compositor smoke unavailable']};
      suite.ui=await window.__somataUiInvalidationSmokeTest?.({log:false})||{pass:false,errors:['UI smoke unavailable']};
      suite.controls=await window.__somataControlContractSmokeTest?.({log:false})||{pass:false,errors:['control smoke unavailable']};
      suite.repeatToggles=await window.__somataRepeatToggleSmokeTest?.({log:false})||{pass:false,errors:['repeat toggle smoke unavailable']};
      suite.transitions=await window.__somataTransitionStressTest?.({backend,cycles:transitionCycles,log:false})||{pass:false,errors:['transition stress unavailable']};
      backendStatus=window.__somataRenderBackend?.()||{};
      const pass=Object.values(suite).every(item=>item?.pass===true);
      const result={version:'7.3.20',requestedBackend:backend,effectiveBackend:backendStatus.effective||null,webgpuSupported:backendStatus.webgpuSupported===true,hardwareGpuExercised:backend==='gpu'&&backendStatus.effective==='gpu',fallbackReason:backendStatus.fallbackReason||'',transitionCycles,pass,durationMs:Math.round((performance.now()-startedAt)*10)/10,suite};
      window.__somataLastCertification=result;
      if(options.log!==false){console.group?.(`[Somata 7.3.20 release certification ${backend.toUpperCase()}] ${pass?'PASS':'FAIL'}`);console.table?.(Object.entries(suite).map(([name,value])=>({test:name,pass:value?.pass===true})));console.log(result);console.groupEnd?.();}
      return result;
    }finally{
      try{window.__somataSetRenderBackend?.(previousBackend);}catch(_){}
      const select=document.getElementById('renderBackendPreference');if(select)select.value=previousBackend;
      try{requestMainCanvasRender?.();}catch(_){}
    }
  };

  function bindCertificationControls(){
    const cpuBtn=document.getElementById('btnSelfTestCpu'),gpuBtn=document.getElementById('btnSelfTestGpu'),status=document.getElementById('selfTestStatus');
    if(!cpuBtn||!gpuBtn||!status)return;
    const run=async backend=>{
      cpuBtn.disabled=true;gpuBtn.disabled=true;status.classList.remove('pass','fail');status.textContent=`Проверка ${backend.toUpperCase()}…`;
      try{
        const result=await window.__somataReleaseCertification({backend,transitionCycles:1,log:true});
        status.classList.add(result.pass?'pass':'fail');
        const fallback=result.requestedBackend==='gpu'&&!result.hardwareGpuExercised?' · CPU fallback (WebGPU недоступен)':'';
        status.textContent=`${result.pass?'PASS':'FAIL'} · ${result.durationMs} ms${fallback}`;
      }catch(err){status.classList.add('fail');status.textContent=`FAIL · ${String(err?.message||err)}`;console.error('[Somata certification]',err);}
      finally{cpuBtn.disabled=false;gpuBtn.disabled=false;}
    };
    cpuBtn.addEventListener('click',()=>run('cpu'));
    gpuBtn.addEventListener('click',()=>run('gpu'));
  }
  bindCertificationControls();

})();
