const fs=require('fs');
const path=require('path');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(c,m)=>{if(!c)throw new Error(m);};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function touch(h,x,y){
  await h.call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1,radiusX:3,radiusY:3,force:1}]});
  await h.call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
}

async function main(){
  const h=await createBrowserHarness({disableGpu:true,evalTimeoutMs:16000,loadDelayMs:300});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const css=fs.readFileSync(path.join(h.ROOT,'styles/app.css'),'utf8');
    await h.evaluate(`(()=>{const s=document.createElement('style');s.textContent=${JSON.stringify(css)};document.head.appendChild(s);return true})()`);
    await h.call('Emulation.setUserAgentOverride',{userAgent:'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36'});
    await h.call('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});

    const layerId=await h.evaluate(`(()=>{const l=state.layers[0]||createLayer('mobile-spiral-touch');if(!state.layers.length)state.layers.push(l);state.activeLayerId=l.id;l.visible=true;l.lineVisible=true;l.N=17;l.K=5;l.radius=220;l.rounding=62;l.spiralEnabled=false;l.spiralClosed=false;l.showWeb=true;ensureLayerEffectState(l);l.web.inside=true;l.web.outsideStraight=true;l.web.outsideArc=true;state.showWeb=true;invalidateLayerGeometry(l,'mobile-spiral-touch');refreshLayerLookup(true);requestMainCanvasRender();return l.id;})()`);

    async function inspect(width,height){
      await h.call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:3,mobile:true,screenWidth:width,screenHeight:height});
      await h.evaluate(`window.dispatchEvent(new Event('orientationchange'));window.dispatchEvent(new Event('resize'));`);
      await sleep(260);
      await h.evaluate(`(async()=>{const launch=document.getElementById('btnMobileControls');if(!document.getElementById('settingsSidebar')?.classList.contains('mobile-open')) launch?.click();await new Promise(r=>requestAnimationFrame(r));const shape=document.querySelector('[data-sidebar-mode="shape"]');shape?.click();await new Promise(r=>setTimeout(r,180));__somataSelectContourMode('spiral-closed');await new Promise(r=>setTimeout(r,100));})()`);
      return h.evaluate(`(()=>{const ids=['paramSpiralOrder'];const buttons=[...document.querySelectorAll('[data-contour-family],[data-contour-variant]')].map(e=>{const b=e.getBoundingClientRect(),s=getComputedStyle(e);return{mode:e.dataset.contourFamily||e.dataset.contourVariant,w:b.width,h:b.height,display:s.display,inside:b.left>=0&&b.top>=0&&b.right<=innerWidth+1&&b.bottom<=innerHeight+1};});const fields=ids.map(id=>{const e=document.getElementById(id),b=e.getBoundingClientRect(),s=getComputedStyle(e);return{id,w:b.width,h:b.height,display:s.display};});const labels=[...document.querySelectorAll('#spiralSettingsBlock .spiral-step-link,#spiralSettingsBlock .spiral-tangent-toggle,#spiralSettingsBlock .spiral-seam-round-toggle,#spiralSettingsBlock .spiral-fill-toggle')].map(e=>{const b=e.getBoundingClientRect(),s=getComputedStyle(e);return{cls:e.className,w:b.width,h:b.height,display:s.display};});const spiralBtn=document.querySelector('[data-contour-family="spiral"]'),b=spiralBtn.getBoundingClientRect();return{mobile:matchMedia('(max-width: 760px), (max-height: 480px) and (hover: none) and (pointer: coarse)').matches,buttons,fields,labels,target:{x:b.left+b.width/2,y:b.top+b.height/2,w:b.width,h:b.height,inside:b.left>=0&&b.top>=0&&b.right<=innerWidth+1&&b.bottom<=innerHeight+1}};})()`);
    }

    const portrait=await inspect(390,844);
    const landscape=await inspect(844,390);
    for(const [name,s] of [['portrait',portrait],['landscape',landscape]]){
      assert(s.mobile,`${name} is not using mobile contract`);
      const smallButtons=s.buttons.filter(x=>x.display!=='none'&&(x.w<44-0.01||x.h<44-0.01));
      assert(smallButtons.length===0,`${name} contour-mode touch targets below 44x44: ${JSON.stringify(smallButtons)}`);
      const smallFields=s.fields.filter(x=>x.display!=='none'&&(x.h<44-0.01));
      assert(smallFields.length===0,`${name} spiral numeric touch targets below 44px: ${JSON.stringify(smallFields)}`);
      const smallLabels=s.labels.filter(x=>x.display!=='none'&&x.h<44-0.01);
      assert(smallLabels.length===0,`${name} spiral checkbox label targets below 44px: ${JSON.stringify(smallLabels)}`);
    }

    // Execute the user action in short coarse-touch landscape.
    await h.call('Emulation.setDeviceMetricsOverride',{width:844,height:390,deviceScaleFactor:3,mobile:true,screenWidth:844,screenHeight:390});
    await sleep(180);
    await h.evaluate(`(()=>{__somataSelectContourMode('closed');const e=document.querySelector('[data-contour-family="spiral"]');e?.scrollIntoView({block:'center',inline:'center'});return true;})()`);
    await sleep(180);
    const before=await h.evaluate(`(()=>({frames:__spiroAnimationStats().frameCount,spiral:state.layers.find(x=>x.id===${JSON.stringify(layerId)})?.spiralEnabled===true}))()`);
    const target=await h.evaluate(`(()=>{const e=document.querySelector('[data-contour-family="spiral"]'),b=e.getBoundingClientRect(),x=b.left+b.width/2,y=b.top+b.height/2,hit=document.elementFromPoint(x,y);return{x,y,w:b.width,h:b.height,hit:hit===e||e.contains(hit),hitTag:hit?.tagName||'',hitId:hit?.id||'',hitClass:hit?.className||'',inside:x>=0&&x<innerWidth&&y>=0&&y<innerHeight};})()`);
    assert(target.inside&&target.hit&&target.w>=44&&target.h>=44,`spiral-closed control is not a reachable >=44x44 landscape target: ${JSON.stringify(target)}`);
    await touch(h,target.x,target.y);
    await sleep(240);
    const action=await h.evaluate(`(()=>{const l=state.layers.find(x=>x.id===${JSON.stringify(layerId)});const stats=__spiroAnimationStats();beginFrameGeometryRuntime();const c=acquireLayerFrameEffectContext(0);c.layer=l;c.effectLayer=l;c.sourceLayer=l;c.staticDrawData=getCachedLayerDrawData(l);c.canonicalGeometry=getCanonicalLayerGeometry(l);c.now=performance.now();c.frame.now=c.now;c.frame.id=c.frameId;c.frame.dpr=devicePixelRatio||1;c.strokeWidth=3;c.baseAlpha=1;c.lineAlpha=1;c.lineDisplayEnabled=true;const w=prepareLayerFrameWebData(c);const rec=createGeometryGLRecordingContext(mainCtx);drawWebThreadsAnimated(rec,w.paths,l,1,w,true,'inside');return{spiralEnabled:l.spiralEnabled===true,spiralClosed:l.spiralClosed===true,frames:stats.frameCount,inFrame:stats.inFrame,paintErrors:stats.paintErrors||0,commands:rec.commands?.length||0,finite:(rec.commands||[]).every(cmd=>Object.values(cmd||{}).filter(v=>typeof v==='number').every(Number.isFinite))};})()`);
    assert(action.spiralEnabled&&action.spiralClosed,'real touch did not switch to closed Spiral topology');
    assert(action.frames>before.frames,'real Spiral touch did not produce a later frame');
    assert(action.commands>0&&action.finite&&action.paintErrors===0&&!action.inFrame,`Spiral/Web lost render stability after real mobile touch: ${JSON.stringify(action)}`);

    const exc=uncaughtExceptions(h.events).slice(baseline);assert(exc.length===0,'uncaught browser exceptions: '+exc.join(' | '));
    console.log('MOBILE SPIRAL CONTROLS TOUCH REGRESSION: PASS',{portrait,landscape,target,action});
  }finally{await h.close();}
}
main().catch(e=>{console.error('FAIL mobile Spiral controls touch regression:',e.stack||e.message);process.exit(1)});
