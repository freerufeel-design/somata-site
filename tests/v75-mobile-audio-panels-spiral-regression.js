const fs=require('fs');
const path=require('path');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(c,m)=>{if(!c)throw new Error(m);};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function main(){
  const h=await createBrowserHarness({disableGpu:true,evalTimeoutMs:16000,loadDelayMs:300});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const css=fs.readFileSync(path.join(h.ROOT,'styles/app.css'),'utf8');
    await h.evaluate(`(()=>{const s=document.createElement('style');s.textContent=${JSON.stringify(css)};document.head.appendChild(s);return true})()`);
    await h.call('Emulation.setUserAgentOverride',{userAgent:'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36'});
    await h.call('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
    await h.call('Emulation.setDeviceMetricsOverride',{width:844,height:390,deviceScaleFactor:3,mobile:true,screenWidth:844,screenHeight:390});
    await sleep(280);

    const setup=await h.evaluate(`(()=>{
      for(const n of ['morph','morph-owner','morph-arm','morph-cycle-boundary','mobile-audio-panel-spiral'])try{animationScheduler.remove(n)}catch(_){}
      const l=createLayer('mobile-audio-panel-spiral');l.N=17;l.K=5;l.radius=220;l.rounding=62;l.strokeWidth=3;l.visible=true;l.lineVisible=true;l.spiralEnabled=true;l.spiralClosed=true;l.spiralOrder=3;l.spiralStepLinked=false;l.spiralStep=2.4;l.spiralTangential=true;l.spiralRoundSeams=true;l.profileMode='spline';l.profileNodes=[{x:0,y:0},{x:.2,y:.44},{x:.48,y:-.22},{x:.76,y:.31},{x:1,y:0}];l.showWeb=true;ensureLayerEffectState(l);l.web.inside=true;l.web.outsideStraight=true;l.web.outsideArc=true;state.layers.splice(0,state.layers.length,l);state.activeLayerId=l.id;state.showLines=true;state.showWeb=true;invalidateLayerGeometry(l,'mobile-audio-panel-spiral');refreshLayerLookup(true);setSingleLayerSelection?.(l);syncSidebarInputs?.();
      runtimeState.morph.active=true;runtimeState.morph.paused=false;runtimeState.morph.exactStartPending=false;runtimeState.morph.progress=.19;runtimeState.morph.geometryT=.19;runtimeState.morph.frameLayers=[{...l,id:l.id,N:19,K:6,rotation:18,radius:232}];
      animationScheduler.add('mobile-audio-panel-spiral',()=>{runtimeState.morph.progress=(runtimeState.morph.progress+.011)%1;runtimeState.morph.geometryT=runtimeState.morph.progress;requestMainCanvasRender();return true;});
      requestMainCanvasRender();return{id:l.id,frames:__spiroAnimationStats().frameCount};
    })()`);

    const inspectPanel=async(triggerId,panelId,closeId)=>h.evaluate(`(async()=>{
      const trigger=document.getElementById(${JSON.stringify(triggerId)});trigger.click();await new Promise(r=>setTimeout(r,100));
      const panel=document.getElementById(${JSON.stringify(panelId)}),p=panel.getBoundingClientRect(),pc=getComputedStyle(panel),openHidden=panel.classList.contains('hidden'),openDisplay=pc.display,header=document.querySelector('header').getBoundingClientRect();
      const close=document.getElementById(${JSON.stringify(closeId)}),c=close.getBoundingClientRect(),cc=getComputedStyle(close),cx=c.left+c.width/2,cy=c.top+c.height/2,hit=document.elementFromPoint(cx,cy);
      const stats0=__spiroAnimationStats();const p0=runtimeState.morph.progress;await new Promise(r=>setTimeout(r,90));const stats1=__spiroAnimationStats();
      close.click();await new Promise(r=>setTimeout(r,60));
      return {inner:[innerWidth,innerHeight],mobile:matchMedia('(max-width: 760px), (max-height: 480px) and (hover: none) and (pointer: coarse)').matches,panel:{hidden:openHidden,display:openDisplay,left:p.left,top:p.top,right:p.right,bottom:p.bottom,w:p.width,h:p.height,belowHeader:p.top>=header.bottom-1,inside:p.left>=-1&&p.top>=-1&&p.right<=innerWidth+1&&p.bottom<=innerHeight+1},header:{bottom:header.bottom,h:header.height},close:{display:cc.display,w:c.width,h:c.height,inside:c.left>=0&&c.top>=0&&c.right<=innerWidth&&c.bottom<=innerHeight,hit:hit===close||close.contains(hit)},frames:stats1.frameCount-stats0.frameCount,p0,p1:runtimeState.morph.progress,closed:panel.classList.contains('hidden')};
    })()`);

    const reactive=await inspectPanel('btnMobileMic','audioReactivePanel','btnCloseAudioPanel');
    const routing=await inspectPanel('btnMobileAudioRouting','audioRoutingPanel','btnCloseAudioRouting');
    for(const [name,r] of [['reactive',reactive],['routing',routing]]){
      assert(r.mobile,`${name} probe is not in mobile landscape contract`);
      assert(r.panel.display!=='none'&&r.panel.inside,`${name} panel is outside mobile landscape viewport: ${JSON.stringify(r)}`);
      assert(r.panel.belowHeader,`${name} panel overlaps mobile header: top=${r.panel.top}, headerBottom=${r.header.bottom}`);
      assert(r.close.display!=='none'&&r.close.w>=44&&r.close.h>=44&&r.close.inside&&r.close.hit,`${name} close is not a reachable >=44x44 target: ${JSON.stringify(r.close)}`);
      assert(r.frames>0&&r.p1!==r.p0,`${name} panel stalled Spiral/Morph scheduler: ${JSON.stringify(r)}`);
      assert(r.closed,`${name} close button did not close the panel`);
    }

    const render=await h.evaluate(`(()=>{
      const l=state.layers.find(x=>x.id===${JSON.stringify(setup.id)}),stats=__spiroAnimationStats();beginFrameGeometryRuntime();const c=acquireLayerFrameEffectContext(0);c.layer=l;c.effectLayer=l;c.sourceLayer=l;c.staticDrawData=getCachedLayerDrawData(l);c.canonicalGeometry=getCanonicalLayerGeometry(l);c.now=performance.now();c.frame.now=c.now;c.frame.id=c.frameId;c.frame.dpr=devicePixelRatio||1;c.strokeWidth=3;c.baseAlpha=1;c.lineAlpha=1;c.lineDisplayEnabled=true;const w=prepareLayerFrameWebData(c),rec=createGeometryGLRecordingContext(mainCtx);drawWebThreadsAnimated(rec,w.paths,l,1,w,true,'inside');const finite=(rec.commands||[]).every(cmd=>Object.values(cmd||{}).filter(v=>typeof v==='number').every(Number.isFinite));animationScheduler.remove('mobile-audio-panel-spiral');runtimeState.morph.active=false;return{web:!!w.enabled,commands:rec.commands?.length||0,finite,inFrame:stats.inFrame,paintErrors:stats.paintErrors||0,frames:stats.frameCount};
    })()`);
    assert(render.web&&render.commands>0&&render.finite&&render.paintErrors===0&&!render.inFrame,`Spiral/Web unhealthy after mobile audio panels: ${JSON.stringify(render)}`);
    const exc=uncaughtExceptions(h.events).slice(baseline);assert(exc.length===0,'uncaught browser exceptions: '+exc.join(' | '));
    console.log('MOBILE AUDIO PANELS + SPIRAL REGRESSION: PASS',{reactive,routing,render});
  }finally{await h.close();}
}
main().catch(e=>{console.error('FAIL mobile audio panels/Spiral regression:',e.stack||e.message);process.exit(1)});
