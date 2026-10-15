const fs=require('fs');
const path=require('path');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(c,m)=>{if(!c)throw new Error(m);};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function main(){
  const h=await createBrowserHarness({disableGpu:true,evalTimeoutMs:20000,loadDelayMs:300});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const css=fs.readFileSync(path.join(h.ROOT,'styles/app.css'),'utf8');
    await h.evaluate(`(()=>{const s=document.createElement('style');s.textContent=${JSON.stringify(css)};document.head.appendChild(s);return true})()`);
    await h.call('Emulation.setUserAgentOverride',{userAgent:'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36'});
    await h.call('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
    const setup=await h.evaluate(`(()=>{
      for(const n of ['morph','morph-owner','morph-arm','morph-cycle-boundary','minimalMorph','project-morph','sweep','particles','gpu-path-fx','motion','tunnel','spiral-dpr-stress'])try{animationScheduler.remove(n)}catch(_){}
      const l=createLayer('spiral-dpr-stress');l.N=23;l.K=8;l.radius=224;l.rounding=70;l.strokeWidth=3;l.visible=true;l.lineVisible=true;l.spiralEnabled=true;l.spiralClosed=true;l.spiralOrder=3;l.spiralStepLinked=false;l.spiralStep=2.55;l.spiralTangential=true;l.spiralRoundSeams=true;l.profileMode='spline';l.profileNodes=[{x:0,y:0},{x:.18,y:.46},{x:.41,y:-.29},{x:.72,y:.33},{x:1,y:0}];l.lineProfileApplication='graffiti';l.lineProfileGraffiti='slash';l.showWeb=true;l.showLamps=true;ensureLayerEffectState(l);l.web.inside=true;l.web.outsideStraight=true;l.web.outsideArc=true;l.sweep.enabled=true;l.sweep.effectType='glint';l.sweep.profileShape='current';l.particles.enabled=true;state.layers.splice(0,state.layers.length,l);state.activeLayerId=l.id;state.showLines=true;state.showWeb=true;state.showLamps=true;state.tunnel.active=true;invalidateLayerGeometry(l,'spiral-dpr-stress');refreshLayerLookup(true);setSingleLayerSelection?.(l);syncSidebarInputs?.();
      runtimeState.morph.active=true;runtimeState.morph.paused=false;runtimeState.morph.progress=.17;runtimeState.morph.geometryT=.17;runtimeState.morph.frameLayers=[{...l,id:l.id,N:27,K:10,rotation:31,radius:241}];
      animationScheduler.add('spiral-dpr-stress',()=>{runtimeState.morph.progress=(runtimeState.morph.progress+.013)%1;runtimeState.morph.geometryT=runtimeState.morph.progress;requestMainCanvasRender();return true;});requestMainCanvasRender();return{id:l.id};
    })()`);
    assert(setup?.id,'failed to prepare Spiral DPR scene');
    const cases=[
      [320,568,1],[568,320,1.5],[390,844,2],[844,390,3],[412,915,4],[915,412,5]
    ];
    const samples=[];
    for(let i=0;i<cases.length;i++){
      const [width,height,dpr]=cases[i];
      await h.call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:dpr,mobile:true,screenWidth:width,screenHeight:height});
      await h.evaluate(`window.dispatchEvent(new Event('orientationchange'));window.dispatchEvent(new Event('resize'));`);
      await sleep(160);
      const r=await h.evaluate(`(async()=>{
        const l=state.layers.find(x=>x.id===${JSON.stringify(setup.id)});l.spiralClosed=${i%2===0};invalidateLayerGeometry(l,'dpr-cycle');runtimeState.morph.frameLayers=[{...l,id:l.id,N:${i%2?29:25},K:${i%2?11:9},rotation:${i*23},radius:${225+i*4}}];requestMainCanvasRender();await new Promise(r=>setTimeout(r,100));
        beginFrameGeometryRuntime();const c=acquireLayerFrameEffectContext(0);c.layer=l;c.effectLayer=l;c.sourceLayer=l;c.staticDrawData=getCachedLayerDrawData(l);c.canonicalGeometry=getCanonicalLayerGeometry(l);c.now=performance.now();c.frame.now=c.now;c.frame.id=c.frameId;c.frame.dpr=devicePixelRatio||1;c.strokeWidth=3;c.baseAlpha=1;c.lineAlpha=1;c.lineDisplayEnabled=true;c.visibleInstances=prepareTunnelVisibleInstances(getTunnelCopies(),225,1,Math.max(innerWidth,innerHeight),1,l.id,c.now);c.layerSweep=getLayerSweepConfig(l);const w=prepareLayerFrameWebData(c),s=prepareLayerFrameSweepData(c),stats=__spiroAnimationStats();const rec=createGeometryGLRecordingContext(mainCtx);drawWebThreadsAnimated(rec,w.paths,l,1,w,true,'inside');
        const rect=mainCanvas.getBoundingClientRect(),bx=mainCanvas.width/Math.max(1,rect.width),by=mainCanvas.height/Math.max(1,rect.height);return{inner:[innerWidth,innerHeight],dpr:devicePixelRatio,canvas:[mainCanvas.width,mainCanvas.height],css:[rect.width,rect.height],backing:[bx,by],web:rec.commands?.length||0,sweep:!!s.prepared,copies:c.visibleInstances?.copies?.length||0,progress:runtimeState.morph.progress,frames:stats.frameCount,inFrame:stats.inFrame,paintErrors:stats.paintErrors||0};
      })()`,{timeoutMs:7000,label:'Spiral DPR budget sample'});
      samples.push(r);
      assert(r.web>0&&r.sweep&&r.copies>0,`case ${i} lost render plan: ${JSON.stringify(r)}`);
      assert(r.backing.every(v=>Number.isFinite(v)&&v>=.95&&v<=2.05),`case ${i} backing-store scale escaped mobile budget: ${JSON.stringify(r)}`);
      assert(r.paintErrors===0&&!r.inFrame,`case ${i} unhealthy scheduler/render state: ${JSON.stringify(r)}`);
    }
    const spread=Math.max(...samples.map(x=>x.progress))-Math.min(...samples.map(x=>x.progress));assert(spread>.02,'Morph did not progress across DPR/viewport stress');
    const done=await h.evaluate(`(()=>{animationScheduler.remove('spiral-dpr-stress');runtimeState.morph.active=false;state.tunnel.active=false;const s=__spiroAnimationStats();return{frames:s.frameCount,inFrame:s.inFrame,paintErrors:s.paintErrors||0};})()`);assert(!done.inFrame&&done.paintErrors===0,'scheduler unhealthy after DPR stress');
    const exc=uncaughtExceptions(h.events).slice(baseline);assert(exc.length===0,'uncaught browser exceptions: '+exc.join(' | '));
    console.log('SPIRAL + MOBILE DPR BUDGET STRESS: PASS',{cases:samples.length,spread,first:samples[0],last:samples.at(-1),done});
  }finally{await h.close();}
}
main().catch(e=>{console.error('FAIL Spiral/mobile DPR budget stress:',e.stack||e.message);process.exit(1)});
