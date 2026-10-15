const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(c,m)=>{if(!c)throw new Error(m);};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function main(){
  const h=await createBrowserHarness({disableGpu:true,evalTimeoutMs:20000,loadDelayMs:300});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    await h.call('Emulation.setUserAgentOverride',{userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1'});
    await h.call('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
    await h.call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:3,mobile:true,screenWidth:390,screenHeight:844});
    const setup=await h.evaluate(`(()=>{
      for(const n of ['morph','morph-owner','morph-arm','morph-cycle-boundary','minimalMorph','project-morph','sweep','particles','gpu-path-fx','motion','tunnel','spiral-fault-recovery'])try{animationScheduler.remove(n)}catch(_){}
      const l=createLayer('spiral-fault-recovery');l.N=19;l.K=7;l.customSuborbits=1;l.radius=218;l.rounding=62;l.strokeWidth=3;l.visible=true;l.lineVisible=true;l.spiralEnabled=true;l.spiralClosed=true;l.spiralOrder=3;l.spiralStepLinked=false;l.spiralStep=2.45;l.spiralTangential=true;l.spiralRoundSeams=true;l.profileMode='spline';l.profileNodes=[{x:0,y:0},{x:.16,y:.42},{x:.42,y:-.32},{x:.73,y:.29},{x:1,y:0}];l.lineProfileApplication='graffiti';l.lineProfileGraffiti='slash';l.graffitiNibLength=11;l.showWeb=true;l.showLamps=true;ensureLayerEffectState(l);l.web.inside=true;l.web.outsideStraight=true;l.web.outsideArc=true;l.sweep.enabled=true;l.sweep.effectType='glint';l.sweep.profileShape='current';l.particles.enabled=true;state.layers.splice(0,state.layers.length,l);state.activeLayerId=l.id;state.showLines=true;state.showWeb=true;state.showLamps=true;state.tunnel.active=true;invalidateLayerGeometry(l,'spiral-fault-recovery');refreshLayerLookup(true);setSingleLayerSelection?.(l);syncSidebarInputs?.();
      runtimeState.morph.active=true;runtimeState.morph.paused=false;runtimeState.morph.exactStartPending=false;runtimeState.morph.progress=.17;runtimeState.morph.geometryT=.17;runtimeState.morph.frameLayers=[{...l,id:l.id,N:23,K:8,rotation:27,radius:234}];
      animationScheduler.add('spiral-fault-recovery',()=>{runtimeState.morph.progress=(runtimeState.morph.progress+.01)%1;runtimeState.morph.geometryT=runtimeState.morph.progress;requestMainCanvasRender();return true;});requestMainCanvasRender();return{id:l.id};
    })()`);
    assert(setup?.id,'failed to prepare Spiral fault-recovery scene');
    await sleep(180);
    const passes=['renderLayerWebPass','renderLayerLampPass','renderLayerSweepPass','renderLayerParticlePass','renderLayerBaseGeometryPass'];
    const samples=[];
    for(let i=0;i<passes.length;i++){
      if(i===2){await h.call('Emulation.setDeviceMetricsOverride',{width:844,height:390,deviceScaleFactor:3,mobile:true,screenWidth:844,screenHeight:390});await h.evaluate(`window.dispatchEvent(new Event('orientationchange'));window.dispatchEvent(new Event('resize'));`);await sleep(120);}
      const name=passes[i];
      const r=await h.evaluate(`(async()=>{
        const key=${JSON.stringify(name)},orig=globalThis[key];if(typeof orig!=='function')return{error:'missing '+key};let thrown=false;globalThis[key]=function(...args){if(!thrown){thrown=true;throw new Error('intentional '+key+' fault');}return orig.apply(this,args);};
        const beforePass=__spiroPassIsolationStatus().failures,before=__spiroAnimationStats(),p0=runtimeState.morph.progress;requestMainCanvasRender();await new Promise(r=>setTimeout(r,180));globalThis[key]=orig;requestMainCanvasRender();await new Promise(r=>setTimeout(r,120));
        const afterPass=__spiroPassIsolationStatus(),after=__spiroAnimationStats(),l=state.layers.find(x=>x.id===${JSON.stringify(setup.id)});beginFrameGeometryRuntime();const c=acquireLayerFrameEffectContext(0);c.layer=l;c.effectLayer=l;c.sourceLayer=l;c.staticDrawData=getCachedLayerDrawData(l);c.canonicalGeometry=getCanonicalLayerGeometry(l);c.now=performance.now();c.frame.now=c.now;c.frame.dpr=devicePixelRatio||1;c.strokeWidth=3;c.baseAlpha=1;c.lineAlpha=1;c.lineDisplayEnabled=true;c.visibleInstances=prepareTunnelVisibleInstances(getTunnelCopies(),220,1,Math.max(innerWidth,innerHeight),1,l.id,c.now);c.layerSweep=getLayerSweepConfig(l);const w=prepareLayerFrameWebData(c),s=prepareLayerFrameSweepData(c);return{key,thrown,passDelta:afterPass.failures-beforePass,frameDelta:after.frameCount-before.frameCount,paintDelta:after.paintCount-before.paintCount,p0,p1:runtimeState.morph.progress,inFrame:after.inFrame,paintErrors:after.paintErrors||0,web:!!w.enabled&&(w.paths?.length||0)>0,sweep:!!s.prepared,copies:c.visibleInstances?.copies?.length||0,inner:[innerWidth,innerHeight]};
      })()`,{timeoutMs:6000,label:'fault '+name});
      samples.push(r);
      assert(!r.error,`${name}: ${r.error}`);assert(r.thrown,`${name}: injected fault never executed`);assert(r.passDelta>=1,`${name}: pass isolation did not record failure: ${JSON.stringify(r)}`);assert(r.frameDelta>0&&r.paintDelta>0,`${name}: frames/paints stopped after fault: ${JSON.stringify(r)}`);assert(r.p1!==r.p0,`${name}: Morph progress stopped after fault`);assert(!r.inFrame&&r.paintErrors===0,`${name}: scheduler/render state unhealthy: ${JSON.stringify(r)}`);assert(r.web&&r.sweep&&r.copies>0,`${name}: combined Spiral effect plan did not recover: ${JSON.stringify(r)}`);
    }
    const done=await h.evaluate(`(async()=>{animationScheduler.remove('spiral-fault-recovery');runtimeState.morph.active=false;state.tunnel.active=false;await new Promise(r=>setTimeout(r,60));const s=__spiroAnimationStats();return{inFrame:s.inFrame,paintErrors:s.paintErrors||0,frames:s.frameCount};})()`);assert(!done.inFrame&&done.paintErrors===0,'final scheduler state unhealthy');
    const exc=uncaughtExceptions(h.events).slice(baseline);assert(exc.length===0,'uncaught browser exceptions: '+exc.join(' | '));
    console.log('SPIRAL + EFFECT FAULT RECOVERY: PASS',{passes:samples.map(x=>({key:x.key,passDelta:x.passDelta,frameDelta:x.frameDelta,paintDelta:x.paintDelta,inner:x.inner})),done});
  }finally{await h.close();}
}
main().catch(e=>{console.error('FAIL Spiral/effect fault recovery:',e.stack||e.message);process.exit(1)});
