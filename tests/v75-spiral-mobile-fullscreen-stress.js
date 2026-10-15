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
    await h.call('Emulation.setUserAgentOverride',{userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1'});
    await h.call('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
    await h.call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:3,mobile:true,screenWidth:390,screenHeight:844});
    const setup=await h.evaluate(`(()=>{
      for(const n of ['morph','morph-owner','morph-arm','morph-cycle-boundary','minimalMorph','project-morph','sweep','particles','gpu-path-fx','motion','tunnel','spiral-fullscreen-stress'])try{animationScheduler.remove(n)}catch(_){}
      const l=createLayer('spiral-fullscreen-stress');l.N=19;l.K=7;l.radius=214;l.rounding=66;l.strokeWidth=3;l.visible=true;l.lineVisible=true;l.spiralEnabled=true;l.spiralClosed=true;l.spiralOrder=3;l.spiralStepLinked=false;l.spiralStep=2.35;l.spiralTangential=true;l.spiralRoundSeams=true;l.profileMode='spline';l.profileNodes=[{x:0,y:0},{x:.2,y:.44},{x:.43,y:-.3},{x:.75,y:.31},{x:1,y:0}];l.lineProfileApplication='graffiti';l.lineProfileGraffiti='slash';l.showWeb=true;l.showLamps=true;ensureLayerEffectState(l);l.web.inside=true;l.web.outsideStraight=true;l.web.outsideArc=true;l.sweep.enabled=true;l.sweep.effectType='glint';l.sweep.profileShape='current';l.particles.enabled=true;state.layers.splice(0,state.layers.length,l);state.activeLayerId=l.id;state.showLines=true;state.showWeb=true;state.showLamps=true;state.tunnel.active=true;state.panX=37;state.panY=-19;invalidateLayerGeometry(l,'spiral-fullscreen-stress');refreshLayerLookup(true);setSingleLayerSelection?.(l);syncSidebarInputs?.();
      runtimeState.morph.active=true;runtimeState.morph.paused=false;runtimeState.morph.progress=.23;runtimeState.morph.geometryT=.23;runtimeState.morph.frameLayers=[{...l,id:l.id,N:23,K:8,rotation:29,radius:232}];
      animationScheduler.add('spiral-fullscreen-stress',()=>{runtimeState.morph.progress=(runtimeState.morph.progress+.011)%1;runtimeState.morph.geometryT=runtimeState.morph.progress;requestMainCanvasRender();return true;});requestMainCanvasRender();return{id:l.id};
    })()`);
    assert(setup?.id,'failed to prepare Spiral fullscreen scene');
    await sleep(120);
    const entered=await h.evaluate(`(async()=>{document.getElementById('btnMobileFullscreen').click();await new Promise(r=>setTimeout(r,100));return{active:document.documentElement.classList.contains('app-pseudo-fullscreen')||!!getNativeAppFullscreenElement(),pseudo:document.documentElement.classList.contains('app-pseudo-fullscreen'),pan:[state.panX,state.panY],progress:runtimeState.morph.progress};})()`);
    assert(entered.active,'real mobile fullscreen button did not enter a fullscreen presentation path');
    if(entered.pseudo)assert(entered.pan[0]===0&&entered.pan[1]===0,`pseudo fullscreen did not center the view: ${JSON.stringify(entered)}`);

    const samples=[];
    for(let i=0;i<6;i++){
      const landscape=i%2===1,w=landscape?844:390,hgt=landscape?390:844;
      await h.call('Emulation.setDeviceMetricsOverride',{width:w,height:hgt,deviceScaleFactor:i%3===0?2:i%3===1?3:2.5,mobile:true,screenWidth:w,screenHeight:hgt});
      await h.evaluate(`window.dispatchEvent(new Event('orientationchange'));window.dispatchEvent(new Event('resize'));`);
      await sleep(130);
      const r=await h.evaluate(`(async()=>{
        const l=state.layers.find(x=>x.id===${JSON.stringify(setup.id)});l.spiralClosed=${i%2===0};invalidateLayerGeometry(l,'fullscreen-orientation');runtimeState.morph.frameLayers=[{...l,id:l.id,N:${i%2?25:21},K:${i%2?9:8},rotation:${i*19},radius:${220+i*3}}];requestMainCanvasRender();await new Promise(r=>setTimeout(r,90));
        beginFrameGeometryRuntime();const c=acquireLayerFrameEffectContext(0);c.layer=l;c.effectLayer=l;c.sourceLayer=l;c.staticDrawData=getCachedLayerDrawData(l);c.canonicalGeometry=getCanonicalLayerGeometry(l);c.now=performance.now();c.frame.now=c.now;c.frame.dpr=devicePixelRatio||1;c.strokeWidth=3;c.baseAlpha=1;c.lineAlpha=1;c.lineDisplayEnabled=true;c.visibleInstances=prepareTunnelVisibleInstances(getTunnelCopies(),220,1,Math.max(innerWidth,innerHeight),1,l.id,c.now);c.layerSweep=getLayerSweepConfig(l);const w=prepareLayerFrameWebData(c),s=prepareLayerFrameSweepData(c),stats=__spiroAnimationStats();const rec=createGeometryGLRecordingContext(mainCtx);drawWebThreadsAnimated(rec,w.paths,l,1,w,true,'inside');
        return{inner:[innerWidth,innerHeight],dpr:devicePixelRatio,canvas:[mainCanvas.width,mainCanvas.height],web:rec.commands?.length||0,sweep:!!s.prepared,copies:c.visibleInstances?.copies?.length||0,progress:runtimeState.morph.progress,frames:stats.frameCount,inFrame:stats.inFrame,paintErrors:stats.paintErrors||0,pseudo:document.documentElement.classList.contains('app-pseudo-fullscreen')};
      })()`,{timeoutMs:6000,label:'fullscreen Spiral sample'});
      samples.push(r);
      assert(r.web>0&&r.sweep&&r.copies>0,`cycle ${i} lost Spiral/effect render plan: ${JSON.stringify(r)}`);
      const backingX=r.canvas[0]/Math.max(1,r.inner[0]),backingY=r.canvas[1]/Math.max(1,r.inner[1]);
      assert(Number.isFinite(backingX)&&Number.isFinite(backingY)&&backingX>=1&&backingY>=1&&backingX<=2.05&&backingY<=2.05,`cycle ${i} produced an unsafe mobile backing-store scale: ${JSON.stringify(r)}`);
      assert(!r.inFrame&&r.paintErrors===0,`cycle ${i} left unhealthy scheduler: ${JSON.stringify(r)}`);
    }
    const exit=await h.evaluate(`(async()=>{const p0=runtimeState.morph.progress;document.getElementById('btnPseudoFullscreenExit')?.click();if(getNativeAppFullscreenElement())try{await document.exitFullscreen?.();}catch(_){}await new Promise(r=>setTimeout(r,100));const stats=__spiroAnimationStats();animationScheduler.remove('spiral-fullscreen-stress');runtimeState.morph.active=false;state.tunnel.active=false;return{active:document.documentElement.classList.contains('app-pseudo-fullscreen')||!!getNativeAppFullscreenElement(),pan:[state.panX,state.panY],p0,p1:runtimeState.morph.progress,inFrame:stats.inFrame,paintErrors:stats.paintErrors||0};})()`);
    assert(!exit.active,'fullscreen path did not exit');
    if(entered.pseudo)assert(exit.pan[0]===37&&exit.pan[1]===-19,`pseudo fullscreen did not restore pre-fullscreen pan: ${JSON.stringify(exit)}`);
    assert(!exit.inFrame&&exit.paintErrors===0,'scheduler unhealthy after fullscreen stress');
    const progressSpread=Math.max(...samples.map(x=>x.progress))-Math.min(...samples.map(x=>x.progress));assert(progressSpread>.02,'Morph did not advance during fullscreen/orientation stress');
    const exc=uncaughtExceptions(h.events).slice(baseline);assert(exc.length===0,'uncaught browser exceptions: '+exc.join(' | '));
    console.log('SPIRAL + MOBILE FULLSCREEN STRESS: PASS',{cycles:samples.length,progressSpread,entered,first:samples[0],last:samples.at(-1),exit});
  }finally{await h.close();}
}
main().catch(e=>{console.error('FAIL Spiral/mobile fullscreen stress:',e.stack||e.message);process.exit(1)});
