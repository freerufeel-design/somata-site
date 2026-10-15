const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(c,m)=>{if(!c)throw new Error(m);};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function main(){
  const h=await createBrowserHarness({disableGpu:true,evalTimeoutMs:20000,loadDelayMs:300});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    await h.call('Emulation.setUserAgentOverride',{userAgent:'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36'});
    await h.call('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
    const setup=await h.evaluate(`(()=>{
      for(const n of ['morph','morph-owner','morph-arm','morph-cycle-boundary','minimalMorph','project-morph','sweep','particles','gpu-path-fx','motion','tunnel','orientation-stress'])try{animationScheduler.remove(n)}catch(_){}
      const l=createLayer('orientation-stress');l.N=17;l.K=5;l.customSuborbits=1;l.radius=220;l.rounding=68;l.strokeWidth=3;l.visible=true;l.lineVisible=true;l.spiralEnabled=true;l.spiralClosed=true;l.spiralOrder=3;l.spiralStepLinked=false;l.spiralStep=2.6;l.spiralTangential=true;l.spiralRoundSeams=true;l.profileMode='spline';l.profileNodes=[{x:0,y:0},{x:.16,y:.48},{x:.38,y:-.28},{x:.71,y:.34},{x:1,y:0}];l.lineProfileApplication='graffiti';l.lineProfileGraffiti='slash';l.graffitiNibLength=12;l.graffitiSizeVariationEnabled=true;l.graffitiSizeVariation=35;l.showWeb=true;l.showLamps=true;ensureLayerEffectState(l);l.web.inside=true;l.web.outsideStraight=true;l.web.outsideArc=true;l.sweep.enabled=true;l.sweep.effectType='glint';l.sweep.profileShape='current';l.particles.enabled=true;state.layers.splice(0,state.layers.length,l);state.activeLayerId=l.id;state.showLines=true;state.showWeb=true;state.showLamps=true;state.tunnel.active=true;invalidateLayerGeometry(l,'orientation-stress');refreshLayerLookup(true);setSingleLayerSelection?.(l);syncSidebarInputs?.();
      const modeSel=document.getElementById('morphModeTop');modeSel.value='topology';modeSel.dispatchEvent(new Event('change',{bubbles:true}));
      const interval=document.getElementById('morphInterval');interval.value='1';interval.dispatchEvent(new Event('input',{bubbles:true}));interval.dispatchEvent(new Event('change',{bubbles:true}));
      for(const id of ['morphByVertices','morphBySteps','morphByShape','morphByRounding','morphBySize']){const e=document.getElementById(id);if(e&&!e.checked){e.checked=true;e.dispatchEvent(new Event('change',{bubbles:true}));}}
      document.getElementById('btnMorph').click();requestMainCanvasRender();return{ok:true,id:l.id};
    })()`);
    assert(setup.ok,'failed to prepare combined Spiral scene');
    const samples=[];
    for(let i=0;i<12;i++){
      const landscape=i%2===1,width=landscape?844:390,height=landscape?390:844;
      await h.call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:3,mobile:true,screenWidth:width,screenHeight:height});
      await h.evaluate(`window.dispatchEvent(new Event('orientationchange'));window.dispatchEvent(new Event('resize'));`);
      await sleep(150);
      const mode=i%3===0?'spiral-closed':(i%3===1?'spiral-open':'spiral-closed');
      const r=await h.evaluate(`(async()=>{
        const btn=document.querySelector('[data-contour-mode=${JSON.stringify(mode)}]');btn?.click();
        const l=state.layers.find(x=>x.id===${JSON.stringify(setup.id)});
        l.web.inside=true;l.web.outsideStraight=true;l.web.outsideArc=true;l.showWeb=true;l.showLamps=true;l.sweep.enabled=true;l.particles.enabled=true;state.tunnel.active=true;invalidateLayerGeometry(l,'orientation-cycle');
        requestMainCanvasRender();await new Promise(r=>setTimeout(r,70));
        const morph0=Number(runtimeState.morph.progress)||0;const phase0=Number(runtimeState.morph.phaseSerial)||0;
        await new Promise(r=>setTimeout(r,90));const morph1=Number(runtimeState.morph.progress)||0;
        beginFrameGeometryRuntime();const c=acquireLayerFrameEffectContext(0);c.layer=l;c.effectLayer=l;c.sourceLayer=l;c.staticDrawData=getCachedLayerDrawData(l);c.canonicalGeometry=getCanonicalLayerGeometry(l);c.now=performance.now();c.frame.now=c.now;c.frame.dpr=devicePixelRatio||1;c.frame.id=c.frameId;c.strokeWidth=3;c.baseAlpha=1;c.lineAlpha=1;c.lineDisplayEnabled=true;c.visibleInstances=prepareTunnelVisibleInstances(getTunnelCopies(),220,1,Math.max(innerWidth,innerHeight),1,l.id,c.now);c.layerSweep=getLayerSweepConfig(l);
        const p=prepareLayerFrameProfileData(c),w=prepareLayerFrameWebData(c),s=prepareLayerFrameSweepData(c),paths=w.visualPaths||w.paths||[];
        let rec=createGeometryGLRecordingContext(mainCtx);drawWebThreadsAnimated(rec,w.paths,l,1,w,true,'inside');
        if(!(rec.commands?.length)){await new Promise(r=>setTimeout(r,75));w.now=performance.now();rec=createGeometryGLRecordingContext(mainCtx);drawWebThreadsAnimated(rec,w.paths,l,1,w,true,'inside');}
        const stats=__spiroAnimationStats();const vals=[];for(const cmd of rec.commands||[])for(const k of ['x','y','x1','y1','x2','y2','lineWidth','alpha']){const v=Number(cmd?.[k]);if(Number.isFinite(v))vals.push(v);}
        return{mode:${JSON.stringify(mode)},inner:[innerWidth,innerHeight],mobile:matchMedia('(max-width: 760px), (max-height: 480px) and (hover: none) and (pointer: coarse)').matches,profile:!!p.gpuRibbonEligible,webEnabled:!!w.enabled,webCommands:rec.commands?.length||0,webPaths:paths.reduce((n,x)=>n+(x?.points?.length||0),0),sweep:!!s.prepared,copies:c.visibleInstances?.copies?.length||0,morph:morph1,morph0,morph1,phase0,active:runtimeState.morph.active===true,hasMorph:animationScheduler.has('morph'),frames:stats.frameCount,paintErrors:stats.paintErrors||0,inFrame:stats.inFrame,finite:vals.every(Number.isFinite)};
      })()`,{timeoutMs:6000,label:'orientation stress sample'});
      samples.push(r);
      assert(r.mobile,`cycle ${i} ${width}x${height} is not in mobile layout`);
      assert(r.profile&&r.webEnabled&&r.webCommands>0&&r.webPaths>0&&r.sweep&&r.copies>0,`cycle ${i} lost combined render plan: ${JSON.stringify(r)}`);
      assert(r.active&&r.hasMorph,`cycle ${i} lost real Morph scheduler ownership: ${JSON.stringify(r)}`);
      const morphStep=(r.morph1>=r.morph0)?(r.morph1-r.morph0):(1-r.morph0+r.morph1);assert(morphStep>.01,`cycle ${i} real Morph progress stalled ${r.morph0}->${r.morph1}`);
      assert(r.finite&&r.paintErrors===0&&!r.inFrame,`cycle ${i} produced non-finite/error/stuck frame: ${JSON.stringify(r)}`);
    }
    const done=await h.evaluate(`(async()=>{const p0=runtimeState.morph.progress;await new Promise(r=>setTimeout(r,60));const p1=runtimeState.morph.progress;const s=__spiroAnimationStats();if(runtimeState.morph.active)document.getElementById('btnMorph').click();state.tunnel.active=false;return{p0,p1,frames:s.frameCount,inFrame:s.inFrame,paintErrors:s.paintErrors||0};})()`);
    assert(!done.inFrame&&done.paintErrors===0,'final scheduler/render error after orientation stress');
    const progressSpread=Math.max(...samples.map(x=>x.morph))-Math.min(...samples.map(x=>x.morph));
    assert(samples.every(x=>x.active&&x.hasMorph),'real Morph did not remain active through orientation stress');
    const frameSpread=samples.at(-1).frames-samples[0].frames;assert(frameSpread>8,'frames did not continue through orientation stress');
    const exc=uncaughtExceptions(h.events).slice(baseline);assert(exc.length===0,'uncaught browser exceptions: '+exc.join(' | '));
    console.log('SPIRAL + MOBILE ORIENTATION COMBINED STRESS: PASS',{cycles:samples.length,progressSpread,frameSpread,first:samples[0],last:samples.at(-1)});
  }finally{await h.close();}
}
main().catch(e=>{console.error('FAIL Spiral/mobile orientation stress:',e.stack||e.message);process.exit(1)});
