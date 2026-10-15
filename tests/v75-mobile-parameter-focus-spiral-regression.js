const fs=require('fs');
const path=require('path');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(c,m)=>{if(!c)throw new Error(m);};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function touch(h,x,y,holdMs=35){
  await h.call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1,radiusX:3,radiusY:3,force:1}]});
  await sleep(holdMs);
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
    await h.call('Emulation.setDeviceMetricsOverride',{width:844,height:390,deviceScaleFactor:3,mobile:true,screenWidth:844,screenHeight:390});
    await sleep(250);

    const layerId=await h.evaluate(`(()=>{
      const l=state.layers[0]||createLayer('mobile-focus-spiral'); if(!state.layers.length)state.layers.push(l);
      state.activeLayerId=l.id; l.visible=true; l.lineVisible=true; l.N=17; l.K=5; l.radius=220; l.rounding=64;
      l.spiralEnabled=true; l.spiralClosed=true; l.spiralOrder=3; l.spiralStepLinked=false; l.spiralStep=2.4; l.spiralTangential=true; l.spiralRoundSeams=true;
      ensureLayerEffectState(l); l.showWeb=true; l.web.inside=true; l.web.outsideStraight=true; l.web.outsideArc=true; state.showWeb=true;
      invalidateLayerGeometry(l,'mobile-parameter-focus-spiral'); refreshLayerLookup(true); syncSidebarInputs(); requestMainCanvasRender();
      return l.id;
    })()`);

    const opened=await h.evaluate(`(async()=>{
      const launch=document.getElementById('btnMobileControls'); launch.click(); await new Promise(r=>requestAnimationFrame(r));
      const tool=document.querySelector('[data-sidebar-mode="shape"]'); tool.click(); await new Promise(r=>setTimeout(r,280));
      const aside=document.getElementById('settingsSidebar');
      return{launcher:!!launch,tool:!!tool,open:aside.classList.contains('mobile-open')};
    })()`);
    assert(opened.launcher&&opened.tool&&opened.open,'mobile sidebar did not open through launcher → shape action path');
    await sleep(80);


    const target=await h.evaluate(`(()=>{
      const row=document.getElementById('paramRadius')?.closest('.control-row'); const label=[...row.querySelectorAll('.row-label span')].find(e=>/Радиус R/.test(e.textContent||''));
      row.scrollIntoView({block:'center',inline:'nearest'});
      const b=label.getBoundingClientRect(), aside=document.getElementById('settingsSidebar');
      const x=b.left+b.width/2,y=b.top+b.height/2,hit=document.elementFromPoint(x,y);return{x,y,w:b.width,h:b.height,sidebarOpen:aside.classList.contains('mobile-open'),text:label.textContent.trim(),hit:hit===label||label.contains(hit),hitTag:hit?.tagName||'',hitText:(hit?.textContent||'').trim().slice(0,50),radius:state.layers.find(x=>x.id===${JSON.stringify(layerId)})?.radius,frames:__spiroAnimationStats().frameCount};
    })()`);
    assert(target.sidebarOpen,'mobile sidebar did not open through the real touch path');
    console.log('MOBILE PARAMETER FOCUS TARGET',target);
    assert(target.w>0&&target.h>0&&target.hit,'radius label is not visible/reachable: '+JSON.stringify(target));

    await h.call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:target.x,y:target.y,id:7,radiusX:3,radiusY:3,force:1}]});
    await sleep(620);
    await h.call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await sleep(80);

    const focus=await h.evaluate(`(()=>{
      const overlay=document.getElementById('mobileParameterFocusOverlay'),dock=overlay?.querySelector('.mobile-parameter-focus-dock'),plus=document.getElementById('mobileParameterPlus'),range=document.getElementById('paramRadius');
      const os=overlay?getComputedStyle(overlay):null,ob=overlay?.getBoundingClientRect(),db=dock?.getBoundingClientRect(),pb=plus?.getBoundingClientRect();
      return{mobile:matchMedia('(max-width: 760px), (max-height: 480px) and (hover: none) and (pointer: coarse)').matches,active:overlay?.classList.contains('mobile-parameter-focus-active')===true,aria:overlay?.getAttribute('aria-hidden'),display:os?.display||'',visibility:os?.visibility||'',opacity:Number(os?.opacity||0),overlayRect:ob?[ob.width,ob.height]:[0,0],dockRect:db?[db.left,db.top,db.width,db.height]:[0,0,0,0],plus:pb?{x:pb.left+pb.width/2,y:pb.top+pb.height/2,w:pb.width,h:pb.height}:null,rangeInOverlay:range?.closest('#mobileParameterFocusOverlay')!=null,title:document.getElementById('mobileParameterFocusTitle')?.textContent||''};
    })()`);
    console.log('MOBILE PARAMETER FOCUS LANDSCAPE PROBE',focus);
    assert(focus.mobile,'844x390 coarse-touch viewport is not in the mobile contract');
    assert(focus.active&&focus.aria==='false','long-press did not activate parameter-focus overlay');
    assert(focus.display!=='none'&&focus.visibility!=='hidden'&&focus.opacity>0&&focus.overlayRect[0]>0&&focus.overlayRect[1]>0,`active parameter-focus overlay is not physically visible in landscape: ${JSON.stringify(focus)}`);
    assert(focus.rangeInOverlay&&/Радиус/.test(focus.title),'radius range was not moved into the focused mobile control');
    assert(focus.plus&&focus.plus.w>=44&&focus.plus.h>=44,'focused + control is below 44x44');

    await touch(h,focus.plus.x,focus.plus.y);
    await sleep(220);
    const action=await h.evaluate(`(()=>{
      const l=state.layers.find(x=>x.id===${JSON.stringify(layerId)}),stats=__spiroAnimationStats();
      beginFrameGeometryRuntime(); const c=acquireLayerFrameEffectContext(0); c.layer=l;c.effectLayer=l;c.sourceLayer=l;c.staticDrawData=getCachedLayerDrawData(l);c.canonicalGeometry=getCanonicalLayerGeometry(l);c.now=performance.now();c.frame.now=c.now;c.frame.id=c.frameId;c.frame.dpr=devicePixelRatio||1;c.strokeWidth=3;c.baseAlpha=1;c.lineAlpha=1;c.lineDisplayEnabled=true;
      const w=prepareLayerFrameWebData(c),rec=createGeometryGLRecordingContext(mainCtx); drawWebThreadsAnimated(rec,w.paths,l,1,w,true,'inside');
      return{radius:l.radius,frames:stats.frameCount,inFrame:stats.inFrame,paintErrors:stats.paintErrors||0,commands:rec.commands?.length||0,finite:(rec.commands||[]).every(cmd=>Object.values(cmd||{}).filter(v=>typeof v==='number').every(Number.isFinite))};
    })()`);
    assert(action.radius>target.radius,`focused + did not change live radius: ${target.radius} -> ${action.radius}`);
    assert(action.frames>target.frames,'focused radius change did not produce a later frame');
    assert(action.commands>0&&action.finite&&action.paintErrors===0&&!action.inFrame,`Spiral/Web became unstable after focused mobile radius change: ${JSON.stringify(action)}`);

    await sleep(480);
    await touch(h,6,6);
    await sleep(320);
    const restored=await h.evaluate(`(()=>{const overlay=document.getElementById('mobileParameterFocusOverlay'),range=document.getElementById('paramRadius'),row=range?.closest('.control-row');return{active:overlay?.classList.contains('mobile-parameter-focus-active')===true,aria:overlay?.getAttribute('aria-hidden'),inOverlay:range?.closest('#mobileParameterFocusOverlay')!=null,restored:!!row};})()`);
    assert(!restored.active&&restored.aria==='true'&&!restored.inOverlay&&restored.restored,'focused radius control was not restored after closing overlay');

    const exc=uncaughtExceptions(h.events).slice(baseline); assert(exc.length===0,'uncaught browser exceptions: '+exc.join(' | '));
    console.log('MOBILE PARAMETER FOCUS + SPIRAL REGRESSION: PASS',{target,focus,action,restored});
  }finally{await h.close();}
}
main().catch(e=>{console.error('FAIL mobile parameter focus spiral regression:',e.stack||e.message);process.exit(1)});
